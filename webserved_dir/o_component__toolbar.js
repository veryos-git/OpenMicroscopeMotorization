import { f_install_tooltips } from './tooltips.module.js';
import { o_component__icon } from './o_component__icon.js';
import { o_actions } from './o_actions.js';
import { o_state, f_save_setting__debounced, f_save_library_current, f_refresh_maps } from './index.js';
import { f_apply_camera__saved } from './o_camera.module.js';
import { f_recording_stop } from './o_recording.module.js';
import { f_a_changed_controls, f_reset_control, f_reset_title, o_control_ui } from './control_catalog.module.js';

let o_component__toolbar = {
    name: 'component-toolbar',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="toolbar" ref="el_toolbar">
            <div class="toolbar-row toolbar-row--primary" role="toolbar" aria-label="Microscope controls">
                <div class="toolbar-shortcuts" aria-label="Pinned tools and active settings" @wheel="f_scroll_shortcuts">
                    <button v-for="tool in a_o_quick" :key="tool.s_panel" class="toolbar-toggle toolbar-icon toolbar-shortcut"
                        :class="{ active: f_tool_active(tool.s_panel), running: f_tool_running(tool.s_panel) }"
                        :aria-label="tool.s_label" :title="f_tool_title(tool) + ' · Right-click to unpin'" :data-tooltip="f_tool_title(tool) + ' · Right-click to unpin'"
                        :aria-pressed="f_tool_active(tool.s_panel)" :data-tool="tool.s_panel"
                        @contextmenu.prevent="f_toggle_pin(tool.s_panel)" @click="f_run_tool(tool.s_panel)">
                        <ui_icon :s_name="tool.s_icon" />
                        <span v-if="tool.s_panel === 'setup'" class="toolbar-connection-dot" :class="{ connected: o_state.b_connected__esp }"></span>
                    </button>
                    <span v-if="a_o_changed.length || a_o_activity.length || o_state.o_record.b_running" class="toolbar-sep" aria-hidden="true"></span>
                    <button v-for="item in a_o_changed" :key="item.id" class="toolbar-toggle toolbar-icon toolbar-setting-reset"
                        data-control-skip :aria-label="'Reset ' + item.name" :title="f_reset_title(item)" :data-tooltip="f_reset_title(item)"
                        @click="f_reset_control(item)"><ui_icon :s_name="item.icon" /><span class="setting-reset-mark" aria-hidden="true">×</span></button>
                    <button v-if="o_state.o_record.b_running" class="toolbar-toggle toolbar-icon toolbar-record-stop" @click="f_stop_recording"
                        aria-label="Stop time-lapse recording" :title="'Stop time-lapse · ' + o_state.o_record.n_its__frame__done + ' frames'"
                        :data-tooltip="'Stop time-lapse · ' + o_state.o_record.n_its__frame__done + ' frames'"><ui_icon s_name="record" /></button>
                    <button v-for="item in a_o_activity" :key="item.s_panel" class="toolbar-toggle toolbar-icon running"
                        @click="f_toggle_panel(item.s_panel)" :aria-label="item.s_label" :title="item.s_label" :data-tooltip="item.s_label"><ui_icon :s_name="item.s_icon" /></button>
                </div>
                <div class="toolbar-group toolbar-group--camera">
                    <o_component__manual_speed s_context="quick" :b_compact="true" />
                    <label class="toolbar-select" :data-tooltip="'USB camera · ' + s_camera_label" :title="'USB camera · ' + s_camera_label">
                        <ui_icon s_name="camera" /><span aria-hidden="true">{{ f_short_label(s_camera_label) }}</span><ui_icon s_name="chevron" />
                        <select class="toolbar-camera-select" v-model="o_state.s_id__webcam_device" @change="f_on_webcam_change" aria-label="Camera" :title="s_camera_label">
                            <option value="">Select camera</option>
                            <option v-for="o_dev in o_state.a_o_device__webcam" :key="o_dev.deviceId" :value="o_dev.deviceId">{{ o_dev.label || o_dev.deviceId }}</option>
                        </select>
                    </label>
                    <button class="toolbar-toggle toolbar-icon" :class="{ active: o_state.o_panel_visibility.led_setting }"
                        @click="f_toggle_panel('led_setting')" aria-label="LED settings" :aria-pressed="!!o_state.o_panel_visibility.led_setting"
                        title="LED · red, green, blue and warm/cold white" data-tooltip="LED · red, green, blue and warm/cold white"><ui_icon s_name="led" /></button>
                </div>
                <div class="toolbar-group toolbar-group--utilities">
                    <button class="toolbar-toggle toolbar-icon toolbar-stop" :class="{ active: b_any_motor_running }"
                        @click="f_stop_all" aria-label="Stop all motors" title="Stop all motors · Esc" data-tooltip="Stop all motors · Esc"><ui_icon s_name="stop" /></button>
                    <button ref="el_tools_button" class="toolbar-toggle toolbar-icon" :class="{ active: b_tools }"
                        @click="f_toggle_tools" aria-label="All tools" :aria-expanded="b_tools" aria-controls="toolbar-tools"
                        title="All tools" data-tooltip="All tools"><ui_icon s_name="tools" /></button>
                    <button class="toolbar-toggle toolbar-icon" @click="f_action_search" aria-label="Search actions"
                        title="Search settings and actions · Ctrl+Shift+P" data-tooltip="Search settings and actions · Ctrl+Shift+P"><ui_icon s_name="search" /></button>
                </div>
            </div>
        </div>
        <span class="sr-only" role="status">{{ s_pin_notice }}</span>
        <section class="overlay-panel panel-toolbar-notice" :class="{ visible: s_error || o_cam.s_error__setting || o_control_ui.notice }" aria-label="Notice">
            <div class="panel-header"><h2>Notice</h2><button class="panel-close" @click="f_clear_notice" aria-label="Dismiss notice">×</button></div>
            <div class="panel-body"><p v-if="s_error || o_cam.s_error__setting" class="toolbar-error" role="alert">{{ s_error || o_cam.s_error__setting }}</p>
                <p v-if="o_control_ui.notice" role="status">{{ o_control_ui.notice }}</p></div>
        </section>
        <section id="toolbar-details" class="overlay-panel toolbar-details" :class="{ visible: b_details }" aria-label="Quick settings">
            <div class="panel-header"><h2><ui_icon s_name="settings" /> Quick settings</h2><span class="panel-drag-hint" title="Drag to move"><ui_icon s_name="move" /></span>
                <button class="panel-close" @click="b_details = false" aria-label="Close quick settings">×</button></div>
            <div class="panel-body">
                <div class="toolbar-row toolbar-row--speed"><o_component__manual_speed s_context="toolbar" /></div>
                <!-- USB camera quick access (shown while streaming) -->
                <div class="toolbar-row toolbar-row--camera" v-if="o_state.o_camera.b_active">
                    <button class="toolbar-toggle toolbar-icon" @click="f_toggle_panel('camera_setting')" aria-label="Camera settings"
                        title="Camera settings — FPS, resolution, exposure and white balance"><ui_icon s_name="camera" /></button>
                    <span class="toolbar-camera-hint">{{ o_cam.n_width }}×{{ o_cam.n_height }} · {{ Math.round(o_cam.n_frame_rate) }} fps</span>
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
        </section>
        <section id="toolbar-tools" ref="el_tools" class="overlay-panel toolbar-tools" :class="{ visible: b_tools }" aria-label="All tools">
            <div class="panel-header"><h2><ui_icon s_name="tools" /> Tools</h2><span class="panel-drag-hint" title="Drag to move"><ui_icon s_name="move" /></span>
                <button class="panel-close" aria-label="Close tools" title="Close tools" @click="f_close_tools(true)">×</button></div>
            <div class="panel-body">
                <p class="toolbar-pin-hint">Right-click a tool to pin it to the bar.</p>
                <div class="toolbar-tools-groups">
                    <section v-for="group in a_o_tool_group" :key="group.s_label" :aria-label="group.s_label">
                        <h3>{{ group.s_label }}</h3>
                        <div class="toolbar-tool-grid">
                            <div v-for="tool in group.a_o_tool" :key="tool.s_panel" class="toolbar-tool-item" :class="{ pinned: a_s_pinned.includes(tool.s_panel) }">
                                <button class="toolbar-toggle toolbar-tool" :data-tool="tool.s_panel"
                                    :class="{ active: f_tool_active(tool.s_panel), running: f_tool_running(tool.s_panel) }" :aria-pressed="f_tool_active(tool.s_panel)"
                                    :title="f_tool_title(tool)" :data-tooltip="f_tool_title(tool)" :aria-label="tool.s_label"
                                    @contextmenu.prevent="f_toggle_pin(tool.s_panel)" @click="f_choose_tool(tool.s_panel)"><ui_icon :s_name="tool.s_icon" /><span>{{ tool.s_label }}</span></button>
                                <button class="toolbar-pin" data-control-skip :aria-label="(a_s_pinned.includes(tool.s_panel) ? 'Unpin ' : 'Pin ') + tool.s_label"
                                    :aria-pressed="a_s_pinned.includes(tool.s_panel)" :data-tooltip="a_s_pinned.includes(tool.s_panel) ? 'Unpin from bar' : 'Pin to bar'"
                                    @click="f_toggle_pin(tool.s_panel)"><ui_icon s_name="pin" /></button>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </section>
    `,
    data: function() {
        return {
            o_state: o_state,
            o_control_ui,
            b_details: false,
            b_tools: false,
            b_fullscreen: false,
            s_error: '',
            a_s_pinned: ['capture', 'scan', 'focus', 'zoom', 'mouse', 'setup'],
            s_pin_notice: '',
            a_o_tool_group: [
                { s_label: 'Capture', a_o_tool: [
                    { s_panel: 'capture', s_icon: 'camera', s_label: 'Capture Image', s_title: 'Download the current camera frame' },
                    { s_panel: 'scan', s_icon: 'scan', s_label: 'Scan', s_title: 'Define an area, focus and stitch images' },
                    { s_panel: 'record', s_icon: 'record', s_label: 'Time-lapse', s_title: 'Record images at intervals, at one or more positions' },
                    { s_panel: 'video', s_icon: 'video', s_label: 'Video', s_title: 'Record real-time video, bursts or pre-roll' },
                    { s_panel: 'focus_stack', s_icon: 'stack', s_label: 'Focus stack', s_title: 'Combine images at different focus depths' },
                    { s_panel: 'manual_stitch', s_icon: 'scan', s_label: 'Manual stitch', s_title: 'Capture tiles manually and stitch them' },
                    { s_panel: 'autostitch', s_icon: 'scan', s_label: 'Auto stitch', s_title: 'Stitch images with feature matching' },
                ] },
                { s_label: 'Image', a_o_tool: [
                    { s_panel: 'zoom', s_icon: 'zoom', s_label: 'Zoom', s_title: 'Digital zoom · Ctrl + drag on the image' },
                    { s_panel: 'camera_setting', s_icon: 'camera', s_label: 'Camera', s_title: 'Camera resolution, frame rate, exposure and white balance' },
                    { s_panel: 'led_setting', s_icon: 'led', s_label: 'LED', s_title: 'LED · red, green, blue and warm/cold white' },
                    { s_panel: 'filter', s_icon: 'filter', s_label: 'Filters', s_title: 'Adjust live image processing' },
                    { s_panel: 'calibration', s_icon: 'calibration', s_label: 'Calibration', s_title: 'Scale (µm/px) and flat-field correction' },
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
                    { s_panel: 'focus', s_icon: 'focus', s_label: 'Focus', s_title: 'Sharpness meter and autofocus' },
                    { s_panel: 'mouse', s_icon: 'move', s_label: 'Mouse movement', s_title: 'Hold left on the image for XY; right for focus' },
                    { s_panel: 'gamepad', s_icon: 'gamepad', s_label: 'Gamepad', s_title: 'Configure a game controller' },
                    { s_panel: 'auto_move', s_icon: 'auto', s_label: 'Auto move', s_title: 'Configure automatic stage movement' },
                    { s_panel: 'macro', s_icon: 'macro', s_label: 'Macros', s_title: 'Record and replay movement sequences' },
                    { s_panel: 'stats', s_icon: 'stats', s_label: 'Motor stats', s_title: 'Inspect motor position and activity' },
                    { s_panel: 'focus_step', s_icon: 'focus', s_label: 'Focus step', s_title: 'Measure depth of field for focus stacking' },
                    { s_panel: 'motion', s_icon: 'move', s_label: 'Motion', s_title: 'Open the stage movement overview' },
                ] },
                { s_label: 'Workspace', a_o_tool: [
                    { s_panel: 'setup', s_icon: 'chip', s_label: 'Setup', s_title: 'Microcontroller settings · ESP32 connections, motors and LED' },
                    { s_panel: 'quick_settings', s_icon: 'settings', s_label: 'Quick settings', s_title: 'Movement speeds, camera tuning, project and slide' },
                    { s_panel: 'fullscreen', s_icon: 'fullscreen', s_label: 'Fullscreen', s_title: 'Toggle fullscreen' },
                ] },
            ],
        };
    },
    computed: {
        a_o_changed() {
            const changed = f_a_changed_controls();
            if (o_state.b_enabled__mouse_jog) changed.push({
                id: 'mouse.enabled', name: 'Mouse movement', icon: 'move', value: true, before: false,
                reset: () => this.f_mouse_jog(),
            });
            return changed;
        },
        a_o_quick() {
            const tools = this.a_o_tool_group.flatMap(group => group.a_o_tool);
            return this.a_s_pinned.map(id => tools.find(tool => tool.s_panel === id)).filter(Boolean);
        },
        s_camera_label() {
            const device = o_state.a_o_device__webcam.find(device => device.deviceId === o_state.s_id__webcam_device);
            return device?.label || device?.deviceId || 'Select camera';
        },
        a_o_activity() {
            return [
                { b_active: o_state.o_video.b_recording, s_panel: 'video', s_icon: 'video', s_label: 'Video recording' },
                { b_active: o_state.o_motion_detection.b_enabled, s_panel: 'motion_detection', s_icon: 'detection', s_label: 'Motion detection on' },
                { b_active: o_state.b_running__locate, s_panel: 'map', s_icon: 'map', s_label: 'Locating' },
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
        s_connection_label: function() {
            if (!o_state.b_connected__esp) return 'disconnected';
            return 'connected (USB)';
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
        f_scroll_shortcuts(event) {
            const el = event.currentTarget;
            if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
            event.preventDefault();
            el.scrollLeft += event.deltaY;
        },
        f_short_label(label) { return label.length > 3 ? label.slice(0, 3) + '…' : label; },
        f_tool_active(id) {
            if (id === 'mouse') return !!o_state.b_enabled__mouse_jog;
            if (id === 'quick_settings') return this.b_details;
            if (id === 'fullscreen') return this.b_fullscreen;
            return !!o_state.o_panel_visibility[id];
        },
        f_tool_running(id) {
            return (id === 'scan' && o_state.b_scanning) || (id === 'record' && o_state.o_record.b_running)
                || this.a_o_activity.some(item => item.s_panel === id);
        },
        f_tool_title(tool) {
            if (tool.s_panel === 'setup') return tool.s_title + ' · ' + this.s_connection_label;
            if (tool.s_panel === 'mouse') return tool.s_title + ' · ' + (o_state.b_enabled__mouse_jog ? 'On' : 'Off');
            return tool.s_label + ' · ' + tool.s_title;
        },
        f_toggle_pin(id) {
            const tool = this.a_o_tool_group.flatMap(group => group.a_o_tool).find(tool => tool.s_panel === id);
            if (!tool) return;
            const pinned = this.a_s_pinned.includes(id);
            this.a_s_pinned = pinned ? this.a_s_pinned.filter(value => value !== id) : [...this.a_s_pinned, id];
            this.s_pin_notice = tool.s_label + (pinned ? ' unpinned from bar' : ' pinned to bar');
            try { localStorage.setItem('omm.toolbar.pins', JSON.stringify(this.a_s_pinned)); }
            catch (_) { this.s_pin_notice += '. Could not save shortcuts in this browser.'; }
        },
        f_run_tool(id) {
            if (id === 'capture') return this.f_capture_image();
            if (id === 'mouse') return this.f_mouse_jog();
            if (id === 'setup') return this.f_open_setup();
            if (id === 'quick_settings') return this.f_toggle_details();
            if (id === 'fullscreen') return this.f_fullscreen();
            this.f_toggle_panel(id);
        },
        f_clear_notice() { this.s_error = ''; this.o_cam.s_error__setting = ''; o_control_ui.notice = ''; },
        f_reset_control,
        f_reset_title,
        f_show_quick_settings() { this.b_details = true; },
        f_show_tools() { this.b_tools = true; },
        f_action_search() { this.f_close_tools(); o_actions.f_invoke('actions.search'); },
        f_capture_image() { o_actions.f_invoke('image.capture'); },
        f_mouse_jog() { o_actions.f_invoke('motion.mouse'); },
        f_toggle_details() {
            this.b_details = !this.b_details;
            this.f_close_tools();
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
            this.f_run_tool(s_panel);
        },
        async f_fullscreen() {
            this.s_error = '';
            try {
                if (document.fullscreenElement) await document.exitFullscreen();
                else await document.documentElement.requestFullscreen();
            } catch (_) { this.s_error = 'Fullscreen is unavailable. Use your browser’s fullscreen command.'; }
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
        window.addEventListener('control-show-quick-settings', this.f_show_quick_settings);
        window.addEventListener('control-show-tools', this.f_show_tools);
        if(o_state.b_connected__server) f_refresh_maps();
        let o_self = this;
        this.f_remove_tooltips = f_install_tooltips();
        try {
            const saved = JSON.parse(localStorage.getItem('omm.toolbar.pins'));
            const ids = new Set(this.a_o_tool_group.flatMap(group => group.a_o_tool.map(tool => tool.s_panel)));
            if (Array.isArray(saved)) this.a_s_pinned = [...new Set(saved.filter(id => ids.has(id)))];
        } catch (_) {}
        this.f_on_fullscreen = () => { this.b_fullscreen = !!document.fullscreenElement; };
        this.f_on_fullscreen();
        this.f_on_escape = event => {
            // Let Escape also reach the existing stop-all-motors handler.
            if (event.key === 'Escape' && this.b_tools) this.f_close_tools(true);
        };
        document.addEventListener('keydown', this.f_on_escape);
        document.addEventListener('fullscreenchange', this.f_on_fullscreen);
        // Keep floating windows below the single toolbar row.
        if (typeof ResizeObserver !== 'undefined' && o_self.$refs.el_toolbar) {
            o_self.o_observer_resize = new ResizeObserver(function(){ o_self.f_update_topbar_height(); });
            o_self.o_observer_resize.observe(o_self.$refs.el_toolbar);
        }
        o_self.f_update_topbar_height();
        if (o_state.b_streaming__webcam) f_apply_camera__saved();
    },
    beforeUnmount: function() {
        window.removeEventListener('control-show-quick-settings', this.f_show_quick_settings);
        window.removeEventListener('control-show-tools', this.f_show_tools);
        if (this.o_observer_resize) this.o_observer_resize.disconnect();
        this.f_remove_tooltips?.();
        document.removeEventListener('keydown', this.f_on_escape);
        document.removeEventListener('fullscreenchange', this.f_on_fullscreen);
    },
};

export { o_component__toolbar };
