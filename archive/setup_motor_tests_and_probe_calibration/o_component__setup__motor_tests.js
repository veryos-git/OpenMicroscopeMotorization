// Archived 2026-10-25 from webserved_dir/o_component__setup.js (not runnable on its own).
// The "Motor tests & calibration" section of the Setup window and the methods only it used.

// ── template ──
/*
                <details class="micro-details micro-diagnostics">
                    <summary><ui_icon s_name="settings" /> Motor tests &amp; calibration</summary>
                    <div class="hardware-calibration-controls">
                        <button v-if="!b_calibrating_all" @click="f_calibrate_all" :disabled="!b_can_move || !o_state.b_streaming__webcam">Calibrate all</button>
                        <button v-else @click="f_stop_calibrating_all">Stop calibration</button>
                        <span class="hardware-calibration-status" role="status">{{ s_status__calibrate_all }}</span>
                    </div>
                    <article class="hardware-motor" v-for="(motor, index) in o_state.a_o_pin_config" :key="index">
                        <h3>M{{ index + 1 }} <span class="micro-hint">{{ f_s_axis_motor(index).toUpperCase() }}</span></h3>
                        <div class="hardware-motor-readout"><span>{{ o_state.a_o_motor[index].n_position }} steps</span>
                            <span>{{ o_state.b_connected__esp ? o_state.a_o_motor[index].b_running ? 'Moving' : 'Stopped' : 'Disconnected' }}</span></div>
                        <div class="hardware-motor-actions">
                            <button @click="f_move_motor(index, -1)" :disabled="!b_can_move" :aria-label="'Move motor ' + (index + 1) + ' counterclockwise'">↶</button>
                            <button @click="f_move_motor(index, 1)" :disabled="!b_can_move" :aria-label="'Move motor ' + (index + 1) + ' clockwise'">↷</button>
                            <button @click="f_stop_motor(index)" :disabled="!o_state.b_connected__esp" :aria-label="'Stop motor ' + (index + 1)"><ui_icon s_name="stop" /></button>
                        </div>
                        <o_component__backlash ref="a_calibration" :n_motor="index" :b_busy="b_move_pending" />
                    </article>
                    <div class="hardware-motor-actions">
                        <label>Steps <input class="hardware-step-count" type="number" min="1" max="10000" v-model.number="n_step__manual" /></label>
                        <button @click="f_stop_all" :disabled="!o_state.b_connected__esp">Stop all</button>
                        <button @click="f_refresh_motors" :disabled="!o_state.b_connected__esp" aria-label="Refresh motor status"><ui_icon s_name="refresh" /></button>
                    </div>
                    <details class="hardware-calibration-checklist"><summary>Calibration checklist &amp; optical settings</summary><o_component__calibration /></details>
                    <o_component__jog />
                    <p class="micro-hint">{{ b_arduino_cli_installed ? 'Compiler ' + s_arduino_cli_version : 'Compiler will be installed during Flash.' }}</p>
                </details>
*/

// ── data ──
// n_step__manual: 100, b_move_pending: false, a_s_color_accent: ['#ff6b35', '#00d4aa', '#5b8def'],
// b_calibrating_all: false, b_stop__calibrate_all: false, s_status__calibrate_all: '',

// ── methods ──
let o_methods = {
        f_calibrate_all: async function() {
            if(!this.b_can_move || !o_state.b_streaming__webcam) return;
            this.b_calibrating_all = true;
            this.b_stop__calibrate_all = false;
            let n_stop = o_state.n_cnt__stop_all;
            try {
                let a_calibration = [...(this.$refs.a_calibration || [])].sort((a, b) => a.n_motor - b.n_motor);
                if(!a_calibration.length) throw new Error('No motors available');
                for(let o_calibration of a_calibration) {
                    if(this.b_stop__calibrate_all || n_stop !== o_state.n_cnt__stop_all || !o_state.b_connected__esp || !o_state.b_streaming__webcam) {
                        this.s_status__calibrate_all = 'Quick calibration stopped';
                        return;
                    }
                    this.s_status__calibrate_all = `Quick calibration: motor ${o_calibration.n_motor + 1} of ${a_calibration.length}`;
                    let b_success = await o_calibration.f_run({ b_quick: true });
                    if(!b_success || this.b_stop__calibrate_all) {
                        this.s_status__calibrate_all = `Stopped at motor ${o_calibration.n_motor + 1}: ${o_calibration.s_status}`;
                        return;
                    }
                }
                this.s_status__calibrate_all = 'Quick calibration complete — all motors applied';
            } catch(o_error) {
                this.s_status__calibrate_all = 'Quick calibration failed: ' + o_error.message;
            } finally {
                this.b_calibrating_all = false;
            }
        },

        f_stop_calibrating_all: function() {
            this.b_stop__calibrate_all = true;
            for(let o_calibration of this.$refs.a_calibration || []) {
                if(o_calibration.b_running) o_calibration.f_stop();
            }
        },

        f_assign_motor: function(n_motor, s_axis) {
            if(this.b_hardware_busy) return;
            if(s_axis === 'none') {
                if(this.f_s_axis_motor(n_motor) === 'z') this.f_assign_axis('z', null);
                return;
            }
            if(['x', 'y', 'z'].includes(s_axis)) this.f_assign_axis(s_axis, n_motor);
        },

        f_move_motor: async function(n_motor, n_sign) {
            if(!this.b_can_move) return;
            let n_step = Math.round(Number(this.n_step__manual));
            let n_rpm = f_n_rpm__manual(o_state, o_state.o_motor__axis?.z === n_motor ? 'z' : 'xy');
            if(!Number.isFinite(n_step) || n_step < 1 || n_step > 10000 || !Number.isFinite(n_rpm) || n_rpm < 0.05 || n_rpm > 15) {
                this.s_error__motor = 'Choose 1–10000 steps and a speed between 0.05 and 15 RPM.';
                return;
            }
            this.s_error__motor = '';
            this.b_move_pending = true;
            try {
                await f_send_esp_move_step(n_motor, n_step * n_sign, n_rpm);
            } catch(o_error) {
                this.s_error__motor = o_error.message;
            } finally {
                this.b_move_pending = false;
            }
        },

        f_stop_motor: function(n_motor) {
            let o_calibration = this.$refs.a_calibration?.find(o => o.n_motor === n_motor);
            if(o_calibration?.b_running) o_calibration.f_stop();
            else f_send_esp_stop(n_motor);
        },

        f_stop_all: function() {
            this.f_stop_calibrating_all();
            f_send_esp_stop_all();
        },

        f_refresh_motors: function() { f_send_esp({ command: 'status' }); },

};
