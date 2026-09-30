import assert from 'node:assert/strict';

// Real Vue, toolbar, speed controls and action registry; no camera or motors used.
const panels = ['motion_detection', 'setup', 'map', 'motion', 'gamepad', 'optics', 'slide_library', 'scan', 'camera_setting', 'manual_stitch', 'macro', 'auto_move', 'autostitch', 'filter', 'flat', 'focus', 'focus_step', 'focus_stack', 'scale', 'stats', 'cellpose', 'zoom', 'record', 'recording_library', 'video', 'training'];
const javascript = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });

for (const width of [1440, 800, 360]) Deno.test(`compact toolbar actions and layout at ${width}px`, async () => {
    const dir = await Deno.makeTempDir();
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
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
                app.config.warnHandler = message => errors.push(message);
                app.config.errorHandler = error => errors.push(error.stack);
                return {app, root: app.mount('#app')};
            };
            let app;
            try {
                HTMLAnchorElement.prototype.click = function() { window.downloadName = this.download; };
                let mounted = makeApp(); app = mounted.app;
                await tick();
                const panel = document.createElement('div');
                panel.className = 'overlay-panel visible'; panel.dataset.panelMoved = '';
                panel.style.cssText = 'width:240px;height:140px;--panel-x:10px;--panel-y:' + document.querySelector('.toolbar').offsetHeight + 'px';
                panel.innerHTML = '<div class="panel-header">Moved window</div>';
                document.body.append(panel);
                const cleanupWindows = f_install_overlay_windows();
                check(!visible(document.querySelector('#toolbar-details')), 'Details should start collapsed');
                check(!document.querySelector('#toolbar-tools'), 'Tools should start collapsed');
                const initialHeight = document.querySelector('.toolbar').offsetHeight;
                check(innerWidth < 1100 || initialHeight <= 60, 'Desktop toolbar should fit one row: ' + initialHeight);
                for (const el of document.querySelectorAll('.toolbar-row--primary button')) {
                    check(el.title && el.getAttribute('aria-label'), 'Missing accessible name or tooltip');
                    const rect = el.getBoundingClientRect();
                    check(rect.x >= 0 && rect.right <= innerWidth && rect.bottom < innerHeight, 'Primary button outside viewport');
                }
                check(document.querySelector('.toolbar').scrollWidth <= innerWidth, 'Toolbar overflow');
                await click('Capture Image'); check(calls.capture === 1 && window.downloadName.startsWith('capture-'), 'Capture dispatch');
                await click('Mouse movement'); check(o_state.b_enabled__mouse_jog && button('Mouse movement').getAttribute('aria-pressed') === 'true', 'Mouse movement dispatch');
                for (const name of ['Scan', 'Focus', 'Zoom']) { await click(name); check(o_state.o_panel_visibility[name.toLowerCase()], 'Quick panel: ' + name); }
                await click('Stop all motors'); check(calls.stop === 1, 'Stop dispatch');
                await change('[aria-label="Movement speed preset"]', 'Fast');
                check(o_state.n_rpm__jog === 10 && o_state.n_rpm__focus_jog === 1.5 && calls.settings.o_rpm__manual.z === 1.5, 'Compact speed preset');
                await change('#quick-speed-z', '0.25'); check(o_state.n_rpm__jog === 10 && o_state.n_rpm__focus_jog === 0.25, 'Independent focus speed');
                check(document.querySelector('[aria-label="Movement speed preset"]').value === '', 'Custom speed label');
                o_state.o_motor__axis.z = null; await tick(); check(document.querySelector('#quick-speed-z').disabled, 'Unassigned Z lock'); o_state.o_motor__axis.z = 2;
                await click('Quick settings');
                check(visible(document.querySelector('#toolbar-details')) && localStorage.getItem('omm.toolbar.details') === 'true', 'Expand and persist settings');
                check(document.querySelector('#toolbar-speed-z').value === '0.25', 'Shared speed values');
                check(parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h')) === document.querySelector('.toolbar').offsetHeight, 'Overlay offset updated');
                check(panel.getBoundingClientRect().top >= document.querySelector('.toolbar').offsetHeight, 'Moved window remains below expanded settings');
                panel.remove(); cleanupWindows();
                await change('#toolbar-project', '1'); await change('#toolbar-slide', '2');
                check(o_state.n_id__project__current === 1 && o_state.n_id__slide__current === 2, 'Project and slide selection');
                await change('.toolbar-cam-value', '25'); check(calls.camera[0]?.[1] === 25, 'Camera tuning');
                await click('Quick settings');
                for (const name of ['Search actions']) { await click(name); check(o_action_ui.open, 'Action search opens'); await click('Close'); }
                const expectedPanels = ${JSON.stringify(panels.filter(key => !['scan', 'focus', 'zoom', 'setup'].includes(key)))};
                await click('All tools');
                check(visible(document.querySelector('#toolbar-tools')), 'Tools open');
                check(document.activeElement === button('Close tools'), 'Tools keyboard focus');
                const menuRect = document.querySelector('#toolbar-tools').getBoundingClientRect();
                check(menuRect.left >= 0 && menuRect.right <= innerWidth && menuRect.bottom <= innerHeight, 'Tools fit viewport');
                const tools = mounted.root.$refs.bar.a_o_tool_group.flatMap(group => group.a_o_tool);
                check(expectedPanels.every(panel => tools.some(tool => tool.s_panel === panel)), 'Every existing panel is reachable');
                for (const tool of tools) {
                    if (!document.querySelector('#toolbar-tools')) await click('All tools');
                    await click(tool.s_label);
                    check(o_state.o_panel_visibility[tool.s_panel], 'Tool opens: ' + tool.s_panel);
                    check(!document.querySelector('#toolbar-tools'), 'Tools close after choice');
                }
                await click('All tools');
                document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
                document.dispatchEvent(new KeyboardEvent('keyup', {key:'Escape', bubbles:true})); await tick();
                check(!document.querySelector('#toolbar-tools') && document.activeElement === button('All tools'), 'Escape closes and restores focus');
                check(calls.stop === 2, 'Escape still stops motors');
                await click('All tools'); document.body.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})); await tick();
                check(!document.querySelector('#toolbar-tools'), 'Outside click closes tools');
                o_state.o_record.b_running = true; o_state.o_video.b_recording = true; o_state.o_motion_detection.b_enabled = true; o_state.o_flat_field.b_active = true; await tick();
                check(button('Stop time-lapse recording') && button('Video recording') && button('Motion detection on') && button('Flat field on'), 'Active processes remain visible');
                await click('Stop time-lapse recording'); check(!o_state.o_record.b_running, 'Recording stop');
                o_state.o_camera.s_error__setting = 'Camera rejected setting'; await tick();
                check(visible(document.querySelector('.toolbar-error')), 'Camera errors remain visible when settings hidden');
                o_state.o_camera.s_error__setting = '';
                o_state.b_flashing = true; o_state.o_panel_visibility.setup = true; await click('Setup');
                check(o_state.o_panel_visibility.setup, 'Setup stays open during flashing'); o_state.b_flashing = false;
                await click('Quick settings'); app.unmount();
                mounted = makeApp(false); app = mounted.app; await tick();
                check(visible(document.querySelector('#toolbar-details')), 'Expanded preference restored');
                await click('Quick settings');
                o_state.o_video.b_recording = false; o_state.o_motion_detection.b_enabled = false; o_state.o_flat_field.b_active = false;
                await tick();
                check(!o_action_ui.error, 'Action error: ' + o_action_ui.error);
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
