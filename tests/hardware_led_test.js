import assert from 'node:assert/strict';
import { f_o_hardware_led_config, f_s_hardware_led_config_error, f_s_hardware_led_output_error } from '../webserved_dir/hardware_led.module.js';
import { f_generate_ino, f_compile_esp } from '../flash_functions.module.js';

const pins = [{ n_pin1: 4, n_pin2: 5, n_pin3: 6, n_pin4: 7 }, { n_pin1: 15, n_pin2: 16, n_pin3: 17, n_pin4: 18 }, { n_pin1: 8, n_pin2: 3, n_pin3: 46, n_pin4: 9 }];

Deno.test('LED defaults are optional, one RGBW LED, and low white startup output', () => {
    const config = f_o_hardware_led_config();
    assert.equal(config.b_enabled, false);
    assert.equal(config.n_count, 1);
    assert.equal(config.s_protocol, 'rgbw');
    assert.deepEqual(config.o_startup, { b_on: true, n_red: 0, n_green: 0, n_blue: 0, n_white: 255, n_brightness: 8 });
    assert.equal(f_s_hardware_led_config_error(config, pins), '');
    config.o_startup.n_red = 255;
    assert.equal(f_o_hardware_led_config().o_startup.n_red, 0);
    assert.equal(f_o_hardware_led_config({ o_startup: { n_brightness: 12 } }).o_startup.n_white, 255);
    assert.deepEqual(f_o_hardware_led_config({ s_protocol: 'rgb' }).o_startup,
        { b_on: true, n_red: 255, n_green: 255, n_blue: 255, n_white: 0, n_brightness: 8 });
});

Deno.test('LED validation rejects conflicting, reserved, malformed and excessive configuration', () => {
    const config = f_o_hardware_led_config({ b_enabled: true });
    assert.equal(f_s_hardware_led_config_error(config, pins), '');
    for (const n_pin of [3, 4, 18, 19, 20, 22, 26, 33, 37, 43, 44, 45, 46, 49, -1, 2.5, '21', '21; bad()']) {
        assert.ok(f_s_hardware_led_config_error({ ...config, n_pin }, pins), String(n_pin));
    }
    assert.match(f_s_hardware_led_config_error({ ...config, n_pin: 18 }, pins), /motor/);
    for (const patch of [{ n_count: 0 }, { n_count: 17 }, { n_count: 1.5 }, { s_order: 'bad' }, { s_protocol: 'rgbcct' }, { b_enabled: 'true' }]) {
        assert.ok(f_s_hardware_led_config_error({ ...config, ...patch }, pins));
    }
    for (const value of [-1, 256, 0.5, '8', null, NaN, Infinity]) {
        assert.ok(f_s_hardware_led_output_error({ ...config.o_startup, n_brightness: value }));
    }
    assert.equal(f_s_hardware_led_output_error({ ...config.o_startup, n_brightness: 0 }), '');
});

