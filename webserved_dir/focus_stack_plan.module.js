let f_a_stack_plane = (n_start, n_end, n_count) => {
    if (![n_start, n_end].every(Number.isSafeInteger)) throw new Error('Set both focus positions first');
    if (!Number.isInteger(n_count) || n_count < 2 || n_count > 200) throw new Error('Choose 2–200 images');
    if (n_count > Math.abs(n_end - n_start) + 1) throw new Error('Choose fewer images or move the focus positions farther apart');
    return Array.from({ length: n_count }, (_, i) => Math.round(n_start + (n_end - n_start) * i / (n_count - 1)));
};
export { f_a_stack_plane };
