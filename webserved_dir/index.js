import { createApp, reactive, watch, markRaw } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import {
    a_o_model,
    f_o_toast,
    f_s_name_table__from_o_model,
    o_sfunexposed__f_v_crud__indb,
    a_o_sfunexposed,
    f_o_wsmsg
} from './constructors.module.js';

import { o_component__toolbar } from './o_component__toolbar.js';
import { o_component__webcam } from './o_component__webcam.js';
import { o_component__jog } from './o_component__jog.js';
import { o_component__map } from './o_component__map.js';
import { o_component__motion } from './o_component__motion.js';
import { o_component__optics } from './o_component__optics.js';
import { o_component__motor } from './o_component__motor.js';
import { o_component__scan } from './o_component__scan.js';
import { o_component__camera_setting } from './o_component__camera_setting.js';
import { o_component__manual_stitch } from './o_component__manual_stitch.js';
import { o_component__macro } from './o_component__macro.js';
import { o_component__auto_move } from './o_component__auto_move.js';
import { o_component__autostitch } from './o_component__autostitch.js';
import { o_component__filter, f_o_filter__default } from './o_component__filter.js';
import { o_component__flat_field } from './o_component__flat_field.js';
import { o_component__focus } from './o_component__focus.js';
import { o_component__focus_stack } from './o_component__focus_stack.js';
import { o_component__backlash } from './o_component__backlash.js';
import { o_component__slide_library } from './o_component__slide_library.js';
import { o_component__page_setup } from './o_component__page_setup.js';
import { o_component__page_control } from './o_component__page_control.js';
import { o_component__stats } from './o_component__stats.js';

// ─── Statistics (client-side, derived from the ESP status stream) ──

let f_o_motor__stat = function() {
    return {
        n_step__since_halt: 0,   // steps driven since the motor last halted (trip odometer)
        n_step__last_run: 0,     // steps driven in the most recently completed run
        n_step__session: 0,      // total steps driven since connect
        n_ms__run_since_halt: 0, // motor on-time since the last halt
        n_ms__run_session: 0,    // total motor on-time since connect
        n_cnt__halt: 0,          // number of halts (stop / move complete)
        n_cnt__reversal: 0,      // number of direction reversals
        n_rpm__max: 0,           // peak rpm observed
        n_position__prev: 0,     // previous position (for step-delta tracking)
        n_ts_ms__run_start: 0,   // timestamp when the current run started
        s_direction__prev: '',   // previous direction (for reversal detection)
        b_running__prev: false,  // previous running state (for halt detection)
        b_position__init: false, // first position sample must not count as steps
    };
};

// ─── Global reactive state ─────────────────────────────────────────

