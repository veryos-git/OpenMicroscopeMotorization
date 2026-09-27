import { o_state, f_save_setting__debounced } from './index.js';
import { f_apply_camera_resolution, f_b_camera_resolution_locked, f_s_key__iso, f_read_camera, f_apply_camera_setting, f_set_camera_mode } from './o_camera.module.js';

let o_component__camera_setting = {
    name: 'component-camera-setting',
    template: `
        <div class="overlay-panel panel-camera-setting" :class="{ visible: o_state.o_panel_visibility.camera_setting }">
            <div class="panel-header">
                <h2>Camera Settings</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div v-if="!o_cam.b_active" class="camera-setting-placeholder">
                    No camera stream active
                </div>
                <div v-else class="camera-setting-stack">

                    <div class="camera-setting-group">
                        <strong>{{ o_cam.s_label }}</strong>
                        <p>Active: {{ o_cam.n_width }} × {{ o_cam.n_height }} px
                            <span v-if="o_cam.n_frame_rate"> · {{ o_cam.n_frame_rate }} fps</span>
                        </p>
                        <form @submit.prevent="f_apply_resolution">
                            <fieldset :disabled="o_cam.b_applying_resolution || b_resolution_locked">
                                <legend>Requested capture format</legend>
                                <label>Size to test
                                    <select @change="f_choose_resolution($event.target.value)">
                                        <option value="">Choose size…</option>
                                        <option value="640x480">640 × 480</option>
                                        <option value="1280x720">1280 × 720</option>
                                        <option value="1920x1080">1920 × 1080</option>
                                        <option value="2560x1440">2560 × 1440</option>
                                        <option value="3840x2160">3840 × 2160 (4K)</option>
                                    </select>
                                </label>
                                <div class="camera-setting-row">
                                    <label>Width <input type="number" :min="o_cap.width?.min ?? 1" :max="o_cap.width?.max" :step="o_cap.width?.step ?? 1" required v-model.number="n_width" style="width: 6em" /></label>
                                    <span>×</span>
                                    <label>Height <input type="number" :min="o_cap.height?.min ?? 1" :max="o_cap.height?.max" :step="o_cap.height?.step ?? 1" required v-model.number="n_height" style="width: 6em" /></label>
                                </div>
                                <label>FPS (blank keeps current constraint)
                                    <input type="number" :disabled="!o_cap.frameRate" :min="o_cap.frameRate?.min"
                                        :max="o_cap.frameRate?.max" :step="o_cap.frameRate?.step ?? 'any'"
                                        v-model.number="n_frame_rate" style="width: 6em" />
                                </label>
                                <p v-if="!o_cap.frameRate">Frame-rate control unavailable on this device/browser.</p>
                                <button type="submit">{{ o_cam.b_applying_resolution ? 'Applying…' : 'Test and apply format' }}</button>
                                <button type="button" v-if="o_cap.width && o_cap.height" @click="f_maximum_resolution">Prefer largest size</button>
                                <button type="button" @click="f_monitor_resolution">Use monitor size</button>
                            </fieldset>
                        </form>
                        <p v-if="o_cap.width && o_cap.height">Reported range: {{ o_cap.width.min }}–{{ o_cap.width.max }} px wide,
                            {{ o_cap.height.min }}–{{ o_cap.height.max }} px high.</p>
                        <p v-if="o_cap.frameRate">FPS range: {{ o_cap.frameRate.min }}–{{ o_cap.frameRate.max }} · Step: {{ o_cap.frameRate.step ?? 'Unreported' }}</p>
                        <p v-if="o_cam.o_requested_format">Last request: {{ o_cam.o_requested_format.n_width }} × {{ o_cam.o_requested_format.n_height }} px,
                            {{ o_cam.o_requested_format.n_frame_rate ?? 'unchanged' }} fps
                            ({{ o_cam.o_requested_format.b_maximum ? 'preferred size' : 'exact size' }}).</p>
                        <p>Ranges and example sizes do not guarantee valid resolution/FPS combinations. Test a request to see the active result above.</p>
                        <p>The preview adapts to the window; captures retain the active camera resolution. Monitor size uses physical screen pixels as a preference.</p>
                        <p v-if="b_resolution_locked">Stop scanning or recording to change resolution.</p>
                        <p v-if="o_cam.s_error__resolution" role="alert">{{ o_cam.s_error__resolution }}</p>
                    </div>

                    <p>Hardware controls reported by the camera/driver. Unavailable controls are not emulated.</p>
                    <p v-if="o_cam.s_error__setting" role="alert">{{ o_cam.s_error__setting }}</p>
                    <div class="camera-setting-group" v-for="o_control in a_o_control" :key="o_control.s_api">
                        <strong>{{ o_control.s_label }}</strong>
                        <template v-if="o_cap[o_control.s_api]">
                            <p>Active: {{ o_cam.o_setting?.[o_control.s_api] ?? 'Unreported' }}
                                · Requested: {{ o_cam.o_requested?.[o_control.s_api] ?? '—' }}</p>
                            <select v-if="o_control.b_mode" :value="o_cam.o_setting?.[o_control.s_api]"
                                @change="f_set_mode(o_control.s_api, $event.target.value)">
                                <option v-for="s_mode in o_cap[o_control.s_api]" :value="s_mode">{{ s_mode }}</option>
                            </select>
                            <template v-else>
                                <p>Range: {{ o_cap[o_control.s_api].min }}–{{ o_cap[o_control.s_api].max }}
                                    · Step: {{ o_cap[o_control.s_api].step ?? 'Unreported' }}</p>
                                <label>Request
                                    <input type="number" :min="o_cap[o_control.s_api].min" :max="o_cap[o_control.s_api].max"
                                        :step="o_cap[o_control.s_api].step ?? 'any'"
                                        :value="o_cam.o_requested?.[o_control.s_api] ?? o_cam.o_setting?.[o_control.s_api]"
                                        :disabled="o_control.s_mode && o_cap[o_control.s_mode] && o_cam.o_setting?.[o_control.s_mode] !== 'manual'"
                                        @change="f_apply_setting(o_control.s_api, Number($event.target.value))" />
                                </label>
                                <p v-if="o_control.s_mode && o_cap[o_control.s_mode] && o_cam.o_setting?.[o_control.s_mode] !== 'manual'">Select manual mode to control this value.</p>
                            </template>
                        </template>
                        <p v-else>Unavailable on this device/browser</p>
                    </div>

                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            n_width: 3840,
            n_height: 2160,
            n_frame_rate: '',
            a_o_control: [
                { s_api: 'exposureMode', s_label: 'Exposure mode', b_mode: true },
                { s_api: 'exposureTime', s_label: 'Exposure time (100 µs units)', s_mode: 'exposureMode' },
                { s_api: 'iso', s_label: 'ISO', s_mode: 'exposureMode' },
                { s_api: 'gain', s_label: 'Gain (driver units)', s_mode: 'exposureMode' },
                { s_api: 'exposureCompensation', s_label: 'Exposure compensation' },
                { s_api: 'whiteBalanceMode', s_label: 'White balance mode', b_mode: true },
                { s_api: 'colorTemperature', s_label: 'Color temperature (K)', s_mode: 'whiteBalanceMode' },
                { s_api: 'focusMode', s_label: 'Focus mode', b_mode: true },
                { s_api: 'focusDistance', s_label: 'Focus distance', s_mode: 'focusMode' },
                { s_api: 'brightness', s_label: 'Brightness (device control)' },
                { s_api: 'contrast', s_label: 'Contrast (device control)' },
                { s_api: 'saturation', s_label: 'Saturation (device control)' },
                { s_api: 'sharpness', s_label: 'Sharpness (device control)' },
                { s_api: 'zoom', s_label: 'Hardware zoom' },
            ],
        };
    },
    computed: {
        b_resolution_locked: f_b_camera_resolution_locked,
        o_cam: function() {
            return o_state.o_camera;
        },
        o_cap: function() {
            return o_state.o_camera.o_capability;
        },
        s_key__iso: function() {
            return f_s_key__iso(o_state.o_camera.o_capability);
        },
    },
    watch: {
        'o_state.o_panel_visibility.camera_setting': function(b_visible) {
            if (b_visible && o_state.b_streaming__webcam) {
                f_read_camera();
                this.f_reset_resolution();
            }
        },
    },
    methods: {
        f_reset_resolution: function() {
            this.n_width = this.o_cam.n_width || 3840;
            this.n_height = this.o_cam.n_height || 2160;
        },
        f_choose_resolution: function(s_size) {
            if (!s_size) return;
            [this.n_width, this.n_height] = s_size.split('x').map(Number);
        },
        f_apply_resolution: async function() {
            await f_apply_camera_resolution(this.n_width, this.n_height, false, true, this.n_frame_rate === '' ? null : this.n_frame_rate);
        },
        f_maximum_resolution: async function() {
            await f_apply_camera_resolution(this.o_cap.width.max, this.o_cap.height.max, true, true, this.n_frame_rate === '' ? null : this.n_frame_rate);
        },
        f_monitor_resolution: async function() {
            await f_apply_camera_resolution(Math.round(screen.width * devicePixelRatio),
                Math.round(screen.height * devicePixelRatio), true, true,
                this.n_frame_rate === '' ? null : this.n_frame_rate);
        },
        f_set_mode: function(s_api_name, s_value) {
            f_set_camera_mode(s_api_name, s_value);
        },
        f_apply_setting: function(s_api_name, v_value) {
            f_apply_camera_setting(s_api_name, v_value);
        },
        f_close: function() {
            o_state.o_panel_visibility.camera_setting = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
    },
    mounted: function() {
        if (o_state.b_streaming__webcam) {
            f_read_camera();
            this.f_reset_resolution();
        }
    },
};

export { o_component__camera_setting };
