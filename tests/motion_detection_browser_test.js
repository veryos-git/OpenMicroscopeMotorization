import assert from 'node:assert/strict';

Deno.test('motion overlay: controls, rendering, persistence, stage pause and cleanup in Chrome', async () => {
    let s_dir = await Deno.makeTempDir();
    let o_server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async o_request => {
        let s_path = new URL(o_request.url).pathname;
        if (s_path === '/index.js') return new Response(`
            import { reactive } from './lib/vue.esm-browser.js';
            import { f_o_motion_config } from './motion_detection.module.js';
            export const o_state = reactive({
                o_motion_detection: f_o_motion_config({n_area__min: 1, n_movement__min: 0}),
                o_panel_visibility: { motion_detection: true },
                b_streaming__webcam: true, a_o_motor: [{ b_running: false }],
            });
            export const a_o_save = [];
            export function f_save_setting(s_key, o_value) { a_o_save.push([s_key, JSON.parse(JSON.stringify(o_value))]); }
            export const f_save_setting__debounced = f_save_setting;
        `, { headers: { 'content-type': 'text/javascript' } });
        if (s_path === '/') return new Response(`<!doctype html><meta charset="utf-8">
            <link rel="stylesheet" href="/index.css">
            <canvas id="webcamVideo" width="80" height="60" style="position:fixed;left:10px;top:100px;width:800px;height:600px"></canvas>
            <div id="app"></div>
            <script type="module">
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__motion_detection } from './o_component__motion_detection.js';
            import { o_state, a_o_save } from './index.js';
            let o_app;
            try {
                let el_video = document.getElementById('webcamVideo');
                Object.assign(el_video, { videoWidth: 80, videoHeight: 60, readyState: 4, currentTime: 0,
                    srcObject: { getVideoTracks: () => [o_track] } });
                let o_track = { readyState: 'live' };
                let o_ctx = el_video.getContext('2d');
                let f_frame = n_x => {
                    o_ctx.fillStyle = 'rgb(20,20,20)'; o_ctx.fillRect(0, 0, 80, 60);
                    o_ctx.fillStyle = 'rgb(180,180,180)'; o_ctx.fillRect(n_x, 20, 6, 8);
                    el_video.currentTime += 0.1;
                };
                let f_assert = (b, s) => { if (!b) throw Error(s); };
                o_app = createApp(o_component__motion_detection);
                let o_vm = o_app.mount('#app');
                await nextTick();
                f_assert(document.body.textContent.includes('Minimum movement'), 'Missing controls');
                let el_switch = document.querySelector('input[type=checkbox]');
                el_switch.checked = true;
                el_switch.dispatchEvent(new Event('change'));
                await nextTick();
                clearInterval(o_vm._n_timer);
                f_assert(o_state.o_motion_detection.b_enabled, 'Enable failed');
                f_assert(a_o_save.some(o => o[0] === 'o_motion_detection' && o[1].b_enabled), 'Config not saved');
                f_frame(10); o_vm.f_sample();
                f_frame(14); o_vm.f_sample();
                await nextTick();
                f_assert(o_vm.n_region > 0, 'No moving region');
                let el_overlay = document.querySelector('.motion-detection-overlay');
                let o_overlay_ctx = el_overlay.getContext('2d');
                let f_has_pixel = () => o_overlay_ctx.getImageData(0, 0, el_overlay.width, el_overlay.height).data.some((n, i) => i % 4 === 3 && n);
                f_assert(f_has_pixel(), 'No drawn boxes');
                f_assert(el_overlay.style.left === '10px' && el_overlay.style.top === '100px', 'Wrong alignment');
                f_assert(getComputedStyle(el_overlay).pointerEvents === 'none', 'Overlay intercepts input');
                o_vm.f_close(); await nextTick();
                f_assert(!o_state.o_panel_visibility.motion_detection && o_state.o_motion_detection.b_enabled, 'Close turned detection off');
                o_state.a_o_motor[0].b_running = true;
                f_frame(18); o_vm.f_sample();
                f_assert(o_vm.s_status.includes('stage') && !f_has_pixel(), 'Stage did not pause and clear');
                o_state.a_o_motor[0].b_running = false; o_vm._n_settle_until = 0;
                f_frame(22); o_vm.f_sample();
                f_assert(o_vm.s_status.includes('reference'), 'Did not reset after stage movement');
                f_frame(26); o_vm.f_sample();
                f_assert(o_vm.n_region > 0, 'Did not resume');
                o_state.b_streaming__webcam = false; await nextTick();
                f_assert(o_vm.s_status === 'Waiting for camera' && !f_has_pixel() && !o_vm._n_timer, 'Camera stop cleanup failed');
                o_state.b_streaming__webcam = true; await nextTick();
                clearInterval(o_vm._n_timer);
                o_track = { readyState: 'live' };
                f_frame(10); o_vm.f_sample();
                f_assert(o_vm.s_status.includes('reference'), 'Reconnect kept stale reference');
                o_state.o_motion_detection.b_enabled = false; await nextTick();
                f_assert(o_vm.s_status === 'Off' && !o_vm._n_timer && !f_has_pixel(), 'Disable cleanup failed');
                o_app.unmount(); o_app = null;
                document.body.setAttribute('data-result', 'PASS');
            } catch (e) { document.body.setAttribute('data-result', 'FAIL: ' + e.stack); }
            finally { o_app?.unmount(); }
            </script>`, { headers: { 'content-type': 'text/html' } });
        try {
            return new Response(await Deno.readTextFile(new URL('../webserved_dir' + s_path, import.meta.url)),
                { headers: { 'content-type': s_path.endsWith('.css') ? 'text/css' : 'text/javascript' } });
        } catch { return new Response('', { status: 404 }); }
    });
    try {
        let o_result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run',
            '--user-data-dir=' + s_dir, '--virtual-time-budget=10000', '--dump-dom',
            'http://127.0.0.1:' + o_server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).output();
        let s_html = new TextDecoder().decode(o_result.stdout);
        assert.ok(s_html.includes('data-result="PASS"'), s_html || new TextDecoder().decode(o_result.stderr));
    } finally { await o_server.shutdown(); await Deno.remove(s_dir, { recursive: true }); }
});
