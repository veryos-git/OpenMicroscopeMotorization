import { f_n_motor__axis, o_state, f_send_esp_move_step, f_send_esp_stop, f_send_esp_stop_all, f_send_esp_circle_start, f_save_setting__debounced } from './index.js';
import { o_component__icon } from './o_component__icon.js';
import { f_o_camera_geometry, f_el_camera_frame } from './camera_frame.module.js';

let N_MS__MOVE_TIMEOUT = 30000;
// wait after the last move of a cycle, so the snapshot shows the stage at rest
let N_MS__SNAPSHOT_SETTLE = 400;
// long side of the snapshot overlay in pixels (it holds a 4 byte sum per channel)
let N_SCL__SNAPSHOT_MAX = 2048;

let o_component__auto_move = {
    name: 'component-auto-move',
    components: { ui_icon: o_component__icon },
    template: `
        <div class="overlay-panel panel-auto-move" :class="{ visible: o_state.o_panel_visibility.auto_move }">
            <div class="panel-header">
                <h2><ui_icon s_name="auto" /> Auto Move</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <!-- mode tabs -->
                <div class="mode-toggle auto-move-mode-toggle">
                    <button
                        class="mode-btn"
                        :class="{ active: s_mode === 'rectangle' }"
                        :disabled="b_running"
                        data-control-model="s_mode" data-control-reset="s_mode = value" @click="s_mode = 'rectangle'"
                        data-tooltip="Rectangle&#10;The stage traces a rectangle: +X → +Y → −X → −Y back to the origin."
                    ><ui_icon s_name="rectangle" />Rectangle</button>
                    <button
                        class="mode-btn"
                        :class="{ active: s_mode === 'circle' }"
                        :disabled="b_running"
                        data-control-model="s_mode" data-control-reset="s_mode = value" @click="s_mode = 'circle'"
                        data-tooltip="Circle&#10;Computed on the ESP32. Both motors run continuously with speed modulated by sin/cos."
                    ><ui_icon s_name="circle" />Circle</button>
                </div>

                <div class="auto-move-config">
                <!-- rectangle config -->
                <template v-if="s_mode === 'rectangle'">
                        <div class="scan-field" data-tooltip="X distance&#10;Width of the rectangle in motor steps.">
                            <label>X distance</label>
                            <input
                                type="number"
                                v-model.number="n_step__x"
                                min="1"
                                :disabled="b_running"
                                @change="f_save_config"
                            >
                        </div>

                        <div class="scan-field" data-tooltip="Y distance&#10;Height of the rectangle in motor steps.">
                            <label>Y distance</label>
                            <input
                                type="number"
                                v-model.number="n_step__y"
                                min="1"
                                :disabled="b_running"
                                @change="f_save_config"
                            >
                        </div>
                </template>

                <!-- circle config -->
                <template v-if="s_mode === 'circle'">
                        <div class="scan-field" data-tooltip="Radius&#10;Radius of the circle in motor steps.">
                            <label>Radius</label>
                            <input
                                type="number"
                                v-model.number="n_step__radius"
                                min="1"
                                :disabled="b_running"
                                @change="f_save_config"
                            >
                        </div>
                </template>

                <!-- RPM -->
                    <div class="scan-field" data-tooltip="RPM&#10;Motor speed of the automatic movement.">
                        <label>RPM</label>
                        <input
                            type="number"
                            v-model.number="n_rpm"
                            min="0.05"
                            max="15"
                            step="0.5"
                            :disabled="b_running"
                            @change="f_save_config"
                        >
                    </div>
                </div>

                <!-- snapshot overlay -->
                <div class="cockpit-row" v-if="s_mode === 'rectangle'" data-tooltip="Snapshot overlay&#10;Loop only. A snapshot is taken with the stage at rest: one at the start and one after every cycle. Their average lies over the live image: sharp when the stage returns exactly, ghost copies when it drifts. 0 = no snapshots.">
                    <label class="cockpit-label" for="auto-move-overlay">Overlay</label>
                    <input
                        id="auto-move-overlay" class="cockpit-grow" type="range" min="0" max="100" step="5" aria-label="Snapshot overlay"
                        v-model.number="n_pct__overlay"
                        @change="f_save_config"
                    >
                    <span class="cockpit-readout">{{ n_pct__overlay }}%</span>
                    <span class="cockpit-readout dim" v-if="n_cnt__snapshot" data-tooltip="Snapshots in the overlay">{{ n_cnt__snapshot }} &times;</span>
                    <button
                        class="cockpit-icon-button" v-if="n_cnt__snapshot" :disabled="b_running"
                        @click="f_clear_snapshot" aria-label="Clear snapshots" data-tooltip="Clear snapshots"
                    ><ui_icon s_name="trash" /></button>
                </div>

                <!-- status -->
                <div class="scan-progress-text" v-if="b_running">{{ s_status__detail }}</div>

                <!-- controls -->
                <div class="auto-move-btn-row" v-if="!b_running">
                    <button
                        class="btn-scan-start auto-move-btn-once"
                        @click="f_run(false)"
                        :disabled="!o_state.b_connected__esp || !f_b_config_valid()"
                     data-tooltip="Run the path once and stop"><ui_icon s_name="play" />Once</button>
                    <button
                        class="btn-scan-start auto-move-btn-loop"
                        @click="f_run(true)"
                        :disabled="!o_state.b_connected__esp || !f_b_config_valid()"
                     data-tooltip="Repeat the path until Stop"><ui_icon s_name="loop" />Loop</button>
                </div>

                <button
                    v-if="b_running"
                    class="btn-scan-stop"
                    @click="f_stop"
                >Stop</button>

            </div>
        </div>

        <!-- average of the cycle snapshots, drawn over the live image -->
        <teleport to="body">
            <canvas
                class="auto-move-overlay"
                ref="el_overlay"
                v-show="n_cnt__snapshot > 0"
                :style="{ opacity: n_pct__overlay / 100 }"
            ></canvas>
        </teleport>
    `,

    data: function() {
        return {
            o_state: o_state,

            // mode
            s_mode: 'rectangle',

            // rectangle config
            n_step__x: 100,
            n_step__y: 100,

            // circle config
            n_step__radius: 100,

            // execution
            n_rpm: 8.0,
            b_running: false,
            b_loop: false,
            b_stop_requested: false,
            s_status__detail: '',

            // snapshot overlay
            n_pct__overlay: 50,
            n_cnt__snapshot: 0,
        };
    },

    mounted: function() {
        this.f_load_config();
    },

    watch: {
        // the overlay belongs to the rectangle, whose controls are gone in the other mode
        s_mode: function() {
            this.f_clear_snapshot();
        },
    },

    methods: {

        // ── Panel ────────────────────────────────────────────────────

        f_close: function() {
            if (this.b_running) return;
            this.f_clear_snapshot();
            o_state.o_panel_visibility.auto_move = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },

        // ── Config persistence ───────────────────────────────────────

        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o) {
                return o.s_key === 'o_config__auto_move';
            });
            if (o_setting && o_setting.s_value) {
                try {
                    let o_config = JSON.parse(o_setting.s_value);
                    if (o_config.s_mode) o_self.s_mode = o_config.s_mode;
                    if (o_config.n_step__x) o_self.n_step__x = o_config.n_step__x;
                    if (o_config.n_step__y) o_self.n_step__y = o_config.n_step__y;
                    if (o_config.n_step__radius) o_self.n_step__radius = o_config.n_step__radius;
                    if (o_config.n_rpm) o_self.n_rpm = o_config.n_rpm;
                    if (typeof o_config.n_pct__overlay === 'number') o_self.n_pct__overlay = o_config.n_pct__overlay;
                } catch (e) { /* ignore parse errors */ }
            }
        },

        f_save_config: function() {
            f_save_setting__debounced('o_config__auto_move', {
                s_mode: this.s_mode,
                n_step__x: this.n_step__x,
                n_step__y: this.n_step__y,
                n_step__radius: this.n_step__radius,
                n_rpm: this.n_rpm,
                n_pct__overlay: this.n_pct__overlay,
            });
        },

        // ── Validation ───────────────────────────────────────────────

        f_b_config_valid: function() {
            if (this.s_mode === 'rectangle') {
                return this.n_step__x >= 1 && this.n_step__y >= 1;
            }
            if (this.s_mode === 'circle') {
                return this.n_step__radius >= 1;
            }
            return false;
        },

        // ── Motor helpers (rectangle only) ───────────────────────────

        f_move_motor_n_step: async function(n_motor, n_step) {
            let o_self = this;
            if (n_step === 0) return;
            if (o_self.b_stop_requested) return;

            let o_promise__move = f_send_esp_move_step(n_motor, n_step, o_self.n_rpm);
            let o_promise__timeout = new Promise(function(resolve) {
                setTimeout(function() { resolve('timeout'); }, N_MS__MOVE_TIMEOUT);
            });

            let v_result = await Promise.race([o_promise__move, o_promise__timeout]);
            if (v_result === 'timeout') {
                console.warn('Auto move timeout: motor', n_motor);
                f_send_esp_stop(n_motor);
            }
        },

        // ── Rectangle movement ───────────────────────────────────────

        f_run_rectangle: async function() {
            let o_self = this;

            // +X
            o_self.s_status__detail = 'Moving +X...';
            await o_self.f_move_motor_n_step(f_n_motor__axis('x'), o_self.n_step__x);
            if (o_self.b_stop_requested) return;

            // +Y
            o_self.s_status__detail = 'Moving +Y...';
            await o_self.f_move_motor_n_step(f_n_motor__axis('y'), o_self.n_step__y);
            if (o_self.b_stop_requested) return;

            // -X
            o_self.s_status__detail = 'Moving -X...';
            await o_self.f_move_motor_n_step(f_n_motor__axis('x'), -o_self.n_step__x);
            if (o_self.b_stop_requested) return;

            // -Y
            o_self.s_status__detail = 'Moving -Y...';
            await o_self.f_move_motor_n_step(f_n_motor__axis('y'), -o_self.n_step__y);
        },

        // ── Snapshot overlay ─────────────────────────────────────────

        // add what the live view shows right now to the overlay, which is the average of all snapshots.
        // the sums are kept apart from the canvas: blending 8 bit images would lose the later cycles.
        f_snapshot: async function() {
            let o_self = this;
            o_self.s_status__detail = 'Snapshot...';
            await new Promise(function(f_resolve) { setTimeout(f_resolve, N_MS__SNAPSHOT_SETTLE); });
            let el_video = document.getElementById('webcamVideo');
            let o_geometry = f_o_camera_geometry(el_video);
            // a stopped run leaves the stage somewhere on the path
            if (o_self.b_stop_requested || !o_geometry.n_scl_x || el_video.readyState < 2) return;

            let n_scl = Math.min(1, N_SCL__SNAPSHOT_MAX / Math.max(o_geometry.n_scl_x, o_geometry.n_scl_y));
            let n_scl_x = Math.round(o_geometry.n_scl_x * n_scl);
            let n_scl_y = Math.round(o_geometry.n_scl_y * n_scl);
            let el_overlay = o_self.$refs.el_overlay;
            // first snapshot, or the camera size changed
            if (!o_self._a_n_sum || el_overlay.width !== n_scl_x || el_overlay.height !== n_scl_y) {
                el_overlay.width = n_scl_x;
                el_overlay.height = n_scl_y;
                o_self._a_n_sum = new Uint32Array(n_scl_x * n_scl_y * 4);
                o_self.n_cnt__snapshot = 0;
            }
            // the processed image while the filter shows it, else the camera frame
            let el_filter = document.querySelector('.filter-canvas');
            let el_source = el_filter && el_filter.offsetParent !== null ? el_filter : f_el_camera_frame(el_video);
            let o_ctx = el_overlay.getContext('2d', { willReadFrequently: true });
            o_ctx.drawImage(el_source, 0, 0, n_scl_x, n_scl_y);
            let o_image = o_ctx.getImageData(0, 0, n_scl_x, n_scl_y);
            let a_n_sum = o_self._a_n_sum;
            let n_cnt = o_self.n_cnt__snapshot + 1;
            for (let n_idx = 0; n_idx < a_n_sum.length; n_idx++) {
                a_n_sum[n_idx] += o_image.data[n_idx];
                o_image.data[n_idx] = a_n_sum[n_idx] / n_cnt;
            }
            o_ctx.putImageData(o_image, 0, 0);
            o_self.n_cnt__snapshot = n_cnt;
        },

        f_clear_snapshot: function() {
            this._a_n_sum = null;
            this.n_cnt__snapshot = 0;
        },

        // ── Main execution ───────────────────────────────────────────

        f_run: async function(b_loop) {
            let o_self = this;
            if(o_self.s_mode === 'circle' && !o_state.b_axis_assignment__circle &&
                (f_n_motor__axis('x') !== 0 || f_n_motor__axis('y') !== 1)){
                o_self.s_status__detail = 'Update ESP32 firmware from Setup to use circle motion with these axis assignments.';
                return;
            }
            o_self.b_running = true;
            o_self.b_loop = b_loop;
            o_self.b_stop_requested = false;
            // only the rectangle ends every cycle with the stage at rest at the origin, which a snapshot needs
            let b_snapshot = b_loop && o_self.s_mode === 'rectangle' && o_self.n_pct__overlay > 0;
            if (b_snapshot) o_self.f_clear_snapshot();

            if (o_self.s_mode === 'rectangle') {
                // the first snapshot is taken before any movement
                if (b_snapshot) await o_self.f_snapshot();
                do {
                    await o_self.f_run_rectangle();
                    if (o_self.b_stop_requested) break;
                    if (!o_state.b_connected__esp) break;
                    if (b_snapshot) await o_self.f_snapshot();
                } while (o_self.b_loop && !o_self.b_stop_requested);

            } else if (o_self.s_mode === 'circle') {
                // circle runs entirely on ESP32 — looping handled there
                o_self.s_status__detail = 'Running circle on ESP32...';
                await f_send_esp_circle_start(
                    o_self.n_step__radius,
                    o_self.n_rpm,
                    b_loop
                );
            }

            o_self.b_running = false;
            o_self.b_loop = false;
            o_self.s_status__detail = '';
            console.log('Auto move ' + (o_self.b_stop_requested ? 'stopped' : 'complete'));
        },

        f_stop: function() {
            this.b_stop_requested = true;
            f_send_esp_stop_all();
        },
    },

    beforeUnmount: function() {
        if (this.b_running) {
            this.f_stop();
        }
    },
};

export { o_component__auto_move };
