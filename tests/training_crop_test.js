import assert from 'node:assert/strict';
import {
    f_o_box_from_crop,
    f_o_box_to_crop,
    f_o_crop,
    f_o_crop_bounds,
    f_o_crop_point,
} from '../webserved_dir/training_crop.module.js';
import { f_o_box_edit, f_s_yolo, f_validate_sample } from '../webserved_dir/training_data.module.js';

Deno.test('crop corners snap to pixels; annotation coordinates round trip and edits stay in crop', () => {
    let o_crop = f_o_crop({ n_x: .75, n_y: .8 }, { n_x: .25, n_y: .2 }, 400, 200);
    assert.deepEqual(o_crop, { n_x: 100, n_y: 40, n_scl_x: 200, n_scl_y: 120 });
    assert.equal(f_o_crop({ n_x: .2, n_y: .2 }, { n_x: .201, n_y: .201 }, 400, 200), null);
    assert.deepEqual(f_o_crop({ n_x: -1, n_y: -1 }, { n_x: 2, n_y: 2 }, 400, 200), {
        n_x: 0,
        n_y: 0,
        n_scl_x: 400,
        n_scl_y: 200,
    });
    let o_bounds = f_o_crop_bounds(o_crop, 400, 200);
    assert.deepEqual(f_o_crop_point({ n_x: 1, n_y: 0 }, o_bounds), { n_x: .75, n_y: .2 });
    let o_box = { s_label: 'cell', n_x: .4, n_y: .4, n_scl_x: .2, n_scl_y: .2 };
    let o_local = f_o_box_to_crop(o_box, o_bounds);
    let o_roundtrip = f_o_box_from_crop(o_local, o_bounds);
    for (let s of ['n_x', 'n_y', 'n_scl_x', 'n_scl_y']) {
        assert.ok(Math.abs(o_roundtrip[s] - o_box[s]) < 1e-12);
    }
    assert.equal(f_s_yolo([o_local], ['cell']), '0 0.50000000 0.50000000 0.40000000 0.33333333\n');
    for (let s_mode of ['move', 'resize']) {
        let o_edit = f_o_box_from_crop(
            f_o_box_edit(o_local, s_mode, { n_x: -100, n_y: 100 }, 200, 120),
            o_bounds,
        );
        assert.ok(o_edit.n_x >= o_bounds.n_x && o_edit.n_y >= o_bounds.n_y);
        assert.ok(o_edit.n_x + o_edit.n_scl_x <= .75 + 1e-12 && o_edit.n_y + o_edit.n_scl_y <= .8 + 1e-12);
    }
    assert.deepEqual(f_o_box_to_crop(o_box, f_o_crop_bounds(null, 400, 200)), o_box);
});

Deno.test('crop metadata must match the stored image and original camera extent', () => {
    let o_sample = {
        n_scl_x: 200,
        n_scl_y: 120,
        n_scl_x__source: 400,
        n_scl_y__source: 200,
        o_crop: { n_x: 100, n_y: 40, n_scl_x: 200, n_scl_y: 120 },
        a_o_box: [{ s_label: 'cell', n_x: .1, n_y: .1, n_scl_x: .5, n_scl_y: .5 }],
    };
    f_validate_sample(o_sample);
    for (
        let o_patch of [{ n_x: -1 }, { n_x: .5 }, { n_x: 300 }, { n_scl_x: 201 }, { n_scl_y: 121 }, {
            n_y: 100,
        }]
    ) {
        assert.throws(
            () => f_validate_sample({ ...o_sample, o_crop: { ...o_sample.o_crop, ...o_patch } }),
            /crop metadata/,
        );
    }
    assert.throws(() => f_validate_sample({ ...o_sample, n_scl_x__source: undefined }), /crop metadata/);
});
