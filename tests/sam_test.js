import assert from 'node:assert/strict';
import { f_o_sam_response } from '../sam_functions.module.js';
import { f_validate_sample } from '../webserved_dir/training_data.module.js';
import { f_o_export, f_o_training_store } from '../training_data_functions.module.js';

const s_png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=';
const a_png = Uint8Array.from(atob(s_png), s => s.charCodeAt(0));
const box = () => ({ s_id: 'box-1', s_label: 'cell', n_x: 0, n_y: 0, n_scl_x: 1, n_scl_y: 1 });
const mask = () => ({ s_model: 'sam_b', n_scl_x: 1, n_scl_y: 1, s_mask_png: s_png,
    a_a_n_polygon: [[[0,0],[1,0],[1,1]]] });
function request(boxes = [box()], image = a_png) {
    const form = new FormData();
    form.append('image', new Blob([image]), 'frame.png');
    form.append('boxes', JSON.stringify(boxes));
    return new Request('http://localhost/api/training/sam/infer', { method: 'POST', body: form });
}

Deno.test('SAM endpoint validates prompts and geometry, cleans frames and recovers from worker errors', async () => {
    let path;
    const worker = async (frame, boxes) => {
        path = frame;
        assert.deepEqual(await Deno.readFile(frame), a_png);
        assert.deepEqual(boxes, [box()]);
        return { n_scl_x: 1, n_scl_y: 1, a_o_box: [{ s_id: 'box-1', o_segmentation: mask() }] };
    };
    const response = await f_o_sam_response(request(), worker);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).a_o_box[0].o_segmentation.s_model, 'sam_b');
    await assert.rejects(() => Deno.stat(path), Deno.errors.NotFound);
    const never = () => { throw new Error('Worker should not run'); };
    for (const req of [request([{ ...box(), n_x: -1 }]), request([box(), box()]), request([box()], new Uint8Array(24))]) {
        assert.equal((await f_o_sam_response(req, never)).status, 400);
    }
    assert.equal((await f_o_sam_response(request(), () => { throw new Error('Model unavailable'); })).status, 400);
    assert.equal((await f_o_sam_response(request(), worker)).status, 200);
    assert.equal((await f_o_sam_response(request(), () => ({ n_scl_x: 2, n_scl_y: 1 }))).status, 400);
});

Deno.test('SAM masks survive save/reload and export, with matching image dimensions', async () => {
    const root = await Deno.makeTempDir();
    try {
        const sample = { n_scl_x: 1, n_scl_y: 1, n_ts_ms: 1, a_o_box: [{ ...box(), o_segmentation: mask() }] };
        const store = f_o_training_store(root);
        await store.f_save(sample, a_png);
        assert.deepEqual((await f_o_training_store(root).f_list())[0].a_o_box[0].o_segmentation, mask());
        const tar = await new Response(f_o_export(store)).text();
        assert.ok(tar.includes(s_png));
        assert.ok(tar.includes('0 0.50000000 0.50000000 1.00000000 1.00000000'));
        for (const patch of [{ n_scl_x: 2 }, { s_mask_png: 'bad' }, { a_a_n_polygon: [[[0,0],[-1,0],[1,1]]] }]) {
            sample.a_o_box[0].o_segmentation = { ...mask(), ...patch };
            assert.throws(() => f_validate_sample(sample));
        }
    } finally { await Deno.remove(root, { recursive: true }); }
});

Deno.test('automatic SAM ignores obsolete results after editing, disabling, deleting or changing region', async () => {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__training.js', import.meta.url)))
        .replace(/^import\s*[\s\S]*?from\s*['"][^'"]+['"];?/gm, '')
        .replace(/export \{[^}]+\};?/, '');
    let release;
    const methods = new Function('f_o_capture__frame', 'o_component__training_yolo', 'o_sam_method', source + '\nreturn o_component__training.methods;')(
        async () => ({ n_scl_x: 1, n_scl_y: 1, o_blob: new Blob() }), {}, {},
    );
    for (const change of [vm => vm.n_revision++, vm => vm.b_sam = false, vm => vm.a_o_box = [],
        vm => vm.a_o_box[0].n_x = .1, vm => vm.s_dataset = 'other']) {
        const vm = { ...methods, b_sam: true, n_revision: 0, s_dataset: 'default', n_scl_x: 1, n_scl_y: 1,
            n_sam_pending: 0, a_o_box: [box()], f_sam_infer: () => new Promise(r => { release = r; }) };
        const pending = vm.f_sam_box(vm.a_o_box[0]);
        await Promise.resolve();
        change(vm);
        release([{ ...box(), o_segmentation: mask() }]);
        await pending;
        assert.equal(vm.a_o_box[0]?.o_segmentation, undefined);
        assert.equal(vm.n_sam_pending, 0);
    }
});

