import assert from 'node:assert/strict';
import { f_o_motion_config, f_o_motion_detector, f_o_motion_view } from '../webserved_dir/motion_detection.module.js';

let f_frame = function(n_x = null, n_value = 180, n_background = 20) {
    let a = new Uint8Array(80 * 60).fill(n_background);
    if (n_x !== null) for (let y = 20; y < 28; y++) for (let x = n_x; x < n_x + 6; x++) a[y * 80 + x] = n_value;
    return a;
};
let f_fixture = function(o = {}, n_scale = 1) {
    let o_detector = f_o_motion_detector();
    let o_config = f_o_motion_config({ n_area__min: 1, n_area__max: 100000, n_movement__min: 0, ...o });
    return { o_detector, f_detect: a => o_detector.f_detect(a, 80, 60, 80 * n_scale, 60 * n_scale, o_config) };
};

Deno.test('motion: reference, static image, isolated noise and uniform lighting changes', () => {
    let { f_detect } = f_fixture();
    assert.match(f_detect(f_frame()).s_status, /reference/);
    assert.equal(f_detect(f_frame()).a_o_region.length, 0);
    let a = f_frame(); a[20] = 200;
    assert.equal(f_detect(a).a_o_region.length, 0);
    f_detect(f_frame());
    assert.equal(f_detect(f_frame(null, 180, 90)).a_o_region.length, 0);
});

Deno.test('motion: detects moving regions, applies size limits in source camera pixels', () => {
    let { f_detect } = f_fixture({}, 4);
    f_detect(f_frame(10));
    let o = f_detect(f_frame(14)).a_o_region[0];
    assert.ok(o);
    assert.equal(o.n_x, 40);
    assert.equal(o.n_y, 80);
    assert.equal(o.n_area, 10 * 8 * 16);
    for (let o_limit of [{ n_area__min: 2000 }, { n_area__max: 1000 }]) {
        let f = f_fixture(o_limit, 4).f_detect;
        f(f_frame(10));
        assert.equal(f(f_frame(14)).a_o_region.length, 0);
    }
});

Deno.test('motion: high sensitivity detects subtle changes that low ignores', () => {
    for (let [s_sensitivity, b_detect] of [['high', true], ['low', false]]) {
        let { f_detect } = f_fixture({ s_sensitivity });
        f_detect(f_frame());
        assert.equal(f_detect(f_frame(10, 40)).a_o_region.length > 0, b_detect);
    }
});

Deno.test('motion: minimum movement requires a matched region and uses source pixels', () => {
    for (let [n_movement__min, b_detect] of [[7, true], [9, false]]) {
        let { f_detect } = f_fixture({ n_movement__min }, 2);
        f_detect(f_frame(10));
        assert.equal(f_detect(f_frame(14)).a_o_region.length, 0);
        let a = f_detect(f_frame(18)).a_o_region;
        assert.equal(a.length > 0, b_detect);
        if (b_detect) assert.equal(a[0].n_movement, 8);
        assert.equal(f_detect(f_frame(18)).a_o_region.length, 0);
    }
});

Deno.test('motion: widespread changes, reset and resolution changes discard old regions', () => {
    let { f_detect, o_detector } = f_fixture();
    f_detect(f_frame());
    let a = f_frame();
    for (let n = 0; n < a.length / 2; n++) a[n] = 220;
    assert.match(f_detect(a).s_status, /Widespread/);
    o_detector.f_reset();
    assert.match(f_detect(f_frame(10)).s_status, /reference/);
    assert.match(o_detector.f_detect(new Uint8Array(40 * 30), 40, 30, 640, 480, f_o_motion_config()).s_status, /reference/);
});

Deno.test('motion: invalid saved configuration is normalized and view fits letterboxed image', () => {
    let o = f_o_motion_config({ b_enabled: 'false', n_area__min: -3, n_area__max: NaN, n_movement__min: Infinity });
    assert.equal(o.b_enabled, false);
    assert.equal(o.n_area__min, 1);
    assert.equal(o.n_area__max, 250000);
    assert.equal(o.n_movement__min, 2);
    assert.equal(f_o_motion_config({ n_area__min: 500, n_area__max: 10 }).n_area__max, 500);
    assert.deepEqual(f_o_motion_view({ left: 10, top: 100, width: 800, height: 600 }, 1920, 1080),
        { n_x: 10, n_y: 175, n_scl_x: 800, n_scl_y: 450 });
});
