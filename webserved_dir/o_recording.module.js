import {
    o_state,
    f_send_esp_move_step,
    f_send_esp_stop,
    f_send_esp_stop_all,
    f_send_wsmsg_with_response,
    f_n_motor__axis,
} from './index.js';
import { f_o_wsmsg, o_sfunexposed__f_v_crud__indb } from './constructors.module.js';
import { f_o_capture__frame, f_save_image__recording } from './o_capture.module.js';
import { f_n_score__video, f_o_focus__fast } from './focus_search.module.js';
import { f_o_camera_snapshot, f_o_camera_track, f_set_camera_mode } from './o_camera.module.js';

// recording engine: one loop that captures a frame sequence over hours or days
// at one or many positions, keeping focus, and writing everything the analysis
// needs next to the images.
//
// the browser owns the camera, so the page must stay open for the whole run.
// everything here is therefore built to be resumable: the folder is the truth
// (manifest.json + frame.jsonl) and the DB row is only an index into it.

let N_RPM__RECORDING = 8.0;
let N_MS__MOVE_TIMEOUT = 30000;
let N_MS__TICK = 250;              // wait granularity, so stop stays responsive
let N_MS__RETRY = 1500;
let N_PX__SIGNATURE = 32;          // frame fingerprint for frozen-camera detection
let N_GB__RESERVE__DEFAULT = 2;
// rough on-disk bytes per camera pixel: png is lossless (~1.2), jpeg much less
let N_BYTE__PER_PX__PNG = 1.2;
let N_BYTE__PER_PX__JPG = 0.25;

// ─── small helpers ──────────────────────────────────────────────────

let f_delay = function(n_ms) {
    return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
};

// one request/response against the app server, error field promoted to a throw.
//
// the timeout matters: an older server build simply ignores an unknown message
// type, so without it a click on Record would wait forever with no feedback.
// pass n_ms_timeout = 0 for calls that legitimately take minutes (ffmpeg).
let N_MS__SERVER_TIMEOUT = 20000;

let f_server = async function(s_type, v_data, n_ms_timeout) {
    let n_timeout = (n_ms_timeout === undefined) ? N_MS__SERVER_TIMEOUT : n_ms_timeout;
    let o_resp;
    try {
        o_resp = await f_send_wsmsg_with_response(f_o_wsmsg(s_type, v_data), n_timeout);
    } catch (o_error) {
        throw new Error(
            s_type + ': ' + (o_error.message || String(o_error))
            + ' — is the app server running the recording build? (restart with "deno task server")'
        );
    }
    if(o_resp && o_resp.error) throw new Error(s_type + ': ' + o_resp.error);
    return o_resp ? o_resp.v_result : null;
};

let f_o_crud = async function(s_op, s_table, v_data, o_update) {
    return f_server(o_sfunexposed__f_v_crud__indb.s_name, [s_op, s_table, v_data, o_update], 0);
};

// ─── configuration ──────────────────────────────────────────────────

let f_o_config__default = function() {
    return {
        s_name: '',
        n_sec__interval: 600,
        n_its__frame: 144,
        b_position__all: false,
        a_o_position: [],
        b_autofocus: true,
        n_its__autofocus: 1,
        n_ms__settle: 400,
        b_roi: false,
        s_format: 'png',
        n_pct__quality: 92,
        b_mp4: true,
        n_fps__mp4: 10,
        n_gb__reserve: N_GB__RESERVE__DEFAULT,
        n_step__focus: 20,
        n_step__focus_max: 200,
        n_scl_x__measure: 320,
    };
};

// bytes a run is expected to write (rough, shown before start)
let f_n_sz__estimate = function(o_config, n_scl_x, n_scl_y) {
    let n_px = Math.max(1, n_scl_x * n_scl_y);
    let n_byte__px = o_config.s_format === 'jpg' ? N_BYTE__PER_PX__JPG : N_BYTE__PER_PX__PNG;
    return Math.round(o_config.n_its__frame * n_px * n_byte__px);
};

// ─── camera lock ────────────────────────────────────────────────────