let o_state = reactive({
    // app server connection
    b_connected__server: false,

    // DB-backed data
    a_o_setting: [],
    a_o_wsclient: [],
    a_o_model,

    // project / slide library (current selection, in-memory)
    n_id__project__current: 0,
    n_id__slide__current: 0,

    // ESP32 connection
    s_ip__esp: '',
    b_connected__esp: false,
    s_transport__esp: '',       // 'serial' | 'ws' | '' (empty = disconnected)
    b_available__serial: (typeof navigator !== 'undefined') && ('serial' in navigator),
    s_port__esp: '',            // USB serial port path/name when connected via Web Serial

    // motor state from ESP32 status messages
    a_o_motor: [
        { n_rpm: 0, s_direction: 'cw', b_running: false, n_position: 0, s_mode: 'idle', n_step__remaining: 0, n_step__backlash: 0, b_compensating: false },
        { n_rpm: 0, s_direction: 'cw', b_running: false, n_position: 0, s_mode: 'idle', n_step__remaining: 0, n_step__backlash: 0, b_compensating: false },
        { n_rpm: 0, s_direction: 'cw', b_running: false, n_position: 0, s_mode: 'idle', n_step__remaining: 0, n_step__backlash: 0, b_compensating: false },
        { n_rpm: 0, s_direction: 'cw', b_running: false, n_position: 0, s_mode: 'idle', n_step__remaining: 0, n_step__backlash: 0, b_compensating: false },
    ],

    // statistics overlay (per-motor odometer / run-time counters)
    a_o_motor__stat: [
        f_o_motor__stat(),
        f_o_motor__stat(),
        f_o_motor__stat(),
    ],
    o_stat__session: {
        n_ts_ms__start: Date.now(),
        n_step__session: 0,
        n_ms__run_session: 0,
        n_cnt__halt: 0,
    },

    // jog settings
    n_rpm__jog: 5.0,
    o_mapping__w: { s_motor: '1', s_dir: 'cw' },
    o_mapping__s: { s_motor: '1', s_dir: 'ccw' },
    o_mapping__a: { s_motor: '0', s_dir: 'ccw' },
    o_mapping__d: { s_motor: '0', s_dir: 'cw' },
    o_mapping__q: { s_motor: '2', s_dir: 'ccw' },
    o_mapping__e: { s_motor: '2', s_dir: 'cw' },
    // right mouse button: z axis, s_dir is the direction above the image center
    o_mapping__mouse_right: { s_motor: '2', s_dir: 'cw' },

    // mouse jog (on by default, motors only run while the left button is held)
    b_enabled__mouse_jog: true,

    // image filter (webgl processing of the webcam image)
    o_filter: f_o_filter__default(),

    // flat-field ("dust remove") correction — metadata only; the heavy pixel
    // buffers live in o_flatfield.module.js outside the reactive proxy.
    o_flat_field: {
        b_active: false,
        b_loaded: false,
        s_path_flat: '',
        n_scl_x: 0,
        n_scl_y: 0,
        a_n_mean__channel: [0, 0, 0],
        n_ms__created: 0,
        o_camera__flat: null,
    },

    // live slide-map localizer
    b_running__locate: false,
    // selected map for localization, shared between the Map panel and the toolbar
    s_path_map__current: '',
    // scanned map files listed by the server (locate_list_maps), merged with the
    // DB-linked maps for the current slide
    a_o_map__scanned: [],

    // UI
    o_panel_visibility: { map: false, motion: false, optics: false, slide_library: false, jog: true, motors: true, scan: false, camera_setting: false, manual_stitch: false, macro: false, auto_move: false, autostitch: false, filter: false, flat: false, focus: false, focus_stack: false, backlash: false, stats: false },
    o_key_held: {},

    // scan
    b_scanning: false,

    // backlash compensation (per motor)
    a_n_step__backlash: [0, 0, 0],
    // calibrated steps per camera pixel (per motor), written by the backlash run
    a_n_step__per_px: [0, 0, 0],

    // webcam
    s_id__webcam_device: '',
    a_o_device__webcam: [],
    b_streaming__webcam: false,

    // USB (UVC) camera hardware settings — one shared object so the toolbar
    // quick bar and the Camera panel always show the same numbers.
    // o_capability mirrors track.getCapabilities(), the rest mirror track.getSettings().
    o_camera: {
        b_active: false,
        b_loaded: false,            // saved setting already applied to the current stream
        n_ts_ms__apply: 0,          // last local apply (pauses the value sync briefly)
        o_capability: {},
        s_mode__exposure: 'manual',
        s_mode__white_balance: 'continuous',
        s_mode__focus: 'continuous',
        n_time__exposure: 0,
        n_iso: 0,
        n_compensation__exposure: 0,
        n_temperature__color: 4000,
        n_distance__focus: 0,
        n_brightness: 128,
        n_contrast: 128,
        n_saturation: 128,
        n_sharpness: 128,
        n_zoom: 1,
    },
    // capture feedback: bumped each time a frame is grabbed so the live
    // preview can show a short, subtle flash
    n_cnt__capture_flash: 0,

    // gamepad
    s_name__gamepad: '',
    b_connected__gamepad: false,

    // toast
    a_o_toast: [],
    n_ts_ms_now: Date.now(),

    // macro recording/playback
    b_recording__macro: false,
    b_playing__macro: false,
    b_loop__macro: false,
    a_o_command__macro: [],
    n_ts_ms__macro_last: 0,

    // setup page state
    s_wifi_ssid: '',
    s_wifi_password: '',
    a_o_pin_config: [
        { s_name: 'Motor X', n_pin1: 4, n_pin2: 5, n_pin3: 6, n_pin4: 7 },
        { s_name: 'Motor Y', n_pin1: 15, n_pin2: 16, n_pin3: 17, n_pin4: 18 },
        { s_name: 'Motor Z', n_pin1: 8, n_pin2: 9, n_pin3: 10, n_pin4: 11 },
    ],
    b_flashing: false,
    s_flash_output: '',
    s_flash_status: 'idle',
    b_detected__esp_usb: false,
    s_port__esp_usb: '',
});

// ─── App server WebSocket (template pattern) ────────────────────────

let o_socket = null;
let a_f_handler = [];

let f_register_handler = function(f_handler) {
    a_f_handler.push(f_handler);
    return function() {
        let n_idx = a_f_handler.indexOf(f_handler);
        if (n_idx !== -1) a_f_handler.splice(n_idx, 1);
    };
};

let f_send_wsmsg_with_response = async function(o_wsmsg){
    return new Promise(function(resolve, reject) {
        let f_handler_response = function(o_wsmsg2){
            if(o_wsmsg2.s_uuid === o_wsmsg.s_uuid){
                resolve(o_wsmsg2);
                f_unregister();
            }
        }
        let f_unregister = f_register_handler(f_handler_response);
        o_socket.send(JSON.stringify(o_wsmsg))
    });
}

