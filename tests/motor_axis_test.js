import { f_n_rpm__manual } from '../webserved_dir/manual_speed.module.js';
import assert from 'node:assert/strict';

async function component(name, bindings) {
    bindings = { f_n_rpm__manual, ...bindings };
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__' + name + '.js', import.meta.url)))
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '')
        .replace(/export \{[^}]+\};?/, '');
    return new Function(...Object.keys(bindings), source + '\nreturn o_component__' + name)(...Object.values(bindings));
}

Deno.test('scan motor timeout stops motion and rejects the move', async () => {
    const stopped = [];
    const scan = await component('scan', {
        o_state: { b_connected__esp: true, a_o_motor: [{n_position:10}] },
        f_send_esp_move_step: () => new Promise(() => {}),
        f_send_esp_stop: motor => stopped.push(motor),
        setTimeout: callback => setTimeout(callback, 0),
    });
    const state = {b_stop_requested:false};
    await assert.rejects(() => scan.methods.f_move_motor_n_step.call(state, 0, 20), /timed out/);
    assert.deepEqual(stopped, [0]);
    assert.equal(state.b_stop_requested, true);
});

Deno.test('axis assignment swaps motors, persists mappings and preserves directions', async () => {
    const state = { o_motor__axis: { x: 0, y: 1, z: 2 } };
    for (const key of ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']) {
        state['o_mapping__' + key] = { s_motor: '0', s_dir: key === 'a' ? 'ccw' : 'cw' };
    }
    const saved = {};
    let stopped = false;
    const jog = await component('setup', {
        o_state: state,
        f_save_setting: (key, value) => saved[key] = structuredClone(value),
        f_send_esp_stop_all: () => stopped = true,
    });
    jog.methods.f_assign_axis.call({ f_on_blur() {} }, 'x', 2);
    assert.deepEqual(state.o_motor__axis, { x: 2, y: 1, z: 0 });
    assert.deepEqual(saved.o_motor__axis, state.o_motor__axis);
    assert.equal(stopped, true);
    for (const [axis, keys] of Object.entries({ x: ['a', 'd'], y: ['w', 's'], z: ['q', 'e', 'mouse_right'] })) {
        for (const key of keys) assert.equal(saved['o_mapping__' + key].s_motor, String(state.o_motor__axis[axis]));
    }
    assert.equal(state.o_mapping__a.s_dir, 'ccw');
});

Deno.test('rectangle motion routes X/Y moves to assigned physical motors', async () => {
    const moves = [];
    const auto = await component('auto_move', { f_n_motor__axis: axis => ({ x: 2, y: 0, z: 1 })[axis] });
    await auto.methods.f_run_rectangle.call({
        n_step__x: 10, n_step__y: 20, b_stop_requested: false,
        f_move_motor_n_step: async (motor, steps) => moves.push([motor, steps]),
    });
    assert.deepEqual(moves, [[2, 10], [0, 20], [2, -10], [0, -20]]);
});

Deno.test('saved XYZ positions restore through axis assignments', async () => {
    const moves = [];
    const library = await component('slide_library', {
        o_state: { a_o_motor: [{ n_position: 5 }, { n_position: 10 }, { n_position: 15 }], n_rpm__jog: 5 },
        f_n_motor__axis: axis => ({ x: 2, y: 0, z: 1 })[axis],
        f_send_esp_move_step: async (motor, delta) => moves.push([motor, delta]),
    });
    await library.methods.f_go_to_position.call({ o_slide__current: { n_x__stage: 20, n_y__stage: 30, n_z__stage: 40 } });
    assert.deepEqual(moves, [[2, 5], [0, 25], [1, 30]]);
});

Deno.test('old firmware blocks remapped circles before starting motion', async () => {
    const auto = await component('auto_move', {
        o_state: { b_axis_assignment__circle: false },
        f_n_motor__axis: axis => ({ x: 2, y: 0, z: 1 })[axis],
    });
    const context = { s_mode: 'circle', b_running: false };
    await auto.methods.f_run.call(context, false);
    assert.equal(context.b_running, false);
    assert.match(context.s_status__detail, /Update ESP32 firmware/);
});

