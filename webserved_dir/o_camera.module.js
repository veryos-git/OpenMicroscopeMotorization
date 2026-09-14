import { o_state, f_save_setting } from './index.js';

// ─── USB (UVC) camera hardware settings ─────────────────────────────
// Every value lives in o_state.o_camera (see index.js) so the toolbar quick
// bar and the Camera panel render the same numbers. This module only holds the
// functions that read the live track, apply constraints and persist the values.
//
// Note: this module is imported by components, so it must not touch o_state at
// module load time (index.js -> component -> this file -> index.js is circular
// while index.js is still evaluating).

// numeric API setting: s_api is the constraint name, s_local the o_camera key,
// v_default the fallback when the camera does not report a value.
let a_o_camera_numeric = [
    { s_api: 'exposureTime',         s_local: 'n_time__exposure',         v_default: 0 },
    { s_api: 'exposureCompensation', s_local: 'n_compensation__exposure', v_default: 0 },
    { s_api: 'colorTemperature',     s_local: 'n_temperature__color',      v_default: 4000 },
    { s_api: 'focusDistance',        s_local: 'n_distance__focus',         v_default: 0 },
    { s_api: 'brightness',           s_local: 'n_brightness',              v_default: 128 },
    { s_api: 'contrast',             s_local: 'n_contrast',                v_default: 128 },
    { s_api: 'saturation',           s_local: 'n_saturation',              v_default: 128 },
    { s_api: 'sharpness',            s_local: 'n_sharpness',               v_default: 128 },
    { s_api: 'zoom',                 s_local: 'n_zoom',                    v_default: 1 },
];

// always-on numeric setting that is applied from the saved setting
let a_s_api__always = ['brightness', 'contrast', 'saturation', 'sharpness', 'zoom'];

// ISO is not part of the standard Media Capture constraint set; cameras that
// expose it use either 'iso' or 'gain'. Return whichever key exists.
let f_s_key__iso = function(o_capability) {
    if (o_capability && o_capability.iso) return 'iso';
    if (o_capability && o_capability.gain) return 'gain';
    return '';
};

let f_o_camera_track = function() {
    let el_video = document.getElementById('webcamVideo');
    if (el_video && el_video.srcObject) {
        let a_o_track = el_video.srcObject.getVideoTracks();
        if (a_o_track.length > 0) return a_o_track[0];
    }
    return null;
};

// read capabilities + current values into o_state.o_camera (no constraints applied)
let f_read_camera = function() {
    let o_camera = o_state.o_camera;
    let o_track = f_o_camera_track();
    if (!o_track) {
        o_camera.b_active = false;
        o_camera.o_capability = {};
        return;
    }
    let o_capability = {};
    let o_setting = {};
    try { o_capability = o_track.getCapabilities(); } catch(e) { console.warn('getCapabilities not supported', e); }
    try { o_setting = o_track.getSettings(); } catch(e) {}

    o_camera.b_active = true;
    o_camera.o_capability = o_capability;

    if (o_capability.exposureMode && o_setting.exposureMode) o_camera.s_mode__exposure = o_setting.exposureMode;
    if (o_capability.whiteBalanceMode && o_setting.whiteBalanceMode) o_camera.s_mode__white_balance = o_setting.whiteBalanceMode;
    if (o_capability.focusMode && o_setting.focusMode) o_camera.s_mode__focus = o_setting.focusMode;

    for (let n_idx = 0; n_idx < a_o_camera_numeric.length; n_idx++) {
        let o_item = a_o_camera_numeric[n_idx];
        if (o_capability[o_item.s_api] && o_setting[o_item.s_api] !== undefined) {
            o_camera[o_item.s_local] = o_setting[o_item.s_api];
        }
    }
    let s_key__iso = f_s_key__iso(o_capability);
    if (s_key__iso && o_setting[s_key__iso] !== undefined) o_camera.n_iso = o_setting[s_key__iso];
};

// reflect values the hardware changed on its own (auto exposure / auto white
// balance). Skipped for a moment after a local apply and while the user is
// typing in a camera input, so the shown numbers never fight the user.
let f_b_camera_input__active = function() {
    let el_focus = document.activeElement;
    if (!el_focus || !el_focus.closest) return false;
    return !!el_focus.closest('.toolbar-row--camera, .panel-camera-setting');
};

let f_sync_camera = function() {
    let o_camera = o_state.o_camera;
    if (Date.now() - o_camera.n_ts_ms__apply < 700) return;
    if (f_b_camera_input__active()) return;
    f_read_camera();
};

let n_id__camera_sync = 0;

let f_start_camera_sync = function() {
    f_stop_camera_sync();
    n_id__camera_sync = setInterval(f_sync_camera, 1000);
};

let f_stop_camera_sync = function() {
    if (n_id__camera_sync) {
        clearInterval(n_id__camera_sync);
        n_id__camera_sync = 0;
    }
};

// reset everything that belongs to the stream that just ended
let f_camera_stopped = function() {
    f_stop_camera_sync();
    let o_camera = o_state.o_camera;
    o_camera.b_active = false;
    o_camera.b_loaded = false;
    o_camera.o_capability = {};
};

let f_o_camera_snapshot = function() {
    let o_camera = o_state.o_camera;
    return {
        s_mode__exposure: o_camera.s_mode__exposure,
        n_time__exposure: o_camera.n_time__exposure,
        n_iso: o_camera.n_iso,
        n_compensation__exposure: o_camera.n_compensation__exposure,
        s_mode__white_balance: o_camera.s_mode__white_balance,
        n_temperature__color: o_camera.n_temperature__color,
        s_mode__focus: o_camera.s_mode__focus,
        n_distance__focus: o_camera.n_distance__focus,
        n_brightness: o_camera.n_brightness,
        n_contrast: o_camera.n_contrast,
        n_saturation: o_camera.n_saturation,
        n_sharpness: o_camera.n_sharpness,
        n_zoom: o_camera.n_zoom,
    };
};

