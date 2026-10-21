import { o_state, f_save_setting__debounced } from './index.js';
import { f_apply_camera_resolution, f_apply_camera_setting, f_set_camera_mode, f_read_camera } from './o_camera.module.js';
import { o_component__icon } from './o_component__icon.js';

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

let a_n_fps = [5, 10, 15, 20, 25, 30, 60, 120];

let a_o_resolution = [
    { s_label: '640 × 480',   n_w: 640,  n_h: 480  },
    { s_label: '1280 × 720',  n_w: 1280, n_h: 720  },
    { s_label: '1920 × 1080', n_w: 1920, n_h: 1080 },
    { s_label: '2560 × 1440', n_w: 2560, n_h: 1440 },
    { s_label: '3840 × 2160', n_w: 3840, n_h: 2160 },
];

let o_component__camera_setting = {
    name: 'component-camera-setting',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="overlay-panel panel-camera-setting" :class="{ visible: o_state.o_panel_visibility.camera_setting }">
            <div class="panel-header">
                <h2><ui_icon s_name="camera" /> USB Camera</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div v-if="!o_cam.b_active" class="camera-setting-placeholder">No camera stream active</div>
                <div v-else class="camera-setting-stack">

                    <div class="cam-setting-row">
                        <span class="cam-setting-icon--text">FPS</span>
                        <select class="cam-setting-select" :value="n_fps__selected" @change="f_apply_fps($event.target.value)">
                            <option v-for="n in a_n_fps" :key="n" :value="n">{{ n }}</option>
                        </select>
                    </div>

                    <div class="cam-setting-row">
                        <ui_icon class="cam-setting-icon" s_name="scan" />
                        <select class="cam-setting-select" :value="s_resolution__selected" @change="f_apply_res($event.target.value)">
                            <option v-for="o in a_o_resolution" :key="o.s_label" :value="o.s_label">{{ o.s_label }}</option>
                        </select>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.exposureMode">
                        <ui_icon class="cam-setting-icon" s_name="brightness" />
                        <div class="mode-toggle">
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__exposure === 'manual' }"
                                @click="f_set_exposure_mode('manual')">M</button>
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__exposure !== 'manual' }"
                                @click="f_set_exposure_mode('continuous')">auto</button>
                        </div>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.exposureTime && o_cam.s_mode__exposure === 'manual'">
                        <ui_icon class="cam-setting-icon" s_name="record" />
                        <select class="cam-setting-select" :value="n_exposure_time__selected" @change="f_apply_exposure_time($event.target.value)">
                            <option v-for="o in a_o_exposure_time" :key="o.n_val" :value="o.n_val">{{ o.s_label }}</option>
                        </select>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.whiteBalanceMode">
                        <span class="cam-setting-icon--text">WB</span>
                        <div class="mode-toggle">
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__white_balance === 'manual' }"
                                @click="f_set_wb_mode('manual')">M</button>
                            <button class="mode-btn" :class="{ active: o_cam.s_mode__white_balance !== 'manual' }"
                                @click="f_set_wb_mode('continuous')">auto</button>
                        </div>
                    </div>

                    <div class="cam-setting-row" v-if="o_cap.colorTemperature && o_cam.s_mode__white_balance === 'manual'">
                        <span class="cam-setting-icon--text">WB</span>
                        <input type="range"
                            :min="o_cap.colorTemperature.min" :max="o_cap.colorTemperature.max"
                            :step="o_cap.colorTemperature.step ?? 'any'"
                            :value="o_cam.n_temperature__color"
                            class="cam-setting-range"
                            @change="f_apply_color_temp(Number($event.target.value))" />
                        <span class="cam-setting-value">{{ o_cam.n_temperature__color }}</span>
                    </div>

                    <p v-if="o_cam.s_error__setting || o_cam.s_error__resolution" role="alert" class="cam-setting-error">
                        {{ o_cam.s_error__setting || o_cam.s_error__resolution }}
                    </p>

                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            a_o_exposure_time: a_o_exposure_time,
            a_n_fps: a_n_fps,
            a_o_resolution: a_o_resolution,
        };
    },
    computed: {
        o_cam: function() { return o_state.o_camera; },
        o_cap: function() { return o_state.o_camera.o_capability; },
        n_fps__selected: function() {
            let n = Math.round(this.o_cam.n_frame_rate);
            return a_n_fps.includes(n) ? n : a_n_fps[4];
        },
        s_resolution__selected: function() {
            let n_w = this.o_cam.n_width;
            let n_h = this.o_cam.n_height;
            let o_match = a_o_resolution.find(function(o) { return o.n_w === n_w && o.n_h === n_h; });
            return o_match ? o_match.s_label : a_o_resolution[2].s_label;
        },
        n_exposure_time__selected: function() {
            let n = this.o_cam.n_time__exposure;
            return a_o_exposure_time.reduce(function(o_best, o) {
                return Math.abs(o.n_val - n) < Math.abs(o_best.n_val - n) ? o : o_best;
            }, a_o_exposure_time[0]).n_val;
        },
    },
    watch: {
        'o_state.o_panel_visibility.camera_setting': function(b_visible) {
            if (b_visible && o_state.b_streaming__webcam) f_read_camera();
        },
    },
    methods: {
        f_apply_fps: async function(v) {
            let n = Number(v);
            await f_apply_camera_resolution(this.o_cam.n_width, this.o_cam.n_height, n);
        },
        f_apply_res: async function(s_label) {
            let o = a_o_resolution.find(function(o) { return o.s_label === s_label; });
            if (!o) return;
            await f_apply_camera_resolution(o.n_w, o.n_h, this.o_cam.n_frame_rate || null);
        },
        f_apply_exposure_time: async function(v) {
            await f_apply_camera_setting('exposureTime', Number(v));
        },
        f_set_exposure_mode: async function(s_mode) {
            await f_set_camera_mode('exposureMode', s_mode);
        },
        f_set_wb_mode: async function(s_mode) {
            await f_set_camera_mode('whiteBalanceMode', s_mode);
        },
        f_apply_color_temp: async function(n) {
            await f_apply_camera_setting('colorTemperature', n);
        },
        f_close: function() {
            o_state.o_panel_visibility.camera_setting = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
    },
    mounted: function() {
        if (o_state.b_streaming__webcam) f_read_camera();
    },
};

export { o_component__camera_setting };
