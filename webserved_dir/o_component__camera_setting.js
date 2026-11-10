import { o_state, f_save_setting__debounced } from './index.js';
import { f_apply_camera_resolution, f_apply_camera_setting, f_apply_camera_control, f_read_camera } from './o_camera.module.js';
import { o_component__icon } from './o_component__icon.js';
import { o_component__filter } from './o_component__filter.js';

let a_o_exposure_time = [
    { s_label: '1/1000', n_val: 10 },
    { s_label: '1/500',  n_val: 20 },
    { s_label: '1/250',  n_val: 40 },
    { s_label: '1/125',  n_val: 80 },
    { s_label: '1/60',   n_val: 167 },
    { s_label: '1/30',   n_val: 333 },
    { s_label: '1/15',   n_val: 667 },
    { s_label: '1/8',    n_val: 1250 },
    { s_label: '1/4',    n_val: 2500 },
    { s_label: '1/2',    n_val: 5000 },
    { s_label: '1s',     n_val: 10000 },
];

// index of the coarse exposure time nearest to n_time, compared in stops
let f_n_idx__exposure_time = function(n_time) {
    let a_n_stop = a_o_exposure_time.map(function(o) { return Math.abs(Math.log2(o.n_val / n_time)); });
    return Math.max(0, a_n_stop.indexOf(Math.min(...a_n_stop)));
};

let a_n_fps = [5, 10, 15, 20, 25, 30, 60, 120];

// offered only while the real sensor sizes are unknown (o_camera.a_o_mode is empty)
let a_o_resolution__generic = [
    { n_scl_x: 640,  n_scl_y: 480  },
    { n_scl_x: 1280, n_scl_y: 720  },
    { n_scl_x: 1920, n_scl_y: 1080 },
    { n_scl_x: 2560, n_scl_y: 1440 },
    { n_scl_x: 3840, n_scl_y: 2160 },
];