let f_connect = async function() {
    return new Promise(function(resolve, reject) {
        try {
            let s_protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            o_socket = new WebSocket(s_protocol + '//' + window.location.host);

            o_socket.onopen = async function() {
                o_state.b_connected__server = true;
                console.log('app server websocket connected');

                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg(
                        'hello_from_client',
                        { s_message: 'Hello from client!' }
                    )
                )
                console.log(o_resp)
                resolve();
            };

            o_socket.onmessage = function(o_evt) {
                let o_data = JSON.parse(o_evt.data);

                // init message with ESP IP from CLI
                if(o_data.s_type === 'init'){
                    if(o_data.s_ip__esp && !o_state.s_ip__esp){
                        o_state.s_ip__esp = o_data.s_ip__esp;
                    }
                    return;
                }

                // model data broadcast
                if(o_data?.o_model){
                    let s_name_table = f_s_name_table__from_o_model(o_data.o_model);
                    o_state[s_name_table] = o_data.v_data;
                    // when settings arrive, apply them to reactive state
                    if(s_name_table === 'a_o_setting'){
                        f_apply_setting_from_db();
                    }
                    if(s_name_table === 'a_o_slide'){
                        f_apply_library_current_from_db();
                    }
                    return;
                }

                // toast
                if(o_data.s_type === 'toast'){
                    o_state.a_o_toast.push(o_data.v_data);
                    return;
                }

                // handler registry (for f_send_wsmsg_with_response)
                for (let f_handler of a_f_handler) {
                    f_handler(o_data);
                }
            };

            o_socket.onclose = function() {
                o_state.b_connected__server = false;
                console.log('app server websocket disconnected, reconnecting...');
                setTimeout(f_connect, 2000);
            };

        } catch (error) {
            reject(error);
        }
    });
};

// ─── Settings load/save via DB ──────────────────────────────────────

let f_v_setting = function(s_key){
    let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === s_key; });
    if(!o_setting) return undefined;
    return o_setting.s_value;
}

let f_apply_setting_from_db = function(){
    let f_get = function(s_key, v_default){
        let s_val = f_v_setting(s_key);
        if(s_val === undefined || s_val === '') return v_default;
        return s_val;
    };
    let f_get_json = function(s_key, v_default){
        let s_val = f_v_setting(s_key);
        if(s_val === undefined || s_val === '') return v_default;
        try { return JSON.parse(s_val); } catch(e) { return v_default; }
    };

    o_state.s_ip__esp = o_state.s_ip__esp || f_get('s_ip__esp', '');
    o_state.n_rpm__jog = parseFloat(f_get('n_rpm__jog', '5.0'));
    o_state.s_id__webcam_device = f_get('s_id__webcam_device', '');

    let o_vis = f_get_json('o_panel_visibility', { map: false, motion: false, optics: false, jog: true, motors: true, scan: false, camera_setting: false, stats: false });
    o_state.o_panel_visibility.flat = o_vis.flat || false;
    o_state.o_panel_visibility.map = o_vis.map || false;
    o_state.o_panel_visibility.motion = o_vis.motion || false;
    o_state.o_panel_visibility.optics = o_vis.optics || false;
    o_state.o_panel_visibility.slide_library = o_vis.slide_library || false;
    o_state.o_panel_visibility.jog = o_vis.jog;
    o_state.o_panel_visibility.motors = o_vis.motors;
    o_state.o_panel_visibility.scan = o_vis.scan || false;
    o_state.o_panel_visibility.camera_setting = o_vis.camera_setting || false;
    o_state.o_panel_visibility.manual_stitch = o_vis.manual_stitch || false;
    o_state.o_panel_visibility.macro = o_vis.macro || false;
    o_state.o_panel_visibility.auto_move = o_vis.auto_move || false;
    o_state.o_panel_visibility.autostitch = o_vis.autostitch || false;
    o_state.o_panel_visibility.filter = o_vis.filter || false;
    o_state.o_panel_visibility.focus = o_vis.focus || false;
    o_state.o_panel_visibility.focus_stack = o_vis.focus_stack || false;
    o_state.o_panel_visibility.backlash = o_vis.backlash || false;
    o_state.o_panel_visibility.stats = o_vis.stats || false;

    // keep unknown/missing filter keys on their defaults
    Object.assign(o_state.o_filter, f_get_json('o_filter', {}));

    // flat-field metadata (the pixel data is re-loaded from s_path_flat on the
    // control page once the flat-field component mounts)
    Object.assign(o_state.o_flat_field, f_get_json('o_flat_field', {}));

    o_state.o_mapping__w = f_get_json('o_mapping__w', o_state.o_mapping__w);
    o_state.o_mapping__s = f_get_json('o_mapping__s', o_state.o_mapping__s);
    o_state.o_mapping__a = f_get_json('o_mapping__a', o_state.o_mapping__a);
    o_state.o_mapping__d = f_get_json('o_mapping__d', o_state.o_mapping__d);
    o_state.o_mapping__q = f_get_json('o_mapping__q', o_state.o_mapping__q);
    o_state.o_mapping__e = f_get_json('o_mapping__e', o_state.o_mapping__e);
    o_state.o_mapping__mouse_right = f_get_json('o_mapping__mouse_right', o_state.o_mapping__mouse_right);

    o_state.b_enabled__mouse_jog = f_get('b_enabled__mouse_jog', 'true') === 'true';

    // backlash (per motor)
    o_state.a_n_step__backlash = f_get_json('a_n_step__backlash', o_state.a_n_step__backlash);
    // steps per pixel (per motor), used by the scan auto-grid
    o_state.a_n_step__per_px = f_get_json('a_n_step__per_px', o_state.a_n_step__per_px);

    // setup page settings
    o_state.s_wifi_ssid = f_get('s_wifi_ssid', o_state.s_wifi_ssid);
    o_state.s_wifi_password = f_get('s_wifi_password', o_state.s_wifi_password);
    o_state.a_o_pin_config = f_get_json('a_o_pin_config', o_state.a_o_pin_config);

    // auto-redirect: if ESP IP is known, try to connect and go to control page
    f_try_auto_redirect();
};

