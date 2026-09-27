// Manual speeds follow logical axes, even when physical motors are reassigned.
const a_o_speed_preset = [
    { s_name: 'Slow', xy: 0.5, z: 0.15 },
    { s_name: 'Normal', xy: 5, z: 0.5 },
    { s_name: 'Fast', xy: 10, z: 1.5 },
];
function f_n_speed(value, fallback) {
    const n = Number(value);
    return value === '' || value == null || !Number.isFinite(n)
        ? fallback : Math.round(Math.min(15, Math.max(0.05, n)) * 100) / 100;
}
function f_n_rpm__manual(state, axis) {
    return axis === 'z' ? f_n_speed(state.n_rpm__focus_jog, 0.5) : f_n_speed(state.n_rpm__jog, 5);
}
function f_o_manual_speed(saved, legacy) {
    return { xy: f_n_speed(saved?.xy, f_n_speed(legacy, 5)), z: f_n_speed(saved?.z, 0.5) };
}
export { a_o_speed_preset, f_n_speed, f_n_rpm__manual, f_o_manual_speed };
