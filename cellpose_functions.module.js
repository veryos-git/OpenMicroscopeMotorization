// cellpose_functions.module.js -- server side of the "Cell pose" panel.
//
// Owns one long-running cellpose_worker.py process (see that file for the JSON
// protocol) and feeds it the camera frames the browser uploads.  The worker is
// kept alive because loading a Cellpose model takes seconds while a frame has
// to go through the same network; starting it per frame would make the panel
// unusable.
//
// The worker is deliberately optional: the venv and the ~1.2 GB model weights
// are only present after `deno task install` has set them up, and the status
// call reports exactly what is missing instead of failing the whole server.

import { s_root_dir, s_ds } from "./runtimedata.module.js";

let s_path__script = `${s_root_dir}${s_ds}cellpose_worker.py`;
let s_path__venv = `${s_root_dir}${s_ds}venv_cellpose`;
let s_path__python = `${s_path__venv}${s_ds}bin${s_ds}python3`;
let s_path__weights = `${s_root_dir}${s_ds}weights${s_ds}cellpose`;

// 384 px: measured on a CPU, 512 px already costs three times as long for a
// small accuracy gain, and below ~300 px the cells stop being resolved at all
let N_DIM__MAX = 384;
let N_DIM__OUT = 900;
let N_MS__READY__MAX = 600000;   // a cold start also downloads the weights
let N_MS__FRAME__MAX = 900000;   // a CPU inference of one frame can take minutes
let N_CNT__LINE__MAX = 200;

let a_s_model = ['cpsam', 'cyto3'];

let o_cellpose = {
    b_running: false,        // worker process is up
    b_ready: false,          // model loaded, frames can be sent
    b_busy: false,           // one frame is being segmented right now
    s_status: 'idle',        // idle | loading | segmenting | error
    s_error: '',
    s_model: 'cpsam',
    s_version: '',
    s_device: '',
    s_device_name: '',
    n_dim: N_DIM__MAX,
    s_path_folder: '',
    o_child: null,
    n_seq__frame: 0,
    n_cnt__frame: 0,
    n_cell__last: 0,
    n_sec__last: 0,
    n_sec__load: 0,
    n_ts_ms__result: 0,
    a_s_line: [],
    o_promise__wait: null,
    f_resolve__wait: null,
    f_reject__wait: null,
    a_f_wait__ready: [],
};

let f_cellpose_line = function(s_line) {
    if(!s_line) return;
    o_cellpose.a_s_line.push(s_line);
    if(o_cellpose.a_s_line.length > N_CNT__LINE__MAX) o_cellpose.a_s_line.shift();
};

let f_cellpose_notify__ready = function(b_ready) {
    let a_f = o_cellpose.a_f_wait__ready;
    o_cellpose.a_f_wait__ready = [];
    for(let f_callback of a_f) f_callback(b_ready);
};

let f_b_path_exists = async function(s_path) {
    try {
        await Deno.stat(s_path);
        return true;
    } catch {
        return false;
    }
};

// ─── Worker lifecycle ───────────────────────────────────────────────

