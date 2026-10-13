import assert from 'node:assert/strict';
const panels = ['filter', 'setup', 'camera_setting', 'scan'];
const javascript = text => new Response(text, {headers: {'content-type': 'text/javascript'}});

Deno.test('search reaches hidden inputs and reset icons restore individual settings', async () => {
    const dir = await Deno.makeTempDir();
    const templates = {};
    for await (const entry of Deno.readDir(new URL('../webserved_dir/', import.meta.url))) {
        if (!/^o_component__.*\.js$/.test(entry.name)) continue;
        const source = await Deno.readTextFile(new URL('../webserved_dir/' + entry.name, import.meta.url));
        const template = source.match(/template:\s*`([\s\S]*?)`,/);
        if (template) templates[entry.name.replace('.js', '')] = {template: template[1]};
    }
    const server = Deno.serve({hostname: '127.0.0.1', port: 0, onListen() {}}, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return javascript(`
            import { reactive } from './lib/vue.esm-browser.js';
            export const calls = { stop: 0, capture: 0, settings: {}, camera: [] };
            export const o_state = reactive({
                o_panel_visibility: ${JSON.stringify(Object.fromEntries(panels.map(key => [key, false])))},
                b_connected__server: true, b_connected__esp: true, s_transport__esp: 'usb', b_streaming__webcam: true,
                s_id__webcam_device: 'test', a_o_device__webcam: [{deviceId: 'test', label: 'Microscope camera'}],
                o_motor__axis: { x: 0, y: 1, z: 2 }, a_o_motor: [{b_running: false}],
                n_rpm__jog: 5, n_rpm__focus_jog: 0.5, o_key_held: {},
                o_record: { b_running: false, n_its__frame__done: 4 }, o_video: { b_recording: false },
                o_motion_detection: { b_enabled: false }, o_flat_field: { b_active: false },
                o_camera: { b_active: true, s_mode__exposure: 'manual', n_time__exposure: 10,
                    o_capability: { exposureMode: ['manual', 'continuous'], exposureTime: {min: 1, max: 100, step: 1} } },
                a_o_project: [{n_id: 1, s_name: 'Project one'}], a_o_slide: [{n_id: 2, n_o_project_n_id: 1, s_name: 'Slide one'}],
                a_o_map: [], a_o_map__scanned: [], a_o_setting: [], n_id__project__current: 0, n_id__slide__current: 0,
            });
            export function f_save_setting(key, value) { calls.settings[key] = JSON.parse(JSON.stringify(value)); }
            export const f_save_setting__debounced = f_save_setting;
            export function f_save_library_current() {}
            export function f_refresh_maps() {}
            export function f_send_esp_stop_all() { calls.stop++; }
            export function f_toggle_mouse_jog() { o_state.b_enabled__mouse_jog = !o_state.b_enabled__mouse_jog; }
        `);
        if (path === '/o_camera.module.js') return javascript(`
            import {calls, o_state} from './index.js';
            export const f_s_key__iso = () => null;
            export function f_apply_camera_setting(...args) { calls.camera.push(args); }
            export function f_set_camera_mode(key, value) { o_state.o_camera.s_mode__exposure = value; }
            export function f_apply_camera__saved() {}
        `);
        if (path === '/o_recording.module.js') return javascript(`import {o_state} from './index.js'; export function f_recording_stop() { o_state.o_record.b_running = false; }`);
        if (path === '/o_capture.module.js') return javascript(`import {calls} from './index.js'; export async function f_o_capture__frame() { calls.capture++; return {o_blob: new Blob(['test'])}; }`);

        if (path === '/templates.json') return Response.json(templates);
        if (path === '/o_flatfield.module.js') return javascript('export const f_b_flat__loaded=()=>false; export const f_o_flat=()=>null; export const f_b_flat__matches=()=>false;');
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><div id="app"></div><script type="module" src="/test.js"></script>`, {headers: {'content-type': 'text/html'}});
        if (path === '/test.js') return javascript(`
            import {createApp, nextTick, compile, reactive} from './lib/vue.esm-browser.js';
            import {o_component__toolbar} from './o_component__toolbar.js';
            import {o_component__manual_speed} from './o_component__manual_speed.js';
            import {o_component__filter, f_o_filter__default} from './o_component__filter.js';
            import {o_component__actions} from './o_component__actions.js';
            import {f_install_control_catalog, f_a_control_results, f_a_changed_controls, f_reset_control, f_reveal_control, o_control_ui} from './control_catalog.module.js';
            import {f_a_control_effects} from './control_effects.module.js';
            import {o_state, calls, f_save_setting__debounced} from './index.js';
            import {o_action_ui} from './o_actions.js';
            const check = (ok, text) => {if (!ok) throw Error(text);};
            const errors = [];
            const tick = async () => {await nextTick(); await new Promise(r => setTimeout(r, 20)); check(!errors.length, errors.join(' | '));};
            const edit = async (selector, value) => {
                const el = document.querySelector(selector); check(el, 'Missing ' + selector);
                el.focus(); el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
                if (el.type === 'checkbox') el.checked = value; else el.value = value;
                el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); await tick();
            };
            const click = async name => { const el = document.querySelector('button[aria-label="' + name + '"]'); check(el, 'Missing button ' + name); el.click(); await tick(); };
            let app;
            try {
                // Compile every production template after annotation, including nested controls.
                const templates = await (await fetch('/templates.json')).json();
                const compilerApp = createApp({});
                f_install_control_catalog(compilerApp, {components: templates, openPanel() {}});
                for (const [name, component] of Object.entries(templates)) {
                    compile(component.template, {onError(error) {throw Error(name + ': ' + error.message);}});
                }
                check(f_a_control_results().some(o => /Bright pixel threshold/.test(o.name)), 'Production inputs catalogued');
                check(f_a_control_results().some(o => /ESP32 IP/.test(o.name)), 'Connection inputs catalogued');
                o_state.b_streaming__webcam = false;
                o_state.o_filter = f_o_filter__default();
                o_state.o_filter.n_contrast = 1.7; // saved setting must have a reset immediately
                const local = reactive({amount: 4, notes: 'first line', extra: true, locked: false, secret: 'hidden', device: 'first'});
                const fixture = {data: () => ({local, o_state}), template: '<div class="overlay-panel panel-setup" :class="{visible:o_state.o_panel_visibility.setup}"><div class="panel-header">Setup</div><div class="panel-body"><details><summary>Advanced</summary><button aria-label="Optional controls" data-control-model="local.extra" data-control-reset="local.extra = value" @click="local.extra = !local.extra">Optional controls</button><label>Samples <input aria-label="Samples" type="number" v-model.number="local.amount" :disabled="local.locked"></label><label>Notes <textarea aria-label="Notes" :data-control-scope="local.device" v-model="local.notes"></textarea></label><input aria-label="Secret" type="password" v-model="local.secret"><label v-if="local.extra">Optional value <input aria-label="Optional value" v-model.number="local.amount"></label></details></div></div>'};
                const components = {o_component__toolbar, o_component__manual_speed, o_component__filter, o_component__actions, fixture};
                app = createApp({components, template:'<o_component__toolbar/><o_component__filter/><fixture/><o_component__actions/>'});
                for (const [name, component] of Object.entries(components)) app.component(name, component);
                app.config.warnHandler = message => errors.push(message);
                app.config.errorHandler = error => errors.push(error.stack);
                f_install_control_catalog(app, {components, openPanel(panel) {if (panel) o_state.o_panel_visibility[panel] = true;}, effects: f_a_control_effects(o_state, f_o_filter__default(), f_save_setting__debounced, () => calls.flat = true)});
                app.mount('#app'); await tick();
                check(document.querySelector('[aria-label="Reset Contrast"]'), 'Saved non-neutral contrast visible');
                check(!document.querySelector('[aria-label="Reset Brightness"]'), 'Neutral brightness absent');
                await click('Search actions'); check(o_action_ui.open, 'Toolbar search opens');
                await edit('.action-dialog input[aria-label="Search actions"]', 'brightness');
                check(document.querySelector('.action-results').textContent.includes('Brightness'), 'Setting search result');
                document.querySelector('.action-results button').click(); await tick();
                check(!o_action_ui.open && o_state.o_panel_visibility.filter, 'Selection opens filter panel');
                check(document.activeElement.matches('[aria-label^="Brightness"]'), 'Selected field receives focus');
                await edit('#filter-n_brightness', '0.22');
                check(o_state.o_filter.n_brightness === 0.22 && calls.settings.o_filter.n_brightness === 0.22, 'Exact input applied and persisted');
                check(document.querySelectorAll('[aria-label="Reset Brightness"]').length === 1, 'One icon per setting');
                o_state.o_panel_visibility.filter = false; await tick();
                await click('Reset Brightness');
                check(o_state.o_filter.n_brightness === 0 && o_state.o_filter.n_contrast === 1.7, 'Only selected effect resets');
                check(!o_state.o_panel_visibility.filter && !document.querySelector('[aria-label="Reset Brightness"]'), 'Reset without opening panel');
                o_state.o_panel_visibility.filter = true;
                await edit('#filter-n_gamma', ''); check(o_state.o_filter.n_gamma === 1, 'Empty gamma ignored');
                await edit('#filter-n_gamma', '-8'); check(o_state.o_filter.n_gamma === 0.2, 'Gamma bounds enforced');
                await click('Reset Gamma');
                await edit('[aria-label="Saturation slider"]', '0.5');
                await click('Reset Saturation'); check(o_state.o_filter.n_saturation === 1, 'Slider reset');
                o_state.o_filter.b_invert = true; o_state.o_filter.b_exposure__high = true; await tick();
                await click('Reset Invert'); check(!o_state.o_filter.b_invert && o_state.o_filter.b_exposure__high, 'Independent checkbox effects');
                await click('Reset Overexposed pixels');
                o_state.o_flat_field.b_active = true; o_state.o_motion_detection.b_enabled = true; await tick();
                await click('Reset Flat field correction'); await click('Reset Motion detection');
                check(calls.flat && !o_state.o_flat_field.b_active && !o_state.o_motion_detection.b_enabled, 'Features disabled from toolbar');
                const samples = f_a_control_results().find(o => o.name === 'Samples');
                await f_reveal_control(samples); await tick();
                check(document.querySelector('details').open && document.activeElement.getAttribute('aria-label') === 'Samples', 'Nested details opened and focused');
                await edit('[aria-label="Samples"]', '9');
                check(f_a_changed_controls().some(o => o.name === 'Samples'), 'Generic number tracked');
                o_state.o_panel_visibility.setup = false; await tick();
                local.locked = true; await tick(); await click('Reset Samples');
                check(local.amount === 9 && o_control_ui.notice.includes('locked'), 'Disabled field cannot be reset');
                local.locked = false; await tick(); await click('Reset Samples'); check(local.amount === 4, 'Prior number restored');
                await edit('[aria-label="Notes"]', 'two\\nlines');
                await click('Reset Notes'); check(local.notes === 'first line', 'Textarea restored');
                await edit('[aria-label="Notes"]', 'device-specific');
                local.device = 'second'; await tick();
                check(!document.querySelector('[aria-label="Reset Notes"]'), 'Different device clears the old reset');
                await click('Optional controls');
                check(!local.extra && document.querySelector('[aria-label="Reset Optional controls"]'), 'Toggle button tracked');
                await click('Reset Optional controls'); check(local.extra, 'Toggle button restored');
                await edit('[aria-label="Secret"]', 'new-secret');
                check(!document.querySelector('[aria-label="Reset Secret"]').title.includes('hidden') && !document.querySelector('[aria-label="Reset Secret"]').title.includes('new-secret'), 'Password omitted from tooltip');
                await click('Reset Secret');
                local.extra = true; await tick();
                await edit('[aria-label="Optional value"]', '12'); local.extra = false; await tick();
                await click('Reset Optional value'); check(local.amount === 4, 'Conditional model resets while unmounted');
                const conditional = f_a_control_results().find(o => o.name === 'Optional value');
                await f_reveal_control(conditional); check(o_control_ui.notice.includes('unavailable'), 'Conditional input stays searchable without changing its prerequisites');
                o_control_ui.notice = '';
                document.dispatchEvent(new KeyboardEvent('keydown', {key:'P', ctrlKey:true, shiftKey:true, bubbles:true})); await tick();
                check(o_action_ui.open && o_state.b_input_suspended, 'Ctrl+Shift+P opens palette and suspends movement');
                document.dispatchEvent(new KeyboardEvent('keyup', {key:'P', bubbles:true}));
                document.querySelector('.action-dialog input').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); await tick();
                check(!o_action_ui.open && !o_state.b_input_suspended, 'Escape closes and restores input');
                check(!errors.length, errors.join(' | '));
                document.body.dataset.result = 'PASS';
            } catch(error) {document.body.dataset.result = 'FAIL'; document.body.textContent = error.stack;}
            finally {app?.unmount();}
        `);
        try { return new Response(await Deno.readFile(new URL('../webserved_dir' + path, import.meta.url)), {headers: {'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript'}}); }
        catch { return new Response('', {status:404}); }
    });
    try {
        const result = await new Deno.Command('/usr/bin/google-chrome', {args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--user-data-dir=' + dir,
            '--virtual-time-budget=15000', '--dump-dom', 'http://127.0.0.1:' + server.addr.port,
        ], stdout:'piped', stderr:'piped'}).output();
        const html = new TextDecoder().decode(result.stdout);
        assert.ok(html.includes('data-result="PASS"'), html.slice(-8000) + '\n' + new TextDecoder().decode(result.stderr).slice(-1000));
    } finally {await server.shutdown(); await Deno.remove(dir, {recursive:true});}
});
