import assert from 'node:assert/strict';

Deno.test('camera panel applies resolution in Chrome with a simulated track and restores it on reconnect', async () => {
    const dir = await Deno.makeTempDir();
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return new Response(`
            import { reactive } from './lib/vue.esm-browser.js';
            export const o_state = reactive({ o_camera: { o_capability: {}, n_ts_ms__apply: 0 },
                o_panel_visibility: { camera_setting: true }, a_o_setting: [], b_streaming__webcam: true });
            export function f_save_setting(s_key, value) {
                o_state.a_o_setting = [{ s_key, s_value: JSON.stringify(value) }];
            }
            export function f_save_setting__debounced() {}
        `, { headers: { 'content-type': 'text/javascript' } });
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><div id="app"></div><video id="webcamVideo" autoplay muted></video>
            <script type="module">
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__camera_setting } from './o_component__camera_setting.js';
            import { o_state } from './index.js';
            import { f_read_camera, f_apply_camera__saved, f_camera_stopped } from './o_camera.module.js';
            let stream;
            try {
                let settings = { deviceId: 'usb-test', width: 640, height: 480, frameRate: 30 };
                let constraints = {};
                const track = { label: 'Test USB camera', readyState: 'live',
                    getSettings: () => settings,
                    getCapabilities: () => ({ width: { min: 640, max: 3840 }, height: { min: 480, max: 2160 }, frameRate: { min: 1, max: 60 }, exposureTime: { min: 0.25, max: 200, step: 0.25 }, resizeMode: ['none'] }),
                    getConstraints: () => constraints,
                    applyConstraints: async c => {
                        constraints = c;
                        settings = { ...settings, width: c.width.exact, height: c.height.exact, frameRate: c.frameRate?.exact ?? settings.frameRate };
                    }, stop() {} };
                stream = { getVideoTracks: () => [track], getTracks: () => [track] };
                Object.defineProperty(document.getElementById('webcamVideo'), 'srcObject', { value: stream });
                f_read_camera();
                const app = createApp(o_component__camera_setting).mount('#app');
                await nextTick();
                const select = document.querySelector('select');
                select.value = '1280x720';
                select.dispatchEvent(new Event('change'));
                await nextTick();
                app.n_frame_rate = 15;
                await app.f_apply_resolution();
                await nextTick();
                if (o_state.o_camera.n_width !== 1280 || o_state.o_camera.n_height !== 720) throw Error('Resolution not applied: ' + o_state.o_camera.s_error__resolution);
                if (!document.body.textContent.includes('1280 × 720 px')) throw Error('Missing active size');
                if (o_state.o_camera.n_frame_rate !== 15) throw Error('FPS not applied');
                if (!document.body.textContent.includes('Unavailable on this device/browser')) throw Error('Missing unavailable control');
                if (!document.querySelector('input[step="0.25"]')) throw Error('Fractional device step missing');
                if (!document.body.textContent.includes('Last request:')) throw Error('Missing requested format');
                if (!o_state.a_o_setting[0]) throw Error('Not saved');
                f_camera_stopped();
                await f_apply_camera__saved();
                if (o_state.o_camera.n_width !== 1280) throw Error('Not restored');
                o_state.b_scanning = true;
                await nextTick();
                if (!document.querySelector('fieldset').disabled) throw Error('Scan lock missing');
                document.body.setAttribute('data-result', 'PASS');
            } catch (e) { document.body.setAttribute('data-result', 'FAIL: ' + e.stack); }
            finally { f_camera_stopped(); stream?.getTracks().forEach(t => t.stop()); }
            </script>`, { headers: { 'content-type': 'text/html' } });
        try {
            return new Response(await Deno.readTextFile(new URL('../webserved_dir' + path, import.meta.url)),
                { headers: { 'content-type': 'text/javascript' } });
        } catch { return new Response('', { status: 404 }); }
    });
    try {
        const result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream', '--no-first-run', '--user-data-dir=' + dir,
            '--virtual-time-budget=10000', '--dump-dom', 'http://127.0.0.1:' + server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).output();
        const html = new TextDecoder().decode(result.stdout);
        assert.ok(html.includes('data-result="PASS"'), html || new TextDecoder().decode(result.stderr));
    } finally { await server.shutdown(); await Deno.remove(dir, { recursive: true }); }
});
