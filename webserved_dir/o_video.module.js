import { o_state } from './index.js';
import { f_o_camera_snapshot } from './o_camera.module.js';
import {
    f_server,
    f_o_crud,
    f_update_row__recording,
    f_recording_list,
} from './o_recording.module.js';

// video recording: real-time MediaRecorder capture for fast events (ciliary
// beating, flow, movement) — the complement to the frame-based time-lapse.
//
//   record   one clip, start/stop by hand
//   burst    a short clip every N minutes, until stopped
//   pre-roll keep the last N seconds in a ring buffer and save them on trigger
//
// timeslices are appended to video.webm on the server as they arrive, so a long
// recording never has to sit in browser memory.  mp4 + thumbnail are produced
// by the same ffmpeg path the time-lapse uses.

let N_MS__CHUNK = 1000;

let o_video = null;
let a_o_chunk__ring = [];

let f_o_config__default = function() {
    return {
        s_source: 'raw',        // 'raw' (camera) | 'processed' (flat-field + filter view)
        n_fps: 30,
        n_mbps: 8,
        n_sec__burst: 10,
        n_min__burst__period: 10,
        n_sec__preroll: 10,
        n_sec__postroll: 5,
        b_mp4: true,
    };
};

let f_delay = function(n_ms) {
    return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
};

let f_s_mime__best = function() {
    let a_s_mime = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4',
    ];
    if(typeof MediaRecorder === 'undefined') return '';
    for(let s_mime of a_s_mime){
        if(MediaRecorder.isTypeSupported(s_mime)) return s_mime;
    }
    return '';
};

// ─── source ─────────────────────────────────────────────────────────

// raw: the camera stream.  processed: a canvas that mirrors what the main
// window shows (flat-field + webgl filter), captured at a fixed frame rate.
let f_o_source = function(s_source, n_fps) {
    let el_video = document.getElementById('webcamVideo');
    if(!el_video || !el_video.srcObject){
        throw new Error('no camera stream');
    }
    if(s_source !== 'processed'){
        return { o_stream: el_video.srcObject, el_canvas: null, n_id__frame: 0 };
    }
    let el_canvas = document.createElement('canvas');
    el_canvas.width = el_video.videoWidth || 1280;
    el_canvas.height = el_video.videoHeight || 720;
    let o_ctx = el_canvas.getContext('2d');
    let o_state__frame = { n_id__frame: 0, b_run: true };
    let f_draw = function() {
        if(!o_state__frame.b_run) return;
        let el_filter = document.querySelector('.filter-canvas');
        let el_src = (el_filter && el_filter.offsetParent !== null) ? el_filter : el_video;
        try {
            o_ctx.drawImage(el_src, 0, 0, el_canvas.width, el_canvas.height);
        } catch (o_error) { /* a webgl canvas can refuse a copy; keep the last frame */ }
        o_state__frame.n_id__frame = requestAnimationFrame(f_draw);
    };
    o_state__frame.n_id__frame = requestAnimationFrame(f_draw);
    return {
        o_stream: el_canvas.captureStream(Math.max(1, Math.round(n_fps || 30))),
        el_canvas,
        f_destroy: function(){
            o_state__frame.b_run = false;
            cancelAnimationFrame(o_state__frame.n_id__frame);
        },
    };
};

// ─── session + clip plumbing ────────────────────────────────────────

let f_session_create = async function(s_prefix, s_kind, o_manifest) {
    let o_created = await f_server('recording_create_folder', {
        s_prefix,
        n_cnt__position: 1,
    });
    let s_path_folder = o_created.s_path_folder;
    await f_server('recording_write_manifest', { s_path_folder, o_manifest });
    let o_row = await f_o_crud('create', 'a_o_recording', {
        n_o_project_n_id: o_state.n_id__project__current || null,
        n_o_slide_n_id: o_state.n_id__slide__current || null,
        s_name: o_manifest.s_name,
        s_kind,
        s_status: 'running',
        n_ts_ms__start: o_manifest.n_ts_ms__start,
        s_path_folder,
    });
    return { s_path_folder, n_id__row: o_row.n_id };
};

