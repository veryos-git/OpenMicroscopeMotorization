import { o_state, f_save_setting__debounced, f_send_esp, f_register_esp_handler } from './index.js';
import { f_s_hardware_led_output_error, f_n_pct__led_channel, f_n_led_channel__from_pct } from './hardware_led.module.js';
import { o_component__icon } from './o_component__icon.js';

// The controller answers every command with a full status reply. Keeping one
// LED command in flight lets a dragged slider follow at the speed of the USB
// link instead of queueing a backlog of outdated colours.
let n_ms__timeout__led_reply = 300;
// A status poll sent just before an edit still reports the previous output.
let n_ms__hold__led_edit = 1500;

let a_o_led_channel = [
    { s_key: 'n_red', s_label: 'RED', s_name: 'Red', s_color: '#ff5a5a' },
    { s_key: 'n_green', s_label: 'GREEN', s_name: 'Green', s_color: '#5ad67a' },
    { s_key: 'n_blue', s_label: 'BLUE', s_name: 'Blue', s_color: '#5a8cff' },
    { s_key: 'n_white', s_label: 'WW/CW', s_name: 'Warm/cold white', s_color: '#ffe7b8', b_white: true },
];

let o_component__led_setting = {
    name: 'component-led-setting',
    components: { ui_icon: o_component__icon },
    data: function() {
        return { o_state, o_pct: { n_red: 0, n_green: 0, n_blue: 0, n_white: 0 }, s_error: '', b_sending: false, b_queued: false, n_ms__edit: 0 };
    },
    computed: {
        o_report: function() { return o_state.o_hardware_led; },
        b_ready: function() { return o_state.b_connected__esp && this.o_report?.b_ready && !o_state.b_flashing; },
        b_rgbw: function() { return this.o_report?.o_config?.s_protocol === 'rgbw'; },
        a_o_channel: function() { return a_o_led_channel.filter(o_channel => !o_channel.b_white || this.b_rgbw); },
        s_status: function() {
            if (!o_state.b_connected__esp) return 'Connect the controller to use the LED.';
            if (!this.o_report) return 'Flash updated firmware in Setup to add LED support.';
            if (!this.o_report.o_config.b_enabled) return 'LED is disabled in the flashed firmware. Enable it in Setup and flash to apply.';
            return this.o_report.s_error || '';
        },
        s_tooltip__setup: function() {
            let o_config = this.o_report?.o_config;
            if (!o_config?.b_enabled) return 'LED hardware setup';
            return `LED hardware setup · GPIO ${o_config.n_pin} · ${o_config.n_count} LED(s) · ${o_config.s_protocol.toUpperCase()}`;
        },
    },
    watch: {
        'o_report.o_output': {
            immediate: true,
            handler: function() { this.f_sync_from_report(); },
        },
        'o_state.b_connected__esp': function() {
            this.f_release();
            this.b_queued = false;
            this.s_error = '';
        },
    },
    mounted: function() {
        this.f_unregister__esp = f_register_esp_handler(o_data => {
            if (o_data.type === 'status' || o_data.type === 'hardwareLedError') this.f_on_reply();
        });
    },
    beforeUnmount: function() {
        this.f_unregister__esp?.();
        clearTimeout(this.n_id__timeout__reply);
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
        f_sync_from_report: function() {
            let o_output = this.o_report?.o_output;
            if (!o_output || this.b_sending || this.b_queued || Date.now() - this.n_ms__edit < n_ms__hold__led_edit) return;
            for (let o_channel of a_o_led_channel) this.o_pct[o_channel.s_key] = f_n_pct__led_channel(o_output, o_channel.s_key);
        },
        // Slider and number field share one value; an invalid entry snaps back.
        f_set_pct: function(s_key, el) {
            let n_pct = Number(el.value);
            if (el.value !== '' && Number.isFinite(n_pct)) {
                this.o_pct[s_key] = Math.round(Math.min(100, Math.max(0, n_pct)) * 10) / 10;
                this.n_ms__edit = Date.now();
                this.f_queue();
            }
            el.value = this.o_pct[s_key];
        },
        f_queue: function() {
            if (!this.b_ready) return;
            this.b_queued = true;
            if (!this.b_sending) this.f_send();
        },
        f_send: function() {
            this.b_queued = false;
            // Brightness stays at full scale: each channel percentage is the output.
            let o_output = { b_on: true, n_brightness: 255 };
            for (let o_channel of a_o_led_channel) {
                o_output[o_channel.s_key] = o_channel.b_white && !this.b_rgbw ? 0 : f_n_led_channel__from_pct(this.o_pct[o_channel.s_key]);
            }
            this.s_error = f_s_hardware_led_output_error(o_output);
            if (this.s_error) return;
            o_state.s_error__hardware_led = '';
            try {
                f_send_esp({ command: 'setLed', ...o_output });
            } catch (o_err) {
                this.s_error = o_err.message;
                return;
            }
            this.b_sending = true;
            this.n_id__timeout__reply = setTimeout(() => this.f_on_reply(), n_ms__timeout__led_reply);
        },
        f_on_reply: function() {
            if (!this.b_sending) return;
            this.f_release();
            if (this.b_queued) this.f_send();
        },
        f_release: function() {
            clearTimeout(this.n_id__timeout__reply);
            this.b_sending = false;
        },
    },
    template: `
        <div class="overlay-panel panel-led-setting" :class="{ visible: o_state.o_panel_visibility.led_setting }">
            <div class="panel-header">
                <h2><ui_icon s_name="led" /> LED</h2>
                <button class="panel-header-action" @click="f_open_setup" aria-label="Open LED hardware setup" :data-tooltip="s_tooltip__setup"><ui_icon s_name="setup" /></button>
                <button class="panel-close" @click="f_close" aria-label="Close LED settings">&times;</button>
            </div>
            <div class="panel-body">
                <p v-if="s_status" class="setup-hint" role="status">{{ s_status }}</p>
                <fieldset v-if="o_report?.o_config.b_enabled" class="led-channel-list" :disabled="!b_ready">
                    <div v-for="o_channel in a_o_channel" :key="o_channel.s_key" class="led-channel" :style="{ '--card-accent': o_channel.s_color }"
                        :data-tooltip="o_channel.b_white ? 'Warm or cold white · depends on the LED module' : null">
                        <span class="led-channel-name">{{ o_channel.s_label }}</span>
                        <ui_icon s_name="darkness" />
                        <input type="range" min="0" max="100" step="0.1" :value="o_pct[o_channel.s_key]" @input="f_set_pct(o_channel.s_key, $event.target)"
                            :aria-label="o_channel.s_name + ' LED channel'" />
                        <ui_icon s_name="lightness" />
                        <input type="number" min="0" max="100" step="0.1" :value="o_pct[o_channel.s_key]" @change="f_set_pct(o_channel.s_key, $event.target)"
                            :aria-label="o_channel.s_name + ' LED channel %'" />
                        <span aria-hidden="true">%</span>
                    </div>
                </fieldset>
                <p v-if="s_error || o_state.s_error__hardware_led" class="setup-hint setup-hint--blocked" role="alert">{{ s_error || o_state.s_error__hardware_led }}</p>
            </div>
        </div>
    `,
};

export { o_component__led_setting };