let f_cellpose_handle_line = function(s_line) {
    let o_msg;
    try {
        o_msg = JSON.parse(s_line);
    } catch {
        return;   // progress noise, not part of the protocol
    }

    if(o_msg.s_type === 'ready'){
        o_cellpose.b_ready = true;
        o_cellpose.s_status = 'idle';
        o_cellpose.s_version = o_msg.v_data ? (o_msg.v_data.s_version || '') : '';
        o_cellpose.s_device = o_msg.v_data ? (o_msg.v_data.s_device || '') : '';
        o_cellpose.s_device_name = o_msg.v_data ? (o_msg.v_data.s_device_name || '') : '';
        o_cellpose.n_sec__load = o_msg.v_data ? (o_msg.v_data.n_sec__load || 0) : 0;
        f_cellpose_line(`--- running on ${(o_cellpose.s_device || '?').toUpperCase()}`
            + (o_cellpose.s_device_name ? ` (${o_cellpose.s_device_name})` : '') + ' ---');
        f_cellpose_notify__ready(true);
        return;
    }

    if(o_msg.s_type === 'result'){
        o_cellpose.n_cnt__frame++;
        o_cellpose.n_cell__last = o_msg.v_data ? (o_msg.v_data.n_cell || 0) : 0;
        o_cellpose.n_sec__last = o_msg.v_data ? (o_msg.v_data.n_sec__inference || 0) : 0;
        o_cellpose.n_ts_ms__result = Date.now();
        let f_resolve = o_cellpose.f_resolve__wait;
        o_cellpose.o_promise__wait = null;
        o_cellpose.f_resolve__wait = null;
        o_cellpose.f_reject__wait = null;
        if(f_resolve) f_resolve(o_msg.v_data || {});
        return;
    }

    if(o_msg.s_type === 'error'){
        let s_error = o_msg.s_error || 'cellpose worker error';
        o_cellpose.s_error = s_error;
        f_cellpose_line(`error: ${s_error}`);
        // a failed frame must not leave the caller hanging
        if(o_cellpose.f_reject__wait){
            let f_reject = o_cellpose.f_reject__wait;
            o_cellpose.o_promise__wait = null;
            o_cellpose.f_resolve__wait = null;
            o_cellpose.f_reject__wait = null;
            f_reject(new Error(s_error));
        }
        return;
    }
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

let f_cellpose_stop = async function() {
    let o_child = o_cellpose.o_child;
    let o_writer = o_cellpose.o_writer__stdin;
    o_cellpose.o_child = null;
    o_cellpose.o_writer__stdin = null;
    o_cellpose.b_running = false;
    o_cellpose.b_ready = false;
    o_cellpose.b_busy = false;
    o_cellpose.s_status = 'idle';
    f_cellpose_notify__ready(false);

    if(o_cellpose.f_reject__wait){
        let f_reject = o_cellpose.f_reject__wait;
        o_cellpose.o_promise__wait = null;
        o_cellpose.f_resolve__wait = null;
        o_cellpose.f_reject__wait = null;
        f_reject(new Error('cellpose stopped'));
    }

    if(o_child){
        // ask the worker to leave (it answers 'stopped' and exits on its own),
        // then make sure it is gone — closing stdin directly is not allowed
        // while the writer still holds its lock
        try {
            if(o_writer){
                await o_writer.write(new TextEncoder().encode('{"s_type":"stop"}\n'));
                o_writer.releaseLock();
                // give the worker a moment to exit cleanly before forcing it
                await new Promise(function(resolve){ setTimeout(resolve, 250); });
            }
        } catch { /* worker already gone */ }
        try { o_child.kill('SIGTERM'); } catch { /* already gone */ }
    }
    f_cellpose_line('--- cellpose worker stopped ---');
    return { b_success: true, o_status: f_o_cellpose_status() };
};

// o_option: { s_model, n_dim, a_n_channel, b_gpu }
let f_o_cellpose_start = async function(o_option) {
    o_option = o_option || {};
    if(o_cellpose.b_running) await f_cellpose_stop();

    if(!await f_b_path_exists(s_path__script)){
        return { b_success: false, s_error: `cellpose_worker.py not found at ${s_path__script}` };
    }
    if(!await f_b_path_exists(s_path__python)){
        return {
            b_success: false,
            s_error: 'cellpose venv missing — run: deno task install (or: deno run -A install.js)',
        };
    }

    let s_model = a_s_model.includes(o_option.s_model) ? o_option.s_model : 'cpsam';
    let n_dim = Number(o_option.n_dim) > 0 ? Math.round(Number(o_option.n_dim)) : N_DIM__MAX;

    let o_date = new Date();
    let f_s_pad = function(n){ return String(n).padStart(2, '0'); };
    let s_name_folder = 'cellpose_'
        + o_date.getFullYear() + '-'
        + f_s_pad(o_date.getMonth() + 1) + '-'
        + f_s_pad(o_date.getDate()) + '_'
        + f_s_pad(o_date.getHours())
        + f_s_pad(o_date.getMinutes())
        + f_s_pad(o_date.getSeconds());
    let s_path_folder = `${s_root_dir}${s_ds}scans${s_ds}${s_name_folder}`;
    await Deno.mkdir(s_path_folder, { recursive: true });
    await Deno.mkdir(s_path__weights, { recursive: true });

    o_cellpose.b_running = true;
    o_cellpose.b_ready = false;
    o_cellpose.b_busy = false;
    o_cellpose.s_status = 'loading';
    o_cellpose.s_error = '';
    o_cellpose.s_model = s_model;
    o_cellpose.s_version = '';
    o_cellpose.s_device = '';
    o_cellpose.s_device_name = '';
    o_cellpose.n_dim = n_dim;
    o_cellpose.s_path_folder = s_path_folder;
    o_cellpose.a_s_line = [];
    o_cellpose.n_seq__frame = 0;
    o_cellpose.n_cnt__frame = 0;
    o_cellpose.n_cell__last = 0;
    o_cellpose.n_sec__last = 0;
    o_cellpose.n_sec__load = 0;
    o_cellpose.a_f_wait__ready = [];

    let o_command = new Deno.Command(s_path__python, {
        args: [
            s_path__script,
            '--model', s_model,
            '--dim', String(n_dim),
            '--out', s_path_folder,
            '--weights', s_path__weights,
        ],
        stdin: 'piped',
        stdout: 'piped',
        stderr: 'piped',
        env: {
            ...Deno.env.toObject(),
            CELLPOSE_LOCAL_MODELS_PATH: s_path__weights,
            PYTHONUNBUFFERED: '1',
        },
    });
    o_cellpose.o_child = o_command.spawn();

    let o_child = o_cellpose.o_child;
    f_read_stream__line(o_child.stdout, f_cellpose_handle_line).catch(function(){});
    f_read_stream__line(o_child.stderr, f_cellpose_line).catch(function(){});
    o_child.status.then(function(o_status){
        if(o_cellpose.o_child === o_child){
            o_cellpose.b_running = false;
            o_cellpose.b_ready = false;
            o_cellpose.s_status = 'error';
            if(!o_cellpose.s_error){
                o_cellpose.s_error = `cellpose_worker.py exited (code ${o_status.code})`;
            }
            f_cellpose_line(o_cellpose.s_error);
            f_cellpose_notify__ready(false);
        }
    }).catch(function(){});

    let o_stdin = o_child.stdin;
    if(!o_stdin){
        o_cellpose.s_error = 'cellpose worker has no stdin pipe';
        await f_cellpose_stop();
        return { b_success: false, s_error: o_cellpose.s_error };
    }

    try {
        let o_writer = o_stdin.getWriter();
        o_cellpose.o_writer__stdin = o_writer;
        await o_writer.write(new TextEncoder().encode(JSON.stringify({
            s_type: 'init',
            v_option: {
                s_model: s_model,
                n_dim: n_dim,
                n_dim__out: N_DIM__OUT,
                s_path_out: s_path_folder,
                s_path_weights: s_path__weights,
                a_n_channel: o_option.a_n_channel || [0, 0],
                // the worker decides from torch.cuda.is_available(); this only
                // says whether trying the GPU at all is wanted
                b_gpu: o_option.b_gpu !== false,
            },
        }) + '\n'));
    } catch(o_error){
        o_cellpose.s_error = o_error.message;
        await f_cellpose_stop();
        return { b_success: false, s_error: o_error.message };
    }

    f_cellpose_line(`--- cellpose worker started (${s_model}, ${n_dim} px) ---`);

    // the model is loaded asynchronously; wait for it so the panel can show a
    // real "loading" state instead of a first frame that silently queues up
    let b_ready = await f_cellpose_wait__ready();
    if(!b_ready && !o_cellpose.s_error){
        o_cellpose.s_error = 'cellpose model did not report ready';
        o_cellpose.s_status = 'error';
    }

    return {
        b_success: b_ready,
        s_error: o_cellpose.s_error,
        s_path_folder: s_path_folder,
        o_status: f_o_cellpose_status(),
    };
};

// resolve once the model has reported "ready" (or the worker died)
let f_cellpose_wait__ready = function(n_ms__max) {
    if(o_cellpose.b_ready) return Promise.resolve(true);
    if(!o_cellpose.b_running) return Promise.resolve(false);
    return new Promise(function(resolve){
        let n_id__timeout = setTimeout(function(){ resolve(false); }, n_ms__max || N_MS__READY__MAX);
        o_cellpose.a_f_wait__ready.push(function(b_ready){
            clearTimeout(n_id__timeout);
            resolve(b_ready === true);
        });
    });
};

// ─── Frames ─────────────────────────────────────────────────────────

// save one uploaded camera frame into the session folder
let f_s_cellpose_save_frame = async function(a_n_byte) {
    if(!o_cellpose.b_running || !o_cellpose.s_path_folder){
        throw new Error('cellpose is not running');
    }
    o_cellpose.n_seq__frame++;
    let s_name = `frame_${String(o_cellpose.n_seq__frame).padStart(5, '0')}.jpg`;
    let s_path = `${o_cellpose.s_path_folder}${s_ds}${s_name}`;
    await Deno.writeFile(s_path, a_n_byte);
    return { s_path: s_path, n_seq: o_cellpose.n_seq__frame };
};

// run one saved frame through the worker and wait for its result
let f_o_cellpose_infer = async function(n_seq, s_path_frame) {
    if(!o_cellpose.b_running || !o_cellpose.o_child || !o_cellpose.o_writer__stdin){
        return { b_success: false, s_error: 'cellpose is not running' };
    }
    if(o_cellpose.b_busy){
        return { b_success: false, s_error: 'cellpose is still segmenting the previous frame' };
    }

    o_cellpose.b_busy = true;
    o_cellpose.s_status = 'segmenting';
    o_cellpose.s_error = '';
    let n_ts_ms__start = Date.now();

    let o_promise__result = new Promise(function(resolve, reject){
        o_cellpose.f_resolve__wait = resolve;
        o_cellpose.f_reject__wait = reject;
    });

    try {
        await o_cellpose.o_writer__stdin.write(new TextEncoder().encode(JSON.stringify({
            s_type: 'frame',
            s_seq: n_seq,
            s_path_frame: s_path_frame,
        }) + '\n'));
    } catch(o_error){
        o_cellpose.o_promise__wait = null;
        o_cellpose.f_resolve__wait = null;
        o_cellpose.f_reject__wait = null;
        o_cellpose.b_busy = false;
        o_cellpose.s_status = 'error';
        o_cellpose.s_error = o_error.message;
        return { b_success: false, s_error: o_error.message };
    }

    let n_id__timeout = setTimeout(function(){
        if(o_cellpose.f_reject__wait){
            let f_reject = o_cellpose.f_reject__wait;
            o_cellpose.o_promise__wait = null;
            o_cellpose.f_resolve__wait = null;
            o_cellpose.f_reject__wait = null;
            f_reject(new Error('cellpose inference timed out'));
        }
    }, N_MS__FRAME__MAX);

    try {
        let o_meta = await o_promise__result;
        return {
            b_success: true,
            s_error: '',
            n_ms__inference: Date.now() - n_ts_ms__start,
            s_path_frame: o_meta.s_path_frame || s_path_frame,
            s_path_mask: o_meta.s_path_mask || '',
            n_scl_x: o_meta.n_scl_x || 0,
            n_scl_y: o_meta.n_scl_y || 0,
            n_cell: o_meta.n_cell || 0,
            n_area__mean: o_meta.n_area__mean || 0,
            n_area__max: o_meta.n_area__max || 0,
            n_sec__inference: o_meta.n_sec__inference || 0,
            n_dim__inference: o_meta.n_dim__inference || 0,
            s_model: o_meta.s_model || o_cellpose.s_model,
            s_device: o_meta.s_device || o_cellpose.s_device,
            s_device_name: o_meta.s_device_name || o_cellpose.s_device_name,
        };
    } catch(o_error){
        return { b_success: false, s_error: o_error.message };
    } finally {
        clearTimeout(n_id__timeout);
        o_cellpose.b_busy = false;
        if(o_cellpose.s_status !== 'error') o_cellpose.s_status = 'idle';
    }
};

let f_o_cellpose_status = function() {
    return {
        b_running: o_cellpose.b_running,
        b_ready: o_cellpose.b_ready,
        b_busy: o_cellpose.b_busy,
        s_status: o_cellpose.s_status,
        s_error: o_cellpose.s_error,
        s_model: o_cellpose.s_model,
        a_s_model: a_s_model,
        s_version: o_cellpose.s_version,
        s_device: o_cellpose.s_device,
        s_device_name: o_cellpose.s_device_name,
        n_dim: o_cellpose.n_dim,
        s_path_folder: o_cellpose.s_path_folder,
        n_cnt__frame: o_cellpose.n_cnt__frame,
        n_cell__last: o_cellpose.n_cell__last,
        n_sec__last: o_cellpose.n_sec__last,
        n_sec__load: o_cellpose.n_sec__load,
        n_ts_ms__result: o_cellpose.n_ts_ms__result,
        a_s_line: o_cellpose.a_s_line.slice(-40),
    };
};

export {
    f_o_cellpose_start,
    f_cellpose_stop,
    f_cellpose_wait__ready,
    f_o_cellpose_status,
    f_s_cellpose_save_frame,
    f_o_cellpose_infer,
    s_path__weights,
};
