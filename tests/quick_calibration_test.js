import assert from 'node:assert/strict';

async function component(name, bindings) {
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
        assert.deepEqual(commands, [['backlash', 1, 0], ['move', 100], ['move', -100], ['backlash', 1, 37]]);
        assert.match(ctx.s_status, /No focus response/);
        assert.equal(ctx.b_running, false); assert.equal(state.b_scanning, false);
    }
});

Deno.test('responsive focus continues into backlash calibration and can recover a failed probe', async () => {
    const { ctx, state, commands } = await focusFixture([...Array(5).fill(100), ...Array(5).fill(120)]);
    state.o_focus__probe = { n_motor: 1, s_status: 'no_response' };
    await ctx.f_run({ b_quick: true });
    assert.equal(state.o_focus__probe.s_status, 'responsive');
    assert.deepEqual(commands.filter(c => c[0] === 'round'), [['round'], ['round']]);
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
