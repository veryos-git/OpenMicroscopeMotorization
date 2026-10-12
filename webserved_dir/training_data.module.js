import { f_validate_sam_point } from './sam_prompt.module.js';

// Geometry is normalized to the unprocessed, full camera frame.
let f_o_box = function (o_start, o_end, o_label) {
    let f_n_clamp = (n) => Math.max(0, Math.min(1, n));
    let n_x = f_n_clamp(Math.min(o_start.n_x, o_end.n_x));
    let n_y = f_n_clamp(Math.min(o_start.n_y, o_end.n_y));
    return {
        s_id: crypto.randomUUID(),
        s_label: o_label.s_name.trim(),
        s_color: o_label.s_color,
        n_x,
        n_y,
        n_scl_x: f_n_clamp(Math.max(o_start.n_x, o_end.n_x)) - n_x,
        n_scl_y: f_n_clamp(Math.max(o_start.n_y, o_end.n_y)) - n_y,
    };
};
let f_validate_sample = function (o_sample) {
    if (
        !o_sample || !Number.isInteger(o_sample.n_scl_x) || !Number.isInteger(o_sample.n_scl_y) ||
        o_sample.n_scl_x < 1 || o_sample.n_scl_y < 1 || o_sample.n_scl_x > 32768 || o_sample.n_scl_y > 32768
    ) {
        throw new Error('Invalid image dimensions');
    }
    if (o_sample.o_crop) {
        let o = o_sample.o_crop;
        if (
            ![o.n_x, o.n_y, o.n_scl_x, o.n_scl_y, o_sample.n_scl_x__source, o_sample.n_scl_y__source].every(
                Number.isInteger,
            ) ||
            o.n_x < 0 || o.n_y < 0 || o.n_scl_x !== o_sample.n_scl_x || o.n_scl_y !== o_sample.n_scl_y ||
            o.n_x + o.n_scl_x > o_sample.n_scl_x__source || o.n_y + o.n_scl_y > o_sample.n_scl_y__source ||
            o_sample.n_scl_x__source > 32768 || o_sample.n_scl_y__source > 32768
        ) {
            throw new Error('Invalid crop metadata');
        }
    }
    if (!Array.isArray(o_sample.a_o_box) || !o_sample.a_o_box.length || o_sample.a_o_box.length > 1000) {
        throw new Error('Add at least one bounding box (maximum 1000)');
    }
    for (let o_box of o_sample.a_o_box) {
        if (o_box.a_o_point !== undefined) f_validate_sam_point(o_box.a_o_point);
        if (
            typeof o_box.s_label !== 'string' || !o_box.s_label.trim() || o_box.s_label.length > 100 ||
            /[\r\n]/.test(o_box.s_label)
        ) throw new Error('Invalid label');
        if (
            ![o_box.n_x, o_box.n_y, o_box.n_scl_x, o_box.n_scl_y].every(Number.isFinite) ||
            o_box.n_x < 0 || o_box.n_y < 0 || o_box.n_scl_x <= 0 || o_box.n_scl_y <= 0 ||
            o_box.n_x + o_box.n_scl_x > 1.00000001 || o_box.n_y + o_box.n_scl_y > 1.00000001
        ) throw new Error('Invalid bounding box');
        if (o_box.o_segmentation) {
            let o_mask = o_box.o_segmentation;
            if (o_mask.s_model !== 'sam_b' || o_mask.n_scl_x !== o_sample.n_scl_x ||
                o_mask.n_scl_y !== o_sample.n_scl_y || typeof o_mask.s_mask_png !== 'string' ||
                o_mask.s_mask_png.length > 50 * 1024 * 1024 ||
                !Array.isArray(o_mask.a_a_n_polygon) || o_mask.a_a_n_polygon.length > 10000 ||
                o_mask.a_a_n_polygon.some(a => !Array.isArray(a) || a.length < 3 || a.length > 200000 ||
                    a.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1)))) {
                throw new Error('Invalid SAM segmentation');
            }
            let a_n_mask;
            try { a_n_mask = Uint8Array.from(atob(o_mask.s_mask_png), s => s.charCodeAt(0)); }
            catch { throw new Error('Invalid SAM mask PNG'); }
            if (a_n_mask.length < 24 || ![137,80,78,71,13,10,26,10].every((n,i) => a_n_mask[i] === n)) throw new Error('Invalid SAM mask PNG');
            let o_header = new DataView(a_n_mask.buffer);
            if (o_header.getUint32(16) !== o_sample.n_scl_x || o_header.getUint32(20) !== o_sample.n_scl_y) throw new Error('SAM mask dimensions do not match image');
        }
    }
};
let f_s_yolo = function (a_o_box, a_s_label) {
    return a_o_box.map((o_box) => {
        let n_idx = a_s_label.indexOf(o_box.s_label);
        if (n_idx < 0) throw new Error('Unknown label');
        return [
            n_idx,
            o_box.n_x + o_box.n_scl_x / 2,
            o_box.n_y + o_box.n_scl_y / 2,
            o_box.n_scl_x,
            o_box.n_scl_y,
        ]
            .map((n, n_i) => n_i ? n.toFixed(8) : String(n)).join(' ');
    }).join('\n') + '\n';
};
export { f_o_box, f_s_yolo, f_validate_sample };

// Handle dimensions are CSS pixels, independent of camera resolution/zoom.
let f_o_box_handle = function (o_box, o_view) {
    let n_scl_x = Math.min(1, 10 / o_view.n_scl_x);
    let n_scl_y = Math.min(1, 10 / o_view.n_scl_y);
    return {
        n_x: Math.max(0, Math.min(1 - n_scl_x, o_box.n_x - n_scl_x / 2)),
        n_y: Math.max(0, Math.min(1 - n_scl_y, o_box.n_y + o_box.n_scl_y - n_scl_y / 2)),
        n_scl_x,
        n_scl_y,
    };
};
let f_o_box_edit = function (o_box, s_mode, o_delta, n_scl_x, n_scl_y) {
    let o_result = { ...o_box };
    if (s_mode === 'move') {
        o_result.n_x = Math.max(0, Math.min(1 - o_box.n_scl_x, o_box.n_x + o_delta.n_x));
        o_result.n_y = Math.max(0, Math.min(1 - o_box.n_scl_y, o_box.n_y + o_delta.n_y));
    } else {
        // Bottom-left handle: keep the top-right corner fixed, without flipping.
        let n_right = o_box.n_x + o_box.n_scl_x;
        o_result.n_x = Math.max(
            0,
            Math.min(n_right - Math.min(o_box.n_scl_x, 2 / n_scl_x), o_box.n_x + o_delta.n_x),
        );
        o_result.n_scl_x = n_right - o_result.n_x;
        o_result.n_scl_y = Math.max(
            Math.min(o_box.n_scl_y, 2 / n_scl_y),
            Math.min(1 - o_box.n_y, o_box.n_scl_y + o_delta.n_y),
        );
    }
    return o_result;
};
export { f_o_box_edit, f_o_box_handle };
