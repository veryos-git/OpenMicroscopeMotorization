// runs stitch.py (mosaic stitcher) on a folder of scan tiles
//
// stitch.py logs its progress line by line on stderr and writes the mosaic to
// disk, so the result is assembled from the exit code + the written files.

import {
    s_root_dir,
    s_ds,
} from "./runtimedata.module.js";

let s_path__script = `${s_root_dir}${s_ds}stitch.py`;
let s_path__python = `${s_root_dir}${s_ds}venv${s_ds}bin${s_ds}python3`;

// how many log lines are kept for the result sent back to the client
let N_CNT__LINE__MAX = 400;
// how often the live session looks at its folder / mosaic
let N_MS__LIVE_POLL = 1000;
// stitch.py 'watch' rescans the folder this often
let N_SEC__LIVE_WATCH_INTERVAL = 1;
// the live overlay only needs a small image, so cap the written preview
let N_PX__LIVE_PREVIEW = 1600;
let N_QUALITY__LIVE_JPEG = 88;
let A_S_EXT__IMAGE = ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp'];
// every frame the browser drops into a live folder is named live_0001.png
let S_PREFIX__LIVE_FRAME = 'live_';
let S_PATTERN__LIVE_FRAME = '^live_';

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

// o_option: {
//   s_path_folder, n_score__min, n_dim__max, s_blend,
//   b_no_flatfield, b_matcher__loftr, b_dry_run
// }
// f_on_line: called with every log line while stitch.py runs (may be omitted)
let f_o_stitch_run = async function(o_option, f_on_line) {
    let s_path_folder = o_option.s_path_folder;
    if(!s_path_folder){
        return { b_success: false, s_error: 'no folder given', a_s_line: [] };
    }
    if(!await f_b_path_exists(s_path_folder)){
        return { b_success: false, s_error: `no such folder: ${s_path_folder}`, a_s_line: [] };
    }
    if(!await f_b_path_exists(s_path__python)){
        return {
            b_success: false,
            a_s_line: [],
            s_error: 'python venv missing — run: deno task install',
        };
    }
    if(!await f_b_path_exists(s_path__script)){
        return { b_success: false, s_error: `stitch.py not found at ${s_path__script}`, a_s_line: [] };
    }

    let s_path_output = `${s_path_folder}${s_ds}stitched.png`;
    let s_path_preview = `${s_path_folder}${s_ds}stitched_preview.jpg`;
    let s_path_position = `${s_path_folder}${s_ds}positions.json`;
    let s_path_report = `${s_path_folder}${s_ds}report.json`;

    let a_s_arg = [
        s_path__script,
        s_path_folder,
        '-o', s_path_output,
        '--positions', s_path_position,
        '--report', s_path_report,
    ];
    if(o_option.n_score__min) a_s_arg.push('--min-score', String(o_option.n_score__min));
    if(o_option.n_dim__max) a_s_arg.push('--max-dim', String(o_option.n_dim__max));
    if(o_option.s_blend === 'none') a_s_arg.push('--blend', 'none');
    if(o_option.b_no_flatfield) a_s_arg.push('--no-flatfield');
    if(o_option.b_matcher__loftr) a_s_arg.push('--matcher', 'loftr');
    if(o_option.b_dry_run) a_s_arg.push('--dry-run');

    let a_s_line = [];
    let f_line = function(s_line) {
        if(!s_line) return;
        a_s_line.push(s_line);
        if(a_s_line.length > N_CNT__LINE__MAX) a_s_line.shift();
        if(f_on_line) f_on_line(s_line);
    };

    let o_command = new Deno.Command(s_path__python, {
        args: a_s_arg,
        stdout: 'piped',
        stderr: 'piped',
    });
    let o_child = o_command.spawn();

    let f_read_stream = async function(o_stream) {
        let o_decoder = new TextDecoder();
        let s_rest = '';
        for await (let a_n_byte of o_stream){
            s_rest += o_decoder.decode(a_n_byte, { stream: true });
            let a_s_part = s_rest.split('\n');
            s_rest = a_s_part.pop();
            for(let s_part of a_s_part){
                f_line(s_part.trimEnd());
            }
        }
        if(s_rest.trim()) f_line(s_rest.trimEnd());
    };

    await Promise.all([
        f_read_stream(o_child.stderr),
        f_read_stream(o_child.stdout),
    ]);
    let o_status = await o_child.status;

    let b_output = await f_b_path_exists(s_path_output);
    // the preview is only written when the mosaic is larger than --preview
    let b_preview = await f_b_path_exists(s_path_preview);

    let o_result = {
        b_success: o_status.success && (b_output || o_option.b_dry_run === true),
        s_path_output: b_output ? s_path_output : '',
        s_path_preview: b_preview ? s_path_preview : '',
        s_path_position: await f_b_path_exists(s_path_position) ? s_path_position : '',
        s_path_report: await f_b_path_exists(s_path_report) ? s_path_report : '',
        a_s_line: a_s_line,
        s_error: '',
    };
    if(!o_result.b_success){
        // the closing lines carry the reason stitch.py gave up
        o_result.s_error = a_s_line.slice(-4).join(' | ')
            || `stitch.py exited with code ${o_status.code}`;
    }
    return o_result;
};

