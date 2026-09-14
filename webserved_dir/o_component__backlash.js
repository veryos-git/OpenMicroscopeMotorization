import {
    o_state,
    f_send_esp_move_step,
    f_send_esp_stop,
    f_send_esp_set_backlash,
    f_save_setting__debounced,
} from './index.js';
import { f_o_profile, f_o_shift, f_o_fit__backlash, f_o_onset, f_o_stat } from './backlash_math.module.js';
import { f_n_score } from './focus_metric.module.js';

let N_RPM__PROBE = 6.0;
let N_MS__MOVE_TIMEOUT = 30000;
// the profiles are built from a frame downscaled to this width
let N_SCL_X__MEASURE = 400;
// correlation search radius in profile pixels
let N_PX__SHIFT_MAX = 60;
// a run stops once the image has moved this far: by then the ramp is long
// enough to fit a slope, and going further only wastes time
let N_PX__RAMP_TARGET = 25;
// same idea for the sharpness signal, in percent of the reference score
let N_PCT__RAMP_TARGET = 25;

let o_component__backlash = {
    name: 'component-backlash',
    template: `
        <div class="overlay-panel panel-backlash" :class="{ visible: o_state.o_panel_visibility.backlash }">
            <div class="panel-header">
                <h2>Backlash Calibration</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <div class="backlash-explain">
                    the stage is driven well past the slack in one direction, then
                    stepped back bit by bit. while the gears are still loose the image
                    stands still; the step count where it starts to move is the
                    backlash. both directions are measured, several times, and the
                    result is written to the motor as soon as it is found.
                    <b>onset</b> is where the image first moves, <b>full take-up</b> is
                    where it tracks the steps one to one &mdash; on a drive with any
                    give those are not the same number.
                </div>

                <div class="focus-status" :class="{ running: b_running }">{{ s_status }}</div>

                <div class="backlash-plot" v-if="a_o_sample.length">
                    <svg viewBox="0 0 100 46" preserveAspectRatio="none">
                        <line v-if="o_fit && o_fit.b_valid"
                            :x1="f_n_x__plot(o_fit.n_step__backlash)" y1="0"
                            :x2="f_n_x__plot(o_fit.n_step__backlash)" y2="46"
                            class="plot-knee"
                        ></line>
                        <polyline :points="s_points__plot"></polyline>
                    </svg>
                    <div class="backlash-plot-caption">
                        {{ s_label__signal }} over steps after the reversal
                        <template v-if="o_fit && o_fit.b_valid">
                            &mdash; knee at {{ o_fit.n_step__backlash.toFixed(1) }} steps
                        </template>
                    </div>
                </div>

                <div class="backlash-result" v-if="a_o_round.length">
                    <div class="backlash-result-row header">
                        <span>dir</span><span>onset</span><span>full take-up</span><span>scale</span>
                    </div>
                    <div class="backlash-result-row" v-for="o_dir in a_o_summary" :key="o_dir.s_dir">
                        <span>{{ o_dir.s_dir }}</span>
                        <span :class="{ chosen: o_config.s_apply !== 'knee' }">
                            <b>{{ o_dir.o_stat__onset.n_mean.toFixed(1) }}</b>
                            &plusmn;{{ o_dir.o_stat__onset.n_deviation.toFixed(1) }}
                        </span>
                        <span :class="{ chosen: o_config.s_apply === 'knee' }">
                            <b>{{ o_dir.o_stat.n_mean.toFixed(1) }}</b>
                            &plusmn;{{ o_dir.o_stat.n_deviation.toFixed(1) }}
                        </span>
                        <span>{{ o_dir.n_step__per_unit ? o_dir.n_step__per_unit.toFixed(1) + ' st/px' : '&mdash;' }}</span>
                    </div>
                    <div class="backlash-spread-note" v-if="b_soft__drive">
                        the two differ by more than half, so this drive takes up its
                        play gradually rather than in one go &mdash; compensating the
                        full take-up is what makes the image jump on a reversal.
                    </div>
                </div>

                <div class="backlash-apply" v-if="b_result">
                    <div class="backlash-apply-value">
                        {{ n_step__result }} <span>steps</span>
                    </div>
                    <button class="btn-small" @click="f_apply" :disabled="b_running">
                        re-apply to M{{ o_config.s_motor }}
                    </button>
                </div>
                <div class="backlash-applied" v-if="s_note__applied">&check; {{ s_note__applied }}</div>

                <button
                    v-if="!b_running"
                    class="btn-scan-start"
                    @click="f_run"
                    :disabled="!b_ready"
                >Calibrate</button>
                <button v-else class="btn-scan-stop" @click="f_stop">Stop</button>

                <div class="focus-note" v-if="!o_state.b_connected__esp">connect the ESP32 first</div>
                <div class="focus-note" v-else-if="!o_state.b_streaming__webcam">start a camera first</div>
                <div class="focus-note" v-else>
                    put something with texture in the field of view and use manual
                    exposure — the measurement follows the image content.
                </div>

                <div class="focus-config">
                    <div class="focus-field">
                        <label>Motor</label>
                        <select v-model="o_config.s_motor" @change="f_save_config">
                            <option value="0">M0</option>
                            <option value="1">M1</option>
                            <option value="2">M2</option>
                        </select>
                    </div>
                    <div class="focus-field">
                        <label>Compensate</label>
                        <select v-model="o_config.s_apply" @change="f_save_config">
                            <option value="onset">onset — no jump</option>
                            <option value="knee">full take-up — position</option>
                        </select>
                    </div>
                    <div class="focus-field">
                        <label>Signal</label>
                        <select v-model="o_config.s_signal" @change="f_save_config">
                            <option value="shift">image shift (x / y)</option>
                            <option value="sharpness">sharpness (focus)</option>
                        </select>
                    </div>
                    <div class="focus-field">
                        <label>Probe step</label>
                        <input type="number" min="1" v-model.number="o_config.n_step__probe" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Max steps</label>
                        <input type="number" min="10" step="10" v-model.number="o_config.n_step__max" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Preload steps</label>
                        <input type="number" min="10" step="10" v-model.number="o_config.n_step__preload" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Settle (ms)</label>
                        <input type="number" min="0" step="50" v-model.number="o_config.n_ms__settle" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Repeats</label>
                        <input type="number" min="1" max="10" v-model.number="o_config.n_cnt__repeat" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Both directions</label>
                        <input type="checkbox" v-model="o_config.b_both_direction" @change="f_save_config">
                    </div>
                </div>
                <div class="focus-note">
                    for the focus motor pick the sharpness signal and park the stage
                    clearly off focus first — it only works on one side of the peak,
                    where sharpness still rises and falls with the movement.
                </div>
            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stop_requested: false,
            s_status: 'idle',
            s_note__applied: '',
            // samples of the round that is running
            a_o_sample: [],
            o_fit: null,
            o_onset: null,
            // one entry per finished round
            a_o_round: [],
            o_config: {
                s_motor: '0',
                s_apply: 'onset',
                s_signal: 'shift',
                n_step__probe: 5,
                n_step__max: 300,
                n_step__preload: 120,
                n_ms__settle: 350,
                n_cnt__repeat: 2,
                b_both_direction: true,
            },
        };
    },
    computed: {
        b_ready: function() {
            return o_state.b_connected__esp && o_state.b_streaming__webcam && !o_state.b_scanning;
        },
        s_label__signal: function() {
            return this.o_config.s_signal === 'sharpness' ? 'sharpness change' : 'image shift (px)';
        },
        a_o_summary: function() {
            let o_self = this;
            return ['cw', 'ccw'].map(function(s_dir){
                let a_o_round = o_self.a_o_round.filter(function(o){
                    return o.s_dir === s_dir && o.o_fit.b_valid;
                });
                let a_n_per_unit = a_o_round
                    .map(function(o){ return o.o_fit.n_signal__per_step; })
                    .filter(function(n){ return n > 0; });
                return {
                    s_dir: s_dir,
                    // the knee: the whole take-up, back-extrapolated
                    o_stat: f_o_stat(a_o_round.map(function(o){ return o.o_fit.n_step__backlash; })),
                    // the onset: where the image starts to move at all
                    o_stat__onset: f_o_stat(a_o_round.map(function(o){
                        return o.o_onset && o.o_onset.b_valid
                            ? o.o_onset.n_step__onset
                            : o.o_fit.n_step__backlash;
                    })),
                    n_step__per_unit: a_n_per_unit.length
                        ? 1 / (a_n_per_unit.reduce(function(n_sum, n){ return n_sum + n; }, 0) / a_n_per_unit.length)
                        : 0,
                };
            }).filter(function(o){ return o.o_stat.n_cnt > 0; });
        },
        // a measurement only counts once at least one run produced a clean knee.
        // a result of 0 steps is a real answer (a stage without slack), so this
        // cannot be derived from n_step__result alone
        b_result: function() {
            return this.a_o_summary.length > 0;
        },
        // a drive whose onset sits far below its knee engages softly
        b_soft__drive: function() {
            let a_o_summary = this.a_o_summary;
            if(!a_o_summary.length) return false;
            let n_knee = 0;
            let n_onset = 0;
            for(let o_dir of a_o_summary){
                n_knee += o_dir.o_stat.n_mean;
                n_onset += o_dir.o_stat__onset.n_mean;
            }
            return n_knee > 0 && n_onset < n_knee * 0.66;
        },
        // what gets written into the motor's backlash setting: the onset keeps
        // the stage still during the compensation burst, the knee gives the
        // better long run position but moves the stage while compensating
        n_step__result: function() {
            let o_self = this;
            let a_o_summary = o_self.a_o_summary;
            if(!a_o_summary.length) return 0;
            let s_key = o_self.o_config.s_apply === 'knee' ? 'o_stat' : 'o_stat__onset';
            let n_sum = a_o_summary.reduce(function(n_sum, o){ return n_sum + o[s_key].n_mean; }, 0);
            return Math.round(n_sum / a_o_summary.length);
        },
        s_points__plot: function() {
            let o_self = this;
            return o_self.a_o_sample.map(function(o_sample){
                return o_self.f_n_x__plot(o_sample.n_step) + ',' + o_self.f_n_y__plot(o_sample.n_signal);
            }).join(' ');
        },
    },
    methods: {
        f_close: function() {
            o_state.o_panel_visibility.backlash = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__backlash', this.o_config);
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){
                return o.s_key === 'o_config__backlash';
            });
            if(!o_setting || !o_setting.s_value) return;
            try {
                Object.assign(o_self.o_config, JSON.parse(o_setting.s_value));
            } catch(e) { /* ignore parse errors */ }
        },
        f_apply: function() {
            let o_self = this;
            if(!o_self.b_result) return;
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            let n_step__before = o_state.a_n_step__backlash[n_motor];
            o_state.a_n_step__backlash[n_motor] = o_self.n_step__result;
            f_save_setting__debounced('a_n_step__backlash', o_state.a_n_step__backlash);
            f_send_esp_set_backlash(n_motor, o_self.n_step__result);
            o_self.s_note__applied = `M${n_motor} backlash set to ${o_self.n_step__result} steps`
                + (n_step__before !== o_self.n_step__result ? ` (was ${n_step__before})` : '');
        },
        // persist the measured scale (steps per pixel) for this motor, so the
        // scan auto-grid and click-to-go can use it. the run measures on a frame
        // downscaled to N_SCL_X__MEASURE px wide, so convert to full camera px.
        f_save_scale: function() {
            let o_self = this;
            let a_n_per_px = o_self.a_o_summary
                .map(function(o){ return o.n_step__per_unit; })
                .filter(function(n){ return n > 0; });
            if(!a_n_per_px.length) return;
            let n_mean = a_n_per_px.reduce(function(n_sum, n){ return n_sum + n; }, 0) / a_n_per_px.length;
            let el_video = document.getElementById('webcamVideo');
            let n_scl_x__video = el_video ? el_video.videoWidth : 0;
            if(!n_scl_x__video) return;
            let n_step__per_px__full = n_mean * (Math.min(N_SCL_X__MEASURE, n_scl_x__video) / n_scl_x__video);
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            o_state.a_n_step__per_px[n_motor] = n_step__per_px__full;
            f_save_setting__debounced('a_n_step__per_px', o_state.a_n_step__per_px);
        },

        // ── Plot ────────────────────────────────────────────────────

        f_n_x__plot: function(n_step) {
            let o_self = this;
            let n_max = 0;
            for(let o_sample of o_self.a_o_sample){
                if(o_sample.n_step > n_max) n_max = o_sample.n_step;
            }
            if(!n_max) return 0;
            return (n_step / n_max) * 100;
        },
        f_n_y__plot: function(n_signal) {
            let o_self = this;
            let a_n = o_self.a_o_sample.map(function(o){ return o.n_signal; });
            let n_min = Math.min(0, ...a_n);
            let n_max = Math.max(...a_n);
            if(n_max === n_min) return 44;
            return 44 - ((n_signal - n_min) / (n_max - n_min)) * 42;
        },

        // ── Measuring ───────────────────────────────────────────────

        f_o_frame: function() {
            let o_self = this;
            let el_video = document.getElementById('webcamVideo');
            if(!el_video || !el_video.videoWidth || el_video.readyState < 2) return null;

            if(!o_self._el_canvas) o_self._el_canvas = document.createElement('canvas');
            let el_canvas = o_self._el_canvas;
            let n_scl_x = Math.min(N_SCL_X__MEASURE, el_video.videoWidth);
            let n_scl_y = Math.max(3, Math.round(n_scl_x * el_video.videoHeight / el_video.videoWidth));
            if(el_canvas.width !== n_scl_x || el_canvas.height !== n_scl_y){
                el_canvas.width = n_scl_x;
                el_canvas.height = n_scl_y;
            }
            let o_ctx = el_canvas.getContext('2d', { willReadFrequently: true });
            o_ctx.drawImage(el_video, 0, 0, n_scl_x, n_scl_y);

            let a_n_byte = o_ctx.getImageData(0, 0, n_scl_x, n_scl_y).data;
            let a_n_luma = new Float64Array(n_scl_x * n_scl_y);
            let n_sum = 0;
            for(let n_idx = 0; n_idx < a_n_luma.length; n_idx++){
                let n_byte = n_idx * 4;
                let n_luma = 0.2126 * a_n_byte[n_byte]
                    + 0.7152 * a_n_byte[n_byte + 1]
                    + 0.0722 * a_n_byte[n_byte + 2];
                a_n_luma[n_idx] = n_luma;
                n_sum += n_luma;
            }
            let n_mean = n_sum / a_n_luma.length;
            return {
                o_profile: f_o_profile(a_n_luma, n_scl_x, n_scl_y),
                n_score: f_n_score(a_n_luma, n_scl_x, n_scl_y, n_mean, 'tenengrad'),
            };
        },

        // ── Motion ──────────────────────────────────────────────────

        f_delay: function(n_ms) {
            return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
        },
        f_move: async function(n_step) {
            let o_self = this;
            if(n_step === 0) return;
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            let o_promise__move = f_send_esp_move_step(n_motor, n_step, N_RPM__PROBE);
            let o_promise__timeout = new Promise(function(resolve){
                setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT);
            });
            let v_result = await Promise.race([o_promise__move, o_promise__timeout]);
            if(v_result === 'timeout'){
                console.warn('backlash move timeout on motor', n_motor);
                f_send_esp_stop(n_motor);
            }
        },

        // ── One probe run ───────────────────────────────────────────
        //
        // n_sign is the direction the probe steps go; the preload runs the other
        // way, so the run starts with the gears pressed against the far flank.

        f_o_round: async function(n_sign) {
            let o_self = this;
            let o_config = o_self.o_config;
            o_self.a_o_sample = [];
            o_self.o_fit = null;

            // ---- preload: take up all slack in the opposite direction ----
            o_self.s_status = 'taking up the slack';
            await o_self.f_move(-n_sign * Math.abs(o_config.n_step__preload));
            if(o_self.b_stop_requested) return null;
            await o_self.f_delay(o_config.n_ms__settle + 200);

            let o_frame__ref = o_self.f_o_frame();
            if(!o_frame__ref) throw new Error('no camera frame');

            // ---- probe: step back and watch the image ----
            let n_step__probe = Math.max(1, Math.round(o_config.n_step__probe));
            let n_step__total = 0;
            let a_o_shift = [];

            while(n_step__total < Math.abs(o_config.n_step__max)){
                if(o_self.b_stop_requested) break;
                await o_self.f_move(n_sign * n_step__probe);
                n_step__total += n_step__probe;
                await o_self.f_delay(o_config.n_ms__settle);
                if(o_self.b_stop_requested) break;

                let o_frame = o_self.f_o_frame();
                if(!o_frame) continue;

                if(o_config.s_signal === 'sharpness'){
                    // the change of sharpness, positive either way
                    let n_signal = Math.abs(o_frame.n_score - o_frame__ref.n_score);
                    o_self.a_o_sample.push({ n_step: n_step__total, n_signal: n_signal });
                    o_self.s_status = `probing ${n_step__total} steps — ${n_signal.toFixed(1)}`;
                    if(o_frame__ref.n_score > 0
                        && n_signal / o_frame__ref.n_score * 100 > N_PCT__RAMP_TARGET){
                        break;
                    }
                } else {
                    let o_shift = f_o_shift(o_frame__ref.o_profile, o_frame.o_profile, N_PX__SHIFT_MAX);
                    a_o_shift.push({ n_step: n_step__total, o_shift: o_shift });
                    o_self.a_o_sample.push({
                        n_step: n_step__total,
                        n_signal: Math.hypot(o_shift.n_px_x, o_shift.n_px_y),
                    });
                    o_self.s_status = `probing ${n_step__total} steps — `
                        + `${o_shift.n_px_x.toFixed(1)} / ${o_shift.n_px_y.toFixed(1)} px`;
                    if(Math.hypot(o_shift.n_px_x, o_shift.n_px_y) > N_PX__RAMP_TARGET) break;
                }
            }
            if(o_self.b_stop_requested) return null;

            // ---- project the shifts onto the axis the stage actually moved ----
            //
            // The camera is never mounted perfectly square, so the motor moves the
            // image along some diagonal.  Using the length of the shift vector
            // would rectify the noise and lift the flat part off zero, which the
            // fit would read as an earlier knee.  Projecting onto the movement
            // direction keeps the noise centred on zero.
            if(o_config.s_signal !== 'sharpness'){
                let o_shift__last = a_o_shift.length ? a_o_shift[a_o_shift.length - 1].o_shift : null;
                let n_len = o_shift__last ? Math.hypot(o_shift__last.n_px_x, o_shift__last.n_px_y) : 0;
                if(n_len > 1e-6){
                    let n_x__unit = o_shift__last.n_px_x / n_len;
                    let n_y__unit = o_shift__last.n_px_y / n_len;
                    o_self.a_o_sample = a_o_shift.map(function(o){
                        return {
                            n_step: o.n_step,
                            n_signal: o.o_shift.n_px_x * n_x__unit + o.o_shift.n_px_y * n_y__unit,
                        };
                    });
                }
            }

            let o_fit = f_o_fit__backlash(o_self.a_o_sample);
            let o_onset = f_o_onset(o_self.a_o_sample, o_fit);
            o_self.o_fit = o_fit;
            o_self.o_onset = o_onset;
            return {
                s_dir: n_sign > 0 ? 'cw' : 'ccw',
                o_fit: o_fit,
                o_onset: o_onset,
                a_o_sample: o_self.a_o_sample.slice(),
            };
        },

        f_run: async function() {
            let o_self = this;
            if(o_self.b_running || !o_self.b_ready) return;

            o_self.b_running = true;
            o_self.b_stop_requested = false;
            o_self.a_o_round = [];
            o_self.s_note__applied = '';
            // jog, live stitch and the scan stand down while the stage is probed
            o_state.b_scanning = true;

            // The firmware compensates the slack on every direction change once a
            // backlash is configured — which is exactly what this run has to see.
            // Measuring with it enabled would report almost no slack and then
            // overwrite a good value with zero, so it is switched off first and
            // restored (or replaced by the new value) at the end.
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            let n_step__backlash__before = o_state.a_n_step__backlash[n_motor] || 0;
            let b_applied = false;
            if(n_step__backlash__before) f_send_esp_set_backlash(n_motor, 0);

            try {
                let a_n_sign = o_self.o_config.b_both_direction ? [1, -1] : [1];
                let n_cnt__repeat = Math.max(1, Math.round(o_self.o_config.n_cnt__repeat));
                for(let n_it__repeat = 0; n_it__repeat < n_cnt__repeat; n_it__repeat++){
                    for(let n_sign of a_n_sign){
                        if(o_self.b_stop_requested) break;
                        let o_round = await o_self.f_o_round(n_sign);
                        if(!o_round) break;
                        o_self.a_o_round.push(o_round);
                        if(!o_round.o_fit.b_valid){
                            o_self.s_status = 'that run did not show a clean knee — '
                                + 'more texture in view, or a bigger max step count?';
                            await o_self.f_delay(1500);
                        }
                    }
                }
                if(!o_self.b_stop_requested){
                    let n_cnt__valid = o_self.a_o_round.filter(function(o){ return o.o_fit.b_valid; }).length;
                    if(n_cnt__valid){
                        // a measurement is only worth anything once it is in
                        // effect, so it goes to the motor without being asked
                        o_self.f_apply();
                        o_self.f_save_scale();
                        b_applied = true;
                        o_self.s_status = `done — ${n_cnt__valid}/${o_self.a_o_round.length} runs usable, applied`;
                    } else {
                        o_self.s_status = 'no run produced a usable measurement';
                    }
                }
            } catch (o_error) {
                o_self.s_status = 'failed: ' + o_error.message;
            }

            // nothing measured -> the motor keeps the value it had
            if(!b_applied && n_step__backlash__before){
                f_send_esp_set_backlash(n_motor, n_step__backlash__before);
            }
            if(o_self.b_stop_requested) o_self.s_status = 'stopped';
            o_state.b_scanning = false;
            o_self.b_running = false;
        },
        f_stop: function() {
            let o_self = this;
            o_self.b_stop_requested = true;
            o_self.s_status = 'stopping';
            f_send_esp_stop(parseInt(o_self.o_config.s_motor, 10));
        },
    },
    mounted: function() {
        this.f_load_config();
    },
    beforeUnmount: function() {
        if(this.b_running) this.f_stop();
    },
};

export { o_component__backlash };
