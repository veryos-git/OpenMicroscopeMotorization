// sharpness metrics for the auto focus
//
// Both answer the same question: how much high frequency detail is in the
// image?  A defocused image has soft edges and therefore little of it.  Both
// are divided by the mean luminance squared, so a frame that merely got
// brighter does not come out looking sharper.
//
// a_n_luma is a row-major luminance plane of n_scl_x * n_scl_y values.

let f_n_score__laplacian = function(a_n_luma, n_scl_x, n_scl_y, n_mean) {
    let n_sum = 0;
    let n_sum__square = 0;
    let n_cnt = 0;
    for(let n_y = 1; n_y < n_scl_y - 1; n_y++){
        for(let n_x = 1; n_x < n_scl_x - 1; n_x++){
            let n_idx = n_y * n_scl_x + n_x;
            let n_laplace = 4 * a_n_luma[n_idx]
                - a_n_luma[n_idx - 1]
                - a_n_luma[n_idx + 1]
                - a_n_luma[n_idx - n_scl_x]
                - a_n_luma[n_idx + n_scl_x];
            n_sum += n_laplace;
            n_sum__square += n_laplace * n_laplace;
            n_cnt++;
        }
    }
    if(!n_cnt) return 0;
    let n_mean__laplace = n_sum / n_cnt;
    let n_variance = n_sum__square / n_cnt - n_mean__laplace * n_mean__laplace;
    return n_variance / Math.max(n_mean * n_mean, 1e-6);
};

let f_n_score__tenengrad = function(a_n_luma, n_scl_x, n_scl_y, n_mean) {
    let n_sum = 0;
    let n_cnt = 0;
    for(let n_y = 1; n_y < n_scl_y - 1; n_y++){
        for(let n_x = 1; n_x < n_scl_x - 1; n_x++){
            let n_idx = n_y * n_scl_x + n_x;
            let n_00 = a_n_luma[n_idx - n_scl_x - 1];
            let n_10 = a_n_luma[n_idx - n_scl_x];
            let n_20 = a_n_luma[n_idx - n_scl_x + 1];
            let n_01 = a_n_luma[n_idx - 1];
            let n_21 = a_n_luma[n_idx + 1];
            let n_02 = a_n_luma[n_idx + n_scl_x - 1];
            let n_12 = a_n_luma[n_idx + n_scl_x];
            let n_22 = a_n_luma[n_idx + n_scl_x + 1];
            let n_gx = -n_00 - 2 * n_01 - n_02 + n_20 + 2 * n_21 + n_22;
            let n_gy = -n_00 - 2 * n_10 - n_20 + n_02 + 2 * n_12 + n_22;
            n_sum += n_gx * n_gx + n_gy * n_gy;
            n_cnt++;
        }
    }
    if(!n_cnt) return 0;
    return (n_sum / n_cnt) / Math.max(n_mean * n_mean, 1e-6);
};

// the score the auto focus works with: metric of choice, scaled to a number
// that reads well in the panel
let f_n_score = function(a_n_luma, n_scl_x, n_scl_y, n_mean, s_metric) {
    let n_score = s_metric === 'tenengrad'
        ? f_n_score__tenengrad(a_n_luma, n_scl_x, n_scl_y, n_mean)
        : f_n_score__laplacian(a_n_luma, n_scl_x, n_scl_y, n_mean);
    return n_score * 1000;
};

export { f_n_score, f_n_score__laplacian, f_n_score__tenengrad };
