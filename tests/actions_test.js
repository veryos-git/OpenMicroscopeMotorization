import assert from 'node:assert/strict';
import { f_o_action_system, f_o_keymap__migrated } from '../webserved_dir/actions.module.js';
let f_fixture = () => {
    let a = [], o = f_o_action_system(e => { throw e; });
    o.f_register({ id: 'image.capture', name: 'Capture Image', bindings: [{ source: 'keyboard', keys: ['Ctrl', 'Shift', 'I'] }], invoke: (v, phase) => a.push([v, phase]) });
    return { o, a };
};
Deno.test('chords require simultaneous keys and ignore operating-system repeat', () => {
    let { o, a } = f_fixture();
    for(let s of ['Ctrl', 'Shift', 'I']) o.f_tick(new Set([s]), null, 0);
    assert.equal(a.length, 0);
    o.f_tick(new Set(['Ctrl', 'Shift', 'I']), null, 1);
    o.f_tick(new Set(['Ctrl', 'Shift', 'I']), null, 100);
    assert.deepEqual(a, [[1, 'press']]);
    o.f_tick(new Set(['Ctrl', 'I']), null, 101);
    assert.deepEqual(a.at(-1), [0, 'release']);
});
Deno.test('auto-repeat waits 500 ms then repeats every 100 ms and stops on release', () => {
    let { o, a } = f_fixture();
    o.f_set('image.capture', { ...o.f_config('image.capture'), repeat: 'auto-repeat' });
    let k = new Set(['Ctrl', 'Shift', 'I']);
    for(let t of [0, 499]) o.f_tick(k, null, t);
    assert.equal(a.length, 0);
    for(let t of [500, 550, 600, 700]) o.f_tick(k, null, t);
    assert.deepEqual(a, [[1, 'repeat'], [1, 'repeat'], [1, 'repeat']]);
    o.f_tick(new Set(), null, 701); o.f_tick(new Set(), null, 900);
    assert.equal(a.length, 4);
});
Deno.test('conflicts cancel atomically or override only overlapping bindings', () => {
    let { o } = f_fixture();
    o.f_register({ id: 'other', invoke() {}, bindings: [{ source: 'keyboard', keys: ['X'] }] });
    let c = { ...o.f_config('other'), bindings: [{ source: 'keyboard', keys: ['I', 'Shift', 'Control'] }] };
    assert.equal(o.f_set('other', c).length, 1);
    assert.equal(o.f_config('other').bindings[0].keys[0], 'X');
    o.f_set('other', c, true);
    assert.deepEqual(o.f_config('image.capture').bindings, []);
    let saved = o.f_export(); o.f_import(JSON.parse(JSON.stringify(saved))); assert.deepEqual(o.f_export(), saved);
    assert.throws(() => o.f_import({ version: 1, actions: { other: { ...c, interval: 0 } } }));
    assert.deepEqual(o.f_export(), saved);
});
Deno.test('analog throttle and digital capture work simultaneously, normalize and release', () => {
    let { o, a } = f_fixture(), v = [];
    o.f_set('image.capture', { ...o.f_config('image.capture'), bindings: [{ source: 'button', index: 0 }] });
    o.f_register({ id: 'throttle', type: 'analog', bindings: [{ source: 'button', index: 7 }], invoke: n => v.push(n) });
    let pad = { buttons: Array.from({ length: 8 }, () => ({ value: 0 })) };
    pad.buttons[7].value = 0.7; o.f_tick(new Set(), pad, 0);
    pad.buttons[0].value = 1; o.f_tick(new Set(), pad, 1);
    assert.deepEqual(v, [0.7]); assert.deepEqual(a, [[1, 'press']]);
    pad.buttons[7].value = 5; o.f_tick(new Set(), pad, 2); assert.equal(v.at(-1), 1);
    o.f_tick(new Set(), null, 3); assert.equal(v.at(-1), 0);
});
Deno.test('axis deadzone, curve, sensitivity and threshold are configurable', () => {
    let { o, a } = f_fixture();
    o.f_set('image.capture', { ...o.f_config('image.capture'), bindings: [{ source: 'axis', index: 0, direction: -1 }], threshold: 0.7 });
    for(let v of [0.9, -0.1, -0.6]) o.f_tick(new Set(), { axes: [v] }, 0);
    assert.equal(a.length, 0);
    o.f_tick(new Set(), { axes: [-0.8] }, 1); assert.equal(a.length, 1);
    let n; o.f_register({ id: 'axis', type: 'analog', bindings: [{ source: 'axis', index: 1 }], invoke: v => n = v });
    o.f_set('axis', { ...o.f_config('axis'), curve: 2, sensitivity: 2 });
    o.f_tick(new Set(), { axes: [0, -0.5] }, 2); assert.equal(n, -0.5);
});
Deno.test('future contexts isolate bindings and leaving a context releases input', () => {
    let { o } = f_fixture(), a = [];
    o.f_register({ id: 'local', context: 'editor', bindings: [{ source: 'keyboard', keys: ['X'] }], invoke: v => a.push(v) });
    o.f_tick(new Set(['X']), null, 0); assert.deepEqual(a, []);
    o.f_context(['editor']); o.f_tick(new Set(['X']), null, 1); assert.deepEqual(a, [1]);
    o.f_context([]); assert.deepEqual(a, [1, 0]);
});
Deno.test('release from inside an action cancels the remaining input tick', () => {
    let o = f_o_action_system(), n = 0;
    o.f_register({ id: 'search', bindings: [{ source: 'keyboard', keys: ['F3'] }], invoke: (_, phase) => { if(phase !== 'release') o.f_release(); } });
    o.f_register({ id: 'move', type: 'analog', bindings: [{ source: 'axis', index: 0 }], invoke: () => n++ });
    o.f_tick(new Set(['F3']), { axes: [1] }, 0); assert.equal(n, 0);
});

