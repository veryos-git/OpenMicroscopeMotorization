// flat-field ("dust remove") correction.
//
// the calibration flow averages a few defocused frames of an empty bright
// region into one flat image (illumination profile + sensor dust), and this
// module turns that flat into a per-pixel gain map used to correct the live
// view and every captured frame.
//
// the heavy pixel buffers stay OUT of Vue's reactive o_state so the reactivity
// proxy never wraps a multi-megabyte Float32Array. o_state.o_flat_field only
// carries the small metadata (paths, resolution, per-channel means, active
// flag, camera snapshot).

let o_flat__cache = {
    b_loaded: false,
    n_scl_x: 0,
    n_scl_y: 0,
    a_n_mean__channel: [0, 0, 0],
    a_n_byte__flat: null,   // Uint8ClampedArray RGBA of the flat (texture / PNG)
    a_n_gain: null,         // Float32Array per pixel per channel (capture path)
    s_path_flat: '',
    n_ms__created: 0,
};

let N_GAIN__MIN = 0.25;
let N_GAIN__MAX = 4.0;

// average a list of RGBA frames into one flat image (per-channel mean across
// the frames). a_o_frame items look like { n_scl_x, n_scl_y, o_imagedata }.
let f_o_flat__average = function(a_o_frame) {
    if (!a_o_frame.length) return null;
    let o_frame__first = a_o_frame[0];
    let n_scl_x = o_frame__first.n_scl_x;
    let n_scl_y = o_frame__first.n_scl_y;
    let n_cnt__pixel = n_scl_x * n_scl_y;
    let a_n_sum = new Float64Array(n_cnt__pixel * 3);
    for (let n_idx = 0; n_idx < a_o_frame.length; n_idx++) {
        let a_n_byte = a_o_frame[n_idx].o_imagedata.data;
        for (let n_px = 0; n_px < n_cnt__pixel; n_px++) {
            a_n_sum[n_px * 3 + 0] += a_n_byte[n_px * 4 + 0];
            a_n_sum[n_px * 3 + 1] += a_n_byte[n_px * 4 + 1];
            a_n_sum[n_px * 3 + 2] += a_n_byte[n_px * 4 + 2];
        }
    }
    let n_cnt__frame = a_o_frame.length;
    let a_n_byte__flat = new Uint8ClampedArray(n_cnt__pixel * 4);
    for (let n_px = 0; n_px < n_cnt__pixel; n_px++) {
        a_n_byte__flat[n_px * 4 + 0] = a_n_sum[n_px * 3 + 0] / n_cnt__frame;
        a_n_byte__flat[n_px * 4 + 1] = a_n_sum[n_px * 3 + 1] / n_cnt__frame;
        a_n_byte__flat[n_px * 4 + 2] = a_n_sum[n_px * 3 + 2] / n_cnt__frame;
        a_n_byte__flat[n_px * 4 + 3] = 255;
    }
    return { n_scl_x, n_scl_y, a_n_byte: a_n_byte__flat };
};

// compute the per-channel gain map: gain = clamp(mean_c / flat_c, MIN, MAX).
// a dark spot in the flat becomes a large gain (brightens that pixel back up),
// a vignette corner becomes a large gain (flattens the falloff). normalising
// by the per-channel mean keeps the overall brightness and white balance.
let f_o_gain__compute = function(a_n_byte__flat, n_scl_x, n_scl_y) {
    let n_cnt__pixel = n_scl_x * n_scl_y;
    let a_n_sum__channel = [0, 0, 0];
    for (let n_px = 0; n_px < n_cnt__pixel; n_px++) {
        a_n_sum__channel[0] += a_n_byte__flat[n_px * 4 + 0];
        a_n_sum__channel[1] += a_n_byte__flat[n_px * 4 + 1];
        a_n_sum__channel[2] += a_n_byte__flat[n_px * 4 + 2];
    }
    let a_n_mean__channel = [
        a_n_sum__channel[0] / n_cnt__pixel,
        a_n_sum__channel[1] / n_cnt__pixel,
        a_n_sum__channel[2] / n_cnt__pixel,
    ];
    let a_n_gain = new Float32Array(n_cnt__pixel * 3);
    for (let n_px = 0; n_px < n_cnt__pixel; n_px++) {
        for (let n_channel = 0; n_channel < 3; n_channel++) {
            let n_flat = a_n_byte__flat[n_px * 4 + n_channel];
            if (n_flat < 1) n_flat = 1;
            let n_gain = a_n_mean__channel[n_channel] / n_flat;
            if (n_gain < N_GAIN__MIN) n_gain = N_GAIN__MIN;
            if (n_gain > N_GAIN__MAX) n_gain = N_GAIN__MAX;
            a_n_gain[n_px * 3 + n_channel] = n_gain;
        }
    }
    return { n_scl_x, n_scl_y, a_n_mean__channel, a_n_gain };
};

