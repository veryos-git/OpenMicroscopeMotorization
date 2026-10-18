import assert from 'node:assert/strict';
import { f_generate_ino } from '../flash_functions.module.js';

// Uses the same ArduinoJson headers installed by the project's Arduino setup.
// No controller is needed: only RMT/GPIO calls are replaced by the host harness.
const include = (Deno.env.get('ARDUINOJSON_INCLUDE') || Deno.env.get('HOME') + '/Arduino/libraries/ArduinoJson/src');
const available = await Deno.stat(include + '/ArduinoJson.h').then(() => true, () => false);
Deno.test({ name: 'real LED firmware encodes channels, brightness, latch, queued updates and command errors', ignore: !available, fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
        for (const config of [{}, { b_enabled: true }, { b_enabled: true, n_count: 3, s_order: 'rgb' },
            { b_enabled: true, s_protocol: 'rgb' }, { b_enabled: true, s_protocol: 'rgb', s_order: 'rgb', n_count: 16 }]) {
            const path = await f_generate_ino('', '', undefined, dir, config);
            const source = await Deno.readTextFile(path);
            const hardware = source.slice(source.indexOf('// Optional addressable LED chain.'), source.indexOf('static const uint8_t HALF_STEP_SEQ'));
            const command = source.slice(source.indexOf('void ledSendError('), source.indexOf('// Read complete newline-terminated JSON commands'));
            await Deno.writeTextFile(dir + '/led_under_test.h', hardware + command);
            const build = await new Deno.Command('g++', { args: ['-std=c++17', '-Wall', '-Wextra', '-I' + include, '-I' + dir,
                new URL('./hardware_led_firmware.cpp', import.meta.url).pathname, '-o', dir + '/led-test'], stdout: 'piped', stderr: 'piped' }).output();
            assert.ok(build.success, new TextDecoder().decode(build.stderr));
            const result = await new Deno.Command(dir + '/led-test', { stdout: 'piped', stderr: 'piped' }).output();
            assert.ok(result.success, JSON.stringify(config) + '\n' + new TextDecoder().decode(result.stderr));
        }
    } finally { await Deno.remove(dir, { recursive: true }); }
} });