let f_upload_chunk = async function(s_path_folder, s_filename, o_blob) {
    let o_buffer = await o_blob.arrayBuffer();
    let o_response = await fetch(
        '/api/recording/append_blob'
            + '?s_path_folder=' + encodeURIComponent(s_path_folder)
            + '&s_filename=' + encodeURIComponent(s_filename),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: o_buffer,
        }
    );
    if(!o_response.ok){
        throw new Error('chunk upload failed: ' + o_response.statusText);
    }
};

let f_clip_start = function(s_path_folder, s_filename, o_stream, n_mbps, f_f_on_chunk) {
    let s_mime = f_s_mime__best();
    if(!s_mime) throw new Error('this browser cannot record video');
    let o_recorder = new MediaRecorder(o_stream, {
        mimeType: s_mime,
        videoBitsPerSecond: Math.max(1, n_mbps || 8) * 1000000,
    });
    let o_clip = {
        o_recorder,
        o_stream,
        s_path_folder,
        s_filename,
        o_chain: Promise.resolve(),
        n_sz__byte: 0,
        n_chunk: 0,
        n_chunk__uploaded: 0,
        s_error: '',
        s_mime,
        f_f_on_chunk: f_f_on_chunk || null,
    };
    o_recorder.ondataavailable = function(o_evt) {
        if(!o_evt.data || o_evt.data.size === 0) return;
        o_clip.n_sz__byte += o_evt.data.size;
        o_clip.n_chunk++;
        if(o_clip.f_f_on_chunk){
            o_clip.f_f_on_chunk(o_evt.data);
            return;
        }
        let o_blob = o_evt.data;
        // one failed chunk must not kill the chain for every later chunk
        o_clip.o_chain = o_clip.o_chain.then(function(){
            return f_upload_chunk(s_path_folder, s_filename, o_blob).then(function(){
                o_clip.n_chunk__uploaded++;
            }).catch(function(o_error){
                o_clip.s_error = o_error.message || String(o_error);
                o_state.o_video.s_error = 'video upload failed: ' + o_clip.s_error;
            });
        });
    };
    o_recorder.start(N_MS__CHUNK);
    return o_clip;
};

let f_clip_stop = function(o_clip) {
    return new Promise(function(resolve){
        let f_after = function(){ resolve(); };
        o_clip.o_recorder.onstop = f_after;
        if(o_clip.o_recorder.state !== 'inactive'){
            try { o_clip.o_recorder.stop(); } catch (o_error) { f_after(); }
        } else {
            f_after();
        }
    }).then(function(){
        return o_clip.o_chain;
    });
};

// ─── state mirror ───────────────────────────────────────────────────

let f_set_status = function(s_status, s_message) {
    let o = o_state.o_video;
    o.s_status = s_status;
    if(s_message !== undefined) o.s_message = s_message;
};

let f_finalize_video = async function(s_path_folder, s_filename__src, o_manifest, n_id__row) {
    let o_video__state = o_state.o_video;
    let s_path_media = '';
    if(o_state.o_video_config.b_mp4){
        try {
            f_set_status('processing', 'encoding mp4 …');
            let o_result = await f_server('recording_remux', {
                s_path_folder,
                s_name__src: s_filename__src,
            }, 0);
            s_path_media = o_result.s_path_media;
        } catch (o_error) {
            o_manifest.a_s_warn = (o_manifest.a_s_warn || []).concat(['mp4 failed: ' + o_error.message]);
        }
    }
    o_manifest.s_status = 'done';
    o_manifest.n_ts_ms__end = Date.now();
    await f_server('recording_write_manifest', { s_path_folder, o_manifest });
    if(n_id__row){
        await f_update_row__recording(s_path_folder, {
            s_status: 'done',
            n_ts_ms__end: o_manifest.n_ts_ms__end,
            s_path_media,
        });
    }
    o_video__state.s_path_media = s_path_media;
    return s_path_media;
};

