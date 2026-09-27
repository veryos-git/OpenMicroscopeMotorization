// Crops use integer camera pixels; live annotations remain full-frame normalized.
let f_o_crop = (o_a, o_b, n_width, n_height) => {
    let f_edge = (n, n_size) => Math.round(Math.max(0, Math.min(1, n)) * n_size);
    let n_x = f_edge(Math.min(o_a.n_x, o_b.n_x), n_width);
    let n_y = f_edge(Math.min(o_a.n_y, o_b.n_y), n_height);
    let n_scl_x = f_edge(Math.max(o_a.n_x, o_b.n_x), n_width) - n_x;
    let n_scl_y = f_edge(Math.max(o_a.n_y, o_b.n_y), n_height) - n_y;
    return n_scl_x >= 2 && n_scl_y >= 2 ? { n_x, n_y, n_scl_x, n_scl_y } : null;
};
let f_o_crop_bounds = (o_crop, n_width, n_height) =>
    o_crop
        ? {
            n_x: o_crop.n_x / n_width,
            n_y: o_crop.n_y / n_height,
            n_scl_x: o_crop.n_scl_x / n_width,
            n_scl_y: o_crop.n_scl_y / n_height,
        }
        : { n_x: 0, n_y: 0, n_scl_x: 1, n_scl_y: 1 };
let f_o_crop_point = (o_point, o_bounds) => ({
    n_x: Math.max(o_bounds.n_x, Math.min(o_bounds.n_x + o_bounds.n_scl_x, o_point.n_x)),
    n_y: Math.max(o_bounds.n_y, Math.min(o_bounds.n_y + o_bounds.n_scl_y, o_point.n_y)),
});
let f_o_box_to_crop = (o_box, o_bounds) => ({
    ...o_box,
    n_x: (o_box.n_x - o_bounds.n_x) / o_bounds.n_scl_x,
    n_y: (o_box.n_y - o_bounds.n_y) / o_bounds.n_scl_y,
    n_scl_x: o_box.n_scl_x / o_bounds.n_scl_x,
    n_scl_y: o_box.n_scl_y / o_bounds.n_scl_y,
});
let f_o_box_from_crop = (o_box, o_bounds) => ({
    ...o_box,
    n_x: o_bounds.n_x + o_box.n_x * o_bounds.n_scl_x,
    n_y: o_bounds.n_y + o_box.n_y * o_bounds.n_scl_y,
    n_scl_x: o_box.n_scl_x * o_bounds.n_scl_x,
    n_scl_y: o_box.n_scl_y * o_bounds.n_scl_y,
});
export { f_o_box_from_crop, f_o_box_to_crop, f_o_crop, f_o_crop_bounds, f_o_crop_point };
