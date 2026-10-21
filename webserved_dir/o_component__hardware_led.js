<<<<<<< HEAD
import { o_state, f_save_setting, f_save_setting__debounced } from './index.js';
import { f_s_hardware_led_config_error } from './hardware_led.module.js';
=======
import { o_component__icon } from './o_component__icon.js';
import { o_state, f_save_setting, f_send_esp } from './index.js';
import { f_o_hardware_led_config, f_s_hardware_led_config_error, f_s_hardware_led_output_error } from './hardware_led.module.js';
>>>>>>> 942bcdc04095cbb45a8e0cb9e7aff9776be3b37b

let o_component__hardware_led = {
    name: 'component-hardware-led',
    components: { ui_icon: o_component__icon },
    props: { b_busy: Boolean },
    data: function() {
        return { o_state };
    },
    computed: {
        s_startup_color() {
            return '#' + ['n_red', 'n_green', 'n_blue'].map(key => this.o_config.o_startup[key].toString(16).padStart(2, '0')).join('');
        },
        n_startup_white() { return Math.round(this.o_config.o_startup.n_white / 255 * 1000) / 1000; },
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
        f_startup_color(value) {
            if (this.b_busy) return;
            if (!/^#[0-9a-f]{6}$/i.test(value)) { this.s_error = 'Use a six-digit hex colour, such as #ff8040.'; return; }
            this.s_error = '';
            ['n_red', 'n_green', 'n_blue'].forEach((key, index) => this.o_config.o_startup[key] = parseInt(value.slice(1 + index * 2, 3 + index * 2), 16));
            this.f_save();
        },
        f_startup_white(value) {
            if (this.b_busy || this.o_config.s_protocol !== 'rgbw') return;
            const white = Number(value);
            if (value === '' || !Number.isFinite(white) || white < 0 || white > 1) { this.s_error = 'White intensity must be between 0 and 1.'; return; }
            this.s_error = '';
            this.o_config.o_startup.n_white = Math.round(white * 255);
            this.f_save();
        },
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
        <section class="hardware-led hardware-led--compact setup-section" aria-label="Hardware LED">
            <fieldset class="micro-led-primary" :disabled="b_busy">
                <div class="micro-led-row">
                    <button class="micro-led-enable" :class="{ active: o_config.b_enabled }" :aria-pressed="o_config.b_enabled" aria-label="Enable addressable LED"
                        data-control-model="o_config.b_enabled" data-control-reset="(o_config.b_enabled = value, f_save())"
                        data-tooltip="Enable addressable LED · saved in firmware" @click="o_config.b_enabled = !o_config.b_enabled; f_save()">LED</button>
                    <label class="micro-pin" data-tooltip="LED data GPIO · connect to DIN">
                        <ui_icon s_name="gpio" /><input type="number" min="1" max="48" step="1" v-model.number="o_config.n_pin" @change="f_save" aria-label="LED data GPIO" :disabled="!o_config.b_enabled" />
                    </label>
                    <select v-model="o_config.s_protocol" @change="f_protocol" aria-label="LED protocol" :disabled="!o_config.b_enabled" data-tooltip="RGB: WS2812 · RGBW: SK6812 with one warm or cool white channel">
                        <option value="rgbw">RGBW</option><option value="rgb">RGB</option>
                    </select>
                    <select v-model="o_config.s_order" @change="f_save" aria-label="Colour order" :disabled="!o_config.b_enabled" data-tooltip="LED colour order">
                        <option value="grb">{{ o_config.s_protocol === 'rgbw' ? 'GRBW' : 'GRB' }}</option>
                        <option value="rgb">{{ o_config.s_protocol === 'rgbw' ? 'RGBW' : 'RGB' }}</option>
                    </select>
                </div>
                <div class="micro-led-startup">
                    <button class="micro-startup-toggle" :class="{ active: o_config.o_startup.b_on }" :aria-pressed="o_config.o_startup.b_on"
                        data-control-model="o_config.o_startup.b_on" data-control-reset="(o_config.o_startup.b_on = value, f_save())"
                        aria-label="LED on at startup" :disabled="!o_config.b_enabled" data-tooltip="Light on when the controller starts"
                        @click="o_config.o_startup.b_on = !o_config.o_startup.b_on; f_save()"><ui_icon :s_name="o_config.o_startup.b_on ? 'checked' : 'unchecked'" />Startup</button>
                    <div class="micro-color" data-tooltip="Startup RGB colour">
                        <input type="color" :value="s_startup_color" @input="f_startup_color($event.target.value)" :disabled="!o_config.b_enabled" aria-label="Startup colour" />
                        <input type="text" :value="s_startup_color" @change="f_startup_color($event.target.value)" :disabled="!o_config.b_enabled" maxlength="7" spellcheck="false" aria-label="Startup hex colour" />
                    </div>
                    <label class="micro-white" data-tooltip="Warm / cool white channel intensity · 0–1 · temperature depends on the LED module">
                        <span>W</span><input type="number" min="0" max="1" step="0.001" :value="n_startup_white" @change="f_startup_white($event.target.value)"
                            :disabled="!o_config.b_enabled || o_config.s_protocol !== 'rgbw'" aria-label="Startup white intensity" />
                    </label>
                </div>
            </fieldset>
<<<<<<< HEAD
            <p class="setup-hint">Hardware and startup changes are saved automatically. Use “Generate Firmware &amp; Flash ESP32” below to apply them.</p>
            <p v-if="s_config_error" class="setup-hint setup-hint--blocked" role="alert">{{ s_config_error }}</p>
            <p v-else-if="b_needs_flash" class="setup-hint">Saved LED settings differ from the connected controller. Flash to apply them.</p>
            <button class="btn-small" @click="f_open_live" :disabled="o_state.b_flashing">Open LED settings</button>
            <p class="setup-hint">Control live brightness, colour and on/off from LED settings in the main toolbar.</p>
            <p v-if="o_report?.s_error || o_state.s_error__hardware_led" class="setup-hint setup-hint--blocked" role="alert">{{ o_report?.s_error || o_state.s_error__hardware_led }}</p>
=======
            <details class="micro-led-details">
                <summary>LED options &amp; live light</summary>
                <fieldset :disabled="b_busy || !o_config.b_enabled" class="micro-led-options">
                    <label class="micro-field">LED count<input type="number" min="1" max="16" step="1" v-model.number="o_config.n_count" @change="f_save" /></label>
                    <label class="micro-field">Startup brightness<input type="number" min="0" max="255" step="1" v-model.number="o_config.o_startup.n_brightness" @change="f_save" /></label>
                    <p class="micro-hint">Brightness: 0–255. The W channel is warm or cool white according to the LED module.</p>
                </fieldset>
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
            </details>
            <p v-if="s_config_error" class="setup-hint setup-hint--blocked" role="alert">{{ s_config_error }}</p>
            <p v-else-if="b_needs_flash" class="setup-hint">Saved LED settings differ from the connected controller. Flash to apply them.</p>
            <p v-if="s_error || o_state.s_error__hardware_led" class="setup-hint setup-hint--blocked" role="alert">{{ s_error || o_state.s_error__hardware_led }}</p>
>>>>>>> 942bcdc04095cbb45a8e0cb9e7aff9776be3b37b
        </section>
    `,
};

export { o_component__hardware_led };
