import assert from 'node:assert/strict';

// Exercise the real settings writers without opening a browser or controller.
async function fixture() {
    const source = await Deno.readTextFile(new URL('../webserved_dir/index.js', import.meta.url));
    const writers = source.slice(source.indexOf('let f_save_setting ='), source.indexOf('let f_save_library_current ='));
    const debounce = source.slice(source.indexOf('let f_save_setting__debounced ='), source.indexOf('// persist the flat-field metadata'));
    const timers = new Map(), rows = new Map();
    let nextTimer = 0, writes = 0;
    const bindings = {
        o_state: { a_o_setting: [] },
        f_o_wsmsg: (type, data) => ({ type, data }),
        o_sfunexposed__f_v_crud__indb: { s_name: 'crud' },
        async f_send_wsmsg_with_response({ data: [operation, table, record, update] }) {
            assert.equal(table, 'a_o_setting');
            writes++;
            const saved = operation === 'create' ? { ...record } : { ...record, ...update };
            rows.set(saved.s_key, structuredClone(saved));
            return { v_result: saved };
        },
        setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
        clearTimeout(id) { timers.delete(id); },
    };
    const declarations = source.match(/let o_save_timeouts = [^;]+;/)[0];
    const save = new Function(...Object.keys(bindings), declarations + writers + debounce + '\nreturn f_save_setting__debounced;')(...Object.values(bindings));
    return {
        save, rows, writes: () => writes,
        async flush() {
            for (const [id, callback] of timers) { timers.delete(id); callback(); }
            await Promise.resolve();
        },
    };
}

Deno.test('calibration values and timestamps all persist when saved together', async () => {
    const { save, rows, flush } = await fixture();
    save('a_n_step__backlash', [12, 37, 15]);
    save('a_n_step__per_px', [0.2, 0, 0.15]);
    save('o_calibration', { a_n_ts_ms__backlash: [1, 2, 3] });
    save('o_config__scan', { s_mode__area: 'free' });
    await flush();
    assert.deepEqual(JSON.parse(rows.get('a_n_step__per_px')?.s_value || 'null'), [0.2, 0, 0.15]);
    assert.deepEqual(JSON.parse(rows.get('a_n_step__backlash')?.s_value || 'null'), [12, 37, 15]);
    assert.deepEqual(JSON.parse(rows.get('o_calibration')?.s_value || 'null'), { a_n_ts_ms__backlash: [1, 2, 3] });
    assert.equal(rows.size, 4);
});

Deno.test('rapid changes keep the latest value per setting and can be saved again', async () => {
    const { save, rows, flush, writes } = await fixture();
    save('overlap', 20);
    save('speed', 5);
    save('overlap', 30);
    await flush();
    assert.equal(writes(), 2);
    assert.equal(rows.get('overlap').s_value, '30');
    assert.equal(rows.get('speed').s_value, '5');
    save('overlap', 50);
    await flush();
    assert.equal(rows.get('overlap').s_value, '50');
    assert.equal(writes(), 3);
});
