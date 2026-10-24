import assert from 'node:assert/strict';

// Real Vue, toolbar, speed controls and action registry; no camera or motors used.
const panels = ['motion_detection', 'setup', 'map', 'motion', 'gamepad', 'optics', 'slide_library', 'scan', 'camera_setting', 'led_setting', 'macro', 'auto_move', 'autostitch', 'filter', 'flat', 'focus', 'focus_step', 'focus_stack', 'scale', 'stats', 'cellpose', 'zoom', 'record', 'recording_library', 'video', 'training'];
const javascript = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });

for (const width of [1440, 800, 360, 320]) Deno.test(`compact toolbar actions and layout at ${width}px`, async () => {
    const dir = await Deno.makeTempDir();
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return javascript(`
            import { reactive } from './lib/vue.esm-browser.js';
            export const calls = { stop: 0, capture: 0, settings: {}, camera: [] };
            export const o_state = reactive({
                o_panel_visibility: ${JSON.stringify(Object.fromEntries(panels.map(key => [key, false])))},
                b_connected__server: true, b_connected__esp: true, b_streaming__webcam: true,
                s_id__webcam_device: 'test', a_o_device__webcam: [{deviceId: 'test', label: 'Microscope camera'}],
                o_motor__axis: { x: 0, y: 1, z: 2 }, a_o_motor: [{b_running: false}],
                n_rpm__jog: 5, n_rpm__focus_jog: 0.5, o_key_held: {},
                o_record: { b_running: false, n_its__frame__done: 4 }, o_video: { b_recording: false },
                o_filter: { n_brightness: 0, n_contrast: 1, n_gamma: 1, n_saturation: 1 },
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
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
            <link rel="stylesheet" href="/index.css"><div id="app"></div><script type="module" src="/test.js"></script>`, { headers: { 'content-type': 'text/html' } });
        if (path === '/test.js') return javascript(`
            import {createApp, nextTick} from './lib/vue.esm-browser.js';
            import {o_component__toolbar} from './o_component__toolbar.js';
            import {o_component__manual_speed} from './o_component__manual_speed.js';
            import {o_component__actions} from './o_component__actions.js';
            import {f_install_overlay_windows} from './overlay_windows.module.js';
            import {o_state, calls} from './index.js';
            import {o_action_ui} from './o_actions.js';
            import {f_install_control_catalog, f_a_control_results, f_reveal_control} from './control_catalog.module.js';
            import {f_a_control_effects} from './control_effects.module.js';
            import {f_save_setting__debounced} from './index.js';
            const check = (ok, message) => { if (!ok) throw Error(message); };
            const errors = [];
            const tick = async () => { await nextTick(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await new Promise(resolve => setTimeout(resolve, 20)); check(!errors.length, errors.join('\\n')); };
            const visible = el => el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).visibility !== 'hidden';
            const button = name => [...document.querySelectorAll('button')].find(el => visible(el) && (el.getAttribute('aria-label') || el.textContent.trim()) === name);
            const click = async name => { check(button(name), 'Missing button: ' + name); button(name).click(); await tick(); };
            const change = async (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); await tick(); };
            const makeApp = (withActions = true) => {
                const app = createApp({components: {bar: o_component__toolbar, actions: o_component__actions}, template: '<bar ref="bar"/>' + (withActions ? '<actions/>' : '')});
                app.component('o_component__manual_speed', o_component__manual_speed);
                f_install_control_catalog(app, {components:{o_component__toolbar, o_component__manual_speed},
                    openPanel(panel) { if(panel) o_state.o_panel_visibility[panel] = true; },
                    effects:f_a_control_effects(o_state, {n_brightness:0, n_contrast:1, n_gamma:1, n_saturation:1}, f_save_setting__debounced, () => {})});
                app.config.warnHandler = message => errors.push(message);
                app.config.errorHandler = error => errors.push(error.stack);
                return {app, root: app.mount('#app')};
            };
            let app;
            try {
                HTMLAnchorElement.prototype.click = function() { window.downloadName = this.download; };
                let mounted = makeApp(); app = mounted.app;
                await tick();
                const cleanupWindows = f_install_overlay_windows();
                const context = async el => { el.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true})); await tick(); };
                const tool = id => document.querySelector('#toolbar-tools .toolbar-tool[data-tool="' + id + '"]');
                const shortcut = id => document.querySelector('.toolbar-shortcut[data-tool="' + id + '"]');
                const openTools = async () => { if (!visible(document.querySelector('#toolbar-tools'))) await click('All tools'); };
                const choose = async id => { await openTools(); tool(id).click(); await tick(); };
                const bar = document.querySelector('.toolbar');
                const initialHeight = bar.offsetHeight;
                check(initialHeight <= 56, 'One row at every width: ' + initialHeight);
                check(!visible(document.querySelector('#toolbar-details')), 'Quick settings start closed');
                check(!visible(document.querySelector('#toolbar-tools')), 'Tools start closed');
                for (const el of document.querySelectorAll('.toolbar-row--primary button')) {
                    check(el.title && el.getAttribute('aria-label'), 'Missing accessible name or tooltip');
                }
                for (const el of document.querySelectorAll('.toolbar-group--utilities button, .toolbar-select')) {
                    const rect = el.getBoundingClientRect();
                    check(rect.x >= 0 && rect.right <= innerWidth && rect.bottom <= initialHeight, 'Fixed control outside bar');
                }
                check(bar.scrollWidth <= innerWidth, 'Toolbar overflow');
                await click('LED settings');
                check(o_state.o_panel_visibility.led_setting && !o_state.o_panel_visibility.setup && calls.settings.o_panel_visibility.led_setting, 'LED settings open directly and persist without Setup');
                check(button('LED settings').getAttribute('aria-pressed') === 'true', 'LED toolbar button reflects panel visibility');
                await click('LED settings');
                check(!o_state.o_panel_visibility.led_setting, 'LED toolbar button closes panel');
                await click('Capture Image'); check(calls.capture === 1 && window.downloadName.startsWith('capture-'), 'Capture dispatch');
                await click('Mouse movement'); check(o_state.b_enabled__mouse_jog && button('Mouse movement').getAttribute('aria-pressed') === 'true', 'Mouse movement dispatch');
                await click('Reset Mouse movement'); check(!o_state.b_enabled__mouse_jog, 'Mouse movement can be reset directly');
                for (const name of ['Scan', 'Focus', 'Zoom']) { await click(name); check(o_state.o_panel_visibility[name.toLowerCase()], 'Quick panel: ' + name); }
                await click('Stop all motors'); check(calls.stop === 1, 'Stop dispatch');
                await change('[aria-label="Movement speed preset"]', 'Fast');
                check(o_state.n_rpm__jog === 10 && o_state.n_rpm__focus_jog === 1.5 && calls.settings.o_rpm__manual.z === 1.5, 'Speed preset updates both axes');
                check(!document.querySelector('#quick-speed-z'), 'No numeric speeds in the main bar');
                await choose('quick_settings');
                check(visible(document.querySelector('#toolbar-details')), 'Quick settings open as an overlay');
                const detailsBody = document.querySelector('#toolbar-details .panel-body');
                check(detailsBody.scrollWidth <= detailsBody.clientWidth, 'Quick settings fit without horizontal scrolling');
                check(bar.offsetHeight === initialHeight, 'Opening settings does not grow the bar');
                await change('#toolbar-speed-z', '0.25'); check(o_state.n_rpm__jog === 10 && o_state.n_rpm__focus_jog === 0.25, 'Independent focus speed');
                check(document.querySelector('[aria-label="Movement speed preset"]').value === '', 'Custom speed label');
                o_state.o_motor__axis.z = null; await tick(); check(document.querySelector('#toolbar-speed-z').disabled, 'Unassigned Z lock'); o_state.o_motor__axis.z = 2;
                await change('#toolbar-project', '1'); await change('#toolbar-slide', '2');
                check(o_state.n_id__project__current === 1 && o_state.n_id__slide__current === 2, 'Project and slide selection');
                await change('.toolbar-cam-value', '25'); check(calls.camera[0]?.[1] === 25, 'Camera tuning');
                await click('Close quick settings');
                window.dispatchEvent(new Event('control-show-quick-settings')); await tick();
                check(visible(document.querySelector('#toolbar-details')), 'Search can reveal quick settings');
                await click('Close quick settings');
                await click('Search actions'); check(o_action_ui.open, 'Action search opens');
                check(document.querySelector('.action-dialog .panel-header'), 'Search has a draggable header'); await click('Close');
                const searchTool = f_a_control_results().find(item => item.name === 'Video' && item.target?.el.closest('#toolbar-tools'));
                check(searchTool, 'Hidden tool is searchable');
                await f_reveal_control(searchTool); await tick();
                check(visible(document.querySelector('#toolbar-tools')), 'Search reveals hidden tool window');
                await click('Close tools');
                await openTools();
                const menu = document.querySelector('#toolbar-tools');
                check(document.activeElement === button('Close tools'), 'Tools keyboard focus');
                const menuRect = menu.getBoundingClientRect();
                check(menuRect.left >= 0 && menuRect.right <= innerWidth && menuRect.bottom <= innerHeight, 'Tools fit viewport');
                check(!bar.contains(menu), 'Tools are outside the toolbar');
                const tools = mounted.root.$refs.bar.a_o_tool_group.flatMap(group => group.a_o_tool);
                check(${JSON.stringify(panels)}.every(panel => tools.some(tool => tool.s_panel === panel)), 'Every panel is available in Tools');
                const previousCapture = calls.capture;
                await context(tool('video'));
                check(shortcut('video') && !o_state.o_panel_visibility.video && calls.capture === previousCapture, 'Right-click pins without running a tool');
                check(JSON.parse(localStorage.getItem('omm.toolbar.pins')).includes('video'), 'Pin persisted');
                await click('Unpin Video'); check(!shortcut('video'), 'Keyboard/touch pin button removes shortcut');
                await click('Pin Video'); check(shortcut('video'), 'Keyboard/touch pin button adds shortcut');
                await context(shortcut('video')); check(!shortcut('video'), 'Right-click on bar removes shortcut');
                await context(tool('video'));
                // Reopening keeps the same window element and position.
                menu.style.setProperty('--panel-x', '10px'); menu.style.setProperty('--panel-y', '70px'); menu.dataset.panelMoved = '';
                await click('Close tools'); await openTools();
                check(menu === document.querySelector('#toolbar-tools') && menu.getBoundingClientRect().x === 10, 'Tools retain position');
                document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); await tick();
                check(visible(menu), 'Overlay remains open when interacting with the workspace');
                for (const item of tools.filter(item => item.s_panel in o_state.o_panel_visibility)) {
                    o_state.o_panel_visibility[item.s_panel] = false;
                    await choose(item.s_panel);
                    check(o_state.o_panel_visibility[item.s_panel], 'Tool opens: ' + item.s_panel);
                    check(!visible(menu), 'Tools close after choice');
                }
                await openTools();
                document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                document.dispatchEvent(new KeyboardEvent('keyup', {key:'Escape', bubbles:true})); await tick();
                check(!visible(menu) && document.activeElement === button('All tools'), 'Escape closes and restores focus');
                check(calls.stop === 2, 'Escape still stops motors');
                o_state.o_record.b_running = true; o_state.o_video.b_recording = true; o_state.o_motion_detection.b_enabled = true; o_state.o_flat_field.b_active = true; await tick();
                check(button('Stop time-lapse recording') && button('Video recording') && button('Motion detection on') && button('Flat field on'), 'Active processes remain accessible');
                check(bar.offsetHeight === initialHeight, 'Activity never adds toolbar rows');
                await click('Stop time-lapse recording'); check(!o_state.o_record.b_running, 'Recording stop');
                o_state.o_camera.s_error__setting = 'Camera rejected setting'; await tick();
                check(visible(document.querySelector('.toolbar-error')), 'Camera errors remain visible in an overlay');
                check(bar.offsetHeight === initialHeight, 'Errors do not grow the bar');
                await click('Dismiss notice');
                o_state.b_flashing = true; o_state.o_panel_visibility.setup = true; await click('Setup');
                check(o_state.o_panel_visibility.setup, 'Setup stays open during flashing'); o_state.b_flashing = false;
                const camera = document.querySelector('.toolbar-camera-select').parentElement;
                camera.dispatchEvent(new PointerEvent('pointerover', {bubbles:true}));
                check(!document.querySelector('.ui-tooltip').hidden && document.querySelector('.ui-tooltip').textContent.includes('Microscope camera'), 'Camera tooltip appears immediately with full name');
                document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
                check(document.querySelector('.ui-tooltip').hidden, 'Escape dismisses tooltip');
                app.unmount();
                check(!document.querySelector('.ui-tooltip'), 'Tooltip cleanup');
                mounted = makeApp(false); app = mounted.app; await tick();
                check(shortcut('video'), 'Saved shortcuts survive remount');
                check(!visible(document.querySelector('#toolbar-details')), 'Settings start closed on reload');
                o_state.o_video.b_recording = false; o_state.o_motion_detection.b_enabled = false; o_state.o_flat_field.b_active = false;
                await tick();
                check(!o_action_ui.error, 'Action error: ' + o_action_ui.error);
                Object.assign(o_state.o_filter, {n_brightness:0.2, n_contrast:1.4, n_gamma:1.3, n_saturation:0.6}); await tick();
                check(document.querySelectorAll('.toolbar-setting-reset').length === 4, 'Changed setting icons visible');
                check(document.querySelector('.toolbar').scrollWidth <= innerWidth, 'Active icons do not overflow toolbar');
                check(document.querySelector('.toolbar').offsetHeight === initialHeight, 'Changed settings stay on one row');
                await click('Reset Brightness'); check(o_state.o_filter.n_brightness === 0 && o_state.o_filter.n_contrast === 1.4, 'Toolbar reset is independent');
                // Persisting an empty bar is intentional; unknown or duplicate IDs are ignored.
                app.unmount(); localStorage.setItem('omm.toolbar.pins', '[]');
                mounted = makeApp(false); app = mounted.app; await tick();
                check(document.querySelectorAll('.toolbar-shortcut').length === 0, 'Empty shortcuts stay empty');
                app.unmount(); localStorage.setItem('omm.toolbar.pins', '["video","unknown","video"]');
                mounted = makeApp(false); app = mounted.app; await tick();
                check(document.querySelectorAll('.toolbar-shortcut').length === 1 && shortcut('video'), 'Saved pins validated');
                await openTools();
                window.previewBar = mounted.root.$refs.bar;
                cleanupWindows();
                document.body.setAttribute('data-result', 'PASS');
            } catch(error) { document.body.setAttribute('data-result', 'FAIL: ' + error.stack); }
        `);
        try {
            return new Response(await Deno.readTextFile(new URL('../webserved_dir' + path, import.meta.url)),
                { headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } });
        } catch { return new Response('', { status: 404 }); }
    });
    let chrome, socket;
    try {
        chrome = new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--user-data-dir=' + dir,
            '--remote-debugging-port=0', 'about:blank',
        ], stdout: 'null', stderr: 'piped' }).spawn();
        const reader = chrome.stderr.getReader();
        let output = '', address;
        while (!address) {
            const { value, done } = await reader.read();
            if (done) throw Error('Chrome startup failed: ' + output);
            output += new TextDecoder().decode(value);
            address = output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
        }
        // Drain Chrome diagnostics while the process runs.
        const drained = (async () => { while (!(await reader.read()).done) {} })();
        const pages = await (await fetch(address.replace(/^ws:/, 'http:').replace(/\/devtools\/.*/, '/json/list'))).json();
        socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
        await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
        let sequence = 0;
        const pending = new Map();
        socket.addEventListener('message', event => {
            const message = JSON.parse(event.data);
            if (!pending.has(message.id)) return;
            const { resolve, reject } = pending.get(message.id);
            pending.delete(message.id);
            message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result);
        });
        const send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, {resolve, reject});
            socket.send(JSON.stringify({id, method, params}));
        });
        await send('Emulation.setDeviceMetricsOverride', {width, height: 900, deviceScaleFactor: 1, mobile: false});
        await send('Page.navigate', {url: 'http://127.0.0.1:' + server.addr.port});
        let result;
        for (let attempt = 0; attempt < 200; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            result = (await send('Runtime.evaluate', {expression: 'document.body?.getAttribute("data-result")'})).result.value;
            if (result) break;
        }
        const screenshot = await send('Page.captureScreenshot', {format: 'png'});
        await Deno.writeFile('/tmp/omm-toolbar-' + width + '.png', Uint8Array.from(atob(screenshot.data), c => c.charCodeAt(0)));
        if (result === 'PASS') {
            await send('Runtime.evaluate', {expression: 'previewBar.b_tools = false; previewBar.b_details = true'});
            await new Promise(resolve => setTimeout(resolve, 100));
            const details = await send('Page.captureScreenshot', {format: 'png'});
            await Deno.writeFile('/tmp/omm-settings-' + width + '.png', Uint8Array.from(atob(details.data), c => c.charCodeAt(0)));
        }
        await send('Browser.close');
        socket.close(); socket = null;
        await chrome.status; chrome = null;
        await drained;
        assert.equal(result, 'PASS');
    } finally {
        socket?.close();
        if (chrome) { chrome.kill(); await chrome.status; }
        await server.shutdown();
        // Chrome helper processes can finish writing the temporary profile after the parent exits.
        for (let attempt = 0; ; attempt++) {
            try { await Deno.remove(dir, {recursive: true}); break; }
            catch (error) { if (attempt >= 5) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
        }
    }
});
