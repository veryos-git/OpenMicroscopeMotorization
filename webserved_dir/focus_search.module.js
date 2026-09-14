// measuring focus on the live image, and a search that is quick enough to run
// before every tile of a scan
//
// The sweep in the focus panel samples ~20 positions to map the whole curve,
// which is right when the focus is unknown but far too slow per tile.  Between
// two neighbouring tiles the focus barely changes, so the search here starts
// from where it already is, walks uphill only as far as it must, and finishes
// with a parabola through the best three samples:
//
//     bracket the peak (2-4 measurements) -> parabola -> jump -> verify
//
// which is 4-6 measurements instead of 20, and the walk usually stops after the
// first probe because the previous tile left it near the optimum.

import { f_n_score } from './focus_metric.module.js';

// sharpness of the current video frame, measured on the center of the image
// o_option: { n_scl_x__measure, n_pct__roi, s_metric }
let f_n_score__video = function(el_video, o_option, o_cache) {
    if(!el_video || !el_video.videoWidth || el_video.readyState < 2) return 0;

    let o_state__cache = o_cache || {};
    if(!o_state__cache.el_canvas) o_state__cache.el_canvas = document.createElement('canvas');
    let el_canvas = o_state__cache.el_canvas;

    let n_nor__roi = Math.max(0.1, Math.min(1, (o_option.n_pct__roi || 60) / 100));
    let n_scl_x__src = el_video.videoWidth * n_nor__roi;
    let n_scl_y__src = el_video.videoHeight * n_nor__roi;
    let n_px_x__src = (el_video.videoWidth - n_scl_x__src) / 2;
    let n_px_y__src = (el_video.videoHeight - n_scl_y__src) / 2;

    let n_scl_x = Math.min(o_option.n_scl_x__measure || 480, Math.round(n_scl_x__src));
    let n_scl_y = Math.max(3, Math.round(n_scl_x * (n_scl_y__src / n_scl_x__src)));
    if(el_canvas.width !== n_scl_x || el_canvas.height !== n_scl_y){
        el_canvas.width = n_scl_x;
        el_canvas.height = n_scl_y;
    }
    let o_ctx = el_canvas.getContext('2d', { willReadFrequently: true });
    o_ctx.drawImage(
        el_video,
        n_px_x__src, n_px_y__src, n_scl_x__src, n_scl_y__src,
        0, 0, n_scl_x, n_scl_y
    );

    let a_n_byte = o_ctx.getImageData(0, 0, n_scl_x, n_scl_y).data;
    let a_n_luma = new Float32Array(n_scl_x * n_scl_y);
    let n_sum = 0;
    for(let n_idx = 0; n_idx < a_n_luma.length; n_idx++){
        let n_byte = n_idx * 4;
        let n_luma = 0.2126 * a_n_byte[n_byte]
            + 0.7152 * a_n_byte[n_byte + 1]
            + 0.0722 * a_n_byte[n_byte + 2];
        a_n_luma[n_idx] = n_luma;
        n_sum += n_luma;
    }
    return f_n_score(a_n_luma, n_scl_x, n_scl_y, n_sum / a_n_luma.length, o_option.s_metric);
};

// the offset of the peak of the parabola through three samples, relative to the
// middle one, in units of the sample spacing.  Clamped to one spacing: beyond
// that the three points say nothing and the fit is only extrapolating.
let f_n_offset__parabola = function(n_score__left, n_score__mid, n_score__right) {
    let n_denominator = n_score__left - 2 * n_score__mid + n_score__right;
    if(Math.abs(n_denominator) < 1e-12) return 0;
    let n_offset = 0.5 * (n_score__left - n_score__right) / n_denominator;
    if(!(n_offset > -1 && n_offset < 1)) return 0;
    return n_offset;
};