// a time-lapse only compares frame to frame if the camera stops adapting
let f_recording_lock_camera = async function() {
    let a_s_warn = [];
    let o_cap = o_state.o_camera.o_capability || {};
    let o_track = f_o_camera_track();
    if(!o_track){
        a_s_warn.push('no camera track: exposure is not locked');
        return a_s_warn;
    }
    let f_b_mode = function(s_api, s_mode) {
        let v = o_cap[s_api];
        if(!v) return false;
        if(Array.isArray(v)) return v.includes(s_mode);
        return false;
    };
    if(f_b_mode('exposureMode', 'manual')){
        await f_set_camera_mode('exposureMode', 'manual');
    } else {
        a_s_warn.push('camera does not report manual exposure');
    }
    if(f_b_mode('whiteBalanceMode', 'manual')){
        await f_set_camera_mode('whiteBalanceMode', 'manual');
    } else {
        a_s_warn.push('camera does not report manual white balance');
    }
    return a_s_warn;
};

// ─── preflight ──────────────────────────────────────────────────────

let f_o_recording_preflight = async function(o_config) {
    let a_s_error = [];
    let a_s_warn = [];
    if(!o_state.b_streaming__webcam) a_s_error.push('no camera stream');
    if(!(o_config.n_sec__interval > 0)) a_s_error.push('interval must be > 0');
    if(!(o_config.n_its__frame >= 1)) a_s_error.push('frame count must be >= 1');
    if(o_config.b_autofocus && f_n_motor__axis('z') === null){
        a_s_error.push('autofocus needs a Z motor assigned in Setup');
    }
    if(o_config.b_autofocus && !o_state.b_connected__esp){
        a_s_error.push('autofocus needs the stage connected');
    }
    if(o_config.b_position__all && !o_state.b_connected__esp){
        a_s_error.push('multi-position needs the stage connected');
    }
    if(!o_state.o_calibration.n_um__per_px){
        a_s_warn.push('no scale calibration (µm/px is unknown)');
    }
    if(o_state.o_camera.b_active && o_state.o_camera.s_mode__exposure !== 'manual'){
        a_s_warn.push('camera exposure is not manual — brightness may drift');
    }
    let n_scl_x = 0;
    let n_scl_y = 0;
    if(o_config.b_roi && o_state.o_zoom.n_scl_x__roi > 0){
        n_scl_x = o_state.o_zoom.n_scl_x__roi;
        n_scl_y = o_state.o_zoom.n_scl_y__roi;
    } else {
        let el_video = document.getElementById('webcamVideo');
        n_scl_x = el_video ? el_video.videoWidth : 0;
        n_scl_y = el_video ? el_video.videoHeight : 0;
    }
    let n_sz__est = f_n_sz__estimate(o_config, n_scl_x, n_scl_y);
    let o_disk = null;
    try {
        o_disk = await f_recording_status();
    } catch (o_error) {
        a_s_error.push(o_error.message || String(o_error));
    }
    if(o_disk && o_disk.n_free__byte !== null){
        let n_sz__reserve = o_config.n_gb__reserve * 1024 * 1024 * 1024;
        if(o_disk.n_free__byte - n_sz__est < n_sz__reserve){
            a_s_error.push('not enough disk space for the estimate plus the reserve');
        }
    }
    return {
        a_s_error,
        a_s_warn,
        n_sz__est__byte: n_sz__est,
        n_scl_x,
        n_scl_y,
        o_disk,
    };
};

// ─── frame validation ───────────────────────────────────────────────

// a tiny fingerprint of the current frame: mean luma + a coarse hash
let f_o_frame__signature = function() {
    let el_video = document.getElementById('webcamVideo');
    if(!el_video || el_video.readyState < 2) return null;
    let o_cache = f_o_frame__signature;
    if(!o_cache._el_canvas) o_cache._el_canvas = document.createElement('canvas');
    let el_canvas = o_cache._el_canvas;
    if(el_canvas.width !== N_PX__SIGNATURE || el_canvas.height !== N_PX__SIGNATURE){
        el_canvas.width = N_PX__SIGNATURE;
        el_canvas.height = N_PX__SIGNATURE;
    }
    let o_ctx = el_canvas.getContext('2d', { willReadFrequently: true });
    o_ctx.drawImage(el_video, 0, 0, N_PX__SIGNATURE, N_PX__SIGNATURE);
    let a_n_byte = o_ctx.getImageData(0, 0, N_PX__SIGNATURE, N_PX__SIGNATURE).data;
    let n_sum = 0;
    let a_s_part = [];
    for(let n_idx = 0; n_idx < N_PX__SIGNATURE * N_PX__SIGNATURE; n_idx++){
        let n_luma = a_n_byte[n_idx * 4 + 1];
        n_sum += n_luma;
        a_s_part.push(n_luma >> 3);
    }
    return {
        n_luma: n_sum / (N_PX__SIGNATURE * N_PX__SIGNATURE),
        s_hash: a_s_part.join(','),
    };
};

