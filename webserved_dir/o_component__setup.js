import { o_component__icon } from './o_component__icon.js';
import { f_n_rpm__manual } from './manual_speed.module.js';
import { o_state, f_send_esp, f_send_esp_move_step, f_send_esp_stop, f_send_esp_stop_all, f_send_esp_set_backlash, f_save_setting__debounced, f_send_wsmsg_with_response, f_register_handler, f_save_setting, f_connect_esp_serial, f_disconnect_esp } from './index.js';
import { f_flash_browser } from './flash_browser.module.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_s_hardware_led_config_error } from './hardware_led.module.js';

let o_component__setup = {
    name: 'component-setup',
    components: { ui_icon: o_component__icon },
    template: `
        <section class="overlay-panel panel-setup microcontroller-settings" :class="{ visible: o_state.o_panel_visibility.setup }" aria-label="Microcontroller settings">
            <div class="panel-header">
                <h2><ui_icon s_name="chip" /> Microcontroller <span class="microcontroller-model">ESP32</span></h2>
                <span class="panel-drag-hint" title="Drag to move"><ui_icon s_name="move" /></span>
                <button class="panel-close" @click="f_close" :disabled="o_state.b_flashing" aria-label="Close Setup">×</button>
            </div>
            <div class="panel-body">
                <fieldset class="micro-wiring" :disabled="b_hardware_busy" aria-label="Motor wiring">
                    <div class="micro-pin-headings" aria-hidden="true"><span></span><span v-for="pin in [1, 2, 3, 4]">Pin {{ pin }}</span></div>
                    <div class="micro-pin-row" v-for="(motor, index) in o_state.a_o_pin_config" :key="index">
                        <span class="micro-row-label" :data-tooltip="'Motor ' + (index + 1)">M{{ index + 1 }}</span>
                        <label class="micro-pin" v-for="pin in [1, 2, 3, 4]" :key="pin" :data-tooltip="'Motor ' + (index + 1) + ' · Pin ' + pin + ' · ESP32 GPIO'">
                            <ui_icon s_name="gpio" />
                            <input type="number" min="0" max="48" step="1" :aria-label="'Motor ' + (index + 1) + ' pin ' + pin"
                                v-model.number="motor['n_pin' + pin]" @change="f_save_pin_config" />
                        </label>
                    </div>
                </fieldset>
                <section class="micro-axes" aria-label="Axis assignments and backlash">
                    <div class="micro-axis-row" v-for="axis in ['x', 'y', 'z']" :key="axis" :data-axis="axis">
                        <label class="micro-row-label" :for="'axis-motor-' + axis">{{ axis.toUpperCase() }}</label>
                        <select :id="'axis-motor-' + axis" :aria-label="axis.toUpperCase() + ' motor'" :disabled="b_hardware_busy"
                            :value="o_state.o_motor__axis[axis] === null ? 'none' : o_state.o_motor__axis[axis]"
                            :data-tooltip="axis.toUpperCase() + ' motor · choosing an assigned motor swaps the axes'"
                            @change="f_assign_axis(axis, $event.target.value === 'none' ? null : Number($event.target.value))">
                            <option v-for="(motor, index) in o_state.a_o_pin_config" :key="index" :value="index">M{{ index + 1 }}</option>
                            <option v-if="axis === 'z'" value="none">Manual</option>
                        </select>
                        <button class="micro-reverse" :class="{ active: f_b_direction_reversed(o_state.o_motor__axis[axis]) }"
                            data-control-model="f_b_direction_reversed(o_state.o_motor__axis[axis])" data-control-reset="f_reverse_direction(o_state.o_motor__axis[axis], value)"
                            :data-control-scope="o_state.o_motor__axis[axis]"
                            :aria-pressed="f_b_direction_reversed(o_state.o_motor__axis[axis])" :aria-label="'Reverse ' + axis.toUpperCase() + ' direction'"
                            :disabled="b_hardware_busy || o_state.o_motor__axis[axis] === null"
                            :data-tooltip="'Reverse ' + axis.toUpperCase() + ' · keyboard, mouse and gamepad'"
                            @click="f_reverse_direction(o_state.o_motor__axis[axis], !f_b_direction_reversed(o_state.o_motor__axis[axis]))">
                            <ui_icon :s_name="f_b_direction_reversed(o_state.o_motor__axis[axis]) ? 'checked' : 'unchecked'" /><span>Reverse</span>
                        </button>
                        <label class="micro-backlash" :data-tooltip="axis.toUpperCase() + ' backlash compensation · motor steps'">
                            <input type="number" min="0" step="1" :aria-label="axis.toUpperCase() + ' backlash steps'"
                                :value="o_state.o_motor__axis[axis] === null ? '' : o_state.a_n_step__backlash[o_state.o_motor__axis[axis]]"
                                :disabled="b_hardware_busy || o_state.o_motor__axis[axis] === null"
                                @change="f_set_axis_backlash(axis, $event)" />
                            <ui_icon s_name="backlash" />
                        </label>
                        <button class="micro-icon-button" :class="{ active: s_axis__calibrating === axis }"
                            :aria-label="(s_axis__calibrating === axis ? 'Stop calibrating ' : 'Calibrate ') + axis.toUpperCase()"
                            :data-tooltip="s_axis__calibrating === axis ? 'Stop calibration' : 'Auto-calibrate ' + axis.toUpperCase() + ' · use a textured sample' + (axis === 'z' ? ', start slightly out of focus' : ' and manual exposure')"
                            :disabled="s_axis__calibrating !== axis && (!b_can_move || !o_state.b_streaming__webcam || o_state.o_motor__axis[axis] === null)"
                            @click="f_calibrate_axis(axis)"><ui_icon :s_name="s_axis__calibrating === axis ? 'stop' : 'settings'" /></button>
                    </div>
                    <p v-if="s_status__axis" class="micro-status" role="status">{{ s_status__axis }}</p>
                    <p v-if="s_error__motor" class="micro-error" role="alert">{{ s_error__motor }}</p>
                </section>
                <o_component__hardware_led :b_busy="b_hardware_busy" />

                <div class="micro-connection" role="status"><span class="dot" :class="{ connected: o_state.b_connected__esp }"></span>{{ s_connection_status }}</div>
                <div class="micro-actions">
                    <button v-if="o_state.b_connected__esp || b_disconnecting__usb" class="micro-action"
                        @click="f_disconnect_usb" :disabled="b_hardware_busy || b_disconnecting__usb" aria-label="Disconnect controller">
                        <ui_icon s_name="usb" />{{ b_disconnecting__usb ? 'Disconnecting…' : 'Disconnect' }}
                    </button>
                    <button v-else class="micro-action" @click="f_connect_usb" aria-label="Connect via USB"
                        :disabled="b_hardware_busy || !o_state.b_available__serial || o_state.b_connecting__esp_serial" data-tooltip="Connect to ESP32 via USB · Web Serial">
                        <ui_icon s_name="usb" />{{ o_state.b_connecting__esp_serial ? 'Connecting…' : 'Connect' }}
                    </button>
                    <button class="micro-action micro-action--flash" :disabled="!b_enabled__flash" @click="f_start_flash" aria-label="Flash ESP32" :data-tooltip="s_hint__flash">
                        <ui_icon s_name="flash" />{{ o_state.b_flashing ? 'Flashing…' : 'Flash' }}
                    </button>
                </div>
                <p class="micro-hint">Pin and startup changes apply after Flash.</p>
                <p v-if="s_pin_error" class="micro-error" role="alert">{{ s_pin_error }}</p>
                <p v-if="o_state.s_error__esp_serial" class="micro-error" role="alert">{{ o_state.s_error__esp_serial }}</p>
                <p v-if="!o_state.b_available__serial" class="micro-hint">USB requires Chrome or Edge on HTTPS or localhost.</p>
                <section v-if="o_state.b_flashing || o_state.s_flash_output" class="micro-flash-progress" aria-label="Flash progress">
                    <span class="flash-status-badge" :class="o_state.s_flash_status" role="status">{{ s_flash_status_label }}</span>
                    <pre class="flash-console" ref="el_pre__flash">{{ o_state.s_flash_output }}</pre>
                </section>

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
            </div>
        </section>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_arduino_cli_installed: false,
            s_arduino_cli_version: '',
            a_s_color_accent: ['#ff6b35', '#00d4aa', '#5b8def'],
            b_disconnecting__usb: false,
            n_step__manual: 100,
            b_move_pending: false,
            s_error__motor: '',
            s_axis__calibrating: '',
            s_status__axis: '',
            b_calibrating_all: false,
            b_stop__calibrate_all: false,
            s_status__calibrate_all: '',
        };
    },
    computed: {
        s_pin_error() {
            const pins = o_state.a_o_pin_config.flatMap(motor => [1, 2, 3, 4].map(pin => motor['n_pin' + pin]));
            if (pins.some(pin => !Number.isInteger(pin) || pin < 0 || pin > 48)) return 'Motor GPIOs must be whole numbers from 0 to 48.';
            if (new Set(pins).size !== pins.length) return 'Each motor pin needs a different GPIO.';
            return '';
        },
        s_connection_status() {
            if (o_state.b_connecting__esp_serial) return 'Connecting…';
            if (!o_state.b_connected__esp) return 'Disconnected';
            return 'USB connected';
        },
        b_can_move: function() {
            return o_state.b_connected__esp && !this.b_hardware_busy && !this.b_move_pending;
        },
        b_hardware_busy: function() {
            return !!this.s_axis__calibrating || this.b_calibrating_all || this.b_move_pending || o_state.b_flashing || o_state.b_scanning || o_state.a_o_motor.some(o_motor => o_motor.b_running);
        },
        s_flash_status_label: function() {
            let o_map = {
                'idle': 'Idle',
                'flashing': 'Flashing...',
                'done': 'Complete!',
                'error': 'Error',
            };
            return o_map[o_state.s_flash_status] || o_state.s_flash_status;
        },
        b_connected__serial: function() {
            return o_state.b_connected__esp;
        },
        // stays true until port.close() has actually handed the tty back
        b_locked__serial: function() {
            return this.b_connected__serial || this.b_disconnecting__usb;
        },
        b_enabled__flash: function() {
            if (this.s_pin_error) return false;
            if (f_s_hardware_led_config_error(o_state.o_config__hardware_led, o_state.a_o_pin_config)) return false;
            return !this.b_hardware_busy && !this.b_disconnecting__usb && !o_state.b_connecting__esp_serial && o_state.b_available__serial;
        },
        s_hint__flash: function() {
            if (this.s_pin_error) return this.s_pin_error;
            let s_error = f_s_hardware_led_config_error(o_state.o_config__hardware_led, o_state.a_o_pin_config);
            if (s_error) return s_error;
            if (!o_state.b_available__serial) return 'USB flashing requires Chrome or Edge over HTTPS or localhost.';
            return 'Firmware is compiled on the server and flashed over USB from this browser.';
        },
    },
    methods: {
        async f_calibrate_axis(axis) {
            const motor = o_state.o_motor__axis[axis];
            const calibration = this.$refs.a_calibration?.find(item => item.n_motor === motor);
            if (this.s_axis__calibrating === axis) { calibration?.f_stop(); return; }
            if (!this.b_can_move || !o_state.b_streaming__webcam || motor === null || !calibration) return;
            this.s_axis__calibrating = axis;
            this.s_status__axis = 'Calibrating ' + axis.toUpperCase() + ' · M' + (motor + 1) + '…';
            try {
                await calibration.f_run({ b_quick: true });
                this.s_status__axis = axis.toUpperCase() + ' · ' + calibration.s_status;
            } catch (error) { this.s_status__axis = 'Calibration failed: ' + error.message; }
            finally { this.s_axis__calibrating = ''; }
        },
        f_set_axis_backlash(axis, event) {
            const motor = o_state.o_motor__axis[axis];
            const steps = Number(event.target.value);
            if (this.b_hardware_busy || motor === null) return;
            if (event.target.value === '' || !Number.isSafeInteger(steps) || steps < 0) {
                this.s_error__motor = 'Backlash must be a whole number of steps, zero or greater.';
                event.target.value = o_state.a_n_step__backlash[motor];
                return;
            }
            this.s_error__motor = '';
            o_state.a_n_step__backlash[motor] = steps;
            this.f_save_backlash();
        },
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
        f_s_axis_motor: function(n_motor) {
            return Object.keys(o_state.o_motor__axis).find(s_axis => o_state.o_motor__axis[s_axis] === n_motor) || 'none';
        },
        f_b_direction_reversed: function(n_motor) {
            if (!Number.isInteger(n_motor)) return false;
            let s_key = { x: 'd', y: 'w', z: 'e' }[this.f_s_axis_motor(n_motor)];
            return s_key ? o_state['o_mapping__' + s_key]?.s_dir === 'ccw' : false;
        },
        f_reverse_direction: function(n_motor, b_reverse) {
            if(this.b_hardware_busy) return;
            let s_axis = this.f_s_axis_motor(n_motor);
            let o_defaults = {
                x: { a: 'ccw', d: 'cw' },
                y: { w: 'cw', s: 'ccw' },
                z: { q: 'ccw', e: 'cw', mouse_right: 'cw' },
            }[s_axis];
            if(!o_defaults) return;
            // Keep opposing inputs paired and reuse the persisted mappings read
            // by keyboard, mouse and gamepad. Axis assignments stay untouched.
            for(let [s_key, s_dir] of Object.entries(o_defaults)) {
                let o_mapping = {
                    ...o_state['o_mapping__' + s_key],
                    s_motor: String(n_motor),
                    s_dir: b_reverse ? (s_dir === 'cw' ? 'ccw' : 'cw') : s_dir,
                };
                o_state['o_mapping__' + s_key] = o_mapping;
                f_save_setting('o_mapping__' + s_key, o_mapping);
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
        f_assign_axis: function(s_axis, n_motor) {
            if(this.b_hardware_busy) return;
            f_send_esp_stop_all();
            let o_axes = { ...o_state.o_motor__axis };
            let s_other = n_motor === null ? null : Object.keys(o_axes).find(s_key => o_axes[s_key] === n_motor);
            if(s_other) o_axes[s_other] = o_axes[s_axis] ?? [0, 1, 2].find(n => !Object.values(o_axes).includes(n));
            o_axes[s_axis] = n_motor;
            o_state.o_motor__axis = o_axes;
            f_save_setting('o_motor__axis', o_axes);
            for(let [s_name, a_s_key] of Object.entries({ x: ['a', 'd'], y: ['w', 's'], z: ['q', 'e', 'mouse_right'] })){
                for(let s_key of a_s_key){
                    o_state['o_mapping__' + s_key].s_motor = o_axes[s_name] === null ? 'none' : String(o_axes[s_name]);
                    f_save_setting('o_mapping__' + s_key, o_state['o_mapping__' + s_key]);
                }
            }
        },
        f_save_backlash: function() {
            f_save_setting__debounced('a_n_step__backlash', o_state.a_n_step__backlash);
            for(let n_idx = 0; n_idx < o_state.a_n_step__backlash.length; n_idx++){
                f_send_esp_set_backlash(n_idx, o_state.a_n_step__backlash[n_idx]);
            }
        },
        f_close: function() {
            if(o_state.b_flashing) return;
            o_state.o_panel_visibility.setup = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_check_arduino_cli: async function() {
            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('check_arduino_cli', [])
                );
                let v = o_resp.v_data;
                this.b_arduino_cli_installed = v.b_installed;
                this.s_arduino_cli_version = v.s_version;
            } catch (o_err) {
                console.error('Arduino CLI check error:', o_err);
            }
        },
        f_start_flash: async function() {
            if (!this.b_enabled__flash) return;
            o_state.b_flashing = true;
            o_state.s_flash_status = 'flashing';
            o_state.s_flash_output = '';
            let f_log = function(s_line) {
                o_state.s_flash_output += s_line + '\n';
                requestAnimationFrame(function() {
                    let el = document.querySelector('.flash-console');
                    if (el) el.scrollTop = el.scrollHeight;
                });
            };
            let f_unregister = f_register_handler(function(o_data) {
                if (o_data.s_type === 'flash_progress') f_log(o_data.v_data.s_line);
            });
            let o_port;
            let b_uploaded = false;
            try {
                // Request from the click gesture, before compilation or dynamic imports.
                o_port = await navigator.serial.requestPort();
                await f_disconnect_esp();
                f_log('--- Compiling firmware on the server ---');
                let o_resp = await f_send_wsmsg_with_response(f_o_wsmsg('compile_esp', {
                    a_o_pin_config: o_state.a_o_pin_config,
                    o_config__hardware_led: o_state.o_config__hardware_led,
                }), 15 * 60 * 1000);
                if (!o_resp.v_data.b_success) throw new Error(o_resp.v_data.s_error);
                f_log('--- Flashing over browser USB. Keep the device connected. ---');
                await f_flash_browser(o_port, o_resp.v_data, f_log);
                b_uploaded = true;
                o_state.s_flash_status = 'done';
                f_log('--- Flash complete! Reconnecting USB control... ---');
            } catch (o_err) {
                o_state.s_flash_status = o_err.name === 'NotFoundError' ? 'idle' : 'error';
                f_log(o_err.name === 'NotFoundError' ? 'USB selection cancelled.' : `Error: ${o_err.message}`);
            } finally {
                f_unregister();
                o_state.b_flashing = false;
            }
            if (b_uploaded) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                if (!await f_connect_esp_serial(false, o_port)) {
                    o_state.s_flash_status = 'error';
                    f_log('Firmware was written and verified, but USB control did not connect. ' + o_state.s_error__esp_serial);
                }
            }
        },
        f_connect_usb: async function() {
            if (o_state.b_flashing) return;
            await f_connect_esp_serial(true);
        },
        f_disconnect_usb: async function() {
            this.b_disconnecting__usb = true;
            await f_disconnect_esp();
            this.b_disconnecting__usb = false;
        },
        f_save_pin_config: function() {
            if (this.b_hardware_busy || this.s_pin_error) return;
            f_save_setting('a_o_pin_config', o_state.a_o_pin_config);
        },
    },
    mounted: function() {
        this.f_check_arduino_cli();
    },
};

export { o_component__setup };