Deno.test('firmware generation includes LED settings and keeps old callers disabled', async () => {
    const dir = await Deno.makeTempDir();
    try {
        let path = await f_generate_ino('a"b', '', pins, dir);
        let ino = await Deno.readTextFile(path);
        assert.ok(!ino.includes('{{'));
        assert.ok(ino.includes('B_ENABLED__LED = false;'));
        assert.ok(ino.includes('WIFI_SSID = "a\\"b";'));
        path = await f_generate_ino('', '', pins, dir, f_o_hardware_led_config({ b_enabled: true, n_count: 3, n_pin: 21, s_order: 'rgb', o_startup: { n_brightness: 31 } }));
        ino = await Deno.readTextFile(path);
        for (const value of ['B_ENABLED__LED = true;', 'N_PIN__LED = 21;', 'N_COUNT__LED = 3;', 'B_RGBW__LED = true;', 'B_GREEN_FIRST__LED = false;', 'true, 0, 0, 0, 255, 31']) assert.ok(ino.includes(value), value);
        assert.ok(!ino.includes('{{'));
        path = await f_generate_ino('', '', pins, dir, { o_startup: { b_enabled: true, n_pin: '18; bad()' } });
        ino = await Deno.readTextFile(path);
        assert.ok(ino.includes('B_ENABLED__LED = false;') && ino.includes('N_PIN__LED = 21;'));
        assert.ok(!ino.includes('bad()'));
        path = await f_generate_ino('', '', pins, dir, { b_enabled: false, n_pin: 2 });
        assert.ok((await Deno.readTextFile(path)).includes('N_PIN__LED = 2;'), 'Disabled LED retains its configured GPIO for status comparison');
        await assert.rejects(() => f_generate_ino('', '', pins, dir, { b_enabled: true, n_pin: 18 }), /motor/);
        const result = await f_compile_esp('', '', pins, () => assert.fail('Invalid LED config must fail before installation or compilation'), { b_enabled: true, n_pin: 19 });
        assert.equal(result.b_success, false);
        assert.match(result.s_error, /GPIO/);
    } finally { await Deno.remove(dir, { recursive: true }); }
});

Deno.test('LED status and errors use the shared serial/WebSocket handler and tolerate old firmware', async () => {
    const source = await Deno.readTextFile(new URL('../webserved_dir/index.js', import.meta.url));
    const body = source.slice(source.indexOf('let f_handle_esp_message ='), source.indexOf('let f_start_esp_status_poll ='));
    const state = { a_o_motor: [] };
    const handle = new Function('o_state', 'a_f_handler__esp', 'f_update_stat__motor', body + '\nreturn f_handle_esp_message;')(state, [], () => {});
    const report = { b_ready: true, o_config: f_o_hardware_led_config({ b_enabled: true }) };
    handle({ type: 'status', a_o_motor: [], o_hardware_led: report });
    assert.equal(state.o_hardware_led, report);
    handle({ type: 'hardwareLedError', error: 'LED unavailable' });
    assert.equal(state.s_error__hardware_led, 'LED unavailable');
    handle({ type: 'status', a_o_motor: [] });
    assert.equal(state.o_hardware_led, null);
});

Deno.test('browser flash submits saved LED config and reconnects to new firmware', async () => {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__setup.js', import.meta.url)))
        .replace(/^import\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/gm, '').replace(/export \{[^}]+\};?/, '');
    const state = { o_config__hardware_led: f_o_hardware_led_config({ b_enabled: true }), a_o_pin_config: pins };
    const calls = [];
    const port = {};
    const bindings = {
        o_state: state, f_s_hardware_led_config_error,
        navigator: { serial: { requestPort: async () => port } },
        f_disconnect_esp: async () => calls.push('disconnect'),
        f_o_wsmsg: (s_type, v_data) => ({ s_type, v_data }),
        f_register_handler: () => () => {}, requestAnimationFrame() {},
        f_send_wsmsg_with_response: async message => { calls.push(message); return { v_data: { b_success: true } }; },
        f_flash_browser: async p => { assert.equal(p, port); calls.push('flash'); },
        f_connect_esp_serial: async (ask, p) => { assert.equal(p, port); calls.push('reconnect'); return true; },
        setTimeout: callback => callback(),
    };
    const component = new Function(...Object.keys(bindings), source + '\nreturn o_component__setup;')(...Object.values(bindings));
    await component.methods.f_start_flash.call({ b_enabled__flash: true });
    assert.equal(calls[1].s_type, 'compile_esp');
    assert.deepEqual(calls[1].v_data.o_config__hardware_led, state.o_config__hardware_led);
    assert.deepEqual([calls[0], ...calls.slice(2)], ['disconnect', 'flash', 'reconnect']);
    assert.equal(state.s_flash_status, 'done');
    state.o_config__hardware_led.n_pin = 18;
    assert.equal(component.computed.b_enabled__flash.call({}), false);
    assert.match(component.computed.s_hint__flash.call({}), /motor/);
});