// restore the persisted project/slide selection once the slide data has arrived
// (a_o_slide is broadcast after a_o_project, so both are present here)
let f_apply_library_current_from_db = function() {
    let o_cur = null;
    let s_val = f_v_setting('o_library__current');
    if(s_val){
        try { o_cur = JSON.parse(s_val); } catch(e) { o_cur = null; }
    }
    if(!o_cur) return;
    if(typeof o_cur.n_id__project === 'number'){
        let o_project = (o_state.a_o_project || []).find(function(o){ return o.n_id === o_cur.n_id__project; });
        if(o_project) o_state.n_id__project__current = o_cur.n_id__project;
    }
    if(typeof o_cur.n_id__slide === 'number'){
        let o_slide = (o_state.a_o_slide || []).find(function(o){ return o.n_id === o_cur.n_id__slide; });
        if(o_slide) o_state.n_id__slide__current = o_cur.n_id__slide;
    }
};

let n_id__save_timeout = 0;

let f_save_setting = async function(s_key, v_value) {
    let s_value = typeof v_value === 'string' ? v_value : JSON.stringify(v_value);
    let o_existing = o_state.a_o_setting.find(function(o){ return o.s_key === s_key; });
    if (o_existing) {
        let o_resp = await f_send_wsmsg_with_response(
            f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name,
                ['update', 'a_o_setting', o_existing, { s_value: s_value }]
            )
        );
        if(o_resp.v_result){
            o_existing.s_value = s_value;
            o_existing.n_ts_ms_updated = o_resp.v_result.n_ts_ms_updated;
        }
    } else {
        let o_resp = await f_send_wsmsg_with_response(
            f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name,
                ['create', 'a_o_setting', { s_key: s_key, s_value: s_value }]
            )
        );
        if(o_resp.v_result){
            o_state.a_o_setting.push(o_resp.v_result);
        }
    }
};

let f_save_library_current = function() {
    f_save_setting('o_library__current', {
        n_id__project: o_state.n_id__project__current,
        n_id__slide: o_state.n_id__slide__current,
    });
};

// create an o_map row for the current slide (and make it primary).
// o_map_data: { s_kind, s_path_map, s_path_preview, s_path_folder, n_scl_x, n_scl_y }
let f_o_map__link = async function(o_map_data) {
    let n_id__slide = o_state.n_id__slide__current;
    if(!n_id__slide || !o_map_data || !o_map_data.s_path_map) return null;
    // unset b_primary on the slide's existing maps
    let a_o_map__slide = (o_state.a_o_map || []).filter(function(o){ return o.n_o_slide_n_id === n_id__slide; });
    for(let o_map of a_o_map__slide){
        if(o_map.b_primary){
            await f_send_wsmsg_with_response(
                f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name, ['update', 'a_o_map', o_map, { b_primary: false }])
            );
        }
    }
    let o_resp = await f_send_wsmsg_with_response(
        f_o_wsmsg(o_sfunexposed__f_v_crud__indb.s_name, ['create', 'a_o_map', {
            n_o_slide_n_id: n_id__slide,
            s_kind: o_map_data.s_kind || '',
            s_path_map: o_map_data.s_path_map,
            s_path_preview: o_map_data.s_path_preview || '',
            s_path_folder: o_map_data.s_path_folder || '',
            n_scl_x: o_map_data.n_scl_x || 0,
            n_scl_y: o_map_data.n_scl_y || 0,
            b_primary: true,
        }])
    );
    if(o_resp.v_result){
        o_state.a_o_map.push(o_resp.v_result);
        for(let o_map of o_state.a_o_map){
            if(o_map.n_o_slide_n_id === n_id__slide && o_map.n_id !== o_resp.v_result.n_id){
                o_map.b_primary = false;
            }
        }
    }
    return o_resp.v_result;
};

// refresh the list of scanned map files the server can localize against
let f_refresh_maps = async function() {
    try {
        let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('locate_list_maps', {}));
        let o_result = o_resp.v_result;
        if(o_result && Array.isArray(o_result.a_o_map)){
            o_state.a_o_map__scanned = o_result.a_o_map;
        }
    } catch(o_error) { /* socket not ready yet */ }
};

let f_set_mouse_jog = function(b_enabled) {
    o_state.b_enabled__mouse_jog = b_enabled;
    f_save_setting('b_enabled__mouse_jog', String(b_enabled));
};