// ─── record ─────────────────────────────────────────────────────────

let f_video_record_start = async function(o_option) {
    let o_config = o_state.o_video_config;
    let o_video__state = o_state.o_video;
    if(o_video) throw new Error('video is already running');

    let o_source = f_o_source(o_config.s_source, o_config.n_fps);
    let o_manifest = {
        n_version: 1,
        s_name: o_option.s_name || ('video ' + new Date().toLocaleString()),
        s_kind: 'video',
        s_status: 'running',
        n_ts_ms__start: Date.now(),
        s_source: o_config.s_source,
        n_fps: o_config.n_fps,
        n_mbps: o_config.n_mbps,
        o_camera: f_o_camera_snapshot(),
    };
    let o_session = await f_session_create('vid_', 'video', o_manifest);
    let o_clip = f_clip_start(o_session.s_path_folder, 'video.webm', o_source.o_stream, o_config.n_mbps);

    o_video = {
        s_mode: 'record',
        o_source,
        o_clip,
        o_manifest,
        s_path_folder: o_session.s_path_folder,
        n_ts_ms__start: Date.now(),
    };
    o_video__state.b_recording = true;
    o_video__state.s_path_folder = o_session.s_path_folder;
    o_video__state.s_mime = o_clip.s_mime;
    o_video__state.n_chunk = 0;
    o_video__state.n_sz__byte = 0;
    f_set_status('recording', 'recording video');
    f_watch_clip(o_video);
    return o_session.s_path_folder;
};

let f_watch_clip = function(o_run) {
    let o_video__state = o_state.o_video;
    o_run.n_id__tick = setInterval(function(){
        if(!o_video || o_run !== o_video) return;
        o_video__state.n_sec__elapsed = Math.round((Date.now() - o_run.n_ts_ms__start) / 1000);
        o_video__state.n_sz__byte = o_run.o_clip ? o_run.o_clip.n_sz__byte : 0;
        o_video__state.n_chunk = o_run.o_clip ? o_run.o_clip.n_chunk : 0;
        o_video__state.n_chunk__uploaded = o_run.o_clip ? o_run.o_clip.n_chunk__uploaded : 0;
    }, 500);
};

let f_video_record_stop = async function() {
    if(!o_video || o_video.s_mode !== 'record') return;
    let o_run = o_video;
    let o_video__state = o_state.o_video;
    o_video = null;
    clearInterval(o_run.n_id__tick);
    // stay "recording" in the UI until the clip is safely on disk and encoded
    f_set_status('processing', 'finishing …');
    try {
        await f_clip_stop(o_run.o_clip);
        if(o_run.o_source.f_destroy) o_run.o_source.f_destroy();
        if(o_run.o_clip.n_chunk > 0 && o_run.o_clip.n_chunk__uploaded === 0){
            throw new Error('no video data reached the server — '
                + (o_run.o_clip.s_error || 'check that the app server is running the recording build'));
        }
        o_run.o_manifest.n_sec__duration = Math.round((Date.now() - o_run.n_ts_ms__start) / 1000);
        await f_finalize_video(o_run.s_path_folder, 'video.webm', o_run.o_manifest, null);
        f_set_status('done', 'video ready');
    } catch (o_error) {
        o_video__state.s_error = o_error.message || String(o_error);
        f_set_status('error', 'video failed');
        // close the manifest so the session is not left "running" on disk
        try {
            o_run.o_manifest.s_status = 'error';
            o_run.o_manifest.s_error = o_video__state.s_error;
            o_run.o_manifest.n_ts_ms__end = Date.now();
            await f_server('recording_write_manifest', {
                s_path_folder: o_run.s_path_folder,
                o_manifest: o_run.o_manifest,
            });
        } catch (o_error2) { /* the server may be the thing that is missing */ }
    } finally {
        o_video__state.b_recording = false;
        await f_recording_list__video();
    }
};

// ─── burst ──────────────────────────────────────────────────────────

