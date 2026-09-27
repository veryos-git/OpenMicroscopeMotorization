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
    { s_api: 'gain',                 s_local: 'n_gain',                    v_default: 0 },
    { s_api: 'zoom',                 s_local: 'n_zoom',                    v_default: 1 },
];

// always-on numeric setting that is applied from the saved setting
let a_s_api__always = ['brightness', 'contrast', 'saturation', 'sharpness', 'zoom', 'gain'];

// ISO and driver-specific gain are different controls; never substitute gain for ISO.
let f_s_key__iso = function(o_capability) {
    if (o_capability && o_capability.iso) return 'iso';
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

    o_camera.b_active = o_track.readyState !== 'ended';
    o_camera.s_label = o_track.label || 'Camera';
    o_camera.n_width = o_setting.width || 0;
    o_camera.n_height = o_setting.height || 0;
    o_camera.n_frame_rate = o_setting.frameRate || 0;
    o_camera.o_capability = o_capability;
    o_camera.o_setting = o_setting;

    o_camera.s_mode__exposure = o_setting.exposureMode;
    o_camera.s_mode__white_balance = o_setting.whiteBalanceMode;
    o_camera.s_mode__focus = o_setting.focusMode;

    for (let n_idx = 0; n_idx < a_o_camera_numeric.length; n_idx++) {
        let o_item = a_o_camera_numeric[n_idx];
        o_camera[o_item.s_local] = o_setting[o_item.s_api];
    }
    o_camera.n_iso = o_setting.iso;
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
    o_camera.b_applying_resolution = false;
    o_camera.s_error__resolution = '';
    o_camera.o_capability = {};
    o_camera.o_setting = {};
    o_camera.o_requested_format = null;
    o_camera.o_requested = {};
    o_camera.s_error__setting = '';
};

