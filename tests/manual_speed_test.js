import assert from 'node:assert/strict';
import { f_n_speed, f_o_manual_speed } from '../webserved_dir/manual_speed.module.js';

Deno.test('manual speed settings migrate legacy XY, default focus slowly and restore separately', () => {
    assert.deepEqual(f_o_manual_speed(null, '7'), { xy: 7, z: 0.5 });
    assert.deepEqual(f_o_manual_speed({ xy: 9, z: 0.25 }, '7'), { xy: 9, z: 0.25 });
    assert.deepEqual(f_o_manual_speed({ xy: 'bad', z: null }, 'bad'), { xy: 5, z: 0.5 });
    assert.deepEqual(f_o_manual_speed({ xy: 900, z: -1 }), { xy: 15, z: 0.05 });
    for(const v of ['', NaN, Infinity, undefined]) assert.equal(f_n_speed(v, 0.5), 0.5);
});
