import { f_n_rpm__manual } from './manual_speed.module.js';
import { o_actions } from './o_actions.js';
import { f_n_motor__axis, o_state, f_send_esp_run_continuous, f_send_esp_stop, f_send_esp_stop_all, f_save_setting, f_save_setting__debounced, f_set_mouse_jog, f_toggle_mouse_jog } from './index.js';

// ─── Gamepad constants ──────────────────────────────────────────────

// every key that jogs a motor: wasd for x/y, qe for the third motor
let A_S_KEY__JOG = ['w', 'a', 's', 'd', 'q', 'e'];

let N_DEADZONE = 0.15;
let N_MS__GAMEPAD_POLL = 50;
let N_RPM__MIN = 0.05;

// ─── Mouse jog constants ────────────────────────────────────────────

let N_MS__MOUSE_POLL = 80;
// only resend a motor command when the rpm changed by at least this much
let N_RPM__RESEND_DELTA = 0.05;

let o_component__jog = {
    name: 'component-jog',
    template: `
        <section class="hardware-inputs">
            <h3>Manual movement</h3>
            <o_component__manual_speed s_context="setup" />
            <p class="setup-hint">Default keys: A / D: X · W / S: Y · Q / E: focus. Hold to move; release to stop. Customize in Actions.</p>
            <button class="toolbar-toggle" :class="{ active: o_state.b_enabled__mouse_jog }" @click="f_toggle_mouse_jog">Mouse movement {{ o_state.b_enabled__mouse_jog ? 'on' : 'off' }}</button>
            <p class="setup-hint">On the camera image, hold the left mouse button for X/Y or the right button for focus.</p>
            <details>
                <summary>Input directions &amp; gamepad</summary>
                <div class="mapping-row header"><span>Input</span><span>Axis</span><span>Direction</span></div>
                <div class="mapping-row" v-for="s_key in ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']" :key="s_key">
                    <span>{{ s_key === 'mouse_right' ? 'Mouse ↑' : s_key.toUpperCase() }}</span>
                    <span>{{ { a: 'X', d: 'X', w: 'Y', s: 'Y', q: 'Z', e: 'Z', mouse_right: 'Z' }[s_key] }}</span>
                    <select v-model="f_o_mapping(s_key).s_dir" @change="f_on_mapping_change(s_key)">
                        <option value="cw">CW</option><option value="ccw">CCW</option>
                    </select>
                </div>
                <p class="setup-hint">{{ o_state.b_connected__gamepad ? o_state.s_name__gamepad : 'Open Gamepad to select a controller: right stick X/Y, left stick focus.' }}</p>
            </details>
        </section>

        <!-- transparent mouse jog overlay on top of the webcam image -->
        <teleport to="body">
            <div
                class="mouse-jog-overlay"
                v-if="o_state.b_enabled__mouse_jog"
                :class="{ driving: b_driving__mouse, 'driving-z': b_driving__mouse_z }"
                @mouseenter="f_on_mouse_enter"
                @mousemove="f_on_mouse_move"
                @mouseleave="f_on_mouse_leave"
                @mousedown.prevent="f_on_mouse_down"
                @mouseup="f_on_mouse_up"
                @contextmenu.prevent
            >
                <div class="mouse-jog-overlay-axis-x"></div>
                <div class="mouse-jog-overlay-axis-y"></div>
                <div class="mouse-jog-overlay-origin"></div>
                <svg class="mouse-jog-overlay-svg" v-if="b_driving__mouse">
                    <line
                        :x1="n_px_x__center" :y1="n_px_y__center"
                        :x2="n_px_x__mouse" :y2="n_px_y__mouse"
                    ></line>
                </svg>
                <!-- right button drives z: only the height counts -->
                <svg class="mouse-jog-overlay-svg svg-z" v-if="b_driving__mouse_z">
                    <line
                        :x1="n_px_x__mouse" :y1="n_px_y__center"
                        :x2="n_px_x__mouse" :y2="n_px_y__mouse"
                    ></line>
                </svg>
                <div
                    class="mouse-jog-overlay-z-band"
                    v-if="b_down__mouse_right"
                    :style="{
                        top: Math.min(n_px_y__center, n_px_y__mouse) + 'px',
                        height: Math.abs(n_px_y__mouse - n_px_y__center) + 'px'
                    }"
                ></div>
                <button
                    class="mouse-jog-overlay-button"
                    @click="f_off_mouse_jog"
                    @mouseenter="b_hover__mouse_button = true"
                    @mouseleave="b_hover__mouse_button = false"
                >
                    <span class="mouse-jog-overlay-button-label">&#10022; Mouse Jog active</span>
                    <span class="mouse-jog-overlay-button-sub">click to deactivate</span>
                </button>
                <div
                    class="mouse-jog-overlay-dot"
                    :class="{ down: b_down__mouse || b_down__mouse_right }"
                    v-if="b_inside__mouse_overlay && !b_hover__mouse_button"
                    :style="{ left: n_px_x__mouse + 'px', top: n_px_y__mouse + 'px' }"
                ></div>
                <div class="mouse-jog-overlay-readout">
                    <template v-if="b_driving__mouse_z">
                        Z {{ s_dir__mouse_z.toUpperCase() }} &nbsp; {{ f_n_rpm__axis('z').toFixed(2) }} rpm
                    </template>
                    <template v-else-if="b_driving__mouse">
                        X {{ f_n_rpm__axis('x').toFixed(2) }} &nbsp; Y {{ f_n_rpm__axis('y').toFixed(2) }} &nbsp; rpm
                    </template>
                    <template v-else>
                        hold <b>left</b> to move X / Y &nbsp;&mdash;&nbsp; hold <b>right</b> to move Z
                    </template>
                </div>
            </div>
        </teleport>
    `,
    data: function() {
        return {
            o_state: o_state,
            n_id__gamepad_interval: 0,
            o_sent__gamepad: {},
            s_selected__gamepad: '',

            // mouse jog
            n_id__mouse_interval: 0,
            b_inside__mouse_overlay: false,
            b_hover__mouse_button: false,
            b_down__mouse: false,
            b_down__mouse_right: false,
            n_px_x__mouse: 0,
            n_px_y__mouse: 0,
            n_px_x__center: 0,
            n_px_y__center: 0,
            n_x_nor__mouse: 0,
            n_y_nor__mouse: 0,
            o_sent__mouse_x: { n_motor: -1, n_rpm: 0, s_dir: '' },
            o_sent__mouse_y: { n_motor: -1, n_rpm: 0, s_dir: '' },
            o_sent__mouse_z: { n_motor: -1, n_rpm: 0, s_dir: '' },
        };
    },
    computed: {
        b_driving__mouse: function() {
            let o_self = this;
            if(!o_self.b_armed__mouse) return false;
            // the left button drives x/y
            return o_self.b_down__mouse;
        },
        b_driving__mouse_z: function() {
            let o_self = this;
            if(!o_self.b_armed__mouse) return false;
            // the right button drives z from the height of the cursor alone
            return o_self.b_down__mouse_right;
        },
        b_armed__mouse: function() {
            let o_self = this;
            if(!o_state.b_enabled__mouse_jog || !o_self.b_inside__mouse_overlay) return false;
            // the deactivate button is never a drive area
            return !o_self.b_hover__mouse_button;
        },
        // direction the z axis turns at the current cursor height
        s_dir__mouse_z: function() {
            let o_self = this;
            let o_map = o_state.o_mapping__mouse_right;
            let s_dir__above = (o_map && o_map.s_dir) || 'cw';
            let s_dir__below = s_dir__above === 'cw' ? 'ccw' : 'cw';
            return o_self.n_y_nor__mouse < 0 ? s_dir__above : s_dir__below;
        },
    },
    methods: {
        f_o_mapping: function(s_key) {
            return o_state['o_mapping__' + s_key];
        },
        f_on_mapping_change: function(s_key) {
            f_save_setting('o_mapping__' + s_key, o_state['o_mapping__' + s_key]);
        },
        f_on_mapping_change__mouse_right: function() {
            this.f_stop_mouse_axis('z');
            f_save_setting('o_mapping__mouse_right', o_state.o_mapping__mouse_right);
        },

        // ─── Keyboard jog ───────────────────────────────────────────

        f_refresh_keyboard_speed: function(s_axis) {
            if(o_state.b_scanning || o_state.b_flashing || !o_state.b_connected__esp) return;
            for(const s_key of s_axis === 'z' ? ['q', 'e'] : ['a', 'd', 'w', 's']) {
                if(!o_state.o_key_held[s_key]) continue;
                const mapping = this.f_get_mapping(s_key);
                if(mapping) f_send_esp_run_continuous(mapping.motor, mapping.rpm, mapping.direction);
            }
        },
        f_get_mapping: function(s_key) {
            let o_map = o_state['o_mapping__' + s_key];
            let n_motor = f_n_motor__axis({ a: 'x', d: 'x', w: 'y', s: 'y', q: 'z', e: 'z' }[s_key]);
            if(!o_map || n_motor === null) return null;
            return { motor: n_motor, direction: o_map.s_dir, rpm: f_n_rpm__manual(o_state, ['q', 'e'].includes(s_key) ? 'z' : 'xy') };
        },
        f_on_keydown: function(o_evt) {
            let o_self = this;
            let s_key = o_evt.key.toLowerCase();
            if(!A_S_KEY__JOG.includes(s_key)) return;
            if(o_evt.ctrlKey || o_evt.altKey || o_evt.metaKey || o_evt.target?.closest?.('input, select, textarea, [contenteditable]')) return;
            if(o_state.b_scanning || o_state.b_flashing || !o_state.b_connected__esp) return;
            if(o_state.o_key_held[s_key]) return;
            o_state.o_key_held[s_key] = true;

            let o_mapping = o_self.f_get_mapping(s_key);
            if(o_mapping){
                f_send_esp_run_continuous(o_mapping.motor, o_mapping.rpm, o_mapping.direction);
            }
        },
        f_on_keyup: function(o_evt) {
            let o_self = this;
            let s_key = o_evt.key.toLowerCase();
            if(!A_S_KEY__JOG.includes(s_key)) return;
            if(!o_state.o_key_held[s_key]) return;
            o_state.o_key_held[s_key] = false;

            let o_mapping = o_self.f_get_mapping(s_key);
            if(!o_mapping) return;

            // if another held key still drives this same motor, keep it running
            // in that key's direction instead of stopping the motor
            for(let s_key__held of A_S_KEY__JOG){
                if(!o_state.o_key_held[s_key__held]) continue;
                let o_mapping__held = o_self.f_get_mapping(s_key__held);
                if(o_mapping__held && o_mapping__held.motor === o_mapping.motor){
                    f_send_esp_run_continuous(o_mapping.motor, o_mapping__held.rpm, o_mapping__held.direction);
                    return;
                }
            }
            f_send_esp_stop(o_mapping.motor);
        },
        f_on_blur: function() {
            this.f_stop_gamepad();
            this.b_inside__mouse_overlay = false;
            this.b_down__mouse = false;
            this.b_down__mouse_right = false;
            this.n_x_nor__mouse = 0;
            this.n_y_nor__mouse = 0;
            this.f_stop_mouse_jog();
            for(let s_key of A_S_KEY__JOG){
                if(o_state.o_key_held[s_key]){
                    o_state.o_key_held[s_key] = false;
                    let o_mapping = this.f_get_mapping(s_key);
                    if(o_mapping){
                        f_send_esp_stop(o_mapping.motor);
                    }
                }
            }
        },

        // ─── Gamepad ────────────────────────────────────────────────

        f_on_gamepad_connected: function() { this.f_poll_gamepad(); },
        f_on_gamepad_disconnected: function(e) {
            if(e.gamepad.index === o_state.n_index__gamepad) this.f_stop_gamepad();
            this.f_poll_gamepad();
        },
        f_stop_gamepad: function() {
            for(const sent of Object.values(this.o_sent__gamepad)) f_send_esp_stop(sent.motor);
            this.o_sent__gamepad = {};
            o_state.b_armed__gamepad = false;
        },
        f_apply_deadzone: function(value) {
            if(!Number.isFinite(value) || Math.abs(value) <= N_DEADZONE) return 0;
            // Ignore center drift without rescaling the displayed stick value.
            return Math.max(-1, Math.min(1, value));
        },
        f_poll_gamepad: function() {
            let pads;
            try {
                if(!navigator.getGamepads) throw new Error('Gamepad input is unavailable in this browser. Use localhost or HTTPS in a supported browser.');
                pads = Array.from(navigator.getGamepads()).filter(p => p && p.connected);
                o_state.s_error__gamepad = '';
            } catch(e) {
                o_state.s_error__gamepad = e.message;
                pads = [];
            }
            o_state.a_o_gamepad = pads.map(p => ({ index: p.index, id: p.id }));
            // Select the first detected pad once; never silently switch on disconnect.
            if(o_state.n_index__gamepad === -1 && pads.length) o_state.n_index__gamepad = pads[0].index;
            const pad = pads.find(p => p.index === o_state.n_index__gamepad);
            const identity = pad ? pad.index + ':' + pad.id : '';
            if(identity !== this.s_selected__gamepad) {
                this.f_stop_gamepad();
                this.s_selected__gamepad = identity;
            }
            o_state.b_connected__gamepad = !!pad;
            o_state.s_name__gamepad = pad?.id || '';
            o_state.o_input__gamepad = pad ? {
                axes: Array.from(pad.axes),
                buttons: Array.from(pad.buttons, b => ({ value: b.value, pressed: b.pressed })),
                mapping: pad.mapping,
            } : null;
            // Some USB controllers expose the correct stick axes without the browser's
            // optional standard-mapping label. Use the same axes as the live display.
            const axesValid = pad && pad.axes.length >= 4 && Array.from(pad.axes).slice(0, 4).every(Number.isFinite);
            const blocked = !pad ? 'Waiting for controller'
                : o_state.b_input_suspended ? 'Motor control paused during action search'
                : !o_state.b_enabled__gamepad ? 'Motor control disabled'
                : !axesValid ? 'Controller needs four valid stick axes'
                : !o_state.b_connected__esp ? 'Connect the motors in Setup'
                : o_state.b_scanning ? 'Motor control paused during scan'
                : o_state.b_flashing ? 'Motor control paused during firmware update'
                : document.hidden || !document.hasFocus() ? 'Click in this window, then center both sticks'
                : '';
            if(blocked) {
                o_state.s_status__gamepad = blocked;
                this.f_stop_gamepad();
                return;
            }
            const values = o_state.o_action_axis || { x: this.f_apply_deadzone(pad.axes[2]), y: this.f_apply_deadzone(pad.axes[3]), z: this.f_apply_deadzone(pad.axes[1]) };
            if(!o_state.b_armed__gamepad) {
                this.f_stop_gamepad();
                if(Object.values(values).every(v => v === 0) && (!o_state.o_action_axis || (Array.from(pad.axes).every(v => Math.abs(v) <= N_DEADZONE) && Array.from(pad.buttons).every(b => b.value <= N_DEADZONE)))) o_state.b_armed__gamepad = true;
                o_state.s_status__gamepad = o_state.b_armed__gamepad ? 'Ready · move a stick to drive' : 'Center both sticks to enable movement';
                return;
            }
            const activity = [];
            const keys = { x: ['a', 'd'], y: ['w', 's'], z: ['q', 'e'] };
            for(const axis of ['x', 'y', 'z']) {
                const [negative, positive] = keys[axis];
                const mouse = axis === 'z' ? this.b_driving__mouse_z : this.b_driving__mouse;
                if(o_state.o_key_held[negative] || o_state.o_key_held[positive] || mouse) {
                    if(values[axis]) activity.push(axis.toUpperCase() + ': controlled by keyboard or mouse');
                    // The other input now owns this axis, including its stop command.
                    delete this.o_sent__gamepad[axis];
                    continue;
                }
                const mapping = this.f_get_mapping(values[axis] < 0 ? negative : positive);
                const rpm = Math.abs(values[axis]) * f_n_rpm__manual(o_state, axis);
                if(!mapping && values[axis]) activity.push(axis.toUpperCase() + ': no motor assigned in Setup');
                const previous = this.o_sent__gamepad[axis];
                if(previous !== undefined && (!mapping || previous.motor !== mapping.motor || rpm < N_RPM__MIN)) {
                    f_send_esp_stop(previous.motor);
                    delete this.o_sent__gamepad[axis];
                }
                if(mapping && rpm >= N_RPM__MIN) {
                    // Like mouse jog, run continuously at the requested speed. A held
                    // stick needs no repeated start commands; update only on change.
                    const sent = this.o_sent__gamepad[axis];
                    if(!sent || sent.motor !== mapping.motor || sent.direction !== mapping.direction || sent.rpm !== rpm) {
                        f_send_esp_run_continuous(mapping.motor, rpm, mapping.direction);
                        this.o_sent__gamepad[axis] = { motor: mapping.motor, rpm, direction: mapping.direction };
                    }
                    activity.push(axis.toUpperCase() + ' → motor ' + (mapping.motor + 1) + ' · ' + rpm.toFixed(2) + ' RPM');
                }
            }
            o_state.s_status__gamepad = activity.join(' / ') || 'Ready · move a stick to drive';
        },

        // ─── Mouse jog ──────────────────────────────────────────────

        f_toggle_mouse_jog: function() {
            f_toggle_mouse_jog();
        },
        f_off_mouse_jog: function() {
            let o_self = this;
            o_self.b_hover__mouse_button = false;
            o_self.b_inside__mouse_overlay = false;
            o_self.b_down__mouse = false;
            o_self.b_down__mouse_right = false;
            f_set_mouse_jog(false);
        },
        f_on_mouse_down: function(o_evt) {
            let o_self = this;
            if(o_evt.button === 0) o_self.b_down__mouse = true;
            else if(o_evt.button === 2) o_self.b_down__mouse_right = true;
            else return;
            o_self.f_on_mouse_move(o_evt);
        },
        f_on_mouse_up: function(o_evt) {
            let o_self = this;
            // without an event (blur, mode off) every button counts as released
            let n_button = o_evt ? o_evt.button : -1;
            if(n_button === 0 || n_button === -1){
                if(o_self.b_down__mouse){
                    o_self.b_down__mouse = false;
                    o_self.f_stop_mouse_axis('x');
                    o_self.f_stop_mouse_axis('y');
                }
            }
            if(n_button === 2 || n_button === -1){
                if(o_self.b_down__mouse_right){
                    o_self.b_down__mouse_right = false;
                    o_self.f_stop_mouse_axis('z');
                }
            }
        },
        f_n_rpm__axis: function(s_axis) {
            let o_self = this;
            let b_driving = s_axis === 'z' ? o_self.b_driving__mouse_z : o_self.b_driving__mouse;
            if(!b_driving) return 0;
            let n_nor = s_axis === 'x' ? o_self.n_x_nor__mouse : o_self.n_y_nor__mouse;
            let n_rpm = Math.min(Math.abs(n_nor), 1) * f_n_rpm__manual(o_state, s_axis);
            if(n_rpm < N_RPM__MIN) return 0;
            return n_rpm;
        },
        f_on_mouse_enter: function(o_evt) {
            let o_self = this;
            o_self.b_inside__mouse_overlay = true;
            o_self.f_on_mouse_move(o_evt);
        },
        f_on_mouse_move: function(o_evt) {
            let o_self = this;
            // the overlay only sees moves while the cursor is really on it
            // (panels sit above it), so this also covers a missed mouseenter
            o_self.b_inside__mouse_overlay = true;
            let o_rect = o_evt.currentTarget.getBoundingClientRect();
            o_self.n_px_x__center = o_rect.left + o_rect.width / 2;
            o_self.n_px_y__center = o_rect.top + o_rect.height / 2;
            o_self.n_px_x__mouse = o_evt.clientX;
            o_self.n_px_y__mouse = o_evt.clientY;

            let n_x_nor = (o_evt.clientX - o_self.n_px_x__center) / (o_rect.width / 2);
            let n_y_nor = (o_evt.clientY - o_self.n_px_y__center) / (o_rect.height / 2);
            o_self.n_x_nor__mouse = Math.max(-1, Math.min(1, n_x_nor));
            o_self.n_y_nor__mouse = Math.max(-1, Math.min(1, n_y_nor));
        },
        f_on_mouse_leave: function() {
            let o_self = this;
            o_self.b_inside__mouse_overlay = false;
            o_self.b_down__mouse = false;
            o_self.b_down__mouse_right = false;
            o_self.n_x_nor__mouse = 0;
            o_self.n_y_nor__mouse = 0;
            o_self.f_stop_mouse_jog();
        },
        f_o_sent__mouse_axis: function(s_axis) {
            let o_self = this;
            if(s_axis === 'x') return o_self.o_sent__mouse_x;
            if(s_axis === 'z') return o_self.o_sent__mouse_z;
            return o_self.o_sent__mouse_y;
        },
        f_forget_mouse_axis: function(s_axis) {
            let o_sent = this.f_o_sent__mouse_axis(s_axis);
            o_sent.n_motor = -1;
            o_sent.n_rpm = 0;
            o_sent.s_dir = '';
        },
        f_stop_mouse_axis: function(s_axis) {
            let o_self = this;
            let o_sent = o_self.f_o_sent__mouse_axis(s_axis);
            if(o_sent.n_motor === -1) return;
            f_send_esp_stop(o_sent.n_motor);
            o_sent.n_motor = -1;
            o_sent.n_rpm = 0;
            o_sent.s_dir = '';
        },
        f_stop_mouse_jog: function() {
            let o_self = this;
            o_self.f_stop_mouse_axis('x');
            o_self.f_stop_mouse_axis('y');
            o_self.f_stop_mouse_axis('z');
        },
        f_o_mapping__mouse_z: function() {
            let o_self = this;
            let o_map = o_state.o_mapping__mouse_right;
            if(!o_map || f_n_motor__axis('z') === null) return null;
            return {
                motor: f_n_motor__axis('z'),
                direction: o_self.s_dir__mouse_z,
            };
        },
        f_drive_mouse_axis: function(s_axis, n_nor) {
            let o_self = this;
            let n_rpm__max = f_n_rpm__manual(o_state, s_axis);
            let n_rpm = Math.min(Math.abs(n_nor), 1) * n_rpm__max;
            if(n_rpm < N_RPM__MIN){
                o_self.f_stop_mouse_axis(s_axis);
                return;
            }

            let o_mapping;
            if(s_axis === 'z'){
                o_mapping = o_self.f_o_mapping__mouse_z();
            } else {
                let s_key;
                if(s_axis === 'x') s_key = n_nor < 0 ? 'a' : 'd';
                else s_key = n_nor < 0 ? 'w' : 's';
                o_mapping = o_self.f_get_mapping(s_key);
            }
            if(!o_mapping){
                o_self.f_stop_mouse_axis(s_axis);
                return;
            }

            let o_sent = o_self.f_o_sent__mouse_axis(s_axis);
            // motor changed (direction flip across a mapping) -> stop the old one first
            if(o_sent.n_motor !== -1 && o_sent.n_motor !== o_mapping.motor){
                o_self.f_stop_mouse_axis(s_axis);
                o_sent = o_self.f_o_sent__mouse_axis(s_axis);
            }

            let b_same = o_sent.n_rpm__max === n_rpm__max
                && o_sent.n_motor === o_mapping.motor
                && o_sent.s_dir === o_mapping.direction
                && Math.abs(o_sent.n_rpm - n_rpm) < N_RPM__RESEND_DELTA;
            if(b_same) return;

            f_send_esp_run_continuous(o_mapping.motor, n_rpm, o_mapping.direction);
            o_sent.n_motor = o_mapping.motor;
            o_sent.n_rpm = n_rpm;
            o_sent.n_rpm__max = n_rpm__max;
            o_sent.s_dir = o_mapping.direction;
        },
        f_tick_mouse_jog: function() {
            let o_self = this;
            if(o_state.b_scanning || o_state.b_flashing) return;

            let b_drive = o_self.b_driving__mouse;
            let n_x_nor = b_drive ? o_self.n_x_nor__mouse : 0;
            let n_y_nor = b_drive ? o_self.n_y_nor__mouse : 0;

            let b_keyboard_x = o_state.o_key_held['a'] || o_state.o_key_held['d'];
            let b_keyboard_y = o_state.o_key_held['w'] || o_state.o_key_held['s'];

            // the keyboard owns the axis while a key is held, so forget what the
            // mouse last sent -> it re-issues the command once the key is released
            if(b_keyboard_x) o_self.f_forget_mouse_axis('x');
            else if(n_x_nor === 0) o_self.f_stop_mouse_axis('x');
            else o_self.f_drive_mouse_axis('x', n_x_nor);

            if(b_keyboard_y) o_self.f_forget_mouse_axis('y');
            else if(n_y_nor === 0) o_self.f_stop_mouse_axis('y');
            else o_self.f_drive_mouse_axis('y', n_y_nor);

            // right button: z, driven by the height of the cursor alone
            let n_z_nor = o_self.b_driving__mouse_z ? o_self.n_y_nor__mouse : 0;
            let b_keyboard_z = o_state.o_key_held['q'] || o_state.o_key_held['e'];
            if(b_keyboard_z) o_self.f_forget_mouse_axis('z');
            else if(n_z_nor === 0) o_self.f_stop_mouse_axis('z');
            else o_self.f_drive_mouse_axis('z', n_z_nor);
        },
        f_start_mouse_jog: function() {
            let o_self = this;
            if(o_self.n_id__mouse_interval) return;
            o_self.n_id__mouse_interval = setInterval(function(){ o_self.f_tick_mouse_jog(); }, N_MS__MOUSE_POLL);
        },
        f_stop_mouse_interval: function() {
            let o_self = this;
            clearInterval(o_self.n_id__mouse_interval);
            o_self.n_id__mouse_interval = 0;
        },
    },
    watch: {
        'o_state.b_enabled__mouse_jog': function(b_enabled) {
            let o_self = this;
            if(b_enabled){
                o_self.f_start_mouse_jog();
            } else {
                o_self.f_stop_mouse_interval();
                o_self.f_stop_mouse_jog();
            }
        },
        'o_state.n_rpm__jog': function() { this.f_refresh_keyboard_speed('xy'); },
        'o_state.n_rpm__focus_jog': function() { this.f_refresh_keyboard_speed('z'); },
    },
    mounted: function() {
        let o_self = this;
        o_state.o_action_axis = { x: 0, y: 0, z: 0 };
        for(let [s_axis, n_index] of [['x', 2], ['y', 3], ['z', 1]]) o_actions.f_register({
            id: 'motion.' + s_axis, name: 'Move ' + s_axis.toUpperCase(), description: 'Proportional movement; release to stop', category: 'Motion', type: 'analog', repeat: 'none', bindings: [{ source: 'axis', index: n_index }],
            invoke: n_value => { o_state.o_action_axis[s_axis] = n_value; },
        });
        for(let s_key of A_S_KEY__JOG) o_actions.f_register({
            id: 'motion.key.' + s_key, name: 'Jog ' + ({ a: 'X negative', d: 'X positive', w: 'Y negative', s: 'Y positive', q: 'Z negative', e: 'Z positive' }[s_key]), description: 'Hold to move; release to stop', category: 'Motion', repeat: 'none', bindings: [{ source: 'keyboard', keys: [s_key] }],
            accept: o_binding => o_binding.source === 'keyboard' || (o_state.b_enabled__gamepad && o_state.b_armed__gamepad),
            invoke: (n_value, s_phase) => n_value ? o_self.f_on_keydown({ key: s_key }) : o_self.f_on_keyup({ key: s_key }),
        });
        o_self._f_on_keydown = function(e){ o_self.f_on_keydown(e); };
        o_self._f_on_keyup = function(e){ o_self.f_on_keyup(e); };
        o_self._f_on_blur = function(){ o_self.f_on_blur(); };
        // catches a release over a panel or outside the window
        o_self._f_on_mouse_up = function(e){ o_self.f_on_mouse_up(e); };


        window.addEventListener('blur', o_self._f_on_blur);
        window.addEventListener('mouseup', o_self._f_on_mouse_up);

        o_self._f_on_gamepad_connected = function(e){ o_self.f_on_gamepad_connected(e); };
        o_self._f_on_gamepad_disconnected = function(e){ o_self.f_on_gamepad_disconnected(e); };
        window.addEventListener('gamepadconnected', o_self._f_on_gamepad_connected);
        window.addEventListener('gamepaddisconnected', o_self._f_on_gamepad_disconnected);

        o_self.n_id__gamepad_interval = setInterval(() => o_self.f_poll_gamepad(), N_MS__GAMEPAD_POLL);
        o_self._f_visibility = () => { if(document.hidden) o_self.f_on_blur(); };
        document.addEventListener('visibilitychange', o_self._f_visibility);
        if(o_state.b_enabled__mouse_jog) o_self.f_start_mouse_jog();
    },
    beforeUnmount: function() {
        let o_self = this;
        document.removeEventListener('keydown', o_self._f_on_keydown);
        document.removeEventListener('keyup', o_self._f_on_keyup);
        window.removeEventListener('blur', o_self._f_on_blur);
        window.removeEventListener('mouseup', o_self._f_on_mouse_up);
        window.removeEventListener('gamepadconnected', o_self._f_on_gamepad_connected);
        window.removeEventListener('gamepaddisconnected', o_self._f_on_gamepad_disconnected);
        clearInterval(o_self.n_id__gamepad_interval);
        document.removeEventListener('visibilitychange', o_self._f_visibility);
        o_self.f_stop_gamepad();
        o_self.f_stop_mouse_interval();
        o_self.f_stop_mouse_jog();
    },
};

export { o_component__jog };
