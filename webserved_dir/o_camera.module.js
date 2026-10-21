import { o_state, f_save_setting } from './index.js';
import { f_o_camera_geometry_snapshot } from './camera_frame.module.js';

let a_o_camera_numeric = [
    { s_api: 'exposureTime',     s_local: 'n_time__exposure',  v_default: 0    },
    { s_api: 'colorTemperature', s_local: 'n_temperature__color', v_default: 4000 },
];

let f_o_camera_track = function() {
    let el_video = document.getElementById('webcamVideo');
    if (el_video && el_video.srcObject) {
        let a_o_track = el_video.srcObject.getVideoTracks();
        if (a_o_track.length > 0) return a_o_track[0];
    }
    return null;
};

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
    o_camera.s_device_id = o_setting.deviceId || o_state.s_id__webcam_device || '';
    o_camera.n_width = o_setting.width || 0;
    o_camera.n_height = o_setting.height || 0;
    o_camera.n_frame_rate = o_setting.frameRate || 0;
    o_camera.o_capability = o_capability;
    o_camera.o_setting = o_setting;

    o_camera.s_mode__exposure = o_setting.exposureMode;
    o_camera.s_mode__white_balance = o_setting.whiteBalanceMode;

    for (let n_idx = 0; n_idx < a_o_camera_numeric.length; n_idx++) {
        let o_item = a_o_camera_numeric[n_idx];
        o_camera[o_item.s_local] = o_setting[o_item.s_api];
    }
};

let f_b_camera_input__active = function() {
    let el_focus = document.activeElement;
    if (!el_focus || !el_focus.closest) return false;
    return !!el_focus.closest('.panel-camera-setting');
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

let f_camera_stopped = function() {
    f_stop_camera_sync();
    let o_camera = o_state.o_camera;
    o_camera.b_active = false;
    o_camera.b_loaded = false;
    o_camera.b_applying_resolution = false;
    o_camera.s_error__resolution = '';
    o_camera.o_capability = {};
    o_camera.o_setting = {};
    o_camera.o_requested = {};
    o_camera.s_error__setting = '';
};

let f_o_camera_snapshot = function() {
    let o_camera = o_state.o_camera;
    return {
        ...f_o_camera_geometry_snapshot({ videoWidth: o_camera.n_width, videoHeight: o_camera.n_height }),
        n_frame_rate: o_camera.n_frame_rate,
        s_mode__exposure: o_camera.s_mode__exposure,
        n_time__exposure: o_camera.n_time__exposure,
        s_mode__white_balance: o_camera.s_mode__white_balance,
        n_temperature__color: o_camera.n_temperature__color,
    };
};

let n_id__save_camera = 0;

let f_save_camera__debounced = function() {
    clearTimeout(n_id__save_camera);
    n_id__save_camera = setTimeout(function() {
        f_save_setting('o_camera_setting', f_o_camera_snapshot());
    }, 300);
};

let f_apply_camera_value__silent = async function(o_track, s_api, v_value) {
    let o_camera = o_state.o_camera;
    if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return false;
    o_camera.o_requested = { ...o_camera.o_requested, [s_api]: v_value };
    o_camera.s_error__setting = '';
    try {
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
        return true;
    } catch(e) {
        if (f_o_camera_track() === o_track) {
            f_read_camera();
            o_camera.s_error__setting = e.message;
        }
        return false;
    }
};

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

let f_o_saved_resolution = function(s_device_id) {
    let o_entry = o_state.a_o_setting.find(o => o.s_key === 'o_camera_resolution');
    try { return JSON.parse(o_entry?.s_value || '{}')[s_device_id] || null; }
    catch { return null; }
};

let f_b_camera_resolution_locked = function() {
    return !!(o_state.b_scanning || o_state.b_training_busy || o_state.b_training_capture_busy || o_state.o_record?.b_running ||
        o_state.o_video?.b_recording || o_state.o_video?.b_preroll || o_state.o_video?.b_burst);
};

let f_apply_camera_resolution = async function(n_width, n_height, n_frame_rate = null, b_save = true) {
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
    o_camera.b_applying_resolution = true;
    o_camera.n_ts_ms__apply = Date.now();
    try {
        let o_constraints = { ...o_track.getConstraints(),
            width: { ideal: n_width },
            height: { ideal: n_height },
        };
        if (n_frame_rate !== null && Number.isFinite(n_frame_rate) && n_frame_rate > 0) {
            o_constraints.frameRate = { ideal: n_frame_rate };
        }
        await o_track.applyConstraints(o_constraints);
        if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return false;
        f_read_camera();
        if (b_save) {
            let o_entry = o_state.a_o_setting.find(o => o.s_key === 'o_camera_resolution');
            let o_saved = {};
            try { o_saved = JSON.parse(o_entry?.s_value || '{}') || {}; } catch {}
            let s_id = o_track.getSettings().deviceId || o_state.s_id__webcam_device;
            o_saved[s_id] = { n_width: o_camera.n_width, n_height: o_camera.n_height, n_frame_rate: o_camera.n_frame_rate };
            await f_save_setting('o_camera_resolution', o_saved);
        }
        return true;
    } catch (o_error) {
        if (f_o_camera_track() === o_track) {
            o_camera.s_error__resolution = o_error.name === 'OverconstrainedError'
                ? 'This camera cannot use that resolution/FPS combination.'
                : 'Could not change resolution: ' + o_error.message;
            f_read_camera();
        }
        return false;
    } finally {
        if (f_o_camera_track() === o_track) o_camera.b_applying_resolution = false;
    }
};

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
        await f_apply_camera_resolution(o_resolution.n_width, o_resolution.n_height, o_resolution.n_frame_rate ?? null, false);
        if (f_o_camera_track() !== o_track || o_track.readyState === 'ended') return;
    }

    f_read_camera();

    if (o_capability.exposureMode && o_saved?.s_mode__exposure) {
        await f_apply_camera_value__silent(o_track, 'exposureMode', o_saved.s_mode__exposure);
    }
    if (o_capability.exposureTime && o_camera.s_mode__exposure === 'manual' && o_saved?.n_time__exposure !== undefined) {
        await f_apply_camera_value__silent(o_track, 'exposureTime', o_saved.n_time__exposure);
    }
    if (o_capability.whiteBalanceMode && o_saved?.s_mode__white_balance) {
        await f_apply_camera_value__silent(o_track, 'whiteBalanceMode', o_saved.s_mode__white_balance);
    }
    if (o_capability.colorTemperature && o_camera.s_mode__white_balance === 'manual' && o_saved?.n_temperature__color !== undefined) {
        await f_apply_camera_value__silent(o_track, 'colorTemperature', o_saved.n_temperature__color);
    }

    f_read_camera();
    f_start_camera_sync();
};

export {
    f_apply_camera_resolution,
    f_b_camera_resolution_locked,
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
