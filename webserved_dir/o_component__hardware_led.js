import { o_state, f_save_setting, f_save_setting__debounced } from './index.js';
import { f_s_hardware_led_config_error } from './hardware_led.module.js';

let o_component__hardware_led = {
    name: 'component-hardware-led',
    props: { b_busy: Boolean },
    data: function() {
        return { o_state };
    },
    computed: {
        o_config: function() { return o_state.o_config__hardware_led; },
        o_report: function() { return o_state.o_hardware_led; },
        s_config_error: function() { return f_s_hardware_led_config_error(this.o_config, o_state.a_o_pin_config); },
        b_needs_flash: function() {
            if (!this.o_report) return false;
            let o_flashed = this.o_report.o_config;
            return ['b_enabled', 'n_pin', 'n_count', 's_protocol', 's_order'].some(s_key => o_flashed[s_key] !== this.o_config[s_key]) ||
                Object.keys(this.o_config.o_startup).some(s_key => o_flashed.o_startup[s_key] !== this.o_config.o_startup[s_key]);
        },
    },
    methods: {
        f_save: function() {
            if (!this.s_config_error) f_save_setting('o_config__hardware_led', this.o_config);
        },
        f_protocol: function() {
            let o_startup = this.o_config.o_startup;
            if (this.o_config.s_protocol === 'rgb') {
                if (o_startup.n_white && !(o_startup.n_red || o_startup.n_green || o_startup.n_blue)) {
                    o_startup.n_red = o_startup.n_green = o_startup.n_blue = o_startup.n_white;
                }
                o_startup.n_white = 0;
            }
            this.f_save();
        },
        f_open_live: function() {
            if (o_state.b_flashing) return;
            o_state.o_panel_visibility.setup = false;
            o_state.o_panel_visibility.led_setting = true;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
    },
    template: `
        <section class="hardware-led setup-section" aria-label="Hardware LED">
            <h3>Optional hardware LED</h3>
            <fieldset :disabled="b_busy">
                <label><input type="checkbox" v-model="o_config.b_enabled" @change="f_save" /> Enable addressable LED</label>
                <div v-if="o_config.b_enabled" class="hardware-led-config">
                    <div class="hardware-led-grid">
                        <label>LED data GPIO <input type="number" min="1" max="48" step="1" v-model.number="o_config.n_pin" @change="f_save" /></label>
                        <label>LED count <input type="number" min="1" max="16" step="1" v-model.number="o_config.n_count" @change="f_save" /></label>
                        <label>LED protocol <select v-model="o_config.s_protocol" @change="f_protocol">
                            <option value="rgbw">RGBW / RGBWW / RGBCW (SK6812, 32 bit)</option>
                            <option value="rgb">RGB (WS2812 / WS2812B, 24 bit)</option>
                        </select></label>
                        <label>Colour order <select v-model="o_config.s_order" @change="f_save">
                            <option value="grb">{{ o_config.s_protocol === 'rgbw' ? 'GRBW' : 'GRB' }}</option>
                            <option value="rgb">{{ o_config.s_protocol === 'rgbw' ? 'RGBW' : 'RGB' }}</option>
                        </select></label>
                    </div>
                    <p class="setup-hint">All LEDs in the chain use the same output. RGBWW/RGBCW uses one separate warm or cool white channel. Confirm the module's chip and colour order.</p>
                    <p class="setup-hint">Connect the selected GPIO to DIN and share ground with the ESP32. Use the module's specified supply voltage and a data level shifter if required. GPIO 21 is suggested; check that it is free on your board.</p>
                    <details>
                        <summary>Startup light</summary>
                        <label><input type="checkbox" v-model="o_config.o_startup.b_on" @change="f_save" /> On at startup</label>
                        <div class="hardware-led-grid">
                            <label v-for="(s_label, s_key) in { n_red: 'Red', n_green: 'Green', n_blue: 'Blue', n_white: 'White', n_brightness: 'Brightness' }" :key="s_key">
                                Startup {{ s_label }} (0–255)
                                <input type="number" min="0" max="255" step="1" v-model.number="o_config.o_startup[s_key]" @change="f_save" :disabled="s_key === 'n_white' && o_config.s_protocol !== 'rgbw'" />
                            </label>
                        </div>
                        <p class="setup-hint">Default: separate white channel at brightness 8/255. Startup values take effect after flashing and on every restart.</p>
                    </details>
                </div>
            </fieldset>
            <p class="setup-hint">Hardware and startup changes are saved automatically. Use “Generate Firmware &amp; Flash ESP32” below to apply them.</p>
            <p v-if="s_config_error" class="setup-hint setup-hint--blocked" role="alert">{{ s_config_error }}</p>
            <p v-else-if="b_needs_flash" class="setup-hint">Saved LED settings differ from the connected controller. Flash to apply them.</p>
            <button class="btn-small" @click="f_open_live" :disabled="o_state.b_flashing">Open LED settings</button>
            <p class="setup-hint">Control live brightness, colour and on/off from LED settings in the main toolbar.</p>
            <p v-if="o_report?.s_error || o_state.s_error__hardware_led" class="setup-hint setup-hint--blocked" role="alert">{{ o_report?.s_error || o_state.s_error__hardware_led }}</p>
        </section>
    `,
};

export { o_component__hardware_led };
