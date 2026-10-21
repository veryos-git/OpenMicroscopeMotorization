import assert from 'node:assert/strict';

Deno.test('LED UI saves hardware settings, updates RGB and white channels instantly in percent and handles old firmware', async () => {
    const dir = await Deno.makeTempDir();
    const javascript = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return javascript(`
            import { reactive } from './lib/vue.esm-browser.js';
            import { f_o_hardware_led_config } from './hardware_led.module.js';
            export const saved = {}, sent = [], handlers = [];
            export const o_state = reactive({
                o_config__hardware_led: f_o_hardware_led_config(), o_hardware_led: null,
                b_connected__esp: false, b_flashing: false, s_error__hardware_led: '',
                o_panel_visibility: { setup: true, led_setting: false },
                a_o_pin_config: [{ n_pin1: 18 }],
            });
            export function f_save_setting(key, value) { saved[key] = JSON.parse(JSON.stringify(value)); }
            export const f_save_setting__debounced = f_save_setting;
            export function f_register_esp_handler(handler) {
                handlers.push(handler);
                return () => handlers.splice(handlers.indexOf(handler), 1);
            }
            // The firmware applies the patch, then its status reply releases the next command.
            export function f_send_esp(command) {
                sent.push(command);
                const { command: _, ...patch } = command;
                o_state.o_hardware_led = { ...o_state.o_hardware_led, o_output: { ...o_state.o_hardware_led.o_output, ...patch } };
            }
            export function f_reply() { for (const handler of [...handlers]) handler({ type: 'status' }); }
        `);
        if (path === '/') return new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><div id="app"></div><script type="module" src="/test.js"></script>', { headers: { 'content-type': 'text/html' } });
        if (path === '/test.js') return javascript(`
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__hardware_led } from './o_component__hardware_led.js';
            import { o_component__led_setting } from './o_component__led_setting.js';
            import { o_state, sent, saved, f_reply } from './index.js';
            const errors = [];
            const app = createApp({
                components: { o_component__hardware_led, o_component__led_setting },
                template: '<o_component__hardware_led/><o_component__led_setting ref="led"/>',
            });
            app.config.warnHandler = message => errors.push(message);
            app.config.errorHandler = error => errors.push(error.message);
            const vm = app.mount('#app').$refs.led;
            const check = (ok, message) => { if (!ok) throw new Error(message); };
            const field = label => document.querySelector('input[aria-label="' + label + '"],select[aria-label="' + label + '"]') || [...document.querySelectorAll('label')].find(el => el.textContent.trim().startsWith(label))?.querySelector('input,select');
            const edit = async (label, value) => {
                const input = field(label); check(input, 'Missing ' + label);
                if (input.type === 'checkbox') input.checked = value; else input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
            };
            const click = async text => { const button = [...document.querySelectorAll('button')].find(el => (el.getAttribute('aria-label') || el.textContent.trim()) === text); check(button && !button.disabled, text + ' unavailable'); button.click(); await nextTick(); };
            try {
                check(document.querySelector('[aria-label="Enable addressable LED"]').getAttribute('aria-pressed') === 'false', 'Disabled by default');
                check(!field('Red LED channel'), 'No live controls before connection');
                await click('Enable addressable LED');
                document.querySelector('.micro-led-details summary').click();
                check(saved.o_config__hardware_led.b_enabled && saved.o_config__hardware_led.n_count === 1, 'Saved enabled single LED');
                await edit('LED data GPIO', 18);
                check(document.body.textContent.includes('assigned to a motor'), 'Conflict explained');
                check(saved.o_config__hardware_led.n_pin === 21, 'Invalid setting not persisted');
                await edit('LED data GPIO', 21);
                await edit('LED count', 3);
                await edit('Startup brightness', 12);
                check(saved.o_config__hardware_led.o_startup.n_brightness === 12, 'Startup persisted');
                check(sent.length === 0, 'Configuration changes do not send live output');
                await click('Open LED settings');
                check(o_state.o_panel_visibility.led_setting && !o_state.o_panel_visibility.setup, 'Setup links to the live LED panel');
                check(document.querySelector('.panel-led-setting').classList.contains('visible'), 'LED panel is visible');
                check(!document.querySelector('.panel-led-setting .hardware-led-config'), 'Live controls do not require hardware configuration');
                o_state.b_connected__esp = true; await nextTick();
                check(document.body.textContent.includes('Flash updated firmware'), 'Old firmware guidance');
                o_state.o_hardware_led = { b_ready: true, b_pending: false, s_error: '',
                    o_config: JSON.parse(JSON.stringify(saved.o_config__hardware_led)),
                    o_output: { ...saved.o_config__hardware_led.o_startup } };
                await nextTick();
                check(!document.body.textContent.includes('Saved LED settings differ'), 'Matching firmware');
                check(document.querySelector('.panel-led-setting .panel-header h2').textContent.trim() === 'LED', 'Drawing header');
                check(['RED', 'GREEN', 'BLUE', 'WW/CW'].every((s, n) => document.querySelectorAll('.led-channel-name')[n]?.textContent === s), 'RGB and warm/cold white rows');
                check(!document.querySelector('.panel-led-setting input[type="color"]') && ![...document.querySelectorAll('.panel-led-setting button')].some(el => /Apply|Turn light/.test(el.textContent)), 'No colour picker or apply button');
                // Startup white 255 at brightness 12/255 is shown as the real output share.
                check(field('Warm/cold white LED channel %').value === '4.7' && field('Red LED channel').value === '0', 'Reported output in percent');
                await edit('Red LED channel', 25);
                check(sent.length === 1 && sent[0].command === 'setLed', 'Change is sent instantly');
                check(sent[0].n_red === 64 && sent[0].n_green === 0 && sent[0].n_blue === 0 && sent[0].n_white === 12 && sent[0].n_brightness === 255 && sent[0].b_on, 'Percent maps to full-scale channels');
                for (const n_pct of [10, 20, 50]) await edit('Green LED channel', n_pct);
                check(sent.length === 1, 'Dragging waits for the controller reply');
                f_reply(); await nextTick();
                check(sent.length === 2 && sent[1].n_green === 128 && sent[1].n_red === 64, 'Only the latest value follows');
                f_reply(); await nextTick();
                await edit('Blue LED channel %', 75);
                check(sent.at(-1).n_blue === 191 && field('Blue LED channel').value === '75', 'Number box sends and moves slider');
                f_reply(); await nextTick();
                const n_cnt__sent = sent.length;
                await edit('Blue LED channel %', 'x');
                check(sent.length === n_cnt__sent && field('Blue LED channel %').value === '75', 'Invalid percent snaps back');
                await edit('Blue LED channel %', 150);
                check(sent.at(-1).n_blue === 255 && field('Blue LED channel %').value === '100', 'Percent clamps to 100');
                f_reply(); await nextTick();
                // Regular controller polling must not overwrite an edit in progress.
                o_state.o_hardware_led = { ...o_state.o_hardware_led, o_output: { ...o_state.o_hardware_led.o_output, n_red: 0 } }; await nextTick();
                check(field('Red LED channel').value === '25', 'Live edits survive status polling');
                await new Promise(resolve => setTimeout(resolve, 1600));
                o_state.o_hardware_led = { ...o_state.o_hardware_led, o_output: { ...o_state.o_hardware_led.o_output, n_red: 128, n_brightness: 128, b_on: true } }; await nextTick();
                check(field('Red LED channel').value === '25.1', 'Later reports show the real output');
                o_state.o_hardware_led = { ...o_state.o_hardware_led, o_output: { ...o_state.o_hardware_led.o_output, b_on: false } }; await nextTick();
                check(vm.a_o_channel.every(o => vm.o_pct[o.s_key] === 0), 'Off firmware output reads 0 %');
                document.querySelector('[aria-label="Close LED settings"]').click(); await nextTick();
                check(!saved.o_panel_visibility.led_setting && !document.querySelector('.panel-led-setting').classList.contains('visible'), 'Closing LED panel persists visibility');
                await click('Open LED settings');
                check(document.querySelector('.panel-led-setting').classList.contains('visible'), 'Reopening shows the panel');
                check(document.querySelector('[aria-label="Open LED hardware setup"]').dataset.tooltip.includes('GPIO 21'), 'Setup link names the flashed wiring');
                await click('Open LED hardware setup');
                check(saved.o_panel_visibility.setup && !saved.o_panel_visibility.led_setting, 'LED panel links back to Setup');
                await edit('LED protocol', 'rgb');
                check(saved.o_config__hardware_led.o_startup.n_white === 0 && saved.o_config__hardware_led.o_startup.n_red === 255, 'RGB startup remains useful');
                check(document.body.textContent.includes('Saved LED settings differ'), 'Flash needed');
                check(field('Warm/cold white LED channel'), 'Live protocol follows connected firmware until flash');
                o_state.o_hardware_led = { ...o_state.o_hardware_led, o_config: JSON.parse(JSON.stringify(saved.o_config__hardware_led)) }; await nextTick();
                await click('Open LED settings');
                check(!field('Warm/cold white LED channel'), 'RGB-only hides separate white');
                await edit('Red LED channel', 30); check(sent.at(-1).n_white === 0, 'RGB sends zero white');
                f_reply(); await nextTick();
                o_state.b_flashing = true; await nextTick();
                check(field('Red LED channel').closest('fieldset').disabled, 'Live output blocked during flash');
                o_state.b_flashing = false; o_state.o_hardware_led = { ...o_state.o_hardware_led, s_error: 'LED RMT transmission failed', b_ready: false }; await nextTick();
                check(document.body.textContent.includes('LED RMT transmission failed'), 'Hardware failure shown');
                o_state.b_connected__esp = false; o_state.o_hardware_led = null; await nextTick();
                check(!field('Red LED channel'), 'No stale controls on disconnect');
                check(errors.length === 0, errors.join('; '));
                document.body.dataset.result = 'PASS';
            } catch (error) { document.body.dataset.result = 'FAIL'; document.body.textContent = error.stack + '\\n' + errors.join('; '); }
            finally { app.unmount(); }
        `);
        try { return new Response(await Deno.readFile(new URL('../webserved_dir' + path, import.meta.url)), { headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' } }); }
        catch { return new Response('', { status: 404 }); }
    });
    try {
        const result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--user-data-dir=' + dir,
            '--virtual-time-budget=10000', '--dump-dom', 'http://127.0.0.1:' + server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).output();
        const html = new TextDecoder().decode(result.stdout);
        assert.ok(html.includes('data-result="PASS"'), html.slice(-7000) + '\n' + new TextDecoder().decode(result.stderr).slice(-1000));
    } finally { await server.shutdown(); await Deno.remove(dir, { recursive: true }); }
});
