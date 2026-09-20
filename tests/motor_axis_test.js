import assert from 'node:assert/strict';

async function component(name, bindings) {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__' + name + '.js', import.meta.url)))
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '')
        .replace(/export \{[^}]+\};?/, '');
    return new Function(...Object.keys(bindings), source + '\nreturn o_component__' + name)(...Object.values(bindings));
}

Deno.test('axis assignment swaps motors, persists mappings and preserves directions', async () => {
    const state = { o_motor__axis: { x: 0, y: 1, z: 2 } };
    for (const key of ['a', 'd', 'w', 's', 'q', 'e', 'mouse_right']) {
        state['o_mapping__' + key] = { s_motor: '0', s_dir: key === 'a' ? 'ccw' : 'cw' };
    }
    const saved = {};
    let stopped = false;
    const jog = await component('jog', {
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
