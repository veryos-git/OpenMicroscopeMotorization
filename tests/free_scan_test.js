import assert from 'node:assert/strict';
import { f_o_free_scan_plan, f_n_free_focus } from '../webserved_dir/free_scan.module.js';

const config = { n_width: 100, n_height: 100, n_steps_x: 1, n_steps_y: 1, n_overlap_pct: 30 };
const point = (n_x, n_y) => ({ n_x, n_y, n_z: 10 + 2 * n_x + 3 * n_y });
const outline = [[0, 0], [280, 0], [280, 70], [70, 70], [70, 280], [0, 280]].map(p => point(...p));

Deno.test('free scan covers a concave outline with a connected sparse serpentine grid', () => {
    const plan = f_o_free_scan_plan(outline, config);
    assert.equal(plan.n_step__x, 70);
    assert.equal(plan.n_step__y, 70);
    assert.equal(plan.n_tile_x, 5);
    assert.equal(plan.n_tile_y, 5);
    assert.equal(plan.a_o_tile.length, 16);
    assert.ok(!plan.a_o_tile.some(t => t.n_col >= 2 && t.n_row >= 2), 'concave cutout must not become a bounding-box scan');
    for (let row = 0; row < 5; row++) {
        const cols = plan.a_o_tile.filter(t => t.n_row === row).map(t => t.n_col);
        assert.deepEqual(cols, [...cols].sort((a, b) => row % 2 ? b - a : a - b));
    }
    const remaining = new Set(plan.a_o_tile.map(t => t.n_row + ',' + t.n_col));
    const pending = [plan.a_o_tile[0]];
    remaining.delete('0,0');
    while (pending.length) {
        const {n_row, n_col} = pending.pop();
        for (const [r, c] of [[n_row - 1, n_col], [n_row + 1, n_col], [n_row, n_col - 1], [n_row, n_col + 1]]) {
            if (remaining.delete(r + ',' + c)) pending.push({n_row: r, n_col: c});
        }
    }
    assert.equal(remaining.size, 0, 'every tile must have a path of overlapping grid neighbors');
    for (let y = 0; y <= 280; y += 7) for (let x = 0; x <= 280; x += 7) {
        if (x > 70 && y > 70) continue;
        assert.ok(plan.a_o_tile.some(t => Math.abs(x - t.n_x) <= 50 && Math.abs(y - t.n_y) <= 50), `uncovered sample at ${x},${y}`);
    }
});

Deno.test('free focus reproduces a tilted plane inside either winding and bounds border focus', () => {
    for (const points of [outline, [...outline].reverse()]) {
        const plan = f_o_free_scan_plan(points, config);
        for (const [x, y] of [[20, 20], [240, 30], [30, 240], [70, 70]]) {
            assert.equal(f_n_free_focus(points, plan.a_o_triangle, x, y), point(x, y).n_z);
        }
        for (const p of points) assert.equal(f_n_free_focus(points, plan.a_o_triangle, p.n_x, p.n_y), p.n_z);
        assert.equal(f_n_free_focus(points, plan.a_o_triangle, -20, 35), point(0, 35).n_z);
        assert.equal(f_n_free_focus(points, plan.a_o_triangle, 300, 35), point(280, 35).n_z);
    }
});

Deno.test('free scan preserves focus samples along straight edges and covers narrow sloped regions', () => {
    const points = [[0, 0], [100, 0], [200, 0], [200, 100], [0, 100]].map(p => point(...p));
    points[1].n_z = 999;
    const plan = f_o_free_scan_plan(points, config);
    assert.equal(f_n_free_focus(points, plan.a_o_triangle, 100, 0), 999);
    const thin = [[-400, -400], [100, 100], [110, 100], [-390, -400]].map(p => point(...p));
    const narrowPlan = f_o_free_scan_plan(thin, config);
    for (let i = 0; i <= 100; i++) {
        const x = -395 + 5 * i, y = -400 + 5 * i;
        assert.ok(narrowPlan.a_o_tile.some(t => Math.abs(t.n_x - x) <= 50 && Math.abs(t.n_y - y) <= 50));
    }
    assert.ok(narrowPlan.a_o_tile.length < narrowPlan.n_tile_x * narrowPlan.n_tile_y);
});

Deno.test('free scan rounds spacing down to preserve overlap with unequal axis calibration', () => {
    const plan = f_o_free_scan_plan(outline, { ...config, n_width: 101, n_height: 77, n_steps_x: 1.5, n_steps_y: 2.25 });
    assert.equal(plan.n_step__x, 106);
    assert.equal(plan.n_step__y, 121);
    assert.ok(plan.a_o_tile.every(t => [t.n_x, t.n_y, t.n_z].every(Number.isSafeInteger)));
});

Deno.test('free scan rejects ambiguous outlines, invalid calibration and unbounded plans', () => {
    for (const points of [[], outline.slice(0, 2), [...outline, outline[0]],
        [[0, 0], [200, 200], [0, 200], [200, 0]].map(p => point(...p)),
        [[0, 0], [100, 0], [200, 0]].map(p => point(...p)),
        [{ ...outline[0], n_z: NaN }, ...outline.slice(1)]]) {
        assert.throws(() => f_o_free_scan_plan(points, config));
    }
    for (const override of [{n_steps_x: 0}, {n_height: undefined}, {n_overlap_pct: 91}, {n_overlap_pct: ''}, {n_width: 1, n_steps_x: .01}]) {
        assert.throws(() => f_o_free_scan_plan(outline, { ...config, ...override }));
    }
    assert.throws(() => f_o_free_scan_plan([[0, 0], [1e8, 0], [1e8, 1e8]].map(p => point(...p)), config), /too large/);
});
