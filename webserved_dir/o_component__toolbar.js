import { o_component__icon } from './o_component__icon.js';
import { o_actions } from './o_actions.js';
import { o_state, f_save_setting__debounced, f_save_library_current, f_refresh_maps } from './index.js';
import { f_s_key__iso, f_apply_camera_setting, f_set_camera_mode, f_apply_camera__saved } from './o_camera.module.js';
import { f_recording_stop } from './o_recording.module.js';

let o_component__toolbar = {
    name: 'component-toolbar',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="toolbar" ref="el_toolbar">
            <div class="toolbar-row toolbar-row--primary" aria-label="Microscope controls">
                <div class="toolbar-group" aria-label="Image and movement">
                    <button class="toolbar-toggle toolbar-icon" @click="f_capture_image" aria-label="Capture Image"
                        title="Capture image — download the current camera frame"><ui_icon s_name="camera" /></button>
                    <button v-for="tool in a_o_quick" :key="tool.s_panel" class="toolbar-toggle toolbar-icon"
                        :class="{ active: o_state.o_panel_visibility[tool.s_panel], running: tool.s_panel === 'scan' && o_state.b_scanning }"
                        :aria-label="tool.s_label" :title="tool.s_title" :aria-pressed="!!o_state.o_panel_visibility[tool.s_panel]"
                        @click="f_toggle_panel(tool.s_panel)"><ui_icon :s_name="tool.s_icon" /></button>
                    <button class="toolbar-toggle toolbar-icon toolbar-mouse-jog" :class="{ active: o_state.b_enabled__mouse_jog }"
                        :aria-pressed="!!o_state.b_enabled__mouse_jog" aria-label="Mouse movement"
                        :title="'Mouse movement ' + (o_state.b_enabled__mouse_jog ? 'on' : 'off') + ' — hold left on the image for XY; right for focus'"
                        @click="f_mouse_jog"><ui_icon s_name="move" /></button>
                    <button class="toolbar-toggle toolbar-stop" :class="{ active: b_any_motor_running }"
                        @click="f_stop_all" aria-label="Stop all motors" title="Stop all motors immediately">
                        <ui_icon s_name="stop" /><span>Stop</span>
                    </button>
                </div>
                <div class="toolbar-group toolbar-group--camera">
                    <select class="toolbar-camera-select" v-model="o_state.s_id__webcam_device" @change="f_on_webcam_change"
                        aria-label="Camera" title="Select the microscope camera">
                        <option value="">Select camera</option>
                        <option v-for="o_dev in o_state.a_o_device__webcam" :key="o_dev.deviceId" :value="o_dev.deviceId">{{ o_dev.label || o_dev.deviceId }}</option>
                    </select>
                    <o_component__manual_speed v-if="!b_details" s_context="quick" :b_compact="true" />
                </div>
                <div class="toolbar-group toolbar-group--utilities">
                    <button class="toolbar-toggle toolbar-icon" @click="f_action_search" aria-label="Search actions"
                        title="Search all actions and shortcuts — Ctrl+F / F3"><ui_icon s_name="search" /></button>
                    <button class="toolbar-toggle toolbar-icon" :class="{ active: b_details }" @click="f_toggle_details"
                        aria-label="Quick settings" :aria-expanded="b_details" aria-controls="toolbar-details"
                        title="Quick settings — camera tuning, movement speeds, project and slide"><ui_icon s_name="settings" /></button>
                    <button class="toolbar-toggle toolbar-icon toolbar-setup" :class="{ active: o_state.o_panel_visibility.setup }"
                        @click="f_open_setup" aria-label="Setup" :aria-pressed="!!o_state.o_panel_visibility.setup"
                        :title="'Hardware setup — ' + s_connection_label + '. ' + s_hardware_summary">
                        <ui_icon s_name="setup" /><span class="toolbar-connection-dot" :class="{ connected: o_state.b_connected__esp }"></span>
                    </button>
                    <button ref="el_tools_button" class="toolbar-toggle toolbar-tools-toggle" :class="{ active: b_tools }"
                        @click="f_toggle_tools" aria-label="All tools" :aria-expanded="b_tools" aria-controls="toolbar-tools"
                        title="All tools — recording, image processing, library and hardware"><ui_icon s_name="tools" /><span>Tools</span></button>
                    <button v-if="b_fullscreen_available" class="toolbar-toggle toolbar-icon" @click="f_fullscreen"
                        :aria-label="b_fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'" :title="b_fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'">
                        <ui_icon :s_name="b_fullscreen ? 'restore' : 'fullscreen'" /></button>
                </div>
            </div>
            <div v-if="a_o_activity.length || o_state.o_record.b_running" class="toolbar-row toolbar-row--activity" aria-label="Active processes">
                <button v-if="o_state.o_record.b_running" class="toolbar-toggle toolbar-record-stop" @click="f_stop_recording"
                    aria-label="Stop time-lapse recording" title="Stop the running time-lapse recording">
                    <ui_icon s_name="stop" /> {{ o_state.o_record.n_its__frame__done }} frames
                </button>
                <button v-for="item in a_o_activity" :key="item.s_panel" class="toolbar-toggle running"
                    @click="f_toggle_panel(item.s_panel)" :title="'Open ' + item.s_label + ' controls'"><ui_icon :s_name="item.s_icon" />{{ item.s_label }}</button>
            </div>
            <div v-if="s_error || o_cam.s_error__setting" class="toolbar-error" role="alert">{{ s_error || o_cam.s_error__setting }}</div>

            <div id="toolbar-details" v-show="b_details" class="toolbar-details">
                <div class="toolbar-row toolbar-row--speed"><o_component__manual_speed s_context="toolbar" /></div>
                <!-- USB camera hardware quick bar (UVC settings, shown while streaming) -->
                <div class="toolbar-row toolbar-row--camera" v-if="o_state.o_camera.b_active">
                    <button class="toolbar-toggle toolbar-icon" @click="f_toggle_panel('camera_setting')" aria-label="Camera settings"
                        title="Camera settings — resolution, frame rate and all hardware controls"><ui_icon s_name="camera" /></button>
                    <template v-for="o_control in a_o_cam_control" :key="o_control.s_kind + ':' + o_control.s_api">
                        <div class="toolbar-cam-mode" v-if="o_control.s_kind === 'mode'">
                            <span class="toolbar-cam-label">{{ o_control.s_label }}</span>
                            <div class="mode-toggle mode-toggle--mini">
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam[o_control.s_local] === o_control.s_a_value[0] }"
                                    @click="f_cam_mode(o_control.s_api, o_control.s_a_value[0])"
                                    :disabled="!o_cam.o_capability[o_control.s_api]?.includes(o_control.s_a_value[0])"
                                    :title="o_control.s_a_title[0]" :aria-label="o_control.s_label + ': ' + o_control.s_a_title[0]" :aria-pressed="o_cam[o_control.s_local] === o_control.s_a_value[0]"
                                >{{ o_control.s_a_short[0] }}</button>
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam[o_control.s_local] === o_control.s_a_value[1] }"
                                    @click="f_cam_mode(o_control.s_api, o_control.s_a_value[1])"
                                    :disabled="!o_cam.o_capability[o_control.s_api]?.includes(o_control.s_a_value[1])"
                                    :title="o_control.s_a_title[1]" :aria-label="o_control.s_label + ': ' + o_control.s_a_title[1]" :aria-pressed="o_cam[o_control.s_local] === o_control.s_a_value[1]"
                                >{{ o_control.s_a_short[1] }}</button>
                            </div>
                        </div>
                        <label class="toolbar-cam-item" v-else :title="o_control.s_title">
                            <span class="toolbar-cam-label">{{ o_control.s_label }}</span>
                            <input
                                type="range"
                                class="toolbar-cam-range" :aria-label="o_control.s_title + ' slider'"
                                :min="o_control.o_range.min"
                                :max="o_control.o_range.max"
                                :step="o_control.o_range.step ?? 'any'"
                                v-model.number="o_cam[o_control.s_local]"
                                @input="f_cam_set(o_control.s_api, o_cam[o_control.s_local])"
                            >
                            <input
                                type="number"
                                class="toolbar-cam-value" :aria-label="o_control.s_title"
                                :min="o_control.o_range.min"
                                :max="o_control.o_range.max"
                                :step="o_control.o_range.step ?? 'any'"
                                v-model.number="o_cam[o_control.s_local]"
                                @change="f_cam_set(o_control.s_api, o_cam[o_control.s_local])"
                            >
                            <span class="toolbar-cam-unit" v-if="o_control.s_unit">{{ o_control.s_unit }}</span>
                        </label>
                    </template>
                    <span class="toolbar-camera-hint" v-if="!a_o_cam_control.length">no controllable settings reported by this camera</span>
                </div>

                <div class="toolbar-row toolbar-row--context">
                    <label class="toolbar-context-label" for="toolbar-project">Project</label>
                    <select
                        id="toolbar-project" class="toolbar-context-select"
                        :value="o_state.n_id__project__current"
                        @change="f_on_project_change"
                        title="current project"
                    >
                        <option :value="0">-- project --</option>
                        <option v-for="o_project in a_o_project" :key="o_project.n_id" :value="o_project.n_id">{{ o_project.s_name }}</option>
                    </select>

                    <label class="toolbar-context-label" for="toolbar-slide">Slide</label>
                    <select
                        id="toolbar-slide" class="toolbar-context-select toolbar-context-select--wide"
                        :value="o_state.n_id__slide__current"
                        @change="f_on_slide_change"
                        :disabled="!o_state.n_id__project__current"
                        title="current slide"
                    >
                        <option :value="0">-- slide --</option>
                        <option v-for="o_slide in a_o_slide__project" :key="o_slide.n_id" :value="o_slide.n_id">{{ o_slide.s_name }}</option>
                    </select>

                    <label class="toolbar-context-label" for="toolbar-map">Map</label>
                    <select
                        id="toolbar-map" class="toolbar-context-select toolbar-context-select--map"
                        :value="o_state.s_path_map__current"
                        @change="f_on_map_change"
                        title="current map"
                    >
                        <option value="">-- map --</option>
                        <option v-for="o_map in a_o_map__selectable" :key="o_map.s_path_map" :value="o_map.s_path_map">{{ o_map.s_label }}</option>
                    </select>
                    <button class="toolbar-toggle toolbar-icon" @click="f_on_refresh_maps" aria-label="Refresh maps" title="Refresh map list"><ui_icon s_name="refresh" /></button>
                </div>
                <div class="toolbar-row toolbar-row--hardware">
                    <button class="toolbar-toggle hardware-overview" @click="f_open_setup" aria-label="Hardware overview — open Setup">
                        <span v-for="o_item in a_o_hardware" :key="o_item.s_label" :class="'hardware-state--' + o_item.s_status" :title="o_item.s_detail">{{ o_item.s_label }}: {{ o_item.s_value }}</span>
                    </button>
                    <span class="conn-badge" :class="{ connected: o_state.b_connected__esp }"><span class="dot"></span>{{ s_connection_label }}</span>
                </div>
            </div>
            <section v-if="b_tools" id="toolbar-tools" ref="el_tools" class="toolbar-tools" aria-label="All tools">
                <div class="toolbar-tools-header"><span>All tools</span>
                    <button class="toolbar-toggle toolbar-icon" aria-label="Close tools" title="Close tools" @click="f_close_tools(true)"><ui_icon s_name="close" /></button>
                </div>
                <div class="toolbar-tools-groups">
                    <section v-for="group in a_o_tool_group" :key="group.s_label" :aria-label="group.s_label">
                        <h3>{{ group.s_label }}</h3>
                        <div class="toolbar-tool-grid">
                            <button v-for="tool in group.a_o_tool" :key="tool.s_panel" class="toolbar-toggle toolbar-tool"
                                :class="{ active: o_state.o_panel_visibility[tool.s_panel] }" :aria-pressed="!!o_state.o_panel_visibility[tool.s_panel]"
                                :title="tool.s_title" @click="f_choose_tool(tool.s_panel)"><ui_icon :s_name="tool.s_icon" /><span>{{ tool.s_label }}</span></button>
                        </div>
                    </section>
                </div>
            </section>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_details: false,
            b_tools: false,
            b_fullscreen: false,
            b_fullscreen_available: false,
            s_error: '',
            a_o_quick: [
                { s_panel: 'scan', s_icon: 'scan', s_label: 'Scan', s_title: 'Scan — define an area, focus and stitch images' },
                { s_panel: 'focus', s_icon: 'focus', s_label: 'Focus', s_title: 'Focus — live sharpness meter and autofocus controls' },
                { s_panel: 'zoom', s_icon: 'zoom', s_label: 'Zoom', s_title: 'Digital zoom — Ctrl + drag a box on the live image' },
            ],
            a_o_tool_group: [
                { s_label: 'Capture', a_o_tool: [
                    { s_panel: 'record', s_icon: 'record', s_label: 'Time-lapse', s_title: 'Record images at intervals, at one or more positions' },
                    { s_panel: 'video', s_icon: 'video', s_label: 'Video', s_title: 'Record real-time video, bursts or pre-roll' },
                    { s_panel: 'focus_stack', s_icon: 'stack', s_label: 'Focus stack', s_title: 'Combine images at different focus depths' },
                    { s_panel: 'manual_stitch', s_icon: 'scan', s_label: 'Manual stitch', s_title: 'Capture tiles manually and stitch them' },
                    { s_panel: 'autostitch', s_icon: 'scan', s_label: 'Auto stitch', s_title: 'Stitch images with feature matching' },
                ] },
                { s_label: 'Image', a_o_tool: [
                    { s_panel: 'camera_setting', s_icon: 'camera', s_label: 'Camera', s_title: 'Camera resolution, frame rate, exposure and white balance' },
                    { s_panel: 'filter', s_icon: 'filter', s_label: 'Filters', s_title: 'Adjust live image processing' },
                    { s_panel: 'flat', s_icon: 'flat', s_label: 'Flat field', s_title: 'Calibrate and correct uneven illumination' },
                    { s_panel: 'scale', s_icon: 'scale', s_label: 'Scale', s_title: 'Show a calibrated scale on the image' },
                    { s_panel: 'optics', s_icon: 'focus', s_label: 'Optics', s_title: 'Open the imaging controls overview' },
                ] },
                { s_label: 'Library', a_o_tool: [
                    { s_panel: 'slide_library', s_icon: 'slide', s_label: 'Slides', s_title: 'Organize projects and slides' },
                    { s_panel: 'map', s_icon: 'map', s_label: 'Map', s_title: 'View a stitched map and locate the current position' },
                    { s_panel: 'recording_library', s_icon: 'folder', s_label: 'Recordings', s_title: 'Browse, play and export recorded sessions' },
                ] },
                { s_label: 'Analysis', a_o_tool: [
                    { s_panel: 'cellpose', s_icon: 'cell', s_label: 'Cell pose', s_title: 'Segment cells in the camera image' },
                    { s_panel: 'training', s_icon: 'training', s_label: 'Train model', s_title: 'Annotate images and train a detection model' },
                    { s_panel: 'motion_detection', s_icon: 'detection', s_label: 'Motion detection', s_title: 'Detect changes in the camera image' },
                ] },
                { s_label: 'Movement', a_o_tool: [
                    { s_panel: 'gamepad', s_icon: 'gamepad', s_label: 'Gamepad', s_title: 'Configure a game controller' },
                    { s_panel: 'auto_move', s_icon: 'auto', s_label: 'Auto move', s_title: 'Configure automatic stage movement' },
                    { s_panel: 'macro', s_icon: 'macro', s_label: 'Macros', s_title: 'Record and replay movement sequences' },
                    { s_panel: 'stats', s_icon: 'stats', s_label: 'Motor stats', s_title: 'Inspect motor position and activity' },
                    { s_panel: 'focus_step', s_icon: 'focus', s_label: 'Focus step', s_title: 'Measure depth of field for focus stacking' },
                    { s_panel: 'motion', s_icon: 'move', s_label: 'Motion', s_title: 'Open the stage movement overview' },
                ] },
            ],
        };
    },
    computed: {
        s_hardware_summary() {
            return this.a_o_hardware.map(item => item.s_label + ': ' + item.s_value).join('; ');
        },
        a_o_activity() {
            return [
                { b_active: o_state.o_video.b_recording, s_panel: 'video', s_icon: 'video', s_label: 'Video recording' },
                { b_active: o_state.o_motion_detection.b_enabled, s_panel: 'motion_detection', s_icon: 'detection', s_label: 'Motion detection on' },
                { b_active: o_state.b_running__locate, s_panel: 'map', s_icon: 'map', s_label: 'Locating' },
                { b_active: o_state.o_flat_field.b_active, s_panel: 'flat', s_icon: 'flat', s_label: 'Flat field on' },
            ].filter(item => item.b_active);
        },
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
        f_action_search() { this.f_close_tools(); o_actions.f_invoke('actions.search'); },
        f_capture_image() { o_actions.f_invoke('image.capture'); },
        f_mouse_jog() { o_actions.f_invoke('motion.mouse'); },
        f_toggle_details() {
            this.b_details = !this.b_details;
            this.f_close_tools();
            try { localStorage.setItem('omm.toolbar.details', String(this.b_details)); } catch (_) {}
        },
        f_toggle_tools() {
            if (this.b_tools) return this.f_close_tools(true);
            this.b_tools = true;
            this.$nextTick(() => this.$refs.el_tools?.querySelector('button')?.focus());
        },
        f_close_tools(b_focus = false) {
            this.b_tools = false;
            if (b_focus) this.$refs.el_tools_button?.focus();
        },
        f_choose_tool(s_panel) {
            this.f_close_tools(true);
            this.f_toggle_panel(s_panel);
        },
        async f_fullscreen() {
            this.s_error = '';
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
            } catch (_) { this.s_error = 'Fullscreen is unavailable. Use your browser’s fullscreen command.'; }
        },
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
            const s_height = el_toolbar.offsetHeight + 'px';
            if (document.documentElement.style.getPropertyValue('--topbar-h') === s_height) return;
            document.documentElement.style.setProperty('--topbar-h', s_height);
            window.dispatchEvent(new Event('toolbar-resize'));
        },
        f_toggle_panel: function(s_name) {
            o_actions.f_invoke('panel.' + s_name);
        },
        f_stop_recording: function() {
            f_recording_stop();
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
        try { this.b_details = localStorage.getItem('omm.toolbar.details') === 'true'; } catch (_) {}
        this.b_fullscreen_available = !!document.fullscreenEnabled;
        this.f_on_fullscreen = () => { this.b_fullscreen = !!document.fullscreenElement; };
        this.f_on_fullscreen();
        this.f_on_outside = event => {
            if (this.b_tools && !this.$refs.el_tools?.contains(event.target) && !this.$refs.el_tools_button?.contains(event.target)) this.f_close_tools();
        };
        this.f_on_escape = event => {
            // Let Escape also reach the existing stop-all-motors handler.
            if (event.key === 'Escape' && this.b_tools) this.f_close_tools(true);
        };
        document.addEventListener('pointerdown', this.f_on_outside);
        document.addEventListener('keydown', this.f_on_escape);
        document.addEventListener('fullscreenchange', this.f_on_fullscreen);
        // Details and responsive wrapping must keep floating panels below the bar.
        if (typeof ResizeObserver !== 'undefined' && o_self.$refs.el_toolbar) {
            o_self.o_observer_resize = new ResizeObserver(function(){ o_self.f_update_topbar_height(); });
            o_self.o_observer_resize.observe(o_self.$refs.el_toolbar);
        }
        o_self.f_update_topbar_height();
        if (o_state.b_streaming__webcam) f_apply_camera__saved();
    },
    beforeUnmount: function() {
        if (this.o_observer_resize) this.o_observer_resize.disconnect();
        document.removeEventListener('pointerdown', this.f_on_outside);
        document.removeEventListener('keydown', this.f_on_escape);
        document.removeEventListener('fullscreenchange', this.f_on_fullscreen);
    },
};

export { o_component__toolbar };
