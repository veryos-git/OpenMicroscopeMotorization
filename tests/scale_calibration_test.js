import assert from 'node:assert/strict';
import {
    f_o_size__default, f_o_size, f_n_um__known, f_n_px__distance, f_n_px__path, f_o_scale, f_n_pct__error, f_s_viewbox__line,
    f_o_point__camera, f_o_point__window, f_s_length, f_n_um__nice, f_n_um__grid, f_o_ruler, a_o_size_reference,
} from '../webserved_dir/scale_calibration.module.js';

Deno.test('a known distance over a line of camera pixels gives the scale', () => {
    assert.equal(f_n_um__known(0.1, 'mm'), 100);
    assert.equal(f_n_um__known(100, 'um'), 100);
    for (const v of ['', null, undefined, NaN, -1, 0, 'abc']) assert.equal(f_n_um__known(v, 'mm'), 0);
    const n_px = f_n_px__distance({ n_x: 200, n_y: 200 }, { n_x: 600, n_y: 200 });
    assert.equal(n_px, 400);
    assert.deepEqual(f_o_scale(100, n_px), { n_um__per_px: 0.25, n_px__per_um: 4 });
    // one grid cell of 0.1 mm, measured diagonally across 300 x 400 px
    assert.equal(f_o_scale(100, f_n_px__distance({ n_x: 0, n_y: 0 }, { n_x: 300, n_y: 400 })).n_um__per_px, 0.2);
    assert.equal(f_o_scale(100, 5), null, 'a mis-click is not a measurement');
    assert.equal(f_o_scale(0, 400), null, 'the known distance is required');
    assert.equal(f_n_px__distance(null, { n_x: 1, n_y: 1 }), 0);
    assert.equal(f_n_pct__error(400), 0.5);
    assert.equal(f_n_px__path([{ n_x: 0, n_y: 0 }, { n_x: 30, n_y: 40 }, { n_x: 30, n_y: 140 }]), 150);
    assert.equal(f_n_px__path([{ n_x: 0, n_y: 0 }]), 0);
});

Deno.test('window and camera pixels convert both ways and clicks beside the image clamp', () => {
    // a 800 x 600 camera image shown 400 x 300, letterboxed 50 px from the left and 100 px from the top
    const o_rect = { n_x: 50, n_y: 100, n_scl_x: 400, n_scl_y: 300 };
    const o_point = f_o_point__camera(o_rect, 800, 600, 150, 250);
    assert.deepEqual(o_point, { n_x: 200, n_y: 300 });
    assert.deepEqual(f_o_point__window(o_rect, 800, 600, o_point), { n_x: 150, n_y: 250 });
    assert.deepEqual(f_o_point__camera(o_rect, 800, 600, 0, 0), { n_x: 0, n_y: 0 });
    assert.deepEqual(f_o_point__camera(o_rect, 800, 600, 9999, 9999), { n_x: 800, n_y: 600 });
    assert.equal(f_o_point__camera(null, 800, 600, 1, 1), null);
    assert.equal(f_o_point__window(o_rect, 0, 0, o_point), null);
});

Deno.test('the snapshot thumbnail frames the measured line inside the image', () => {
    const f = (a, w = 3840, h = 2160) => f_s_viewbox__line(a, w, h, 16 / 9).split(' ').map(Number);
    // a 900 px horizontal line in the middle: 1.6 x its length, centred on it
    assert.deepEqual(f([{ n_x: 1200, n_y: 900 }, { n_x: 2100, n_y: 900 }]), [930, 495, 1440, 810]);
    // a short line still shows 240 px of context
    assert.deepEqual(f([{ n_x: 1000, n_y: 1000 }, { n_x: 1020, n_y: 1000 }]), [890, 932.5, 240, 135]);
    // near a corner the frame stays inside the image
    const [n_x, n_y, n_w, n_h] = f([{ n_x: 5, n_y: 5 }, { n_x: 305, n_y: 5 }]);
    assert.ok(n_x === 0 && n_y === 0 && n_w === 480 && n_h === 270);
    // a line longer than the image shows the whole image
    assert.deepEqual(f([{ n_x: 0, n_y: 0 }, { n_x: 800, n_y: 600 }], 800, 450), [0, 0, 800, 450]);
    assert.equal(f_s_viewbox__line(null, 800, 600, 16 / 9), '');
    assert.equal(f_s_viewbox__line([{ n_x: 0, n_y: 0 }, { n_x: 9, n_y: 9 }], 0, 0, 16 / 9), '');
});

