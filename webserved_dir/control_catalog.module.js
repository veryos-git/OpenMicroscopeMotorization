import { shallowReactive, nextTick } from './lib/vue.esm-browser.js';

// Catalogue entries come from templates, so conditional controls are searchable
// even before a camera is connected. Live instances supply their resolved labels.
const a_catalog = [];
const o_live = new Map();
const o_changed = shallowReactive(new Map());
const a_effect = [];
const o_templates = new WeakMap();
const o_supplement = new Map();
const o_control_ui = shallowReactive({ notice: '' });
let f_open_panel = () => {};
let n_instance = 0;
const o_icon = { filter: 'filter', camera_setting: 'camera', flat: 'flat', setup: 'setup', scan: 'scan', focus: 'focus', record: 'record', video: 'video', training: 'training', gamepad: 'gamepad', motion_detection: 'detection', scale: 'scale', zoom: 'zoom', macro: 'macro' };
const f_human = s => String(s || '').replace(/\b[abnosv]_+/g, '').replaceAll('_', ' ').trim();
const f_text = s => String(s || '').replace(/{{[\s\S]*?}}/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const f_escape = s => String(s).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const f_scalar = v => v == null || ['string', 'number', 'boolean'].includes(typeof v);
const f_equal = (a, b) => Object.is(a, b) || (a != null && b != null && String(a) === String(b));
const f_value = el => el.type === 'checkbox' ? el.checked : el.value;
const f_label = (el, fallback) => {
    const siblingLabel = el.previousElementSibling?.tagName === 'LABEL' ? el.previousElementSibling.textContent : '';
    const label = el.getAttribute('aria-label') || [...(el.labels || [])].map(l => l.textContent).join(' ') || siblingLabel || el.getAttribute('title') || (el.tagName === 'BUTTON' ? el.textContent : '');
    // Include repeated row headings (motor number, camera property, etc.).
    const group = el.closest('.camera-setting-group, .hardware-motor');
    const heading = group?.querySelector('strong, h3')?.textContent?.trim();
    const name = f_text(label) || fallback;
    return [heading === name ? '' : heading, name].filter(Boolean).join(' · ').slice(0, 160);
};
const f_blocked = el => el.disabled || !!el.closest('fieldset:disabled');

function f_sync(record) {
    if (!record.changed) return;
    if (f_equal(record.read(), record.before)) {
        record.changed = false;
        o_changed.delete(record.id);
    } else {
        const current = o_changed.get(record.id);
        if (!current || !f_equal(current.value, record.read()) || current.name !== record.name) o_changed.set(record.id, { ...record, value: record.read() });
    }
}

const o_track = {
    mounted(el, binding) {
        const definition = a_catalog.find(o => o.id === binding.arg);
        if (!definition) return;
        const record = { ...definition, baseName: definition.name, id: definition.id + ':' + ++n_instance, el, owner: binding.instance, binding: binding.value, changed: false };
        record.read = () => record.binding?.read ? record.binding.read() : f_value(el);
        record.scope = record.binding?.scope?.();
        record.before = record.read();
        record.name = f_label(el, definition.name);
        record.reset = async () => {
            if (record.scope !== record.binding?.scope?.()) throw Error(record.name + ' belongs to a different device.');
            if (f_blocked(el) || record.binding?.blocked?.()) throw Error(record.name + ' is locked. Finish the current operation or enable its controls first.');
            if (record.binding?.restore) {
                await record.binding.restore(record.before);
                await nextTick();
                f_sync(record);
                return;
            }
            if (record.binding?.write) record.binding.write(record.before);
            if (el.type === 'checkbox') el.checked = record.before;
            else el.value = record.before ?? '';
            // Use the same input/change handlers as manual editing: validation,
            // hardware application and persistence stay with the owning control.
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            await nextTick();
            f_sync(record);
        };
        record.capture = () => { if (!record.changed) record.before = record.read(); };
        record.change = () => {
            if (definition.effect || el.type === 'file' || (el.tagName === 'BUTTON' && !record.binding?.restore)) return;
            nextTick(() => {
                if (!f_scalar(record.before) || !f_scalar(record.read())) return;
                record.changed = true;
                record.name = f_label(el, definition.name);
                f_sync(record);
            });
        };
        for (const event of ['focusin', 'pointerdown', 'keydown']) el.addEventListener(event, record.capture);
        for (const event of ['input', 'change', 'click']) el.addEventListener(event, record.change);
        el._controlRecord = record;
        o_live.set(record.id, record);
    },
    updated(el, binding) {
        const record = el._controlRecord;
        if (!record) return;
        record.binding = binding.value;
        if (record.scope !== record.binding?.scope?.()) {
            record.scope = record.binding?.scope?.();
            record.changed = false;
            record.before = record.read();
            o_changed.delete(record.id);
        }
        record.name = f_label(el, record.baseName);
        f_sync(record);
    },
    unmounted(el) {
        const record = el._controlRecord;
        if (!record) return;
        o_live.delete(record.id);
        // Conditional v-model fields retain their scoped model and reset handler.
        // Controls without a model cannot safely be restored after removal.
        if (!record.binding?.write) o_changed.delete(record.id);
        for (const event of ['focusin', 'pointerdown', 'keydown']) el.removeEventListener(event, record.capture);
        for (const event of ['input', 'change', 'click']) el.removeEventListener(event, record.change);
    },
};

function f_prepare_component(component, key, inheritedPanel, seen) {
    if (!component || seen.has(component)) return;
    seen.add(component);
    const source = o_templates.get(component) ?? component.template ?? '';
    o_templates.set(component, source);
    const panel = source.match(/o_panel_visibility\.([a-z_]+)/)?.[1] || inheritedPanel;
    if (source && !key.includes('actions') && !key.includes('icon')) {
        let index = 0;
        component.template = source.replace(/<(input|select|textarea|button)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g, (tag, kind, offset) => {
            if (/class="[^"]*panel-close/.test(tag) || /data-control-skip/.test(tag)) return tag;
            const el = document.createElement('template');
            el.innerHTML = tag + (kind === 'input' ? '' : '</' + kind + '>');
            const attrs = el.content.firstElementChild;
            const model = [...attrs.attributes].find(a => /^v-model(?:\.|$)/.test(a.name))?.value;
            const read = model || attrs.getAttribute('data-control-model') || attrs.getAttribute(':value');
            const restore = attrs.getAttribute('data-control-reset');
            const blocked = attrs.getAttribute(':disabled');
            const scope = attrs.getAttribute(':data-control-scope');
            const before = source.slice(Math.max(0, offset - 500), offset);
            const after = source.slice(offset + tag.length).split('</' + (kind === 'button' ? 'button' : 'label') + '>')[0];
            const label = before.match(/<(?:label|span|strong)[^>]*>([^<>]*)(?:<\/[^>]+>)?\s*$/)?.[1];
            let name = attrs.getAttribute('aria-label') || f_text(kind === 'button' ? after : label) || attrs.getAttribute('placeholder') || attrs.getAttribute('title') ||
                (kind === 'button' ? [...after.matchAll(/'([^']+)'/g)].map(m => m[1]).join(' / ') : '') || f_human(model?.split('.').at(-1)) || (kind === 'select' ? 'Options' : 'Value');
            // Preserve useful words inside dynamic labels as searchable keywords.
            const keywords = [model, read, f_text(label), attrs.getAttribute('placeholder'), attrs.getAttribute('title'), attrs.getAttribute(':aria-label'), attrs.getAttribute(':title'), kind === 'select' ? f_text(after.split('</select>')[0]) : '', f_human(key)].join(' ');
            const id = 'control-' + key.replace(/[^a-z0-9_-]/gi, '-') + '-' + index++;
            const effect = attrs.getAttribute('data-control-effect') || (key.includes('filter') && model?.startsWith('o_filter.') ? 'filter.' + model.slice(9) : null);
            a_catalog.push({ id, name: f_text(name), category: f_human(panel || 'Application'), panel, keywords, icon: o_icon[panel] || 'settings', effect, kind: kind === 'button' ? 'control' : 'setting' });
            const value = `{ ${read ? `read: () => (${read}),` : ''} ${model ? `write: value => (${model} = value),` : ''} ${restore ? `restore: value => (${restore}),` : ''} ${blocked ? `blocked: () => (${blocked}),` : ''} ${scope ? `scope: () => (${scope}),` : ''} }`;
            return tag.replace(/\/?>(\s*)$/, ` data-control-id="${id}" v-control-track:${id}="${f_escape(value)}"${tag.endsWith('/>') ? ' /' : ''}>`);
        });
    }
    for (const [childKey, child] of Object.entries(component.components || {})) f_prepare_component(child, childKey, panel, seen);
}

function f_install_control_catalog(app, { components, openPanel, effects = [] }) {
    a_catalog.length = 0;
    o_live.clear();
    o_changed.clear();
    o_supplement.clear();
    f_open_panel = openPanel;
    a_effect.splice(0, a_effect.length, ...effects);
    app.directive('control-track', o_track);
    app.mixin({ mounted() {
        if (this.$options.controlSearch) o_supplement.set(this, () => this.$options.controlSearch.call(this));
    }, beforeUnmount() {
        o_supplement.delete(this);
        for (const [id, item] of o_changed) if (item.owner === this) o_changed.delete(id);
    } });
    const seen = new Set();
    for (const [key, component] of Object.entries(components)) {
        const parent = /calibration|backlash|jog|manual_speed/.test(key) ? 'setup' : /training/.test(key) ? 'training' : /hardware_crop/.test(key) ? 'camera_setting' : undefined;
        f_prepare_component(component, key, parent, seen);
    }
}

function f_a_control_results() {
    const live = [...o_live.values()];
    const entries = a_catalog.flatMap(def => {
        const instances = live.filter(item => item.el.dataset.controlId === def.id);
        const entries = instances.length ? instances.map(item => ({ ...def, id: item.id, name: f_label(item.el, def.name), target: item })) : [def];
        return entries.map(item => ({ ...item, description: item.kind === 'setting' ? 'Go to setting' : 'Go to control' }));
    });
    for (const getItems of o_supplement.values()) {
        for (const item of getItems()) {
            if (!document.querySelector(item.selector)) entries.push({ ...item, kind: 'setting', category: f_human(item.panel), description: 'Go to setting' });
        }
    }
    return entries;
}

async function f_reveal_control(item) {
    o_control_ui.notice = '';
    f_open_panel(item.panel);
    await nextTick();
    const id = item.target?.el.dataset.controlId || item.id;
    const el = item.target?.el.isConnected ? item.target.el : document.querySelector(item.selector || `[data-control-id="${id}"]`);
    if (el) {
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS') parent.open = true;
        }
        if (el.closest('#toolbar-details')) window.dispatchEvent(new Event('control-show-quick-settings'));
        await nextTick();
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (!f_blocked(el)) el.focus({ preventScroll: true });
        el.classList.add('control-highlight');
        setTimeout(() => el.classList.remove('control-highlight'), 2400);
        if (!f_blocked(el) && el.getBoundingClientRect().height) return;
    }
    o_control_ui.notice = item.name + ' is currently unavailable. Its ' + item.category + ' controls are open; check the required device or mode there.';
}

function f_a_changed_controls() {
    return [
        ...a_effect.filter(effect => !f_equal(effect.read(), effect.before)).map(effect => ({ ...effect, value: effect.read() })),
        ...[...o_changed.values()].filter(item => !item.effect && item.scope === item.binding?.scope?.() && !f_equal(item.read(), item.before)).map(item => ({ ...item, value: item.read() })),
    ];
}

async function f_reset_control(item) {
    o_control_ui.notice = '';
    try { await item.reset(); }
    catch (error) { o_control_ui.notice = error.message || String(error); }
}

function f_reset_title(item) {
    if (item.el?.type === 'password') return 'Restore ' + item.name + ' to its previous value';
    const format = value => typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value ?? 'empty').slice(0, 60);
    return item.name + ': ' + format(item.value) + ' — click to ' + (item.before === false ? 'turn off' : 'restore ' + format(item.before));
}

export { f_install_control_catalog, f_a_control_results, f_reveal_control, f_a_changed_controls, f_reset_control, f_reset_title, o_control_ui };