let f_toggle_mouse_jog = function() {
    f_set_mouse_jog(!o_state.b_enabled__mouse_jog);
};

let f_save_setting__debounced = function(s_key, v_value) {
    clearTimeout(n_id__save_timeout);
    n_id__save_timeout = setTimeout(function(){ f_save_setting(s_key, v_value); }, 300);
};

// persist the flat-field metadata (never the pixel buffers — those stay in the
// non-reactive module cache and are re-loaded from s_path_flat on startup).
let f_save_flat_field = function() {
    let o_flat = o_state.o_flat_field;
    f_save_setting__debounced('o_flat_field', {
        b_active: o_flat.b_active,
        s_path_flat: o_flat.s_path_flat,
        n_scl_x: o_flat.n_scl_x,
        n_scl_y: o_flat.n_scl_y,
        a_n_mean__channel: o_flat.a_n_mean__channel,
        n_ms__created: o_flat.n_ms__created,
        o_camera__flat: o_flat.o_camera__flat,
    });
};

// ─── Auto-redirect logic ──────────────────────────────────────────────

let b_auto_redirect_attempted = false;

let f_try_auto_redirect = async function() {
    if (b_auto_redirect_attempted) return;
    b_auto_redirect_attempted = true;

    // USB Serial is the default transport: only skip the setup page when a
    // serial port is already authorized (getPorts() needs no user gesture).
    // WebSocket must be enabled explicitly from the setup page.
    if (o_state.b_available__serial) {
        try {
            let a_o_port = await navigator.serial.getPorts();
            if (a_o_port.length > 0) {
                o_router.push('/control');
                return;
            }
        } catch {}
    }
    // stay on the setup page so the user can choose USB Serial or enter an
    // IP for the WebSocket fallback
};

// ─── ESP32 transport (Web Serial primary, WebSocket fallback) ───────

let o_ws__esp = null;
let o_serial__esp = null;
let o_reader__serial = null;
let o_writer__serial = null;
let n_id__esp_reconnect = 0;
let n_id__esp_status_poll = 0;

// message handlers (used by move/step + circle promise wrappers)
let a_f_handler__esp = [];
let a_f_on_disconnect__esp = [];

let f_register_esp_handler = function(f_handler) {
    a_f_handler__esp.push(f_handler);
    return function() {
        let n_idx = a_f_handler__esp.indexOf(f_handler);
        if (n_idx !== -1) a_f_handler__esp.splice(n_idx, 1);
    };
};

let f_register_esp_disconnect = function(f_handler) {
    a_f_on_disconnect__esp.push(f_handler);
    return function() {
        let n_idx = a_f_on_disconnect__esp.indexOf(f_handler);
        if (n_idx !== -1) a_f_on_disconnect__esp.splice(n_idx, 1);
    };
};

let f_notify_esp_disconnect = function() {
    let a_f = a_f_on_disconnect__esp;
    a_f_on_disconnect__esp = [];
    for (let f_handler of a_f) f_handler();
};

let f_reset_stat__session = function() {
    for (let n_idx = 0; n_idx < o_state.a_o_motor__stat.length; n_idx++) {
        o_state.a_o_motor__stat[n_idx] = f_o_motor__stat();
    }
    o_state.o_stat__session = {
        n_ts_ms__start: Date.now(),
        n_step__session: 0,
        n_ms__run_session: 0,
        n_cnt__halt: 0,
    };
};

let f_update_stat__motor = function() {
    let n_ts_ms_now = Date.now();
    for (let n_idx = 0; n_idx < o_state.a_o_motor.length; n_idx++) {
        let o_motor = o_state.a_o_motor[n_idx];
        let o_stat = o_state.a_o_motor__stat[n_idx];
        if (!o_stat) continue;

        // steps driven since the last sample (stage movement, direction-agnostic)
        let n_step__delta = 0;
        if (!o_stat.b_position__init) {
            o_stat.n_position__prev = o_motor.n_position;
            o_stat.b_position__init = true;
        } else {
            n_step__delta = Math.abs(o_motor.n_position - o_stat.n_position__prev);
            o_stat.n_position__prev = o_motor.n_position;
        }

        // direction reversal
        if (o_stat.s_direction__prev !== '' && o_motor.s_direction !== o_stat.s_direction__prev) {
            o_stat.n_cnt__reversal++;
        }
        o_stat.s_direction__prev = o_motor.s_direction;

        // peak rpm
        if (o_motor.n_rpm > o_stat.n_rpm__max) {
            o_stat.n_rpm__max = o_motor.n_rpm;
        }

        // session odometer: every stage step counts, whatever the state
        if (n_step__delta > 0) {
            o_stat.n_step__session += n_step__delta;
            o_state.o_stat__session.n_step__session += n_step__delta;
        }

        if (o_motor.b_running) {
            if (!o_stat.b_running__prev) {
                // a new run just started
                o_stat.n_ts_ms__run_start = n_ts_ms_now;
                o_stat.n_step__since_halt = 0;
                o_stat.n_ms__run_since_halt = 0;
            }
            o_stat.n_step__since_halt += n_step__delta;
            o_stat.n_ms__run_since_halt = n_ts_ms_now - o_stat.n_ts_ms__run_start;
        } else {
            if (o_stat.b_running__prev) {
                // the motor halted: close out this run
                o_stat.n_cnt__halt++;
                o_state.o_stat__session.n_cnt__halt++;
                let n_ms__run = n_ts_ms_now - o_stat.n_ts_ms__run_start;
                o_stat.n_ms__run_session += n_ms__run;
                o_state.o_stat__session.n_ms__run_session += n_ms__run;
                // capture the run that just ended, then reset the trip:
                // steps are reset when the motors are halted
                o_stat.n_step__last_run = o_stat.n_step__since_halt + n_step__delta;
                o_stat.n_step__since_halt = 0;
                o_stat.n_ms__run_since_halt = 0;
            }
        }
        o_stat.b_running__prev = o_motor.b_running;
    }
};

