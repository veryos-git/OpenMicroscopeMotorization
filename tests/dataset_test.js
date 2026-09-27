import assert from 'node:assert/strict';
import { f_o_dataset_catalog } from '../training_dataset.module.js';
import { f_o_export, f_o_training_response, f_o_training_store } from '../training_data_functions.module.js';
import { f_o_yolo_model_store } from '../yolo_model_store.module.js';
let a_n_png = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII='),
    (s) => s.charCodeAt(0),
);
let f_sample = () => ({
    n_scl_x: 1,
    n_scl_y: 1,
    n_ts_ms: 1,
    a_o_box: [{ s_label: 'target', s_color: '#00ff00', n_x: 0, n_y: 0, n_scl_x: 1, n_scl_y: 1 }],
});
Deno.test('datasets preserve legacy captures and isolate saves, tags, deletion, and exports', async () => {
    let s_root = await Deno.makeTempDir();
    try {
        let o_legacy = await f_o_training_store(s_root).f_save(f_sample(), a_n_png);
        let o_catalog = f_o_dataset_catalog(s_root), o_default = await o_catalog.f_store('default');
        assert.equal((await o_default.f_list())[0].s_id, o_legacy.s_id);
        let o_a = await o_catalog.f_create('Diatoms'), o_b = await o_catalog.f_create('Other slide');
        let o_store_a = await o_catalog.f_store(o_a.s_id), o_store_b = await o_catalog.f_store(o_b.s_id);
        let o_saved = await o_store_a.f_save({ ...f_sample(), s_dataset: o_b.s_id }, a_n_png);
        assert.equal(o_saved.s_dataset, o_a.s_id);
        assert.equal((await o_store_b.f_list()).length, 0);
        await assert.rejects(() => o_store_b.f_image(o_saved.s_id));
        await assert.rejects(() => o_store_b.f_tag(o_saved.s_id, 'bad'));
        await assert.rejects(() => o_store_b.f_delete(o_saved.s_id));
        let o_response = await f_o_training_response(
            new Request('http://localhost/api/training/image?dataset=' + o_b.s_id + '&id=' + o_saved.s_id),
            o_catalog,
        );
        assert.equal(o_response.status, 404);
        let s_archive = new TextDecoder().decode(await new Response(f_o_export(o_store_a)).arrayBuffer());
        assert.ok(s_archive.includes(o_a.s_id));
        assert.ok(s_archive.includes(o_saved.s_id));
        assert.ok(!s_archive.includes(o_legacy.s_id));
        await o_store_a.f_tag(o_saved.s_id, 'good');
        assert.equal((await o_store_a.f_list())[0].s_quality, 'good');
        assert.equal((await f_o_dataset_catalog(s_root).f_list()).length, 3);
        await assert.rejects(() => o_catalog.f_store('../escape'));
        await assert.rejects(() => o_catalog.f_store(crypto.randomUUID()));
        await assert.rejects(() => o_catalog.f_create('  '));
        await o_store_a.f_delete(o_saved.s_id);
        assert.equal((await o_default.f_list()).length, 1);
    } finally {
        await Deno.remove(s_root, { recursive: true });
    }
});
Deno.test('model registry retains multiple models per dataset and migrates the legacy model logically', async () => {
    let s_root = await Deno.makeTempDir();
    try {
        let o_registry = f_o_yolo_model_store(s_root);
        let f_model = async (s_dataset, n_ts_ms) => {
            let s_id = crypto.randomUUID();
            await Deno.mkdir(`${s_root}/run/${s_id}/model/weights`, { recursive: true });
            await Deno.writeTextFile(`${s_root}/run/${s_id}/model/weights/best.pt`, 'test checkpoint');
            return { s_id, s_dataset, s_name: 'Model ' + n_ts_ms, n_ts_ms, a_s_label: ['target'] };
        };
        let o_old = await f_model('default', 1);
        delete o_old.s_dataset;
        await Deno.writeTextFile(`${s_root}/latest.json`, JSON.stringify(o_old));
        assert.equal((await o_registry.f_list('default'))[0].s_id, o_old.s_id);
        let o_a = await f_model('dataset-a', 2),
            o_b = await f_model('dataset-a', 3),
            o_c = await f_model('dataset-b', 4);
        for (let o of [o_a, o_b, o_c]) await o_registry.f_publish(o);
        assert.deepEqual((await o_registry.f_list('dataset-a')).map((o) => o.s_id), [o_b.s_id, o_a.s_id]);
        assert.equal((await o_registry.f_read('dataset-a', o_a.s_id)).s_id, o_a.s_id);
        await assert.rejects(() => o_registry.f_read('dataset-b', o_a.s_id), /does not belong/);
        await assert.rejects(() => o_registry.f_read('dataset-a', '../escape'));
        assert.equal((await o_registry.f_list('default')).length, 1);
        await f_model('dataset-a', 5);
        assert.equal((await o_registry.f_list('dataset-a')).length, 2); // unpublished partial job
    } finally {
        await Deno.remove(s_root, { recursive: true });
    }
});