Deno.test('SAM point prompts validate labels, coordinates, bounds and survive crop/export', async () => {
    const { f_o_box_to_crop, f_o_box_from_crop } = await import('../webserved_dir/training_crop.module.js');
    const points = [{ n_x: .3, n_y: .4, n_label: 1 }, { n_x: .6, n_y: .7, n_label: 0 }];
    const prompted = { ...box(), a_o_point: points };
    const response = await f_o_sam_response(request([prompted]), async (_frame, boxes) => {
        assert.deepEqual(boxes[0].a_o_point, points);
        return { n_scl_x: 1, n_scl_y: 1, a_o_box: [{ s_id: 'box-1', o_segmentation: mask(),
            o_bounds: { n_x: 0, n_y: 0, n_scl_x: 1, n_scl_y: 1 } }] };
    });
    assert.equal(response.status, 200);
    const never = () => { throw Error('Worker must not run'); };
    for (const invalid of [[], null, [points[1]], [{ ...points[0], n_label: 2 }],
        [{ ...points[0], n_x: -1 }], [{ ...points[0], n_y: 1.1 }], [null], Array(129).fill(points[0])]) {
        const result = await f_o_sam_response(request([{ ...box(), a_o_point: invalid }]), never);
        assert.equal(result.status, 400);
        assert.match((await result.json()).s_error, /SAM needs/);
    }
    const crop = { n_x: .2, n_y: .2, n_scl_x: .6, n_scl_y: .6 };
    const cropped = f_o_box_to_crop({ ...prompted, ...crop }, crop);
    assert.ok(Math.abs(cropped.a_o_point[0].n_x - 1/6) < 1e-10);
    for (const [i, point] of f_o_box_from_crop(cropped, crop).a_o_point.entries()) {
        assert.ok(Math.abs(point.n_x - points[i].n_x) < 1e-10);
        assert.ok(Math.abs(point.n_y - points[i].n_y) < 1e-10);
        assert.equal(point.n_label, points[i].n_label);
    }
    const root = await Deno.makeTempDir();
    try {
        const store = f_o_training_store(root);
        await store.f_save({ n_scl_x: 1, n_scl_y: 1, n_ts_ms: 1, a_o_box: [{ ...cropped, o_segmentation: mask() }] }, a_png);
        assert.deepEqual((await store.f_list())[0].a_o_box[0].a_o_point, cropped.a_o_point);
        assert.ok((await new Response(f_o_export(store)).text()).includes('a_o_point'));
    } finally { await Deno.remove(root, { recursive: true }); }
});

Deno.test('interactive SAM serializes/coalesces prompts and drops reset, closed and superseded results', async () => {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/training_sam.module.js', import.meta.url)))
        .replace(/^import .*;$/gm, '').replace(/export \{[^}]+\};?/, '');
    const { f_o_sam_state, o_sam_method } = new Function(source + '\nreturn { f_o_sam_state, o_sam_method };')();
    const pending = [], calls = [];
    const vm = { ...f_o_sam_state(), ...o_sam_method, b_sam_point: true,
        o_crop_bounds: { n_x: 0, n_y: 0, n_scl_x: 1, n_scl_y: 1 },
        _o_sam_capture: {},
        f_sam_infer: (_capture, boxes) => {
            calls.push(boxes[0].a_o_point);
            return new Promise(resolve => pending.push(() => resolve([{ ...boxes[0], o_bounds: box(), o_segmentation: mask() }])));
        },
    };
    const point = x => [{ n_x: x, n_y: .5, n_label: 1 }];
    vm.f_sam_queue(point(.1), false);
    vm.f_sam_queue(point(.2), false);
    vm.f_sam_queue(point(.3), false);
    assert.equal(calls.length, 1);
    pending.shift()(); await Promise.resolve();
    assert.equal(vm.o_sam_result, null);
    assert.deepEqual(calls.map(p => p[0].n_x), [.1, .3]);
    pending.shift()(); await Promise.resolve();
    assert.equal(vm.o_sam_result.a_o_point[0].n_x, .3);
    vm.f_sam_queue(point(.4), false);
    vm.f_sam_reset_point();
    pending.shift()(); await Promise.resolve();
    assert.equal(vm.o_sam_result, null);
    vm.f_sam_queue(point(.5), true);
    vm.f_sam_reset_point();
    await new Promise(r => setTimeout(r, 200));
    assert.equal(calls.length, 3, 'reset cancels pending hover');
    vm.f_sam_queue(point(.6), false);
    vm.f_sam_close();
    pending.shift()(); await Promise.resolve();
    assert.equal(vm.o_sam_result, null);
    assert.equal(vm.b_sam_point_busy, false);
});
