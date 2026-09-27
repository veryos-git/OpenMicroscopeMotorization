// Frame differencing finds moving regions, not species or exact organism outlines.
// Input is a bounded grayscale analysis frame; output uses original camera pixels.
let f_o_motion_config = function(o_value = {}) {
    let o = o_value || {};
    let f_n = (s_key, n_default, n_min, n_max) =>
        typeof o[s_key] === 'number' && Number.isFinite(o[s_key])
            ? Math.max(n_min, Math.min(n_max, o[s_key])) : n_default;
    let n_area__min = f_n('n_area__min', 100, 1, 1e9);
    return {
        b_enabled: o.b_enabled === true,
        s_sensitivity: o.s_sensitivity === 'low' ? 'low' : 'high',
        n_area__min,
        n_area__max: Math.max(n_area__min, f_n('n_area__max', 250000, 1, 1e9)),
        n_movement__min: f_n('n_movement__min', 2, 0, 100000),
    };
};

let f_o_motion_detector = function() {
    let a_n_previous = null, a_o_previous = [];
    let s_geometry = '';
    let a_a_n_neighbor = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let f_reset = function() { a_n_previous = null; a_o_previous = []; s_geometry = ''; };
    let f_detect = function(a_n_gray, n_scl_x, n_scl_y, n_scl_x__source, n_scl_y__source, o_config) {
        let s_next = [n_scl_x, n_scl_y, n_scl_x__source, n_scl_y__source].join(':');
        if (a_n_gray.length !== n_scl_x * n_scl_y || n_scl_x < 1 || n_scl_y < 1) {
            throw Error('Invalid motion analysis frame');
        }
        if (!a_n_previous || s_geometry !== s_next) {
            s_geometry = s_next;
            a_n_previous = a_n_gray.slice();
            a_o_previous = [];
            return { a_o_region: [], s_status: 'Learning reference frame' };
        }
        let n_count = a_n_gray.length;
        let a_n_mask = new Uint8Array(n_count);
        let n_offset = 0;
        for (let n = 0; n < n_count; n++) n_offset += a_n_gray[n] - a_n_previous[n];
        n_offset /= n_count; // Ignore uniform exposure/illumination shifts.
        let n_threshold = o_config.s_sensitivity === 'low' ? 35 : 12;
        let n_changed = 0;
        for (let n = 0; n < n_count; n++) {
            if (Math.abs(a_n_gray[n] - a_n_previous[n] - n_offset) >= n_threshold) {
                a_n_mask[n] = 1;
                n_changed++;
            }
        }
        a_n_previous = a_n_gray.slice();
        if (n_changed > n_count * 0.35) {
            a_o_previous = [];
            return { a_o_region: [], s_status: 'Widespread change — resetting reference' };
        }
        // One-pixel dilation joins nearby changing edges; retain original changed
        // pixel count to reject isolated noise and to avoid padding size estimates.
        let a_n_joined = new Uint8Array(n_count);
        for (let n = 0; n < n_count; n++) {
            if (!a_n_mask[n]) continue;
            let n_x = n % n_scl_x, n_y = Math.floor(n / n_scl_x);
            for (let n_dy = -1; n_dy <= 1; n_dy++) {
                for (let n_dx = -1; n_dx <= 1; n_dx++) {
                    let n_x2 = n_x + n_dx, n_y2 = n_y + n_dy;
                    if (n_x2 >= 0 && n_x2 < n_scl_x && n_y2 >= 0 && n_y2 < n_scl_y) {
                        a_n_joined[n_y2 * n_scl_x + n_x2] = 1;
                    }
                }
            }
        }
        let a_n_queue = new Int32Array(n_count), a_o_candidate = [];
        let n_scale_x = n_scl_x__source / n_scl_x, n_scale_y = n_scl_y__source / n_scl_y;
        for (let n = 0; n < n_count; n++) {
            if (!a_n_joined[n]) continue;
            let n_head = 0, n_tail = 1, n_pixel = 0;
            let n_x0 = n_scl_x, n_y0 = n_scl_y, n_x1 = 0, n_y1 = 0;
            a_n_queue[0] = n;
            a_n_joined[n] = 0;
            while (n_head < n_tail) {
                let n_idx = a_n_queue[n_head++];
                let n_x = n_idx % n_scl_x, n_y = Math.floor(n_idx / n_scl_x);
                if (a_n_mask[n_idx]) {
                    n_pixel++;
                    n_x0 = Math.min(n_x0, n_x); n_x1 = Math.max(n_x1, n_x);
                    n_y0 = Math.min(n_y0, n_y); n_y1 = Math.max(n_y1, n_y);
                }
                for (let [n_dx, n_dy] of a_a_n_neighbor) {
                    let n_x2 = n_x + n_dx, n_y2 = n_y + n_dy, n_idx2 = n_y2 * n_scl_x + n_x2;
                    if (n_x2 >= 0 && n_x2 < n_scl_x && n_y2 >= 0 && n_y2 < n_scl_y && a_n_joined[n_idx2]) {
                        a_n_joined[n_idx2] = 0;
                        a_n_queue[n_tail++] = n_idx2;
                    }
                }
            }
            if (n_pixel < 3) continue;
            let o_region = {
                n_x: n_x0 * n_scale_x, n_y: n_y0 * n_scale_y,
                n_scl_x: (n_x1 - n_x0 + 1) * n_scale_x,
                n_scl_y: (n_y1 - n_y0 + 1) * n_scale_y,
            };
            o_region.n_area = o_region.n_scl_x * o_region.n_scl_y;
            if (o_region.n_area >= o_config.n_area__min && o_region.n_area <= o_config.n_area__max) {
                a_o_candidate.push(o_region);
            }
        }
        // Bound matching/rendering cost on noisy frames.
        a_o_candidate.sort((a, b) => b.n_area - a.n_area);
        a_o_candidate = a_o_candidate.slice(0, 100);
        let o_used = new Set(), a_o_region = [];
        for (let o of a_o_candidate) {
            let n_best = -1, n_distance = Infinity;
            for (let n = 0; n < a_o_previous.length; n++) {
                if (o_used.has(n)) continue;
                let p = a_o_previous[n];
                if (o.n_area / p.n_area < 0.25 || o.n_area / p.n_area > 4) continue;
                let n_d = Math.hypot(o.n_x + o.n_scl_x / 2 - p.n_x - p.n_scl_x / 2,
                    o.n_y + o.n_scl_y / 2 - p.n_y - p.n_scl_y / 2);
                if (n_d < n_distance) { n_distance = n_d; n_best = n; }
            }
            // Large jumps are new regions, not reliable motion correspondences.
            let b_matched = n_best >= 0 && n_distance <= 32 * Math.max(n_scale_x, n_scale_y);
            if (b_matched) o_used.add(n_best);
            o.n_movement = b_matched ? n_distance : 0;
            if (o_config.n_movement__min === 0 || (b_matched && n_distance >= o_config.n_movement__min)) {
                a_o_region.push(o);
            }
        }
        a_o_previous = a_o_candidate;
        return { a_o_region, s_status: a_o_region.length ? 'Motion detected' : 'Watching for motion' };
    };
    return { f_detect, f_reset };
};

// Match object-fit: contain, including the side-by-side training layout.
let f_o_motion_view = function(o_rect, n_scl_x, n_scl_y) {
    let n_scale = Math.min(o_rect.width / n_scl_x, o_rect.height / n_scl_y);
    return {
        n_x: o_rect.left + (o_rect.width - n_scl_x * n_scale) / 2,
        n_y: o_rect.top + (o_rect.height - n_scl_y * n_scale) / 2,
        n_scl_x: n_scl_x * n_scale, n_scl_y: n_scl_y * n_scale,
    };
};

export { f_o_motion_config, f_o_motion_detector, f_o_motion_view };