let f_o_frame__check = function(o_signature, o_signature__prev) {
    let a_s_warn = [];
    if(!o_signature) return a_s_warn;
    if(o_signature.n_luma < 1.5) a_s_warn.push('frame is black');
    if(o_signature.n_luma > 250) a_s_warn.push('frame is blown out');
    if(o_signature__prev && o_signature.s_hash === o_signature__prev.s_hash){
        a_s_warn.push('frame is identical to the previous one (camera frozen?)');
    }
    return a_s_warn;
};

// ─── motion ─────────────────────────────────────────────────────────

let f_o_move__axis = async function(s_axis, n_target) {
    let n_motor = f_n_motor__axis(s_axis);
    if(n_motor === null) return;
    let n_step = Math.round(n_target - o_state.a_o_motor[n_motor].n_position);
    if(n_step === 0) return;
    let o_move = f_send_esp_move_step(n_motor, n_step, N_RPM__RECORDING);
    let o_timeout = new Promise(function(resolve){ setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT); });
    let v_result = await Promise.race([o_move, o_timeout]);
    if(v_result === 'timeout'){
        f_send_esp_stop(n_motor);
        throw new Error('move timeout on ' + s_axis);
    }
};

let f_move_to__position = async function(o_position) {
    if(o_position.n_x__stage !== null && o_position.n_x__stage !== undefined){
        await f_o_move__axis('x', o_position.n_x__stage);
    }
    if(o_position.n_y__stage !== null && o_position.n_y__stage !== undefined){
        await f_o_move__axis('y', o_position.n_y__stage);
    }
};

// ─── autofocus ──────────────────────────────────────────────────────

let f_o_focus__once = async function(o_config, f_b_abort) {
    if(!o_state.b_connected__esp) return { n_score: 0, n_step: 0, b_skipped: true };
    let o_cache = {};
    let n_motor = f_n_motor__axis('z');
    let o_result = await f_o_focus__fast({
        f_move: async function(n_step){
            if(n_step === 0) return;
            let o_move = f_send_esp_move_step(n_motor, n_step, N_RPM__RECORDING);
            let o_timeout = new Promise(function(resolve){ setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT); });
            let v_result = await Promise.race([o_move, o_timeout]);
            if(v_result === 'timeout'){ f_send_esp_stop(n_motor); throw new Error('focus move timeout'); }
        },
        f_delay: f_delay,
        f_n_score: async function(){
            return f_n_score__video(
                document.getElementById('webcamVideo'),
                {
                    n_scl_x__measure: o_config.n_scl_x__measure,
                    n_pct__roi: 60,
                    s_metric: 'tenengrad',
                },
                o_cache
            );
        },
        f_b_abort: f_b_abort,
    }, {
        n_step: Math.max(1, Math.round(o_config.n_step__focus)),
        n_step__max: Math.max(
            o_config.n_step__focus,
            Math.round(o_config.n_step__focus_max)
        ),
        n_ms__settle: Math.max(0, o_config.n_ms__settle),
    });
    return {
        n_score: o_result.n_score__best,
        n_score__start: o_result.n_score__start,
        n_step: o_result.n_step__best,
        n_cnt__measure: o_result.n_cnt__measure,
        b_skipped: false,
    };
};

// ─── status / library ───────────────────────────────────────────────

let f_recording_status = async function() {
    return f_server('recording_status', {});
};

// quick capability check: is the connected server a build that knows the
// recording messages at all?  (an older build simply ignores them, so without
// this the first click on Record would just time out)
let f_b_recording__server = async function() {
    try {
        await f_server('recording_status', {}, 4000);
        return true;
    } catch (o_error) {
        return false;
    }
};

