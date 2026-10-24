// Archived 2026-10-25: Deno tests of code that moved to archive/ (not runnable from here).
// From tests/quick_calibration_test.js and tests/motor_axis_test.js.

// ── quick_calibration_test.js: Setup → Calibrate all ──
for(const outcome of ['success', 'failure', 'stop']) {
    Deno.test('quick batch runs sequentially and handles ' + outcome, async () => {
        const state = { b_connected__esp: true, b_streaming__webcam: true, n_cnt__stop_all: 0 };
        const c = await component('setup', { o_state: state });
        const calls = [];
        let active = 0;
        const ctx = Object.assign(c.data(), c.methods, { b_can_move: true });
        ctx.$refs = { a_calibration: [2, 0, 1].map(n_motor => ({
            n_motor, s_status: 'test result',
            async f_run(options) {
                assert.equal(active++, 0);
                assert.equal(ctx.b_calibrating_all, true);
                assert.deepEqual(options, { b_quick: true });
                calls.push(n_motor);
                await Promise.resolve();
                active--;
                if(outcome === 'stop') ctx.f_stop_calibrating_all();
                return outcome !== 'failure';
            },
        })) };
        await ctx.f_calibrate_all();
        assert.deepEqual(calls, outcome === 'success' ? [0, 1, 2] : [0]);
        assert.equal(ctx.b_calibrating_all, false);
        assert.match(ctx.s_status__calibrate_all, outcome === 'success' ? /complete/ : /Stopped/);
    });
}

// ── motor_axis_test.js ──
Deno.test('Flat tool toggles its overlay without changing correction activation', async () => {
    for (const active of [true, false]) {
        const state = { o_panel_visibility: { flat: false }, o_flat_field: { s_path_flat: 'flat.png', b_active: active } };
        const toolbar = await component('toolbar', { o_state: state, o_actions: {
            f_invoke(id) {
                assert.equal(id, 'panel.flat');
                state.o_panel_visibility.flat = !state.o_panel_visibility.flat;
            },
        } });
        const ctx = { ...toolbar.methods, f_close_tools() {} };
        ctx.f_choose_tool('flat');
        assert.equal(state.o_panel_visibility.flat, true);
        assert.equal(state.o_flat_field.b_active, active);
        ctx.f_choose_tool('flat');
        assert.equal(state.o_panel_visibility.flat, false);
        assert.equal(state.o_flat_field.b_active, active);
        const flat = await component('flat_field', { o_state: state, f_save_setting__debounced() {}, f_save_flat_field() {} });
        flat.methods.f_toggle_active.call({});
        assert.equal(state.o_flat_field.b_active, !active);
    }
});

// ── motor_axis_test.js ──
Deno.test('motor card assignment swaps axes and can disable focus', async () => {
    const state = { o_motor__axis: { x: 0, y: 1, z: 2 } };
    for (const key of ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']) state['o_mapping__' + key] = {};
    const setup = await component('setup', { o_state: state, f_save_setting() {}, f_send_esp_stop_all() {} });
    const ctx = { ...setup.methods, b_hardware_busy: false };
    ctx.f_assign_motor(0, 'z');
    assert.deepEqual(state.o_motor__axis, { x: 2, y: 1, z: 0 });
    ctx.f_assign_motor(0, 'none');
    assert.deepEqual(state.o_motor__axis, { x: 2, y: 1, z: null });
    ctx.f_assign_motor(2, 'none');
    assert.equal(state.o_motor__axis.x, 2);
});

// ── motor_axis_test.js ──
Deno.test('motor card moves use the physical motor and reject invalid step counts', async () => {
    const moves = [];
    const setup = await component('setup', {
        o_state: { n_rpm__jog: 5 },
        f_send_esp_move_step: async (...args) => moves.push(args),
    });
    const ctx = { b_can_move: true, n_step__manual: 100 };
    await setup.methods.f_move_motor.call(ctx, 1, -1);
    assert.deepEqual(moves, [[1, -100, 5]]);
    assert.equal(ctx.b_move_pending, false);
    ctx.n_step__manual = NaN;
    await setup.methods.f_move_motor.call(ctx, 1, 1);
    assert.equal(moves.length, 1);
    assert.match(ctx.s_error__motor, /Choose/);
});

// ── motor_axis_test.js, from 'manual XY and Z speeds follow assignments…': motor test buttons ──
/*
    state.n_rpm__focus_jog = 0.8;
    const setup = await component('setup', {
        o_state: state, f_send_esp_move_step: async (motor, steps, rpm) => moves.push([motor, rpm]),
    });
    const ctx = { b_can_move: true, n_step__manual: 100 };
    moves.length = 0;
    await setup.methods.f_move_motor.call(ctx, 1, 1);
    state.o_motor__axis = { x: 1, y: 0, z: 2 };
    await setup.methods.f_move_motor.call(ctx, 1, 1);
    await setup.methods.f_move_motor.call(ctx, 2, 1);
    assert.deepEqual(moves, [[1, 0.8], [1, 6], [2, 0.8]]);
*/

