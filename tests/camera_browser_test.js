import assert from 'node:assert/strict';

Deno.test('camera window applies, saves and restores resolution and controls on a simulated track, and holds the image filter', async () => {
    const dir = await Deno.makeTempDir();
    // the camera as v4l2 on the server would report it; brightness is a control the window does not offer
    const o_gain = { s_name: 'gain', n_min: 0, n_max: 100, n_step: 1, n_default: 0, n_val: 100, b_inactive: false };
    const a_o_control = [{ ...o_gain, s_name: 'brightness', n_min: -64, n_max: 64, n_val: 17 }, o_gain];
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/index.js') return new Response(`
            import { reactive } from './lib/vue.esm-browser.js';
            export const o_state = reactive({ o_camera: { o_capability: {}, a_o_mode: [], a_o_control: [], n_ts_ms__apply: 0 },
                o_panel_visibility: { camera_setting: true }, a_o_setting: [], b_streaming__webcam: true,
                o_filter: {}, o_flat_field: { b_active: false } });
            export function f_save_setting(s_key, v_value) {
                o_state.a_o_setting = [...o_state.a_o_setting.filter(o => o.s_key !== s_key), { s_key, s_value: JSON.stringify(v_value) }];
            }
            export function f_save_setting__debounced() {}
        `, { headers: { 'content-type': 'text/javascript' } });
        if (path === '/api/camera/device') return Response.json([{ s_name: 'TEST: Test USB camera', s_path: '/dev/video9',
            a_o_mode: [{ n_scl_x: 640, n_scl_y: 480 }, { n_scl_x: 1280, n_scl_y: 720 }, { n_scl_x: 1920, n_scl_y: 1080 }], a_o_control }]);
        if (path === '/api/camera/control') {
            const o_control = await request.json();
            if (o_control.s_path !== '/dev/video9' || o_control.s_name !== 'gain') return new Response('unknown control', { status: 400 });
            o_gain.n_val = o_control.n_val;
            return Response.json(a_o_control);
        }
        if (path === '/camera_elsewhere') { o_gain.n_val = 100; return new Response('ok'); }
        if (path === '/o_flatfield.module.js') return new Response('export const f_b_flat__loaded=()=>false; export const f_o_flat=()=>null; export const f_b_flat__matches=()=>false;', { headers: { 'content-type': 'text/javascript' } });
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><div id="app"></div><video id="webcamVideo" autoplay muted></video>
            <script type="module">
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__camera_setting } from './o_component__camera_setting.js';
            import { f_o_filter__default } from './o_component__filter.js';
            import { o_state } from './index.js';
            import { f_read_camera, f_apply_camera__saved, f_camera_stopped } from './o_camera.module.js';
            let f_wait = () => new Promise(f_resolve => setTimeout(f_resolve, 50));
            let f_change = async (el_select, v_value) => {
                el_select.value = v_value;
                el_select.dispatchEvent(new Event('change'));
                await f_wait();
            };
            try {
                let o_setting = { deviceId: 'usb-test', width: 640, height: 480, frameRate: 30, exposureMode: 'continuous', exposureTime: 80 };
                let o_constraint = {};
                let b_reject = false;
                let o_track = { label: 'Test USB camera (1a2b:3c4d)', readyState: 'live',
                    getSettings: () => o_setting,
                    getCapabilities: () => ({ exposureMode: ['continuous', 'manual'], exposureTime: { min: 1, max: 5000, step: 1 } }),
                    getConstraints: () => o_constraint,
                    // like the browser: a size is only exact and unscaled when the sensor has it
                    applyConstraints: async o => {
                        let s_resolution = (o.width?.exact ?? o_setting.width) + 'x' + (o.height?.exact ?? o_setting.height);
                        if (b_reject || o.resizeMode?.exact !== 'none' || !['640x480', '1280x720', '1920x1080'].includes(s_resolution)) throw new DOMException('no such mode', 'OverconstrainedError');
                        o_constraint = o;
                        o_setting = { ...o_setting, width: o.width?.exact ?? o_setting.width, height: o.height?.exact ?? o_setting.height,
                            frameRate: o.frameRate?.ideal ?? o_setting.frameRate, ...Object.assign({}, ...(o.advanced || [])) };
                    }, stop() {} };
                let o_stream = { getVideoTracks: () => [o_track], getTracks: () => [o_track] };
                Object.defineProperty(document.getElementById('webcamVideo'), 'srcObject', { value: o_stream });
                Object.assign(o_state.o_filter, f_o_filter__default());
                createApp(o_component__camera_setting).mount('#app');
                await nextTick();
                let o_camera = o_state.o_camera;
                await f_apply_camera__saved();
                await nextTick();
                let [el_fps, el_resolution] = document.querySelectorAll('select');
                let s_list = [...el_resolution.options].map(el => el.value).join(' ');
                if (s_list !== '640x480 1280x720 1920x1080' || el_resolution.value !== '640x480') throw Error('Resolution list is not the sensor sizes of the camera: ' + s_list + ' / ' + el_resolution.value);

                await f_change(el_resolution, '1280x720');
                if (o_camera.n_width !== 1280 || o_camera.n_height !== 720) throw Error('Resolution not applied: ' + o_camera.s_error__resolution);
                if (!document.querySelector('.panel-state').textContent.includes('1280 × 720')) throw Error('Header does not show the frame size');
                if (!document.querySelector('.panel-camera-setting .exposure-histogram')) throw Error('Histogram is not part of the camera window');
                await f_change(el_fps, '15');
                if (o_camera.n_frame_rate !== 15 || o_camera.n_width !== 1280) throw Error('FPS not applied');
                let o_saved = JSON.parse(o_state.a_o_setting.find(o => o.s_key === 'o_camera_resolution').s_value);
                if (JSON.stringify(o_saved) !== JSON.stringify({ 'usb-test': { n_width: 1280, n_height: 720, n_frame_rate: 15 } })) throw Error('Resolution not saved: ' + JSON.stringify(o_saved));

                document.querySelector('.mode-btn').click();
                await f_wait();
                if (o_camera.s_mode__exposure !== 'manual') throw Error('Exposure mode not applied');
                await f_change(document.querySelectorAll('select')[2], '333');
                if (o_camera.n_time__exposure !== 333) throw Error('Exposure time not applied');
                let el_fine = document.querySelector('[aria-label="Exposure fine tune"]');
                if (Number(el_fine.value) !== 0) throw Error('Fine tune is not centred on a coarse time: ' + el_fine.value);
                await f_change(el_fine, '0.25');
                if (o_camera.n_time__exposure !== 396) throw Error('Fine tune not applied: ' + o_camera.n_time__exposure);
                if (document.querySelectorAll('select')[2].value !== '333') throw Error('Fine tune changed the coarse selection');
                if (Math.abs(Number(el_fine.value) - 0.25) > 0.01) throw Error('Fine tune slider does not show the live time: ' + el_fine.value);
                if (!document.querySelector('.camera-setting-stack').textContent.includes('39.6 ms')) throw Error('Exposure time readout missing');
                for (let [s_stop, n_time, s_coarse] of [[el_fine.max, 471, '333'], [el_fine.min, 236, '333']]) {
                    await f_change(el_fine, s_stop);
                    if (o_camera.n_time__exposure !== n_time || document.querySelectorAll('select')[2].value !== s_coarse) throw Error('Fine tune end ' + s_stop + ' gave ' + o_camera.n_time__exposure);
                }
                await f_change(el_fine, '0.25');

                // a control only v4l2 reaches: offered because the server reports it for this camera
                let a_el_control = document.querySelectorAll('.camera-setting-stack input[type="range"]:not([aria-label="Exposure fine tune"])');
                let el_gain = document.querySelector('[aria-label="ISO"]');
                if (a_el_control.length !== 1 || el_gain.value !== '100' || el_gain.max !== '100') throw Error('ISO slider: ' + a_el_control.length + ' ' + el_gain?.value);
                await f_change(el_gain, '20');
                if (o_camera.a_o_control[0].n_val !== 20 || el_gain.value !== '20') throw Error('ISO not applied');
                await new Promise(f_resolve => setTimeout(f_resolve, 400));
                let o_saved__setting = JSON.parse(o_state.a_o_setting.find(o => o.s_key === 'o_camera_setting').s_value);
                if (o_saved__setting.s_mode__exposure !== 'manual' || o_saved__setting.n_time__exposure !== 396 || o_saved__setting.o_control.gain !== 20) throw Error('Setting not saved');

                b_reject = true;
                await f_change(el_resolution, '1920x1080');
                if (!document.querySelector('.cam-setting-error')?.textContent.includes('cannot use that resolution')) throw Error('Missing resolution error');
                if (o_camera.n_width !== 1280) throw Error('Rejected resolution changed the state');
                b_reject = false;

                o_state.b_scanning = true;
                await f_change(el_resolution, '640x480');
                if (o_camera.n_width !== 1280 || !o_camera.s_error__resolution.includes('Stop scanning')) throw Error('Scan lock missing');
                o_state.b_scanning = false;

                f_camera_stopped();
                await nextTick();
                if (document.querySelector('[aria-label="ISO"]')) throw Error('ISO slider stays without a camera');
                o_setting = { deviceId: 'usb-test', width: 640, height: 480, frameRate: 30, exposureMode: 'continuous', exposureTime: 80 };
                await fetch('/camera_elsewhere');
                await f_apply_camera__saved();
                if (o_camera.a_o_control[0]?.n_val !== 20) throw Error('ISO not restored');
                if (o_camera.n_width !== 1280 || o_camera.n_frame_rate !== 15) throw Error('Resolution not restored');
                if (o_camera.s_mode__exposure !== 'manual' || o_camera.n_time__exposure !== 396) throw Error('Setting not restored');

                // a size saved by an older version that the sensor does not have: the open size stays, without an error
                f_camera_stopped();
                o_setting = { ...o_setting, width: 640, height: 480 };
                o_state.a_o_setting = [{ s_key: 'o_camera_resolution', s_value: JSON.stringify({ 'usb-test': { n_width: 2560, n_height: 1440, n_frame_rate: 30 } }) }];
                await f_apply_camera__saved();
                await nextTick();
                if (o_camera.n_width !== 640 || o_camera.s_error__resolution || document.querySelectorAll('select')[1].value !== '640x480') throw Error('Unknown saved size: ' + o_camera.n_width + ' ' + o_camera.s_error__resolution);
                document.body.setAttribute('data-result', 'PASS');
            } catch (o_error) { document.body.setAttribute('data-result', 'FAIL: ' + o_error.stack); }
            finally { f_camera_stopped(); }
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