let f_recording_list = async function() {
    let o_result = await f_server('recording_list', {});
    let a_o_recording = (o_result && o_result.a_o_recording) || [];
    o_state.o_record.a_o_recording = a_o_recording;
    return a_o_recording;
};

let f_recording_delete = async function(s_path_folder) {
    return f_server('recording_delete', { s_path_folder });
};

let f_recording_probe_camera = async function() {
    let o_result = await f_server('recording_probe_camera', {});
    o_state.o_record.o_camera__probe = o_result;
    return o_result;
};

let f_recording_encode = async function(o_option) {
    let o_record = o_state.o_record;
    o_record.b_encoding = true;
    o_record.s_message = 'encoding mp4 …';
    try {
        let o_result = await f_server('recording_encode', {
            s_path_folder: o_option.s_path_folder,
            n_fps: o_option.n_fps,
        }, 0);
        o_record.s_path_media = (o_result && o_result.a_o_media && o_result.a_o_media[0])
            ? o_result.a_o_media[0].s_path_media
            : '';
        o_record.s_message = 'mp4 ready';
        return o_result;
    } finally {
        o_record.b_encoding = false;
    }
};

// export a session's frame sequence as an OME-TIFF (Fiji / napari ready)
let f_recording_export_tiff = async function(o_option) {
    let o_record = o_state.o_record;
    o_record.b_encoding = true;
    o_record.s_message = 'exporting OME-TIFF …';
    try {
        let o_result = await f_server('recording_tiff', {
            s_path_folder: o_option.s_path_folder,
            s_pos: o_option.s_pos || 'pos_00',
            s_name__out: o_option.s_name__out,
            n_sec__interval: o_option.n_sec__interval || 0,
            n_um__per_px: o_option.n_um__per_px || 0,
        }, 0);
        o_record.s_message = 'OME-TIFF ready';
        return o_result;
    } finally {
        o_record.b_encoding = false;
    }
};

// ─── run control ────────────────────────────────────────────────────

let o_run = null;

let f_recording_b_running = function() {
    return !!o_run;
};

let f_recording_pause = function() {
    if(o_run) o_run.b_pause = true;
};

let f_recording_continue = function() {
    if(o_run) o_run.b_pause = false;
};

let f_recording_stop = function() {
    if(o_run) o_run.b_stop = true;
    f_send_esp_stop_all();
};

let f_wait_until = async function(n_ts_ms__target, f_b_abort) {
    while(true){
        if(f_b_abort()) return;
        let n_ms = n_ts_ms__target - Date.now();
        if(n_ms <= 0) return;
        await f_delay(Math.min(N_MS__TICK, n_ms));
    }
};

// keep the screen awake for the length of a run (best effort; a hidden tab
// still gets its timers throttled, which absolute scheduling absorbs)
let f_wake_lock__request = async function() {
    try {
        if(!navigator.wakeLock || o_state.o_record.b_wake_lock) return;
        let o_sentinel = await navigator.wakeLock.request('screen');
        f_wake_lock__request._o_sentinel = o_sentinel;
        o_state.o_record.b_wake_lock = true;
        o_sentinel.addEventListener('release', function(){
            o_state.o_record.b_wake_lock = false;
        });
    } catch (o_error) {
        o_state.o_record.b_wake_lock = false;
    }
};

let f_wake_lock__release = async function() {
    let o_sentinel = f_wake_lock__request._o_sentinel;
    f_wake_lock__request._o_sentinel = null;
    if(o_sentinel){
        try { await o_sentinel.release(); } catch (o_error) { /* already gone */ }
    }
    o_state.o_record.b_wake_lock = false;
};

let f_on_visibility = function() {
    if(o_run && document.visibilityState === 'visible') f_wake_lock__request().catch(function(){});
};

