import { o_state, o_socket, f_send_wsmsg_with_response, f_register_handler, f_save_setting, f_connect_esp, f_connect_esp_serial, f_disconnect_esp, o_router } from './index.js';
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
                        <span class="pin-motor-name" :style="{ color: a_s_color_accent[n_idx] }">{{ o_pin.s_name }}</span>
                        <input type="number" v-model.number="o_pin.n_pin1" min="0" max="48" @change="f_save_pin_config" />
                        <input type="number" v-model.number="o_pin.n_pin2" min="0" max="48" @change="f_save_pin_config" />
                        <input type="number" v-model.number="o_pin.n_pin3" min="0" max="48" @change="f_save_pin_config" />
                        <input type="number" v-model.number="o_pin.n_pin4" min="0" max="48" @change="f_save_pin_config" />
                    </div>
                </section>

                <!-- USB Detection -->
                <section class="setup-section">
                    <h2 class="setup-section-title">ESP32 USB Connection</h2>
                    <div class="setup-status-row">
                        <span class="dot" :class="{ connected: o_state.b_detected__esp_usb }"></span>
                        <span v-if="o_state.b_detected__esp_usb">ESP32 detected on {{ o_state.s_port__esp_usb }}</span>
                        <span v-else>No ESP32 detected on USB</span>
                        <button class="btn-small" @click="f_detect_usb" :disabled="b_detecting_usb">
                            {{ b_detecting_usb ? 'Scanning...' : 'Refresh' }}
                        </button>
                    </div>
                    <div v-if="b_connected__serial" class="setup-status-row setup-status-row--serial">
                        <span class="dot connected"></span>
                        <span>USB serial connected{{ o_state.s_port__esp_usb ? ' on ' + o_state.s_port__esp_usb : '' }} — the browser holds this port, so flashing cannot open it</span>
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
                        <button
                            v-if="b_locked__serial"
                            class="btn-small"
                            @click="f_disconnect_usb"
                            :disabled="o_state.b_flashing || b_disconnecting__usb"
                        >
                            {{ b_disconnecting__usb ? 'Disconnecting...' : 'Disconnect USB serial' }}
                        </button>
                    </div>
                </section>

                <!-- Flash Console -->
                <section v-if="o_state.b_flashing || o_state.s_flash_output" class="setup-section">
                    <h2 class="setup-section-title">Flash Progress</h2>
                    <div class="flash-status-badge" :class="o_state.s_flash_status">
                        {{ s_flash_status_label }}
                    </div>
                    <pre class="flash-console" ref="el_pre__flash">{{ o_state.s_flash_output }}</pre>
                    <div v-if="b_password_request" class="flash-password-prompt">
                        <label>Sudo password required for serial port access:</label>
                        <div class="setup-input-row inline">
                            <input
                                type="password"
                                v-model="s_sudo_password"
                                placeholder="Enter your sudo password"
                                @keyup.enter="f_submit_password"
                                ref="el_input__password"
                            />
                            <button class="btn-connect" @click="f_submit_password">Submit</button>
                        </div>
                    </div>
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
                            :disabled="o_state.b_flashing"
                        >
                            Connect via USB (Web Serial)
                        </button>
                    </div>
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
                        <button class="btn-connect" @click="f_skip_to_control" :disabled="!o_state.s_ip__esp">
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
            b_detecting_usb: false,
            b_arduino_cli_installed: false,
            s_arduino_cli_version: '',
            a_s_color_accent: ['#ff6b35', '#00d4aa', '#5b8def'],
            b_password_request: false,
            s_sudo_password: '',
            f_resolve_password: null,
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
        // Web Serial opens the ESP32's tty from the browser and holds it
        // exclusively, so arduino-cli cannot open it while this is true.
        b_connected__serial: function() {
            return o_state.b_connected__esp && o_state.s_transport__esp === 'serial';
        },
        // stays true until port.close() has actually handed the tty back
        b_locked__serial: function() {
            return this.b_connected__serial || this.b_disconnecting__usb;
        },
        b_enabled__flash: function() {
            return !o_state.b_flashing
                && !this.b_locked__serial
                && o_state.b_detected__esp_usb
                && !!o_state.s_wifi_ssid
                && !!o_state.s_wifi_password;
        },
        s_hint__flash: function() {
            if (this.b_locked__serial) {
                return 'USB serial is connected — the browser holds the port. Disconnect it before flashing.';
            }
            if (!o_state.s_wifi_ssid || !o_state.s_wifi_password) {
                return 'Enter WiFi credentials to enable flashing';
            }
            if (!o_state.b_detected__esp_usb) {
                return 'Connect ESP32 via USB to enable flashing';
            }
            return '';
        },
    },
    methods: {
        f_detect_usb: async function() {
            this.b_detecting_usb = true;
            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('detect_esp_usb', [])
                );
                let v = o_resp.v_data;
                o_state.b_detected__esp_usb = v.b_detected;
                o_state.s_port__esp_usb = v.s_port;
            } catch (o_err) {
                console.error('USB detection error:', o_err);
            }
            this.b_detecting_usb = false;
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
        f_submit_password: function() {
            if (this.f_resolve_password && this.s_sudo_password) {
                this.f_resolve_password(this.s_sudo_password);
                this.f_resolve_password = null;
                this.b_password_request = false;
                this.s_sudo_password = '';
            }
        },
        f_start_flash: async function() {
            let self = this;
            if (this.b_locked__serial) {
                o_state.s_flash_status = 'error';
                o_state.s_flash_output = '--- Error: USB serial is connected. Disconnect it first, then flash again. ---\n';
                return;
            }
            if (!this.b_enabled__flash) return;
            o_state.b_flashing = true;
            o_state.s_flash_status = 'flashing';
            o_state.s_flash_output = '';

            // register handler for progress and password request messages
            let f_unregister = f_register_handler(function(o_data) {
                if (o_data.s_type === 'flash_progress') {
                    o_state.s_flash_output += o_data.v_data.s_line + '\n';
                    // auto-scroll console
                    let el = document.querySelector('.flash-console');
                    if (el) {
                        requestAnimationFrame(function() {
                            el.scrollTop = el.scrollHeight;
                        });
                    }
                }
                if (o_data.s_type === 'flash_password_request') {
                    self.b_password_request = true;
                    self.$nextTick(function() {
                        if (self.$refs.el_input__password) {
                            self.$refs.el_input__password.focus();
                        }
                    });
                    new Promise(function(resolve) {
                        self.f_resolve_password = resolve;
                    }).then(function(s_password) {
                        o_socket.send(JSON.stringify({
                            s_type: 'flash_password_response',
                            v_data: { s_password: s_password },
                        }));
                    });
                }
            });

            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('flash_esp', {
                        s_port: o_state.s_port__esp_usb,
                        s_wifi_ssid: o_state.s_wifi_ssid,
                        s_wifi_password: o_state.s_wifi_password,
                        a_o_pin_config: o_state.a_o_pin_config,
                    })
                );

                let v = o_resp.v_data;
                if (v.b_success) {
                    o_state.s_flash_status = 'done';
                    o_state.s_flash_output += '\n--- Flash complete! ---\n';
                    if (v.s_ip__esp) {
                        o_state.s_ip__esp = v.s_ip__esp;
                        f_save_setting('s_ip__esp', v.s_ip__esp);
                        o_state.s_flash_output += `ESP32 IP: ${v.s_ip__esp}\n`;
                        o_state.s_flash_output += 'Redirecting to control page...\n';
                        setTimeout(function() {
                            o_router.push('/control');
                        }, 2000);
                    }
                } else {
                    o_state.s_flash_status = 'error';
                    o_state.s_flash_output += `\n--- Error: ${v.s_error} ---\n`;
                }
            } catch (o_err) {
                o_state.s_flash_status = 'error';
                o_state.s_flash_output += `\n--- Error: ${o_err.message} ---\n`;
            }

            f_unregister();
            o_state.b_flashing = false;
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
            f_disconnect_esp();
            // Web Serial's port.close() is asynchronous and returns no promise
            // here, so hold the flash button disabled until the browser has
            // handed the tty back to the OS.
            await new Promise(function(f_resolve) { setTimeout(f_resolve, 400); });
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
        this.f_detect_usb();
    },
};

export { o_component__page_setup };
