import assert from 'node:assert/strict';
import { f_flash_browser } from '../webserved_dir/flash_browser.module.js';

function fixture({ chip = 'ESP32-S3', failWrite = false, badHash = false } = {}) {
    const calls = [];
    const firmware = { s_chip: 'ESP32-S3', a_o_image: [0, 0x8000, 0xe000, 0x10000].map(n_address => ({
        n_address, s_base64: btoa('\xe9\x00\x00\xff'), s_md5: 'a'.repeat(32),
    })) };
    class Transport {
        async disconnect() { calls.push('disconnect'); }
    }
    class ESPLoader {
        chip = { CHIP_NAME: chip };
        async main() { calls.push('connect'); }
        async writeFlash(options) {
            calls.push('write');
            assert.equal(options.eraseAll, false);
            assert.equal(options.flashMode, 'keep');
            assert.deepEqual(options.fileArray.map(f => f.address), [0, 0x8000, 0xe000, 0x10000]);
            assert.deepEqual([...options.fileArray[0].data], [233, 0, 0, 255]);
            if (failWrite) throw new Error('USB unplugged');
        }
        async flashMd5sum() { calls.push('verify'); return (badHash ? 'b' : 'a').repeat(32); }
        async after() { calls.push('reset'); }
    }
    return { calls, run: () => f_flash_browser({}, firmware, () => {}, async () => ({ Transport, ESPLoader })) };
}

Deno.test('browser flashes all segments, verifies them, resets and releases USB', async () => {
    const f = fixture(); await f.run();
    assert.deepEqual(f.calls, ['connect', 'write', 'verify', 'verify', 'verify', 'verify', 'reset', 'disconnect']);
});
Deno.test('wrong chip is rejected before flash writes and USB is released', async () => {
    const f = fixture({ chip: 'ESP32' });
    await assert.rejects(f.run, /requires an ESP32-S3/);
    assert.deepEqual(f.calls, ['connect', 'disconnect']);
});
Deno.test('failed uploads release USB and do not report a successful reset', async () => {
    const f = fixture({ failWrite: true });
    await assert.rejects(f.run, /USB unplugged/);
    assert.deepEqual(f.calls, ['connect', 'write', 'disconnect']);
});
Deno.test('checksum mismatch fails upload and releases USB', async () => {
    const f = fixture({ badHash: true });
    await assert.rejects(f.run, /Verification failed/);
    assert.deepEqual(f.calls, ['connect', 'write', 'verify', 'disconnect']);
});