// the one loop.  o_run carries everything the iteration needs.
let f_run_session = async function(o_run__session) {
    let o_record = o_state.o_record;
    let o_config = o_run__session.o_config;
    let a_o_position = o_run__session.a_o_position;
    let s_path_folder = o_run__session.s_path_folder;
    let b_jpg = o_config.s_format === 'jpg';
    let s_ext = b_jpg ? '.jpg' : '.png';
    let s_type = b_jpg ? 'image/jpeg' : 'image/png';

    let n_ts_ms__start = Date.now();
    let n_idx__base = o_run__session.n_idx__base || 0;
    let n_idx__frame = n_idx__base;
    let o_signature__prev = null;
    let n_ts_ms__disk = 0;
    o_run = o_run__session;

    o_record.b_running = true;
    o_record.b_pause = false;
    o_record.s_status = 'running';
    o_record.s_error = '';
    o_record.s_message = 'recording';
    o_record.n_its__frame = o_config.n_its__frame;
    o_record.n_its__frame__done = n_idx__frame;
    o_record.n_ts_ms__start = n_ts_ms__start;
    o_record.n_ts_ms__next = n_ts_ms__start;
    o_state.b_scanning = true;   // stand the jog handlers down while a run is live
    await f_wake_lock__request();
    document.addEventListener('visibilitychange', f_on_visibility);

    o_run__session.n_ts_ms__start = n_ts_ms__start;
    o_run__session.n_idx__base = n_idx__base;

    try {
        while(n_idx__frame - n_idx__base < o_config.n_its__frame){
            if(o_run.b_stop) break;

            // absolute schedule: lateness never accumulates, and sleeping
            // through a target is recorded as a gap rather than hidden
            let n_ts_ms__target = n_ts_ms__start
                + (n_idx__frame - n_idx__base) * o_config.n_sec__interval * 1000;
            o_record.n_ts_ms__next = n_ts_ms__target;
            await f_wait_until(n_ts_ms__target, function(){ return !o_run || o_run.b_stop; });
            if(o_run.b_stop) break;

            while(o_run.b_pause && !o_run.b_stop){
                await f_delay(N_MS__TICK);
            }
            if(o_run.b_stop) break;

            let n_ms__late = Date.now() - n_ts_ms__target;
            if(n_ms__late > o_config.n_sec__interval * 1000){
                await f_event__log(o_run, 'gap',
                    'frame ' + (n_idx__frame + 1) + ' captured ' + Math.round(n_ms__late / 1000) + ' s late');
                o_record.s_message = 'recovering from a gap';
            }

            // ── one timepoint over every position ──────────────────
            for(let n_idx__position = 0; n_idx__position < a_o_position.length; n_idx__position++){
                if(o_run.b_stop) break;
                let o_position = a_o_position[n_idx__position];
                o_record.n_idx__position = n_idx__position;
                o_record.n_its__position = a_o_position.length;

                if(o_config.b_position__all && a_o_position.length > 1){
                    o_record.s_message = 'moving to ' + o_position.s_label;
                    await f_move_to__position(o_position);
                    if(o_config.n_ms__settle) await f_delay(o_config.n_ms__settle);
                }

                let o_focus = { n_score: 0, n_step: 0, b_skipped: true };
                let b_focus_due = o_config.b_autofocus
                    && ((n_idx__frame - n_idx__base) % Math.max(1, Math.round(o_config.n_its__autofocus)) === 0);
                if(b_focus_due){
                    o_record.s_message = 'autofocus ' + o_position.s_label;
                    try {
                        o_focus = await f_o_focus__once(o_config, function(){ return !o_run || o_run.b_stop; });
                    } catch (o_error) {
                        await f_event__log(o_run, 'focus_error', o_error.message);
                        o_record.s_message = 'autofocus failed';
                    }
                }

                o_record.s_message = 'capturing ' + o_position.s_label;

                // ── capture, with one retry if the frame looks broken ──
                let o_frame = null;
                for(let n_try = 0; n_try < 2; n_try++){
                    if(o_run.b_stop) break;
                    let o_signature = f_o_frame__signature();
                    let a_s_warn = f_o_frame__check(o_signature, o_signature__prev);
                    if(a_s_warn.length > 0 && n_try === 0){
                        await f_event__log(o_run, 'frame_warn', a_s_warn.join('; '));
                        await f_delay(N_MS__RETRY);
                        continue;
                    }

                    let o_roi = (o_config.b_roi && o_state.o_zoom.n_scl_x__roi > 0) ? {
                        n_x: o_state.o_zoom.n_x__roi,
                        n_y: o_state.o_zoom.n_y__roi,
                        n_scl_x: o_state.o_zoom.n_scl_x__roi,
                        n_scl_y: o_state.o_zoom.n_scl_y__roi,
                    } : null;
                    let o_cap = await f_o_capture__frame({
                        o_roi: o_roi,
                        s_type: s_type,
                        n_quality: b_jpg ? o_config.n_pct__quality / 100 : undefined,
                    });

                    let s_name__file = 't_' + String(n_idx__frame + 1).padStart(6, '0') + s_ext;
                    let s_path__position = s_path_folder + '/pos_' + String(n_idx__position).padStart(2, '0');
                    await f_save_image__recording(o_cap.o_blob, s_path__position, s_name__file);

                    o_frame = {
                        n_idx: n_idx__frame + 1,
                        n_ts_ms: Date.now(),
                        n_ts_ms__target: n_ts_ms__target,
                        n_idx__position: n_idx__position,
                        s_label__position: o_position.s_label,
                        n_x__stage: o_state.a_o_motor[f_n_motor__axis('x')].n_position,
                        n_y__stage: o_state.a_o_motor[f_n_motor__axis('y')].n_position,
                        n_z__stage: o_state.a_o_motor[f_n_motor__axis('z')]?.n_position ?? null,
                        n_score__focus: o_focus.n_score,
                        n_scl_x: o_cap.n_scl_x,
                        n_scl_y: o_cap.n_scl_y,
                        s_file: 'pos_' + String(n_idx__position).padStart(2, '0') + '/' + s_name__file,
                    };
                    await f_server('recording_append_frame', { s_path_folder, o_frame });
                    o_signature__prev = o_signature;
                    break;
                }
                if(o_frame){
                    o_record.o_frame__last = o_frame;
                }
                n_idx__frame++;
            }

            o_record.n_its__frame__done = n_idx__frame;

            // disk guard, at most once a minute
            if(Date.now() - n_ts_ms__disk > 60000){
                n_ts_ms__disk = Date.now();
                try {
                    let o_disk = await f_recording_status();
                    if(o_disk){
                        o_record.n_free__byte = o_disk.n_free__byte;
                        let n_reserve = o_config.n_gb__reserve * 1024 * 1024 * 1024;
                        if(o_disk.n_free__byte !== null && o_disk.n_free__byte < n_reserve){
                            await f_event__log(o_run, 'disk', 'stopped below the disk reserve');
                            o_run.s_error = 'stopped: free disk below the reserve';
                            break;
                        }
                    }
                } catch (o_error) {
                    await f_event__log(o_run, 'disk_error', o_error.message);
                }
            }
        }

        o_record.s_status = o_run.s_error ? 'error' : (o_run.b_stop ? 'stopped' : 'done');
        o_record.s_error = o_run.s_error || '';
        o_record.s_message = o_record.s_status;
    } catch (o_error) {
        o_run.s_error = o_error.message || String(o_error);
        o_record.s_status = 'error';
        o_record.s_error = o_run.s_error;
        o_record.s_message = 'error';
        await f_event__log(o_run, 'error', o_run.s_error);
    } finally {
        f_send_esp_stop_all();
        o_state.b_scanning = false;
        document.removeEventListener('visibilitychange', f_on_visibility);
        await f_wake_lock__release();
        o_record.b_running = false;
        o_record.b_pause = false;
        o_record.n_its__frame__done = n_idx__frame;

        // close the manifest and the DB row
        let o_manifest = o_run.o_manifest || {};
        o_manifest.s_status = o_state.o_record.s_status;
        o_manifest.n_its__frame__done = n_idx__frame - n_idx__base;
        o_manifest.n_ts_ms__end = Date.now();
        o_manifest.s_error = o_run.s_error || '';
        await f_server('recording_write_manifest', { s_path_folder, o_manifest }).catch(function(){});
        await f_update_row__recording(s_path_folder, {
            s_status: o_manifest.s_status,
            n_its__frame__done: n_idx__frame,
            n_ts_ms__end: o_manifest.n_ts_ms__end,
            s_error: o_run.s_error || '',
        });

        if(o_config.b_mp4 && o_manifest.s_status === 'done'){
            try {
                o_record.s_message = 'encoding mp4 …';
                await f_recording_encode({ s_path_folder, n_fps: o_config.n_fps__mp4 });
                await f_update_row__recording(s_path_folder, { s_path_media: o_state.o_record.s_path_media });
            } catch (o_error) {
                await f_event__log(o_run, 'encode_error', o_error.message);
                o_record.s_message = 'recording done, mp4 failed';
            }
        }

        o_run = null;
        f_recording_list().catch(function(){});
    }
};