// ─── Live session ───────────────────────────────────────────────────
//
// A live session keeps one growing mosaic while images keep arriving:
//   1. the client drops frames into the session folder
//   2. as soon as two are there, a session is built  (stitch.py <folder> --session)
//   3. from then on stitch.py 'watch' places every new image into that session
//      and repaints only the area it touches
// The status (including the mosaic timestamp) is polled by the client, which
// reloads the overlay image whenever that timestamp changes.

let o_live = {
    b_running: false,
    b_busy: false,
    s_status: 'idle',        // idle | waiting | building | live | stopping | error
    s_error: '',
    s_path_folder: '',
    s_path_session: '',
    s_path_mosaic: '',
    s_path_preview: '',
    n_cnt__image: 0,
    n_cnt__tile: 0,
    n_cnt__pending: 0,
    n_scl_x__mosaic: 0,
    n_scl_y__mosaic: 0,
    n_ts_ms__mosaic: 0,
    // the session tiles are downscaled copies of the camera frame; the marker
    // re-lock needs both sizes to convert mosaic px <-> video px
    n_scl_x__tile: 0,
    n_scl_y__tile: 0,
    n_scl_x__video: 0,
    // world position of the most recently placed tile -- where the camera is
    // looking right now; markers anchor to the image through this
    n_x__view: 0,
    n_y__view: 0,
    a_s_line: [],
    o_child__watch: null,
    n_id__interval: 0,
    o_option: {},
};

let f_live_line = function(s_line) {
    if(!s_line) return;
    o_live.a_s_line.push(s_line);
    if(o_live.a_s_line.length > N_CNT__LINE__MAX) o_live.a_s_line.shift();
};

let f_read_stream__line = async function(o_stream, f_line) {
    let o_decoder = new TextDecoder();
    let s_rest = '';
    for await (let a_n_byte of o_stream){
        s_rest += o_decoder.decode(a_n_byte, { stream: true });
        let a_s_part = s_rest.split('\n');
        s_rest = a_s_part.pop();
        for(let s_part of a_s_part){
            f_line(s_part.trimEnd());
        }
    }
    if(s_rest.trim()) f_line(s_rest.trimEnd());
};

let f_a_s_name__image = async function(s_path_folder) {
    let a_s_name = [];
    try {
        for await (let o_entry of Deno.readDir(s_path_folder)){
            if(!o_entry.isFile) continue;
            let s_name__lower = o_entry.name.toLowerCase();
            // the mosaic and its preview live in the same folder
            if(!s_name__lower.startsWith(S_PREFIX__LIVE_FRAME)) continue;
            if(!A_S_EXT__IMAGE.some(function(s_ext){ return s_name__lower.endsWith(s_ext); })) continue;
            a_s_name.push(o_entry.name);
        }
    } catch { /* folder gone */ }
    a_s_name.sort();
    return a_s_name;
};