// the Camera window: hardware settings, with the image filter (histogram,
// exposure markers, processing) below. draft layout, not drawn by hand yet.
let o_component__camera_setting = {
    name: 'component-camera-setting',
    components: { ui_icon: o_component__icon, o_component__filter },
    template: `
        <div class="overlay-panel panel-camera-setting" :class="{ visible: o_state.o_panel_visibility.camera_setting }">
            <div class="panel-header">
                <h2><ui_icon s_name="camera" /> Camera</h2>
                <span class="panel-state" v-if="o_cam.b_active" data-tooltip="Camera frame size">{{ o_cam.n_width }} &times; {{ o_cam.n_height }}</span>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div v-if="!o_cam.b_active" class="camera-setting-placeholder">No camera stream active</div>
                <div v-else class="camera-setting-stack">

                    <div class="cam-setting-row" data-tooltip="Frame rate&#10;Frames per second delivered by the camera.">
                        <span class="cam-setting-icon--text">FPS</span>
                        <select class="cam-setting-select" :value="n_fps__selected" @change="f_apply_camera_resolution(o_cam.n_width, o_cam.n_height, Number($event.target.value))">
                            <option v-for="n in a_n_fps" :key="n" :value="n">{{ n }}</option>
                        </select>
                    </div>

                    <div class="cam-setting-row" data-tooltip="Resolution&#10;Capture size of the camera in pixels.">
                        <ui_icon class="cam-setting-icon" s_name="scan" />
                        <select class="cam-setting-select" :value="o_cam.n_width + 'x' + o_cam.n_height" @change="f_apply_resolution($event.target.value)">
                            <option v-for="o in a_o_resolution" :key="o.n_scl_x + 'x' + o.n_scl_y" :value="o.n_scl_x + 'x' + o.n_scl_y">{{ o.n_scl_x }} &times; {{ o.n_scl_y }}</option>
                        </select>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.exposureMode" data-tooltip="Exposure mode&#10;M: manual exposure time. auto: the camera adapts to the brightness. Use manual for focus, scans and stacks.">
                        <ui_icon class="cam-setting-icon" s_name="brightness" />
                        <div class="mode-toggle">
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__exposure === 'manual' }"
                                @click="f_apply_camera_setting('exposureMode', 'manual')">M</button>
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__exposure !== 'manual' }"
                                @click="f_apply_camera_setting('exposureMode', 'continuous')">auto</button>
                        </div>
                    </div>

                    <template v-if="o_cap.exposureTime && o_cam.s_mode__exposure === 'manual'">
                        <div class="cam-setting-row" data-tooltip="Exposure time&#10;How long the sensor collects light per frame.">
                            <ui_icon class="cam-setting-icon" s_name="record" />
                            <select class="cam-setting-select" :value="n_exposure_time__selected" @change="f_apply_camera_setting('exposureTime', Number($event.target.value))">
                                <option v-for="o in a_o_exposure_time" :key="o.n_val" :value="o.n_val">{{ o.s_label }}</option>
                            </select>
                        </div>
                        <div class="cam-setting-row" data-tooltip="Exposure fine tune&#10;Lengthen or shorten the selected exposure time. Centre: exactly the selected time. Each end: halfway to the neighbouring time.">
                            <span class="cam-setting-icon--text">&plusmn;</span>
                            <input type="range" aria-label="Exposure fine tune"
                                :min="a_n_stop__limit[0]" :max="a_n_stop__limit[1]" step="any"
                                :value="n_stop__exposure"
                                class="cam-setting-range"
                                @change="f_apply_exposure_stop(Number($event.target.value))" />
                            <span class="cam-setting-value">{{ (o_cam.n_time__exposure / 10).toFixed(1) }} ms</span>
                        </div>
                    </template>

                    <div class="cam-setting-row" v-for="o_control in o_cam.a_o_control" :key="o_control.s_name" :data-tooltip="o_control.s_tooltip">
                        <span class="cam-setting-icon--text">{{ o_control.s_label }}</span>
                        <input type="range" :aria-label="o_control.s_label"
                            :min="o_control.n_min" :max="o_control.n_max" :step="o_control.n_step"
                            :value="o_control.n_val" :disabled="o_control.b_inactive"
                            class="cam-setting-range"
                            @change="f_apply_camera_control(o_control.s_name, Number($event.target.value))" />
                        <span class="cam-setting-value">{{ o_control.n_val }}</span>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.whiteBalanceMode" data-tooltip="White balance mode&#10;M: fixed colour temperature. auto: the camera adapts the colours.">
                        <span class="cam-setting-icon--text">WB</span>
                        <div class="mode-toggle">
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__white_balance === 'manual' }"
                                @click="f_apply_camera_setting('whiteBalanceMode', 'manual')">M</button>
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__white_balance !== 'manual' }"
                                @click="f_apply_camera_setting('whiteBalanceMode', 'continuous')">auto</button>
                        </div>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.colorTemperature && o_cam.s_mode__white_balance === 'manual'" data-tooltip="Colour temperature (K)&#10;Lower is warmer, higher is cooler.">
                        <span class="cam-setting-icon--text">WB</span>
                        <input type="range"
                            :min="o_cap.colorTemperature.min" :max="o_cap.colorTemperature.max"
                            :step="o_cap.colorTemperature.step ?? 'any'"
                            :value="o_cam.n_temperature__color"
                            class="cam-setting-range"
                            @change="f_apply_camera_setting('colorTemperature', Number($event.target.value))" />
                        <span class="cam-setting-value">{{ o_cam.n_temperature__color }}</span>
                    </div>

                    <p v-if="o_cam.s_error__setting || o_cam.s_error__resolution" role="alert" class="cam-setting-error">
                        {{ o_cam.s_error__setting || o_cam.s_error__resolution }}
                    </p>

                </div>
                <o_component__filter />
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            a_o_exposure_time: a_o_exposure_time,
            a_n_fps: a_n_fps,
        };
    },
    computed: {
        o_cam: function() { return o_state.o_camera; },
        o_cap: function() { return o_state.o_camera.o_capability; },
        n_fps__selected: function() {
            let n = Math.round(this.o_cam.n_frame_rate);
            return a_n_fps.includes(n) ? n : a_n_fps[4];
        },
        // the live size is always an entry, so the list never shows a size the camera is not delivering
        a_o_resolution: function() {
            let o_cam = this.o_cam;
            let a_o_resolution = o_cam.a_o_mode.length ? o_cam.a_o_mode : a_o_resolution__generic;
            let b_listed = a_o_resolution.some(function(o) { return o.n_scl_x === o_cam.n_width && o.n_scl_y === o_cam.n_height; });
            return b_listed ? a_o_resolution : [...a_o_resolution, { n_scl_x: o_cam.n_width, n_scl_y: o_cam.n_height }];
        },
        n_idx__exposure_time: function() {
            return f_n_idx__exposure_time(this.o_cam.n_time__exposure);
        },
        n_exposure_time__selected: function() {
            return a_o_exposure_time[this.n_idx__exposure_time].n_val;
        },
        // fine tune in stops: the live exposure time relative to the selected coarse time
        n_stop__exposure: function() {
            return Math.log2(this.o_cam.n_time__exposure / this.n_exposure_time__selected) || 0;
        },
        // the fine slider reaches halfway to the neighbouring coarse times, so every time has one place
        a_n_stop__limit: function() {
            let n_idx = this.n_idx__exposure_time;
            return [-1, 1].map(function(n_off) {
                let o_neighbour = a_o_exposure_time[n_idx + n_off];
                return o_neighbour ? Math.log2(o_neighbour.n_val / a_o_exposure_time[n_idx].n_val) / 2 : n_off / 2;
            });
        },
    },
    watch: {
        'o_state.o_panel_visibility.camera_setting': {
            immediate: true,
            handler: function(b_visible) {
                if (b_visible && o_state.b_streaming__webcam) f_read_camera();
            },
        },
    },
    methods: {
        f_apply_camera_setting,
        f_apply_camera_control,
        f_apply_camera_resolution,
        f_apply_exposure_stop: function(n_stop) {
            let o_range = this.o_cap.exposureTime;
            let n_step = o_range.step || 1;
            let n_time__coarse = this.n_exposure_time__selected;
            // whole camera steps, rounded towards the coarse time so the selection never flips at the slider end
            let n_time = n_time__coarse + Math.trunc(n_time__coarse * (2 ** n_stop - 1) / n_step) * n_step;
            return f_apply_camera_setting('exposureTime', Math.min(o_range.max, Math.max(o_range.min, n_time)));
        },
        f_apply_resolution: function(s_resolution) {
            let [n_scl_x, n_scl_y] = s_resolution.split('x').map(Number);
            return f_apply_camera_resolution(n_scl_x, n_scl_y, this.o_cam.n_frame_rate || null);
        },
        f_close: function() {
            o_state.o_panel_visibility.camera_setting = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
    },
};

export { o_component__camera_setting };
