import { o_state, f_send_esp_move_step, f_send_esp_stop, f_send_wsmsg_with_response, f_save_setting__debounced, f_save_flat_field } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_save_image, f_o_frame__imagedata } from './o_capture.module.js';
import { f_o_camera_snapshot } from './o_camera.module.js';
import {
    f_o_flat__average,
    f_flat__set,
    f_flat__clear,
    f_o_flat,
    f_b_flat__loaded,
} from './o_flatfield.module.js';

// flat-field ("dust remove") calibration panel.
//
// flow: the user moves to an empty bright region and defocuses, then the panel
// captures a few frames at different defocus levels (auto-driving the focus
// motor between them, with a manual fallback). the frames are averaged into one
// flat image and turned into a gain map that is divided out of the live view
// and every captured frame — so scans and focus stacks inherit it automatically.

let N_RPM__DEFOCUS = 6.0;
let N_MS__MOVE_TIMEOUT = 30000;

let o_component__flat_field = {
    name: 'component-flat-field',
    template: `
        <div class="overlay-panel panel-flat_field" :class="{ visible: o_state.o_panel_visibility.flat }">
            <div class="panel-header">
                <h2>Flat Field</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <!-- always-on toggle + shortcut hint -->
                <div class="filter-row">
                    <span class="filter-label">Dust / flat correction</span>
                    <button
                        class="toolbar-toggle"
                        :class="{ active: o_state.o_flat_field.b_active }"
                        @click="f_toggle_active"
                    >{{ o_state.o_flat_field.b_active ? 'on' : 'off' }}</button>
                </div>
                <div class="filter-note">shortcut: press <b>F</b> to toggle the correction</div>
                <div class="filter-note" v-if="o_state.o_flat_field.b_active && !b_loaded">
                    no flat loaded yet — calibrate first
                </div>

                <!-- idle: intro + calibration config -->
                <template v-if="s_status === 'idle'">
                    <div class="focus-note">
                        averages a few defocused frames of an empty bright region
                        into a flat image (illumination + dust), then divides it
                        out of the live view and every captured tile / stack frame.
                    </div>

                    <div class="focus-config">
                        <div class="focus-field">
                            <label>Focus motor</label>
                            <select v-model="o_config.s_motor" @change="f_save_config">
                                <option value="0">M0</option>
                                <option value="1">M1</option>
                                <option value="2">M2</option>
                            </select>
                        </div>
                        <div class="focus-field">
                            <label>Frames</label>
                            <input type="number" min="2" max="10" v-model.number="o_config.n_its" @change="f_save_config">
                        </div>
                        <div class="focus-field">
                            <label>Defocus step</label>
                            <input type="number" min="1" v-model.number="o_config.n_step__defocus" @change="f_save_config">
                        </div>
                        <div class="focus-field">
                            <label>Settle (ms)</label>
                            <input type="number" min="0" step="50" v-model.number="o_config.n_ms__settle" @change="f_save_config">
                        </div>
                        <div class="focus-field">
                            <label>Auto defocus (Z motor)</label>
                            <input type="checkbox" v-model="o_config.b_auto_defocus" @change="f_save_config">
                        </div>
                    </div>

                    <button class="btn-scan-start" @click="f_calibrate" :disabled="!b_ready">Calibrate</button>

                    <div class="focus-note" v-if="!o_state.b_streaming__webcam">start a camera first</div>
                    <div class="focus-note" v-else>
                        move to an empty white region and defocus until the view is
                        a featureless bright field, then press Calibrate. use manual
                        exposure so the flat matches your captures.
                    </div>

                    <div class="focus-note" v-if="b_loaded && s_warning__camera" style="color: var(--yellow);">{{ s_warning__camera }}</div>
                </template>

                <!-- capturing -->
                <template v-if="s_status === 'capturing'">
                    <div class="focus-status running">{{ s_status__detail }}</div>
                    <div class="scan-progress-count">{{ n_cnt__captured }} / {{ o_config.n_its }}</div>
                    <div class="focusstack-progress-track">
                        <div class="focusstack-progress-fill" :style="{ width: n_pct__progress + '%' }"></div>
                    </div>
                    <button v-if="b_waiting__next" class="btn-scan-start" @click="f_next">Continue</button>
                    <button class="btn-scan-stop" @click="f_stop">Stop</button>
                </template>

                <!-- verify -->
                <template v-if="s_status === 'verify'">
                    <img v-if="s_src__preview" :src="s_src__preview" class="focusstack-preview" />
                    <div class="filter-note">
                        mean R/G/B:
                        <b>{{ s_mean__channel }}</b>
                    </div>
                    <div class="filter-note">
                        this is the flat image — it should look like a smooth bright
                        field with only dust spots, not the specimen.
                    </div>
                    <div class="filter-row" style="margin-top: 10px;">
                        <button class="btn-scan-start" @click="f_apply">Apply &amp; enable</button>
                        <button class="btn-small" @click="f_retake">Retake</button>
                        <button class="btn-small" @click="f_cancel">Cancel</button>
                    </div>
                </template>

                <!-- loaded flat summary -->
                <template v-if="b_loaded && s_status !== 'capturing' && s_status !== 'verify'">
                    <div class="filter-group">
                        <div class="filter-note">
                            flat: {{ n_scl_x__flat }} &times; {{ n_scl_y__flat }} px
                            · saved {{ s_path_flat }}
                        </div>
                        <div class="filter-row" style="margin-top: 8px;">
                            <button class="btn-small" @click="f_delete">Delete flat</button>
                        </div>
                    </div>
                </template>

                <div v-if="s_error" class="focusstack-error">{{ s_error }}</div>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            // 'idle' | 'capturing' | 'verify'
            s_status: 'idle',
            s_status__detail: '',
            s_error: '',
            b_running: false,
            b_stop_requested: false,
            b_waiting__next: false,
            n_cnt__captured: 0,
            s_src__preview: '',
            o_config: {
                s_motor: '2',
                n_step__defocus: 40,
                n_its: 3,
                n_ms__settle: 350,
                b_auto_defocus: true,
            },
        };
    },
    computed: {
        b_ready: function() {
            return o_state.b_streaming__webcam && !o_state.b_scanning;
        },
        b_loaded: function() {
            return o_state.o_flat_field.b_loaded && f_b_flat__loaded();
        },
        n_pct__progress: function() {
            let o_self = this;
            if(!o_self.o_config.n_its) return 0;
            return Math.max(0, Math.min(100, (o_self.n_cnt__captured / o_self.o_config.n_its) * 100));
        },
        a_n_mean__channel: function() {
            return o_state.o_flat_field.a_n_mean__channel || [0, 0, 0];
        },
        s_mean__channel: function() {
            let a_n_mean = this.a_n_mean__channel;
            return a_n_mean.map(function(n_value){
                return Number(n_value).toFixed(1);
            }).join(' / ');
        },
        n_scl_x__flat: function() {
            return o_state.o_flat_field.n_scl_x;
        },
        n_scl_y__flat: function() {
            return o_state.o_flat_field.n_scl_y;
        },
        s_path_flat: function() {
            return o_state.o_flat_field.s_path_flat || '';
        },
        s_warning__camera: function() {
            let o_flat = o_state.o_flat_field;
            if(!o_flat.o_camera__flat || !o_state.o_camera.b_active) return '';
            let o_now = o_state.o_camera;
            let a_s_diff = [];
            if(o_now.s_mode__exposure !== o_flat.o_camera__flat.s_mode__exposure) a_s_diff.push('exposure mode');
            if(o_now.n_time__exposure !== o_flat.o_camera__flat.n_time__exposure) a_s_diff.push('exposure time');
            if(o_now.n_iso !== o_flat.o_camera__flat.n_iso) a_s_diff.push('gain/iso');
            if(o_now.s_mode__white_balance !== o_flat.o_camera__flat.s_mode__white_balance) a_s_diff.push('white balance');
            if(!a_s_diff.length) return '';
            return 'camera settings differ from when this flat was taken: ' + a_s_diff.join(', ') + ' — recalibrate or restore the settings';
        },
    },
    methods: {
        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.flat = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__flat_field', this.o_config);
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){
                return o.s_key === 'o_config__flat_field';
            });
            if(!o_setting || !o_setting.s_value) return;
            try {
                Object.assign(o_self.o_config, JSON.parse(o_setting.s_value));
            } catch(e) { /* ignore parse errors */ }
        },

        // ── Toggle / shortcut ───────────────────────────────────────

        f_toggle_active: function() {
            let o_self = this;
            let o_flat = o_state.o_flat_field;
            if(!o_flat.s_path_flat){
                // nothing to enable yet -> open this panel so the user can calibrate
                o_state.o_panel_visibility.flat = true;
                f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
                return;
            }
            o_flat.b_active = !o_flat.b_active;
            f_save_flat_field();
        },
        f_on_keydown: function(o_evt) {
            let o_self = this;
            if(o_evt.key !== 'f' && o_evt.key !== 'F') return;
            if(o_evt.metaKey || o_evt.ctrlKey || o_evt.altKey) return;
            let o_target = o_evt.target;
            if(o_target && (o_target.tagName === 'INPUT' || o_target.tagName === 'TEXTAREA' || o_target.tagName === 'SELECT')) return;
            if(o_state.b_scanning) return;
            if(o_state.o_panel_visibility.manual_stitch) return; // 'f' is used there
            o_evt.preventDefault();
            o_self.f_toggle_active();
        },

        // ── Motion / timing ─────────────────────────────────────────

        f_delay: function(n_ms) {
            return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
        },
        f_move: async function(n_step) {
            let o_self = this;
            if(n_step === 0) return;
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            let o_promise__move = f_send_esp_move_step(n_motor, n_step, N_RPM__DEFOCUS);
            let o_promise__timeout = new Promise(function(resolve){
                setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT);
            });
            let v_result = await Promise.race([o_promise__move, o_promise__timeout]);
            if(v_result === 'timeout'){
                f_send_esp_stop(n_motor);
            }
        },
        f_wait__next: function() {
            let o_self = this;
            return new Promise(function(resolve){
                o_self._f_resolve__next = resolve;
            });
        },
        f_next: function() {
            let o_self = this;
            if(o_self._f_resolve__next){
                let f_resolve = o_self._f_resolve__next;
                o_self._f_resolve__next = null;
                f_resolve();
            }
        },

        // ── Folder / PNG helpers ────────────────────────────────────

        f_s_path_folder__flat: async function() {
            let o_resp = await f_send_wsmsg_with_response(
                f_o_wsmsg('flatfield_create_folder', {})
            );
            if(!o_resp.v_result || !o_resp.v_result.s_path_folder){
                throw new Error('failed to create flat field folder');
            }
            return o_resp.v_result.s_path_folder;
        },
        f_save_flat_png: async function(o_flat, s_path_folder) {
            let el_canvas = document.createElement('canvas');
            el_canvas.width = o_flat.n_scl_x;
            el_canvas.height = o_flat.n_scl_y;
            let o_ctx = el_canvas.getContext('2d');
            o_ctx.putImageData(new ImageData(o_flat.a_n_byte, o_flat.n_scl_x, o_flat.n_scl_y), 0, 0);
            let o_blob = await new Promise(function(resolve){
                el_canvas.toBlob(resolve, 'image/png');
            });
            await f_save_image(o_blob, s_path_folder, 'flat.png');
        },
        f_s_src__flat_preview: function(o_flat) {
            let el_canvas = document.createElement('canvas');
            el_canvas.width = o_flat.n_scl_x;
            el_canvas.height = o_flat.n_scl_y;
            let o_ctx = el_canvas.getContext('2d');
            o_ctx.putImageData(new ImageData(o_flat.a_n_byte, o_flat.n_scl_x, o_flat.n_scl_y), 0, 0);
            return el_canvas.toDataURL('image/jpeg', 0.7);
        },

        // ── Calibration ─────────────────────────────────────────────

        f_calibrate: async function() {
            let o_self = this;
            if(o_self.b_running || !o_self.b_ready) return;

            o_self.b_running = true;
            o_self.b_stop_requested = false;
            o_self.b_waiting__next = false;
            o_self.s_status = 'capturing';
            o_self.s_status__detail = '';
            o_self.s_error = '';
            o_self.n_cnt__captured = 0;
            o_self.s_src__preview = '';
            o_state.b_scanning = true;

            let a_o_frame = [];
            try {
                let n_its = Math.max(2, Math.min(10, Math.round(o_self.o_config.n_its)));
                for(let n_it = 0; n_it < n_its; n_it++){
                    if(o_self.b_stop_requested) break;

                    o_self.s_status__detail = 'capturing ' + (n_it + 1) + ' / ' + n_its;
                    await o_self.f_delay(o_self.o_config.n_ms__settle);
                    let o_frame = await f_o_frame__imagedata();
                    a_o_frame.push(o_frame);
                    o_self.n_cnt__captured++;

                    if(n_it < n_its - 1){
                        if(o_self.o_config.b_auto_defocus && o_state.b_connected__esp){
                            o_self.s_status__detail = 'defocusing...';
                            await o_self.f_move(o_self.o_config.n_step__defocus);
                        } else {
                            o_self.s_status__detail = 'defocus a little more, then continue';
                            o_self.b_waiting__next = true;
                            await o_self.f_wait__next();
                            o_self.b_waiting__next = false;
                        }
                    }
                }

                if(o_self.b_stop_requested) throw new Error('stopped');
                if(a_o_frame.length < 2) throw new Error('not enough frames captured');

                let o_flat = f_o_flat__average(a_o_frame);
                if(!o_flat) throw new Error('failed to average frames');

                o_self.s_status__detail = 'saving flat...';
                let s_path_folder = await o_self.f_s_path_folder__flat();
                let s_path_flat = s_path_folder + '/' + 'flat.png';
                await o_self.f_save_flat_png(o_flat, s_path_folder);

                // store the flat in the non-reactive cache and mirror its
                // metadata into reactive state
                f_flat__set(o_flat.a_n_byte, o_flat.n_scl_x, o_flat.n_scl_y, {
                    s_path_flat: s_path_flat,
                    n_ms__created: Date.now(),
                });
                o_state.o_flat_field.b_loaded = true;
                o_state.o_flat_field.s_path_flat = s_path_flat;
                o_state.o_flat_field.n_scl_x = o_flat.n_scl_x;
                o_state.o_flat_field.n_scl_y = o_flat.n_scl_y;
                o_state.o_flat_field.a_n_mean__channel = f_o_flat().a_n_mean__channel.slice();
                o_state.o_flat_field.n_ms__created = Date.now();
                o_state.o_flat_field.o_camera__flat = f_o_camera_snapshot();
                f_save_flat_field();

                o_self.s_src__preview = o_self.f_s_src__flat_preview(o_flat);
                o_self.s_status = 'verify';
            } catch(o_error) {
                o_self.s_error = o_self.b_stop_requested ? '' : (o_error.message || String(o_error));
                o_self.s_status = 'idle';
            }

            o_state.b_scanning = false;
            o_self.b_running = false;
        },
        f_stop: function() {
            let o_self = this;
            o_self.b_stop_requested = true;
            if(o_state.b_connected__esp){
                f_send_esp_stop(parseInt(o_self.o_config.s_motor, 10));
            }
            o_self.f_next();
        },
        f_apply: function() {
            let o_self = this;
            o_state.o_flat_field.b_active = true;
            f_save_flat_field();
            o_self.s_status = 'idle';
            o_self.s_src__preview = '';
        },
        f_retake: function() {
            let o_self = this;
            o_self.s_status = 'idle';
            o_self.s_src__preview = '';
            o_self.f_calibrate();
        },
        f_cancel: function() {
            let o_self = this;
            o_self.s_status = 'idle';
            o_self.s_src__preview = '';
        },
        f_delete: function() {
            let o_self = this;
            f_flat__clear();
            o_state.o_flat_field.b_active = false;
            o_state.o_flat_field.b_loaded = false;
            o_state.o_flat_field.s_path_flat = '';
            o_state.o_flat_field.n_scl_x = 0;
            o_state.o_flat_field.n_scl_y = 0;
            o_state.o_flat_field.a_n_mean__channel = [0, 0, 0];
            o_state.o_flat_field.n_ms__created = 0;
            o_state.o_flat_field.o_camera__flat = null;
            f_save_flat_field();
        },

        // ── Load persisted flat at startup ──────────────────────────

        f_load_flat__from_path: async function() {
            let o_self = this;
            let s_path_flat = o_state.o_flat_field.s_path_flat;
            if(!s_path_flat || f_b_flat__loaded()) return;
            try {
                let o_img = new Image();
                o_img.src = '/api/file?path=' + encodeURIComponent(s_path_flat);
                await o_img.decode();
                let el_canvas = document.createElement('canvas');
                el_canvas.width = o_img.width;
                el_canvas.height = o_img.height;
                let o_ctx = el_canvas.getContext('2d');
                o_ctx.drawImage(o_img, 0, 0);
                let o_imagedata = o_ctx.getImageData(0, 0, o_img.width, o_img.height);
                f_flat__set(o_imagedata.data, o_img.width, o_img.height, {
                    s_path_flat: s_path_flat,
                    n_ms__created: o_state.o_flat_field.n_ms__created || 0,
                });
                o_state.o_flat_field.b_loaded = true;
                o_state.o_flat_field.n_scl_x = o_img.width;
                o_state.o_flat_field.n_scl_y = o_img.height;
                o_state.o_flat_field.a_n_mean__channel = f_o_flat().a_n_mean__channel.slice();
            } catch(o_error) {
                console.warn('flat field load failed:', o_error);
                o_state.o_flat_field.b_loaded = false;
            }
        },
    },
    mounted: function() {
        let o_self = this;
        o_self.f_load_config();
        o_self.f_load_flat__from_path();
        o_self._f_on_keydown = function(o_evt){ o_self.f_on_keydown(o_evt); };
        window.addEventListener('keydown', o_self._f_on_keydown);
    },
    beforeUnmount: function() {
        let o_self = this;
        if(o_self._f_on_keydown){
            window.removeEventListener('keydown', o_self._f_on_keydown);
        }
        if(o_self.b_running) o_self.f_stop();
    },
};

export { o_component__flat_field };
