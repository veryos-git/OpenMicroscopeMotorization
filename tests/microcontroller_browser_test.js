import assert from 'node:assert/strict';
const javascript = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });

// Real UI and calibration components with simulated USB, firmware and motor I/O.
for (const width of [1440, 800, 360, 320]) Deno.test(`microcontroller drawing layout and controls at ${width}px`, async () => {
    const dir = await Deno.makeTempDir();
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return javascript(`
            import { reactive } from './lib/vue.esm-browser.js';
            import { f_o_hardware_led_config } from './hardware_led.module.js';
            export const calls = { saved: {}, sent: [], calibration: [], usb: 0, flash: 0, stop: 0 };
            export const o_state = reactive({
                o_panel_visibility: { setup: true },
                o_motor__axis: { x: 0, y: 1, z: 2 }, a_n_step__backlash: [112, 75, 32],
                a_o_pin_config: [0, 1, 2].map(i => Object.fromEntries([1, 2, 3, 4].map(pin => ['n_pin' + pin, 4 + i * 4 + pin]))),
                a_o_motor: [0, 1, 2].map(() => ({ b_running: false, n_position: 0, n_rpm: 0, s_direction: 'cw' })),
                o_config__hardware_led: f_o_hardware_led_config(), o_hardware_led: null, s_error__hardware_led: '',
                b_connected__esp: false, b_streaming__webcam: false, b_available__serial: true,
                b_scanning: false, b_flashing: false, n_cnt__stop_all: 0, b_connecting__esp_serial: false,
                n_rpm__jog: 5, n_rpm__focus_jog: 0.5, a_o_setting: [], o_calibration: {},
                s_error__esp_serial: '', s_flash_output: '', s_flash_status: 'idle',
                ...Object.fromEntries(['a', 'd', 'w', 's', 'q', 'e', 'mouse_right'].map(key => ['o_mapping__' + key, { s_motor: '0', s_dir: ['a', 's', 'q'].includes(key) ? 'ccw' : 'cw' }]))
            });
            export function f_save_setting(key, value) { calls.saved[key] = JSON.parse(JSON.stringify(value)); }
            export const f_save_setting__debounced = f_save_setting;
            export function f_send_esp(command) { calls.sent.push(command); }
            export function f_send_esp_stop_all() { calls.stop++; o_state.n_cnt__stop_all++; }
            export function f_send_esp_stop(motor) { calls.sent.push({command:'stop', motor}); }
            export function f_send_esp_set_backlash(motor, steps) { calls.sent.push({command:'backlash', motor, steps}); }
            export async function f_send_esp_move_step(motor, steps) { calls.sent.push({command:'move', motor, steps}); }
            export function f_n_motor__axis(axis) { return o_state.o_motor__axis[axis]; }
            export function f_save_calibration() {}
            export function f_register_handler() { return () => {}; }
            export async function f_connect_esp_serial() { calls.usb++; o_state.b_connected__esp = true; return true; }
            export async function f_disconnect_esp() { o_state.b_connected__esp = false; }
            export async function f_send_wsmsg_with_response(message) {
                if (message.s_type === 'check_arduino_cli') return {v_data:{b_installed:true,s_version:'test'}};
                calls.compile = JSON.parse(JSON.stringify(message)); return {v_data:{b_success:true}};
            }
        `);
        if (path === '/flash_browser.module.js') return javascript(`import {calls} from './index.js'; export async function f_flash_browser() {calls.flash++;}`);
        if (path === '/') return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/index.css"><div id="app"></div><script type="module" src="/test.js"></script>', {headers:{'content-type':'text/html'}});
        if (path === '/test.js') return javascript(`
            import {createApp, nextTick} from './lib/vue.esm-browser.js';
            import {o_component__setup} from './o_component__setup.js';
            import {o_component__hardware_led} from './o_component__hardware_led.js';
            import {o_component__backlash} from './o_component__backlash.js';
            import {f_install_overlay_windows} from './overlay_windows.module.js';
            import {f_install_tooltips} from './tooltips.module.js';
            import {f_install_control_catalog, f_a_control_results, f_reveal_control} from './control_catalog.module.js';
            import {o_state, calls} from './index.js';
            const errors = [];
            const check = (value, message) => {if (!value) throw Error(message);};
            const tick = async () => {await nextTick(); await new Promise(resolve => setTimeout(resolve, 20)); check(!errors.length, errors.join('; '));};
            const field = label => document.querySelector('[aria-label="' + label + '"]');
            const edit = async (label, value) => {
                const el = field(label); check(el && !el.disabled && !el.closest('fieldset:disabled'), 'Available input: ' + label);
                el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); await tick();
            };
            const click = async label => {const el = field(label); check(el && !el.disabled && !el.closest('fieldset:disabled'), 'Available button: ' + label); el.click(); await tick();};
            const app = createApp(o_component__setup);
            const components = {o_component__setup, o_component__hardware_led, o_component__backlash};
            for (const [name, component] of Object.entries(components)) app.component(name, component);
            app.component('o_component__jog', {template:'<div></div>'});
            app.component('o_component__calibration', {template:'<div></div>'});
            f_install_control_catalog(app, {components, openPanel() {o_state.o_panel_visibility.setup = true;}});
            app.config.warnHandler = message => errors.push(message);
            app.config.errorHandler = error => errors.push(error.stack);
            Object.defineProperty(navigator, 'serial', {configurable: true, value: {requestPort: async () => ({})}});
            const vm = app.mount('#app');
            f_install_overlay_windows(); f_install_tooltips();
            try {
                await tick();
                const panel = document.querySelector('.panel-setup');
                const body = panel.querySelector('.panel-body');
                const bounds = panel.getBoundingClientRect();
                check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight, 'Window fits viewport');
                check(body.scrollWidth <= body.clientWidth, 'No horizontal overflow');
                check(body.scrollHeight <= body.clientHeight, 'Default controls fit without vertical scrolling');
                check(document.querySelectorAll('.micro-pin-row').length === 3 && document.querySelectorAll('.micro-pin-row input').length === 12, 'Three motor pin rows');
                check(document.querySelectorAll('.micro-axis-row').length === 3, 'Three logical axis rows');
                check(field('Calibrate X').disabled && field('Calibrate Z').disabled, 'Offline calibration blocked');
                check(!document.querySelector('.micro-diagnostics').open, 'Details start closed');
                check(!document.querySelector('[aria-label="ESP32 IP address"]') && !document.querySelector('input[type="password"]'), 'No Wi-Fi controls');
                await edit('Motor 1 pin 1', '18');
                check(calls.saved.a_o_pin_config[0].n_pin1 === 18, 'Motor pin saved');
                await edit('Motor 1 pin 1', '9');
                check(field('Flash ESP32').disabled && panel.textContent.includes('different GPIO'), 'Duplicate GPIO blocks flash');
                check(calls.saved.a_o_pin_config[0].n_pin1 === 18, 'Invalid pins not saved');
                await edit('Motor 1 pin 1', '5');
                await edit('X motor', '2');
                check(o_state.o_motor__axis.x === 2 && o_state.o_motor__axis.z === 0, 'Assignments swap motors');
                check(field('X backlash steps').value === '32' && field('Z backlash steps').value === '112', 'Backlash follows physical motor');
                await click('Reverse X direction');
                check(o_state.o_mapping__d.s_dir === 'ccw' && o_state.o_mapping__a.s_dir === 'cw', 'Paired direction reversal');
                check(calls.saved.o_mapping__d.s_motor === '2', 'Reverse persisted for assigned motor');
                await edit('X backlash steps', '87');
                check(o_state.a_n_step__backlash[2] === 87 && calls.saved.a_n_step__backlash[2] === 87, 'Backlash saved for assigned motor');
                check(calls.sent.some(c => c.command === 'backlash' && c.motor === 2 && c.steps === 87), 'Backlash applied');
                await edit('X backlash steps', '-1');
                check(o_state.a_n_step__backlash[2] === 87 && field('X backlash steps').value === '87', 'Invalid backlash rejected');
                await edit('X backlash steps', '87');
                await edit('Z motor', 'none');
                check(field('Reverse Z direction').disabled && field('Z backlash steps').disabled && field('Calibrate Z').disabled, 'Manual Z disables motor controls');
                await edit('Z motor', '0');
                await click('Enable addressable LED');
                await edit('LED data GPIO', '5');
                check(field('Flash ESP32').disabled && panel.textContent.includes('assigned to a motor'), 'LED pin conflict visible while options are closed');
                await edit('LED data GPIO', '21');
                await edit('Startup hex colour', '#ff8040'); await edit('Startup white intensity', '0.5');
                const startup = calls.saved.o_config__hardware_led.o_startup;
                check(startup.n_red === 255 && startup.n_green === 128 && startup.n_blue === 64 && startup.n_white === 128, 'Hex and normalized white saved');
                check(!calls.sent.some(c => c.command === 'setLed'), 'Startup edit does not drive live LED');
                await edit('Startup hex colour', '#invalid');
                check(calls.saved.o_config__hardware_led.o_startup.n_red === 255 && panel.textContent.includes('six-digit'), 'Invalid hex explained');
                await edit('Startup hex colour', '#ff8040');
                await edit('LED protocol', 'rgb');
                check(field('Startup white intensity').disabled && o_state.o_config__hardware_led.o_startup.n_white === 0, 'RGB has no white channel');
                await edit('LED protocol', 'rgbw'); await edit('Startup white intensity', '1');
                await click('Connect via USB'); check(calls.usb === 1 && o_state.b_connected__esp, 'USB connects in place');
                check(field('Calibrate X').disabled, 'Calibration waits for camera');
                o_state.b_streaming__webcam = true; await tick();
                for (const calibration of vm.$refs.a_calibration) {
                    calibration.f_run = async options => {
                        check(options.b_quick, 'Axis uses quick calibration'); calls.calibration.push(calibration.n_motor);
                        calibration.s_status = 'Complete'; return true;
                    };
                }
                await click('Calibrate X'); await click('Calibrate Z');
                check(JSON.stringify(calls.calibration) === '[2,0]', 'Calibration follows remapped axes');
                let finish;
                const calibration = vm.$refs.a_calibration.find(item => item.n_motor === 2);
                calibration.f_run = () => new Promise(resolve => {finish = resolve;});
                calibration.f_stop = () => {calls.stoppedCalibration = true; finish(false);};
                await click('Calibrate X');
                check(field('X motor').disabled && field('Flash ESP32').disabled, 'Calibration locks hardware changes');
                await click('Stop calibrating X'); check(calls.stoppedCalibration && vm.s_axis__calibrating === '', 'Per-axis calibration can stop');
                const nested = f_a_control_results().find(item => item.name === 'LED count');
                check(nested, 'LED count is searchable'); await f_reveal_control(nested); await tick();
                check(document.querySelector('.micro-led-details').open, 'Search reveals advanced LED option');
                document.querySelector('.micro-led-details').open = false;
                o_state.b_scanning = true; await tick();
                check(field('X motor').disabled && field('Flash ESP32').disabled && field('Disconnect controller').disabled, 'Active scan locks settings and connection');
                o_state.b_scanning = false; await tick();
                await click('Flash ESP32');
                await new Promise(resolve => setTimeout(resolve, 1600)); await tick();
                check(calls.flash === 1 && calls.compile.v_data.a_o_pin_config[0].n_pin1 === 5, 'Flash uses drawn pin configuration');
                check(calls.compile.v_data.o_config__hardware_led.o_startup.n_white === 255 && calls.usb === 2, 'Flash includes startup LED and reconnects USB');
                o_state.b_flashing = true; await tick();
                check(field('Close Setup').disabled && field('X motor').disabled, 'Flashing locks close and assignments');
                o_state.b_flashing = false; o_state.s_flash_output = ''; vm.s_status__axis = '';
                await tick();
                await click('Disconnect controller'); check(!o_state.b_connected__esp, 'Disconnect works');
                await click('Close Setup'); check(!o_state.o_panel_visibility.setup, 'Close works');
                o_state.o_panel_visibility.setup = true;
                o_state.b_available__serial = false; await tick();
                check(field('Connect via USB').disabled && field('Flash ESP32').disabled, 'Unsupported USB stays disabled');
                o_state.b_available__serial = true;
                await tick();
                check(body.scrollWidth <= body.clientWidth, 'Final layout stays within panel');
                document.body.dataset.result = 'PASS';
            } catch (error) {document.body.dataset.result = 'FAIL: ' + error.stack;}
        `);
        try { return new Response(await Deno.readFile(new URL('../webserved_dir' + path, import.meta.url)), {headers:{'content-type':path.endsWith('.css')?'text/css':'text/javascript'}}); }
        catch { return new Response('', {status:404}); }
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
        await Deno.writeFile('/tmp/omm-microcontroller-' + width + '.png', Uint8Array.from(atob(screenshot.data), c => c.charCodeAt(0)));
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
