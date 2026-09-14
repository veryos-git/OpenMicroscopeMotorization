// measuring how far an image moved, and turning a probe run into a backlash value
//
// The stage is only translated between two frames, never rotated or scaled, so
// the shift can be read from 1-D projections of the image instead of a full 2-D
// correlation: summing every column gives a profile that moves with the image
// along x, summing every row gives one for y.  That is O(w*h + w*shift) instead
// of O(w*h*shift*shift) and needs no FFT.

// column sums (a_n_x) and row sums (a_n_y) of a luminance plane
let f_o_profile = function(a_n_luma, n_scl_x, n_scl_y) {
    let a_n_x = new Float64Array(n_scl_x);
    let a_n_y = new Float64Array(n_scl_y);
    for(let n_y = 0; n_y < n_scl_y; n_y++){
        let n_row = n_y * n_scl_x;
        let n_sum__row = 0;
        for(let n_x = 0; n_x < n_scl_x; n_x++){
            let n_luma = a_n_luma[n_row + n_x];
            a_n_x[n_x] += n_luma;
            n_sum__row += n_luma;
        }
        a_n_y[n_y] = n_sum__row;
    }
    return {
        a_n_x: f_a_n__highpass(a_n_x, 31),
        a_n_y: f_a_n__highpass(a_n_y, 31),
    };
};

// subtract a moving average: kills the illumination gradient and the DC term,
// so only the structure that actually moves with the stage is correlated
let f_a_n__highpass = function(a_n, n_window) {
    let n_cnt = a_n.length;
    let a_n__out = new Float64Array(n_cnt);
    let n_half = Math.max(1, Math.floor(n_window / 2));
    for(let n_idx = 0; n_idx < n_cnt; n_idx++){
        let n_from = Math.max(0, n_idx - n_half);
        let n_to = Math.min(n_cnt - 1, n_idx + n_half);
        let n_sum = 0;
        for(let n_k = n_from; n_k <= n_to; n_k++) n_sum += a_n[n_k];
        a_n__out[n_idx] = a_n[n_idx] - n_sum / (n_to - n_from + 1);
    }
    return a_n__out;
};

// normalised cross correlation of two profiles over the overlapping part
let f_n_ncc = function(a_n__ref, a_n__new, n_shift) {
    let n_cnt = a_n__ref.length;
    let n_from = Math.max(0, -n_shift);
    let n_to = Math.min(n_cnt, n_cnt - n_shift);
    let n_len = n_to - n_from;
    if(n_len < 8) return -1;

    let n_sum__a = 0, n_sum__b = 0;
    for(let n_idx = n_from; n_idx < n_to; n_idx++){
        n_sum__a += a_n__ref[n_idx];
        n_sum__b += a_n__new[n_idx + n_shift];
    }
    let n_mean__a = n_sum__a / n_len;
    let n_mean__b = n_sum__b / n_len;

    let n_cov = 0, n_var__a = 0, n_var__b = 0;
    for(let n_idx = n_from; n_idx < n_to; n_idx++){
        let n_a = a_n__ref[n_idx] - n_mean__a;
        let n_b = a_n__new[n_idx + n_shift] - n_mean__b;
        n_cov += n_a * n_b;
        n_var__a += n_a * n_a;
        n_var__b += n_b * n_b;
    }
    let n_denominator = Math.sqrt(n_var__a * n_var__b);
    if(n_denominator < 1e-12) return -1;
    return n_cov / n_denominator;
};

// how far a_n__new is shifted against a_n__ref, with sub-pixel refinement
let f_o_shift__profile = function(a_n__ref, a_n__new, n_shift__max) {
    let n_shift__best = 0;
    let n_ncc__best = -2;
    for(let n_shift = -n_shift__max; n_shift <= n_shift__max; n_shift++){
        let n_ncc = f_n_ncc(a_n__ref, a_n__new, n_shift);
        if(n_ncc > n_ncc__best){
            n_ncc__best = n_ncc;
            n_shift__best = n_shift;
        }
    }
    // a parabola through the peak and its neighbours resolves below one pixel
    let n_offset = 0;
    if(Math.abs(n_shift__best) < n_shift__max){
        let n_left = f_n_ncc(a_n__ref, a_n__new, n_shift__best - 1);
        let n_right = f_n_ncc(a_n__ref, a_n__new, n_shift__best + 1);
        let n_denominator = n_left - 2 * n_ncc__best + n_right;
        if(Math.abs(n_denominator) > 1e-12){
            n_offset = 0.5 * (n_left - n_right) / n_denominator;
            if(!(n_offset > -1 && n_offset < 1)) n_offset = 0;
        }
    }
    // ref[i] lines up with new[i + shift], so a positive shift means the image
    // content moved that far in the positive direction
    return { n_px: n_shift__best + n_offset, n_ncc: n_ncc__best };
};

