// fog_of_war.module.js -- server side of the fog-of-war live mosaic.
//
// Instead of incremental (drift-prone) registration, this collects sampled
// frames into a session folder and periodically re-runs the batch stitcher
// (stitch.py) over all of them.  stitch.py does a global least-squares solve,
// which is what makes the "scan" mode robust -- the same solve here keeps the
// live mosaic from drifting, at the cost of being O(n^2) as frames accumulate.

import { s_root_dir, s_ds } from "./runtimedata.module.js";

let s_path__script = `${s_root_dir}${s_ds}stitch.py`;
let s_path__python = `${s_root_dir}${s_ds}venv${s_ds}bin${s_ds}python3`;

// how often to re-run the batch stitcher over the accumulated frames
let N_MS__RESTITCH = 4000;
let N_PX__PREVIEW = 1600;

let o_fog = {
    b_running: false,
    b_busy: false,
    s_path_folder: '',
    s_path_mosaic: '',
    s_path_preview: '',
    s_path_positions: '',
    o_last: {},
    n_ts_ms__preview: 0,
    n_cnt__tile__last: 0,
    a_s_line: [],
    n_id__interval: 0,
};

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

let f_n_cnt__frame = async function() {
    let n_cnt = 0;
    try {
        for await (let o_entry of Deno.readDir(o_fog.s_path_folder)) {
            if (o_entry.isFile && /^fog_.*\.(png|jpg|jpeg)$/i.test(o_entry.name)) {
                n_cnt++;
            }
        }
    } catch { /* folder gone */ }
    return n_cnt;
};

let f_o_fog_restitch = async function() {
    if (o_fog.b_busy || !o_fog.b_running) return;
    o_fog.b_busy = true;
    try {
        let n_cnt__frame = await f_n_cnt__frame();
        if (n_cnt__frame < 2) return;
        if (n_cnt__frame === o_fog.n_cnt__tile__last && o_fog.o_last.n_commit) return;

        o_fog.a_s_line.push(`--- re-stitching ${n_cnt__frame} frame(s) ---`);
        let o_command = new Deno.Command(s_path__python, {
            args: [
                s_path__script, o_fog.s_path_folder,
                '-o', o_fog.s_path_mosaic,
                '--preview', String(N_PX__PREVIEW),
                '--positions', o_fog.s_path_positions,
                '--motor-pairs', '6',
                '--pattern', '^fog_',
                '--no-flatfield',
                '--jpeg-quality', '88',
            ],
            stdout: 'piped',
            stderr: 'piped',
        });
        let o_child = o_command.spawn();

        let o_decoder = new TextDecoder();
        let s_rest = '';
        for await (let a_n_byte of o_child.stderr) {
            s_rest += o_decoder.decode(a_n_byte, { stream: true });
            let a_s_part = s_rest.split('\n');
            s_rest = a_s_part.pop();
            for (let s_part of a_s_part) {
                if (s_part.trim()) o_fog.a_s_line.push(s_part.trim());
            }
        }
        if (s_rest.trim()) o_fog.a_s_line.push(s_rest.trim());
        await o_child.status;
        if (o_fog.a_s_line.length > 300) o_fog.a_s_line = o_fog.a_s_line.slice(-300);

        // read the solved tile positions -> current view + canvas bounds
        if (await f_b_path_exists(o_fog.s_path_positions)) {
            let o_pos = JSON.parse(await Deno.readTextFile(o_fog.s_path_positions));
            let a_o_tile = o_pos.tiles || [];
            if (a_o_tile.length) {
                let o_last_tile = a_o_tile[a_o_tile.length - 1];
                let n_w = o_pos.tile_size[0];
                let n_h = o_pos.tile_size[1];
                let n_x__min = Math.min(...a_o_tile.map(function(t){ return t.x; }));
                let n_y__min = Math.min(...a_o_tile.map(function(t){ return t.y; }));
                let n_x__max = Math.max(...a_o_tile.map(function(t){ return t.x + n_w; }));
                let n_y__max = Math.max(...a_o_tile.map(function(t){ return t.y + n_h; }));
                o_fog.o_last = {
                    n_x__view: o_last_tile.x,
                    n_y__view: o_last_tile.y,
                    n_scl_x__frame: n_w,
                    n_scl_y__frame: n_h,
                    n_scl_x__mosaic: Math.ceil(n_x__max - n_x__min),
                    n_scl_y__mosaic: Math.ceil(n_y__max - n_y__min),
                    n_x__min: n_x__min,
                    n_y__min: n_y__min,
                    n_commit: a_o_tile.length,
                    n_skip: 0,
                    n_lost: 0,
                    s_method: 'stitch.py',
                    n_confidence: 1.0,
                };
                o_fog.n_cnt__tile__last = a_o_tile.length;
                o_fog.a_s_line.push(`--- mosaic ${o_fog.o_last.n_scl_x__mosaic}x${o_fog.o_last.n_scl_y__mosaic} ---`);
            }
        }
    } catch (o_error) {
        o_fog.a_s_line.push('re-stitch error: ' + o_error.message);
    } finally {
        o_fog.b_busy = false;
    }
};

