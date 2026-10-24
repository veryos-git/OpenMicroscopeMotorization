import { f_o_camera_geometry, f_el_camera_frame } from './camera_frame.module.js';
import {
    o_state,
    f_n_motor__axis,
    f_send_esp_move_step,
    f_send_esp_stop,
    f_send_esp_set_backlash,
    f_save_setting__debounced,
    f_save_calibration,
} from './index.js';
import { f_o_profile, f_o_shift, f_o_shift__wide, f_o_fit__backlash, f_o_onset, f_o_stat } from './backlash_math.module.js';
import { f_n_score } from './focus_metric.module.js';

let N_RPM__PROBE = 6.0;
let N_MS__MOVE_TIMEOUT = 30000;
// A 100-step move can be lost in drive slack or produce too little focus change.
// This coarse response check is separate from the fine backlash probe steps.
const N_STEP__FOCUS_RESPONSE = 500;
// the profiles are built from a frame downscaled to this width
let N_SCL_X__MEASURE = 400;
// correlation search radius in profile pixels, for telling whether the image
// still moves between two looks
let N_PX__SHIFT_MAX = 60;
// the travel run measures against a key frame with a window this wide (as a
// fraction of the profile), so the jump of a sticking stage is still caught
let N_FRAC__SHIFT_WINDOW = 0.65;
// the key frame moves on once the image has moved this far from it, so the
// overlap stays large; while the stage stands still it is never replaced and
// camera noise does not add up
let N_PX__KEYFRAME = 20;
// A stage on a friction drive sticks and then jumps, so over a short distance
// it never shows a straight ramp.  A travel run goes on until the image has
// moved this far (a good part of the frame) so the jumps average out.
let N_PX__TRAVEL_TARGET = 150;
// a run whose image moved less than this measured nothing usable
let N_PX__TRAVEL_MIN = 60;
// below this correlation the view has too little detail to follow
let N_NCC__TEXTURE = 0.5;
// the image counts as standing still once two looks differ by less than this
let N_PX__STILL = 0.5;
let N_MS__STILL_INTERVAL = 150;
// a drive that keeps creeping is measured after this long anyway
let N_MS__STILL_MAX = 3000;
// the two directions of one drive must give about the same scale
let N_RATIO__DIRECTION_MAX = 1.5;
// same idea for the sharpness signal, in percent of the reference score
let N_PCT__RAMP_TARGET = 25;

let O_STATUS__PROBLEM = {
    no_motion: 'the image did not move — check that the drive grips, then press again',
    texture: 'not enough detail in view — move to an area with visible structure and press again',
    uneven: 'the stage moved unevenly — press again; if this repeats, check the drive',
};