let f_update_row__recording = async function(s_path_folder, o_update) {
    try {
        let a_o_row = await f_o_crud('read', 'a_o_recording', { s_path_folder });
        if(a_o_row && a_o_row.length > 0){
            // update() validates the whole instance, and SQLite hands booleans
            // back as 0/1 — normalise before handing the row back
            let o_row = Object.assign({}, a_o_row[0]);
            for(let s_key of ['b_autofocus', 'b_position__all']){
                if(o_row[s_key] !== null && o_row[s_key] !== undefined) o_row[s_key] = !!o_row[s_key];
            }
            await f_o_crud('update', 'a_o_recording', o_row, o_update);
        }
    } catch (o_error) {
        console.warn('recording row update failed:', o_error);
    }
};

let f_event__log = async function(o_run__session, s_kind, s_message) {
    let o_event = {
        s_kind,
        s_message,
        n_ts_ms: Date.now(),
    };
    try {
        await f_server('recording_append_frame', {
            s_path_folder: o_run__session.s_path_folder,
            o_frame: o_event,
            s_file: 'event.jsonl',
        });
    } catch (o_error) {
        console.warn('recording event log failed:', o_error);
    }
};

// ─── start / resume ─────────────────────────────────────────────────

let f_o_position__current = function(s_label) {
    return {
        s_label: s_label || 'current',
        n_x__stage: o_state.a_o_motor[f_n_motor__axis('x')].n_position,
        n_y__stage: o_state.a_o_motor[f_n_motor__axis('y')].n_position,
        n_z__stage: o_state.a_o_motor[f_n_motor__axis('z')]?.n_position ?? null,
    };
};