let f_o_fog_start = async function() {
    if (o_fog.b_running) await f_o_fog_stop();
    if (!await f_b_path_exists(s_path__python)) {
        return { b_success: false, s_error: 'python venv missing — run: deno task install' };
    }

    let o_date = new Date();
    let f_s_pad = function(n) { return String(n).padStart(2, '0'); };
    let s_name_folder = 'fog_' + o_date.getFullYear() + '-'
        + f_s_pad(o_date.getMonth() + 1) + '-' + f_s_pad(o_date.getDate()) + '_'
        + f_s_pad(o_date.getHours()) + f_s_pad(o_date.getMinutes())
        + f_s_pad(o_date.getSeconds());
    let s_path_folder = `${s_root_dir}${s_ds}scans${s_ds}${s_name_folder}`;
    await Deno.mkdir(s_path_folder, { recursive: true });

    o_fog.b_running = true;
    o_fog.s_path_folder = s_path_folder;
    o_fog.s_path_mosaic = `${s_path_folder}${s_ds}mosaic.png`;
    o_fog.s_path_preview = `${s_path_folder}${s_ds}mosaic_preview.jpg`;
    o_fog.s_path_positions = `${s_path_folder}${s_ds}positions.json`;
    o_fog.o_last = {};
    o_fog.n_ts_ms__preview = 0;
    o_fog.n_cnt__tile__last = 0;
    o_fog.a_s_line = [];

    o_fog.n_id__interval = setInterval(function() { f_o_fog_restitch(); }, N_MS__RESTITCH);
    return { b_success: true, s_path_folder: s_path_folder, o_status: await f_o_fog_status() };
};

let f_o_fog_stop = async function() {
    if (!o_fog.b_running) return { b_success: true, o_status: await f_o_fog_status() };
    clearInterval(o_fog.n_id__interval);
    o_fog.n_id__interval = 0;
    o_fog.b_running = false;
    await f_o_fog_restitch();       // one final re-stitch so nothing is left stale
    return { b_success: true, o_status: await f_o_fog_status() };
};

let f_o_fog_status = async function() {
    try {
        let o_stat = await Deno.stat(o_fog.s_path_preview);
        if (o_stat.mtime) {
            let n_ts_ms = o_stat.mtime.getTime();
            if (n_ts_ms > o_fog.n_ts_ms__preview) o_fog.n_ts_ms__preview = n_ts_ms;
        }
    } catch { /* no preview yet */ }
    return {
        b_running: o_fog.b_running,
        s_path_folder: o_fog.s_path_folder,
        s_path_preview: o_fog.s_path_preview,
        n_ts_ms__preview: o_fog.n_ts_ms__preview,
        o_last: o_fog.o_last,
        a_s_line: o_fog.a_s_line.slice(-40),
    };
};

let f_o_fog_export = async function(o_option) {
    if (!o_fog.s_path_mosaic || !await f_b_path_exists(o_fog.s_path_mosaic)) {
        return { b_success: false, s_error: 'no mosaic yet' };
    }
    let s_path_output = o_option && o_option.s_path_output
        ? o_option.s_path_output
        : o_fog.s_path_mosaic;
    // stitch.py already writes PNG; if the caller wants a different name, copy it
    if (s_path_output !== o_fog.s_path_mosaic) {
        await Deno.copyFile(o_fog.s_path_mosaic, s_path_output);
    }
    return { b_success: true, s_path_output: s_path_output };
};

export { f_o_fog_start, f_o_fog_stop, f_o_fog_status, f_o_fog_export };