let f_o_live_status = function() {
    return {
        b_running: o_live.b_running,
        s_status: o_live.s_status,
        s_error: o_live.s_error,
        s_path_folder: o_live.s_path_folder,
        s_path_mosaic: o_live.s_path_mosaic,
        s_path_preview: o_live.s_path_preview,
        n_cnt__image: o_live.n_cnt__image,
        n_cnt__tile: o_live.n_cnt__tile,
        n_cnt__pending: o_live.n_cnt__pending,
        n_scl_x__mosaic: o_live.n_scl_x__mosaic,
        n_scl_y__mosaic: o_live.n_scl_y__mosaic,
        n_ts_ms__mosaic: o_live.n_ts_ms__mosaic,
        n_scl_x__tile: o_live.n_scl_x__tile,
        n_scl_y__tile: o_live.n_scl_y__tile,
        n_scl_x__video: o_live.n_scl_x__video,
        n_x__view: o_live.n_x__view,
        n_y__view: o_live.n_y__view,
        a_s_line: o_live.a_s_line.slice(-40),
    };
};

let f_a_s_arg__common = function() {
    let a_s_arg = [
        '--preview', String(N_PX__LIVE_PREVIEW),
        '--jpeg-quality', String(N_QUALITY__LIVE_JPEG),
        // the mosaic and its preview sit in the same folder — without this they
        // would be picked up as input frames and end up as pending tiles
        '--pattern', S_PATTERN__LIVE_FRAME,
        // live placement is local-first: a tight verification window around the
        // screened position and only the top candidates keep an add fast
        '--add-window', '24',
        '--add-candidates', '3',
    ];
    if(o_live.o_option.n_score__min){
        a_s_arg.push('--min-score', String(o_live.o_option.n_score__min));
    }
    if(o_live.o_option.b_no_flatfield) a_s_arg.push('--no-flatfield');
    if(o_live.o_option.b_matcher__loftr) a_s_arg.push('--matcher', 'loftr');
    return a_s_arg;
};

let f_b_live_build = async function() {
    o_live.s_status = 'building';
    f_live_line('--- building the initial mosaic ---');

    // seed the session with just the two newest frames -- a single pair that
    // registers in under a second.  Everything older is placed by the watch
    // loop afterwards (an all-pair build over a piled-up folder is O(n^2)).
    let a_s_name__image = await f_a_s_name__image(o_live.s_path_folder);
    let a_s_path__seed = a_s_name__image.slice(-2).map(function(s_name){
        return `${o_live.s_path_folder}${s_ds}${s_name}`;
    });
    if(a_s_path__seed.length < 2){
        o_live.s_status = 'waiting';
        return false;
    }

    let a_s_arg = [
        s_path__script,
        ...a_s_path__seed,
        '-o', o_live.s_path_mosaic,
        '--session', o_live.s_path_session,
        // live frames carry no grid indices, so every pair is a candidate
        '--no-grid',
        ...f_a_s_arg__common(),
    ];
    let o_command = new Deno.Command(s_path__python, {
        args: a_s_arg,
        stdout: 'piped',
        stderr: 'piped',
    });
    let o_child = o_command.spawn();
    await Promise.all([
        f_read_stream__line(o_child.stderr, f_live_line),
        f_read_stream__line(o_child.stdout, f_live_line),
    ]);
    let o_status = await o_child.status;

    if(!o_status.success || !await f_b_path_exists(o_live.s_path_session)){
        // a build fails while the first frames do not overlap yet -> just retry
        // on the next tick, by then more frames have arrived
        f_live_line('--- initial build did not succeed yet, waiting for more images ---');
        o_live.s_status = 'waiting';
        return false;
    }
    f_live_line('--- session created, watching for new images ---');
    return true;
};