let f_o_shift = function(o_profile__ref, o_profile__new, n_shift__max) {
    let o_x = f_o_shift__profile(o_profile__ref.a_n_x, o_profile__new.a_n_x, n_shift__max);
    let o_y = f_o_shift__profile(o_profile__ref.a_n_y, o_profile__new.a_n_y, n_shift__max);
    return {
        n_px_x: o_x.n_px,
        n_px_y: o_y.n_px,
        n_ncc: Math.min(o_x.n_ncc, o_y.n_ncc),
    };
};

// ─── Turning a probe run into a backlash value ──────────────────────
//
// While the gears are still in their slack the image does not move at all, once
// they are engaged it moves proportionally to the steps.  So the samples follow
//
//     y(s) = c + k * max(0, s - b)
//
// with b = the backlash in steps.  Fitting that whole shape beats thresholding
// "the first frame that looks different": a threshold can only trigger once the
// movement is bigger than the noise, which always overestimates b, while the
// fit uses every sample and lands between two probe positions.

// a_o_sample: [{ n_step, n_signal }], n_step counting up from the reversal.
// n_signal is measured against the reference frame, so it is zero at step 0 --
// that anchor is what makes the breakpoint identifiable when the stage turns
// out to have no backlash at all and every sample already sits on the ramp.
let f_o_fit__backlash = function(a_o_sample) {
    let o_fail = { b_valid: false, n_step__backlash: 0, n_signal__per_step: 0, n_r2: 0 };
    if(!a_o_sample || a_o_sample.length < 6) return o_fail;

    let a_o = a_o_sample.slice().sort(function(o_a, o_b){ return o_a.n_step - o_b.n_step; });
    if(a_o[0].n_step > 0) a_o.unshift({ n_step: 0, n_signal: 0 });
    let n_step__max = a_o[a_o.length - 1].n_step;
    let n_step__grid = Math.max(0.25, (a_o[1].n_step - a_o[0].n_step) / 8);

    let n_sse__total = 0;
    let n_mean__signal = a_o.reduce(function(n_sum, o){ return n_sum + o.n_signal; }, 0) / a_o.length;
    for(let o of a_o) n_sse__total += (o.n_signal - n_mean__signal) * (o.n_signal - n_mean__signal);

    let a_o_candidate = [];
    for(let n_b = 0; n_b <= n_step__max; n_b += n_step__grid){
        // least squares for c and k with the breakpoint fixed at n_b
        let n_s11 = 0, n_s12 = 0, n_s22 = 0, n_t1 = 0, n_t2 = 0, n_cnt__ramp = 0;
        for(let o of a_o){
            let n_x = Math.max(0, o.n_step - n_b);
            if(n_x > 0) n_cnt__ramp++;
            n_s11 += 1;
            n_s12 += n_x;
            n_s22 += n_x * n_x;
            n_t1 += o.n_signal;
            n_t2 += n_x * o.n_signal;
        }
        if(n_cnt__ramp < 3) continue;
        let n_determinant = n_s11 * n_s22 - n_s12 * n_s12;
        if(Math.abs(n_determinant) < 1e-12) continue;
        let n_c = (n_t1 * n_s22 - n_t2 * n_s12) / n_determinant;
        let n_k = (n_s11 * n_t2 - n_s12 * n_t1) / n_determinant;
        if(n_k <= 0) continue;

        let n_sse = 0;
        for(let o of a_o){
            let n_fit = n_c + n_k * Math.max(0, o.n_step - n_b);
            n_sse += (o.n_signal - n_fit) * (o.n_signal - n_fit);
        }
        a_o_candidate.push({ n_sse: n_sse, n_b: n_b, n_k: n_k, n_c: n_c });
    }
    if(!a_o_candidate.length) return o_fail;

    let o_best = a_o_candidate.reduce(function(o_a, o_b){ return o_b.n_sse < o_a.n_sse ? o_b : o_a; });
    // With no sample inside the slack the breakpoint is not identifiable: every
    // b below the first sample fits equally well.  Take the smallest one that
    // still fits, so a stage without backlash is not credited with some.
    let n_sse__accept = o_best.n_sse * 1.02 + 1e-9;
    for(let o_candidate of a_o_candidate){
        if(o_candidate.n_sse <= n_sse__accept && o_candidate.n_b < o_best.n_b){
            o_best = o_candidate;
        }
    }

    let n_r2 = n_sse__total > 0 ? 1 - o_best.n_sse / n_sse__total : 0;
    return {
        b_valid: n_r2 > 0.8 && o_best.n_k > 0,
        n_step__backlash: o_best.n_b,
        n_signal__per_step: o_best.n_k,
        n_offset: o_best.n_c,
        n_r2: n_r2,
    };
};

