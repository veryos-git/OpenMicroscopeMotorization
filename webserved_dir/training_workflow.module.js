let f_a_grid = function (n_x, n_y) {
    if (![n_x, n_y].every((n) => Number.isInteger(n) && n > 0 && n <= 100) || n_x * n_y > 1000) {
        throw new Error('Use 1–100 regions per axis, up to 1000 total');
    }
    return Array.from({ length: n_x * n_y }, (_, n_idx) => {
        let n_row = Math.floor(n_idx / n_x), n_column = n_idx % n_x;
        return { n_x: n_row % 2 ? n_x - 1 - n_column : n_column, n_y: n_row };
    });
};
let f_a_plane = function (n_start, n_end, n_count) {
    if (![n_start, n_end].every(Number.isSafeInteger)) throw new Error('Set both focus positions first');
    if (!Number.isInteger(n_count) || n_count < 1 || n_count > 100) throw new Error('Use 1–100 focus planes');
    if (n_count > Math.abs(n_end - n_start) + 1) {
        throw new Error('There are fewer distinct motor steps than focus planes');
    }
    if (n_count === 1) return [n_start];
    return Array.from(
        { length: n_count },
        (_, n_idx) => Math.round(n_start + (n_end - n_start) * n_idx / (n_count - 1)),
    );
};
let f_o_video_rect = function (o_rect, n_x, n_y) {
    if (!(n_x > 0 && n_y > 0 && o_rect.width > 0 && o_rect.height > 0)) return null;
    let n_scale = Math.min(o_rect.width / n_x, o_rect.height / n_y);
    return {
        n_x: o_rect.left + (o_rect.width - n_x * n_scale) / 2,
        n_y: o_rect.top + (o_rect.height - n_y * n_scale) / 2,
        n_scl_x: n_x * n_scale,
        n_scl_y: n_y * n_scale,
    };
};
// Return to the previous focus on success and recoverable failure. Explicit stop
// or connection loss suppresses the return move, so Stop cannot restart motion.
let f_focus_sweep = async function ({ a_n_plane, n_previous, f_move, f_frame, f_check }) {
    try {
        for (let n_idx = 0; n_idx < a_n_plane.length; n_idx++) {
            f_check();
            await f_move(a_n_plane[n_idx]);
            f_check();
            await f_frame(n_idx, a_n_plane[n_idx]);
        }
    } finally {
        f_check();
        await f_move(n_previous);
    }
};
export { f_a_grid, f_a_plane, f_focus_sweep, f_o_video_rect };
