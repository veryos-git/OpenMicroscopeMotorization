import { o_state, f_send_esp_move_step, f_send_esp_stop, f_save_setting__debounced, f_save_calibration } from './index.js';
import { f_n_score__video, f_o_focus__fast } from './focus_search.module.js';

// focus step / depth-of-field calibration.
//
// it finds focus (optionally), sweeps the focus motor through a small window
// around it while scoring sharpness, and fits the width of the sharpness peak
// at half height. half that width is the recommended focus-stack step, because
// two neighbouring frames then still overlap in sharpness. the value is stored
// in the calibration profile.

let N_RPM__MOVE = 6.0;
let N_MS__MOVE_TIMEOUT = 30000;
let N_SCL_X__MEASURE = 320;
let N_PCT__ROI = 60;
let S_METRIC = 'tenengrad';

// width (in steps) of the sharpness peak at half of (peak - baseline), found
// by linear interpolation between sweep samples. returns 0 when the peak is
// not bracketed on both sides.
let f_n_step__width__half = function(a_o_sample) {
    if(a_o_sample.length < 3) return 0;
    let n_peak = -Infinity;
    let n_baseline = Infinity;
    for(let n_idx = 0; n_idx < a_o_sample.length; n_idx++){
        let n_score = a_o_sample[n_idx].n_score;
        if(n_score > n_peak) n_peak = n_score;
        if(n_score < n_baseline) n_baseline = n_score;
    }
    if(n_peak <= n_baseline) return 0;

    let n_half = n_baseline + 0.5 * (n_peak - n_baseline);
    let n_idx__peak = 0;
    for(let n_idx = 0; n_idx < a_o_sample.length; n_idx++){
        if(a_o_sample[n_idx].n_score === n_peak){ n_idx__peak = n_idx; break; }
    }

    let f_n_cross = function(o0, o1) {
        if(o1.n_score === o0.n_score) return o0.n_step__rel;
        return o0.n_step__rel
            + (n_half - o0.n_score) * (o1.n_step__rel - o0.n_step__rel) / (o1.n_score - o0.n_score);
    };

    let n_step__left = null;
    for(let n_idx = 1; n_idx <= n_idx__peak; n_idx++){
        let o0 = a_o_sample[n_idx - 1];
        let o1 = a_o_sample[n_idx];
        if(o0.n_score <= n_half && o1.n_score >= n_half){
            n_step__left = f_n_cross(o0, o1);
            break;
        }
    }
    let n_step__right = null;
    for(let n_idx = n_idx__peak + 1; n_idx < a_o_sample.length; n_idx++){
        let o0 = a_o_sample[n_idx - 1];
        let o1 = a_o_sample[n_idx];
        if(o0.n_score >= n_half && o1.n_score <= n_half){
            n_step__right = f_n_cross(o0, o1);
            break;
        }
    }
    if(n_step__left === null || n_step__right === null) return 0;
    return Math.abs(n_step__right - n_step__left);
};

