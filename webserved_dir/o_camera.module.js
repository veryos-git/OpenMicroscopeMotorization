import { o_state, f_save_setting } from './index.js';
import { f_o_camera_geometry_snapshot } from './camera_frame.module.js';

let f_o_camera_track = function() {
    return document.getElementById('webcamVideo')?.srcObject?.getVideoTracks()[0] || null;
};

// false once the stream was switched or stopped while an async apply was pending
let f_b_camera_track__current = function(o_track) {
    return f_o_camera_track() === o_track && o_track.readyState !== 'ended';
};

let f_v_setting__saved = function(s_key) {
    try { return JSON.parse(o_state.a_o_setting.find(o => o.s_key === s_key)?.s_value ?? 'null'); }
    catch { return null; }
};

// the v4l2 controls the Camera window offers. the browser camera api has no access to them,
// so they exist only where the server reaches the camera with v4l2-ctl (linux)
let a_o_camera_control = [
    { s_name: 'gain', s_label: 'ISO', s_tooltip: 'Gain (ISO)\nAmplifies the sensor signal: brighter, but noisier. For a still specimen keep it low and lengthen the exposure instead.' },
];

// this camera as the server sees it through v4l2 (camera_functions.module.js): { s_path, a_o_mode, a_o_control }.
// null when the server does not know it: the Camera window then offers a generic resolution list and no v4l2 control.
let f_o_camera_device = async function(s_label) {
    try {
        let a_o_device = await (await fetch('/api/camera/device')).json();
        // the browser labels a camera 'HY-500B (0ac8:3420)', v4l2 names the same one 'HAYEAR_AUDIO: HY-500B'
        let s_name = s_label.replace(/ \([0-9a-f]{4}:[0-9a-f]{4}\)$/, '');
        return a_o_device.find(o => o.s_name.includes(s_name)) || (a_o_device.length === 1 ? a_o_device[0] : null);
    } catch { return null; }
};

// o_camera.a_o_control: the offered controls this camera has, with their live range and value
let f_set_camera_control = function(a_o_control__device) {
    o_state.o_camera.a_o_control = a_o_camera_control.flatMap(function(o_control) {
        let o_control__device = a_o_control__device.find(o => o.s_name === o_control.s_name);
        return o_control__device ? [{ ...o_control, ...o_control__device }] : [];
    });
};

// mirror the live track into o_state.o_camera
let f_read_camera = function() {
    let o_camera = o_state.o_camera;
    let o_track = f_o_camera_track();
    if (!o_track) {
        o_camera.b_active = false;
        o_camera.o_capability = {};
        return;
    }
    let o_setting = o_track.getSettings();
    o_camera.b_active = o_track.readyState !== 'ended';
    o_camera.o_capability = o_track.getCapabilities?.() || {};
    o_camera.s_device_id = o_setting.deviceId || o_state.s_id__webcam_device || '';
    o_camera.n_width = o_setting.width || 0;
    o_camera.n_height = o_setting.height || 0;
    o_camera.n_frame_rate = o_setting.frameRate || 0;
    o_camera.s_mode__exposure = o_setting.exposureMode;
    o_camera.s_mode__white_balance = o_setting.whiteBalanceMode;
    o_camera.n_time__exposure = o_setting.exposureTime;
    o_camera.n_temperature__color = o_setting.colorTemperature;
};

// auto modes change the values on their own, so the mirror is refreshed every
// second - but not right after an apply or while the user edits the panel
let n_id__camera_sync = 0;
let f_sync_camera = function() {
    if (Date.now() - o_state.o_camera.n_ts_ms__apply < 700) return;
    if (document.activeElement?.closest?.('.camera-setting-stack')) return;
    f_read_camera();
};

let f_camera_stopped = function() {
    clearInterval(n_id__camera_sync);
    Object.assign(o_state.o_camera, {
        b_active: false,
        b_loaded: false,
        b_applying_resolution: false,
        s_error__resolution: '',
        s_error__setting: '',
        o_capability: {},
        s_path__device: '',
        a_o_mode: [],
        a_o_control: [],
    });
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
        o_control: Object.fromEntries(o_camera.a_o_control.map(o => [o.s_name, o.n_val])),
    };
};

// the setting is saved 300ms after the last change
let n_id__save_camera = 0;
let f_save_camera__debounced = function() {
    clearTimeout(n_id__save_camera);
    n_id__save_camera = setTimeout(function() {
        f_save_setting('o_camera_setting', f_o_camera_snapshot());
    }, 300);
};

// apply one UVC control (exposureMode, exposureTime, whiteBalanceMode, colorTemperature)
let f_b_apply_camera_value = async function(o_track, s_api, v_value) {
    let o_camera = o_state.o_camera;
    if (!f_b_camera_track__current(o_track)) return false;
    o_camera.s_error__setting = '';
    let s_error = '';
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
    } catch (o_error) {
        s_error = o_error.message;
    }
    if (!f_b_camera_track__current(o_track)) return false;
    f_read_camera();
    o_camera.s_error__setting = s_error;
    return !s_error;
};

// applies run one after another
let o_promise__setting = Promise.resolve();
let f_apply_camera_setting = function(s_api, v_value) {
    let o_track = f_o_camera_track();
    o_promise__setting = o_promise__setting.then(async function() {
        if (!o_track) return false;
        o_state.o_camera.n_ts_ms__apply = Date.now();
        let b_applied = await f_b_apply_camera_value(o_track, s_api, v_value);
        if (b_applied) f_save_camera__debounced();
        return b_applied;
    });
    return o_promise__setting;
};

