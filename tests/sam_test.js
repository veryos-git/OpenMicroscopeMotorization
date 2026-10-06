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
    const methods = new Function('f_o_capture__frame', 'o_component__training_yolo', source + '\nreturn o_component__training.methods;')(
        async () => ({ n_scl_x: 1, n_scl_y: 1, o_blob: new Blob() }), {},
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
