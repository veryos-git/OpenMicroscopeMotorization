import assert from 'node:assert/strict';

Deno.test('LED UI saves hardware settings, mixes RGB/white, applies brightness and handles old firmware', async () => {
    const dir = await Deno.makeTempDir();
    const javascript = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return javascript(`
            import { reactive } from './lib/vue.esm-browser.js';
            import { f_o_hardware_led_config } from './hardware_led.module.js';
            export const saved = {}, sent = [];
            export const o_state = reactive({
                o_config__hardware_led: f_o_hardware_led_config(), o_hardware_led: null,
                b_connected__esp: false, b_flashing: false, s_error__hardware_led: '',
                o_panel_visibility: { setup: true, led_setting: false },
                a_o_pin_config: [{ n_pin1: 18 }],
            });
            export function f_save_setting(key, value) { saved[key] = JSON.parse(JSON.stringify(value)); }
            export const f_save_setting__debounced = f_save_setting;
            export function f_send_esp(command) {
                sent.push(command);
                const { command: _, ...patch } = command;
                o_state.o_hardware_led.o_output = { ...o_state.o_hardware_led.o_output, ...patch };
            }
        `);
        if (path === '/') return new Response('<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><div id="app"></div><script type="module" src="/test.js"></script>', { headers: { 'content-type': 'text/html' } });
        if (path === '/test.js') return javascript(`
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__hardware_led } from './o_component__hardware_led.js';
            import { o_component__led_setting } from './o_component__led_setting.js';
            import { o_state, sent, saved } from './index.js';
            const errors = [];
            const app = createApp({
                components: { o_component__hardware_led, o_component__led_setting },
                template: '<o_component__hardware_led/><o_component__led_setting ref="led"/>',
            });
            app.config.warnHandler = message => errors.push(message);
            app.config.errorHandler = error => errors.push(error.message);
            const vm = app.mount('#app').$refs.led;
            const check = (ok, message) => { if (!ok) throw new Error(message); };
            const field = label => [...document.querySelectorAll('label')].find(el => el.textContent.trim().startsWith(label))?.querySelector('input,select');
            const edit = async (label, value) => {
                const input = field(label); check(input, 'Missing ' + label);
                if (input.type === 'checkbox') input.checked = value; else input.value = value;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
            };
            const click = async text => { const button = [...document.querySelectorAll('button')].find(el => el.textContent === text); check(button && !button.disabled, text + ' unavailable'); button.click(); await nextTick(); };
            try {
                check(!field('Enable addressable LED').checked, 'Disabled by default');
                check(!document.querySelector('input[type=color]'), 'No live controls before connection');
                await edit('Enable addressable LED', true);
                check(saved.o_config__hardware_led.b_enabled && saved.o_config__hardware_led.n_count === 1, 'Saved enabled single LED');
                await edit('LED data GPIO', 18);
                check(document.body.textContent.includes('assigned to a motor'), 'Conflict explained');
                check(saved.o_config__hardware_led.n_pin === 21, 'Invalid setting not persisted');
                await edit('LED data GPIO', 21);
                await edit('LED count', 3);
                await edit('Startup Brightness', 12);
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
                await edit('RGB colour', '#ff8040');
                await edit('White channel', 64);
                await edit('Brightness', 128);
                // Regular controller polling must not overwrite an edit in progress.
                o_state.o_hardware_led.o_output = { ...o_state.o_hardware_led.o_output, n_brightness: 12 }; await nextTick();
                check(vm.o_output.n_brightness === 128, 'Unsaved live edits survive status polling');
                await click('Apply light');
                check(sent[0].n_red === 255 && sent[0].n_green === 128 && sent[0].n_blue === 64 && sent[0].n_white === 64 && sent[0].n_brightness === 128 && sent[0].b_on, 'RGBW and brightness command');
                await click('Turn light off'); check(sent[1].b_on === false, 'Off command');
                await edit('Light on', true); await click('Apply light'); check(sent[2].b_on, 'On command');
                document.querySelector('[aria-label="Close LED settings"]').click(); await nextTick();
                check(!saved.o_panel_visibility.led_setting && !document.querySelector('.panel-led-setting').classList.contains('visible'), 'Closing LED panel persists visibility');
                await click('Open LED settings');
                check(vm.o_output.b_on && vm.o_output.n_brightness === 128, 'Reopening keeps current output');
                await click('Open LED hardware setup');
                check(saved.o_panel_visibility.setup && !saved.o_panel_visibility.led_setting, 'LED panel links back to Setup');
                await edit('LED protocol', 'rgb');
                check(saved.o_config__hardware_led.o_startup.n_white === 0 && saved.o_config__hardware_led.o_startup.n_red === 255, 'RGB startup remains useful');
                check(document.body.textContent.includes('Saved LED settings differ'), 'Flash needed');
                check(field('White channel'), 'Live protocol follows connected firmware until flash');
                o_state.o_hardware_led.o_config = JSON.parse(JSON.stringify(saved.o_config__hardware_led)); await nextTick();
                await click('Open LED settings');
                check(!field('White channel'), 'RGB-only hides separate white');
                await click('Apply light'); check(sent.at(-1).n_white === 0, 'RGB sends zero white');
                o_state.b_flashing = true; await nextTick();
                check(document.querySelector('input[type=color]').disabled || document.querySelector('input[type=color]').closest('fieldset').disabled, 'Live output blocked during flash');
                o_state.b_flashing = false; o_state.o_hardware_led.s_error = 'LED RMT transmission failed'; o_state.o_hardware_led.b_ready = false; await nextTick();
                check(document.body.textContent.includes('LED RMT transmission failed'), 'Hardware failure shown');
                o_state.b_connected__esp = false; o_state.o_hardware_led = null; await nextTick();
                check(!document.querySelector('input[type=color]'), 'No stale controls on disconnect');
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