let f_video_burst_start = async function(o_option) {
    let o_config = o_state.o_video_config;
    if(o_video) throw new Error('video is already running');
    o_video = {
        s_mode: 'burst',
        b_stop: false,
        n_cnt: 0,
        a_s_path: [],
    };
    o_state.o_video.b_recording = true;
    o_state.o_video.b_burst = true;
    f_set_status('burst', 'waiting for the first burst');
    f_loop_burst__();
    return true;
};

let f_loop_burst__ = async function() {
    let o_config = o_state.o_video_config;
    while(o_video && o_video.s_mode === 'burst' && !o_video.b_stop){
        try {
            o_state.o_video.s_message = 'burst ' + (o_video.n_cnt + 1);
            let s_path_folder = await f_burst_clip__();
            o_video.a_s_path.push(s_path_folder);
            o_video.n_cnt++;
        } catch (o_error) {
            o_state.o_video.s_error = o_error.message || String(o_error);
        }
        // wait for the next burst, checking stop often
        let n_ms__wait = Math.max(1, o_config.n_min__burst__period) * 60000;
        let n_ts_ms__end = Date.now() + n_ms__wait;
        while(Date.now() < n_ts_ms__end && o_video && !o_video.b_stop){
            await f_delay(500);
        }
    }
    if(o_video && o_video.s_mode === 'burst'){
        o_video = null;
        o_state.o_video.b_recording = false;
        o_state.o_video.b_burst = false;
        f_set_status('done', 'burst run stopped');
        await f_recording_list__video();
    }
};

let f_burst_clip__ = async function() {
    let o_config = o_state.o_video_config;
    let o_source = f_o_source(o_config.s_source, o_config.n_fps);
    let n_ts_ms__start = Date.now();
    let o_manifest = {
        n_version: 1,
        s_name: 'burst ' + new Date().toLocaleString(),
        s_kind: 'burst',
        s_status: 'running',
        n_ts_ms__start,
        s_source: o_config.s_source,
        n_fps: o_config.n_fps,
        n_mbps: o_config.n_mbps,
        n_sec__duration: o_config.n_sec__burst,
        o_camera: f_o_camera_snapshot(),
    };
    let o_session = await f_session_create('vid_', 'burst', o_manifest);
    let o_clip = f_clip_start(o_session.s_path_folder, 'video.webm', o_source.o_stream, o_config.n_mbps);
    let n_ts_ms__end = n_ts_ms__start + Math.max(1, o_config.n_sec__burst) * 1000;
    while(Date.now() < n_ts_ms__end && o_video && !o_video.b_stop){
        await f_delay(200);
    }
    await f_clip_stop(o_clip);
    if(o_source.f_destroy) o_source.f_destroy();
    await f_finalize_video(o_session.s_path_folder, 'video.webm', o_manifest, null);
    return o_session.s_path_folder;
};

let f_video_burst_stop = function() {
    if(o_video && o_video.s_mode === 'burst') o_video.b_stop = true;
};

// ─── pre-roll ───────────────────────────────────────────────────────

let f_video_preroll_arm = function() {
    let o_config = o_state.o_video_config;
    if(o_video) throw new Error('video is already running');
    let o_source = f_o_source(o_config.s_source, o_config.n_fps);
    let n_max = Math.max(1, Math.round(o_config.n_sec__preroll));
    let o_clip = f_clip_start('', 'ring.webm', o_source.o_stream, o_config.n_mbps, function(o_blob){
        a_o_chunk__ring.push(o_blob);
        while(a_o_chunk__ring.length > n_max) a_o_chunk__ring.shift();
        o_state.o_video.n_sec__buffered = a_o_chunk__ring.length;
    });
    o_video = { s_mode: 'preroll', o_source, o_clip, b_stop: false };
    o_state.o_video.b_recording = true;
    o_state.o_video.b_preroll = true;
    f_set_status('preroll', 'pre-roll armed');
    return true;
};