let o_component__focus_step = {
    name: 'component-focus-step',
    template: `
        <div class="overlay-panel panel-focus_step" :class="{ visible: o_state.o_panel_visibility.focus_step }">
            <div class="panel-header">
                <h2>Focus Step</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <div class="focus-note">
                    measures the depth of field by sweeping the focus motor through
                    focus and fitting the sharpness peak. half the peak width is the
                    recommended step for focus stacking.
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
                        <label>Probe step</label>
                        <input type="number" min="1" v-model.number="o_config.n_step__probe" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Samples each side</label>
                        <input type="number" min="2" max="40" v-model.number="o_config.n_its__sweep" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Settle (ms)</label>
                        <input type="number" min="0" step="50" v-model.number="o_config.n_ms__settle" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Autofocus first</label>
                        <input type="checkbox" v-model="o_config.b_autofocus" @change="f_save_config">
                    </div>
                    <div class="focus-field" v-if="o_config.b_autofocus">
                        <label>Autofocus step</label>
                        <input type="number" min="1" v-model.number="o_config.n_step__autofocus" @change="f_save_config">
                    </div>
                </div>

                <button class="btn-scan-start" @click="f_measure" :disabled="!b_ready">Measure</button>

                <div class="focus-note" v-if="!o_state.b_connected__esp">connect the ESP32 first</div>
                <div class="focus-note" v-else-if="!o_state.b_streaming__webcam">start a camera first</div>
                <div class="focus-note" v-else>
                    focus the specimen (or let it autofocus) and make sure there is
                    texture in the center of the view. use manual exposure so the
                    brightness does not drift across the sweep.
                </div>

                <div class="focus-status" :class="{ running: b_running }">{{ s_status }}</div>
                <button v-if="b_running" class="btn-scan-stop" @click="f_stop">Stop</button>

                <div class="focus-plot" v-if="a_o_sample.length">
                    <svg viewBox="0 0 100 46" preserveAspectRatio="none">
                        <polyline :points="s_points__plot"></polyline>
                        <circle
                            v-if="o_sample__best"
                            :cx="f_n_x__plot(o_sample__best)" :cy="f_n_y__plot(o_sample__best)"
                            r="1.6" class="plot-best"
                        ></circle>
                    </svg>
                    <div class="focus-plot-caption">
                        sharpness over focus position &mdash; {{ a_o_sample.length }} samples
                    </div>
                </div>

                <div class="focus-result" v-if="o_result">
                    <div><span>peak width</span><b>{{ o_result.n_step__width.toFixed(1) }}</b></div>
                    <div><span>recommended step</span><b>{{ o_result.n_step__recommended }}</b></div>
                    <div><span>peak score</span><b>{{ o_result.n_score__peak.toFixed(1) }}</b></div>
                </div>

                <div class="focus-note" v-if="s_status === 'done'">
                    stored <b>{{ o_state.o_calibration.n_step__focus }}</b> steps as the
                    focus-stack step. use it in the Stack panel.
                </div>

                <div v-if="s_error" class="focusstack-error">{{ s_error }}</div>

            </div>
        </div>
    `,
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stop_requested: false,
            s_status: 'idle',
            s_error: '',
            a_o_sample: [],
            o_result: null,
            o_config: {
                s_motor: '2',
                n_step__probe: 10,
                n_its__sweep: 8,
                n_ms__settle: 350,
                b_autofocus: true,
                n_step__autofocus: 40,
            },
        };
    },
    computed: {
        b_ready: function() {
            return o_state.b_connected__esp && o_state.b_streaming__webcam && !o_state.b_scanning;
        },
        o_sample__best: function() {
            let o_self = this;
            if(!o_self.a_o_sample.length) return null;
            return o_self.a_o_sample.reduce(function(o_best, o_sample){
                return o_sample.n_score > o_best.n_score ? o_sample : o_best;
            });
        },
        s_points__plot: function() {
            let o_self = this;
            return o_self.a_o_sample.map(function(o_sample){
                return o_self.f_n_x__plot(o_sample) + ',' + o_self.f_n_y__plot(o_sample);
            }).join(' ');
        },
    },
    methods: {
        f_close: function() {
            if(this.b_running) return;
            o_state.o_panel_visibility.focus_step = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__focus_step', this.o_config);
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){
                return o.s_key === 'o_config__focus_step';
            });
            if(!o_setting || !o_setting.s_value) return;
            try {
                Object.assign(o_self.o_config, JSON.parse(o_setting.s_value));
            } catch(e) { /* ignore parse errors */ }
        },

        // ── Plot ─────────────────────────────────────────────────────

        f_n_x__plot: function(o_sample) {
            let o_self = this;
            let a_n_step = o_self.a_o_sample.map(function(o){ return o.n_step__rel; });
            let n_min = Math.min(...a_n_step);
            let n_max = Math.max(...a_n_step);
            if(n_max === n_min) return 50;
            return ((o_sample.n_step__rel - n_min) / (n_max - n_min)) * 100;
        },
        f_n_y__plot: function(o_sample) {
            let o_self = this;
            let a_n_score = o_self.a_o_sample.map(function(o){ return o.n_score; });
            let n_min = Math.min(...a_n_score);
            let n_max = Math.max(...a_n_score);
            if(n_max === n_min) return 23;
            return 44 - ((o_sample.n_score - n_min) / (n_max - n_min)) * 42;
        },

        // ── Motion / timing ──────────────────────────────────────────

        f_delay: function(n_ms) {
            return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
        },
        f_move: async function(n_step) {
            let o_self = this;
            if(n_step === 0) return;
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            let o_promise__move = f_send_esp_move_step(n_motor, n_step, N_RPM__MOVE);
            let o_promise__timeout = new Promise(function(resolve){
                setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT);
            });
            let v_result = await Promise.race([o_promise__move, o_promise__timeout]);
            if(v_result === 'timeout'){
                f_send_esp_stop(n_motor);
            }
        },

        // ── Measuring ────────────────────────────────────────────────

        f_n_score__measured: async function() {
            let o_self = this;
            if(!o_self._o_cache__measure) o_self._o_cache__measure = {};
            let n_sum = 0;
            let n_cnt = 2;
            for(let n_it = 0; n_it < n_cnt; n_it++){
                n_sum += f_n_score__video(
                    document.getElementById('webcamVideo'),
                    {
                        n_scl_x__measure: N_SCL_X__MEASURE,
                        n_pct__roi: N_PCT__ROI,
                        s_metric: S_METRIC,
                    },
                    o_self._o_cache__measure
                );
                if(n_it < n_cnt - 1) await o_self.f_delay(40);
            }
            return n_sum / n_cnt;
        },
        f_o_focus: function() {
            let o_self = this;
            if(!o_self._o_cache__focus) o_self._o_cache__focus = {};
            return f_o_focus__fast({
                f_move: async function(n_step){ await o_self.f_move(n_step); },
                f_delay: function(n_ms){ return o_self.f_delay(n_ms); },
                f_n_score: async function(){
                    return f_n_score__video(
                        document.getElementById('webcamVideo'),
                        {
                            n_scl_x__measure: N_SCL_X__MEASURE,
                            n_pct__roi: N_PCT__ROI,
                            s_metric: S_METRIC,
                        },
                        o_self._o_cache__focus
                    );
                },
                f_b_abort: function(){ return o_self.b_stop_requested; },
            }, {
                n_step: Math.max(1, Math.round(o_self.o_config.n_step__autofocus)),
                n_step__max: Math.max(o_self.o_config.n_step__autofocus, Math.round(o_self.o_config.n_step__autofocus * 10)),
                n_ms__settle: o_self.o_config.n_ms__settle,
            });
        },

        f_measure: async function() {
            let o_self = this;
            if(o_self.b_running || !o_self.b_ready) return;

            o_self.b_running = true;
            o_self.b_stop_requested = false;
            o_self.s_status = 'running';
            o_self.s_error = '';
            o_self.a_o_sample = [];
            o_self.o_result = null;
            o_state.b_scanning = true;

            try {
                if(o_self.o_config.b_autofocus){
                    o_self.s_status = 'autofocusing...';
                    await o_self.f_o_focus();
                    if(o_self.b_stop_requested) throw new Error('stopped');
                }

                let n_step__probe = Math.max(1, Math.round(o_self.o_config.n_step__probe));
                let n_its__sweep = Math.max(2, Math.round(o_self.o_config.n_its__sweep));
                let n_travel = n_its__sweep * n_step__probe;

                // sweep from -travel to +travel, centered on focus
                await o_self.f_move(-n_travel);
                await o_self.f_delay(o_self.o_config.n_ms__settle);
                for(let n_step__rel = -n_travel; n_step__rel <= n_travel; n_step__rel += n_step__probe){
                    if(o_self.b_stop_requested) break;
                    o_self.s_status = `measuring ${n_step__rel} / ±${n_travel}`;
                    let n_score = await o_self.f_n_score__measured();
                    o_self.a_o_sample.push({ n_step__rel, n_score });
                    if(n_step__rel < n_travel){
                        await o_self.f_move(n_step__probe);
                        await o_self.f_delay(o_self.o_config.n_ms__settle);
                    }
                }

                if(o_self.b_stop_requested) throw new Error('stopped');

                let o_best = o_self.o_sample__best;
                let n_step__width = f_n_step__width__half(o_self.a_o_sample);
                if(!n_step__width){
                    o_self.s_error = 'peak not bracketed — increase samples each side or probe step';
                    o_self.s_status = 'idle';
                } else {
                    let n_step__recommended = Math.max(1, Math.round(n_step__width / 2));
                    o_self.o_result = {
                        n_step__width,
                        n_step__recommended,
                        n_score__peak: o_best.n_score,
                    };
                    o_state.o_calibration.n_step__focus = n_step__recommended;
                    o_state.o_calibration.n_ts_ms__focus = Date.now();
                    f_save_calibration();
                    o_self.s_status = 'done';
                }

                // return to the sharpest sample
                if(o_best){
                    let n_delta = o_best.n_step__rel - n_travel;
                    await o_self.f_move(n_delta);
                }
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
            f_send_esp_stop(parseInt(o_self.o_config.s_motor, 10));
        },
    },
    mounted: function() {
        this.f_load_config();
    },
};

export { o_component__focus_step };