let f_recording_start = async function(o_config, a_o_position) {
    let o_record = o_state.o_record;
    if(o_run) throw new Error('a recording is already running');

    let o_check = await f_o_recording_preflight(o_config);
    if(o_check.a_s_error.length > 0) throw new Error(o_check.a_s_error.join('; '));

    let a_o_position__used = (o_config.b_position__all && a_o_position && a_o_position.length > 0)
        ? a_o_position
        : [f_o_position__current('current')];

    // lock the camera before the first frame (warn, never fail)
    let a_s_warn__camera = await f_recording_lock_camera();

    let o_created = await f_server('recording_create_folder', {
        s_prefix: 'rec_',
        n_cnt__position: a_o_position__used.length,
    });
    let s_path_folder = o_created.s_path_folder;

    let s_name = o_config.s_name || ('recording ' + new Date().toLocaleString());
    let o_manifest = {
        n_version: 1,
        s_name,
        s_kind: 'timelapse',
        s_status: 'running',
        n_ts_ms__start: Date.now(),
        n_sec__interval: o_config.n_sec__interval,
        n_its__frame: o_config.n_its__frame,
        n_its__autofocus: o_config.n_its__autofocus,
        n_ms__settle: o_config.n_ms__settle,
        b_autofocus: o_config.b_autofocus,
        b_position__all: o_config.b_position__all,
        b_roi: o_config.b_roi,
        o_roi: o_config.b_roi ? {
            n_x: o_state.o_zoom.n_x__roi,
            n_y: o_state.o_zoom.n_y__roi,
            n_scl_x: o_state.o_zoom.n_scl_x__roi,
            n_scl_y: o_state.o_zoom.n_scl_y__roi,
        } : null,
        s_format: o_config.s_format,
        n_um__per_px: o_state.o_calibration.n_um__per_px || 0,
        o_camera: f_o_camera_snapshot(),
        a_o_position: a_o_position__used,
        a_s_warn: a_s_warn__camera,
    };
    await f_server('recording_write_manifest', { s_path_folder, o_manifest });

    // DB index row + one row per position
    let o_row = await f_o_crud('create', 'a_o_recording', {
        n_o_project_n_id: o_state.n_id__project__current || null,
        n_o_slide_n_id: o_state.n_id__slide__current || null,
        s_name,
        s_kind: 'timelapse',
        s_status: 'running',
        n_sec__interval: o_config.n_sec__interval,
        n_its__frame: o_config.n_its__frame,
        n_its__frame__done: 0,
        n_its__autofocus: o_config.n_its__autofocus,
        n_ms__settle: o_config.n_ms__settle,
        b_autofocus: !!o_config.b_autofocus,
        b_position__all: !!o_config.b_position__all,
        n_x__roi: o_manifest.o_roi ? o_manifest.o_roi.n_x : null,
        n_y__roi: o_manifest.o_roi ? o_manifest.o_roi.n_y : null,
        n_scl_x__roi: o_manifest.o_roi ? o_manifest.o_roi.n_scl_x : null,
        n_scl_y__roi: o_manifest.o_roi ? o_manifest.o_roi.n_scl_y : null,
        n_um__per_px: o_manifest.n_um__per_px,
        s_path_folder,
        n_ts_ms__start: o_manifest.n_ts_ms__start,
    });
    for(let o_position of a_o_position__used){
        await f_o_crud('create', 'a_o_recording_position', {
            n_o_recording_n_id: o_row.n_id,
            s_label: o_position.s_label,
            n_x__stage: o_position.n_x__stage,
            n_y__stage: o_position.n_y__stage,
            n_z__stage: o_position.n_z__stage,
        });
    }

    o_record.s_path_folder = s_path_folder;
    o_record.s_path_media = '';
    o_record.a_s_warn = a_s_warn__camera;

    return f_run_session({
        o_config,
        a_o_position: a_o_position__used,
        s_path_folder,
        o_manifest,
        n_idx__base: 0,
    });
};