Deno.test('whole-axis bindings conflict with directional bindings', () => {
    let { o } = f_fixture();
    o.f_register({ id: 'move', type: 'analog', bindings: [{ source: 'axis', index: 0 }], invoke() {} });
    const c = { ...o.f_config('image.capture'), bindings: [{ source: 'axis', index: 0, direction: 1 }] };
    assert.equal(o.f_set('image.capture', c).length, 1);
    o.f_set('image.capture', c, true);
    assert.deepEqual(o.f_config('move').bindings, []);
});
Deno.test('zero-delay auto-repeat waits an interval after its initial invocation', () => {
    let { o, a } = f_fixture();
    o.f_set('image.capture', { ...o.f_config('image.capture'), repeat: 'auto-repeat', delay: 0 });
    for(let t of [0, 16, 99]) o.f_tick(new Set(['Ctrl', 'Shift', 'I']), null, t);
    assert.equal(a.length, 1);
    o.f_tick(new Set(['Ctrl', 'Shift', 'I']), null, 100); assert.equal(a.length, 2);
});

Deno.test('search default migration preserves customized and conflicting shortcuts', () => {
    const old = { version: 1, actions: { 'actions.search': { bindings: [{ source: 'keyboard', keys: ['Ctrl', 'Shift', 'P'] }, { source: 'keyboard', keys: ['F3'] }] } } };
    const migrated = f_o_keymap__migrated(old);
    assert.deepEqual(migrated.actions['actions.search'].bindings[0].keys, ['Ctrl', 'F']);
    assert.deepEqual(old.actions['actions.search'].bindings[0].keys, ['Ctrl', 'Shift', 'P']);
    assert.deepEqual(f_o_keymap__migrated(migrated), migrated);
    old.actions.custom = { bindings: [{ source: 'keyboard', keys: ['Ctrl', 'F'] }] };
    assert.deepEqual(f_o_keymap__migrated(old), old);
    delete old.actions.custom;
    old.actions['actions.search'].bindings = [];
    assert.deepEqual(f_o_keymap__migrated(old), old);
});
