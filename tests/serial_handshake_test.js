import assert from 'node:assert/strict';
import { f_wait_for_esp_status } from '../webserved_dir/serial_handshake.module.js';

Deno.test('USB connection waits through boot noise until motor status arrives', async () => {
    let handler;
    let writes = 0;
    let unsubscribed = false;
    const status = { type: 'status', a_o_motor: [{}, {}, {}] };
    const result = await f_wait_for_esp_status(h => {
        handler = h;
        return () => { unsubscribed = true; };
    }, async command => {
        assert.deepEqual(command, { command: 'status' });
        writes++;
        handler(writes === 1 ? { type: 'boot' } : status);
    }, { n_interval: 1, n_timeout: 1000 });
    assert.equal(result, status);
    assert.equal(writes, 2);
    assert.equal(unsubscribed, true);
});

Deno.test('open USB port without motor firmware is rejected and listener removed', async () => {
    let unsubscribed = false;
    await assert.rejects(() => f_wait_for_esp_status(() => () => { unsubscribed = true; }, async () => {},
        { n_interval: 1, n_timeout: 10 }), /motor firmware did not answer/);
    assert.equal(unsubscribed, true);
});

Deno.test('USB write failure fails connection promptly and removes listener', async () => {
    let unsubscribed = false;
    await assert.rejects(() => f_wait_for_esp_status(() => () => { unsubscribed = true; },
        async () => { throw new Error('Device unplugged'); }, { n_interval: 1, n_timeout: 1000 }), /Device unplugged/);
    assert.equal(unsubscribed, true);
});

Deno.test('serial connect only marks connected and pushes config after firmware reply', async () => {
    const source = await Deno.readTextFile(new URL('../webserved_dir/index.js', import.meta.url));
    const start = source.indexOf('let f_connect_esp_serial =');
    const end = source.indexOf('// USB Serial is the default transport.', start);
    const state = { b_available__serial: true, b_connected__esp: false, s_error__esp_serial: 'old error' };
    const calls = [];
    const port = {
        async open() { calls.push('open'); },
        async setSignals(signals) {
            assert.deepEqual(signals, { dataTerminalReady: false, requestToSend: false });
            calls.push('release reset');
        },
        writable: { getWriter: () => ({ write: async () => {} }) },
    };
    const connect = new Function('o_state', 'f_disconnect_esp', 'f_read_esp_serial', 'f_register_esp_handler',
        'f_wait_for_esp_status', 'f_push_esp_config',
        'let o_serial__esp, o_writer__serial;\n' + source.slice(start, end) + '\nreturn f_connect_esp_serial;')(
        state, async () => {}, () => calls.push('read'), () => {},
        async () => {
            assert.equal(state.b_connected__esp, false);
            assert.equal(state.s_error__esp_serial, '');
            calls.push('firmware reply');
        }, () => { assert.equal(state.b_connected__esp, true); calls.push('config'); }
    );
    assert.equal(await connect(false, port), true);
    assert.equal(state.b_connecting__esp_serial, false);
    assert.deepEqual(calls, ['open', 'release reset', 'read', 'firmware reply', 'config']);
});
