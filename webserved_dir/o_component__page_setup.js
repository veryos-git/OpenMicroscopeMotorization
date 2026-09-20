import { o_state, f_send_wsmsg_with_response, f_register_handler, f_save_setting, f_connect_esp, f_connect_esp_serial, f_disconnect_esp, o_router } from './index.js';
import { f_flash_browser } from './flash_browser.module.js';
import { f_o_wsmsg } from './constructors.module.js';

let o_component__page_setup = {
    name: 'page-setup',
    template: `
        <div class="page-setup">
            <div class="setup-card">
                <h1 class="setup-title">Microscope Setup</h1>
                <p class="setup-subtitle">Configure your ESP32 stepper motor controller</p>

                <!-- Arduino CLI status -->
                <section class="setup-section">
                    <h2 class="setup-section-title">Prerequisites</h2>
                    <div class="setup-status-row">
                        <span class="dot" :class="{ connected: b_arduino_cli_installed }"></span>
                        <span v-if="b_arduino_cli_installed">arduino-cli: {{ s_arduino_cli_version }}</span>
                        <span v-else>arduino-cli not found (will be installed during flash)</span>
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
                        />
                    </div>
                    <div class="setup-input-row">
                        <label>Password</label>
                        <input
                            type="password"
                            v-model="o_state.s_wifi_password"
                            placeholder="WiFi password"
                            @change="f_save_wifi"
                        />
                    </div>
                </section>

                <!-- GPIO Pins -->
                <section class="setup-section">
                    <h2 class="setup-section-title">Motor GPIO Pins</h2>
                    <div class="pin-config-header">
                        <span></span>
                        <span>Pin 1</span>
                        <span>Pin 2</span>
                        <span>Pin 3</span>
                        <span>Pin 4</span>
                    </div>
                    <div
                        v-for="(o_pin, n_idx) in o_state.a_o_pin_config"
                        :key="n_idx"
                        class="pin-config-row"
                    >
                        <span class="pin-motor-name" :style="{ color: a_s_color_accent[n_idx] }">Motor {{ n_idx + 1 }}</span>
                        <input type="number" v-model.number="o_pin.n_pin1" min="0" max="48" @change="f_save_pin_config" />
                        <input type="number" v-model.number="o_pin.n_pin2" min="0" max="48" @change="f_save_pin_config" />
                        <input type="number" v-model.number="o_pin.n_pin3" min="0" max="48" @change="f_save_pin_config" />
                        <input type="number" v-model.number="o_pin.n_pin4" min="0" max="48" @change="f_save_pin_config" />
                    </div>
                </section>

                <section class="setup-section">
                    <h2 class="setup-section-title">ESP32 USB Connection</h2>
                    <p class="setup-hint">Plug the ESP32-S3 into this computer. Select its USB port when you click Flash. The current USB control connection will pause automatically.</p>
                    <p v-if="b_connected__serial" class="setup-hint">USB control is connected.</p>
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

                <!-- Skip / Manual IP -->
                <section class="setup-section setup-skip">
                    <div class="setup-divider">
                        <span>OR</span>
                    </div>
                    <h2 class="setup-section-title">Already Flashed?</h2>
                    <div v-if="o_state.b_available__serial" class="setup-input-row inline">
                        <button
                            v-if="b_locked__serial"
                            class="btn-connect"
                            @click="f_disconnect_usb"
                            :disabled="o_state.b_flashing || b_disconnecting__usb"
                        >
                            {{ b_disconnecting__usb ? 'Disconnecting...' : 'Disconnect USB (Web Serial)' }}
                        </button>
                        <button
                            v-else
                            class="btn-connect"
                            @click="f_connect_usb"
                            :disabled="o_state.b_flashing || o_state.b_connecting__esp_serial"
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
                        <button class="btn-connect" @click="f_skip_to_control" :disabled="o_state.b_flashing || !o_state.s_ip__esp">
                            Go to Control
                        </button>
                    </div>
                </section>
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
        };
    },
    computed: {
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
            return !o_state.b_flashing && !this.b_disconnecting__usb && !o_state.b_connecting__esp_serial && o_state.b_available__serial;
        },
        s_hint__flash: function() {
            if (!o_state.b_available__serial) return 'USB flashing requires Chrome or Edge over HTTPS or localhost.';
            return 'Firmware is compiled on the server and flashed over USB from this browser. WiFi is optional for USB control.';
        },
    },
    methods: {
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
                if (await f_connect_esp_serial(false, o_port)) o_router.push('/control');
                else {
                    o_state.s_flash_status = 'error';
                    f_log('Firmware was written and verified, but USB control did not connect. ' + o_state.s_error__esp_serial);
                }
            }
        },
        f_skip_to_control: function() {
            f_save_setting('s_ip__esp', o_state.s_ip__esp);
            f_connect_esp(o_state.s_ip__esp);
            o_router.push('/control');
        },
        f_connect_usb: async function() {
            if (o_state.b_flashing) return;
            let b_ok = await f_connect_esp_serial(true);
            if (b_ok) {
                o_router.push('/control');
            }
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

export { o_component__page_setup };