let f_live_spawn_watch = function() {
    let a_s_arg = [
        s_path__script,
        'watch',
        o_live.s_path_folder,
        '--session', o_live.s_path_session,
        '--interval', String(N_SEC__LIVE_WATCH_INTERVAL),
        ...f_a_s_arg__common(),
    ];
    let o_command = new Deno.Command(s_path__python, {
        args: a_s_arg,
        stdout: 'piped',
        stderr: 'piped',
    });
    let o_child = o_command.spawn();
    o_live.o_child__watch = o_child;
    o_live.s_status = 'live';

    // read both streams for as long as the child lives
    f_read_stream__line(o_child.stderr, f_live_line).catch(function(){});
    f_read_stream__line(o_child.stdout, f_live_line).catch(function(){});
    o_child.status.then(function(o_status){
        if(o_live.o_child__watch !== o_child) return;   // replaced or stopped
        o_live.o_child__watch = null;
        if(o_live.b_running){
            f_live_line(`--- watch exited with code ${o_status.code}, restarting ---`);
        }
    }).catch(function(){});
};

let f_live_read_session = async function() {
    try {
        let s_json = await Deno.readTextFile(o_live.s_path_session);
        let o_session = JSON.parse(s_json);
        o_live.n_cnt__tile = (o_session.tiles || []).length;
        o_live.n_cnt__pending = (o_session.pending || []).length;
        if(Array.isArray(o_session.canvas)){
            o_live.n_scl_x__mosaic = o_session.canvas[0];
            o_live.n_scl_y__mosaic = o_session.canvas[1];
        }
        if(Array.isArray(o_session.tile_size)){
            o_live.n_scl_x__tile = o_session.tile_size[0];
            o_live.n_scl_y__tile = o_session.tile_size[1];
        }
        let a_o_tile = o_session.tiles || [];
        if(a_o_tile.length){
            let o_tile__last = a_o_tile[a_o_tile.length - 1];
            o_live.n_x__view = o_tile__last.x;
            o_live.n_y__view = o_tile__last.y;
        }
    } catch { /* not written yet, or being replaced right now */ }
};

let f_live_tick = async function() {
    if(!o_live.b_running || o_live.b_busy) return;
    o_live.b_busy = true;
    try {
        let a_s_name__image = await f_a_s_name__image(o_live.s_path_folder);
        o_live.n_cnt__image = a_s_name__image.length;

        if(!await f_b_path_exists(o_live.s_path_session)){
            if(a_s_name__image.length >= 2){
                await f_b_live_build();
            } else {
                o_live.s_status = 'waiting';
            }
        } else if(!o_live.o_child__watch){
            f_live_spawn_watch();
        }

        await f_live_read_session();

        // the mosaic timestamp is what tells the client to reload the image
        for(let s_path of [o_live.s_path_preview, o_live.s_path_mosaic]){
            try {
                let o_stat = await Deno.stat(s_path);
                let n_ts_ms = o_stat.mtime ? o_stat.mtime.getTime() : 0;
                if(n_ts_ms > o_live.n_ts_ms__mosaic) o_live.n_ts_ms__mosaic = n_ts_ms;
            } catch { /* not written yet */ }
        }
    } catch (o_error) {
        o_live.s_error = o_error.message;
        f_live_line('live tick error: ' + o_error.message);
    } finally {
        o_live.b_busy = false;
    }
};

let f_live_kill_watch = function() {
    if(!o_live.o_child__watch) return;
    let o_child = o_live.o_child__watch;
    o_live.o_child__watch = null;
    try { o_child.kill('SIGTERM'); } catch { /* already gone */ }
};

