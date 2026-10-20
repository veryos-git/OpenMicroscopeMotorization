import { f_reset_control, f_reset_title } from '../webserved_dir/control_catalog.module.js';
import assert from 'node:assert/strict';
import { f_n_rpm__manual } from '../webserved_dir/manual_speed.module.js';
import { o_component__icon } from '../webserved_dir/o_component__icon.js';

async function component(name, bindings) {
    bindings = { f_reset_control, f_reset_title, o_component__icon, ...bindings };
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__' + name + '.js', import.meta.url)))
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '')
        .replace(/export \{[^}]+\};?/, '');
    return new Function(...Object.keys(bindings), source + '\nreturn o_component__' + name)(...Object.values(bindings));
}

Deno.test('quick calibration halves rounds, coarsens probes and preserves saved settings', async () => {
    const state = { a_n_step__backlash: [12], o_calibration: { a_n_ts_ms__backlash: [0] } };
    const c = await component('backlash', { o_state: state, f_send_esp_set_backlash() {}, f_save_calibration() {} });
    const rounds = [];
    const ctx = Object.assign(c.data(), c.methods, {
        b_ready: true, f_n_motor: () => 0,
        f_o_round: async (sign, config) => {
            rounds.push([sign, structuredClone(config)]);
            return { o_fit: { b_valid: true } };
        },
        f_apply() {}, f_save_scale() {},
    });
    const saved = structuredClone(ctx.o_config);
    assert.equal(await ctx.f_run({ b_quick: true }), true);
    assert.deepEqual(rounds.map(([sign]) => sign), [1, -1]);
    assert.equal(rounds[0][1].n_step__probe, 10);
    assert.equal(rounds[0][1].n_ms__settle, 350);
    assert.deepEqual(ctx.o_config, saved);
    rounds.length = 0;
    await ctx.f_run();
    assert.deepEqual(rounds.map(([sign]) => sign), [1, -1, 1, -1]);
    assert.equal(rounds[0][1].n_step__probe, 5);
});

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

async function focusFixture(scores) {
    const state = { b_connected__esp: true, b_streaming__webcam: true, a_n_step__backlash: [0, 37, 0], o_motor__axis: { x: 0, y: 2, z: 1 } };
    const commands = [], saved = [];
    const c = await component('backlash', {
        o_state: state,
        f_send_esp_set_backlash: (...args) => commands.push(['backlash', ...args]),
        f_save_setting__debounced: (...args) => saved.push(structuredClone(args)),
    });
    let frame = 0;
    const ctx = Object.assign(c.data(), c.methods, {
        n_motor: 1, b_ready: true, f_delay: async () => {},
        f_move: async steps => commands.push(['move', steps]),
        f_o_frame: () => ({ n_score: scores[frame++], n_time: frame }),
        f_o_round: async () => { commands.push(['round']); return { o_fit: { b_valid: false } }; },
    });
    ctx.o_config.s_axis = 'z'; ctx.o_config.s_signal = 'sharpness';
    return { ctx, state, commands, saved };
}

Deno.test('coarse focus probe aborts absent or noisy response and restores compensation', async () => {
    for(const scores of [Array(10).fill(100), [95, 105, 100, 102, 98, 105, 120, 110, 115, 100], Array(10).fill(0)]) {
        const { ctx, state, commands, saved } = await focusFixture(scores);
        assert.equal(await ctx.f_run({ b_quick: true }), false);
        assert.equal(state.o_focus__probe.s_status, 'no_response');
        assert.equal(state.o_focus__probe.n_motor, 1);
        assert.equal(saved[0][0], 'o_focus__probe');
        assert.deepEqual(commands, [['backlash', 1, 0], ['move', 500], ['move', -500], ['backlash', 1, 37]]);
        assert.match(ctx.s_status, /No focus response after 500 steps/);
        assert.equal(ctx.b_running, false); assert.equal(state.b_scanning, false);
    }
});

Deno.test('responsive focus continues into backlash calibration and can recover a failed probe', async () => {
    for (const b_quick of [true, false]) {
        const { ctx, state, commands } = await focusFixture([]);
        let position = 0, frame = 0;
        ctx.f_move = async steps => { position += steps; commands.push(['move', steps]); };
        // Simulate a drive whose first 100 steps do not visibly change focus.
        ctx.f_o_frame = () => ({ n_score: position > 100 ? 120 : 100, n_time: ++frame });
        state.o_focus__probe = { n_motor: 1, s_status: 'no_response' };
        await ctx.f_run({ b_quick });
        assert.equal(state.o_focus__probe.s_status, 'responsive');
        assert.deepEqual(commands.filter(c => c[0] === 'move'), [['move', 500], ['move', -500]]);
        assert.equal(position, 0, 'return the commanded probe displacement before measuring backlash');
        assert.equal(commands.filter(c => c[0] === 'round').length, b_quick ? 2 : 4);
    }
});

Deno.test('cancelled or failed focus probes do not classify hardware', async () => {
    for(const failure of ['stop', 'camera', 'timeout', 'frozen']) {
        const { ctx, state } = await focusFixture(Array(10).fill(100));
        if(failure === 'stop') ctx.f_move = async () => { ctx.b_stop_requested = true; };
        if(failure === 'camera') ctx.f_o_frame = () => null;
        if(failure === 'timeout') ctx.f_move = async () => { throw new Error('motor move timed out'); };
        if(failure === 'frozen') ctx.f_o_frame = () => ({ n_score: 100, n_time: 0 });
        await ctx.f_run();
        assert.equal(state.o_focus__probe, undefined);
        assert.equal(ctx.b_running, false); assert.equal(state.b_scanning, false);
        assert.match(ctx.s_status, failure === 'stop' ? /stopped/ : /failed/);
    }
});