let f_handle_esp_message = function(o_data) {
    if (o_data.type === 'status' && o_data.a_o_motor) {
        for (let n_idx = 0; n_idx < o_data.a_o_motor.length && n_idx < o_state.a_o_motor.length; n_idx++) {
            let o_src = o_data.a_o_motor[n_idx];
            o_state.a_o_motor[n_idx].n_rpm = o_src.n_rpm;
            o_state.a_o_motor[n_idx].s_direction = o_src.s_direction;
            o_state.a_o_motor[n_idx].b_running = o_src.b_running;
            o_state.a_o_motor[n_idx].n_position = o_src.n_position;
            o_state.a_o_motor[n_idx].s_mode = o_src.s_mode;
            o_state.a_o_motor[n_idx].n_step__remaining = o_src.n_step__remaining;
            o_state.a_o_motor[n_idx].n_step__backlash = o_src.n_step__backlash;
            o_state.a_o_motor[n_idx].b_compensating = o_src.b_compensating;
        }
        f_update_stat__motor();
    }
    for (let f_handler of a_f_handler__esp) {
        f_handler(o_data);
    }
};

let f_start_esp_status_poll = function() {
    clearInterval(n_id__esp_status_poll);
    n_id__esp_status_poll = setInterval(function() {
        f_send_esp({ command: 'status' });
    }, 1000);
};

let f_push_esp_config = function() {
    f_reset_stat__session();
    f_send_esp({ command: 'status' });
    // push backlash config to ESP32 on connect
    for (let n_idx = 0; n_idx < o_state.a_n_step__backlash.length; n_idx++) {
        if (o_state.a_n_step__backlash[n_idx] > 0) {
            f_send_esp({ motor: n_idx, command: 'setBacklash', n_step__backlash: o_state.a_n_step__backlash[n_idx] });
        }
    }
    f_start_esp_status_poll();
};

let f_b_esp_connected = function() {
    if (!o_state.b_connected__esp) return false;
    if (o_state.s_transport__esp === 'serial') return !!o_writer__serial;
    if (o_state.s_transport__esp === 'ws') return !!(o_ws__esp && o_ws__esp.readyState === WebSocket.OPEN);
    return false;
};

let f_close_esp_serial = function() {
    if (o_writer__serial) { try { o_writer__serial.releaseLock(); } catch {} o_writer__serial = null; }
    if (o_reader__serial) { try { o_reader__serial.cancel(); } catch {} o_reader__serial = null; }
    if (o_serial__esp) { try { o_serial__esp.close(); } catch {} o_serial__esp = null; }
    if (o_state.s_transport__esp === 'serial') {
        o_state.s_transport__esp = '';
        o_state.s_port__esp = '';
        o_state.b_connected__esp = false;
    }
};

let f_disconnect_esp = function() {
    clearInterval(n_id__esp_status_poll);
    clearInterval(n_id__esp_reconnect);
    if (o_ws__esp) { try { o_ws__esp.close(); } catch {} o_ws__esp = null; }
    f_close_esp_serial();
    f_notify_esp_disconnect();
    o_state.b_connected__esp = false;
    o_state.s_transport__esp = '';
};

let f_read_esp_serial = async function(o_port) {
    let o_reader = o_port.readable.getReader();
    o_reader__serial = o_reader;
    let o_decoder = new TextDecoder();
    let s_buffer = '';
    try {
        while (true) {
            let { done, value } = await o_reader.read();
            if (done) break;
            s_buffer += o_decoder.decode(value, { stream: true });
            let a_s_line = s_buffer.split('\n');
            s_buffer = a_s_line.pop();
            for (let s_line of a_s_line) {
                let s_trim = s_line.trim();
                if (!s_trim) continue;
                try {
                    f_handle_esp_message(JSON.parse(s_trim));
                } catch { /* boot log or partial garbage — ignore */ }
            }
        }
    } catch (o_err) {
        // reader cancelled (intentional disconnect) or device unplugged
    }
    // only clean up if this port is still the active one (device unplugged)
    if (o_serial__esp === o_port) {
        f_notify_esp_disconnect();
        f_close_esp_serial();
    }
};

