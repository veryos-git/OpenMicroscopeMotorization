import assert from 'node:assert/strict';

Deno.test('hardware crop UI and pixels reach preview, capture, nested ROI, filters, calibration and raw video', async () => {
    const dir = await Deno.makeTempDir();
    let finish;
    const completion = new Promise(resolve => { finish = resolve; });
    const timeout = setTimeout(() => finish({ ok: false, error: 'Browser test timed out' }), 20000);
    let browser, output;
    const js = text => new Response(text, { headers: { 'content-type': 'text/javascript' } });
    const server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async request => {
        const path = new URL(request.url).pathname;
        if (path === '/result') { finish(await request.json()); return new Response('done'); }
        if (path === '/index.js') return js(`
            import { reactive } from './lib/vue.esm-browser.js';
            import { f_set_camera_crop_provider, f_s_camera_crop_key } from './camera_frame.module.js';
            export const saved = {};
            export const o_state = reactive({
                o_camera: { b_active: true, n_width: 96, n_height: 64, o_capability: {} },
                o_hardware_crop: {}, s_id__webcam_device: 'sensor-1', a_o_setting: [],
                o_panel_visibility: { camera_setting: true, filter: true }, b_streaming__webcam: true,
                o_flat_field: { b_active: false }, o_filter: {}, o_zoom: { n_scl_x__roi: 20 },
                o_cellpose: { s_path_mask: 'old-mask' }, n_cnt__capture_flash: 0,
            });
            f_set_camera_crop_provider((w,h) => o_state.o_hardware_crop?.[f_s_camera_crop_key(o_state.s_id__webcam_device,w,h)]);
            export function f_save_setting__debounced(key,value) { saved[key] = JSON.parse(JSON.stringify(value)); }
            export const f_save_setting = f_save_setting__debounced;
        `);
        if (path === '/o_recording.module.js') return js('export const f_server=()=>{}, f_o_crud=()=>{}, f_update_row__recording=()=>{}, f_recording_list=()=>{};');
        if (path === '/o_video.module.js') return js(await Deno.readTextFile(new URL('../webserved_dir/o_video.module.js', import.meta.url)) + '\nexport { f_o_source };');
        if (path === '/') return new Response(`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/index.css">
            <div id="crop"></div><div id="filter"></div><canvas id="webcamVideo" width="96" height="64"></canvas>
            <script type="module" src="/hardware_crop.browser.js"></script>`, { headers: { 'content-type': 'text/html' } });
        if (path === '/hardware_crop.browser.js') return js(await Deno.readTextFile(new URL('./hardware_crop.browser.js', import.meta.url)));
        try {
            return new Response(await Deno.readFile(new URL('../webserved_dir' + path, import.meta.url)), {
                headers: { 'content-type': path.endsWith('.css') ? 'text/css' : 'text/javascript' },
            });
        } catch { return new Response('', { status: 404 }); }
    });
    try {
        browser = new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
            '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
            '--user-data-dir=' + dir, '--no-first-run', '--disable-background-networking',
            'http://127.0.0.1:' + server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).spawn();
        output = browser.output();
        const result = await completion;
        assert.equal(result.ok, true, result.error);
    } finally {
        clearTimeout(timeout);
        try { browser?.kill('SIGTERM'); } catch { /* already exited */ }
        await output;
        await server.shutdown(); await Deno.remove(dir, { recursive: true });
    }
});
