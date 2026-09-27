import { f_n_rpm__manual } from '../webserved_dir/manual_speed.module.js';
import { f_o_action_system } from '../webserved_dir/actions.module.js';
import assert from 'node:assert/strict';

async function fixture() {
    const state = {
        n_index__gamepad: -1, b_enabled__gamepad: true, b_armed__gamepad: false,
        b_connected__esp: true, n_rpm__jog: 5, n_rpm__focus_jog: 5, o_key_held: {},
    };
    for(const key of ['a', 'd', 'w', 's', 'q', 'e']) state['o_mapping__' + key] = { s_dir: ['a', 's', 'e'].includes(key) ? 'ccw' : 'cw' };
    const pad = { index: 0, id: 'PlayStation', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [] };
    const navigator = { getGamepads: () => [pad] };
    const document = { hidden: false, hasFocus: () => true };
    const commands = [];
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__jog.js', import.meta.url)))
        .replace(/^import .*;$/gm, '').replace(/export \{[^}]+\};?/, '');
    const component = new Function('f_n_rpm__manual', 'o_state', 'navigator', 'document', 'f_n_motor__axis', 'f_send_esp_run_continuous', 'f_send_esp_stop', source + '\nreturn o_component__jog;')(
        f_n_rpm__manual, state, navigator, document, axis => ({ x: 2, y: 0, z: 1 })[axis],
        (motor, rpm, direction) => commands.push({ motor, rpm, direction }), motor => commands.push({ stop: motor }),
    );
    const jog = Object.assign(component.data(), component.methods, { b_driving__mouse: false, b_driving__mouse_z: false });
    const actions = f_o_action_system();
    state.o_action_axis = { x: 0, y: 0, z: 0 };
    for(const [axis, index] of [['x', 2], ['y', 3], ['z', 1]]) actions.f_register({ id: axis, type: 'analog', bindings: [{ source: 'axis', index }], invoke: value => state.o_action_axis[axis] = value });
    const poll = jog.f_poll_gamepad.bind(jog);
    jog.f_poll_gamepad = () => { actions.f_tick(new Set(), navigator.getGamepads().find(p => p.index === state.n_index__gamepad)); poll(); };
    jog.f_poll_gamepad();
    return { state, pad, navigator, document, commands, jog, actions };
}
Deno.test('right stick drives assigned XY motors proportionally; left vertical drives focus', async () => {
    const { pad, jog, commands } = await fixture();
    pad.axes = [1, -1, 0.5, -1];
    jog.f_poll_gamepad();
    assert.equal(commands.length, 3);
    assert.equal(commands[0].motor, 2);
    assert.ok(Math.abs(commands[0].rpm - 2.5) < 1e-9);
    assert.deepEqual(commands.slice(1), [{ motor: 0, rpm: 5, direction: 'cw' }, { motor: 1, rpm: 5, direction: 'cw' }]);
    commands.length = 0;
    pad.axes = [1, 0, 0, 0];
    jog.f_poll_gamepad();
    assert.deepEqual(commands, [{ stop: 2 }, { stop: 0 }, { stop: 1 }]);
});
Deno.test('stops inside the center dead zone', async () => {
    const { pad, jog, commands } = await fixture();
    pad.axes[2] = 1; jog.f_poll_gamepad(); commands.length = 0;
    pad.axes[2] = 0.15; jog.f_poll_gamepad();
    assert.deepEqual(commands, [{ stop: 2 }]);
});
for(const reason of ['disconnect', 'blur', 'hidden', 'disabled', 'scan', 'flash', 'transport', 'invalid_axes', 'selection']) {
    Deno.test('stops gamepad motion on ' + reason, async () => {
        const { pad, jog, commands, state, document, navigator } = await fixture();
        pad.axes[2] = 1; jog.f_poll_gamepad(); commands.length = 0;
        if(reason === 'disconnect') navigator.getGamepads = () => [];
        if(reason === 'blur') document.hasFocus = () => false;
        if(reason === 'hidden') document.hidden = true;
        if(reason === 'disabled') state.b_enabled__gamepad = false;
        if(reason === 'scan') state.b_scanning = true;
        if(reason === 'flash') state.b_flashing = true;
        if(reason === 'transport') state.b_connected__esp = false;
        if(reason === 'invalid_axes') pad.axes = [0, 0];
        if(reason === 'selection') state.n_index__gamepad = 4;
        jog.f_poll_gamepad();
        assert.deepEqual(commands, [{ stop: 2 }]);
        assert.equal(state.b_armed__gamepad, false);
    });
}
Deno.test('Stop requires centered sticks before motion can resume', async () => {
    const { pad, jog, commands, state } = await fixture();
    pad.axes[2] = 1; jog.f_poll_gamepad(); commands.length = 0;
    state.b_armed__gamepad = false; jog.f_poll_gamepad(); jog.f_poll_gamepad();
    assert.deepEqual(commands, [{ stop: 2 }]);
    pad.axes[2] = 0; jog.f_poll_gamepad(); assert.equal(state.b_armed__gamepad, true);
    pad.axes[2] = -1; jog.f_poll_gamepad();
    assert.deepEqual(commands.at(-1), { motor: 2, rpm: 5, direction: 'ccw' });
});
Deno.test('keyboard ownership prevents gamepad commands on its axis', async () => {
    const { pad, jog, commands, state } = await fixture();
    state.o_key_held.d = true; pad.axes[2] = 1; jog.f_poll_gamepad();
    assert.deepEqual(commands, []);
});