Deno.test('hardware overview distinguishes assignments, probe results and live connections', async () => {
    const state = { o_motor__axis: { x: 2, y: 0, z: 1 }, b_connected__esp: true, b_streaming__webcam: true };
    const c = await component('toolbar', { o_state: state });
    const values = () => c.computed.a_o_hardware().map(o => o.s_value);
    assert.deepEqual(values(), ['live', 'M3', 'M1', 'untested']);
    state.o_focus__probe = { n_motor: 1, s_status: 'no_response', n_ts_ms: 1 };
    assert.equal(values()[3], 'no response');
    state.b_connected__esp = false; assert.equal(values()[3], 'offline');
    state.b_connected__esp = true; state.o_motor__axis.z = 2; assert.equal(values()[3], 'untested');
    state.o_motor__axis.z = null; assert.equal(values()[3], 'manual');
});

Deno.test('unresponsive focus blocks shared automatic Z routing while calibration remains available', async () => {
    const source = await Deno.readTextFile(new URL('../webserved_dir/index.js', import.meta.url));
    const resolver = source.match(/let f_n_motor__axis = [\s\S]*?\n};/)[0];
    const state = { o_motor__axis: { x: 0, y: 2, z: 1 }, o_focus__probe: { n_motor: 1, s_status: 'no_response' } };
    const resolve = new Function('o_state', resolver + '\nreturn f_n_motor__axis;')(state);
    assert.equal(resolve('z'), null); assert.equal(resolve('z', true), 1);
    assert.equal(resolve('x'), 0); assert.equal(resolve('y'), 2);
    state.o_focus__probe.s_status = 'responsive'; assert.equal(resolve('z'), 1);
    state.o_motor__axis.z = null; assert.equal(resolve('z', true), null);
});

for(const s_input of ['keyboard', 'mouse', 'gamepad']) {
    Deno.test('manual focus sends ESP32 start and stop after a failed probe via ' + s_input, async () => {
        const { ctx, state } = await focusFixture(Array(10).fill(100));
        await ctx.f_run({ b_quick: true });
        assert.equal(state.o_focus__probe.s_status, 'no_response');
        const o_probe = structuredClone(state.o_focus__probe);
        Object.assign(state, {
            n_rpm__focus_jog: 0.5, o_key_held: {},
            o_mapping__q: { s_dir: 'cw' }, o_mapping__e: { s_dir: 'ccw' },
            o_mapping__mouse_right: { s_dir: 'cw' },
            n_index__gamepad: -1, b_enabled__gamepad: true,
        });
        // Use the production resolver and command helpers through a fake socket;
        // a resolver stub would hide the calibration lockout this test covers.
        const s_source = await Deno.readTextFile(new URL('../webserved_dir/index.js', import.meta.url));
        const a_s_function = ['f_n_motor__axis', 'f_send_esp', 'f_send_esp_run_continuous', 'f_send_esp_stop'];
        const a_s_message = [];
        const o_command = new Function('o_state', 'o_ws__esp', 'WebSocket',
            a_s_function.map(s_name => s_source.match(new RegExp('let ' + s_name + ' = [\\s\\S]*?\\n};'))[0]).join('\n')
            + '\nreturn { ' + a_s_function.join(', ') + ' };'
        )(state, { readyState: 1, send: s_message => a_s_message.push(JSON.parse(s_message)) }, { OPEN: 1 });
        const o_pad = { index: 0, id: 'test', connected: true, axes: [0, 0, 0, 0], buttons: [] };
        const o_component = await component('jog', {
            o_state: state, f_n_rpm__manual, ...o_command,
            navigator: { getGamepads: () => [o_pad] },
            document: { hidden: false, hasFocus: () => true },
        });
        const o_jog = Object.assign(o_component.data(), o_component.methods, {
            b_driving__mouse: false, b_driving__mouse_z: false, s_dir__mouse_z: 'cw',
        });
        const f_input = b_start => {
            if(s_input === 'keyboard') {
                o_jog[b_start ? 'f_on_keydown' : 'f_on_keyup']({ key: 'q' });
            } else if(s_input === 'mouse') {
                o_jog.b_driving__mouse_z = b_start;
                o_jog.n_y_nor__mouse = -1;
                o_jog.f_tick_mouse_jog();
            } else {
                o_pad.axes[1] = 0;
                o_jog.f_poll_gamepad();
                if(b_start) {
                    o_pad.axes[1] = -1;
                    o_jog.f_poll_gamepad();
                }
            }
        };
        state.b_scanning = true;
        f_input(true);
        f_input(false);
        assert.deepEqual(a_s_message, [], 'manual inputs still wait for calibration to finish');
        state.b_scanning = false;
        f_input(true);
        assert.deepEqual(a_s_message, [{ motor: 1, command: 'runContinuous', n_rpm: 0.5, direction: 'cw' }]);
        f_input(false);
        assert.deepEqual(a_s_message.at(-1), { motor: 1, command: 'stop' });
        assert.deepEqual(state.o_focus__probe, o_probe, 'manual motion must preserve the probe result');
        assert.equal(o_command.f_n_motor__axis('z'), null, 'automatic focus still requires a responsive probe');
        a_s_message.length = 0;
        state.o_motor__axis.z = null;
        f_input(true);
        f_input(false);
        assert.deepEqual(a_s_message, [], 'an unassigned Z axis must not send commands');
    });
}
