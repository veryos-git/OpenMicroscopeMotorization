import { o_state, f_save_setting, f_send_esp } from './index.js';
import { f_o_hardware_led_config, f_s_hardware_led_config_error, f_s_hardware_led_output_error } from './hardware_led.module.js';

let o_component__hardware_led = {
    name: 'component-hardware-led',
    props: { b_busy: Boolean },
    data: function() {
        return { o_state, o_output: { ...f_o_hardware_led_config().o_startup }, b_dirty: false, s_error: '' };
    },
    computed: {
        o_config: function() { return o_state.o_config__hardware_led; },
        o_report: function() { return o_state.o_hardware_led; },
        s_config_error: function() { return f_s_hardware_led_config_error(this.o_config, o_state.a_o_pin_config); },
        b_ready: function() { return o_state.b_connected__esp && this.o_report?.b_ready && !o_state.b_flashing; },
        b_rgbw: function() { return this.o_report?.o_config?.s_protocol === 'rgbw'; },
        b_needs_flash: function() {
            if (!this.o_report) return false;
            let o_flashed = this.o_report.o_config;
            return ['b_enabled', 'n_pin', 'n_count', 's_protocol', 's_order'].some(s_key => o_flashed[s_key] !== this.o_config[s_key]) ||
                Object.keys(this.o_config.o_startup).some(s_key => o_flashed.o_startup[s_key] !== this.o_config.o_startup[s_key]);
        },
        s_status: function() {
            if (!o_state.b_connected__esp) return 'Connect the controller to use the LED.';
            if (!this.o_report) return 'Flash updated firmware to add LED support.';
            if (!this.o_report.o_config.b_enabled) return 'LED is disabled in the flashed firmware.';
            if (this.o_report.s_error) return this.o_report.s_error;
            if (this.o_report.b_pending) return 'Sending LED output…';
            return this.o_report.o_output.b_on ? 'LED output on' : 'LED output off';
        },
        s_color: {
            get: function() { return '#' + ['n_red', 'n_green', 'n_blue'].map(s_key => this.o_output[s_key].toString(16).padStart(2, '0')).join(''); },
            set: function(s_color) {
                ['n_red', 'n_green', 'n_blue'].forEach((s_key, n_idx) => this.o_output[s_key] = parseInt(s_color.slice(1 + n_idx * 2, 3 + n_idx * 2), 16));
                this.b_dirty = true;
            },
        },
    },
    watch: {
        'o_report.o_output': {
            immediate: true,
            handler: function(o_output) { if (o_output && !this.b_dirty) this.o_output = { ...o_output }; },
        },
        'o_state.b_connected__esp': function() { this.b_dirty = false; this.s_error = ''; },
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
        f_apply: function() {
            if (!this.b_ready) return;
            let o_output = { ...this.o_output, n_white: this.b_rgbw ? this.o_output.n_white : 0 };
            this.s_error = f_s_hardware_led_output_error(o_output);
            if (this.s_error) return;
            o_state.s_error__hardware_led = '';
            f_send_esp({ command: 'setLed', ...o_output });
            this.b_dirty = false;
        },
        f_off: function() {
            if (!this.b_ready) return;
            o_state.s_error__hardware_led = '';
            this.o_output.b_on = false;
            this.b_dirty = false;
            f_send_esp({ command: 'setLed', b_on: false });
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
            <p class="setup-hint" role="status">{{ s_status }}</p>
            <template v-if="o_report?.o_config.b_enabled">
                <p class="setup-hint">Connected LED: GPIO {{ o_report.o_config.n_pin }} · {{ o_report.o_config.n_count }} LED(s) · {{ o_report.o_config.s_protocol.toUpperCase() }}</p>
                <fieldset :disabled="!b_ready">
                    <legend>Live light</legend>
                    <label><input type="checkbox" v-model="o_output.b_on" @change="b_dirty = true" /> Light on</label>
                    <div class="hardware-led-grid">
                        <label>RGB colour <input type="color" v-model="s_color" /></label>
                        <label v-if="b_rgbw">White channel ({{ o_output.n_white }}/255)
                            <input type="range" min="0" max="255" step="1" v-model.number="o_output.n_white" @input="b_dirty = true" />
                        </label>
                        <label>Brightness ({{ o_output.n_brightness }}/255)
                            <input type="range" min="0" max="255" step="1" v-model.number="o_output.n_brightness" @input="b_dirty = true" />
                        </label>
                    </div>
                    <div class="hardware-motor-actions">
                        <button class="btn-small" @click="f_apply">Apply light</button>
                        <button class="btn-small" @click="f_off">Turn light off</button>
                    </div>
                    <p class="setup-hint">RGB and white mix independently. Set RGB to black for white only, or white to zero for RGB only. Live changes last until the next controller restart.</p>
                </fieldset>
            </template>
            <p v-if="s_error || o_state.s_error__hardware_led" class="setup-hint setup-hint--blocked" role="alert">{{ s_error || o_state.s_error__hardware_led }}</p>
        </section>
    `,
};

export { o_component__hardware_led };