// o_option: { s_name, n_score__min, b_no_flatfield, b_matcher__loftr }
let f_o_live_start = async function(o_option) {
    if(o_live.b_running) await f_o_live_stop({});

    if(!await f_b_path_exists(s_path__python)){
        return { b_success: false, s_error: 'python venv missing — run: deno task install' };
    }

    let o_date = new Date();
    let f_s_pad = function(n){ return String(n).padStart(2, '0'); };
    let s_name_folder = 'live_'
        + o_date.getFullYear() + '-'
        + f_s_pad(o_date.getMonth() + 1) + '-'
        + f_s_pad(o_date.getDate()) + '_'
        + f_s_pad(o_date.getHours())
        + f_s_pad(o_date.getMinutes())
        + f_s_pad(o_date.getSeconds());
    let s_path_folder = `${s_root_dir}${s_ds}scans${s_ds}${s_name_folder}`;
    await Deno.mkdir(s_path_folder, { recursive: true });

    o_live.b_running = true;
    o_live.s_status = 'waiting';
    o_live.s_error = '';
    o_live.s_path_folder = s_path_folder;
    o_live.s_path_session = `${s_path_folder}${s_ds}session.json`;
    o_live.s_path_mosaic = `${s_path_folder}${s_ds}mosaic.jpg`;
    o_live.s_path_preview = `${s_path_folder}${s_ds}mosaic_preview.jpg`;
    o_live.n_cnt__image = 0;
    o_live.n_cnt__tile = 0;
    o_live.n_cnt__pending = 0;
    o_live.n_scl_x__mosaic = 0;
    o_live.n_scl_y__mosaic = 0;
    o_live.n_ts_ms__mosaic = 0;
    o_live.n_scl_x__tile = 0;
    o_live.n_scl_y__tile = 0;
    o_live.n_scl_x__video = (o_option && typeof o_option.n_scl_x__video === 'number')
        ? o_option.n_scl_x__video : 0;
    o_live.n_x__view = 0;
    o_live.n_y__view = 0;
    o_live.a_s_line = [];
    o_live.o_option = o_option || {};

    clearInterval(o_live.n_id__interval);
    o_live.n_id__interval = setInterval(function(){ f_live_tick(); }, N_MS__LIVE_POLL);

    f_live_line(`--- live stitch started in ${s_path_folder} ---`);
    return { b_success: true, s_path_folder: s_path_folder, o_status: f_o_live_status() };
};

// o_option: { b_repaint }  -> re-blend the whole mosaic once, evenly lit
let f_o_live_stop = async function(o_option) {
    if(!o_live.b_running) return { b_success: true, o_status: f_o_live_status() };

    o_live.s_status = 'stopping';
    clearInterval(o_live.n_id__interval);
    o_live.n_id__interval = 0;
    f_live_kill_watch();

    let b_session = await f_b_path_exists(o_live.s_path_session);
    if(o_option && o_option.b_repaint && b_session){
        f_live_line('--- final repaint of the whole mosaic ---');
        // 'add' needs an input; handing it a frame that is already placed leaves
        // nothing to add, so it goes straight to the repaint
        let a_s_name__image = await f_a_s_name__image(o_live.s_path_folder);
        let s_path_input = a_s_name__image.length
            ? `${o_live.s_path_folder}${s_ds}${a_s_name__image[0]}`
            : o_live.s_path_folder;
        let o_command = new Deno.Command(s_path__python, {
            args: [
                s_path__script,
                'add',
                s_path_input,
                '--session', o_live.s_path_session,
                '--repaint-all',
                ...f_a_s_arg__common(),
            ],
            stdout: 'piped',
            stderr: 'piped',
        });
        let o_child = o_command.spawn();
        await Promise.all([
            f_read_stream__line(o_child.stderr, f_live_line),
            f_read_stream__line(o_child.stdout, f_live_line),
        ]);
        await o_child.status;
        await f_live_read_session();
        try {
            let o_stat = await Deno.stat(o_live.s_path_mosaic);
            if(o_stat.mtime) o_live.n_ts_ms__mosaic = o_stat.mtime.getTime();
        } catch { /* nothing written */ }
    }

    o_live.b_running = false;
    o_live.s_status = b_session ? 'complete' : 'idle';
    f_live_line('--- live stitch stopped ---');
    return { b_success: true, o_status: f_o_live_status() };
};

export { f_o_stitch_run, f_o_live_start, f_o_live_stop, f_o_live_status };
