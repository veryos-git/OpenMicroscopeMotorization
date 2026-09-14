import { o_state, f_send_esp_move_step, f_send_esp_stop, f_send_esp_stop_all, f_send_esp_circle_start, f_save_setting__debounced } from './index.js';

let N_MS__MOVE_TIMEOUT = 30000;

let o_component__auto_move = {
    name: 'component-auto-move',
    template: `
        <div class="overlay-panel panel-auto-move" :class="{ visible: o_state.o_panel_visibility.auto_move }">
            <div class="panel-header">
                <h2>Auto Move</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <!-- mode tabs -->
                <div class="mode-toggle auto-move-mode-toggle">
                    <button
                        class="mode-btn"
                        :class="{ active: s_mode === 'rectangle' }"
                        :disabled="b_running"
                        @click="s_mode = 'rectangle'"
                    >Rectangle</button>
                    <button
                        class="mode-btn"
                        :class="{ active: s_mode === 'circle' }"
                        :disabled="b_running"
                        @click="s_mode = 'circle'"
                    >Circle</button>
                </div>

                <!-- rectangle config -->
                <template v-if="s_mode === 'rectangle'">
                    <div class="scan-section">
                        <div class="scan-label">Rectangle Size (steps)</div>
                        <div class="scan-hint">
                            The stage will trace a rectangle:
                            +X &rarr; +Y &rarr; &minus;X &rarr; &minus;Y back to origin.
                        </div>

                        <div class="scan-field">
                            <label>X distance</label>
                            <input
                                type="number"
                                v-model.number="n_step__x"
                                min="1"
                                :disabled="b_running"
                                @change="f_save_config"
                            >
                        </div>

                        <div class="scan-field">
                            <label>Y distance</label>
                            <input
                                type="number"
                                v-model.number="n_step__y"
                                min="1"
                                :disabled="b_running"
                                @change="f_save_config"
                            >
                        </div>
                    </div>
                </template>

                <!-- circle config -->
                <template v-if="s_mode === 'circle'">
                    <div class="scan-section">
                        <div class="scan-label">Circle (steps)</div>
                        <div class="scan-hint">
                            Circle is computed on the ESP32. Both motors run
                            continuously with speed modulated by sin/cos.
                        </div>

                        <div class="scan-field">
                            <label>Radius</label>
                            <input
                                type="number"
                                v-model.number="n_step__radius"
                                min="1"
                                :disabled="b_running"
                                @change="f_save_config"
                            >
                        </div>
                    </div>
                </template>

                <!-- RPM -->
                <div class="scan-section">
                    <div class="scan-field">
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

                <!-- status -->
                <div class="scan-progress-text" v-if="b_running">{{ s_status__detail }}</div>

                <!-- controls -->
                <div class="auto-move-btn-row" v-if="!b_running">
                    <button
                        class="btn-scan-start auto-move-btn-once"
                        @click="f_run(false)"
                        :disabled="!o_state.b_connected__esp || !f_b_config_valid()"
                    >Once</button>
                    <button
                        class="btn-scan-start auto-move-btn-loop"
                        @click="f_run(true)"
                        :disabled="!o_state.b_connected__esp || !f_b_config_valid()"
                    >Loop</button>
                </div>

                <button
                    v-if="b_running"
                    class="btn-scan-stop"
                    @click="f_stop"
                >Stop</button>

            </div>
        </div>
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
        };
    },

    mounted: function() {
        this.f_load_config();
    },

    methods: {

        // ── Panel ────────────────────────────────────────────────────

        f_close: function() {
            if (this.b_running) return;
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
            await o_self.f_move_motor_n_step(0, o_self.n_step__x);
            if (o_self.b_stop_requested) return;

            // +Y
            o_self.s_status__detail = 'Moving +Y...';
            await o_self.f_move_motor_n_step(1, o_self.n_step__y);
            if (o_self.b_stop_requested) return;

            // -X
            o_self.s_status__detail = 'Moving -X...';
            await o_self.f_move_motor_n_step(0, -o_self.n_step__x);
            if (o_self.b_stop_requested) return;

            // -Y
            o_self.s_status__detail = 'Moving -Y...';
            await o_self.f_move_motor_n_step(1, -o_self.n_step__y);
        },

        // ── Main execution ───────────────────────────────────────────

        f_run: async function(b_loop) {
            let o_self = this;
            o_self.b_running = true;
            o_self.b_loop = b_loop;
            o_self.b_stop_requested = false;

            if (o_self.s_mode === 'rectangle') {
                do {
                    await o_self.f_run_rectangle();
                    if (o_self.b_stop_requested) break;
                    if (!o_state.b_connected__esp) break;
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
