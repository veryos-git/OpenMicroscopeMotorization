import { o_state, f_send_esp_move_step, f_send_esp_stop, f_save_setting__debounced } from './index.js';
import { f_n_score__video, f_o_focus__fast } from './focus_search.module.js';

// a focus sweep is slow anyway, so move gently
let N_RPM__FOCUS = 6.0;
let N_MS__MOVE_TIMEOUT = 30000;
// the sharpness metric is computed on a downscaled frame, this is its width
let N_SCL_X__MEASURE = 480;
// how often the live sharpness meter samples the image
let N_MS__METER = 250;
// steps of the fine pass, spread over one coarse step to each side
let N_ITS__FINE = 9;

let o_component__focus = {
    name: 'component-focus',
    template: `
        <div class="overlay-panel panel-focus" :class="{ visible: o_state.o_panel_visibility.focus }">
            <div class="panel-header">
                <h2>Auto Focus</h2>
                <button class="panel-close" @click="f_close" :disabled="b_running">&times;</button>
            </div>
            <div class="panel-body">

                <div class="focus-meter">
                    <div class="focus-meter-label">
                        <span>sharpness</span>
                        <b>{{ n_score__now.toFixed(1) }}</b>
                    </div>
                    <div class="focus-meter-bar">
                        <div class="focus-meter-fill" :style="{ width: n_pct__meter + '%' }"></div>
                    </div>
                    <div class="focus-meter-hint">
                        best seen {{ n_score__meter_max.toFixed(1) }}
                        <button class="btn-small" @click="n_score__meter_max = 0">reset</button>
                    </div>
                </div>

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

                <div class="focus-status" :class="{ running: b_running }">{{ s_status }}</div>

                <div class="focus-result" v-if="o_result">
                    <div><span>start</span><b>{{ o_result.n_score__start.toFixed(1) }}</b></div>
                    <div><span>best</span><b>{{ o_result.n_score__best.toFixed(1) }}</b></div>
                    <div><span>moved</span><b>{{ o_result.n_step__total }}</b></div>
                </div>

                <button
                    v-if="!b_running"
                    class="btn-scan-start"
                    @click="f_run"
                    :disabled="!b_ready"
                >Find Focus</button>
                <button v-else class="btn-scan-stop" @click="f_stop">Stop</button>

                <div class="focus-note" v-if="!o_state.b_connected__esp">connect the ESP32 first</div>
                <div class="focus-note" v-else-if="!o_state.b_streaming__webcam">start a camera first</div>
                <div class="focus-note" v-else>
                    switch the camera to manual exposure in the Cam panel — an auto
                    exposure that reacts to the defocus distorts the measurement.
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
                        <label>Search step</label>
                        <input type="number" min="1" v-model.number="o_config.n_step__coarse" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Max search steps</label>
                        <input type="number" min="3" max="120" v-model.number="o_config.n_its__coarse" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Settle (ms)</label>
                        <input type="number" min="0" step="50" v-model.number="o_config.n_ms__settle" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Metric</label>
                        <select v-model="o_config.s_metric" @change="f_save_config">
                            <option value="tenengrad">tenengrad</option>
                            <option value="laplacian">laplacian variance</option>
                        </select>
                    </div>
                    <div class="focus-field">
                        <label>Center area (%)</label>
                        <input type="number" min="10" max="100" step="5" v-model.number="o_config.n_pct__roi" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Frames / position</label>
                        <input type="number" min="1" max="8" v-model.number="o_config.n_cnt__sample" @change="f_save_config">
                    </div>
                    <div class="focus-field">
                        <label>Fine pass</label>
                        <input type="checkbox" v-model="o_config.b_fine" @change="f_save_config">
                    </div>
                </div>
                <div class="focus-note">
                    probes both sides of where you are, then walks uphill for up to
                    {{ o_config.n_its__coarse * o_config.n_step__coarse }} steps until the peak is
                    bracketed — a defocused stage is followed back to focus instead of
                    searching a fixed window around the start. tenengrad still reacts far
                    away from focus, which is what the search needs; laplacian variance
                    peaks harder but goes flat once the image is properly blurred, so it
                    only helps if you are already close.
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
            n_score__now: 0,
            n_score__meter_max: 0,
            n_id__meter_interval: 0,
            // {n_step__rel, n_score} of the running sweep
            a_o_sample: [],
            o_result: null,
            o_config: {
                s_motor: '2',
                n_step__coarse: 40,
                n_its__coarse: 11,
                n_ms__settle: 350,
                s_metric: 'tenengrad',
                n_pct__roi: 60,
                n_cnt__sample: 2,
                b_fine: true,
            },
        };
    },
    computed: {
        b_ready: function() {
            return o_state.b_connected__esp && o_state.b_streaming__webcam && !o_state.b_scanning;
        },
        n_pct__meter: function() {
            let o_self = this;
            if(!o_self.n_score__meter_max) return 0;
            return Math.max(0, Math.min(100, (o_self.n_score__now / o_self.n_score__meter_max) * 100));
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
            o_state.o_panel_visibility.focus = false;
            f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility);
        },
        f_save_config: function() {
            f_save_setting__debounced('o_config__focus', this.o_config);
        },
        f_load_config: function() {
            let o_self = this;
            let o_setting = o_state.a_o_setting.find(function(o){
                return o.s_key === 'o_config__focus';
            });
            if(!o_setting || !o_setting.s_value) return;
            try {
                Object.assign(o_self.o_config, JSON.parse(o_setting.s_value));
            } catch(e) { /* ignore parse errors */ }
        },

        // ── Plot helpers ────────────────────────────────────────────

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
            // svg y grows downwards, so a high score has to sit near 0
            return 44 - ((o_sample.n_score - n_min) / (n_max - n_min)) * 42;
        },

        // ── Measuring ───────────────────────────────────────────────

        f_n_score__frame: function() {
            let o_self = this;
            if(!o_self._o_cache__measure) o_self._o_cache__measure = {};
            return f_n_score__video(
                document.getElementById('webcamVideo'),
                {
                    n_scl_x__measure: N_SCL_X__MEASURE,
                    n_pct__roi: o_self.o_config.n_pct__roi,
                    s_metric: o_self.o_config.s_metric,
                },
                o_self._o_cache__measure
            );
        },
        f_n_score__measured: async function() {
            let o_self = this;
            // several frames per position average out sensor noise and a frame
            // that was still being exposed while the stage settled
            let n_cnt = Math.max(1, o_self.o_config.n_cnt__sample);
            let n_sum = 0;
            for(let n_it = 0; n_it < n_cnt; n_it++){
                if(n_it > 0) await o_self.f_delay(60);
                n_sum += o_self.f_n_score__frame();
            }
            return n_sum / n_cnt;
        },
        f_tick_meter: function() {
            let o_self = this;
            if(!o_state.o_panel_visibility.focus) return;
            if(!o_state.b_streaming__webcam) return;
            let n_score = o_self.f_n_score__frame();
            o_self.n_score__now = n_score;
            if(n_score > o_self.n_score__meter_max) o_self.n_score__meter_max = n_score;
        },

        // ── Motion ──────────────────────────────────────────────────

        f_delay: function(n_ms) {
            return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
        },
        f_move: async function(n_step) {
            let o_self = this;
            if(n_step === 0) return;
            let n_motor = parseInt(o_self.o_config.s_motor, 10);
            let o_promise__move = f_send_esp_move_step(n_motor, n_step, N_RPM__FOCUS);
            let o_promise__timeout = new Promise(function(resolve){
                setTimeout(function(){ resolve('timeout'); }, N_MS__MOVE_TIMEOUT);
            });
            let v_result = await Promise.race([o_promise__move, o_promise__timeout]);
            if(v_result === 'timeout'){
                console.warn('focus move timeout on motor', n_motor);
                f_send_esp_stop(n_motor);
            }
        },

        // ── The search ──────────────────────────────────────────────
        //
        // A sweep in one direction, then a finer sweep around the peak.  Every
        // position is approached from the same side, so the gear backlash is
        // the same for every sample and cannot fake a peak.

        // n_step__now / n_step__first are positions relative to where the run
        // started, so every sample lands in one coordinate space
        f_o_sweep: async function(n_step__now, n_step__first, n_step__size, n_its) {
            let o_self = this;
            let a_o_sample = [];
            // to the start of the sweep, arriving in the sweep direction
            await o_self.f_move(n_step__first - n_step__now - n_step__size);
            if(o_self.b_stop_requested) return a_o_sample;
            await o_self.f_move(n_step__size);

            let n_step__rel = n_step__first;
            for(let n_it = 0; n_it < n_its; n_it++){
                if(o_self.b_stop_requested) break;
                if(n_it > 0){
                    await o_self.f_move(n_step__size);
                    n_step__rel += n_step__size;
                }
                await o_self.f_delay(o_self.o_config.n_ms__settle);
                if(o_self.b_stop_requested) break;

                let n_score = await o_self.f_n_score__measured();
                let o_sample = { n_step__rel: n_step__rel, n_score: n_score };
                a_o_sample.push(o_sample);
                o_self.a_o_sample.push(o_sample);
                o_self.s_status = `sampling ${o_self.a_o_sample.length} — ${n_score.toFixed(1)}`;
            }
            return a_o_sample;
        },
        f_n_step__peak: function(a_o_sample) {
            // a parabola through the peak and its two neighbours puts the
            // optimum between two sampled positions
            if(a_o_sample.length < 3) {
                return a_o_sample.length
                    ? a_o_sample.reduce(function(o_b, o){ return o.n_score > o_b.n_score ? o : o_b; }).n_step__rel
                    : 0;
            }
            let n_idx__best = 0;
            for(let n_idx = 1; n_idx < a_o_sample.length; n_idx++){
                if(a_o_sample[n_idx].n_score > a_o_sample[n_idx__best].n_score) n_idx__best = n_idx;
            }
            if(n_idx__best === 0 || n_idx__best === a_o_sample.length - 1){
                return a_o_sample[n_idx__best].n_step__rel;
            }
            let o_0 = a_o_sample[n_idx__best - 1];
            let o_1 = a_o_sample[n_idx__best];
            let o_2 = a_o_sample[n_idx__best + 1];
            let n_denominator = o_0.n_score - 2 * o_1.n_score + o_2.n_score;
            if(Math.abs(n_denominator) < 1e-9) return o_1.n_step__rel;
            let n_offset = 0.5 * (o_0.n_score - o_2.n_score) / n_denominator;
            // never trust the fit further than one sample spacing
            n_offset = Math.max(-1, Math.min(1, n_offset));
            let n_spacing = o_2.n_step__rel - o_1.n_step__rel;
            return o_1.n_step__rel + n_offset * n_spacing;
        },
        f_run: async function() {
            let o_self = this;
            if(o_self.b_running || !o_self.b_ready) return;

            o_self.b_running = true;
            o_self.b_stop_requested = false;
            o_self.a_o_sample = [];
            o_self.o_result = null;
            // the jog handlers and the live stitch stand down while this runs
            o_state.b_scanning = true;

            let n_step__position = 0;    // where we are, relative to the start
            let n_score__start = 0;
            try {
                await o_self.f_delay(o_self.o_config.n_ms__settle);
                n_score__start = await o_self.f_n_score__measured();

                // ---- bracketing search: probe both sides, then walk uphill
                //      until the peak is caught between two lower samples (or
                //      the travel limit).  starting defocused can no longer
                //      steer it away — it follows the sharpening direction. ----
                o_self.s_status = 'searching for the peak';
                let n_step__size = Math.max(1, Math.round(o_self.o_config.n_step__coarse));
                let n_its = Math.max(3, Math.round(o_self.o_config.n_its__coarse));
                let n_step__max = n_step__size * n_its;

                let o_focus = await f_o_focus__fast({
                    f_move: function(n_step){ return o_self.f_move(n_step); },
                    f_delay: function(n_ms){ return o_self.f_delay(n_ms); },
                    f_n_score: async function(){ return o_self.f_n_score__measured(); },
                    f_b_abort: function(){ return o_self.b_stop_requested; },
                }, {
                    n_step: n_step__size,
                    n_step__max: n_step__max,
                    n_ms__settle: o_self.o_config.n_ms__settle,
                });

                // feed the search's samples into the live plot
                o_self.a_o_sample = o_focus.a_o_sample.map(function(o_sample){
                    return { n_step__rel: o_sample.n_step, n_score: o_sample.n_score };
                });
                n_step__position = o_focus.n_step__moved;
                if(o_self.b_stop_requested || !o_focus.a_o_sample.length) throw new Error('stopped');

                let n_step__best = o_focus.n_step__best;

                // ---- fine sweep around the bracketed peak ----
                if(o_self.o_config.b_fine && !o_self.b_stop_requested){
                    o_self.s_status = 'fine sweep';
                    let n_step__size__fine = Math.max(1, Math.round(2 * n_step__size / (N_ITS__FINE - 1)));
                    let n_step__from__fine = Math.round(n_step__best - n_step__size);
                    let a_o_sample__fine = await o_self.f_o_sweep(
                        n_step__position,
                        n_step__from__fine,
                        n_step__size__fine,
                        N_ITS__FINE
                    );
                    if(a_o_sample__fine.length){
                        n_step__position = a_o_sample__fine[a_o_sample__fine.length - 1].n_step__rel;
                        n_step__best = o_self.f_n_step__peak(a_o_sample__fine);
                    }
                }

                // ---- go to the best position, approached from the same side ----
                if(!o_self.b_stop_requested){
                    o_self.s_status = 'moving to the best focus';
                    let n_step__back = Math.round(n_step__best) - n_step__position;
                    let n_step__size__approach = Math.max(1, Math.round(n_step__size / 2));
                    await o_self.f_move(n_step__back - n_step__size__approach);
                    await o_self.f_move(n_step__size__approach);
                    n_step__position = Math.round(n_step__best);
                    await o_self.f_delay(o_self.o_config.n_ms__settle);
                }

                let n_score__best = await o_self.f_n_score__measured();
                o_self.o_result = {
                    n_score__start: n_score__start,
                    n_score__best: n_score__best,
                    n_step__total: n_step__position,
                };
                o_self.s_status = o_self.b_stop_requested
                    ? 'stopped'
                    : (n_score__best >= n_score__start ? 'focused' : 'no better focus found');
            } catch (o_error) {
                o_self.s_status = o_self.b_stop_requested ? 'stopped' : ('failed: ' + o_error.message);
            }

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
        let o_self = this;
        o_self.f_load_config();
        o_self.n_id__meter_interval = setInterval(function(){ o_self.f_tick_meter(); }, N_MS__METER);
    },
    beforeUnmount: function() {
        let o_self = this;
        clearInterval(o_self.n_id__meter_interval);
        if(o_self.b_running) o_self.f_stop();
    },
};

export { o_component__focus };
