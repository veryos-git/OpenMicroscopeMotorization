import { o_state, o_router, f_connect_esp_serial, f_disconnect_esp, f_save_setting__debounced, f_toggle_mouse_jog, f_send_esp_stop_all, f_save_library_current, f_refresh_maps } from './index.js';
import { f_s_key__iso, f_apply_camera_setting, f_set_camera_mode, f_apply_camera__saved } from './o_camera.module.js';

let o_component__toolbar = {
    name: 'component-toolbar',
    template: `
        <div class="toolbar" ref="el_toolbar">
            <div class="toolbar-row">
            <span class="toolbar-title">&#9881; Stepper</span>
            <button class="toolbar-toggle" @click="f_go_setup">Setup</button>
            <div class="toolbar-sep"></div>

            <div class="toolbar-ip">
                <button
                    v-if="o_state.b_available__serial"
                    class="toolbar-toggle"
                    :class="{ active: o_state.s_transport__esp === 'serial' }"
                    @click="f_on_connect_serial"
                    :title="o_state.s_transport__esp === 'serial' ? 'reconnect via USB (Web Serial)' : 'connect via USB (Web Serial)'"
                >USB</button>
                <span v-else class="toolbar-ip-hint" title="Web Serial is unavailable here — open Setup to connect via WebSocket">no USB — use Setup</span>
            </div>

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
            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.optics }"
                @click="f_toggle_panel('optics')"
            >Optics</button>

            <div class="toolbar-sep"></div>

            <button
                class="toolbar-toggle"
                :class="{ active: o_state.o_panel_visibility.jog }"
                @click="f_toggle_panel('jog')"
                title="open/close the Jog settings panel"
            >Jog</button>
            <button
                class="toolbar-toggle toolbar-mouse-jog"
                :class="{ active: o_state.b_enabled__mouse_jog }"
                @click="f_toggle_mouse_jog"
                :title="o_state.b_enabled__mouse_jog ? 'mouse jog is active - click to stop' : 'jog the motors with the mouse over the live image'"
            >&#10022; Mouse Jog</button>

            <div class="toolbar-speed" title="jog speed — WASD / mouse / gamepad">
                <button class="toolbar-speed-step" @click="f_nudge_rpm(-0.5)" title="slower">&minus;</button>
                <input
                    class="toolbar-speed-range"
                    type="range"
                    min="0.05" max="15" step="0.05"
                    v-model.number="o_state.n_rpm__jog"
                    @input="f_on_rpm_change"
                >
                <input
                    class="toolbar-speed-value"
                    type="number"
                    min="0.05" max="15" step="0.05"
                    v-model.number="o_state.n_rpm__jog"
                    @change="f_on_rpm_change"
                >
                <button class="toolbar-speed-step" @click="f_nudge_rpm(0.5)" title="faster">+</button>
                <span class="toolbar-speed-unit">rpm</span>
            </div>

            <button
                class="toolbar-toggle toolbar-stop"
                :class="{ active: b_any_motor_running }"
                @click="f_stop_all"
                title="stop all motors immediately"
            >&#9632; Stop</button>

            <div class="toolbar-spacer"></div>

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
                :title="o_state.b_connected__esp ? 'click to disconnect' : ''"
                @click="f_on_disconnect"
            >
                <span class="dot"></span>
                <span>{{ s_connection_label }}</span>
            </div>
            </div>

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
                                :title="o_control.s_a_title[0]"
                            >{{ o_control.s_a_short[0] }}</button>
                            <button
                                class="mode-btn"
                                :class="{ active: o_cam[o_control.s_local] === o_control.s_a_value[1] }"
                                @click="f_cam_mode(o_control.s_api, o_control.s_a_value[1])"
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
                            :step="o_control.o_range.step || 1"
                            v-model.number="o_cam[o_control.s_local]"
                            @input="f_cam_set(o_control.s_api, o_cam[o_control.s_local])"
                        >
                        <input
                            type="number"
                            class="toolbar-cam-value"
                            :min="o_control.o_range.min"
                            :max="o_control.o_range.max"
                            :step="o_control.o_range.step || 1"
                            v-model.number="o_cam[o_control.s_local]"
                            @change="f_cam_set(o_control.s_api, o_cam[o_control.s_local])"
                        >
                        <span class="toolbar-cam-unit" v-if="o_control.s_unit">{{ o_control.s_unit }}</span>
                    </label>
                </template>
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
        f_cam_set: function(s_api, v_value) {
            let o_control = this.a_o_cam_control.find(function(o) {
                return o.s_kind === 'value' && o.s_api === s_api;
            });
            let n_value = parseFloat(v_value);
            if (o_control && isFinite(n_value)) {
                let o_range = o_control.o_range;
                n_value = Math.max(o_range.min, Math.min(o_range.max, n_value));
                let n_step = o_range.step || 1;
                if (n_step > 0) n_value = o_range.min + Math.round((n_value - o_range.min) / n_step) * n_step;
                n_value = Math.round(n_value * 1e6) / 1e6;
                this.o_cam[o_control.s_local] = n_value;
            }
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
        f_on_connect_serial: function() {
            f_connect_esp_serial(true);
        },
        f_on_disconnect: function() {
            if (o_state.b_connected__esp) {
                f_disconnect_esp();
            }
        },
        f_toggle_panel: function(s_name) {
            o_state.o_panel_visibility[s_name] = !o_state.o_panel_visibility[s_name];
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_on_webcam_change: function() {
            f_save_setting__debounced('s_id__webcam_device', o_state.s_id__webcam_device);
        },
        f_go_setup: function() {
            o_router.push('/setup');
        },
        f_toggle_mouse_jog: function() {
            f_toggle_mouse_jog();
        },
        f_on_rpm_change: function() {
            let n_rpm = parseFloat(o_state.n_rpm__jog);
            if(!isFinite(n_rpm)){
                n_rpm = 0.05;
            }
            o_state.n_rpm__jog = Math.max(0.05, Math.min(15, n_rpm));
            f_save_setting__debounced('n_rpm__jog', String(o_state.n_rpm__jog));
        },
        f_nudge_rpm: function(n_delta) {
            let n_rpm = parseFloat(o_state.n_rpm__jog);
            if(!isFinite(n_rpm)){
                n_rpm = 0.05;
            }
            let n_next = Math.round((n_rpm + n_delta) * 100) / 100;
            o_state.n_rpm__jog = Math.max(0.05, Math.min(15, n_next));
            f_save_setting__debounced('n_rpm__jog', String(o_state.n_rpm__jog));
        },
        f_stop_all: function() {
            f_send_esp_stop_all();
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