// store a computed flat into the cache and rebuild the gain map.
// returns nothing — the cache is the single source of truth.
let f_flat__set = function(a_n_byte__flat, n_scl_x, n_scl_y, o_meta) {
    let o_gain = f_o_gain__compute(a_n_byte__flat, n_scl_x, n_scl_y);
    o_flat__cache.b_loaded = true;
    o_flat__cache.n_scl_x = n_scl_x;
    o_flat__cache.n_scl_y = n_scl_y;
    o_flat__cache.a_n_mean__channel = o_gain.a_n_mean__channel;
    o_flat__cache.a_n_byte__flat = a_n_byte__flat;
    o_flat__cache.a_n_gain = o_gain.a_n_gain;
    o_flat__cache.n_ms__created = (o_meta && o_meta.n_ms__created) || Date.now();
    o_flat__cache.s_path_flat = (o_meta && o_meta.s_path_flat) || '';
};

let f_flat__clear = function() {
    o_flat__cache = {
        b_loaded: false,
        n_scl_x: 0,
        n_scl_y: 0,
        a_n_mean__channel: [0, 0, 0],
        a_n_byte__flat: null,
        a_n_gain: null,
        s_path_flat: '',
        n_ms__created: 0,
    };
};

let f_o_flat = function() { return o_flat__cache; };

let f_b_flat__loaded = function() {
    return o_flat__cache.b_loaded && !!o_flat__cache.a_n_gain;
};

let f_b_flat__matches = function(n_scl_x, n_scl_y) {
    return o_flat__cache.b_loaded
        && o_flat__cache.n_scl_x === n_scl_x
        && o_flat__cache.n_scl_y === n_scl_y;
};

// correct one ImageData in place using the gain map. returns nothing.
// a resolution mismatch is a no-op (the caller keeps the raw pixels).
let f_flat__apply = function(o_imagedata) {
    if (!f_b_flat__loaded()) return;
    if (!f_b_flat__matches(o_imagedata.width, o_imagedata.height)) return;
    let a_n_byte = o_imagedata.data;
    let a_n_gain = o_flat__cache.a_n_gain;
    let n_cnt__pixel = o_imagedata.width * o_imagedata.height;
    for (let n_px = 0; n_px < n_cnt__pixel; n_px++) {
        // Uint8ClampedArray assignment clamps to [0, 255] for free
        a_n_byte[n_px * 4 + 0] = a_n_byte[n_px * 4 + 0] * a_n_gain[n_px * 3 + 0];
        a_n_byte[n_px * 4 + 1] = a_n_byte[n_px * 4 + 1] * a_n_gain[n_px * 3 + 1];
        a_n_byte[n_px * 4 + 2] = a_n_byte[n_px * 4 + 2] * a_n_gain[n_px * 3 + 2];
    }
};

export {
    f_o_flat__average,
    f_o_gain__compute,
    f_flat__set,
    f_flat__clear,
    f_o_flat,
    f_b_flat__loaded,
    f_b_flat__matches,
    f_flat__apply,
};