Deno.test('USB controller without standard mapping drives the same axes as the display', async () => {
    const { pad, jog, commands, state } = await fixture();
    pad.mapping = '';
    pad.axes = [0, -1, 1, -1];
    jog.f_poll_gamepad();
    assert.deepEqual(commands, [
        { motor: 2, rpm: 5, direction: 'cw' },
        { motor: 0, rpm: 5, direction: 'cw' },
        { motor: 1, rpm: 5, direction: 'cw' },
    ]);
    assert.match(state.s_status__gamepad, /X → motor 3/);
});
Deno.test('status explains focus and connection blocks', async () => {
    const { jog, state, document } = await fixture();
    document.hasFocus = () => false;
    jog.f_poll_gamepad();
    assert.match(state.s_status__gamepad, /Click in this window/);
    state.b_connected__esp = false;
    jog.f_poll_gamepad();
    assert.match(state.s_status__gamepad, /Connect the motors/);
});

Deno.test('held half stick continuously engages each motor at half maximum alongside idle mouse jog', async () => {
    for(const [axisIndex, motor] of [[2, 2], [3, 0], [1, 1]]) {
        const { pad, jog, commands, state } = await fixture();
        const speedKey = axisIndex === 1 ? 'n_rpm__focus_jog' : 'n_rpm__jog';
        state[speedKey] = 10;
        pad.axes[axisIndex] = 0.5;
        // Simulate five seconds with both input timers active. Firmware keeps the
        // continuous command active until a new speed or a stop is sent.
        for(let tick = 0; tick < 100; tick++) {
            jog.f_poll_gamepad();
            jog.f_tick_mouse_jog();
        }
        assert.equal(commands.length, 1);
        assert.equal(commands[0].motor, motor);
        assert.equal(commands[0].rpm, 5);
        state[speedKey] = 6;
        jog.f_poll_gamepad();
        assert.equal(commands.at(-1).rpm, 3);
        pad.axes[axisIndex] = -0.5;
        jog.f_poll_gamepad();
        assert.equal(commands.at(-1).rpm, 3);
        assert.notEqual(commands.at(-1).direction, commands[0].direction);
        pad.axes[axisIndex] = 0;
        jog.f_poll_gamepad();
        assert.deepEqual(commands.at(-1), { stop: motor });
    }
});
Deno.test('outside the dead zone uses the displayed value without rescaling', async () => {
    const { pad, jog, commands, state } = await fixture();
    state.n_rpm__jog = 10;
    for(const value of [0.16, 0.25, 0.5, 0.75, 1]) {
        pad.axes[2] = value;
        jog.f_poll_gamepad();
        assert.equal(commands.at(-1).rpm, value * 10);
    }
});

Deno.test('remapped trigger drives analog motion and clearing its binding stops the motor', async () => {
    const { pad, jog, commands, actions } = await fixture();
    actions.f_set('x', { ...actions.f_config('x'), bindings: [{ source: 'button', index: 7 }], sensitivity: 0.5 });
    pad.buttons = Array.from({ length: 8 }, (_, i) => ({ value: i === 7 ? 0.8 : 0 }));
    jog.f_poll_gamepad();
    assert.equal(commands.at(-1).rpm, 2);
    actions.f_set('x', { ...actions.f_config('x'), bindings: [] });
    jog.f_poll_gamepad();
    assert.deepEqual(commands.at(-1), { stop: 2 });
});
Deno.test('opening action search stops gamepad movement and requires neutral input to rearm', async () => {
    const { pad, jog, commands, state } = await fixture();
    pad.axes[2] = 1; jog.f_poll_gamepad();
    state.b_input_suspended = true; jog.f_poll_gamepad();
    assert.deepEqual(commands.at(-1), { stop: 2 });
    state.b_input_suspended = false; jog.f_poll_gamepad();
    assert.equal(state.b_armed__gamepad, false);
    pad.axes[2] = 0; jog.f_poll_gamepad();
    assert.equal(state.b_armed__gamepad, true);
});

Deno.test('XY and focus sticks use independent speeds and update independently while held', async () => {
    const { state, pad, jog, commands } = await fixture();
    state.n_rpm__jog = 10;
    state.n_rpm__focus_jog = 0.6;
    pad.axes = [0, 0.5, 0.5, 0.5];
    jog.f_poll_gamepad();
    assert.deepEqual(commands.map(c => [c.motor, c.rpm]), [[2, 5], [0, 5], [1, 0.3]]);
    commands.length = 0;
    state.n_rpm__focus_jog = 1;
    jog.f_poll_gamepad();
    assert.deepEqual(commands.map(c => [c.motor, c.rpm]), [[1, 0.5]]);
});