// Where the stage demonstrably starts to move.
//
// The knee from f_o_fit__backlash is the back-extrapolation of the straight
// part of the curve.  On a drive that engages softly -- belt stretch, printed
// teeth deflecting -- the stage already creeps before that point, so the knee
// lands at (dead zone + half the take-up width) and compensating it drives the
// stage during the compensation burst, which is exactly the jump you see.  This
// finds the other end of that trade-off: the first step where the signal leaves
// the noise of the flat part.
//
// No model of the take-up shape is assumed, so this stays honest on drives that
// engage hard (where it agrees with the knee) as well as soft ones.
let f_o_onset = function(a_o_sample, o_fit) {
    let o_fail = { b_valid: false, n_step__onset: 0, n_deviation__noise: 0 };
    if(!o_fit || !o_fit.b_valid || !a_o_sample || a_o_sample.length < 4) return o_fail;

    let a_o = a_o_sample.slice().sort(function(o_a, o_b){ return o_a.n_step - o_b.n_step; });
    if(a_o[0].n_step > 0) a_o.unshift({ n_step: 0, n_signal: 0 });

    // The noise has to come from the part that is certainly still flat.  Taking
    // everything up to the knee would swallow the compliant creep as if it were
    // noise, and the threshold would then only be crossed at the knee itself --
    // which is the number this function exists to improve on.  The leading third
    // is safely inside the dead zone whatever the take-up looks like.
    let a_o_flat = a_o.filter(function(o){ return o.n_step <= 0.35 * o_fit.n_step__backlash; });
    if(a_o_flat.length < 3) a_o_flat = a_o.slice(0, 3);

    let n_mean__flat = a_o_flat.reduce(function(n_sum, o){ return n_sum + o.n_signal; }, 0)
        / a_o_flat.length;
    let n_variance = a_o_flat.reduce(function(n_sum, o){
        return n_sum + (o.n_signal - n_mean__flat) * (o.n_signal - n_mean__flat);
    }, 0) / a_o_flat.length;
    let n_deviation = Math.sqrt(n_variance);

    // only a guard against a perfectly noiseless run triggering on a rounding
    // wobble -- keep it small, it is multiplied by three below and every step it
    // adds to the threshold is a step of backlash left uncompensated
    let n_signal__max = a_o[a_o.length - 1].n_signal;
    n_deviation = Math.max(n_deviation, Math.abs(n_signal__max) * 0.002);
    let n_threshold = n_mean__flat + 3 * n_deviation;

    for(let n_idx = 1; n_idx < a_o.length; n_idx++){
        if(a_o[n_idx].n_signal <= n_threshold) continue;
        // interpolate between the last sample below and this one
        let o_below = a_o[n_idx - 1];
        let o_above = a_o[n_idx];
        let n_span = o_above.n_signal - o_below.n_signal;
        let n_step__onset = o_above.n_step;
        if(Math.abs(n_span) > 1e-12){
            let n_nor = (n_threshold - o_below.n_signal) / n_span;
            n_step__onset = o_below.n_step + n_nor * (o_above.n_step - o_below.n_step);
        }
        return {
            b_valid: true,
            // the onset can never sit past the knee
            n_step__onset: Math.max(0, Math.min(n_step__onset, o_fit.n_step__backlash)),
            n_deviation__noise: n_deviation,
        };
    }
    return o_fail;
};

// mean and spread of the repeats, so it is visible whether the number is solid
let f_o_stat = function(a_n) {
    if(!a_n.length) return { n_mean: 0, n_deviation: 0, n_min: 0, n_max: 0, n_cnt: 0 };
    let n_mean = a_n.reduce(function(n_sum, n){ return n_sum + n; }, 0) / a_n.length;
    let n_variance = a_n.reduce(function(n_sum, n){ return n_sum + (n - n_mean) * (n - n_mean); }, 0) / a_n.length;
    return {
        n_mean: n_mean,
        n_deviation: Math.sqrt(n_variance),
        n_min: Math.min(...a_n),
        n_max: Math.max(...a_n),
        n_cnt: a_n.length,
    };
};

export {
    f_o_profile,
    f_o_shift,
    f_o_shift__profile,
    f_n_ncc,
    f_o_fit__backlash,
    f_o_onset,
    f_o_stat,
};