Deno.test('all focus tools use the shared Z assignment and ignore legacy selectors', async () => {
    for (const name of ['focus', 'focus_step', 'focus_stack', 'flat_field', 'scan']) {
        let motor = 0;
        const moves = [];
        const c = await component(name, {
            o_state: { b_connected__esp: true, b_streaming__webcam: true, b_scanning: false },
            f_n_motor__axis: () => motor,
            f_send_esp_move_step: async (n, steps) => moves.push([n, steps]),
            f_o_focus__fast: options => options.f_move(12),
            setTimeout: () => 0,
        });
        const ctx = {
            o_config: { s_motor: '2' }, s_motor__focus: '2',
            f_delay: async () => {},
            f_move_motor_n_step: async (n, steps) => moves.push([n, steps]),
        };
        for (motor of [0, 1]) {
            if (name === 'scan') await c.methods.f_o_focus.call(ctx);
            else await c.methods.f_move.call(ctx, 12);
        }
        assert.deepEqual(moves, [[0, 12], [1, 12]], name);
        motor = null;
        assert.match(c.computed.s_motor__focus_label(), /No focus motor/);
        if (['focus', 'focus_step', 'focus_stack'].includes(name)) assert.equal(c.computed.b_ready(), false);
    }
});

Deno.test('Z can be unassigned and reassigned without removing an XY motor', async () => {
    const state = { o_motor__axis: { x: 0, y: 1, z: 2 } };
    for (const key of ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']) state['o_mapping__' + key] = {};
    const jog = await component('setup', { o_state: state, f_save_setting() {}, f_send_esp_stop_all() {} });
    const ctx = { f_on_blur() {} };
    jog.methods.f_assign_axis.call(ctx, 'z', null);
    assert.deepEqual(state.o_motor__axis, { x: 0, y: 1, z: null });
    assert.equal(state.o_mapping__q.s_motor, 'none');
    jog.methods.f_assign_axis.call(ctx, 'z', 0);
    assert.deepEqual(state.o_motor__axis, { x: 2, y: 1, z: 0 });
});

Deno.test('Flat always opens its overlay without changing correction activation', async () => {
    for (const active of [true, false]) {
        const state = { o_panel_visibility: { flat: false }, o_flat_field: { s_path_flat: 'flat.png', b_active: active } };
        const toolbar = await component('toolbar', { o_state: state, f_save_setting__debounced() {} });
        toolbar.methods.f_open_flat();
        toolbar.methods.f_open_flat();
        assert.equal(state.o_panel_visibility.flat, true);
        assert.equal(state.o_flat_field.b_active, active);
        const flat = await component('flat_field', { o_state: state, f_save_setting__debounced() {}, f_save_flat_field() {} });
        flat.methods.f_toggle_active.call({});
        assert.equal(state.o_flat_field.b_active, !active);
    }
});

Deno.test('Setup blocks axis changes during hardware activity', async () => {
    const state = { o_motor__axis: { x: 0, y: 1, z: 2 } };
    const setup = await component('setup', { o_state: state });
    setup.methods.f_assign_axis.call({ b_hardware_busy: true }, 'z', 0);
    assert.deepEqual(state.o_motor__axis, { x: 0, y: 1, z: 2 });
});

Deno.test('Setup connects USB without navigating away from hardware settings', async () => {
    let connected = false;
    const setup = await component('setup', {
        o_state: { b_flashing: false },
        f_connect_esp_serial: async () => { connected = true; return true; },
        o_router: { push() { assert.fail('Connection must stay in Setup'); } },
    });
    await setup.methods.f_connect_usb();
    assert.equal(connected, true);
});

Deno.test('Setup opens and closes as an overlay without routing', async () => {
    const state = { o_panel_visibility: { setup: false }, b_flashing: false };
    const bindings = {
        o_state: state,
        f_save_setting__debounced() {},
        o_router: { push() { assert.fail('Setup must not navigate'); } },
    };
    const toolbar = await component('toolbar', bindings);
    const setup = await component('setup', bindings);
    toolbar.methods.f_open_setup();
    assert.equal(state.o_panel_visibility.setup, true);
    toolbar.methods.f_open_setup();
    assert.equal(state.o_panel_visibility.setup, false);
    toolbar.methods.f_open_setup();
    setup.methods.f_close();
    assert.equal(state.o_panel_visibility.setup, false);
    toolbar.methods.f_open_setup();
    state.b_flashing = true;
    toolbar.methods.f_open_setup();
    assert.equal(state.o_panel_visibility.setup, true);
    setup.methods.f_close();
    assert.equal(state.o_panel_visibility.setup, true);
});

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

Deno.test('typing in hardware settings does not jog motors', async () => {
    const state = { b_connected__esp: true, o_key_held: {} };
    const jog = await component('jog', { o_state: state, f_send_esp_run_continuous() { assert.fail('Unexpected movement'); } });
    const ctx = { f_get_mapping() { assert.fail('Typing should not resolve a motor'); } };
    jog.methods.f_on_keydown.call(ctx, { key: 'w', target: { closest: () => ({}) } });
    jog.methods.f_on_keyup.call(ctx, { key: 'w' });
    assert.deepEqual(state.o_key_held, {});
});

Deno.test('backlash selects axes, routes probes and applies compensation to assigned motors', async () => {
    const moves = [], applied = [];
    const state = { a_n_step__backlash: [0, 0, 0], b_connected__esp: true };
    const c = await component('backlash', {
        o_state: state,
        f_n_motor__axis: axis => ({ x: 2, y: 0, z: 1 })[axis],
        f_send_esp_move_step: async (motor, steps) => moves.push([motor, steps]),
        f_send_esp_set_backlash: (motor, steps) => applied.push([motor, steps]),
        f_save_setting__debounced() {}, setTimeout() {},
    });
    const ctx = Object.assign(c.data(), c.methods, { b_result: true, n_step__result: 25 });
    for(const axis of ['x', 'y', 'z']) {
        ctx.o_config.s_axis = axis;
        ctx.f_on_axis_change();
        assert.equal(ctx.o_config.s_signal, axis === 'z' ? 'sharpness' : 'shift');
        await ctx.f_move(10);
        ctx.f_apply();
    }
    assert.deepEqual(moves, [[2, 10], [0, 10], [1, 10]]);
    assert.deepEqual(applied, [[2, 25], [0, 25], [1, 25]]);
});
Deno.test('backlash migrates saved physical motor to axis and blocks unassigned axes', async () => {
    const state = { a_o_setting: [{ s_key: 'o_config__backlash', s_value: JSON.stringify({ s_motor: '1', s_signal: 'shift', n_step__probe: 8 }) }], b_connected__esp: true, b_streaming__webcam: true };
    let assigned = true;
    const c = await component('backlash', { o_state: state, f_n_motor__axis: axis => assigned ? ({ x: 2, y: 0, z: 1 })[axis] : null });
    const ctx = Object.assign(c.data(), c.methods);
    ctx.f_load_config();
    assert.equal(ctx.o_config.s_axis, 'z');
    assert.equal(ctx.o_config.s_signal, 'sharpness');
    assert.equal(ctx.o_config.n_step__probe, 8);
    assert.equal('s_motor' in ctx.o_config, false);
    assert.equal(c.computed.b_ready.call(ctx), true);
    assigned = false;
    assert.equal(c.computed.b_ready.call(ctx), false);
    await ctx.f_move(10);
});

Deno.test('motor-card calibration drives its physical motor even when axes are remapped or unassigned', async () => {
    const moves = [], applied = [], saved = [], stopped = [];
    const state = { o_motor__axis: { x: 2, y: 0, z: null }, a_n_step__backlash: [0, 0, 0], a_o_motor: [], b_connected__esp: true, b_streaming__webcam: true };
    const c = await component('backlash', {
        o_state: state, f_n_motor__axis: axis => state.o_motor__axis[axis] ?? null,
        f_send_esp_move_step: async (motor, steps) => moves.push([motor, steps]),
        f_send_esp_set_backlash: (motor, steps) => applied.push([motor, steps]),
        f_send_esp_stop: motor => stopped.push(motor),
        f_save_setting__debounced: (key, value) => saved.push([key, { ...value }]), setTimeout() {},
    });
    for(const n_motor of [0, 1, 2]) {
        const ctx = Object.assign(c.data(), c.methods, { n_motor, b_result: true, n_step__result: 23 });
        ctx.f_sync_axis();
        assert.equal(c.computed.b_ready.call(ctx), true);
        await ctx.f_move(10); ctx.f_apply(); ctx.f_save_config(); ctx.f_stop();
        assert.ok(saved.some(([key]) => key === 'o_config__backlash_motor_' + n_motor));
        await ctx.f_move(10); // No further movement after Stop.
    }
    assert.deepEqual(moves, [[0, 10], [1, 10], [2, 10]]);
    assert.deepEqual(applied, [[0, 23], [1, 23], [2, 23]]);
    assert.deepEqual(stopped, [0, 1, 2]);
});
Deno.test('motor-card calibration uses focus signal for Z and blocks overlapping operations', async () => {
    const state = { o_motor__axis: { x: 2, y: 0, z: 1 }, a_o_setting: [{ s_key: 'o_config__backlash_motor_1', s_value: JSON.stringify({ s_axis: 'z', s_signal: 'sharpness', n_step__probe: 9 }) }], a_o_motor: [{ b_running: false }], b_connected__esp: true, b_streaming__webcam: true };
    const c = await component('backlash', { o_state: state, f_n_motor__axis: axis => state.o_motor__axis[axis], f_save_setting__debounced() {} });
    const ctx = Object.assign(c.data(), c.methods, { n_motor: 1 });
    ctx.f_load_config(); ctx.f_sync_axis();
    assert.equal(ctx.o_config.s_signal, 'sharpness');
    assert.equal(ctx.o_config.n_step__probe, 9);
    assert.equal(c.computed.b_ready.call(ctx), true);
    for(const key of ['b_scanning', 'b_flashing']) {
        state[key] = true; assert.equal(c.computed.b_ready.call(ctx), false); state[key] = false;
    }
    ctx.b_busy = true; assert.equal(c.computed.b_ready.call(ctx), false); ctx.b_busy = false;
    state.a_o_motor[0].b_running = true; assert.equal(c.computed.b_ready.call(ctx), false);
});
Deno.test('stopping motor-card calibration restores compensation and releases the busy state', async () => {
    const commands = [];
    let finish;
    const round = new Promise(resolve => { finish = resolve; });
    const state = { b_scanning: false, a_n_step__backlash: [0, 0, 37] };
    const c = await component('backlash', {
        o_state: state, f_n_motor__axis: () => 0,
        f_send_esp_set_backlash: (motor, value) => commands.push(['backlash', motor, value]),
        f_send_esp_stop: motor => commands.push(['stop', motor]),
    });
    const ctx = Object.assign(c.data(), c.methods, { n_motor: 2, b_ready: true, f_o_round: () => round });
    const run = ctx.f_run();
    assert.equal(state.b_scanning, true);
    assert.equal(ctx.b_running, true);
    ctx.f_stop(); finish(null); await run;
    assert.deepEqual(commands, [['backlash', 2, 0], ['stop', 2], ['backlash', 2, 37]]);
    assert.equal(state.b_scanning, false);
    assert.equal(ctx.b_running, false);
    assert.equal(ctx.s_status, 'stopped');
});

Deno.test('axis reversal persists paired manual directions without changing assignments', async () => {
    const state = { o_motor__axis: { x: 2, y: 0, z: 1 } };
    const saved = {};
    const setup = await component('setup', {
        o_state: state, f_save_setting: (key, value) => saved[key] = JSON.stringify(value),
    });
    const ctx = { ...setup.methods, b_hardware_busy: false };
    for(const [axis, motor, keys] of [['x', 2, ['a', 'd']], ['y', 0, ['s', 'w']], ['z', 1, ['q', 'e']]]) {
        ctx.f_reverse_direction(motor, true);
        assert.equal(ctx.f_b_direction_reversed(motor), true);
        assert.equal(state['o_mapping__' + keys[0]].s_dir, 'cw');
        assert.equal(state['o_mapping__' + keys[1]].s_dir, 'ccw');
        for(const key of keys) assert.equal(state['o_mapping__' + key].s_motor, String(motor));
        // Reconstruct the settings as the application's JSON settings loader does.
        for(const key of Object.keys(saved)) state[key] = JSON.parse(saved[key]);
        assert.equal(ctx.f_b_direction_reversed(motor), true);
        if(axis === 'z') assert.equal(state.o_mapping__mouse_right.s_dir, 'ccw');
        ctx.f_reverse_direction(motor, false);
        assert.equal(state['o_mapping__' + keys[0]].s_dir, 'ccw');
        assert.equal(state['o_mapping__' + keys[1]].s_dir, 'cw');
        assert.equal(ctx.f_b_direction_reversed(motor), false);
    }
    assert.deepEqual(state.o_motor__axis, { x: 2, y: 0, z: 1 });
    assert.equal(state.o_mapping__mouse_right.s_dir, 'cw');
    const before = JSON.stringify(state);
    ctx.b_hardware_busy = true;
    ctx.f_reverse_direction(2, true);
    ctx.b_hardware_busy = false;
    ctx.f_reverse_direction(3, true);
    assert.equal(JSON.stringify(state), before);
});

Deno.test('reversed directions reach keyboard, mouse and gamepad motor commands', async () => {
    const state = {
        o_motor__axis: { x: 2, y: 0, z: 1 }, b_connected__esp: true,
        n_rpm__jog: 5, o_key_held: {}, n_index__gamepad: 0, b_enabled__gamepad: true,
    };
    const commands = [];
    const pad = { index: 0, id: 'test', connected: true, axes: [0, 0, 0, 0], buttons: [] };
    const setup = await component('setup', { o_state: state, f_save_setting() {} });
    const settings = { ...setup.methods, b_hardware_busy: false };
    const c = await component('jog', {
        o_state: state, f_n_motor__axis: axis => state.o_motor__axis[axis],
        f_send_esp_run_continuous: (motor, rpm, direction) => commands.push([motor, direction]),
        f_send_esp_stop() {}, navigator: { getGamepads: () => [pad] },
        document: { hidden: false, hasFocus: () => true },
    });
    const jog = Object.assign(c.data(), c.methods, { b_driving__mouse: false, b_driving__mouse_z: false });
    Object.defineProperty(jog, 's_dir__mouse_z', { get: () => c.computed.s_dir__mouse_z.call(jog) });
    for(const reversed of [false, true]) {
        for(const motor of [0, 1, 2]) settings.f_reverse_direction(motor, reversed);
        const flip = dir => reversed ? (dir === 'cw' ? 'ccw' : 'cw') : dir;
        commands.length = 0;
        for(const key of ['a', 'd', 'w', 's', 'q', 'e']) {
            jog.f_on_keydown({ key }); jog.f_on_keyup({ key });
        }
        assert.deepEqual(commands, [[2, flip('ccw')], [2, flip('cw')], [0, flip('cw')], [0, flip('ccw')], [1, flip('ccw')], [1, flip('cw')]]);
        for(const axis of ['x', 'y', 'z']) jog.f_stop_mouse_axis(axis);
        commands.length = 0;
        for(const axis of ['x', 'y', 'z']) for(const value of [-1, 1]) {
            jog.n_y_nor__mouse = value;
            jog.f_drive_mouse_axis(axis, value);
        }
        assert.deepEqual(commands, [[2, flip('ccw')], [2, flip('cw')], [0, flip('cw')], [0, flip('ccw')], [1, flip('cw')], [1, flip('ccw')]]);
        commands.length = 0;
        pad.axes = [0, 0, 0, 0]; jog.f_poll_gamepad();
        pad.axes = [0, -1, -1, -1]; jog.f_poll_gamepad();
        pad.axes = [0, 1, 1, 1]; jog.f_poll_gamepad();
        assert.deepEqual(commands, [[2, flip('ccw')], [0, flip('cw')], [1, flip('ccw')], [2, flip('cw')], [0, flip('ccw')], [1, flip('cw')]]);
    }
});

Deno.test('manual XY and Z speeds follow assignments for keyboard, mouse and motor tests', async () => {
    const state = { o_motor__axis: { x: 2, y: 0, z: 1 }, n_rpm__jog: 8, n_rpm__focus_jog: 0.4, b_connected__esp: true, o_key_held: {} };
    for(const key of ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']) state['o_mapping__' + key] = { s_dir: 'cw' };
    const moves = [];
    const c = await component('jog', {
        o_state: state, f_n_motor__axis: axis => state.o_motor__axis[axis],
        f_send_esp_run_continuous: (motor, rpm) => moves.push([motor, rpm]), f_send_esp_stop() {},
    });
    const jog = Object.assign(c.data(), c.methods, { s_dir__mouse_z: 'cw' });
    jog.f_on_keydown({ key: 'd' }); jog.f_on_keydown({ key: 'e' });
    assert.deepEqual(moves, [[2, 8], [1, 0.4]]);
    moves.length = 0;
    state.n_rpm__focus_jog = 0.8;
    c.watch['o_state.n_rpm__focus_jog'].call(jog);
    assert.deepEqual(moves, [[1, 0.8]]);
    moves.length = 0;
    state.n_rpm__jog = 6;
    c.watch['o_state.n_rpm__jog'].call(jog);
    assert.deepEqual(moves, [[2, 6]]);
    moves.length = 0;
    jog.f_drive_mouse_axis('x', 0.5); jog.f_drive_mouse_axis('z', 0.5);
    assert.deepEqual(moves, [[2, 3], [1, 0.4]]);
    state.n_rpm__focus_jog = 0.85;
    jog.f_drive_mouse_axis('z', 0.5);
    assert.deepEqual(moves.at(-1), [1, 0.425]);
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
    assert.equal(jog.f_get_mapping('e').rpm, 0.8);
    assert.equal(jog.f_get_mapping('e').motor, 2);
});
