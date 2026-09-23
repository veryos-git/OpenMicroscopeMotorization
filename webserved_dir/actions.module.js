// Framework-independent action registry and input evaluator. Bindings are held chords,
// never sequences. A keymap is versioned JSON; callbacks never enter that document.
let f_s_key = s => ({ ' ': 'Space', Control: 'Ctrl', OS: 'Meta' }[s] || (s.length === 1 ? s.toUpperCase() : s));
let f_o_binding = o => {
    if(!o || !['keyboard', 'button', 'axis'].includes(o.source)) throw Error('Invalid input source');
    if(o.source === 'keyboard') {
        if(!Array.isArray(o.keys) || !o.keys.length || o.keys.some(s => typeof s !== 'string' || !s.length)) throw Error('A keyboard binding needs keys');
        return { source: o.source, keys: [...new Set(o.keys.map(f_s_key))].sort() };
    }
    if(!Number.isInteger(o.index) || o.index < 0 || o.index > 255) throw Error('Invalid gamepad index');
    if(o.direction !== undefined && ![-1, 0, 1].includes(o.direction)) throw Error('Invalid axis direction');
    return { source: o.source, index: o.index, direction: o.direction || 0 };
};
let f_b_overlap = (a, b) => a.source === b.source && (a.source === 'keyboard' ? JSON.stringify(a.keys) === JSON.stringify(b.keys) : a.index === b.index && (!a.direction || !b.direction || a.direction === b.direction));
let f_s_binding = o => o.source === 'keyboard' ? o.keys.join('+') : `Gamepad ${o.source} ${o.index}${o.direction ? (o.direction > 0 ? ' +' : ' −') : ''}`;
let f_o_action_system = function(f_error = console.error) {
    let a_o_action = [], o_config = {}, o_active = new Map(), o_context = new Set(['global']), n_generation = 0;
    let f_invoke = (s_id, n_value = 1, s_phase = 'invoke') => {
        let o = a_o_action.find(o => o.id === s_id);
        if(!o || (s_phase !== 'release' && !o_context.has(o.context))) return;
        if(o.type === 'analog') n_value = Number.isFinite(n_value) ? Math.max(-1, Math.min(1, n_value)) : 0;
        try { Promise.resolve(o.invoke(n_value, s_phase)).catch(f_error); } catch(o_error) { f_error(o_error); }
    };
    let f_release = () => {
        n_generation++;
        let a_id = [...o_active.keys()]; o_active.clear();
        for(let s_id of a_id) f_invoke(s_id, 0, 'release');
    };
    let f_register = o => {
        if(a_o_action.some(a => a.id === o.id)) throw Error('Duplicate action: ' + o.id);
        o = { description: '', category: 'General', type: 'digital', context: 'global', rebindable: true, repeat: 'single-shot', keywords: [], bindings: [], ...o };
        a_o_action.push(o);
        o_config[o.id] = { bindings: o.bindings.map(f_o_binding), repeat: o.repeat, delay: 500, interval: 100, threshold: 0.5, deadzone: 0.15, sensitivity: 1, curve: 1 };
        return o;
    };
    let f_validate = o => {
        if(!o || !Array.isArray(o.bindings) || !['none', 'single-shot', 'auto-repeat'].includes(o.repeat)) throw Error('Invalid action settings');
        for(let [s, n_min, n_max] of [['delay', 0, 60000], ['interval', 10, 60000], ['threshold', 0.01, 1], ['deadzone', 0, 0.99], ['sensitivity', 0.01, 10], ['curve', 0.1, 10]]) {
            if(!Number.isFinite(o[s]) || o[s] < n_min || o[s] > n_max) throw Error(`Invalid ${s} (${n_min}–${n_max})`);
        }
        return { ...o, bindings: o.bindings.map(f_o_binding) };
    };
    let f_conflict = o_map => {
        let a = [];
        for(let n = 0; n < a_o_action.length; n++) for(let m = n + 1; m < a_o_action.length; m++) {
            let x = a_o_action[n], y = a_o_action[m];
            if(x.context === y.context && o_map[x.id].bindings.some(b => o_map[y.id].bindings.some(c => f_b_overlap(b, c)))) a.push([x.id, y.id]);
        }
        return a;
    };
    let f_set = (s_id, o, b_override = false) => {
        let o_action = a_o_action.find(a => a.id === s_id);
        if(!o_action?.rebindable) throw Error('Action cannot be rebound');
        let o_next = { ...o_config, [s_id]: f_validate(o) };
        let a_conflict = f_conflict(o_next).filter(a => a.includes(s_id));
        if(a_conflict.length && !b_override) return a_conflict;
        for(let a of a_conflict) {
            let s_other = a.find(s => s !== s_id);
            if(!a_o_action.find(a => a.id === s_other).rebindable) throw Error('Conflicts with a fixed binding');
            o_next[s_other] = { ...o_next[s_other], bindings: o_next[s_other].bindings.filter(b => !o_next[s_id].bindings.some(c => f_b_overlap(b, c))) };
        }
        f_release(); o_config = o_next; return [];
    };
    let f_tick = (o_key = new Set(), o_pad = null, n_now = performance.now()) => {
        let n_start = n_generation;
        for(let o of a_o_action) {
            if(n_start !== n_generation) break;
            let c = o_config[o.id], n_value = 0;
            if(o_context.has(o.context)) for(let b of c.bindings) {
                if(o.accept && !o.accept(b)) continue;
                let v = 0;
                if(b.source === 'keyboard') {
                    let a_modifier = ['Ctrl', 'Alt', 'Shift', 'Meta'];
                    v = b.keys.every(s => o_key.has(s)) && a_modifier.every(s => !o_key.has(s) || b.keys.includes(s)) ? 1 : 0;
                } else {
                    v = b.source === 'axis' ? o_pad?.axes?.[b.index] : o_pad?.buttons?.[b.index]?.value;
                    v = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
                    if(b.direction) v = Math.max(0, v * b.direction);
                    v = Math.abs(v) <= c.deadzone ? 0 : Math.sign(v) * Math.min(1, Math.pow(Math.abs(v), c.curve) * c.sensitivity);
                }
                if(Math.abs(v) > Math.abs(n_value)) n_value = v;
            }
            if(o.type === 'digital') n_value = Math.abs(n_value) >= c.threshold ? 1 : 0;
            let p = o_active.get(o.id);
            if(!n_value) {
                if(p) { o_active.delete(o.id); f_invoke(o.id, 0, 'release'); }
                continue;
            }
            if(!p) {
                o_active.set(o.id, { value: n_value, next: n_now + (c.delay || c.interval) });
                if(o.type === 'analog' || c.repeat !== 'auto-repeat' || c.delay === 0) f_invoke(o.id, n_value, 'press');
            } else if(o.type === 'analog' && p.value !== n_value) {
                p.value = n_value; f_invoke(o.id, n_value, 'change');
            } else if(o.type === 'digital' && c.repeat === 'auto-repeat' && n_now >= p.next) {
                p.next = n_now + c.interval; f_invoke(o.id, 1, 'repeat');
            }
        }
    };
    let f_export = () => ({ version: 1, actions: structuredClone(o_config) });
    let f_import = o => {
        if(o?.version !== 1 || !o.actions || typeof o.actions !== 'object') throw Error('Expected keymap version 1');
        let o_next = structuredClone(o_config);
        for(let [s, c] of Object.entries(o.actions)) {
            let a = a_o_action.find(a => a.id === s);
            if(!a) throw Error('Unknown action: ' + s);
            if(!a.rebindable && JSON.stringify(c) !== JSON.stringify(o_next[s])) throw Error('Action cannot be rebound: ' + s);
            o_next[s] = f_validate(c);
        }
        if(f_conflict(o_next).length) throw Error('Imported keymap has conflicting bindings');
        f_release(); o_config = o_next;
    };
    return { a_o_action, f_register, f_invoke, f_tick, f_release, f_set, f_import, f_export,
        f_config: s => structuredClone(o_config[s]),
        f_context: a => { f_release(); o_context = new Set(['global', ...a]); },
    };
};
// Upgrade untouched search defaults without taking a customized Ctrl+F binding.
let f_o_keymap__migrated = o_keymap => {
    let o = structuredClone(o_keymap);
    if(o?.version === 1 && o.actions) { delete o.actions['panel.backlash']; delete o.actions['panel.calibration']; }
    let a_binding = o?.actions?.['actions.search']?.bindings;
    if(o?.version !== 1 || !Array.isArray(a_binding) || a_binding.length !== 2) return o;
    let f_b_key = (b, a_key) => b.source === 'keyboard' && JSON.stringify(f_o_binding(b).keys) === JSON.stringify(a_key);
    if(!a_binding.some(b => f_b_key(b, ['Ctrl', 'P', 'Shift'])) || !a_binding.some(b => f_b_key(b, ['F3']))) return o;
    if(Object.entries(o.actions).some(([s_id, c]) => s_id !== 'actions.search' && c.bindings?.some(b => f_b_key(b, ['Ctrl', 'F'])))) return o;
    o.actions['actions.search'].bindings = [{ source: 'keyboard', keys: ['Ctrl', 'F'] }, { source: 'keyboard', keys: ['F3'] }];
    return o;
};
export { f_o_action_system, f_o_binding, f_s_binding, f_s_key, f_o_keymap__migrated };
