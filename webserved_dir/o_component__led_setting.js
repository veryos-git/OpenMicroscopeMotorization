import { o_state, f_save_setting__debounced, f_send_esp } from './index.js';
import { f_o_hardware_led_config, f_s_hardware_led_output_error } from './hardware_led.module.js';

let o_component__led_setting = {
    name: 'component-led-setting',
    data: function() {
        return { o_state, o_output: { ...f_o_hardware_led_config().o_startup }, b_dirty: false, s_error: '' };
    },
    computed: {
        o_report: function() { return o_state.o_hardware_led; },
        b_ready: function() { return o_state.b_connected__esp && this.o_report?.b_ready && !o_state.b_flashing; },
        b_rgbw: function() { return this.o_report?.o_config?.s_protocol === 'rgbw'; },
        s_status: function() {
            if (!o_state.b_connected__esp) return 'Connect the controller to use the LED.';
            if (!this.o_report) return 'Flash updated firmware in Setup to add LED support.';
            if (!this.o_report.o_config.b_enabled) return 'LED is disabled in the flashed firmware. Enable it in Setup and flash to apply.';
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
        f_close: function() {
            o_state.o_panel_visibility.led_setting = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_open_setup: function() {
            o_state.o_panel_visibility.led_setting = false;
            o_state.o_panel_visibility.setup = true;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
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
        <div class="overlay-panel panel-led-setting" :class="{ visible: o_state.o_panel_visibility.led_setting }">
            <div class="panel-header">
                <h2>LED Settings</h2>
                <button class="panel-close" @click="f_close" aria-label="Close LED settings">&times;</button>
            </div>
            <div class="panel-body hardware-led">
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
                <button class="btn-small" @click="f_open_setup">Open LED hardware setup</button>
                <p class="setup-hint">Configure LED wiring, protocol and startup light in Setup.</p>
            </div>
        </div>
    `,
};

export { o_component__led_setting };