// ─── WebSocket transport (fallback) ─────────────────────────────────

let f_connect_esp = function(s_ip) {
    if (!s_ip) return;
    f_disconnect_esp();
    o_state.s_ip__esp = s_ip;
    o_state.s_transport__esp = 'ws';

    let f_open_ws = function() {
        if (o_state.s_transport__esp !== 'ws') return;
        try {
            o_ws__esp = new WebSocket('ws://' + s_ip + '/ws');

            o_ws__esp.onopen = function() {
                if (o_state.s_transport__esp !== 'ws') return;
                o_state.b_connected__esp = true;
                console.log('ESP32 websocket connected');
                f_push_esp_config();
            };

            o_ws__esp.onmessage = function(o_evt) {
                try { f_handle_esp_message(JSON.parse(o_evt.data)); } catch {}
            };

            o_ws__esp.onclose = function() {
                if (o_state.s_transport__esp !== 'ws') return;
                o_state.b_connected__esp = false;
                clearInterval(n_id__esp_status_poll);
                f_notify_esp_disconnect();
                console.log('ESP32 websocket disconnected');
            };

            o_ws__esp.onerror = function() {
                if (o_state.s_transport__esp !== 'ws') return;
                o_state.b_connected__esp = false;
            };
        } catch (o_err) {
            console.error('ESP32 WS error:', o_err);
        }
    };

    f_open_ws();
    n_id__esp_reconnect = setInterval(function() {
        if (o_state.s_transport__esp === 'ws' && !o_state.b_connected__esp) {
            f_open_ws();
        }
    }, 2000);
};

// ─── Web Serial transport (primary) ─────────────────────────────────

let f_connect_esp_serial = async function(b_request_if_none) {
    if (!o_state.b_available__serial) return false;
    try {
        let o_port = null;
        let a_o_port = await navigator.serial.getPorts();
        if (a_o_port.length > 0) {
            o_port = a_o_port[0];
        } else if (b_request_if_none !== false) {
            o_port = await navigator.serial.requestPort();
        }
        if (!o_port) return false;

        await o_port.open({ baudRate: 115200 });

        f_disconnect_esp();

        o_serial__esp = o_port;
        o_state.s_transport__esp = 'serial';
        o_state.s_port__esp = 'USB (Web Serial)';
        o_state.b_connected__esp = true;
        console.log('ESP32 serial connected');

        o_writer__serial = o_port.writable.getWriter();
        f_push_esp_config();
        f_read_esp_serial(o_port);  // async reader loop, intentionally not awaited
        return true;
    } catch (o_err) {
        // NotFoundError = user cancelled the port picker
        if (o_err && o_err.name !== 'NotFoundError') {
            console.warn('Serial connect error:', o_err);
        }
        return false;
    }
};

// USB Serial is the default transport. Auto-connect only re-opens an
// already-authorized port (no user gesture). WebSocket is never auto-connected
// here — it must be enabled from the setup page.
let f_connect_esp__auto = async function() {
    if (o_state.b_available__serial) {
        try {
            let a_o_port = await navigator.serial.getPorts();
            if (a_o_port.length > 0) {
                return await f_connect_esp_serial(false);
            }
        } catch {}
    }
    return false;
};

// ─── Send ───────────────────────────────────────────────────────────

let f_send_esp = function(o_msg) {
    // record macro commands (skip status polls)
    if (o_state.b_recording__macro && o_msg.command !== 'status' && o_msg.command !== 'setBacklash') {
        let n_ts_ms_now = Date.now();
        let n_ms__delta = o_state.n_ts_ms__macro_last ? n_ts_ms_now - o_state.n_ts_ms__macro_last : 0;
        o_state.n_ts_ms__macro_last = n_ts_ms_now;
        o_state.a_o_command__macro.push({ n_ms__delta, o_msg: JSON.parse(JSON.stringify(o_msg)) });
    }

    if (o_state.s_transport__esp === 'serial' && o_writer__serial) {
        o_writer__serial.write(new TextEncoder().encode(JSON.stringify(o_msg) + '\n')).catch(function(){});
    } else if (o_ws__esp && o_ws__esp.readyState === WebSocket.OPEN) {
        o_ws__esp.send(JSON.stringify(o_msg));
    }
};

// ─── ESP32 motor command helpers ─────────────────────────────────────

let f_send_esp_run_continuous = function(n_motor, n_rpm, s_direction) {
    f_send_esp({ motor: n_motor, command: 'runContinuous', n_rpm: n_rpm, direction: s_direction });
};

