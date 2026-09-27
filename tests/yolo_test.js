import assert from 'node:assert/strict';
import { f_o_yolo_config, f_o_yolo_split } from '../yolo_functions.module.js';
let f_sample = (s_id, n_x, s_label = 'target', s_quality = 'good') => ({
    s_id,
    n_scl_x: 100,
    n_scl_y: 100,
    o_position: { x: n_x, y: 0, z: Number(s_id) || 0 },
    s_quality,
    a_o_box: [{ s_label, n_x: .2, n_y: .2, n_scl_x: .4, n_scl_y: .4 }],
});
Deno.test('YOLO splits whole regions, excludes bad captures, and preserves class mapping', () => {
    let a_o = [
        f_sample('0', 0),
        f_sample('1', 0),
        f_sample('2', 10),
        f_sample('3', 10),
        f_sample('4', 20, 'rare'),
        f_sample('5', 30, 'bad', 'bad'),
    ];
    let o = f_o_yolo_split(a_o);
    assert.deepEqual(o.a_s_label, ['rare', 'target']);
    assert.equal(o.a_o_train.length + o.a_o_val.length, 3);
    let a_s_train = o.a_o_train.map((o) => o.s_group);
    assert.ok(o.a_o_val.every((o) => !a_s_train.includes(o.s_group)));
    assert.ok(o.a_o_train.some((o) => o.a_o_sample.some((s) => s.a_o_box[0].s_label === 'rare')));
    assert.equal(
        o.a_o_train.flatMap((o) => o.a_o_sample).length + o.a_o_val.flatMap((o) => o.a_o_sample).length,
        5,
    );
    assert.deepEqual(o, f_o_yolo_split(a_o.toReversed()));
});
Deno.test('YOLO refuses insufficient or unrepresentative datasets and invalid training options', () => {
    assert.throws(() => f_o_yolo_split([]), /Save annotated/);
    assert.throws(() => f_o_yolo_split([f_sample('0', 0), f_sample('1', 0)]), /two different/);
    assert.throws(() => f_o_yolo_split([f_sample('0', 0, 'a'), f_sample('1', 1, 'b')]), /more regions/);
    assert.throws(() => f_o_yolo_config({ n_epoch: 0 }));
    assert.throws(() => f_o_yolo_config({ n_epoch: 501 }));
    assert.throws(() => f_o_yolo_config({ n_size: 65 }));
    assert.deepEqual(f_o_yolo_config({ n_epoch: 1, n_size: 64 }), { n_epoch: 1, n_size: 64 });
});
