// locate_map.module.js -- server side of the live "where am I" localizer.
//
// Spawns locate_map.py (a long-running OpenCV template matcher) that keeps a
// heavily downscaled copy of a stitched map in memory and finds the current
// camera frame inside it.  This module starts/stops that process, receives the
// client's low-res frames and polls the location.json / locate_map.jpg it
// writes.  The reference map can be a grow map.jpg or a scan stitched.png.

import { s_root_dir, s_ds } from "./runtimedata.module.js";

let s_path__script = `${s_root_dir}${s_ds}locate_map.py`;
let s_path__python = `${s_root_dir}${s_ds}venv${s_ds}bin${s_ds}python3`;

let N_MS__POLL = 500;
let N_DIM__MAP = 512;
let N_DIM__PREVIEW = 900;
let N_SCORE__MIN = 0.35;
let N_CNT__LINE__MAX = 300;

let o_locate = {
    b_running: false,
    s_status: 'idle',       // idle | locating | stopping | error
    s_error: '',
    s_path_map: '',
    s_path_preview: '',
    s_path_frames: '',
    s_path_state: '',
    s_path_located: '',
    n_scl_x__map: 0,
    n_scl_y__map: 0,
    n_x: 0,
    n_y: 0,
    n_scl_x: 0,
    n_scl_y: 0,
    n_score: 0,
    b_found: false,
    n_cnt__frame: 0,
    n_ts_ms: 0,
    a_s_line: [],
    o_child: null,
    b_child__exited: false,
    n_id__interval: 0,
    n_seq__frame: 0,
};

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

