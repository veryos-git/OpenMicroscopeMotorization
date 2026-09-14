import { o_state, f_send_esp_run_continuous, f_send_esp_stop, f_save_setting, f_save_setting__debounced, f_set_mouse_jog, f_toggle_mouse_jog } from './index.js';

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
        <div class="overlay-panel panel-jog" :class="{ visible: o_state.o_panel_visibility.jog }">
            <div class="panel-header">
                <h2>Jog Settings</h2>
                <button class="panel-close" @click="f_close">&times;</button>
            </div>
            <div class="panel-body">
                <div class="jog-section-header">Keyboard</div>
                <div class="keybind-body">
                    <div>
                        <div class="wasd-visual">
                            <div class="wasd-row">
                                <div class="key-cap" :class="{ pressed: o_state.o_key_held['q'] }">Q</div>
                                <div class="key-cap" :class="{ pressed: o_state.o_key_held['w'] }">W</div>
                                <div class="key-cap" :class="{ pressed: o_state.o_key_held['e'] }">E</div>
                            </div>
                            <div class="wasd-row">
                                <div class="key-cap" :class="{ pressed: o_state.o_key_held['a'] }">A</div>
                                <div class="key-cap" :class="{ pressed: o_state.o_key_held['s'] }">S</div>
                                <div class="key-cap" :class="{ pressed: o_state.o_key_held['d'] }">D</div>
                            </div>
                        </div>
                        <div class="jog-speed-group" style="margin-top: 12px;">
                            <label>Jog RPM <span class="speed-value">{{ o_state.n_rpm__jog.toFixed(1) }}</span></label>
                            <input
                                type="range"
                                min="0.05" max="15" step="0.05"
                                v-model.number="o_state.n_rpm__jog"
                                @input="f_on_rpm_change"
                            >
                            <input
                                type="number"
                                min="0.05" max="15" step="0.05"
                                v-model.number="o_state.n_rpm__jog"
                                @input="f_on_rpm_change"
                                style="width:62px; margin-top:4px; background:rgba(10,10,12,0.6); border:1px solid var(--border); border-radius:6px; padding:4px 6px; color:var(--text); font-family:'JetBrains Mono',monospace; font-size:0.7rem; text-align:center; outline:none;"
                            >
                        </div>
                    </div>
                    <div class="mapping-grid">
                        <div class="mapping-row header">
                            <span>Key</span>
                            <span>Motor</span>
                            <span>Dir</span>
                        </div>
                        <div class="mapping-row" v-for="s_key in ['w','s','a','d','q','e']" :key="s_key">
                            <span class="key-label">{{ s_key.toUpperCase() }}</span>
                            <select
                                v-model="f_o_mapping(s_key).s_motor"
                                @change="f_on_mapping_change(s_key)"
                            >
                                <option value="none">&mdash;</option>
                                <option value="0">M0</option>
                                <option value="1">M1</option>
                                <option value="2">M2</option>
                            </select>
                            <select
                                v-model="f_o_mapping(s_key).s_dir"
                                @change="f_on_mapping_change(s_key)"
                            >
                                <option value="cw">CW</option>
                                <option value="ccw">CCW</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Mouse jog section -->
                <div class="mouse-jog-section">
                    <div class="mouse-jog-header">
                        <span>Mouse Jog</span>
                        <button
                            class="toolbar-toggle"
                            :class="{ active: o_state.b_enabled__mouse_jog }"
                            @click="f_toggle_mouse_jog"
                        >{{ o_state.b_enabled__mouse_jog ? 'active' : 'off' }}</button>
                    </div>

                    <div class="mouse-button-row" :class="{ down: b_down__mouse }">
                        <span class="mouse-button-tag">LEFT</span>
                        <span class="mouse-button-text">
                            X / Y &mdash; the further the cursor sits from the image center,
                            the faster. Uses the A/D and W/S mappings above.
                        </span>
                    </div>

                    <div class="mouse-button-row" :class="{ down: b_down__mouse_right }">
                        <span class="mouse-button-tag tag-z">RIGHT</span>
                        <span class="mouse-button-text">
                            Z &mdash; only the height of the cursor counts: above the center it
                            turns one way, below it the other.
                        </span>
                    </div>

                    <div class="mapping-grid" style="margin-top: 10px;">
                        <div class="mapping-row header">
                            <span>Btn</span>
                            <span>Motor</span>
                            <span>Above</span>
                        </div>
                        <div class="mapping-row">
                            <span class="key-label">R</span>
                            <select
                                v-model="o_state.o_mapping__mouse_right.s_motor"
                                @change="f_on_mapping_change__mouse_right"
                            >
                                <option value="none">&mdash;</option>
                                <option value="0">M0</option>
                                <option value="1">M1</option>
                                <option value="2">M2</option>
                            </select>
                            <select
                                v-model="o_state.o_mapping__mouse_right.s_dir"
                                @change="f_on_mapping_change__mouse_right"
                            >
                                <option value="cw">CW</option>
                                <option value="ccw">CCW</option>
                            </select>
                        </div>
                    </div>

                    <div class="mouse-jog-hint">
                        release the button to stop. The button in the center of the image
                        deactivates the mode, &laquo;Mouse Jog&raquo; in the top bar switches
                        it on again.
                    </div>
                    <div class="mouse-readout">
                        <span>X <b>{{ f_n_rpm__axis('x').toFixed(2) }}</b> rpm</span>
                        <span>Y <b>{{ f_n_rpm__axis('y').toFixed(2) }}</b> rpm</span>
                        <span>Z <b>{{ f_n_rpm__axis('z').toFixed(2) }}</b> rpm</span>
                    </div>
                </div>

                <!-- Gamepad section -->
                <div class="gamepad-section">
                    <div class="gamepad-header">Gamepad</div>
                    <div
                        class="gamepad-status"
                        :class="{ connected: o_state.b_connected__gamepad }"
                    >
                        <span class="gamepad-dot"></span>
                        <span>{{ o_state.b_connected__gamepad ? o_state.s_name__gamepad : 'connect a USB gamepad as a controller' }}</span>
                    </div>
                </div>
            </div>
        </div>

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
            n_axis_x__prev: 0,
            n_axis_y__prev: 0,

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
        f_close: function() {
            o_state.o_panel_visibility.jog = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_on_rpm_change: function() {
            f_save_setting__debounced('n_rpm__jog', String(o_state.n_rpm__jog));
        },
        f_on_mapping_change: function(s_key) {
            f_save_setting('o_mapping__' + s_key, o_state['o_mapping__' + s_key]);
        },
        f_on_mapping_change__mouse_right: function() {
            this.f_stop_mouse_axis('z');
            f_save_setting('o_mapping__mouse_right', o_state.o_mapping__mouse_right);
        },

        // ─── Keyboard jog ───────────────────────────────────────────

        f_get_mapping: function(s_key) {
            let o_map = o_state['o_mapping__' + s_key];
            if(!o_map || o_map.s_motor === 'none') return null;
            return { motor: parseInt(o_map.s_motor, 10), direction: o_map.s_dir };
        },
        f_on_keydown: function(o_evt) {
            let o_self = this;
            let s_key = o_evt.key.toLowerCase();
            if(!A_S_KEY__JOG.includes(s_key)) return;
            if(o_state.b_scanning) return;
            if(o_state.o_key_held[s_key]) return;
            o_state.o_key_held[s_key] = true;

            let o_mapping = o_self.f_get_mapping(s_key);
            if(o_mapping){
                f_send_esp_run_continuous(o_mapping.motor, o_state.n_rpm__jog, o_mapping.direction);
            }
        },
        f_on_keyup: function(o_evt) {
            let o_self = this;
            let s_key = o_evt.key.toLowerCase();
            if(!A_S_KEY__JOG.includes(s_key)) return;
            if(o_state.b_scanning) return;
            o_state.o_key_held[s_key] = false;

            let o_mapping = o_self.f_get_mapping(s_key);
            if(!o_mapping) return;

            // if another held key still drives this same motor, keep it running
            // in that key's direction instead of stopping the motor
            for(let s_key__held of A_S_KEY__JOG){
                if(!o_state.o_key_held[s_key__held]) continue;
                let o_mapping__held = o_self.f_get_mapping(s_key__held);
                if(o_mapping__held && o_mapping__held.motor === o_mapping.motor){
                    f_send_esp_run_continuous(o_mapping.motor, o_state.n_rpm__jog, o_mapping__held.direction);
                    return;
                }
            }
            f_send_esp_stop(o_mapping.motor);
        },
        f_on_blur: function() {
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

        f_on_gamepad_connected: function(o_evt) {
            let o_self = this;
            o_state.b_connected__gamepad = true;
            o_state.s_name__gamepad = o_evt.gamepad.id;
            console.log('Gamepad connected:', o_evt.gamepad.id);
            if(!o_self.n_id__gamepad_interval){
                o_self.n_id__gamepad_interval = setInterval(function(){ o_self.f_poll_gamepad(); }, N_MS__GAMEPAD_POLL);
            }
        },
        f_on_gamepad_disconnected: function(o_evt) {
            let o_self = this;
            console.log('Gamepad disconnected:', o_evt.gamepad.id);
            o_self.f_gamepad_stop_axis('x');
            o_self.f_gamepad_stop_axis('y');
            o_self.n_axis_x__prev = 0;
            o_self.n_axis_y__prev = 0;

            let a_o_gamepad = navigator.getGamepads();
            let b_any = false;
            let s_name__remaining = '';
            for(let o_gp of a_o_gamepad){
                if(o_gp){ b_any = true; s_name__remaining = o_gp.id; break; }
            }
            if(!b_any){
                clearInterval(o_self.n_id__gamepad_interval);
                o_self.n_id__gamepad_interval = 0;
                o_state.b_connected__gamepad = false;
                o_state.s_name__gamepad = '';
            } else {
                o_state.s_name__gamepad = s_name__remaining;
            }
        },
        f_apply_deadzone: function(n_val) {
            if(Math.abs(n_val) < N_DEADZONE) return 0;
            let n_sign = n_val > 0 ? 1 : -1;
            return n_sign * (Math.abs(n_val) - N_DEADZONE) / (1 - N_DEADZONE);
        },
        f_gamepad_stop_axis: function(s_axis) {
            let o_self = this;
            if(s_axis === 'x'){
                let o_map = o_self.f_get_mapping('a') || o_self.f_get_mapping('d');
                if(o_map) f_send_esp_stop(o_map.motor);
            } else {
                let o_map = o_self.f_get_mapping('w') || o_self.f_get_mapping('s');
                if(o_map) f_send_esp_stop(o_map.motor);
            }
        },
        f_gamepad_drive_axis: function(s_axis, n_val) {
            let o_self = this;
            let s_key_neg, s_key_pos;
            if(s_axis === 'x'){ s_key_neg = 'a'; s_key_pos = 'd'; }
            else { s_key_neg = 'w'; s_key_pos = 's'; }

            let s_key = n_val < 0 ? s_key_neg : s_key_pos;
            let o_mapping = o_self.f_get_mapping(s_key);
            if(!o_mapping) return;

            let n_rpm = Math.abs(n_val) * o_state.n_rpm__jog;
            if(n_rpm < N_RPM__MIN) return;

            f_send_esp_run_continuous(o_mapping.motor, n_rpm, o_mapping.direction);
        },
        f_poll_gamepad: function() {
            let o_self = this;
            if(o_state.b_scanning) return;
            let a_o_gamepad = navigator.getGamepads();
            let o_gamepad = null;
            for(let o_gp of a_o_gamepad){
                if(o_gp){ o_gamepad = o_gp; break; }
            }
            if(!o_gamepad) return;

            let n_axis_x = o_self.f_apply_deadzone(o_gamepad.axes[0] ?? 0);
            let n_axis_y = o_self.f_apply_deadzone(o_gamepad.axes[1] ?? 0);

            let b_keyboard_x = o_state.o_key_held['a'] || o_state.o_key_held['d'];
            let b_keyboard_y = o_state.o_key_held['w'] || o_state.o_key_held['s'];

            // X axis
            if(!b_keyboard_x){
                let b_was_active = o_self.n_axis_x__prev !== 0;
                let b_now_active = n_axis_x !== 0;
                if(b_now_active){
                    o_self.f_gamepad_drive_axis('x', n_axis_x);
                } else if(b_was_active && !b_now_active){
                    o_self.f_gamepad_stop_axis('x');
                }
            }

            // Y axis
            if(!b_keyboard_y){
                let b_was_active = o_self.n_axis_y__prev !== 0;
                let b_now_active = n_axis_y !== 0;
                if(b_now_active){
                    o_self.f_gamepad_drive_axis('y', n_axis_y);
                } else if(b_was_active && !b_now_active){
                    o_self.f_gamepad_stop_axis('y');
                }
            }

            o_self.n_axis_x__prev = n_axis_x;
            o_self.n_axis_y__prev = n_axis_y;
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
            let n_rpm = Math.min(Math.abs(n_nor), 1) * o_state.n_rpm__jog;
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
            if(!o_map || o_map.s_motor === 'none') return null;
            return {
                motor: parseInt(o_map.s_motor, 10),
                direction: o_self.s_dir__mouse_z,
            };
        },
        f_drive_mouse_axis: function(s_axis, n_nor) {
            let o_self = this;
            let n_rpm = Math.min(Math.abs(n_nor), 1) * o_state.n_rpm__jog;
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

            let b_same = o_sent.n_motor === o_mapping.motor
                && o_sent.s_dir === o_mapping.direction
                && Math.abs(o_sent.n_rpm - n_rpm) < N_RPM__RESEND_DELTA;
            if(b_same) return;

            f_send_esp_run_continuous(o_mapping.motor, n_rpm, o_mapping.direction);
            o_sent.n_motor = o_mapping.motor;
            o_sent.n_rpm = n_rpm;
            o_sent.s_dir = o_mapping.direction;
        },
        f_tick_mouse_jog: function() {
            let o_self = this;
            if(o_state.b_scanning) return;

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
        // when the jog speed changes while keys are held, re-issue the command
        // so the new speed applies immediately (mouse/gamepad already poll it)
        'o_state.n_rpm__jog': function(n_rpm) {
            let o_self = this;
            if(!isFinite(n_rpm)) return;
            if(o_state.b_scanning) return;
            for(let s_key of A_S_KEY__JOG){
                if(!o_state.o_key_held[s_key]) continue;
                let o_mapping = o_self.f_get_mapping(s_key);
                if(o_mapping){
                    f_send_esp_run_continuous(o_mapping.motor, n_rpm, o_mapping.direction);
                }
            }
        },
    },
    mounted: function() {
        let o_self = this;
        o_self._f_on_keydown = function(e){ o_self.f_on_keydown(e); };
        o_self._f_on_keyup = function(e){ o_self.f_on_keyup(e); };
        o_self._f_on_blur = function(){ o_self.f_on_blur(); };
        // catches a release over a panel or outside the window
        o_self._f_on_mouse_up = function(e){ o_self.f_on_mouse_up(e); };
        document.addEventListener('keydown', o_self._f_on_keydown);
        document.addEventListener('keyup', o_self._f_on_keyup);
        window.addEventListener('blur', o_self._f_on_blur);
        window.addEventListener('mouseup', o_self._f_on_mouse_up);

        o_self._f_on_gamepad_connected = function(e){ o_self.f_on_gamepad_connected(e); };
        o_self._f_on_gamepad_disconnected = function(e){ o_self.f_on_gamepad_disconnected(e); };
        window.addEventListener('gamepadconnected', o_self._f_on_gamepad_connected);
        window.addEventListener('gamepaddisconnected', o_self._f_on_gamepad_disconnected);

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
        o_self.f_stop_mouse_interval();
        o_self.f_stop_mouse_jog();
    },
};

export { o_component__jog };
