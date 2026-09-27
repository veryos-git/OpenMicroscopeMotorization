import { f_n_rpm__manual } from './manual_speed.module.js';
import { o_state, f_send_esp, f_send_esp_move_step, f_send_esp_stop, f_send_esp_stop_all, f_send_esp_set_backlash, f_save_setting__debounced, f_send_wsmsg_with_response, f_register_handler, f_save_setting, f_connect_esp, f_connect_esp_serial, f_disconnect_esp } from './index.js';
import { f_flash_browser } from './flash_browser.module.js';
import { f_o_wsmsg } from './constructors.module.js';

let o_component__setup = {
    name: 'component-setup',
    template: `
        <div class="overlay-panel panel-setup" :class="{ visible: o_state.o_panel_visibility.setup }">
            <div class="panel-header">
                <h2>Hardware Setup</h2>
                <button class="panel-close" @click="f_close" :disabled="o_state.b_flashing" aria-label="Close Setup">&times;</button>
            </div>
            <div class="panel-body">
                <p class="setup-subtitle">Assign, move, and monitor your motors here. Position and movement are reported live by the controller.</p>

                <section class="hardware-motors" aria-label="Motors">
                    <div class="hardware-calibration-controls">
                        <button v-if="!b_calibrating_all" class="btn-small" @click="f_calibrate_all" :disabled="!b_can_move || !o_state.b_streaming__webcam">Quick calibrate all</button>
                        <button v-else class="btn-small" @click="f_stop_calibrating_all">Stop calibration</button>
                        <span class="hardware-calibration-status" role="status">{{ s_status__calibrate_all }}</span>
                    </div>
                    <p class="setup-hint">Quick calibration measures both directions once per motor, with coarser probes. Use a textured sample; for focus, start clearly off focus on one side of the sharpness peak.</p>
                    <p class="setup-hint">Assign each motor to an axis. Choosing an occupied axis swaps motors. Z controls focus; leave its motor unassigned if focus is manual.</p>
                    <article class="hardware-motor" v-for="(o_pin, n_idx) in o_state.a_o_pin_config" :key="n_idx"
                        :class="{ moving: o_state.b_connected__esp && o_state.a_o_motor[n_idx].b_running }">
                        <div class="hardware-motor-heading">
                            <span class="motor-rotor" aria-hidden="true"
                                :class="{ spinning: o_state.b_connected__esp && o_state.a_o_motor[n_idx].b_running, reverse: o_state.a_o_motor[n_idx].s_direction === 'ccw' }"
                                :style="{ animationDuration: (60 / Math.max(0.05, o_state.a_o_motor[n_idx].n_rpm)) + 's' }">✣</span>
                            <h3>Motor {{ n_idx + 1 }}</h3>
                            <span class="motor-motion-status">{{ !o_state.b_connected__esp ? 'Disconnected' : o_state.a_o_motor[n_idx].b_running ? 'Moving · ' + o_state.a_o_motor[n_idx].s_direction.toUpperCase() : 'Stopped' }}</span>
                        </div>
                        <div class="hardware-motor-assignment">
                            <label :for="'motor-axis-' + n_idx">Axis</label>
                            <select :id="'motor-axis-' + n_idx" :value="f_s_axis_motor(n_idx)" :disabled="b_hardware_busy"
                                @change="f_assign_motor(n_idx, $event.target.value)">
                                <option value="none" :disabled="['x', 'y'].includes(f_s_axis_motor(n_idx))">Unassigned</option>
                                <option value="x">X · left / right</option>
                                <option value="y">Y · forward / back</option>
                                <option value="z">Z · focus</option>
                            </select>
                        </div>
                        <label v-if="f_s_axis_motor(n_idx) !== 'none'" class="hardware-direction">
                            <input type="checkbox" :checked="f_b_direction_reversed(n_idx)" :disabled="b_hardware_busy"
                                @change="f_reverse_direction(n_idx, $event.target.checked)" />
                            Reverse {{ f_s_axis_motor(n_idx).toUpperCase() }} manual direction
                        </label>
                        <p v-if="f_s_axis_motor(n_idx) !== 'none'" class="setup-hint">Applies to keyboard, mouse and gamepad. Saved automatically. The CW/CCW test buttons below use physical motor direction.</p>
                        <div class="hardware-motor-readout">
                            <span>Position <strong>{{ o_state.a_o_motor[n_idx].n_position }}</strong> steps</span>
                            <span v-if="o_state.b_connected__esp && o_state.a_o_motor[n_idx].b_running">{{ o_state.a_o_motor[n_idx].n_rpm.toFixed(2) }} RPM</span>
                            <span v-if="o_state.b_connected__esp && o_state.a_o_motor[n_idx].b_running && o_state.a_o_motor[n_idx].s_mode === 'steps'">{{ o_state.a_o_motor[n_idx].n_step__remaining }} steps remaining</span>
                        </div>
                        <div class="hardware-motor-actions">
                            <button class="btn-small" @click="f_move_motor(n_idx, -1)" :disabled="!b_can_move" :aria-label="'Move motor ' + (n_idx + 1) + ' counterclockwise'">↶ Move</button>
                            <button class="btn-small" @click="f_move_motor(n_idx, 1)" :disabled="!b_can_move" :aria-label="'Move motor ' + (n_idx + 1) + ' clockwise'">↷ Move</button>
                            <button class="btn-small" @click="f_stop_motor(n_idx)" :disabled="!o_state.b_connected__esp" :aria-label="'Stop motor ' + (n_idx + 1)">■ Stop</button>
                        </div>
                        <o_component__backlash ref="a_calibration" :n_motor="n_idx" :b_busy="b_move_pending" />
                        <details class="hardware-wiring">
                            <summary>Wiring &amp; backlash</summary>
                            <div class="hardware-pin-grid">
                                <label v-for="n_pin in [1, 2, 3, 4]" :key="n_pin">Pin {{ n_pin }}
                                    <input type="number" min="0" max="48" v-model.number="o_pin['n_pin' + n_pin]" @change="f_save_pin_config" :disabled="b_hardware_busy" />
                                </label>
                            </div>
                            <label class="hardware-backlash">Backlash (steps)
                                <input type="number" min="0" v-model.number="o_state.a_n_step__backlash[n_idx]" @change="f_save_backlash" :disabled="b_hardware_busy" />
                            </label>
                            <p class="setup-hint">Pin changes require flashing below. Backlash compensation applies immediately.</p>
                        </details>
                    </article>
                    <div class="hardware-motor-actions">
                        <label>Steps per click <input class="hardware-step-count" type="number" min="1" max="10000" v-model.number="n_step__manual" /></label>
                        <button class="btn-small" @click="f_stop_all" :disabled="!o_state.b_connected__esp">■ Stop all</button>
                        <button class="btn-small" @click="f_refresh_motors" :disabled="!o_state.b_connected__esp">Refresh</button>
                    </div>

                    <p v-if="s_error__motor" class="focusstack-error">{{ s_error__motor }}</p>
                </section>
                <details class="hardware-calibration-checklist"><summary>Calibration checklist &amp; optical settings</summary><o_component__calibration /></details>
                <o_component__jog />
                <details class="hardware-controller">
                    <summary>Controller connection &amp; firmware</summary>
                <!-- Connections -->
                <section class="setup-section">
                    <h2 class="setup-section-title">Controller connection</h2>
                    <div class="setup-input-row inline">
                        <button
                            v-if="o_state.b_connected__esp || b_disconnecting__usb"
                            class="btn-connect"
                            @click="f_disconnect_usb"
                            :disabled="b_hardware_busy || b_disconnecting__usb"
                        >
                            {{ b_disconnecting__usb ? 'Disconnecting...' : b_connected__serial ? 'Disconnect USB' : 'Disconnect WiFi' }}
                        </button>
                        <button
                            v-else-if="o_state.b_available__serial"
                            class="btn-connect"
                            @click="f_connect_usb"
                            :disabled="b_hardware_busy || o_state.b_connecting__esp_serial"
                        >
                            {{ o_state.b_connecting__esp_serial ? 'Waiting for firmware...' : 'Connect via USB (Web Serial)' }}
                        </button>
                    </div>
                    <p v-if="o_state.s_error__esp_serial" class="setup-hint setup-hint--blocked">{{ o_state.s_error__esp_serial }}</p>
                    <p v-if="o_state.b_available__serial" class="setup-hint">
                        USB Serial is the default. Enter an ESP32 IP below only if you want to use the WebSocket fallback instead.
                    </p>
                    <p v-if="!o_state.b_available__serial" class="setup-hint">
                        Web Serial is not available in this browser/context. Use the ESP32 IP below (WebSocket fallback).
                    </p>
                    <div class="setup-input-row inline">
                        <input
                            type="text"
                            v-model="o_state.s_ip__esp"
                            placeholder="ESP32 IP address (e.g. 192.168.1.100)"
                        />
                        <button class="btn-connect" @click="f_connect_wifi" :disabled="b_hardware_busy || !o_state.s_ip__esp">
                            Connect via WiFi
                        </button>
                    </div>
                </section>
                <!-- WiFi -->
                <section class="setup-section">
                    <h2 class="setup-section-title">WiFi Credentials</h2>
                    <div class="setup-input-row">
                        <label>SSID</label>
                        <input
                            type="text"
                            v-model="o_state.s_wifi_ssid"
                            placeholder="Your WiFi network name"
                            @change="f_save_wifi"
                            :disabled="o_state.b_flashing"
                        />
                    </div>
                    <div class="setup-input-row">
                        <label>Password</label>
                        <input
                            type="password"
                            v-model="o_state.s_wifi_password"
                            placeholder="WiFi password"
                            @change="f_save_wifi"
                            :disabled="o_state.b_flashing"
                        />
                    </div>
                </section>

                <section class="setup-section">
                    <h2 class="setup-section-title">Firmware</h2>
                    <p class="setup-hint">Plug the ESP32-S3 into this computer. Select its USB port when you click Flash. The current USB control connection will pause automatically.</p>
                    <p v-if="b_connected__serial" class="setup-hint">USB control is connected.</p>
                </section>

                <!-- Arduino CLI status -->
                <section class="setup-section">
                    <h2 class="setup-section-title">Prerequisites</h2>
                    <div class="setup-status-row">
                        <span class="dot" :class="{ connected: b_arduino_cli_installed }"></span>
                        <span v-if="b_arduino_cli_installed">arduino-cli: {{ s_arduino_cli_version }}</span>
                        <span v-else>arduino-cli not found (will be installed during flash)</span>
                    </div>
                </section>

                <!-- Flash -->
                <section class="setup-section">
                    <button
                        class="btn-flash"
                        :disabled="!b_enabled__flash"
                        @click="f_start_flash"
                    >
                        {{ o_state.b_flashing ? 'Flashing...' : 'Generate Firmware & Flash ESP32' }}
                    </button>
                    <div v-if="s_hint__flash" class="setup-flash-blocker">
                        <p class="setup-hint" :class="{ 'setup-hint--blocked': b_locked__serial }">{{ s_hint__flash }}</p>
                    </div>
                </section>

                <!-- Flash Console -->
                <section v-if="o_state.b_flashing || o_state.s_flash_output" class="setup-section">
                    <h2 class="setup-section-title">Flash Progress</h2>
                    <div class="flash-status-badge" :class="o_state.s_flash_status">
                        {{ s_flash_status_label }}
                    </div>
                    <pre class="flash-console" ref="el_pre__flash">{{ o_state.s_flash_output }}</pre>
                </section>

                </details>

            </div>
        </div>
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
            b_calibrating_all: false,
            b_stop__calibrate_all: false,
            s_status__calibrate_all: '',
        };
    },
    computed: {
        b_can_move: function() {
            return o_state.b_connected__esp && !this.b_hardware_busy && !this.b_move_pending;
        },
        b_hardware_busy: function() {
            return this.b_calibrating_all || this.b_move_pending || o_state.b_flashing || o_state.b_scanning || o_state.a_o_motor.some(o_motor => o_motor.b_running);
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
            return o_state.b_connected__esp && o_state.s_transport__esp === 'serial';
        },
        // stays true until port.close() has actually handed the tty back
        b_locked__serial: function() {
            return this.b_connected__serial || this.b_disconnecting__usb;
        },
        b_enabled__flash: function() {
            return !this.b_hardware_busy && !this.b_disconnecting__usb && !o_state.b_connecting__esp_serial && o_state.b_available__serial;
        },
        s_hint__flash: function() {
            if (!o_state.b_available__serial) return 'USB flashing requires Chrome or Edge over HTTPS or localhost.';
            return 'Firmware is compiled on the server and flashed over USB from this browser. WiFi is optional for USB control.';
        },
    },
    methods: {
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
                    s_wifi_ssid: o_state.s_wifi_ssid,
                    s_wifi_password: o_state.s_wifi_password,
                    a_o_pin_config: o_state.a_o_pin_config,
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
        f_connect_wifi: function() {
            f_save_setting('s_ip__esp', o_state.s_ip__esp);
            f_connect_esp(o_state.s_ip__esp);
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
        f_save_wifi: function() {
            f_save_setting('s_wifi_ssid', o_state.s_wifi_ssid);
            f_save_setting('s_wifi_password', o_state.s_wifi_password);
        },
        f_save_pin_config: function() {
            f_save_setting('a_o_pin_config', o_state.a_o_pin_config);
        },
    },
    mounted: function() {
        this.f_check_arduino_cli();
    },
};

export { o_component__setup };
