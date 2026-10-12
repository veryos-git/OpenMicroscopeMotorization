// Point prompts are normalized to the same image as the box and mask.
let f_validate_sam_point = function (a_o_point) {
    if (!Array.isArray(a_o_point) || !a_o_point.length || a_o_point.length > 128 ||
        !a_o_point.some(o => o?.n_label === 1) || a_o_point.some(o =>
            !o || ![o.n_x, o.n_y].every(n => Number.isFinite(n) && n >= 0 && n <= 1) ||
            ![0, 1].includes(o.n_label))) {
        throw new Error('SAM needs 1–128 points, including a positive point, with valid coordinates and labels');
    }
};
export { f_validate_sam_point };