// apply one v4l2 control (a_o_camera_control) on the server
let f_apply_camera_control = async function(s_name, n_val, b_save = true) {
    let o_camera = o_state.o_camera;
    o_camera.s_error__setting = '';
    try {
        let o_response = await fetch('/api/camera/control', { method: 'POST', body: JSON.stringify({ s_path: o_camera.s_path__device, s_name, n_val }) });
        if (!o_response.ok) throw new Error(await o_response.text());
        f_set_camera_control(await o_response.json());
        if (b_save) f_save_camera__debounced();
        return true;
    } catch (o_error) {
        o_camera.s_error__setting = o_error.message;
        return false;
    }
};

// switches the sensor itself to that size: 'exact' with resizeMode 'none' forbids the browser to
// keep another sensor mode and scale it, which it otherwise does without telling.
// the resolution is saved per camera device: { [s_device_id]: { n_width, n_height, n_frame_rate } }
let f_apply_camera_resolution = async function(n_scl_x, n_scl_y, n_frame_rate = null, b_save = true) {
    let o_track = f_o_camera_track();
    let o_camera = o_state.o_camera;
    if (!o_track || o_camera.b_applying_resolution) return false;
    o_camera.s_error__resolution = '';
    if (o_state.b_scanning || o_state.b_training_busy || o_state.b_training_capture_busy || o_state.o_record?.b_running ||
        o_state.o_video?.b_recording || o_state.o_video?.b_preroll || o_state.o_video?.b_burst) {
        o_camera.s_error__resolution = 'Stop scanning or recording before changing resolution.';
        return false;
    }
    if (![n_scl_x, n_scl_y].every(n => Number.isInteger(n) && n > 0)) {
        o_camera.s_error__resolution = 'Enter a positive whole number for width and height.';
        return false;
    }
    o_camera.b_applying_resolution = true;
    o_camera.n_ts_ms__apply = Date.now();
    try {
        let o_constraint = { ...o_track.getConstraints(), width: { exact: n_scl_x }, height: { exact: n_scl_y }, resizeMode: { exact: 'none' } };
        if (n_frame_rate > 0) o_constraint.frameRate = { ideal: n_frame_rate };
        await o_track.applyConstraints(o_constraint);
        if (!f_b_camera_track__current(o_track)) return false;
        f_read_camera();
        if (b_save) {
            await f_save_setting('o_camera_resolution', {
                ...f_v_setting__saved('o_camera_resolution'),
                [o_camera.s_device_id]: { n_width: o_camera.n_width, n_height: o_camera.n_height, n_frame_rate: o_camera.n_frame_rate },
            });
        }
        return true;
    } catch (o_error) {
        if (f_b_camera_track__current(o_track)) {
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

// push the saved resolution and controls onto a freshly opened track (once per stream)
let f_apply_camera__saved = async function() {
    let o_camera = o_state.o_camera;
    let o_track = f_o_camera_track();
    if (!o_track) {
        o_camera.b_active = false;
        return;
    }
    if (o_camera.b_loaded) return;
    o_camera.b_loaded = true;
    o_camera.n_ts_ms__apply = Date.now();
    f_read_camera();

    let o_device = await f_o_camera_device(o_track.label);
    if (!f_b_camera_track__current(o_track)) return;
    o_camera.s_path__device = o_device?.s_path || '';
    o_camera.a_o_mode = o_device?.a_o_mode || [];
    f_set_camera_control(o_device?.a_o_control || []);

    let o_resolution = f_v_setting__saved('o_camera_resolution')?.[o_camera.s_device_id];
    if (o_resolution) {
        // a size saved before the list held only real sensor sizes may not exist: keep the open one, no error
        let b_applied = await f_apply_camera_resolution(o_resolution.n_width, o_resolution.n_height, o_resolution.n_frame_rate ?? null, false);
        if (!f_b_camera_track__current(o_track)) return;
        if (!b_applied) o_camera.s_error__resolution = '';
    }

    let o_saved = f_v_setting__saved('o_camera_setting') || {};
    let o_capability = o_camera.o_capability;
    if (o_capability.exposureMode && o_saved.s_mode__exposure) {
        await f_b_apply_camera_value(o_track, 'exposureMode', o_saved.s_mode__exposure);
    }
    if (o_capability.exposureTime && o_camera.s_mode__exposure === 'manual' && o_saved.n_time__exposure !== undefined) {
        await f_b_apply_camera_value(o_track, 'exposureTime', o_saved.n_time__exposure);
    }
    if (o_capability.whiteBalanceMode && o_saved.s_mode__white_balance) {
        await f_b_apply_camera_value(o_track, 'whiteBalanceMode', o_saved.s_mode__white_balance);
    }
    if (o_capability.colorTemperature && o_camera.s_mode__white_balance === 'manual' && o_saved.n_temperature__color !== undefined) {
        await f_b_apply_camera_value(o_track, 'colorTemperature', o_saved.n_temperature__color);
    }

    for (let o_control of o_camera.a_o_control) {
        let n_val = o_saved.o_control?.[o_control.s_name];
        if (Number.isInteger(n_val) && n_val !== o_control.n_val) await f_apply_camera_control(o_control.s_name, n_val, false);
    }

    clearInterval(n_id__camera_sync);
    n_id__camera_sync = setInterval(f_sync_camera, 1000);
};

export {
    f_apply_camera_resolution,
    f_o_camera_track,
    f_read_camera,
    f_camera_stopped,
    f_o_camera_snapshot,
    f_apply_camera_setting,
    f_apply_camera_control,
    f_apply_camera__saved,
};