let f_video_preroll_trigger = async function() {
    if(!o_video || o_video.s_mode !== 'preroll') return;
    let o_config = o_state.o_video_config;
    let o_run = o_video;
    o_video = null;
    let o_manifest = {
        n_version: 1,
        s_name: 'pre-roll ' + new Date().toLocaleString(),
        s_kind: 'video',
        s_status: 'running',
        n_ts_ms__start: Date.now() - a_o_chunk__ring.length * N_MS__CHUNK,
        s_source: o_config.s_source,
        n_fps: o_config.n_fps,
        n_mbps: o_config.n_mbps,
        b_preroll: true,
        o_camera: f_o_camera_snapshot(),
    };
    let o_session = await f_session_create('vid_', 'video', o_manifest);
    o_state.o_video.s_path_folder = o_session.s_path_folder;

    // the buffered past first, in order, then everything still to come
    o_run.o_clip.o_chain = Promise.resolve();
    o_run.o_clip.f_f_on_chunk = function(o_blob) {
        o_run.o_clip.o_chain = o_run.o_clip.o_chain.then(function(){
            return f_upload_chunk(o_session.s_path_folder, 'video.webm', o_blob).then(function(){
                o_run.o_clip.n_chunk__uploaded++;
            }).catch(function(o_error){
                o_run.o_clip.s_error = o_error.message || String(o_error);
                o_state.o_video.s_error = 'video upload failed: ' + o_run.o_clip.s_error;
            });
        });
    };
    for(let o_blob of a_o_chunk__ring){
        try {
            await f_upload_chunk(o_session.s_path_folder, 'video.webm', o_blob);
            o_run.o_clip.n_chunk__uploaded++;
        } catch (o_error) {
            o_run.o_clip.s_error = o_error.message || String(o_error);
            o_state.o_video.s_error = 'pre-roll upload failed: ' + o_run.o_clip.s_error;
        }
    }
    a_o_chunk__ring = [];
    o_state.o_video.n_sec__buffered = 0;

    // keep recording for the post-roll, then finish
    f_set_status('recording', 'saving pre-roll + ' + o_config.n_sec__postroll + ' s');
    await f_delay(Math.max(0, o_config.n_sec__postroll) * 1000);
    await f_clip_stop(o_run.o_clip);
    if(o_run.o_source.f_destroy) o_run.o_source.f_destroy();
    o_manifest.n_sec__duration = Math.round((Date.now() - o_manifest.n_ts_ms__start) / 1000);
    await f_finalize_video(o_session.s_path_folder, 'video.webm', o_manifest, null);
    o_state.o_video.b_recording = false;
    o_state.o_video.b_preroll = false;
    f_set_status('done', 'pre-roll saved');
    await f_recording_list__video();
};

let f_video_preroll_disarm = function() {
    if(!o_video || o_video.s_mode !== 'preroll') return;
    let o_run = o_video;
    o_video = null;
    o_run.o_clip.f_f_on_chunk = null;
    f_clip_stop(o_run.o_clip).catch(function(){});
    if(o_run.o_source.f_destroy) o_run.o_source.f_destroy();
    a_o_chunk__ring = [];
    o_state.o_video.b_recording = false;
    o_state.o_video.b_preroll = false;
    o_state.o_video.n_sec__buffered = 0;
    f_set_status('idle', 'pre-roll disarmed');
};

let f_video_stop = function() {
    if(!o_video) return;
    if(o_video.s_mode === 'record') return f_video_record_stop();
    if(o_video.s_mode === 'burst') return f_video_burst_stop();
    if(o_video.s_mode === 'preroll') return f_video_preroll_disarm();
};

let f_recording_list__video = async function() {
    try {
        await f_recording_list();
    } catch (o_error) { /* the library just stays stale */ }
};

export {
    f_o_config__default as f_o_video_config__default,
    f_video_record_start,
    f_video_record_stop,
    f_video_burst_start,
    f_video_burst_stop,
    f_video_preroll_arm,
    f_video_preroll_trigger,
    f_video_preroll_disarm,
    f_video_stop,
};