let f_locate_line = function(s_line) {
    if(!s_line) return;
    o_locate.a_s_line.push(s_line);
    if(o_locate.a_s_line.length > N_CNT__LINE__MAX) o_locate.a_s_line.shift();
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

let f_locate_read_state = async function() {
    if(!o_locate.s_path_state) return;
    try {
        let s_json = await Deno.readTextFile(o_locate.s_path_state);
        let o_state = JSON.parse(s_json);
        for(let s_key of ['s_status', 's_error', 's_path_map']){
            if(typeof o_state[s_key] === 'string') o_locate[s_key] = o_state[s_key];
        }
        for(let s_key of ['n_scl_x__map', 'n_scl_y__map', 'n_x', 'n_y',
                          'n_scl_x', 'n_scl_y', 'n_cnt__frame']){
            if(typeof o_state[s_key] === 'number') o_locate[s_key] = o_state[s_key];
        }
        if(typeof o_state.n_score === 'number') o_locate.n_score = o_state.n_score;
        if(typeof o_state.b_found === 'boolean') o_locate.b_found = o_state.b_found;
    } catch { /* not written yet */ }
};

let f_locate_tick = async function() {
    if(!o_locate.b_running) return;

    await f_locate_read_state();

    for(let s_path of [o_locate.s_path_located, o_locate.s_path_state]){
        try {
            let o_stat = await Deno.stat(s_path);
            let n_ts_ms = o_stat.mtime ? o_stat.mtime.getTime() : 0;
            if(n_ts_ms > o_locate.n_ts_ms) o_locate.n_ts_ms = n_ts_ms;
        } catch { /* not written yet */ }
    }

    if(o_locate.b_child__exited && o_locate.b_running){
        o_locate.s_status = 'error';
        if(!o_locate.s_error) o_locate.s_error = 'locate_map.py exited unexpectedly';
    }
};

let f_a_s_arg__locate = function() {
    return [
        s_path__script,
        o_locate.s_path_frames,
        '--map', o_locate.s_path_map,
        '--state', o_locate.s_path_state,
        '--preview', o_locate.s_path_located,
        '--map-dim', String(N_DIM__MAP),
        '--preview-dim', String(N_DIM__PREVIEW),
        '--min-score', String(N_SCORE__MIN),
        '--poll', '0.3',
    ];
};

// o_option: { s_path_map, s_path_preview, s_path_frames }
let f_o_locate_start = async function(o_option) {
    if(o_locate.b_running) await f_o_locate_stop();

    let s_path_map = o_option && o_option.s_path_map;
    let s_path_preview = o_option && o_option.s_path_preview;
    if(!s_path_map || !await f_b_path_exists(s_path_map)){
        return { b_success: false, s_error: `map not found: ${s_path_map || ''}` };
    }
    if(!await f_b_path_exists(s_path__python)){
        return { b_success: false, s_error: 'python venv missing — run: deno task install' };
    }
    if(!await f_b_path_exists(s_path__script)){
        return { b_success: false, s_error: `locate_map.py not found at ${s_path__script}` };
    }

    let s_path_frames = '';
    if(o_option && typeof o_option.s_path_frames === 'string' && o_option.s_path_frames){
        s_path_frames = o_option.s_path_frames;
    } else {
        let o_date = new Date();
        let f_s_pad = function(n){ return String(n).padStart(2, '0'); };
        let s_name_folder = 'locate_'
            + o_date.getFullYear() + '-'
            + f_s_pad(o_date.getMonth() + 1) + '-'
            + f_s_pad(o_date.getDate()) + '_'
            + f_s_pad(o_date.getHours())
            + f_s_pad(o_date.getMinutes())
            + f_s_pad(o_date.getSeconds());
        s_path_frames = `${s_root_dir}${s_ds}scans${s_ds}${s_name_folder}`;
    }
    await Deno.mkdir(s_path_frames, { recursive: true });

    o_locate.b_running = true;
    o_locate.s_status = 'idle';
    o_locate.s_error = '';
    o_locate.s_path_map = s_path_map;
    o_locate.s_path_preview = s_path_preview || '';
    o_locate.s_path_frames = s_path_frames;
    o_locate.s_path_state = `${s_path_frames}${s_ds}location.json`;
    o_locate.s_path_located = `${s_path_frames}${s_ds}locate_map.jpg`;
    o_locate.n_scl_x__map = 0;
    o_locate.n_scl_y__map = 0;
    o_locate.n_x = 0;
    o_locate.n_y = 0;
    o_locate.n_scl_x = 0;
    o_locate.n_scl_y = 0;
    o_locate.n_score = 0;
    o_locate.b_found = false;
    o_locate.n_cnt__frame = 0;
    o_locate.n_ts_ms = 0;
    o_locate.a_s_line = [];
    o_locate.n_seq__frame = 0;

    let o_command = new Deno.Command(s_path__python, {
        args: f_a_s_arg__locate(),
        stdout: 'piped',
        stderr: 'piped',
    });
    o_locate.o_child = o_command.spawn();
    o_locate.b_child__exited = false;

    f_read_stream__line(o_locate.o_child.stderr, f_locate_line).catch(function(){});
    f_read_stream__line(o_locate.o_child.stdout, f_locate_line).catch(function(){});
    o_locate.o_child.status.then(function(o_status){
        o_locate.b_child__exited = true;
    }).catch(function(){
        o_locate.b_child__exited = true;
    });

    clearInterval(o_locate.n_id__interval);
    o_locate.n_id__interval = setInterval(function(){ f_locate_tick(); }, N_MS__POLL);

    f_locate_line(`--- locate started (map ${s_path_map}) ---`);
    return { b_success: true, s_path_frames: s_path_frames, o_status: f_o_locate_status() };
};

let f_o_locate_stop = async function() {
    if(!o_locate.b_running) return { b_success: true, o_status: f_o_locate_status() };

    o_locate.s_status = 'stopping';
    clearInterval(o_locate.n_id__interval);
    o_locate.n_id__interval = 0;

    if(o_locate.o_child){
        let o_child = o_locate.o_child;
        o_locate.o_child = null;
        try { o_child.kill('SIGTERM'); } catch { /* already gone */ }
    }

    await new Promise(function(resolve){ setTimeout(resolve, 200); });
    await f_locate_read_state();

    o_locate.b_running = false;
    if(o_locate.s_status !== 'error') o_locate.s_status = 'idle';
    f_locate_line('--- locate stopped ---');
    return { b_success: true, o_status: f_o_locate_status() };
};

let f_o_locate_status = function() {
    return {
        b_running: o_locate.b_running,
        s_status: o_locate.s_status,
        s_error: o_locate.s_error,
        s_path_map: o_locate.s_path_map,
        s_path_preview: o_locate.s_path_preview,
        s_path_located: o_locate.s_path_located,
        n_scl_x__map: o_locate.n_scl_x__map,
        n_scl_y__map: o_locate.n_scl_y__map,
        n_x: o_locate.n_x,
        n_y: o_locate.n_y,
        n_scl_x: o_locate.n_scl_x,
        n_scl_y: o_locate.n_scl_y,
        n_score: o_locate.n_score,
        b_found: o_locate.b_found,
        n_cnt__frame: o_locate.n_cnt__frame,
        n_ts_ms: o_locate.n_ts_ms,
        a_s_line: o_locate.a_s_line.slice(-40),
    };
};

// save one incoming low-res frame; returns the written path (or throws)
let f_s_locate_save_frame = async function(n_scl_x, n_scl_y, a_n_byte) {
    if(!o_locate.b_running || !o_locate.s_path_frames){
        throw new Error('locate is not running');
    }
    o_locate.n_seq__frame++;
    let s_name = `locate_${String(o_locate.n_seq__frame).padStart(5, '0')}`
        + `_${Math.round(n_scl_x)}x${Math.round(n_scl_y)}.jpg`;
    let s_path = `${o_locate.s_path_frames}${s_ds}${s_name}`;
    await Deno.writeFile(s_path, a_n_byte);
    return s_path;
};

// enumerate usable reference maps: grow map.jpg and scan stitched.png,
// most recent first; when there are more than 5, drop anything older than 1h
let f_o_locate_list_maps = async function() {
    let a_o_map = [];
    let s_path_scans = `${s_root_dir}${s_ds}scans`;
    try {
        for await (let o_entry of Deno.readDir(s_path_scans)){
            if(!o_entry.isDirectory) continue;
            let s_path_dir = `${s_path_scans}${s_ds}${o_entry.name}`;
            let s_path_grow_map = `${s_path_dir}${s_ds}map.jpg`;
            let s_path_scan_map = `${s_path_dir}${s_ds}stitched.png`;
            let s_path_map = '';
            let s_label = '';
            let s_path_preview = '';
            if(await f_b_path_exists(s_path_grow_map)){
                s_path_map = s_path_grow_map;
                s_label = 'grow ' + o_entry.name;
                s_path_preview = `${s_path_dir}${s_ds}map_preview.jpg`;
            } else if(await f_b_path_exists(s_path_scan_map)){
                s_path_map = s_path_scan_map;
                s_label = 'scan ' + o_entry.name;
                s_path_preview = `${s_path_dir}${s_ds}stitched_preview.jpg`;
            }
            if(!s_path_map) continue;

            let n_ts_ms = 0;
            try {
                let o_stat = await Deno.stat(s_path_map);
                n_ts_ms = o_stat.mtime ? o_stat.mtime.getTime() : 0;
            } catch { /* ignore */ }
            a_o_map.push({
                s_label: s_label,
                s_path_map: s_path_map,
                s_path_preview: s_path_preview,
                n_ts_ms: n_ts_ms,
            });
        }
    } catch { /* no scans folder yet */ }

    // most recent first
    a_o_map.sort(function(o_a, o_b){ return o_b.n_ts_ms - o_a.n_ts_ms; });

    // too many maps: keep only the fresh ones
    if(a_o_map.length > 5){
        let n_ts_ms__cutoff = Date.now() - 60 * 60 * 1000;
        a_o_map = a_o_map.filter(function(o_map){ return o_map.n_ts_ms >= n_ts_ms__cutoff; });
    }

    return { b_success: true, a_o_map: a_o_map };
};

export {
    f_o_locate_start,
    f_o_locate_stop,
    f_o_locate_status,
    f_o_locate_list_maps,
    f_s_locate_save_frame,
};