// o_api: { f_move(n_step) -> Promise, f_delay(n_ms) -> Promise,
//          f_n_score() -> Promise<number>, f_b_abort() -> bool }
// o_option: { n_step, n_step__max, n_ms__settle }
//
// A robust uphill walk: it probes both sides of the start to pick the uphill
// direction (so one noisy probe cannot send it away from the peak), then keeps
// stepping that way until the score stops improving — the peak is bracketed —
// or the travel limit is reached.  There is no fixed step count: the search
// covers as far as n_step__max, so a badly defocused stage is still found.
//
// Returns { n_step__moved, n_score__start, n_score__best, n_cnt__measure,
//           a_o_sample, n_step__best }.
// n_step__moved / n_step__best are relative to where the motor started.
let f_o_focus__fast = async function(o_api, o_option) {
    let n_step = Math.max(1, Math.round(o_option.n_step || 20));
    let n_step__max = Math.max(n_step, Math.round(o_option.n_step__max || n_step * 6));
    let n_ms__settle = o_option.n_ms__settle || 0;

    let n_step__at = 0;             // where the motor is, relative to the start
    let n_cnt__measure = 0;
    let a_o_sample = [];            // { n_step, n_score }, in visiting order
    let n_score__start = 0;

    let f_move_to = async function(n_step__target) {
        if(n_step__target === n_step__at) return;
        await o_api.f_move(n_step__target - n_step__at);
        n_step__at = n_step__target;
        if(n_ms__settle) await o_api.f_delay(n_ms__settle);
    };
    let f_o_measure_at = async function(n_step__target) {
        let o_known = a_o_sample.find(function(o){ return o.n_step === n_step__target; });
        // a position that was already measured keeps its score, but the motor
        // still has to travel there -- this is also how the search returns to
        // the best sample after a prediction turned out worse
        await f_move_to(n_step__target);
        if(o_known) return o_known;
        let n_score = await o_api.f_n_score();
        n_cnt__measure++;
        let o_sample = { n_step: n_step__target, n_score: n_score };
        a_o_sample.push(o_sample);
        return o_sample;
    };
    let f_o_best = function() {
        return a_o_sample.reduce(function(o_best, o){
            return o.n_score > o_best.n_score ? o : o_best;
        });
    };
    let f_b_abort = function() {
        return !!(o_api.f_b_abort && o_api.f_b_abort());
    };
    let f_o_aborted = function() {
        let o_best = f_o_best();
        return {
            n_step__moved: n_step__at,
            n_score__start: n_score__start,
            n_score__best: o_best.n_score,
            n_cnt__measure: n_cnt__measure,
            a_o_sample: a_o_sample,
            n_step__best: o_best.n_step,
        };
    };

    // ---- where we are now ----
    let o_here = await f_o_measure_at(0);
    n_score__start = o_here.n_score;
    if(f_b_abort()) return f_o_aborted();

    // ---- which way is uphill: probe BOTH sides, then trust the stronger ----
    let o_plus = await f_o_measure_at(n_step);
    if(f_b_abort()) return f_o_aborted();
    let o_minus = await f_o_measure_at(-n_step);
    if(f_b_abort()) return f_o_aborted();

    let n_direction = 0;
    if(o_plus.n_score > o_here.n_score && o_plus.n_score >= o_minus.n_score){
        n_direction = 1;
    } else if(o_minus.n_score > o_here.n_score){
        n_direction = -1;
    }

    // ---- walk uphill until it stops improving ----
    if(n_direction !== 0){
        let o_last = n_direction > 0 ? o_plus : o_minus;
        while(true){
            if(f_b_abort()) return f_o_aborted();
            let n_step__next = o_last.n_step + n_direction * n_step;
            if(Math.abs(n_step__next) > n_step__max) break;
            let o_next = await f_o_measure_at(n_step__next);
            if(o_next.n_score <= o_last.n_score) break;   // walked over the top
            o_last = o_next;
        }
    }

    // ---- parabola through the best sample and its two neighbours ----
    let o_best = f_o_best();
    let n_step__final = o_best.n_step;
    let o_left = a_o_sample.find(function(o){ return o.n_step === o_best.n_step - n_step; });
    let o_right = a_o_sample.find(function(o){ return o.n_step === o_best.n_step + n_step; });
    if(o_left && o_right && !f_b_abort()){
        let n_offset = f_n_offset__parabola(o_left.n_score, o_best.n_score, o_right.n_score);
        let n_step__peak = Math.round(o_best.n_step + n_offset * n_step);
        if(n_step__peak !== o_best.n_step){
            let o_peak = await f_o_measure_at(n_step__peak);
            // the prediction is only kept if the image really is sharper there
            if(o_peak.n_score >= o_best.n_score) n_step__final = n_step__peak;
        }
    }
    // the search ends where the decision points, not where the last probe left
    // the motor -- with the peak already bracketed that is a step or two back
    if(!f_b_abort()) await f_move_to(n_step__final);

    return {
        n_step__moved: n_step__at,
        n_score__start: n_score__start,
        n_score__best: f_o_best().n_score,
        n_cnt__measure: n_cnt__measure,
        a_o_sample: a_o_sample,
        n_step__best: n_step__final,
    };
};

export { f_n_score__video, f_o_focus__fast, f_n_offset__parabola };
