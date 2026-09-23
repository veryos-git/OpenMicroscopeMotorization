import { o_state, f_save_setting__debounced, f_send_esp_stop_all, f_toggle_mouse_jog } from './index.js';
import { o_actions, o_action_ui, f_action } from './o_actions.js';
import { f_s_binding, f_s_key, f_o_keymap__migrated } from './actions.module.js';
import { f_o_capture__frame } from './o_capture.module.js';
let o_component__actions = {
    data() { return { o_action_ui, s_query: '', n_selected: 0, b_edit: false, s_id: '', o_edit: null, s_source: 'keyboard', s_chord: '', n_index: 0, n_direction: 0, s_profile: 'default', n_revision: 0 }; },
    computed: {
        a_result() { this.n_revision; let s = this.s_query.toLowerCase(); return o_actions.a_o_action.filter(o => [o.name, o.description, o.category, ...o.keywords].join(' ').toLowerCase().includes(s)).sort((a, b) => (b.id === 'image.capture') - (a.id === 'image.capture') || a.name.localeCompare(b.name)); },
    },
    methods: {
        f_label(o) { this.n_revision; return o_actions.f_config(o.id).bindings.map(f_s_binding).join(' / ') || 'Unbound'; },
        f_close() { o_state.b_input_suspended = false; this.o_action_ui.open = false; this.o_edit = null; o_actions.f_release(); this.o_key.clear(); this.el_previous?.focus(); },
        f_open() { o_state.b_input_suspended = true; o_state.b_armed__gamepad = false; this.el_previous = document.activeElement; this.o_action_ui.open = true; this.b_edit = false; this.o_edit = null; this.s_query = ''; this.n_selected = 0; o_actions.f_release(); this.o_key.clear(); this.$nextTick(() => this.$refs.search?.focus()); },
        f_run(o) { if(!o) return; this.f_close(); o_actions.f_invoke(o.id); if(o.type === 'analog' || o.repeat === 'none') setTimeout(() => o_actions.f_invoke(o.id, 0, 'release'), 150); },
        f_select(o) { this.s_id = o.id; this.o_edit = o_actions.f_config(o.id); },
        f_add() {
            try {
                let b = this.s_source === 'keyboard' ? { source: 'keyboard', keys: this.s_chord.split('+').map(s => s.trim()) } : { source: this.s_source, index: Number(this.n_index), direction: Number(this.n_direction) };
                this.o_edit.bindings.push(b);
                this.s_chord = '';
            } catch(e) { this.o_action_ui.error = e.message; }
        },
        f_record(e) {
            e.preventDefault(); e.stopPropagation();
            let a = []; for(let [s, b] of [['Ctrl', e.ctrlKey], ['Alt', e.altKey], ['Shift', e.shiftKey], ['Meta', e.metaKey]]) if(b) a.push(s);
            this.o_key_record.add(f_s_key(e.key));
            a.push(...this.o_key_record); this.s_chord = [...new Set(a)].join('+');
        },
        f_save() {
            try {
                let a = o_actions.f_set(this.s_id, this.o_edit);
                if(a.length) {
                    let s = a.flat().filter(s => s !== this.s_id).map(s => o_actions.a_o_action.find(o => o.id === s).name).join(', ');
                    if(!confirm('Binding conflicts with ' + s + '. Override and remove their conflicting bindings?')) return;
                    o_actions.f_set(this.s_id, this.o_edit, true);
                }
                this.f_persist(); this.o_edit = null;
            } catch(e) { this.o_action_ui.error = e.message; }
        },
        f_persist() { this.n_revision++; try { localStorage.setItem('omm.keymap.' + this.s_profile, JSON.stringify(o_actions.f_export())); } catch(e) { this.o_action_ui.error = 'Cannot save keymap: ' + e.message; } },
        f_profile() {
            o_actions.f_release(); this.o_key.clear(); this.o_edit = null;
            try { o_actions.f_import(this.o_default); let s = localStorage.getItem('omm.keymap.' + this.s_profile); if(s) { let o = f_o_keymap__migrated(JSON.parse(s)); o_actions.f_import(o); if(JSON.stringify(o) !== s) this.f_persist(); } localStorage.setItem('omm.keymap.profile', this.s_profile); }
            catch(e) { this.o_action_ui.error = 'Cannot load keymap: ' + e.message; }
            this.n_revision++;
        },
        f_reset(b_all) { if(b_all) { o_actions.f_import(this.o_default); this.f_persist(); } else this.o_edit = structuredClone(this.o_default.actions[this.s_id]); },
        f_export() { let s = URL.createObjectURL(new Blob([JSON.stringify(o_actions.f_export(), null, 2)], { type: 'application/json' })); let a = document.createElement('a'); a.href = s; a.download = 'keymap.json'; a.click(); setTimeout(() => URL.revokeObjectURL(s), 1000); },
        async f_import(e) { try { let f = e.target.files[0]; if(f) { o_actions.f_import(f_o_keymap__migrated(JSON.parse(await f.text()))); this.f_persist(); this.o_edit = null; } } catch(e) { this.o_action_ui.error = e.message; } finally { e.target.value = ''; } },
    },
    mounted() {
        this.o_key = new Set(); this.o_key_record = new Set();
        f_action({ id: 'actions.search', name: 'Search Actions', description: 'Find and invoke an application action', category: 'Application', bindings: [{ source: 'keyboard', keys: ['Ctrl', 'F'] }, { source: 'keyboard', keys: ['F3'] }] }, () => this.f_open());
        f_action({ id: 'image.capture', name: 'Capture Image', description: 'Download the current camera image', category: 'Image', keywords: ['photo', 'snapshot'], bindings: [{ source: 'keyboard', keys: ['Ctrl', 'Shift', 'I'] }, { source: 'button', index: 0 }] }, async () => {
            let o = await f_o_capture__frame(); let s = URL.createObjectURL(o.o_blob); let a = document.createElement('a'); a.href = s; a.download = 'capture-' + Date.now() + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(s), 1000);
        });
        f_action({ id: 'motor.stop', name: 'Stop All Motors', category: 'Motion', description: 'Stop all motion', bindings: [{ source: 'keyboard', keys: ['Escape'] }] }, () => { o_actions.f_release(); this.o_key.clear(); f_send_esp_stop_all(); o_actions.f_invoke('zoom.cancel'); });
        f_action({ id: 'motion.mouse', name: 'Toggle Mouse Movement', category: 'Motion', description: 'Enable or disable mouse jogging' }, f_toggle_mouse_jog);
        for(let s of Object.keys(o_state.o_panel_visibility)) f_action({ id: 'panel.' + s, name: 'Toggle ' + s.replaceAll('_', ' '), category: 'Panels', description: 'Show or hide the ' + s.replaceAll('_', ' ') + ' panel', bindings: s === 'flat' ? [{ source: 'keyboard', keys: ['F'] }] : [] }, () => { o_state.o_panel_visibility[s] = !o_state.o_panel_visibility[s]; f_save_setting__debounced('o_panel_visibility', o_state.o_panel_visibility); });
        this.o_default = o_actions.f_export();
        try { this.s_profile = localStorage.getItem('omm.keymap.profile') || 'default'; } catch(_) {}
        this.f_profile();
        this.f_key = e => {
            if(e.isComposing) return;
            let s = f_s_key(e.key);
            if(e.type === 'keyup') { this.o_key.delete(s); this.o_key_record.delete(s); }
            else if(!e.repeat) this.o_key.add(s);
            for(let [s, b] of [['Ctrl', e.ctrlKey], ['Alt', e.altKey], ['Shift', e.shiftKey], ['Meta', e.metaKey]]) { if(b) this.o_key.add(s); else this.o_key.delete(s); }
            if(this.o_action_ui.open) {
                if(e.type === 'keydown' && e.target !== this.$refs.chord) {
                    let b_search = o_actions.f_config('actions.search').bindings.some(b => b.source === 'keyboard' && b.keys.every(s => this.o_key.has(s)) && ['Ctrl', 'Alt', 'Shift', 'Meta'].every(s => !this.o_key.has(s) || b.keys.includes(s)));
                    if(b_search) { e.preventDefault(); this.$refs.search?.focus(); }
                    if(e.key === 'Escape') { e.preventDefault(); this.f_close(); }
                    if(!this.b_edit && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
                        e.preventDefault();
                        if(e.key === 'Enter') this.f_run(this.a_result[this.n_selected]);
                        else { this.n_selected = Math.max(0, Math.min(this.a_result.length - 1, this.n_selected + (e.key === 'ArrowDown' ? 1 : -1))); this.$nextTick(() => document.querySelector('.action-results .selected')?.scrollIntoView({ block: 'nearest' })); }
                    }
                }
                this.o_key.clear(); return;
            }
            let b_typing = !!e.target?.closest?.('input, textarea, select, [contenteditable]');
            if(b_typing && !e.ctrlKey && !e.metaKey && e.key !== 'F3') { this.o_key.clear(); o_actions.f_release(); return; }
            let b_match = o_actions.a_o_action.some(o => o_actions.f_config(o.id).bindings.some(b => b.source === 'keyboard' && b.keys.every(s => this.o_key.has(s))));
            if(b_match) e.preventDefault();
            o_actions.f_tick(this.o_key, this.o_pad);
        };
        this.f_blur = () => { this.o_key.clear(); this.o_pad = null; o_actions.f_release(); };
        this.f_visibility = () => { if(document.hidden) this.f_blur(); };
        window.addEventListener('keydown', this.f_key, true); window.addEventListener('keyup', this.f_key, true);
        window.addEventListener('blur', this.f_blur); document.addEventListener('visibilitychange', this.f_visibility);
        this.n_timer = setInterval(() => {
            if(document.hidden || !document.hasFocus() || this.o_action_ui.open) { this.f_blur(); return; }
            let a = []; try { a = Array.from(navigator.getGamepads?.() || []); } catch(_) {}
            this.o_pad = a.find(o => o?.connected && o.index === o_state.n_index__gamepad) || null;
            o_actions.f_tick(this.o_key, this.o_pad);
        }, 16);
    },
    beforeUnmount() { clearInterval(this.n_timer); this.f_blur(); window.removeEventListener('keydown', this.f_key, true); window.removeEventListener('keyup', this.f_key, true); window.removeEventListener('blur', this.f_blur); document.removeEventListener('visibilitychange', this.f_visibility); },
    template: `<teleport to="body"><div v-if="o_action_ui.error" class="action-error" role="alert">{{ o_action_ui.error }} <button @click="o_action_ui.error = ''">Dismiss</button></div>
    <div v-if="o_action_ui.open" class="action-backdrop" @click.self="f_close"><section class="action-dialog" role="dialog" aria-modal="true" aria-label="Actions and keybindings" @keydown.tab="if (!$event.shiftKey && $event.target === $refs.last) { $event.preventDefault(); $refs.search.focus(); } else if ($event.shiftKey && $event.target === $refs.search) { $event.preventDefault(); $refs.last.focus(); }">
    <input ref="search" v-model="s_query" @input="n_selected = 0" placeholder="Search actions…" aria-label="Search actions">
    <label><input type="checkbox" v-model="b_edit"> Edit bindings</label><button @click="f_close">Close</button>
    <div v-if="b_edit"><label>Profile <input v-model.lazy="s_profile" @change="f_profile"></label><button @click="f_reset(true)">Reset all</button><button @click="f_export">Export JSON</button><label>Import JSON <input type="file" accept=".json,application/json" @change="f_import"></label></div>
    <div class="action-results"><button v-for="(o, i) in a_result" :key="o.id" :class="{ selected: i === n_selected }" @click="b_edit ? f_select(o) : f_run(o)"><strong>{{ o.name }}</strong><small>{{ o.category }} · {{ o.description }}</small><kbd>{{ f_label(o) }}</kbd></button><p v-if="!a_result.length">No matching actions.</p></div>
    <form v-if="b_edit && o_edit" @submit.prevent="f_save"><h3>{{ s_id }}</h3><div v-for="(b, i) in o_edit.bindings">{{ b.source === 'keyboard' ? b.keys.join('+') : b.source + ' ' + b.index + ' / direction ' + b.direction }} <button type="button" @click="o_edit.bindings.splice(i, 1)">Remove</button></div>
    <select v-model="s_source" aria-label="Input source"><option>keyboard</option><option>button</option><option>axis</option></select><input v-if="s_source === 'keyboard'" ref="chord" :value="s_chord" @keydown="f_record" placeholder="Press keys together" aria-label="Record shortcut"><template v-else><label>Index <input type="number" min="0" max="255" v-model.number="n_index"></label><select v-model.number="n_direction" aria-label="Direction"><option :value="0">Both directions</option><option :value="1">Positive</option><option :value="-1">Negative</option></select></template><button type="button" @click="f_add">Add binding</button>
    <label>Repeat <select v-model="o_edit.repeat"><option>none</option><option>single-shot</option><option>auto-repeat</option></select></label><label v-for="s in ['delay', 'interval', 'threshold', 'deadzone', 'sensitivity', 'curve']">{{ s }}{{ ['delay', 'interval'].includes(s) ? ' (ms)' : '' }} <input type="number" step="any" v-model.number="o_edit[s]"></label>
    <button type="button" @click="o_edit.bindings = []">Clear bindings</button><button type="button" @click="f_reset(false)">Defaults</button><button type="submit">Save</button></form><button ref="last" @click="f_close">Done</button>
    </section></div></teleport>`,
};
export { o_component__actions };
