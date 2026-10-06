import assert from 'node:assert/strict';
import { f_o_exposure_histogram, f_o_exposure_limits } from '../webserved_dir/exposure.module.js';

Deno.test('exposure histogram detects clipped color channels and dark pixels before tonal processing', () => {
    const pixels = new Uint8ClampedArray([
        0,0,0,255, 5,5,5,255, 6,0,0,255, 255,0,0,255,
        250,249,249,255, 249,249,249,255, 255,255,255,0,
    ]);
    const result = f_o_exposure_histogram(pixels, { n_exposure__low: 5, n_exposure__high: 250 });
    assert.equal(result.n_pixels, 6);
    assert.equal(result.n_pct_low, 100*2/6);
    assert.equal(result.n_pct_high, 100*2/6);
    for (const bins of result.a_a_n_bin) assert.equal(bins.reduce((a,b)=>a+b), 6);
    assert.equal(result.a_a_n_bin[1][255], 1);
    assert.equal(result.a_a_n_bin[0][54], 1); // clipped red is not bright luminance
    assert.deepEqual(f_o_exposure_limits({ n_exposure__low: -9, n_exposure__high: 300 }), { n_low: 0, n_high: 255 });
    assert.deepEqual(f_o_exposure_limits({ n_exposure__low: 255, n_exposure__high: 1 }), { n_low: 254, n_high: 255 });
    assert.equal(f_o_exposure_histogram(new Uint8Array()).n_pct_high, 0);
});
