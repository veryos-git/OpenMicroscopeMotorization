import { o_state, f_save_setting__debounced } from './index.js';
import { f_s_key__iso, f_read_camera, f_apply_camera_setting, f_set_camera_mode } from './o_camera.module.js';

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

                    <!-- Exposure Mode -->
                    <div class="camera-setting-group" v-if="o_cap.exposureMode">
                        <div class="camera-setting-row">
                            <span class="camera-setting-label">Exposure</span>
                            <div class="mode-toggle">
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam.s_mode__exposure === 'manual' }"
                                    @click="f_set_mode('exposureMode', 'manual')"
                                >Manual</button>
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam.s_mode__exposure === 'continuous' }"
                                    @click="f_set_mode('exposureMode', 'continuous')"
                                >Auto</button>
                            </div>
                        </div>
                        <div class="camera-setting-slider" v-if="o_cam.s_mode__exposure === 'manual' && o_cap.exposureTime">
                            <label>
                                <span>Exposure Time</span>
                                <span class="setting-value">{{ o_cam.n_time__exposure }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.exposureTime.min"
                                :max="o_cap.exposureTime.max"
                                :step="o_cap.exposureTime.step || 1"
                                v-model.number="o_cam.n_time__exposure"
                                @input="f_apply_setting('exposureTime', o_cam.n_time__exposure)"
                            />
                        </div>
                        <div class="camera-setting-slider" v-if="o_cam.s_mode__exposure === 'manual' && s_key__iso">
                            <label>
                                <span>{{ s_key__iso.toUpperCase() }}</span>
                                <span class="setting-value">{{ o_cam.n_iso }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap[s_key__iso].min"
                                :max="o_cap[s_key__iso].max"
                                :step="o_cap[s_key__iso].step || 1"
                                v-model.number="o_cam.n_iso"
                                @input="f_apply_setting(s_key__iso, o_cam.n_iso)"
                            />
                        </div>
                        <div class="camera-setting-slider" v-if="o_cam.s_mode__exposure === 'continuous' && o_cap.exposureCompensation">
                            <label>
                                <span>Exposure Compensation</span>
                                <span class="setting-value">{{ o_cam.n_compensation__exposure }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.exposureCompensation.min"
                                :max="o_cap.exposureCompensation.max"
                                :step="o_cap.exposureCompensation.step || 1"
                                v-model.number="o_cam.n_compensation__exposure"
                                @input="f_apply_setting('exposureCompensation', o_cam.n_compensation__exposure)"
                            />
                        </div>
                    </div>

                    <!-- White Balance Mode -->
                    <div class="camera-setting-group" v-if="o_cap.whiteBalanceMode">
                        <div class="camera-setting-row">
                            <span class="camera-setting-label">White Balance</span>
                            <div class="mode-toggle">
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam.s_mode__white_balance === 'manual' }"
                                    @click="f_set_mode('whiteBalanceMode', 'manual')"
                                >Manual</button>
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam.s_mode__white_balance === 'continuous' }"
                                    @click="f_set_mode('whiteBalanceMode', 'continuous')"
                                >Auto</button>
                            </div>
                        </div>
                        <div class="camera-setting-slider" v-if="o_cam.s_mode__white_balance === 'manual' && o_cap.colorTemperature">
                            <label>
                                <span>Color Temperature</span>
                                <span class="setting-value">{{ o_cam.n_temperature__color }}K</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.colorTemperature.min"
                                :max="o_cap.colorTemperature.max"
                                :step="o_cap.colorTemperature.step || 1"
                                v-model.number="o_cam.n_temperature__color"
                                @input="f_apply_setting('colorTemperature', o_cam.n_temperature__color)"
                            />
                        </div>
                    </div>

                    <!-- Focus Mode -->
                    <div class="camera-setting-group" v-if="o_cap.focusMode">
                        <div class="camera-setting-row">
                            <span class="camera-setting-label">Focus</span>
                            <div class="mode-toggle">
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam.s_mode__focus === 'manual' }"
                                    @click="f_set_mode('focusMode', 'manual')"
                                >Manual</button>
                                <button
                                    class="mode-btn"
                                    :class="{ active: o_cam.s_mode__focus === 'continuous' }"
                                    @click="f_set_mode('focusMode', 'continuous')"
                                >Auto</button>
                            </div>
                        </div>
                        <div class="camera-setting-slider" v-if="o_cam.s_mode__focus === 'manual' && o_cap.focusDistance">
                            <label>
                                <span>Focus Distance</span>
                                <span class="setting-value">{{ o_cam.n_distance__focus }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.focusDistance.min"
                                :max="o_cap.focusDistance.max"
                                :step="o_cap.focusDistance.step || 1"
                                v-model.number="o_cam.n_distance__focus"
                                @input="f_apply_setting('focusDistance', o_cam.n_distance__focus)"
                            />
                        </div>
                    </div>

                    <!-- Brightness -->
                    <div class="camera-setting-group" v-if="o_cap.brightness">
                        <div class="camera-setting-slider">
                            <label>
                                <span>Brightness</span>
                                <span class="setting-value">{{ o_cam.n_brightness }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.brightness.min"
                                :max="o_cap.brightness.max"
                                :step="o_cap.brightness.step || 1"
                                v-model.number="o_cam.n_brightness"
                                @input="f_apply_setting('brightness', o_cam.n_brightness)"
                            />
                        </div>
                    </div>

                    <!-- Contrast -->
                    <div class="camera-setting-group" v-if="o_cap.contrast">
                        <div class="camera-setting-slider">
                            <label>
                                <span>Contrast</span>
                                <span class="setting-value">{{ o_cam.n_contrast }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.contrast.min"
                                :max="o_cap.contrast.max"
                                :step="o_cap.contrast.step || 1"
                                v-model.number="o_cam.n_contrast"
                                @input="f_apply_setting('contrast', o_cam.n_contrast)"
                            />
                        </div>
                    </div>

                    <!-- Saturation -->
                    <div class="camera-setting-group" v-if="o_cap.saturation">
                        <div class="camera-setting-slider">
                            <label>
                                <span>Saturation</span>
                                <span class="setting-value">{{ o_cam.n_saturation }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.saturation.min"
                                :max="o_cap.saturation.max"
                                :step="o_cap.saturation.step || 1"
                                v-model.number="o_cam.n_saturation"
                                @input="f_apply_setting('saturation', o_cam.n_saturation)"
                            />
                        </div>
                    </div>

                    <!-- Sharpness -->
                    <div class="camera-setting-group" v-if="o_cap.sharpness">
                        <div class="camera-setting-slider">
                            <label>
                                <span>Sharpness</span>
                                <span class="setting-value">{{ o_cam.n_sharpness }}</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.sharpness.min"
                                :max="o_cap.sharpness.max"
                                :step="o_cap.sharpness.step || 1"
                                v-model.number="o_cam.n_sharpness"
                                @input="f_apply_setting('sharpness', o_cam.n_sharpness)"
                            />
                        </div>
                    </div>

                    <!-- Zoom -->
                    <div class="camera-setting-group" v-if="o_cap.zoom">
                        <div class="camera-setting-slider">
                            <label>
                                <span>Zoom</span>
                                <span class="setting-value">{{ o_cam.n_zoom.toFixed(1) }}x</span>
                            </label>
                            <input
                                type="range"
                                :min="o_cap.zoom.min"
                                :max="o_cap.zoom.max"
                                :step="o_cap.zoom.step || 0.1"
                                v-model.number="o_cam.n_zoom"
                                @input="f_apply_setting('zoom', o_cam.n_zoom)"
                            />
                        </div>
                    </div>

                </div>
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
            }
        },
    },
    methods: {
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
        }
    },
};

export { o_component__camera_setting };