let f_o_camera_snapshot = function() {
    let o_camera = o_state.o_camera;
    return {
        n_width: o_camera.n_width,
        n_height: o_camera.n_height,
        n_frame_rate: o_camera.n_frame_rate,
        s_mode__exposure: o_camera.s_mode__exposure,
        n_time__exposure: o_camera.n_time__exposure,
        n_iso: o_camera.n_iso,
        n_gain: o_camera.n_gain,
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

// Image Capture controls use advanced constraints for browser compatibility.
// These may be ignored, so successful resolution of the promise is not proof.
let f_apply_camera_value__silent = async function(o_track, s_api, v_value) {
    let o_camera = o_state.o_camera;
    if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return false;
    o_camera.o_requested = { ...o_camera.o_requested, [s_api]: v_value };
    o_camera.s_error__setting = '';
    try {
        let o_cap = o_track.getCapabilities?.()[s_api];
        if (!o_cap) throw new Error(s_api + ' is unavailable on this device/browser.');
        if (Array.isArray(o_cap) ? !o_cap.includes(v_value) :
            !Number.isFinite(v_value) || v_value < o_cap.min || v_value > o_cap.max ||
            (o_cap.step > 0 && Math.abs((v_value - o_cap.min) / o_cap.step - Math.round((v_value - o_cap.min) / o_cap.step)) > 1e-6)) {
            throw new Error('Requested ' + s_api + ' is outside the reported range or step.');
        }
        let o_existing = o_track.getConstraints();
        delete o_existing[s_api];
        await o_track.applyConstraints({ ...o_existing, advanced: [
            ...(o_existing.advanced || []).map(function(o) {
                let o_copy = { ...o };
                delete o_copy[s_api];
                return o_copy;
            }), { [s_api]: v_value },
        ] });
        if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return false;
        f_read_camera();
        let v_actual = o_camera.o_setting[s_api];
        if (v_actual !== v_value) {
            throw new Error(s_api + ': requested ' + v_value + ', active ' +
                (v_actual ?? 'unreported') + '. The device did not confirm the request.');
        }
        return true;
    } catch(e) {
        if (f_o_camera_track() === o_track) {
            f_read_camera();
            o_camera.s_error__setting = e.message;
        }
        return false;
    }
};

// Serialize hardware requests so sliders and mode changes cannot race.
let o_pending_setting = Promise.resolve();
let f_apply_camera_setting = function(s_api, v_value) {
    let o_track = f_o_camera_track();
    o_pending_setting = o_pending_setting.then(async function() {
        if (!o_track || f_o_camera_track() !== o_track) return false;
        o_state.o_camera.n_ts_ms__apply = Date.now();
        let b_applied = await f_apply_camera_value__silent(o_track, s_api, v_value);
        if (b_applied) f_save_camera__debounced();
        return b_applied;
    });
    return o_pending_setting;
};

let f_set_camera_mode = f_apply_camera_setting;

// Store resolution separately for each camera; other UVC settings retain their
// existing persistence. Capabilities report ranges, not a list of native modes.
let f_o_saved_resolution = function(s_device_id) {
    let o_entry = o_state.a_o_setting.find(o => o.s_key === 'o_camera_resolution');
    try { return JSON.parse(o_entry?.s_value || '{}')[s_device_id] || null; }
    catch { return null; }
};

let f_b_camera_resolution_locked = function() {
    return !!(o_state.b_scanning || o_state.o_record?.b_running ||
        o_state.o_video?.b_recording || o_state.o_video?.b_preroll || o_state.o_video?.b_burst);
};

let f_apply_camera_resolution = async function(n_width, n_height, b_maximum = false, b_save = true, n_frame_rate = null) {
    let o_track = f_o_camera_track();
    let o_camera = o_state.o_camera;
    if (!o_track || o_camera.b_applying_resolution) return false;
    o_camera.s_error__resolution = '';
    if (f_b_camera_resolution_locked()) {
        o_camera.s_error__resolution = 'Stop scanning or recording before changing resolution.';
        return false;
    }
    if (![n_width, n_height].every(n => Number.isInteger(n) && n > 0)) {
        o_camera.s_error__resolution = 'Enter a positive whole number for width and height.';
        return false;
    }
    if (n_frame_rate !== null && (!Number.isFinite(n_frame_rate) || n_frame_rate <= 0 || !o_camera.o_capability.frameRate)) {
        o_camera.s_error__resolution = 'Enter a positive FPS value supported by this device/browser.';
        return false;
    }
    for (let [s_api, n_value] of [['width', n_width], ['height', n_height], ['frameRate', n_frame_rate]]) {
        if (n_value === null || (b_maximum && s_api !== 'frameRate')) continue;
        let o_range = o_camera.o_capability[s_api];
        if (o_range && (n_value < o_range.min || n_value > o_range.max ||
            (o_range.step > 0 && Math.abs((n_value - o_range.min) / o_range.step - Math.round((n_value - o_range.min) / o_range.step)) > 1e-6))) {
            o_camera.s_error__resolution = s_api + ' is outside the reported range or step.';
            return false;
        }
    }
    o_camera.o_requested_format = { n_width, n_height, n_frame_rate, b_maximum };
    o_camera.b_applying_resolution = true;
    o_camera.n_ts_ms__apply = Date.now();
    try {
        let o_constraints = { ...o_track.getConstraints(),
            width: { [b_maximum ? 'ideal' : 'exact']: n_width },
            height: { [b_maximum ? 'ideal' : 'exact']: n_height },
        };
        if (n_frame_rate !== null) o_constraints.frameRate = { exact: n_frame_rate };
        if (o_camera.o_capability.resizeMode?.includes('none')) {
            o_constraints.resizeMode = { exact: 'none' };
        }
        await o_track.applyConstraints(o_constraints);
        if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return false;
        f_read_camera();
        if ((!b_maximum && (o_camera.n_width !== n_width || o_camera.n_height !== n_height)) ||
            (n_frame_rate !== null && Math.abs(o_camera.n_frame_rate - n_frame_rate) > 0.001)) {
            throw new Error('The device did not confirm the requested resolution/FPS. See active values.');
        }
        if (b_save) {
            let o_entry = o_state.a_o_setting.find(o => o.s_key === 'o_camera_resolution');
            let o_saved = {};
            try { o_saved = JSON.parse(o_entry?.s_value || '{}') || {}; } catch {}
            let s_id = o_track.getSettings().deviceId || o_state.s_id__webcam_device;
            o_saved[s_id] = { n_width: o_camera.n_width, n_height: o_camera.n_height, ...(n_frame_rate !== null ? { n_frame_rate: o_camera.n_frame_rate } : {}) };
            await f_save_setting('o_camera_resolution', o_saved);
        }
        return true;
    } catch (o_error) {
        if (f_o_camera_track() === o_track) {
            o_camera.s_error__resolution = o_error.name === 'OverconstrainedError'
                ? 'This camera cannot use that resolution/FPS combination. Try another size or frame rate.'
                : 'Could not change resolution: ' + o_error.message;
            f_read_camera();
        }
        return false;
    } finally {
        if (f_o_camera_track() === o_track) o_camera.b_applying_resolution = false;
    }
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
    try { o_capability = o_track.getCapabilities(); } catch(e) {}
    o_camera.b_active = true;
    o_camera.o_capability = o_capability;
    o_camera.b_loaded = true;
    o_camera.n_ts_ms__apply = Date.now();

    let o_saved = null;
    let o_entry = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_camera_setting'; });
    if (o_entry) {
        try { o_saved = JSON.parse(o_entry.s_value); } catch(e) {}
    }

    let o_resolution = f_o_saved_resolution(o_track.getSettings().deviceId || o_state.s_id__webcam_device);
    if (o_resolution) {
        await f_apply_camera_resolution(o_resolution.n_width, o_resolution.n_height, false, false, o_resolution.n_frame_rate ?? null);
        if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return;
    }

    f_read_camera();

    // modes first — exposure time, ISO and focus distance only mean something
    // in the matching manual mode
    if (o_capability.exposureMode && o_saved?.s_mode__exposure) {
        o_camera.s_mode__exposure = (o_saved && o_saved.s_mode__exposure) || 'manual';
        await f_apply_camera_value__silent(o_track, 'exposureMode', o_camera.s_mode__exposure);
    }
    if (o_capability.whiteBalanceMode && o_saved?.s_mode__white_balance) {
        o_camera.s_mode__white_balance = (o_saved && o_saved.s_mode__white_balance) || 'continuous';
        await f_apply_camera_value__silent(o_track, 'whiteBalanceMode', o_camera.s_mode__white_balance);
    }
    if (o_capability.focusMode && o_saved?.s_mode__focus) {
        o_camera.s_mode__focus = (o_saved && o_saved.s_mode__focus) || 'continuous';
        await f_apply_camera_value__silent(o_track, 'focusMode', o_camera.s_mode__focus);
    }

    let b_manual__exposure = !o_capability.exposureMode || o_camera.s_mode__exposure === 'manual';
    if (b_manual__exposure) {
        if (o_capability.exposureTime && o_saved && o_saved.n_time__exposure !== undefined) {
            await f_apply_camera_value__silent(o_track, 'exposureTime', o_saved.n_time__exposure);
        }
        let s_key__iso = f_s_key__iso(o_capability);
        if (s_key__iso && o_saved && o_saved.n_iso !== undefined) {
            await f_apply_camera_value__silent(o_track, s_key__iso, o_saved.n_iso);
        }
    }
    if (o_capability.exposureCompensation && !b_manual__exposure && o_saved && o_saved.n_compensation__exposure !== undefined) {
        await f_apply_camera_value__silent(o_track, 'exposureCompensation', o_saved.n_compensation__exposure);
    }
    if (o_capability.colorTemperature && o_camera.s_mode__white_balance === 'manual' && o_saved && o_saved.n_temperature__color !== undefined) {
        await f_apply_camera_value__silent(o_track, 'colorTemperature', o_saved.n_temperature__color);
    }
    if (o_capability.focusDistance && o_camera.s_mode__focus === 'manual' && o_saved && o_saved.n_distance__focus !== undefined) {
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
    f_apply_camera_resolution,
    f_b_camera_resolution_locked,
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