let o_component__backlash = {
    name: 'component-backlash',
    props: { n_motor: { type: Number, default: null }, b_busy: { type: Boolean, default: false } },
    // no UI of its own: Setup runs it from the per-axis calibrate buttons and
    // shows its status there. the old motor-card UI with its advanced settings,
    // results and plot is in archive/setup_motor_tests_and_probe_calibration/
    render: function() { return null; },
    data: function() {
        return {
            o_state: o_state,
            b_running: false,
            b_stop_requested: false,
            s_status: 'idle',
            // samples of the round that is running
            a_o_sample: [],
            o_fit: null,
            o_onset: null,
            // one entry per finished round
            a_o_round: [],
            o_config: {
                s_axis: 'x',
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
            return o_state.b_connected__esp && o_state.b_streaming__webcam && !o_state.b_scanning && !o_state.b_flashing && !this.b_busy && !(o_state.a_o_motor || []).some(o => o.b_running) && this.f_n_motor() !== null;
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
    },
    methods: {
        f_n_motor: function() {
            return Number.isInteger(this.n_motor) && this.n_motor >= 0 && this.n_motor < 3 ? this.n_motor : f_n_motor__axis(this.o_config.s_axis, true);
        },
        f_sync_axis: function() {
            if(!Number.isInteger(this.n_motor)) return;
            let s_axis = Object.keys(o_state.o_motor__axis).find(s => o_state.o_motor__axis[s] === this.n_motor) || 'none';
            if(s_axis !== this.o_config.s_axis) { this.o_config.s_axis = s_axis; this.f_on_axis_change(); }
        },
        f_on_axis_change: function() {
            this.o_config.s_signal = this.o_config.s_axis === 'z' ? 'sharpness' : 'shift';
            // Results belong to the previous axis and must not be applied to this one.
            this.a_o_round = [];
            this.a_o_sample = [];
            this.o_fit = null;
            this.o_onset = null;
            this.s_status = 'idle';
            this.f_save_config();
        },
        f_save_config: function() {
            f_save_setting__debounced(Number.isInteger(this.n_motor) ? 'o_config__backlash_motor_' + this.n_motor : 'o_config__backlash', this.o_config);
        },
        f_load_config: function() {
            let o_self = this;
            let s_key = Number.isInteger(this.n_motor) ? 'o_config__backlash_motor_' + this.n_motor : 'o_config__backlash';
            let o_setting = o_state.a_o_setting.find(o => o.s_key === s_key) || o_state.a_o_setting.find(o => o.s_key === 'o_config__backlash');
            if(!o_setting || !o_setting.s_value) return;
            try {
                const saved = JSON.parse(o_setting.s_value);
                if(!['x', 'y', 'z'].includes(saved.s_axis) && !(Number.isInteger(this.n_motor) && saved.s_axis === 'none')) {
                    saved.s_axis = ['x', 'y', 'z'].find(axis => f_n_motor__axis(axis) === Number(saved.s_motor)) || 'x';
                }
                delete saved.s_motor;
                Object.assign(o_self.o_config, saved);
                if((!Number.isInteger(this.n_motor) || o_setting.s_key === 'o_config__backlash') && o_self.o_config.s_axis === 'z') o_self.o_config.s_signal = 'sharpness';
            } catch(e) { /* ignore parse errors */ }
        },
        f_apply: function() {
            let o_self = this;
            if(!o_self.b_result) return;
            let n_motor = o_self.f_n_motor();
            if(n_motor === null) return;
            o_state.a_n_step__backlash[n_motor] = o_self.n_step__result;
            f_save_setting__debounced('a_n_step__backlash', o_state.a_n_step__backlash);
            f_send_esp_set_backlash(n_motor, o_self.n_step__result);
        },
        // the run measures on a frame downscaled to N_SCL_X__MEASURE px wide:
        // full camera px per measured px, 0 while no camera frame is available
        f_n_scl__measure_to_full: function() {
            let el_video = document.getElementById('webcamVideo');
            let n_scl_x__video = el_video ? f_o_camera_geometry(el_video).n_scl_x : 0;
            return n_scl_x__video ? n_scl_x__video / Math.min(N_SCL_X__MEASURE, n_scl_x__video) : 0;
        },
        // steps per measured px -> steps per full camera px
        f_n_step__per_px__full: function(n_step__per_unit) {
            let n_scl = this.f_n_scl__measure_to_full();
            return n_scl && n_step__per_unit > 0 ? n_step__per_unit / n_scl : 0;
        },
        // persist the measured scale (steps per pixel) for this motor, so the
        // scan auto-grid and click-to-go can use it. returns the saved value,
        // 0 when nothing was saved
        f_save_scale: function() {
            let o_self = this;
            let a_n_per_px = o_self.a_o_summary
                .map(function(o){ return o.n_step__per_unit; })
                .filter(function(n){ return n > 0; });
            if(o_self.o_config.s_signal === 'sharpness' || !a_n_per_px.length) return 0;
            let n_mean = a_n_per_px.reduce(function(n_sum, n){ return n_sum + n; }, 0) / a_n_per_px.length;
            let n_step__per_px__full = o_self.f_n_step__per_px__full(n_mean);
            if(!n_step__per_px__full) return 0;
            let n_motor = o_self.f_n_motor();
            if(n_motor === null) return 0;
            o_state.a_n_step__per_px[n_motor] = n_step__per_px__full;
            f_save_setting__debounced('a_n_step__per_px', o_state.a_n_step__per_px);
            return n_step__per_px__full;
        },

        // ── Measuring ───────────────────────────────────────────────

        f_o_frame: function() {
            let o_self = this;
            let el_video = document.getElementById('webcamVideo');
            if(!el_video || !f_o_camera_geometry(el_video).n_scl_x || el_video.readyState < 2) return null;

            if(!o_self._el_canvas) o_self._el_canvas = document.createElement('canvas');
            let el_canvas = o_self._el_canvas;
            let n_scl_x = Math.min(N_SCL_X__MEASURE, f_o_camera_geometry(el_video).n_scl_x);
            let n_scl_y = Math.max(3, Math.round(n_scl_x * f_o_camera_geometry(el_video).n_scl_y / f_o_camera_geometry(el_video).n_scl_x));
            if(el_canvas.width !== n_scl_x || el_canvas.height !== n_scl_y){
                el_canvas.width = n_scl_x;
                el_canvas.height = n_scl_y;
            }
            let o_ctx = el_canvas.getContext('2d', { willReadFrequently: true });
            o_ctx.drawImage(f_el_camera_frame(el_video), 0, 0, n_scl_x, n_scl_y);

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
                n_time: el_video.currentTime,
                o_profile: f_o_profile(a_n_luma, n_scl_x, n_scl_y),
                n_score: f_n_score(a_n_luma, n_scl_x, n_scl_y, n_mean, 'tenengrad'),
            };
        },

        // the next look once the image stands still: a sticking stage can jump
        // well after the motor stopped, and a fixed settle time would catch it
        // half way. null once a stop was requested
        f_o_frame__still: async function(o_config) {
            let o_self = this;
            await o_self.f_delay(Math.max(0, Number(o_config.n_ms__settle) || 0));
            let o_frame = o_self.f_o_frame();
            if(!o_frame) throw new Error('no camera frame');
            let b_updated = false;
            for(let n_ms = 0; n_ms < N_MS__STILL_MAX; n_ms += N_MS__STILL_INTERVAL){
                if(o_self.b_stop_requested) return null;
                await o_self.f_delay(N_MS__STILL_INTERVAL);
                let o_frame__next = o_self.f_o_frame();
                if(!o_frame__next) throw new Error('no camera frame');
                if(o_frame__next.n_time === o_frame.n_time) continue;
                b_updated = true;
                let o_shift = f_o_shift(o_frame.o_profile, o_frame__next.o_profile, N_PX__SHIFT_MAX);
                o_frame = o_frame__next;
                // without detail in view stillness cannot be judged; the travel
                // run reports that instead of waiting here after every move
                if(o_shift.n_ncc < N_NCC__TEXTURE) return o_frame;
                if(Math.hypot(o_shift.n_px_x, o_shift.n_px_y) < N_PX__STILL) return o_frame;
            }
            if(!b_updated) throw new Error('camera frames are not updating');
            return o_self.b_stop_requested ? null : o_frame;
        },

        // ── Motion ──────────────────────────────────────────────────

        f_delay: function(n_ms) {
            return new Promise(function(resolve){ setTimeout(resolve, n_ms); });
        },
        f_move: async function(n_step) {
            let o_self = this;
            if(n_step === 0 || this.b_stop_requested) return;
            let n_motor = o_self.f_n_motor();
            if(n_motor === null) return;
            if(!o_state.b_connected__esp) throw new Error('controller disconnected');
            let n_timer;
            try {
                await Promise.race([
                    f_send_esp_move_step(n_motor, n_step, N_RPM__PROBE),
                    new Promise((resolve, reject) => {
                        n_timer = setTimeout(() => reject(new Error('motor move timed out')), N_MS__MOVE_TIMEOUT);
                    }),
                ]);
                if(!o_state.b_connected__esp) throw new Error('controller disconnected');
            } catch(o_error) {
                f_send_esp_stop(n_motor);
                throw o_error;
            } finally {
                clearTimeout(n_timer);
            }
        },

        // Compare several stationary frames so camera noise alone is not a response.
        f_a_focus_scores: async function(o_config) {
            let a_score = [];
            let a_time = [];
            for(let n = 0; n < 5; n++) {
                await this.f_delay(Math.max(100, Number(o_config.n_ms__settle) || 0));
                if(this.b_stop_requested) throw new Error('probe stopped');
                if(!o_state.b_streaming__webcam) throw new Error('camera stopped');
                let o_frame = this.f_o_frame();
                if(!o_frame || !Number.isFinite(o_frame.n_score)) throw new Error('no camera frame');
                a_score.push(o_frame.n_score);
                a_time.push(o_frame.n_time);
            }
            if(a_time.every(n => n === a_time[0])) throw new Error('camera frames are not updating');
            return a_score;
        },
        f_probe_focus: async function(o_config) {
            this.s_status = 'checking focus response — ' + N_STEP__FOCUS_RESPONSE + ' coarse steps';
            let a_before = await this.f_a_focus_scores(o_config);
            await this.f_move(N_STEP__FOCUS_RESPONSE);
            if(this.b_stop_requested) return false;
            let a_after = await this.f_a_focus_scores(o_config);
            let f_mean = a => a.reduce((sum, n) => sum + n, 0) / a.length;
            let n_before = f_mean(a_before), n_after = f_mean(a_after);
            let n_noise = Math.max(...a_before) - Math.min(...a_before);
            n_noise = Math.max(n_noise, Math.max(...a_after) - Math.min(...a_after));
            let b_response = Math.abs(n_after - n_before) > Math.max(1e-6, Math.abs(n_before) * 0.05, n_noise * 3);
            // Return the commanded displacement before the normal backlash sequence.
            await this.f_move(-N_STEP__FOCUS_RESPONSE);
            if(this.b_stop_requested) return false;
            o_state.o_focus__probe = {
                n_motor: this.f_n_motor(), s_status: b_response ? 'responsive' : 'no_response',
                n_ts_ms: Date.now(), n_score__before: n_before, n_score__after: n_after,
            };
            f_save_setting__debounced('o_focus__probe', o_state.o_focus__probe);
            if(!b_response) this.s_status = 'No focus response after ' + N_STEP__FOCUS_RESPONSE + ' steps — check the motor and sample, then retry';
            return b_response;
        },

        // ── One probe run ───────────────────────────────────────────
        //
        // n_sign is the direction the probe steps go; the preload runs the other
        // way, so the run starts with the gears pressed against the far flank.

        f_o_round: async function(n_sign, o_config = this.o_config) {
            return o_config.s_signal === 'sharpness'
                ? this.f_o_round__sharpness(n_sign, o_config)
                : this.f_o_round__travel(n_sign, o_config);
        },

        // focus: step until the sharpness has clearly changed
        f_o_round__sharpness: async function(n_sign, o_config) {
            let o_self = this;
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

            while(n_step__total < Math.abs(o_config.n_step__max)){
                if(o_self.b_stop_requested) break;
                await o_self.f_move(n_sign * n_step__probe);
                n_step__total += n_step__probe;
                await o_self.f_delay(o_config.n_ms__settle);
                if(o_self.b_stop_requested) break;

                let o_frame = o_self.f_o_frame();
                if(!o_frame) continue;

                // the change of sharpness, positive either way
                let n_signal = Math.abs(o_frame.n_score - o_frame__ref.n_score);
                o_self.a_o_sample.push({ n_step: n_step__total, n_signal: n_signal });
                o_self.s_status = `probing ${n_step__total} steps — ${n_signal.toFixed(1)}`;
                if(o_frame__ref.n_score > 0
                    && n_signal / o_frame__ref.n_score * 100 > N_PCT__RAMP_TARGET){
                    break;
                }
            }
            if(o_self.b_stop_requested) return null;

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

        // X / Y: keep stepping until the image has travelled a long way.
        //
        // Every look waits until the image stands still, because a sticking
        // stage can jump well after the motor stopped.  The shift is measured
        // against a key frame with a wide window and added up, so the run can
        // travel further than one frame and a jump is caught whole.  Over that
        // distance the jumps average out: the slope of the fit is the scale and
        // its start the backlash, as on a smooth drive.
        f_o_round__travel: async function(n_sign, o_config) {
            let o_self = this;
            o_self.a_o_sample = [];
            o_self.o_fit = null;
            o_self.o_onset = null;

            // ---- preload: take up all slack in the opposite direction ----
            o_self.s_status = 'taking up the slack';
            await o_self.f_move(-n_sign * Math.abs(o_config.n_step__preload));
            if(o_self.b_stop_requested) return null;
            let o_frame__key = await o_self.f_o_frame__still(o_config);
            if(!o_frame__key) return null;

            // ---- travel: step back and follow the image ----
            let n_step__probe = Math.max(1, Math.round(o_config.n_step__probe));
            let n_step__total = 0;
            // image travel up to the key frame, and up to the latest look
            let n_px_x__key = 0, n_px_y__key = 0;
            let n_px_x = 0, n_px_y = 0;
            let a_o_travel = [];
            let a_n_ncc = [];

            while(n_step__total < Math.abs(o_config.n_step__max)){
                if(o_self.b_stop_requested) break;
                await o_self.f_move(n_sign * n_step__probe);
                n_step__total += n_step__probe;
                let o_frame = await o_self.f_o_frame__still(o_config);
                if(!o_frame) break;

                let o_shift = f_o_shift__wide(o_frame__key.o_profile, o_frame.o_profile, N_FRAC__SHIFT_WINDOW);
                n_px_x = n_px_x__key + o_shift.n_px_x;
                n_px_y = n_px_y__key + o_shift.n_px_y;
                a_n_ncc.push(o_shift.n_ncc);
                a_o_travel.push({ n_step: n_step__total, n_px_x: n_px_x, n_px_y: n_px_y });
                if(Math.hypot(o_shift.n_px_x, o_shift.n_px_y) > N_PX__KEYFRAME){
                    o_frame__key = o_frame;
                    n_px_x__key = n_px_x;
                    n_px_y__key = n_px_y;
                }
                let n_px__travel = Math.hypot(n_px_x, n_px_y);
                o_self.a_o_sample.push({ n_step: n_step__total, n_signal: n_px__travel });
                o_self.s_status = `measuring — ${n_step__total} steps, image moved `
                    + `${Math.round(n_px__travel * o_self.f_n_scl__measure_to_full())} px`;
                if(n_px__travel >= N_PX__TRAVEL_TARGET) break;
                // three looks in a row without anything to follow: no detail in view
                if(a_n_ncc.length >= 3 && a_n_ncc.slice(-3).every(function(n){ return n < N_NCC__TEXTURE; })) break;
            }
            if(o_self.b_stop_requested) return null;

            // ---- project the travel onto the axis the stage actually moved ----
            //
            // The camera is never mounted perfectly square, so the motor moves the
            // image along some diagonal.  Using the length of the shift vector
            // would rectify the noise and lift the flat part off zero, which the
            // fit would read as an earlier knee.  Projecting onto the movement
            // direction keeps the noise centred on zero.
            let n_px__travel = Math.hypot(n_px_x, n_px_y);
            if(n_px__travel > 1e-6){
                let n_x__unit = n_px_x / n_px__travel;
                let n_y__unit = n_px_y / n_px__travel;
                o_self.a_o_sample = a_o_travel.map(function(o){
                    return { n_step: o.n_step, n_signal: o.n_px_x * n_x__unit + o.n_px_y * n_y__unit };
                });
            }

            let a_n_ncc__sorted = a_n_ncc.slice().sort(function(n_a, n_b){ return n_a - n_b; });
            let n_ncc = a_n_ncc__sorted.length ? a_n_ncc__sorted[Math.floor(a_n_ncc__sorted.length / 2)] : 0;
            let o_fit = f_o_fit__backlash(o_self.a_o_sample);
            // A slope fitted over a short travel is not a measurement however
            // straight it looks: that is how noise once became a scale.
            let s_problem = '';
            if(n_ncc < N_NCC__TEXTURE) s_problem = 'texture';
            else if(n_px__travel < N_PX__TRAVEL_MIN) s_problem = 'no_motion';
            else if(!o_fit.b_valid) s_problem = 'uneven';
            if(s_problem) o_fit = { ...o_fit, b_valid: false };
            let o_onset = f_o_onset(o_self.a_o_sample, o_fit);
            o_self.o_fit = o_fit;
            o_self.o_onset = o_onset;
            return {
                s_dir: n_sign > 0 ? 'cw' : 'ccw',
                o_fit: o_fit,
                o_onset: o_onset,
                a_o_sample: o_self.a_o_sample.slice(),
                n_px__travel: n_px__travel,
                n_ncc: n_ncc,
                s_problem: s_problem,
            };
        },

        // why a finished travel calibration must not be applied, '' when it may
        f_s_problem__run: function() {
            let o_self = this;
            // px per step of each direction; the drive is the same both ways
            let a_n_scale = ['cw', 'ccw'].map(function(s_dir){
                let a_n = o_self.a_o_round
                    .filter(function(o){ return o.s_dir === s_dir && o.o_fit.b_valid && o.o_fit.n_signal__per_step > 0; })
                    .map(function(o){ return o.o_fit.n_signal__per_step; });
                return a_n.length ? a_n.reduce(function(n_sum, n){ return n_sum + n; }, 0) / a_n.length : 0;
            }).filter(function(n){ return n > 0; });
            if(a_n_scale.length > 1 && Math.max(...a_n_scale) / Math.min(...a_n_scale) > N_RATIO__DIRECTION_MAX) return 'uneven';
            if(o_self.a_o_round.some(function(o){ return o.o_fit.b_valid; })) return '';
            let o_round = o_self.a_o_round.find(function(o){ return o.s_problem; });
            return o_round ? o_round.s_problem : '';
        },

        f_run: async function(o_options = {}) {
            let o_self = this;
            if(o_self.b_running || !o_self.b_ready) return;
            let n_motor = o_self.f_n_motor();
            if(n_motor === null) return;
            // Quick runs use a temporary preset; advanced settings stay intact.
            let o_config = o_options.b_quick === true
                ? { ...o_self.o_config, n_cnt__repeat: 1, b_both_direction: true, n_step__probe: Math.max(10, o_self.o_config.n_step__probe) }
                : { ...o_self.o_config };

            o_self.b_running = true;
            o_self.b_stop_requested = false;
            o_self.a_o_round = [];
            // jog, live stitch and the scan stand down while the stage is probed
            o_state.b_scanning = true;

            // The firmware compensates the slack on every direction change once a
            // backlash is configured — which is exactly what this run has to see.
            // Measuring with it enabled would report almost no slack and then
            // overwrite a good value with zero, so it is switched off first and
            // restored (or replaced by the new value) at the end.
            let n_step__backlash__before = o_state.a_n_step__backlash[n_motor] || 0;
            let b_applied = false;
            if(n_step__backlash__before) f_send_esp_set_backlash(n_motor, 0);

            try {
                let b_focus_ready = (o_config.s_axis !== 'z' && o_config.s_signal !== 'sharpness') || await o_self.f_probe_focus(o_config);
                let a_n_sign = b_focus_ready ? (o_config.b_both_direction ? [1, -1] : [1]) : [];
                let n_cnt__repeat = Math.max(1, Math.round(o_config.n_cnt__repeat));
                for(let n_it__repeat = 0; n_it__repeat < n_cnt__repeat; n_it__repeat++){
                    for(let n_sign of a_n_sign){
                        if(o_self.b_stop_requested) break;
                        let o_round = await o_self.f_o_round(n_sign, o_config);
                        if(!o_round) break;
                        o_self.a_o_round.push(o_round);
                        if(!o_round.o_fit.b_valid){
                            o_self.s_status = o_round.s_problem
                                ? O_STATUS__PROBLEM[o_round.s_problem]
                                : 'that run did not show a clean knee — more texture in view, or a bigger max step count?';
                            await o_self.f_delay(1500);
                        }
                    }
                }
                if(!o_self.b_stop_requested && b_focus_ready){
                    let b_sharpness = o_config.s_signal === 'sharpness';
                    let n_cnt__valid = o_self.a_o_round.filter(function(o){ return o.o_fit.b_valid; }).length;
                    let s_problem = b_sharpness ? '' : o_self.f_s_problem__run();
                    if(n_cnt__valid && !s_problem){
                        // a measurement is only worth anything once it is in
                        // effect, so it goes to the motor without being asked
                        o_self.f_apply();
                        let n_step__per_px = o_self.f_save_scale();
                        o_state.o_calibration.a_n_ts_ms__backlash[n_motor] = Date.now();
                        f_save_calibration();
                        b_applied = true;
                        o_self.s_status = b_sharpness
                            ? `done — ${n_cnt__valid}/${o_self.a_o_round.length} runs usable, applied`
                            : 'done — ' + (n_step__per_px ? Number(n_step__per_px.toPrecision(3)) + ' st/px, ' : '')
                                + `backlash ${o_state.a_n_step__backlash[n_motor]} steps`;
                    } else {
                        o_self.s_status = s_problem ? O_STATUS__PROBLEM[s_problem] : 'no run produced a usable measurement';
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
            return b_applied && !o_self.b_stop_requested;
        },
        f_stop: function() {
            let o_self = this;
            o_self.b_stop_requested = true;
            o_self.s_status = 'stopping';
            f_send_esp_stop(o_self.f_n_motor());
        },
    },
    watch: {
        'o_state.o_motor__axis': { deep: true, handler() { this.f_sync_axis(); } },
        'o_state.n_cnt__stop_all'() { if(this.b_running) this.f_stop(); },
        'o_state.b_connected__esp'(b_connected) { if(!b_connected && this.b_running) this.f_stop(); },
    },
    mounted: function() {
        this.f_load_config();
        this.f_sync_axis();
    },
    beforeUnmount: function() {
        if(this.b_running) this.f_stop();
    },
};

export { o_component__backlash };
