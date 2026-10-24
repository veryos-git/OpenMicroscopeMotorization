import assert from 'node:assert/strict';
import { f_o_profile, f_o_shift, f_o_shift__wide, f_o_fit__backlash, f_o_onset, f_o_stat } from '../webserved_dir/backlash_math.module.js';

// X / Y calibration on a simulated friction drive: backlash, a stage that sticks
// and then jumps one look after the motor stopped, and real image profiles.

async function component(name, bindings) {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__' + name + '.js', import.meta.url)))
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '')
        .replace(/export \{[^}]+\};?/, '');
    return new Function(...Object.keys(bindings), source + '\nreturn o_component__' + name)(...Object.values(bindings));
}

const N_SCL_X = 400, N_SCL_Y = 225, N_ROWS = 3000, N_ROW__START = 1400;
// measured px per motor step: 0.0449 st/px at 4K, as on the real X axis
const N_PX__PER_STEP = 1 / (0.0449 * 9.6);

let f_n_rng = function(n_seed) {
    return function() {
        n_seed = (n_seed + 0x6d2b79f5) | 0;
        let n = Math.imul(n_seed ^ (n_seed >>> 15), 1 | n_seed);
        n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
};
let f_n_rng__noise = f_n_rng(7);

// smooth random texture, taller than the frame so the stage can travel
let a_n_texture = (function() {
    let f_n = f_n_rng(1);
    let a_n = Float64Array.from({ length: N_SCL_X * N_ROWS }, () => f_n() * 255);
    let a_n__blur = new Float64Array(a_n.length);
    for (let n_y = 0; n_y < N_ROWS; n_y++) for (let n_x = 0; n_x < N_SCL_X; n_x++) {
        let n_sum = 0, n_cnt = 0;
        for (let n_dy = -2; n_dy <= 2; n_dy++) for (let n_dx = -2; n_dx <= 2; n_dx++) {
            let n_yy = n_y + n_dy, n_xx = n_x + n_dx;
            if (n_yy < 0 || n_yy >= N_ROWS || n_xx < 0 || n_xx >= N_SCL_X) continue;
            n_sum += a_n[n_yy * N_SCL_X + n_xx]; n_cnt++;
        }
        a_n__blur[n_y * N_SCL_X + n_x] = n_sum / n_cnt;
    }
    return a_n__blur;
})();

let f_o_frame__at = function(n_px_y, b_featureless) {
    let a_n_luma = new Float64Array(N_SCL_X * N_SCL_Y);
    let n_row = N_ROW__START + n_px_y, n_row__floor = Math.floor(n_row), n_frac = n_row - n_row__floor;
    for (let n_y = 0; n_y < N_SCL_Y; n_y++) for (let n_x = 0; n_x < N_SCL_X; n_x++) {
        let n_noise = (f_n_rng__noise() - 0.5) * 4;
        a_n_luma[n_y * N_SCL_X + n_x] = b_featureless ? 128 + n_noise * 10
            : a_n_texture[(n_row__floor + n_y) * N_SCL_X + n_x] * (1 - n_frac)
              + a_n_texture[(n_row__floor + n_y + 1) * N_SCL_X + n_x] * n_frac + n_noise;
    }
    return f_o_profile(a_n_luma, N_SCL_X, N_SCL_Y);
};

// motor -> carriage through a dead band; the stage sticks until the carriage is
// n_step__stick ahead, then jumps there, visible from the second look on
let f_o_stage = function({ n_step__backlash = 40, n_step__stick = 15, n_px__per_step__pos = N_PX__PER_STEP, n_px__per_step__neg = N_PX__PER_STEP } = {}) {
    let o = { n_motor: 0, n_carriage: 0, n_stage: 0, n_px: 0, n_target: null, n_look__wait: 0 };
    o.f_move = function(n_step) {
        o.n_motor += n_step;
        if (o.n_motor > o.n_carriage + n_step__backlash) o.n_carriage = o.n_motor - n_step__backlash;
        if (o.n_motor < o.n_carriage) o.n_carriage = o.n_motor;
        if (Math.abs(o.n_carriage - o.n_stage) >= n_step__stick) { o.n_target = o.n_carriage; o.n_look__wait = 1; }
    };
    o.f_n_px = function() {
        if (o.n_target !== null && o.n_look__wait-- <= 0) {
            let n_step = o.n_target - o.n_stage;
            o.n_px += n_step * (n_step > 0 ? n_px__per_step__pos : n_px__per_step__neg);
            o.n_stage = o.n_target; o.n_target = null;
        }
        return o.n_px;
    };
    return o;
};

let f_o_calibration = async function(o_stage, { b_featureless = false } = {}) {
    let o_state = { b_connected__esp: true, b_scanning: false, a_n_step__backlash: [12], a_n_step__per_px: [17.21], o_calibration: { a_n_ts_ms__backlash: [0] } };
    let a_o_sent = [];
    let c = await component('backlash', {
        o_state, f_o_profile, f_o_shift, f_o_shift__wide, f_o_fit__backlash, f_o_onset, f_o_stat,
        f_n_score: () => 0, f_o_camera_geometry: () => ({ n_scl_x: 3840 }), f_el_camera_frame: () => null,
        f_n_motor__axis: () => 0,
        f_send_esp_move_step: async (n_motor, n_step) => { o_stage.f_move(n_step); },
        f_send_esp_stop: n_motor => a_o_sent.push(['stop', n_motor]),
        f_send_esp_set_backlash: (n_motor, n_step) => a_o_sent.push(['backlash', n_motor, n_step]),
        f_save_setting__debounced() {}, f_save_calibration() {},
        setTimeout: () => 0, clearTimeout() {},
    });
    let n_time = 0;
    let ctx = Object.assign(c.data(), c.methods, {
        n_motor: 0, b_ready: true,
        f_delay: async () => {},
        f_n_scl__measure_to_full: () => 3840 / N_SCL_X,
        f_o_frame: () => ({ n_time: ++n_time, n_score: 0, o_profile: f_o_frame__at(o_stage.f_n_px(), b_featureless) }),
    });
    for (let s_name of Object.keys(c.computed).filter(s => s !== 'b_ready')) {
        Object.defineProperty(ctx, s_name, { get: () => c.computed[s_name].call(ctx) });
    }
    let b_applied = await ctx.f_run({ b_quick: true });
    return { ctx, o_state, a_o_sent, b_applied };
};

Deno.test('travel calibration measures scale and backlash on a stage that sticks and jumps', async () => {
    let { ctx, o_state, b_applied } = await f_o_calibration(f_o_stage());
    assert.equal(b_applied, true, ctx.s_status);
    let n_step__per_px = o_state.a_n_step__per_px[0];
    assert.ok(Math.abs(n_step__per_px / 0.0449 - 1) < 0.15, `scale ${n_step__per_px} should be near 0.0449`);
    // the stage first moves once the dead band and the stick are taken up
    assert.ok(o_state.a_n_step__backlash[0] >= 30 && o_state.a_n_step__backlash[0] <= 70, `backlash ${o_state.a_n_step__backlash[0]}`);
    assert.match(ctx.s_status, /^done — 0\.04\d+ st\/px, backlash \d+ steps$/);
    assert.ok(ctx.a_o_round.every(o => o.n_px__travel >= 150), 'each direction travels a good part of the frame');
});

Deno.test('travel calibration also works on a smooth drive', async () => {
    let { o_state, b_applied } = await f_o_calibration(f_o_stage({ n_step__stick: 1 }));
    assert.equal(b_applied, true);
    assert.ok(Math.abs(o_state.a_n_step__per_px[0] / 0.0449 - 1) < 0.1);
    assert.ok(Math.abs(o_state.a_n_step__backlash[0] - 40) <= 10, `backlash ${o_state.a_n_step__backlash[0]}`);
});

for (let [s_case, o_stage, o_option, s_status] of [
    ['a drive that does not move the image', { n_px__per_step__pos: 0, n_px__per_step__neg: 0 }, {}, /did not move/],
    ['a view without detail', {}, { b_featureless: true }, /not enough detail/],
    ['directions that disagree', { n_px__per_step__neg: 2 * N_PX__PER_STEP }, {}, /moved unevenly/],
]) {
    Deno.test('travel calibration saves nothing for ' + s_case, async () => {
        let { ctx, o_state, a_o_sent, b_applied } = await f_o_calibration(f_o_stage(o_stage), o_option);
        assert.equal(b_applied, false);
        assert.match(ctx.s_status, s_status);
        assert.equal(o_state.a_n_step__per_px[0], 17.21, 'old scale kept');
        assert.equal(o_state.a_n_step__backlash[0], 12, 'old backlash kept');
        assert.deepEqual(a_o_sent.filter(o => o[0] === 'backlash').at(-1), ['backlash', 0, 12], 'firmware compensation restored');
    });
}