let f_send_esp_move_step = function(n_motor, n_step, n_rpm) {
    return new Promise(function(resolve) {
        if (!f_b_esp_connected()) {
            resolve(0);
            return;
        }
        let f_unregister_msg = function() {};
        let f_unregister_disc = function() {};
        let f_cleanup = function() { f_unregister_msg(); f_unregister_disc(); };

        f_unregister_msg = f_register_esp_handler(function(o_data) {
            if ((o_data.type === 'moveComplete' || o_data.type === 'moveCancelled') && o_data.motor === n_motor) {
                f_cleanup();
                resolve(o_data.n_position);
            }
        });
        f_unregister_disc = f_register_esp_disconnect(function() {
            f_cleanup();
            resolve(0);
        });
        f_send_esp({ motor: n_motor, command: 'moveSteps', n_step: n_step, n_rpm: n_rpm });
    });
};

let f_send_esp_stop = function(n_motor) {
    f_send_esp({ motor: n_motor, command: 'stop' });
};

let f_send_esp_stop_all = function() {
    f_send_esp({ command: 'stopAll' });
};

let f_send_esp_set_backlash = function(n_motor, n_step__backlash) {
    f_send_esp({ motor: n_motor, command: 'setBacklash', n_step__backlash: n_step__backlash });
};

let f_send_esp_circle_start = function(n_step__radius, n_rpm, b_loop) {
    return new Promise(function(resolve) {
        if (!f_b_esp_connected()) {
            resolve('error');
            return;
        }
        let f_unregister_msg = function() {};
        let f_unregister_disc = function() {};
        let f_cleanup = function() { f_unregister_msg(); f_unregister_disc(); };

        f_unregister_msg = f_register_esp_handler(function(o_data) {
            if (o_data.type === 'circleComplete' || o_data.type === 'circleStopped') {
                f_cleanup();
                resolve(o_data.type);
            }
        });
        f_unregister_disc = f_register_esp_disconnect(function() {
            f_cleanup();
            resolve('disconnected');
        });
        f_send_esp({
            command: 'circleStart',
            n_step__radius: n_step__radius,
            n_rpm: n_rpm,
            b_loop: b_loop,
        });
    });
};

let f_send_esp_circle_stop = function() {
    f_send_esp({ command: 'circleStop' });
};

// ─── Vue Router ─────────────────────────────────────────────────────

let a_o_route = [
    { path: '/', redirect: '/setup' },
    { path: '/setup', component: o_component__page_setup },
    { path: '/control', component: o_component__page_control },
];

let o_router = createRouter({
    history: createWebHistory(),
    routes: a_o_route,
});

// ─── Connect to app server ──────────────────────────────────────────

await f_connect();

// ─── Timestamp ticker ───────────────────────────────────────────────

setInterval(function(){ o_state.n_ts_ms_now = Date.now(); }, 1000);

// ─── Mount Vue app ──────────────────────────────────────────────────

globalThis.o_state = o_state;

let o_app = createApp({
    data: function() {
        return o_state;
    },
    template: `
        <router-view />
        <div class="a_o_toast">
            <div
                v-for="o_toast in a_o_toast"
                class="o_toast"
                :class="[o_toast.s_type, { expired: n_ts_ms_now > o_toast.n_ts_ms_created + o_toast.n_ttl_ms }]"
            >{{ o_toast.s_message }}</div>
        </div>
    `,
});

o_app.component('o_component__toolbar', o_component__toolbar);
o_app.component('o_component__webcam', o_component__webcam);
o_app.component('o_component__jog', o_component__jog);
o_app.component('o_component__map', o_component__map);
o_app.component('o_component__motion', o_component__motion);
o_app.component('o_component__optics', o_component__optics);
o_app.component('o_component__motor', o_component__motor);
o_app.component('o_component__scan', o_component__scan);
o_app.component('o_component__camera_setting', o_component__camera_setting);
o_app.component('o_component__manual_stitch', o_component__manual_stitch);
o_app.component('o_component__macro', o_component__macro);
o_app.component('o_component__auto_move', o_component__auto_move);
o_app.component('o_component__autostitch', o_component__autostitch);
o_app.component('o_component__filter', o_component__filter);
o_app.component('o_component__flat_field', o_component__flat_field);
o_app.component('o_component__focus', o_component__focus);
o_app.component('o_component__focus_stack', o_component__focus_stack);
o_app.component('o_component__backlash', o_component__backlash);
o_app.component('o_component__slide_library', o_component__slide_library);
o_app.component('o_component__stats', o_component__stats);

o_app.use(o_router);

globalThis.o_app = o_app;
o_app.mount('#app');

export {
    o_state,
    o_socket,
    o_router,
    f_send_wsmsg_with_response,
    f_register_handler,
    f_connect_esp,
    f_connect_esp_serial,
    f_connect_esp__auto,
    f_disconnect_esp,
    f_send_esp,
    f_send_esp_run_continuous,
    f_send_esp_move_step,
    f_send_esp_stop,
    f_send_esp_stop_all,
    f_send_esp_set_backlash,
    f_send_esp_circle_start,
    f_send_esp_circle_stop,
    f_save_setting,
    f_save_setting__debounced,
    f_save_flat_field,
    f_save_library_current,
    f_o_map__link,
    f_set_mouse_jog,
    f_toggle_mouse_jog,
    f_reset_stat__session,
    f_refresh_maps,
}
