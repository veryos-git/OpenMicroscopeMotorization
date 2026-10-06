// Camera-space diagnostics: highlight clipping in any RGB channel, shadows in all.
let f_o_exposure_limits = (o = {}) => {
    let n_low = Number.isFinite(o.n_exposure__low) ? Math.round(o.n_exposure__low) : 5;
    let n_high = Number.isFinite(o.n_exposure__high) ? Math.round(o.n_exposure__high) : 250;
    n_low = Math.max(0, Math.min(254, n_low));
    n_high = Math.max(n_low + 1, Math.min(255, n_high));
    return { n_low, n_high };
};
let f_o_exposure_histogram = (a_rgba, o_option) => {
    let { n_low, n_high } = f_o_exposure_limits(o_option);
    let a_a_n_bin = Array.from({ length: 4 }, () => Array(256).fill(0));
    let n_pixels = 0, n_low_pixels = 0, n_high_pixels = 0;
    for (let i = 0; i < a_rgba.length; i += 4) {
        if (!a_rgba[i + 3]) continue;
        let r = a_rgba[i], g = a_rgba[i + 1], b = a_rgba[i + 2];
        a_a_n_bin[0][Math.round(.2126*r + .7152*g + .0722*b)]++;
        a_a_n_bin[1][r]++; a_a_n_bin[2][g]++; a_a_n_bin[3][b]++;
        n_pixels++;
        if (Math.max(r,g,b) <= n_low) n_low_pixels++;
        if (Math.max(r,g,b) >= n_high) n_high_pixels++;
    }
    return { a_a_n_bin, n_pixels,
        n_pct_low: n_pixels ? 100*n_low_pixels/n_pixels : 0,
        n_pct_high: n_pixels ? 100*n_high_pixels/n_pixels : 0 };
};
export { f_o_exposure_limits, f_o_exposure_histogram };
