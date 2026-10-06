import { f_n_motor__axis, o_state, f_send_esp_move_step, f_send_esp_stop, f_send_wsmsg_with_response, f_register_handler, f_save_setting__debounced } from './index.js';
import { f_o_wsmsg } from './constructors.module.js';
import { f_n_score__video, f_o_focus__fast } from './focus_search.module.js';
import { f_o_capture__frame, f_save_image } from './o_capture.module.js';
import { f_a_stack_plane } from './focus_stack_plan.module.js';

// a stack moves gently and settles between depths; capture the frame first,
// then advance so every depth is approached from the same side
let N_RPM__STACK = 6.0;
let N_MS__MOVE_TIMEOUT = 30000;
// if nothing arrives from the server for this long the stacking died
let N_MS__STACK_SILENCE = 600000;

let o_component__focus_stack = {
    name: 'component-focus-stack',
    template: `
        <div class="overlay-panel panel-focus_stack" :class="{ visible: o_state.o_panel_visibility.focus_stack }">
            <div class="panel-header">
                <h2>Focus Stack</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <!-- ── Config / run (idle) ─────────────────────── -->
                <template v-if="s_status === 'idle'">
                    <div class="focus-field">
                        <label for="focus-stack-mode">Mode</label>
                        <select id="focus-stack-mode" v-model="o_config.s_mode" @change="f_save_config">
                            <option value="easy">Easy</option><option value="expert">Expert</option>
                        </select>
                    </div>
                    <div class="focus-note" v-if="o_config.s_mode === 'easy'">
                        Adjust focus with the Z controls and save each end of the range.
                        Choose the number of images, then start to combine them into one all-in-focus image.
                    </div>
                    <div class="focus-note" v-else>
                        finds focus first, then sweeps the focus motor around it and
                        saves one frame per depth before blending them into a single
                        all-in-focus image. the stack is centered on the found focus.
                    </div>

                    <div class="focus-config">
                        <template v-if="o_config.s_mode === 'easy'">
                            <div class="focus-field" v-for="n_point in [1,2]" :key="n_point">
                                <button class="btn-small" @click="f_set_focus(n_point)" :disabled="!b_hardware_ready">Set focus position {{ n_point }} here</button>
                                <span>{{ a_n_focus[n_point-1] === null ? 'Not set' : 'Z ' + a_n_focus[n_point-1] + ' steps' }}</span>
                            </div>
                        </template>
                        <div class="focus-field">
                            <label>Focus motor</label>
                            <span>{{ s_motor__focus_label }}</span>
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert'">
                            <label>Step size</label>
                            <input type="number" min="1" v-model.number="o_config.n_step" @change="f_save_config">
                        </div>
                        <div class="focus-field">
                            <label>Images</label>
                            <input type="number" min="2" max="200" v-model.number="o_config.n_its" @change="f_save_config">
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert'">
                            <label>Settle (ms)</label>
                            <input type="number" min="0" step="50" v-model.number="o_config.n_ms__settle" @change="f_save_config">
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert'">
                            <label>Max. output (px, 0 = full)</label>
                            <input type="number" min="0" step="500" v-model.number="o_config.n_dim__max" @change="f_save_config">
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert'">
                            <label>Align frames</label>
                            <input type="checkbox" v-model="o_config.b_align" @change="f_save_config">
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert'">
                            <label>Autofocus first</label>
                            <input type="checkbox" v-model="o_config.b_autofocus" @change="f_save_config">
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert' && o_config.b_autofocus">
                            <label>Focus search step</label>
                            <input type="number" min="1" v-model.number="o_config.n_step__focus" @change="f_save_config">
                        </div>
                        <div class="focus-field" v-if="o_config.s_mode === 'expert' && o_config.b_autofocus">
                            <label>Focus max travel</label>
                            <input type="number" min="10" step="10" v-model.number="o_config.n_step__focus_max" @change="f_save_config">
                        </div>
                    </div>

                    <button
                        class="btn-scan-start"
                        @click="f_run"
                        :disabled="!b_ready"
                    >Start</button>

                    <div class="focus-note" v-if="!o_state.b_connected__esp">connect the ESP32 first</div>
                    <div class="focus-note" v-else-if="!o_state.b_streaming__webcam">start a camera first</div>
                    <div class="focus-note" v-else>
                        <template v-if="s_validation">{{ s_validation }}</template>
                        <template v-else>{{ o_config.n_its }} images over {{ o_config.s_mode === 'easy' ? Math.abs(a_n_focus[1]-a_n_focus[0]) : (o_config.n_its - 1) * o_config.n_step }} steps.</template>
                        switch the camera to manual exposure in the Cam panel so the
                        brightness does not drift across the stack.
                    </div>
                </template>

                <!-- ── Capturing / stacking ─────────────────────── -->
                <template v-if="s_status === 'capturing' || s_status === 'stacking'">
                    <div class="focus-status running">{{ s_status === 'capturing' ? s_status__detail : 'stacking...' }}</div>
                    <div class="focusstack-progress-count">
                        {{ s_status === 'capturing' ? ('captured ' + n_cnt__captured + ' / ' + o_config.n_its) : a_s_line__stack.length + ' log line' }}
                    </div>
                    <div class="scan-elapsed">Elapsed: {{ s_elapsed }}</div>
                    <div class="focusstack-progress-track">
                        <div class="focusstack-progress-fill" :style="{ width: n_pct__progress + '%' }"></div>
                    </div>
                    <button v-if="s_status === 'capturing'" class="btn-scan-stop" @click="f_stop">Stop</button>
                </template>

                <!-- ── Result ───────────────────────────────────── -->
                <template v-if="s_status === 'complete'">
                    <div v-if="s_path__preview__shown" class="focusstack-result">
                        <a :href="'/api/file?path=' + encodeURIComponent(s_path__stacked_image)" target="_blank">
                            <img :src="'/api/file?path=' + encodeURIComponent(s_path__preview__shown)" class="focusstack-preview" />
                        </a>
                        <div class="focus-note">click the image to open the full stack</div>
                    </div>
                    <div v-if="s_error" class="focusstack-error">{{ s_error }}</div>
                    <div class="focusstack-summary">
                        <div class="focus-result">
                            <div><span>captured</span><b>{{ n_cnt__captured }}</b></div>
                            <div><span>stacked</span><b>{{ n_cnt__stacked }}</b></div>
                            <div><span>duration</span><b>{{ s_elapsed }}</b></div>
                        </div>
                    </div>
                    <div class="focus-note scan-summary-path">folder: {{ s_path_folder }}</div>
                    <div v-if="a_s_line__stack.length" class="focusstack-log-wrap">
                        <button class="btn-small" @click="b_visible__log = !b_visible__log">
                            {{ b_visible__log ? 'hide' : 'show' }} stack log
                        </button>
                        <div class="focusstack-log" v-if="b_visible__log">
                            <div v-for="(s_line, n_idx) in a_s_line__stack" :key="n_idx">{{ s_line }}</div>
                        </div>
                    </div>
                    <button class="btn-scan-start" @click="f_reset">New Stack</button>
                </template>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stop_requested: false,
            // 'idle' | 'capturing' | 'stacking' | 'complete'
            s_status: 'idle',
            s_status__detail: '',
            n_cnt__captured: 0,
            n_cnt__stacked: 0,
            n_idx__current: -1,
            s_path_folder: '',
            s_path__stacked_image: '',
            s_path__preview: '',
            s_error: '',
            a_s_line__stack: [],
            b_visible__log: false,
            s_elapsed: '0:00',
            n_id__elapsed_interval: 0,
            n_ts_ms__start: 0,
            n_ts_ms__stack_line: 0,
            f_unregister__stack_progress: null,
            a_n_focus: [null, null],
            o_config: {
                s_mode: 'easy',
                n_step: 40,
                n_its: 20,
                n_ms__settle: 350,
                b_align: true,
                n_dim__max: 0,
                b_autofocus: true,
                n_step__focus: 40,
                n_step__focus_max: 400,
            },
        };
    },
    computed: {
        s_motor__focus_label: function() {
            let n_motor = f_n_motor__axis('z');
            if(n_motor === null && o_state.o_focus__probe?.s_status === 'no_response' && o_state.o_focus__probe.n_motor === o_state.o_motor__axis?.z) return 'No focus response — check the motor and retry calibration in Setup.';
            return n_motor === null ? 'No focus motor — configure Z in Setup → motor cards.' : 'Motor ' + (n_motor + 1) + ' (Z axis, set in Setup)';
        },
        b_ready: function() {
            if (f_n_motor__axis('z') === null || !o_state.b_connected__esp || !o_state.b_streaming__webcam || o_state.b_scanning || o_state.b_training_busy) return false;
            return this.b_hardware_ready && !this.s_validation;
        },
        b_hardware_ready: function() {
            let motor = f_n_motor__axis('z');
            return motor !== null && o_state.b_connected__esp && o_state.b_streaming__webcam &&
                !o_state.b_scanning && !o_state.b_training_busy && !o_state.a_o_motor[motor]?.b_running && !this.b_running;
        },
        s_focus_reference: function() {
            return String(f_n_motor__axis('z')) + ':' + o_state.b_connected__esp;
        },
        s_validation: function() {
            if (this.o_config.s_mode === 'easy') {
                try { f_a_stack_plane(this.a_n_focus[0], this.a_n_focus[1], this.o_config.n_its); }
                catch (error) { return error.message; }
            } else {
                if (!Number.isInteger(this.o_config.n_its) || this.o_config.n_its < 2 || this.o_config.n_its > 200) return 'Choose 2–200 images';
                if (!Number.isSafeInteger(this.o_config.n_step) || this.o_config.n_step < 1) return 'Choose a positive whole-number step size';
                if (!Number.isFinite(this.o_config.n_ms__settle) || this.o_config.n_ms__settle < 0) return 'Choose a nonnegative settle time';
                if (!Number.isSafeInteger(this.o_config.n_dim__max) || this.o_config.n_dim__max < 0) return 'Choose a nonnegative output size';
                if (this.o_config.b_autofocus && (!Number.isSafeInteger(this.o_config.n_step__focus) || this.o_config.n_step__focus < 1 ||
                    !Number.isSafeInteger(this.o_config.n_step__focus_max) || this.o_config.n_step__focus_max < this.o_config.n_step__focus)) return 'Choose valid autofocus step and travel values';
            }
            return '';
        },
        s_path__preview__shown: function() {
            return this.s_path__preview || this.s_path__stacked_image;
        },
        n_pct__progress: function() {
            let o_self = this;
            if(o_self.s_status === 'stacking') return 100;
            if(!o_self.o_config.n_its) return 0;
            return Math.max(0, Math.min(100, (o_self.n_cnt__captured / o_self.o_config.n_its) * 100));
        },
    },
    watch: {
        s_focus_reference: {
            flush: 'sync',
            handler: function() {
                this.a_n_focus = [null, null];
                if (this.s_status === 'capturing') this.f_stop();
            },
        },
        'o_state.n_cnt__stop_all': {
            flush: 'sync',
            handler: function() {
                if (this.s_status === 'capturing') this.f_stop();
            },
        },
    },
    methods: {
        f_set_focus: function(n_point) {
            if (!this.b_hardware_ready) return;
            let n_position = o_state.a_o_motor[f_n_motor__axis('z')]?.n_position;
            if (!Number.isSafeInteger(n_position)) return;
            this.a_n_focus[n_point - 1] = n_position;
        },
        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.focus_stack = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__focus_stack', this.o_config);
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){
                return o.s_key === 'o_config__focus_stack';
            });
            if(!o_setting || !o_setting.s_value) return;
            try {
                Object.assign(o_self.o_config, JSON.parse(o_setting.s_value));
                delete o_self.o_config.s_motor;
                if (!['easy', 'expert'].includes(o_self.o_config.s_mode)) o_self.o_config.s_mode = 'easy';
            } catch(e) { /* ignore parse errors */ }
        },

        // ── Motion / timing ──────────────────────────────────────

        f_delay: function(n_ms) {
            return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
        },
        f_move: async function(n_step) {
            let o_self = this;
            o_self.f_check_motion();
            let n_motor = o_self._n_motor__run ?? f_n_motor__axis('z');
            if (!Number.isSafeInteger(n_step)) throw new Error('Invalid focus movement');
            if(n_step === 0) return;
            let n_target = o_state.a_o_motor[n_motor].n_position + n_step;
            let timer;
            try {
                let result = await Promise.race([
                    f_send_esp_move_step(n_motor, n_step, N_RPM__STACK),
                    new Promise((_, reject) => { timer = setTimeout(() => {
                        f_send_esp_stop(n_motor);
                        reject(new Error('Focus motor movement timed out'));
                    }, N_MS__MOVE_TIMEOUT); }),
                ]);
                o_self.f_check_motion();
                if (!Number.isSafeInteger(result) || result !== n_target) throw new Error('Focus motor stopped before reaching its target');
                o_state.a_o_motor[n_motor].n_position = result;
            } finally {
                clearTimeout(timer);
            }
        },
        f_check_motion: function() {
            if (this.b_stop_requested) throw new Error('stopped');
            if (!o_state.b_connected__esp) throw new Error('Controller disconnected');
            let motor = f_n_motor__axis('z');
            if (motor === null || (this._n_motor__run !== undefined && this._n_motor__run !== motor)) throw new Error('Focus motor assignment changed');
            if (!Number.isSafeInteger(o_state.a_o_motor[motor]?.n_position)) throw new Error('Focus motor position unavailable');
        },

        // ── Autofocus before the stack ───────────────────────────

        f_o_focus: function() {
            let o_self = this;
            let n_motor = f_n_motor__axis('z');
            if(!o_self._o_cache__focus) o_self._o_cache__focus = {};
            return f_o_focus__fast({
                f_move: async function(n_step){
                    await o_self.f_move(n_step);
                },
                f_delay: function(n_ms){ return o_self.f_delay(n_ms); },
                f_n_score: async function(){
                    return f_n_score__video(
                        document.getElementById('webcamVideo'),
                        {
                            n_scl_x__measure: 320,
                            n_pct__roi: 60,
                            s_metric: 'tenengrad',
                        },
                        o_self._o_cache__focus
                    );
                },
                f_b_abort: function(){ return o_self.b_stop_requested; },
            }, {
                n_step: Math.max(1, Math.round(o_self.o_config.n_step__focus)),
                n_step__max: Math.max(
                    o_self.o_config.n_step__focus,
                    Math.round(o_self.o_config.n_step__focus_max)
                ),
                n_ms__settle: o_self.o_config.n_ms__settle,
            });
        },

        // ── Elapsed timer ────────────────────────────────────────

        f_start_elapsed_timer: function() {
            let o_self = this;
            o_self.n_ts_ms__start = Date.now();
            o_self.s_elapsed = '0:00';
            o_self.n_id__elapsed_interval = setInterval(function(){
                let n_sec__total = Math.floor((Date.now() - o_self.n_ts_ms__start) / 1000);
                let n_min = Math.floor(n_sec__total / 60);
                let n_sec = n_sec__total % 60;
                o_self.s_elapsed = n_min + ':' + String(n_sec).padStart(2, '0');
            }, 1000);
        },
        f_stop_elapsed_timer: function() {
            clearInterval(this.n_id__elapsed_interval);
        },

        // ── Run ──────────────────────────────────────────────────

        f_run: async function() {
            let o_self = this;
            if(o_self.b_running || !o_self.b_ready) return;
            const b_easy = o_self.o_config.s_mode === 'easy';
            const o_config = { ...o_self.o_config,
                ...(b_easy ? { n_ms__settle: 350, b_align: true, n_dim__max: 0, b_autofocus: false } : {}) };
            let a_n_plane = b_easy ? f_a_stack_plane(o_self.a_n_focus[0], o_self.a_n_focus[1], o_config.n_its) : null;
            o_self._n_motor__run = f_n_motor__axis('z');

            o_self.b_running = true;
            o_self.b_stop_requested = false;
            o_self.s_status = 'capturing';
            o_self.s_status__detail = 'creating folder...';
            o_self.n_cnt__captured = 0;
            o_self.n_cnt__stacked = 0;
            o_self.n_idx__current = -1;
            o_self.s_path__stacked_image = '';
            o_self.s_path__preview = '';
            o_self.s_error = '';
            o_self.a_s_line__stack = [];
            o_self.f_start_elapsed_timer();
            o_state.b_scanning = true;

            try {
                let o_resp = await f_send_wsmsg_with_response(
                    f_o_wsmsg('focus_stack_create_folder', {})
                );
                if(!o_resp.v_result || !o_resp.v_result.s_path_folder){
                    throw new Error('failed to create focus stack folder');
                }
                o_self.s_path_folder = o_resp.v_result.s_path_folder;

                let n_step = o_config.n_step;
                let n_its = o_config.n_its;

                // find focus first, then center the depth sweep on it so the
                // stack covers both sides of the in-focus plane
                if(o_config.b_autofocus){
                    o_self.s_status__detail = 'autofocusing...';
                    await o_self.f_o_focus();
                    if(o_self.b_stop_requested) throw new Error('stopped');
                    let n_step__center = Math.floor((n_its - 1) / 2) * n_step;
                    if(n_step__center > 0){
                        o_self.s_status__detail = 'centering the stack on focus...';
                        await o_self.f_move(-n_step__center);
                    }
                    if(o_self.b_stop_requested) throw new Error('stopped');
                }
                o_self.f_check_motion();
                if (!a_n_plane) {
                    let start = o_state.a_o_motor[o_self._n_motor__run].n_position;
                    a_n_plane = Array.from({ length: n_its }, (_, i) => start + i * n_step);
                }

                for(let n_it = 0; n_it < n_its; n_it++){
                    if(o_self.b_stop_requested) break;
                    if(!o_state.b_connected__esp){
                        o_self.b_stop_requested = true;
                        break;
                    }

                    o_self.n_idx__current = n_it;
                    o_self.s_status__detail = 'moving to depth ' + (n_it + 1) + ' / ' + n_its;
                    await o_self.f_move(a_n_plane[n_it] - o_state.a_o_motor[o_self._n_motor__run].n_position);
                    o_self.s_status__detail = 'capturing ' + (n_it + 1) + ' / ' + n_its;
                    await o_self.f_delay(o_config.n_ms__settle);
                    o_self.f_check_motion();

                    let s_filename = 'z_' + String(n_it + 1).padStart(4, '0') + '.png';
                    let o_cap = await f_o_capture__frame();
                    o_self.f_check_motion();
                    await f_save_image(o_cap.o_blob, o_self.s_path_folder, s_filename);
                    o_self.n_cnt__captured++;

                }

                o_self.n_idx__current = -1;
                if(o_self.b_stop_requested || o_self.n_cnt__captured < 2){
                    throw new Error(o_self.b_stop_requested ? 'stopped' : 'not enough images captured');
                }

                // ---- run focus_stack.py on the server ----
                o_self.s_status = 'stacking';
                o_self.s_status__detail = '';
                o_self.n_ts_ms__stack_line = Date.now();

                let o_promise__response = f_send_wsmsg_with_response(
                    f_o_wsmsg('focus_stack_run', {
                        s_path_folder: o_self.s_path_folder,
                        n_dim__max: o_config.n_dim__max,
                        b_no_align: !o_config.b_align,
                    })
                );
                let o_promise__watchdog = new Promise(function(resolve){
                    let n_id__interval = setInterval(function(){
                        if(Date.now() - o_self.n_ts_ms__stack_line < N_MS__STACK_SILENCE) return;
                        clearInterval(n_id__interval);
                        resolve({ v_result: {
                            b_success: false,
                            s_error: 'no answer from the server for 10 minutes — the connection died, check the server console',
                        } });
                    }, 5000);
                    o_promise__response.then(function(){ clearInterval(n_id__interval); });
                });

                let o_resp__stack = await Promise.race([o_promise__response, o_promise__watchdog]);
                let o_result = o_resp__stack.v_result;
                if(o_result && o_result.b_success){
                    o_self.s_path__stacked_image = o_result.s_path_output;
                    o_self.s_path__preview = o_result.s_path_preview;
                    o_self.n_cnt__stacked = o_result.n_cnt__image || o_self.n_cnt__captured;
                } else {
                    o_self.s_error = 'stack failed: ' + (o_result ? o_result.s_error : 'unknown error');
                }
                if(o_result && o_result.a_s_line && o_result.a_s_line.length){
                    o_self.a_s_line__stack = o_result.a_s_line;
                }
            } catch(o_error) {
                o_self.s_error = o_self.b_stop_requested ? '' : o_error.message;
            }

            o_self.f_stop_elapsed_timer();
            o_state.b_scanning = false;
            o_self.b_running = false;
            o_self.s_status = 'complete';
            delete o_self._n_motor__run;
        },
        f_stop: function() {
            let o_self = this;
            o_self.b_stop_requested = true;
            f_send_esp_stop(o_self._n_motor__run ?? f_n_motor__axis('z'));
        },
        f_on_stack_progress: function(o_msg) {
            let o_self = this;
            if(o_msg.s_type !== 'focus_stack_progress') return;
            o_self.n_ts_ms__stack_line = Date.now();
            o_self.a_s_line__stack.push(o_msg.v_data.s_line);
            if(o_self.a_s_line__stack.length > 400) o_self.a_s_line__stack.shift();
        },
        f_reset: function() {
            let o_self = this;
            o_self.s_status = 'idle';
            o_self.b_stop_requested = false;
            o_self.n_cnt__captured = 0;
            o_self.n_cnt__stacked = 0;
            o_self.n_idx__current = -1;
            o_self.s_path_folder = '';
            o_self.s_path__stacked_image = '';
            o_self.s_path__preview = '';
            o_self.s_error = '';
            o_self.a_s_line__stack = [];
            o_self.b_visible__log = false;
            o_self.s_elapsed = '0:00';
        },
    },
    mounted: function() {
        let o_self = this;
        o_self.f_load_config();
        o_self.f_unregister__stack_progress = f_register_handler(function(o_msg){
            o_self.f_on_stack_progress(o_msg);
        });
    },
    beforeUnmount: function() {
        let o_self = this;
        if(o_self.b_running) o_self.f_stop();
        o_self.f_stop_elapsed_timer();
        if(o_self.f_unregister__stack_progress) o_self.f_unregister__stack_progress();
    },
};

export { o_component__focus_stack };
