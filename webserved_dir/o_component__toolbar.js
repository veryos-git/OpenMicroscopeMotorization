import { o_actions } from './o_actions.js';
import { o_state, f_save_setting__debounced, f_send_esp_stop_all, f_save_library_current, f_refresh_maps } from './index.js';
import { f_s_key__iso, f_apply_camera_setting, f_set_camera_mode, f_apply_camera__saved } from './o_camera.module.js';
import { f_recording_stop } from './o_recording.module.js';

let o_component__toolbar = {
    name: 'component-toolbar',
    template: `
        <div class="toolbar" ref="el_toolbar">
            <div class="toolbar-row">
            <button class="toolbar-toggle" @click="f_action_search">find (ctrl+f)</button>
            <button class="toolbar-toggle" @click="f_capture_image">Capture Image</button>
            <button class="toolbar-toggle" :class="{ active: o_state.o_panel_visibility.training }" @click="f_toggle_panel('training')">Train model</button>
            <span class="toolbar-title">&#9881; Stepper</span>
            <button class="toolbar-toggle" @click="f_open_setup" :class="{ active: o_state.o_panel_visibility.setup }">Setup</button>
            <div class="toolbar-sep"></div>

            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.map, running: o_state.b_running__locate }"
                @click="f_toggle_panel('map')"
            >Map</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.slide_library }"
                @click="f_toggle_panel('slide_library')"
            >Slides</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.motion }"
                @click="f_toggle_panel('motion')"
            >Motion</button>
            <button class="toolbar-toggle" :class="{ active: o_state.o_panel_visibility.motion_detection, running: o_state.o_motion_detection.b_enabled }"
                @click="f_toggle_panel('motion_detection')">Motion detection</button>
            <button class="toolbar-toggle" :class="{ active: o_state.o_panel_visibility.gamepad }" @click="f_toggle_panel('gamepad')">Gamepad</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.optics }"
                @click="f_toggle_panel('optics')"
            >Optics</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_flat_field.b_active }"
                @click="f_open_flat"
                title="Open flat-field calibration — shortcut: F"
            >Flat</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.cellpose }"
                @click="f_toggle_panel('cellpose')"
                title="segment the camera feed with the Cellpose AI model"
            >Cell pose</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.zoom }"
                @click="f_toggle_panel('zoom')"
                title="digital zoom — drag a box on the live image to magnify it"
            >Zoom</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.record, running: o_state.o_record.b_running }"
                @click="f_toggle_panel('record')"
                title="time-lapse recording — interval, positions and autofocus"
            >Record</button>
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.video, running: o_state.o_video.b_recording }"
                @click="f_toggle_panel('video')"
                title="real-time video — record, burst or pre-roll"
            >Video</button>
            <button
                v-if="o_state.o_record.b_running"
                class="toolbar-toggle toolbar-record-stop"
                @click="f_stop_recording"
                title="stop the running recording"
            >&#9632; {{ o_state.o_record.n_its__frame__done }} rec</button>

            <div class="toolbar-sep"></div>

            <button
                class="toolbar-toggle toolbar-stop"
                :class="{ active: b_any_motor_running }"
                @click="f_stop_all"
                title="stop all motors immediately"
            >&#9632; Stop</button>

            <div class="toolbar-spacer"></div>
            <button class="toolbar-toggle hardware-overview" @click="f_open_setup" aria-label="Hardware overview — open Setup">
                <span v-for="o_item in a_o_hardware" :key="o_item.s_label" :class="'hardware-state--' + o_item.s_status" :title="o_item.s_detail">{{ o_item.s_label }}: {{ o_item.s_value }}</span>
            </button>

            <select
                v-model="o_state.s_id__webcam_device"
                @change="f_on_webcam_change"
            >
                <option value="">-- camera --</option>
                <option
                    v-for="o_dev in o_state.a_o_device__webcam"
                    :value="o_dev.deviceId"
                >{{ o_dev.label || o_dev.deviceId }}</option>
            </select>

            <div
                class="conn-badge"
                :class="{ connected: o_state.b_connected__esp }"
                title="Controller connection — configure in Setup"
            >
                <span class="dot"></span>
                <span>{{ s_connection_label }}</span>
            </div>
            </div>

            <div class="toolbar-row toolbar-row--speed"><o_component__manual_speed s_context="toolbar" /></div>

            <!-- USB camera hardware quick bar (UVC settings, shown while streaming) -->
            <div class="toolbar-row toolbar-row--camera" v-if="o_state.o_camera.b_active">
                <span class="toolbar-camera-title" title="USB camera hardware controls (UVC)">&#9679; CAM</span>
                <template v-for="o_control in a_o_cam_control" :key="o_control.s_kind + ':' + o_control.s_api">
                    <div class="toolbar-cam-mode" v-if="o_control.s_kind === 'mode'">
                        <span class="toolbar-cam-label">{{ o_control.s_label }}</span>
                        <div class="mode-toggle mode-toggle--mini">
                            <button
                                class="mode-btn"
                                :class="{ active: o_cam[o_control.s_local] === o_control.s_a_value[0] }"
                                @click="f_cam_mode(o_control.s_api, o_control.s_a_value[0])"
                                :disabled="!o_cam.o_capability[o_control.s_api]?.includes(o_control.s_a_value[0])"
                                :title="o_control.s_a_title[0]"
                            >{{ o_control.s_a_short[0] }}</button>
                            <button
                                class="mode-btn"
                                :class="{ active: o_cam[o_control.s_local] === o_control.s_a_value[1] }"
                                @click="f_cam_mode(o_control.s_api, o_control.s_a_value[1])"
                                :disabled="!o_cam.o_capability[o_control.s_api]?.includes(o_control.s_a_value[1])"
                                :title="o_control.s_a_title[1]"
                            >{{ o_control.s_a_short[1] }}</button>
                        </div>
                    </div>
                    <label class="toolbar-cam-item" v-else :title="o_control.s_title">
                        <span class="toolbar-cam-label">{{ o_control.s_label }}</span>
                        <input
                            type="range"
                            class="toolbar-cam-range"
                            :min="o_control.o_range.min"
                            :max="o_control.o_range.max"
                            :step="o_control.o_range.step ?? 'any'"
                            v-model.number="o_cam[o_control.s_local]"
                            @input="f_cam_set(o_control.s_api, o_cam[o_control.s_local])"
                        >
                        <input
                            type="number"
                            class="toolbar-cam-value"
                            :min="o_control.o_range.min"
                            :max="o_control.o_range.max"
                            :step="o_control.o_range.step ?? 'any'"
                            v-model.number="o_cam[o_control.s_local]"
                            @change="f_cam_set(o_control.s_api, o_cam[o_control.s_local])"
                        >
                        <span class="toolbar-cam-unit" v-if="o_control.s_unit">{{ o_control.s_unit }}</span>
                    </label>
                </template>
                <span class="toolbar-camera-hint" role="alert" v-if="o_cam.s_error__setting">{{ o_cam.s_error__setting }}</span>
                <span class="toolbar-camera-hint" v-if="!a_o_cam_control.length">no controllable settings reported by this camera</span>
            </div>

            <div class="toolbar-row toolbar-row--context">
                <label class="toolbar-context-label">Project</label>
                <select
                    class="toolbar-context-select"
                    :value="o_state.n_id__project__current"
                    @change="f_on_project_change"
                    title="current project"
                >
                    <option :value="0">-- project --</option>
                    <option v-for="o_project in a_o_project" :key="o_project.n_id" :value="o_project.n_id">{{ o_project.s_name }}</option>
                </select>

                <label class="toolbar-context-label">Slide</label>
                <select
                    class="toolbar-context-select toolbar-context-select--wide"
                    :value="o_state.n_id__slide__current"
                    @change="f_on_slide_change"
                    :disabled="!o_state.n_id__project__current"
                    title="current slide"
                >
                    <option :value="0">-- slide --</option>
                    <option v-for="o_slide in a_o_slide__project" :key="o_slide.n_id" :value="o_slide.n_id">{{ o_slide.s_name }}</option>
                </select>

                <label class="toolbar-context-label">Map</label>
                <select
                    class="toolbar-context-select toolbar-context-select--map"
                    :value="o_state.s_path_map__current"
                    @change="f_on_map_change"
                    title="current map"
                >
                    <option value="">-- map --</option>
                    <option v-for="o_map in a_o_map__selectable" :key="o_map.s_path_map" :value="o_map.s_path_map">{{ o_map.s_label }}</option>
                </select>
                <button class="toolbar-context-refresh" @click="f_on_refresh_maps" title="refresh map list">&#8635;</button>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
        };
    },
    computed: {
        a_o_hardware: function() {
            let a_items = [{ s_label: 'Camera', s_value: o_state.b_streaming__webcam ? 'live' : 'off', s_status: o_state.b_streaming__webcam ? 'ready' : 'unknown', s_detail: 'Camera stream' }];
            for(let s_axis of ['x', 'y', 'z']) {
                let n_motor = o_state.o_motor__axis[s_axis];
                let b_assigned = Number.isInteger(n_motor) && n_motor >= 0 && n_motor < 3;
                let o_probe = o_state.o_focus__probe;
                let s_value = !b_assigned ? 'manual' : !o_state.b_connected__esp ? 'offline' : 'M' + (n_motor + 1);
                let s_status = 'unknown';
                let s_detail = 'Axis assignment only; motor connection is not electronically detected';
                if(s_axis === 'z' && b_assigned && o_state.b_connected__esp) {
                    s_value = 'untested';
                    s_detail = 'Run focus calibration in Setup to check motor response';
                    if(o_probe?.n_motor === n_motor && ['responsive', 'no_response'].includes(o_probe.s_status)) {
                        s_value = o_probe.s_status === 'responsive' ? 'responded' : 'no response';
                        s_status = o_probe.s_status === 'responsive' ? 'ready' : 'warning';
                        s_detail = 'Last focus probe: ' + new Date(o_probe.n_ts_ms).toLocaleString() + '. Recalibrate after hardware changes.';
                    }
                }
                a_items.push({ s_label: s_axis === 'z' ? 'Focus' : s_axis.toUpperCase(), s_value, s_status, s_detail });
            }
            return a_items;
        },
        o_cam: function() {
            return o_state.o_camera;
        },
        s_key__iso: function() {
            return f_s_key__iso(o_state.o_camera.o_capability);
        },
        // flat, ordered list of the camera quick controls: mode toggles and
        // numeric sliders, filtered by what the camera reports and by the mode
        // (exposure time only in manual exposure, compensation only in auto...)
        a_o_cam_control: function() {
            let o_cam = o_state.o_camera;
            let o_cap = o_cam.o_capability;
            let s_key__iso = this.s_key__iso;
            let a_o_control = [];

            let f_push_mode = function(o_mode) {
                a_o_control.push(Object.assign({ s_kind: 'mode' }, o_mode));
            };
            let f_push_value = function(s_label, s_api, s_local, o_range, s_unit, s_title) {
                a_o_control.push({ s_kind: 'value', s_label: s_label, s_api: s_api, s_local: s_local, o_range: o_range, s_unit: s_unit, s_title: s_title });
            };

            let b_manual__exposure = !o_cap.exposureMode || o_cam.s_mode__exposure === 'manual';
            if (o_cap.exposureMode) {
                f_push_mode({
                    s_label: 'EXP', s_api: 'exposureMode', s_local: 's_mode__exposure',
                    s_a_value: ['manual', 'continuous'], s_a_short: ['M', 'A'],
                    s_a_title: ['manual exposure (locks the exposure)', 'auto exposure'],
                });
            }
            if (b_manual__exposure) {
                if (o_cap.exposureTime) f_push_value('exp', 'exposureTime', 'n_time__exposure', o_cap.exposureTime, '', 'exposure time (100 \u00b5s units)');
                if (s_key__iso) f_push_value(s_key__iso.toUpperCase(), s_key__iso, 'n_iso', o_cap[s_key__iso], '', 'sensor sensitivity (' + s_key__iso + ')');
            } else if (o_cap.exposureCompensation) {
                f_push_value('comp', 'exposureCompensation', 'n_compensation__exposure', o_cap.exposureCompensation, '', 'exposure compensation');
            }

            if (o_cap.whiteBalanceMode) {
                f_push_mode({
                    s_label: 'WB', s_api: 'whiteBalanceMode', s_local: 's_mode__white_balance',
                    s_a_value: ['manual', 'continuous'], s_a_short: ['M', 'A'],
                    s_a_title: ['manual white balance', 'auto white balance'],
                });
                if (o_cam.s_mode__white_balance === 'manual' && o_cap.colorTemperature) {
                    f_push_value('wb', 'colorTemperature', 'n_temperature__color', o_cap.colorTemperature, 'K', 'color temperature');
                }
            }

            if (o_cap.focusMode) {
                f_push_mode({
                    s_label: 'FOCUS', s_api: 'focusMode', s_local: 's_mode__focus',
                    s_a_value: ['manual', 'continuous'], s_a_short: ['M', 'A'],
                    s_a_title: ['manual focus', 'auto focus'],
                });
                if (o_cam.s_mode__focus === 'manual' && o_cap.focusDistance) {
                    f_push_value('focus', 'focusDistance', 'n_distance__focus', o_cap.focusDistance, '', 'focus distance');
                }
            }

            let a_o_always = [
                { s_label: 'BRI', s_api: 'brightness', s_local: 'n_brightness', s_unit: '', s_title: 'brightness' },
                { s_label: 'CON', s_api: 'contrast', s_local: 'n_contrast', s_unit: '', s_title: 'contrast' },
                { s_label: 'SAT', s_api: 'saturation', s_local: 'n_saturation', s_unit: '', s_title: 'saturation' },
                { s_label: 'SHA', s_api: 'sharpness', s_local: 'n_sharpness', s_unit: '', s_title: 'sharpness' },
                { s_label: 'ZOOM', s_api: 'zoom', s_local: 'n_zoom', s_unit: 'x', s_title: 'zoom' },
            ];
            for (let n_idx = 0; n_idx < a_o_always.length; n_idx++) {
                let o_item = a_o_always[n_idx];
                if (!o_cap[o_item.s_api]) continue;
                if (o_item.s_api === 'zoom' && o_cap.zoom.max <= o_cap.zoom.min) continue;
                f_push_value(o_item.s_label, o_item.s_api, o_item.s_local, o_cap[o_item.s_api], o_item.s_unit, o_item.s_title);
            }
            return a_o_control;
        },
        s_connection_label: function() {
            if (!o_state.b_connected__esp) return 'disconnected';
            if (o_state.s_transport__esp === 'serial') return 'connected (USB)';
            if (o_state.s_transport__esp === 'ws') return 'connected (IP)';
            return 'connected';
        },
        b_any_motor_running: function() {
            return o_state.a_o_motor.some(function(o_motor){ return o_motor.b_running; });
        },
        a_o_project: function() {
            return o_state.a_o_project || [];
        },
        a_o_slide__project: function() {
            let n_id__project = o_state.n_id__project__current;
            return (o_state.a_o_slide || []).filter(function(o_slide) {
                return o_slide.n_o_project_n_id === n_id__project;
            });
        },
        a_o_map__slide: function() {
            let n_id__slide = o_state.n_id__slide__current;
            if(!n_id__slide) return [];
            return (o_state.a_o_map || []).filter(function(o_map) {
                return o_map.n_o_slide_n_id === n_id__slide;
            }).map(function(o_map) {
                return {
                    s_label: (o_map.s_kind || 'map') + ' · ' + (o_map.s_path_map || ''),
                    s_path_map: o_map.s_path_map,
                };
            });
        },
        a_o_map__selectable: function() {
            let a_o_map = this.a_o_map__slide.concat(o_state.a_o_map__scanned || []);
            let o_seen = {};
            let a_o_out = [];
            for(let o_map of a_o_map){
                if(!o_map || !o_map.s_path_map) continue;
                if(o_seen[o_map.s_path_map]) continue;
                o_seen[o_map.s_path_map] = true;
                a_o_out.push(o_map);
            }
            return a_o_out;
        },
    },
    methods: {
        f_action_search() { o_actions.f_invoke('actions.search'); },
        f_capture_image() { o_actions.f_invoke('image.capture'); },
        f_cam_set: function(s_api, v_value) {
            let o_control = this.a_o_cam_control.find(function(o) {
                return o.s_kind === 'value' && o.s_api === s_api;
            });
            let n_value = parseFloat(v_value);
            if (!isFinite(n_value)) return;
            f_apply_camera_setting(s_api, n_value);
        },
        f_cam_mode: function(s_api, s_value) {
            f_set_camera_mode(s_api, s_value);
        },
        f_update_topbar_height: function() {
            let el_toolbar = this.$refs.el_toolbar;
            if (!el_toolbar) return;
            document.documentElement.style.setProperty('--topbar-h', el_toolbar.offsetHeight + 'px');
        },
        f_toggle_panel: function(s_name) {
            o_actions.f_invoke('panel.' + s_name);
        },
        f_stop_recording: function() {
            f_recording_stop();
        },
        f_open_flat: function() {
            o_state.o_panel_visibility.flat = true;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_on_webcam_change: function() {
            f_save_setting__debounced('s_id__webcam_device', o_state.s_id__webcam_device);
        },
        f_open_setup: function() {
            if(o_state.o_panel_visibility.setup && o_state.b_flashing) return;
            o_state.o_panel_visibility.setup = !o_state.o_panel_visibility.setup;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_stop_all: function() {
            o_actions.f_invoke('motor.stop');
        },
        f_on_project_change: function(o_evt) {
            let n_id = parseInt(o_evt.target.value, 10) || 0;
            let o_project = this.a_o_project.find(function(o){ return o.n_id === n_id; });
            if(o_project){
                this.f_select_project(o_project);
            } else {
                o_state.n_id__project__current = 0;
                o_state.n_id__slide__current = 0;
                f_save_library_current();
            }
        },
        f_on_slide_change: function(o_evt) {
            let n_id = parseInt(o_evt.target.value, 10) || 0;
            let o_slide = this.a_o_slide__project.find(function(o){ return o.n_id === n_id; });
            if(o_slide){
                this.f_select_slide(o_slide);
            } else {
                o_state.n_id__slide__current = 0;
                f_save_library_current();
            }
        },
        f_on_map_change: function(o_evt) {
            o_state.s_path_map__current = o_evt.target.value;
            // persist the chosen map while keeping the map panel's steps/px intact
            let o_setting = o_state.a_o_setting.find(function(o){ return o.s_key === 'o_config__map'; });
            let o_config = {};
            if(o_setting && o_setting.s_value){
                try { o_config = JSON.parse(o_setting.s_value) || {}; } catch(e) { o_config = {}; }
            }
            o_config.s_path_map = o_state.s_path_map__current;
            f_save_setting__debounced('o_config__map', o_config);
        },
        f_select_project: function(o_project) {
            o_state.n_id__project__current = o_project.n_id;
            let b_slide__in_project = (o_state.a_o_slide || []).some(function(o_slide) {
                return o_slide.n_id === o_state.n_id__slide__current
                    && o_slide.n_o_project_n_id === o_project.n_id;
            });
            if(!b_slide__in_project) o_state.n_id__slide__current = 0;
            f_save_library_current();
        },
        f_select_slide: function(o_slide) {
            o_state.n_id__slide__current = o_slide.n_id;
            f_save_library_current();
        },
        f_on_refresh_maps: function() {
            f_refresh_maps();
        },
    },
    watch: {
        'o_state.b_connected__server': function(b_connected) {
            if(b_connected) f_refresh_maps();
        },
    },
    mounted: function() {
        if(o_state.b_connected__server) f_refresh_maps();
        let o_self = this;
        // the camera quick bar can add a row, so keep the panels' --topbar-h in sync
        if (typeof ResizeObserver !== 'undefined' && o_self.$refs.el_toolbar) {
            o_self.o_observer_resize = new ResizeObserver(function(){ o_self.f_update_topbar_height(); });
            o_self.o_observer_resize.observe(o_self.$refs.el_toolbar);
        }
        o_self.f_update_topbar_height();
        if (o_state.b_streaming__webcam) f_apply_camera__saved();
    },
    beforeUnmount: function() {
        if (this.o_observer_resize) this.o_observer_resize.disconnect();
    },
};

export { o_component__toolbar };