// own debounce so a camera drag never swallows another setting's save
let n_id__save_camera = 0;

let f_save_camera__debounced = function() {
    clearTimeout(n_id__save_camera);
    n_id__save_camera = setTimeout(function() {
        f_save_setting('o_camera_setting', f_o_camera_snapshot());
    }, 300);
};

let f_apply_camera_value__silent = async function(o_track, s_api, v_value) {
    try {
        let o_constraint = {};
        o_constraint[s_api] = v_value;
        await o_track.applyConstraints({ advanced: [o_constraint] });
    } catch(e) {
        console.warn('Failed to apply camera setting:', s_api, v_value, e);
    }
};

let f_apply_camera_setting = async function(s_api, v_value) {
    let o_track = f_o_camera_track();
    if (!o_track) return;
    o_state.o_camera.n_ts_ms__apply = Date.now();
    await f_apply_camera_value__silent(o_track, s_api, v_value);
    f_save_camera__debounced();
};

let f_set_camera_mode = async function(s_api, s_value) {
    let o_camera = o_state.o_camera;
    let o_track = f_o_camera_track();
    if (!o_track) return;
    o_camera.n_ts_ms__apply = Date.now();
    if (s_api === 'exposureMode') o_camera.s_mode__exposure = s_value;
    if (s_api === 'whiteBalanceMode') o_camera.s_mode__white_balance = s_value;
    if (s_api === 'focusMode') o_camera.s_mode__focus = s_value;
    await f_apply_camera_value__silent(o_track, s_api, s_value);
    f_save_camera__debounced();
};

// load the persisted camera setting and push it onto the track that just
// started, then read back whatever the camera actually accepted.
let f_apply_camera__saved = async function() {
    let o_camera = o_state.o_camera;
    let o_track = f_o_camera_track();
    if (!o_track) {
        o_camera.b_active = false;
        return;
    }
    if (o_camera.b_loaded) return;

    let o_capability = {};
    try { o_capability = o_track.getCapabilities(); } catch(e) { return; }
    o_camera.b_active = true;
    o_camera.o_capability = o_capability;
    o_camera.b_loaded = true;
    o_camera.n_ts_ms__apply = Date.now();

    let o_saved = null;
    let o_entry = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_camera_setting'; });
    if (o_entry) {
        try { o_saved = JSON.parse(o_entry.s_value); } catch(e) {}
    }

    // modes first — exposure time, ISO and focus distance only mean something
    // in the matching manual mode
    if (o_capability.exposureMode) {
        o_camera.s_mode__exposure = (o_saved && o_saved.s_mode__exposure) || 'manual';
        await f_apply_camera_value__silent(o_track, 'exposureMode', o_camera.s_mode__exposure);
    }
    if (o_capability.whiteBalanceMode) {
        o_camera.s_mode__white_balance = (o_saved && o_saved.s_mode__white_balance) || 'continuous';
        await f_apply_camera_value__silent(o_track, 'whiteBalanceMode', o_camera.s_mode__white_balance);
    }
    if (o_capability.focusMode) {
        o_camera.s_mode__focus = (o_saved && o_saved.s_mode__focus) || 'continuous';
        await f_apply_camera_value__silent(o_track, 'focusMode', o_camera.s_mode__focus);
    }

    let b_manual__exposure = !o_capability.exposureMode || o_camera.s_mode__exposure === 'manual';
    if (b_manual__exposure) {
        if (o_capability.exposureTime && o_saved && o_saved.n_time__exposure) {
            await f_apply_camera_value__silent(o_track, 'exposureTime', o_saved.n_time__exposure);
        }
        let s_key__iso = f_s_key__iso(o_capability);
        if (s_key__iso && o_saved && o_saved.n_iso) {
            await f_apply_camera_value__silent(o_track, s_key__iso, o_saved.n_iso);
        }
    }
    if (o_capability.exposureCompensation && !b_manual__exposure && o_saved && o_saved.n_compensation__exposure !== undefined) {
        await f_apply_camera_value__silent(o_track, 'exposureCompensation', o_saved.n_compensation__exposure);
    }
    if (o_capability.colorTemperature && o_camera.s_mode__white_balance === 'manual' && o_saved && o_saved.n_temperature__color) {
        await f_apply_camera_value__silent(o_track, 'colorTemperature', o_saved.n_temperature__color);
    }
    if (o_capability.focusDistance && o_camera.s_mode__focus === 'manual' && o_saved && o_saved.n_distance__focus) {
        await f_apply_camera_value__silent(o_track, 'focusDistance', o_saved.n_distance__focus);
    }
    if (o_saved) {
        for (let n_idx = 0; n_idx < a_s_api__always.length; n_idx++) {
            let s_api = a_s_api__always[n_idx];
            let o_item = a_o_camera_numeric.find(function(o){ return o.s_api === s_api; });
            if (o_capability[s_api] && o_saved[o_item.s_local] !== undefined) {
                await f_apply_camera_value__silent(o_track, s_api, o_saved[o_item.s_local]);
            }
        }
    }

    f_read_camera();
    f_start_camera_sync();
};

export {
    f_s_key__iso,
    f_o_camera_track,
    f_read_camera,
    f_sync_camera,
    f_start_camera_sync,
    f_stop_camera_sync,
    f_camera_stopped,
    f_o_camera_snapshot,
    f_save_camera__debounced,
    f_apply_camera_setting,
    f_set_camera_mode,
    f_apply_camera__saved,
};
