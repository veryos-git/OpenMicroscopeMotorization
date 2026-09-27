// Optional real integration: deno run -A tests/yolo_smoke.js (after install-yolo).
// One epoch on generated images; never changes the user's captures or active model.
import assert from 'node:assert/strict';
import { f_o_training_store } from '../training_data_functions.module.js';
import { f_o_yolo_service } from '../yolo_functions.module.js';
import { f_o_dataset_catalog } from '../training_dataset.module.js';
let s_project = Deno.cwd(), s_root = await Deno.makeTempDir({ prefix: 'omm-yolo-smoke-' });
let s_python = `${s_project}/venv_yolo/bin/python3`;
let o_service;
try {
    let o_generate = await new Deno.Command(s_python, {
        args: [
            '-c',
            "from PIL import Image, ImageDraw; import sys; im=Image.new('RGB',(128,128),'#28394a'); ImageDraw.Draw(im).ellipse((32,32,96,96),fill='#aaccee'); im.save(sys.argv[1])",
            `${s_root}/source.png`,
        ],
    }).output();
    assert.ok(o_generate.success);
    let a_n = await Deno.readFile(`${s_root}/source.png`),
        o_store = f_o_training_store(`${s_root}/training_data`);
    for (let n = 0; n < 8; n++) {
        await o_store.f_save({
            n_scl_x: 128,
            n_scl_y: 128,
            n_ts_ms: n,
            o_position: { x: n * 100, y: 0, z: 0 },
            a_o_box: [{ s_label: 'target', n_x: .25, n_y: .25, n_scl_x: .5, n_scl_y: .5 }],
        }, a_n);
    }
    o_service = f_o_yolo_service({ s_root, s_python, s_worker: `${s_project}/yolo_worker.py` });
    await o_service.f_train({ n_epoch: 1, n_size: 64 });
    await o_service.f_done();
    let o = await o_service.f_status();
    assert.equal(o.o_job.s_status, 'done', JSON.stringify(o.o_job));
    assert.ok(o.o_model);
    console.log('Real fine-tuning passed:', o.o_model.o_metric);
    let s_model = o.o_model.s_id;
    await o_service.f_infer(a_n, .01);
    await o_service.f_done();
    o = await o_service.f_status();
    assert.equal(o.o_job.s_status, 'done', JSON.stringify(o.o_job));
    assert.equal(o.o_job.o_result.n_scl_x, 128);
    assert.ok(Array.isArray(o.o_job.o_result.a_o_box));
    console.log('Real inference passed:', o.o_job.o_result.a_o_box.length, 'detections');
    await o_service.f_train({ n_epoch: 1, n_size: 64, s_model, s_name: 'Second model' });
    await o_service.f_done();
    o = await o_service.f_status();
    assert.equal(o.o_job.s_status, 'done', JSON.stringify(o.o_job));
    assert.equal(o.a_o_model.length, 2);
    assert.equal(o.o_model.s_parent, s_model);
    assert.equal(o.o_model.s_name, 'Second model');
    let s_model__second = o.o_model.s_id;
    // The older checkpoint remains explicitly selectable for inference.
    await o_service.f_infer(a_n, .01, { s_model });
    await o_service.f_done();
    assert.equal((await o_service.f_status()).o_job.s_status, 'done');
    let o_catalog = f_o_dataset_catalog(`${s_root}/training_data`);
    let o_dataset = await o_catalog.f_create('Separate dataset');
    let o_store__second = await o_catalog.f_store(o_dataset.s_id);
    for (let o_capture of await o_store.f_list()) {
        await o_store__second.f_save({
            ...o_capture,
            a_o_box: o_capture.a_o_box.map((o_box) => ({ ...o_box, s_label: 'other target' })),
        }, a_n);
    }
    await assert.rejects(
        () => o_service.f_train({ n_epoch: 1, n_size: 64, s_dataset: o_dataset.s_id, s_model }),
        /does not belong/,
    );
    await o_service.f_train({ n_epoch: 1, n_size: 64, s_dataset: o_dataset.s_id });
    await o_service.f_done();
    o = await o_service.f_status(o_dataset.s_id);
    assert.equal(o.o_job.s_status, 'done', JSON.stringify(o.o_job));
    assert.equal(o.a_o_model.length, 1);
    assert.deepEqual(o.o_model.a_s_label, ['other target']);
    assert.equal((await o_service.f_status()).a_o_model.length, 2);
    console.log('Multiple datasets, retained models, and parent-model fine-tuning passed.');
    // Restart finds the completed checkpoint; a cancelled new run cannot replace it.
    let o_restart = f_o_yolo_service({ s_root, s_python, s_worker: `${s_project}/yolo_worker.py` });
    assert.equal((await o_restart.f_status()).o_model.s_id, s_model__second);
    await o_service.f_train({ n_epoch: 50, n_size: 64 });
    o_service.f_cancel();
    await o_service.f_done();
    o = await o_service.f_status();
    assert.equal(o.o_job.s_status, 'cancelled');
    assert.equal(o.o_model.s_id, s_model__second);
    console.log('Cancellation and checkpoint persistence passed.');
} finally {
    o_service?.f_cancel();
    await o_service?.f_done();
    await Deno.remove(s_root, { recursive: true });
}