// continue an interrupted session: the folder is the truth
let f_recording_resume = async function(s_path_folder) {
    if(o_run) throw new Error('a recording is already running');
    let o_manifest = await f_server('recording_read_manifest', { s_path_folder }).catch(function(){ return null; });
    let a_o_frame = (await f_server('recording_read_frame', { s_path_folder })).a_o_frame || [];
    let n_idx__base = 0;
    for(let o_frame of a_o_frame){
        if(o_frame.n_idx > n_idx__base) n_idx__base = o_frame.n_idx;
    }
    let o_config = Object.assign(f_o_config__default(), {
        s_name: o_manifest ? o_manifest.s_name : '',
        n_sec__interval: o_manifest ? o_manifest.n_sec__interval : 600,
        n_its__frame: o_manifest ? o_manifest.n_its__frame : 0,
        n_its__autofocus: o_manifest ? o_manifest.n_its__autofocus : 1,
        n_ms__settle: o_manifest ? o_manifest.n_ms__settle : 400,
        b_autofocus: o_manifest ? !!o_manifest.b_autofocus : false,
        b_position__all: o_manifest ? !!o_manifest.b_position__all : false,
        b_roi: o_manifest ? !!o_manifest.b_roi : false,
        s_format: o_manifest ? o_manifest.s_format : 'png',
    });
    let a_o_position = (o_manifest && o_manifest.a_o_position) || [f_o_position__current('current')];
    if(o_config.n_its__frame <= n_idx__base){
        throw new Error('session is already complete');
    }
    o_state.o_record.s_path_folder = s_path_folder;
    await f_recording_write_manifest__status(s_path_folder, o_manifest, 'running');
    return f_run_session({
        o_config,
        a_o_position,
        s_path_folder,
        o_manifest,
        n_idx__base,
    });
};

// keep the manifest in step without needing the whole object to be resaved
let f_recording_write_manifest__status = async function(s_path_folder, o_manifest, s_status) {
    o_manifest.s_status = s_status;
    await f_server('recording_write_manifest', { s_path_folder, o_manifest });
};

export {
    f_o_config__default,
    f_n_sz__estimate,
    f_o_recording_preflight,
    f_recording_lock_camera,
    f_recording_start,
    f_recording_resume,
    f_recording_pause,
    f_recording_continue,
    f_recording_stop,
    f_recording_b_running,
    f_recording_status,
    f_b_recording__server,
    f_recording_list,
    f_recording_delete,
    f_recording_encode,
    f_recording_export_tiff,
    f_recording_probe_camera,
    f_o_position__current,
    f_server,
    f_o_crud,
    f_update_row__recording,
};
