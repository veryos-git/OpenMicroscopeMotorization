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