Deno.test('lengths read in µm or mm and references use round sizes', () => {
    assert.equal(f_s_length(100), '100 µm');
    assert.equal(f_s_length(7.5), '7.5 µm');
    assert.equal(f_s_length(1500), '1.5 mm');
    assert.equal(f_s_length(0), '—');
    assert.equal(f_n_um__nice(73), 100);
    assert.equal(f_n_um__nice(73, true), 50);
    assert.equal(f_n_um__nice(200), 200);
    assert.equal(f_n_um__nice(200, true), 200);
    assert.equal(f_n_um__nice(0.03), 0.05);
    assert.equal(f_n_um__nice(0.03, true), 0.02);
    assert.equal(f_n_um__nice(0), 0);
    // 2 window px per µm: an 80 px cell would be 40 µm -> next round size 50 µm
    assert.equal(f_n_um__grid(0, 2), 50);
    assert.equal(f_n_um__grid(25, 2), 25, 'a typed cell size wins');
    assert.equal(f_n_um__grid(0, 0), 0);
    // a quarter of a 400 px wide image is 50 µm at 2 px/µm
    assert.deepEqual(f_o_ruler(400, 2), { n_um: 50, n_px: 100, n_cnt__tick: 10 });
    assert.equal(f_o_ruler(400, 0), null);
    assert.equal(f_o_ruler(100, 2).n_cnt__tick, 2, 'ticks stay at least 6 px apart');
});

Deno.test('saved size settings are validated and reference objects have sizes', () => {
    const o_default = f_o_size__default();
    assert.equal(o_default.n_known, 0.1);
    assert.equal(o_default.s_unit, 'mm');
    assert.deepEqual(f_o_size(null), o_default);
    assert.deepEqual(f_o_size({ n_known: -1, s_unit: 'km', b_grid: 'yes', n_um__grid: -5, n_pct__opacity: 500,
        o_pos__ruler: { n_x: 9 }, s_object: 'unknown' }), o_default);
    const o_size = f_o_size({ n_known: 0.5, s_unit: 'um', b_grid: true, n_um__grid: 25, b_ruler: true,
        o_pos__ruler: { n_x: 0.2, n_y: 0.3 }, s_object: 'hair', n_pct__opacity: 40 });
    assert.equal(o_size.n_known, 0.5);
    assert.equal(o_size.s_unit, 'um');
    assert.equal(o_size.b_grid && o_size.b_ruler, true);
    assert.equal(o_size.n_um__grid, 25);
    assert.deepEqual(o_size.o_pos__ruler, { n_x: 0.2, n_y: 0.3 });
    assert.equal(o_size.s_object, 'hair');
    assert.equal(o_size.n_pct__opacity, 40);
    assert.equal(f_o_size({ s_object: 'image' }).s_object, '', 'an own image is not restored after reload');
    assert.ok(a_o_size_reference.length >= 5);
    for (const o_reference of a_o_size_reference) {
        assert.ok(o_reference.s_id && o_reference.s_name && o_reference.s_size, 'named and described');
        assert.ok(['band', 'rect', 'capsule', 'ellipse'].includes(o_reference.s_shape));
        assert.ok(o_reference.n_um__y > 0 && (o_reference.s_shape === 'band' || o_reference.n_um__x > 0));
    }
    assert.equal(new Set(a_o_size_reference.map(o => o.s_id)).size, a_o_size_reference.length);
});
