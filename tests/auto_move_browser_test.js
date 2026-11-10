import assert from 'node:assert/strict';

Deno.test('auto move loop overlays the average of one snapshot per cycle, so a drifting stage shows ghost copies', async () => {
    const dir = await Deno.makeTempDir();
    const js = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return js(`
            import { reactive } from './lib/vue.esm-browser.js';
            export const o_state = reactive({ o_panel_visibility: { auto_move: true }, a_o_setting: [], b_connected__esp: true });
            export const o_test = { n_cnt__move: 0, f_on_move() {}, a_b_loop__circle: [], f_on_circle() {}, n_cnt__stop: 0, o_saved: null };
            export let f_n_motor__axis = s_axis => ({ x: 0, y: 1, z: 2 })[s_axis];
            export let f_send_esp_move_step = async () => { o_test.n_cnt__move++; o_test.f_on_move(); return 0; };
            export let f_send_esp_circle_start = async (n_radius, n_rpm, b_loop) => { o_test.a_b_loop__circle.push(b_loop); o_test.f_on_circle(); return 'circleComplete'; };
            export let f_send_esp_stop = () => {};
            export let f_send_esp_stop_all = () => { o_test.n_cnt__stop++; };
            export let f_save_setting__debounced = (s_key, v_value) => { o_test.o_saved = { s_key, v_value }; };
        `);
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css"><div id="app"></div><video id="webcamVideo" autoplay muted></video>
            <script type="module">
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__auto_move } from './o_component__auto_move.js';
            import { o_test } from './index.js';
            let f_assert = (b, s_message) => { if (!b) throw Error(s_message); };
            let f_wait = n_ms => new Promise(f_resolve => setTimeout(f_resolve, n_ms));
            let o_stream, o_app;
            try {
                // the "specimen": a white square that sits 10 pixels further right after every cycle
                let el_source = document.createElement('canvas'); el_source.width = 200; el_source.height = 100;
                let o_ctx__source = el_source.getContext('2d');
                let f_draw_source = n_cnt__cycle => {
                    o_ctx__source.fillStyle = '#000'; o_ctx__source.fillRect(0, 0, 200, 100);
                    o_ctx__source.fillStyle = '#fff'; o_ctx__source.fillRect(50 + 10 * n_cnt__cycle, 40, 20, 20);
                };
                f_draw_source(0);
                o_stream = el_source.captureStream(30);
                let el_video = document.getElementById('webcamVideo'); el_video.srcObject = o_stream; await el_video.play();
                while (!el_video.videoWidth) await f_wait(30);
                o_app = createApp(o_component__auto_move); let o_vm = o_app.mount('#app');
                let el_overlay = document.querySelector('.auto-move-overlay');
                let f_n_gray = (n_x, n_y) => el_overlay.getContext('2d').getImageData(n_x, n_y, 1, 1).data[0];

                // rectangle loop, stopped at the start of the fourth cycle
                o_test.f_on_move = () => {
                    if (o_test.n_cnt__move % 4 === 0) f_draw_source(o_test.n_cnt__move / 4);
                    if (o_test.n_cnt__move === 13) o_vm.f_stop();
                };
                await o_vm.f_run(true); await nextTick();
                f_assert(o_vm.n_cnt__snapshot === 4 && !o_vm.b_running, 'One snapshot at the start and one per finished cycle: ' + o_vm.n_cnt__snapshot);
                f_assert(el_overlay.width === 200 && el_overlay.height === 100, 'Overlay has the camera size');
                // squares at x 50-69, 60-79, 70-89, 80-99: a pixel inside 0, 1 or 2 of the 4 snapshots
                let a_n_gray = [f_n_gray(45, 50), f_n_gray(55, 50), f_n_gray(65, 50), f_n_gray(85, 50), f_n_gray(95, 50), f_n_gray(105, 50)];
                f_assert(a_n_gray.every((n, n_idx) => Math.abs(n - [0, 64, 128, 128, 64, 0][n_idx]) < 16), 'Overlay is not the average of the snapshots: ' + a_n_gray);
                f_assert(getComputedStyle(el_overlay).display !== 'none' && getComputedStyle(el_overlay).opacity === '0.5', 'Overlay is not shown half transparent');
                f_assert(document.querySelector('.panel-auto-move').textContent.includes('4 ×'), 'Snapshot count missing');

                let el_range = document.querySelector('#auto-move-overlay');
                el_range.value = '80'; el_range.dispatchEvent(new Event('input')); el_range.dispatchEvent(new Event('change')); await nextTick();
                f_assert(getComputedStyle(el_overlay).opacity === '0.8' && o_test.o_saved.v_value.n_pct__overlay === 80, 'Transparency slider not applied or not saved');

                document.querySelector('[aria-label="Clear snapshots"]').click(); await nextTick();
                f_assert(o_vm.n_cnt__snapshot === 0 && getComputedStyle(el_overlay).display === 'none', 'Clear leaves the overlay');

                // once: no snapshot
                o_test.f_on_move = () => {};
                await o_vm.f_run(false); await nextTick();
                f_assert(o_vm.n_cnt__snapshot === 0, 'Once takes snapshots');

                // overlay 0: a plain loop without snapshots
                o_vm.n_pct__overlay = 0; o_test.n_cnt__move = 0;
                o_test.f_on_move = () => { if (o_test.n_cnt__move === 5) o_vm.f_stop(); };
                await o_vm.f_run(true);
                f_assert(o_vm.n_cnt__snapshot === 0, 'Overlay 0 takes snapshots');

                // circle: always the continuous ESP32 loop, never a snapshot, and no overlay left from the rectangle
                o_vm.n_pct__overlay = 50; o_test.n_cnt__move = 0;
                o_test.f_on_move = () => { if (o_test.n_cnt__move === 5) o_vm.f_stop(); };
                await o_vm.f_run(true); await nextTick();
                f_assert(o_vm.n_cnt__snapshot === 2 && document.querySelector('#auto-move-overlay'), 'Rectangle overlay before the mode switch');
                o_vm.s_mode = 'circle'; await nextTick();
                f_assert(o_vm.n_cnt__snapshot === 0 && !document.querySelector('#auto-move-overlay'), 'Switching to circle keeps the rectangle overlay');
                await o_vm.f_run(true);
                await o_vm.f_run(false);
                f_assert(JSON.stringify(o_test.a_b_loop__circle) === '[true,false]' && o_vm.n_cnt__snapshot === 0, 'Circle must run as one continuous ESP32 command: ' + o_test.a_b_loop__circle + ' / ' + o_vm.n_cnt__snapshot);
                o_vm.s_mode = 'rectangle'; o_vm.n_cnt__snapshot = 1;

                o_vm.f_close(); await nextTick();
                f_assert(o_vm.n_cnt__snapshot === 0, 'Closing the window leaves the overlay on the image');
                document.body.setAttribute('data-result', 'PASS');
            } catch (o_error) { document.body.setAttribute('data-result', 'FAIL: ' + o_error.stack); }
            finally { o_app?.unmount(); o_stream?.getTracks().forEach(o => o.stop()); }
            </script>`, { headers: { 'content-type': 'text/html' } });
        try {
            return new Response(await Deno.readFile(new URL('../webserved_dir' + path, import.meta.url)), {
                headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' },
            });
        } catch { return new Response('', { status: 404 }); }
    });
    try {
        const result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
            '--no-first-run', '--user-data-dir=' + dir, '--virtual-time-budget=20000', '--dump-dom', 'http://127.0.0.1:' + server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).output();
        const html = new TextDecoder().decode(result.stdout);
        assert.ok(html.includes('data-result="PASS"'), html.slice(0, 1500) + '\n' + new TextDecoder().decode(result.stderr).slice(-800));
    } finally { await server.shutdown(); await Deno.remove(dir, { recursive: true }); }
});
