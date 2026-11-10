// Real Vue component in headless Chrome; no camera, controller or production data needed.
// deno test -A tests/scale_browser_test.js
import assert from 'node:assert/strict';

Deno.test('size window: calibrate with two points, measure a path, reference overlays, in Chrome', async () => {
    let s_dir = await Deno.makeTempDir();
    let a_o_upload = [];
    let o_server = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen() {} }, async o_request => {
        let o_url = new URL(o_request.url);
        let s_path = o_url.pathname;
        // the calibration snapshot arrives here
        if (s_path === '/api/scan/save_image') {
            a_o_upload.push({ s_path_folder: o_url.searchParams.get('s_path_folder'), s_filename: o_url.searchParams.get('s_filename'),
                a_n_byte: new Uint8Array(await o_request.arrayBuffer()) });
            return new Response('{"b_success":true}', { headers: { 'content-type': 'application/json' } });
        }
        if (s_path === '/index.js') return new Response(`
            import { reactive } from './lib/vue.esm-browser.js';
            import { f_o_size__default } from './scale_calibration.module.js';
            export const o_state = reactive({
                o_panel_visibility: { scale: true },
                b_streaming__webcam: true,
                o_camera: { n_width: 800, n_height: 600 },
                o_calibration: { n_um__per_px: 0, n_ts_ms__scale: 0, o_camera__scale: null },
                o_size: f_o_size__default(),
                a_n_step__per_px: [0, 0, 0], a_o_setting: [],
            });
            export const a_o_save = [];
            export const f_n_motor__axis = s_axis => ({ x: 0, y: 1, z: 2 })[s_axis];
            export function f_save_calibration() { a_o_save.push(['o_calibration', JSON.parse(JSON.stringify(o_state.o_calibration))]); }
            export function f_save_setting__debounced(s_key, o_value) { a_o_save.push([s_key, JSON.parse(JSON.stringify(o_value))]); }
            // an app server from before the snapshot feature never answers the folder request
            export const o_server = { b_old: false };
            export async function f_send_wsmsg_with_response(o_wsmsg) {
                if (o_server.b_old) throw new Error('Server request timed out. Try again when the firmware build finishes.');
                return { v_result: { s_path_folder: '/scans/' + o_wsmsg.s_type.replace('_create_folder', '') } };
            }
        `, { headers: { 'content-type': 'text/javascript' } });
        if (s_path === '/') return new Response(`<!doctype html><meta charset="utf-8">
            <link rel="stylesheet" href="/index.css">
            <style>.overlay-panel.panel-scale { left: 420px; top: 0; }</style>
            <!-- an 800 x 600 camera image shown 400 x 300: one window px is two camera px -->
            <canvas id="webcamVideo" width="800" height="600" style="position:fixed;left:0;top:0;width:400px;height:300px"></canvas>
            <div class="mouse-jog-overlay" id="jog" style="inset:0 auto auto 0;width:400px;height:300px"></div>
            <div id="app"></div>
            <script type="module">
            import { createApp, nextTick } from './lib/vue.esm-browser.js';
            import { o_component__scale } from './o_component__scale.js';
            import { o_state, a_o_save, o_server } from './index.js';
            let o_app;
            let f_assert = (b, s) => { if (!b) throw Error(s); };
            let f_near = (n_a, n_b) => Math.abs(n_a - n_b) < 1e-6;
            try {
                let el_video = document.getElementById('webcamVideo');
                Object.assign(el_video, { videoWidth: 800, videoHeight: 600 });
                let n_jog = 0;
                document.getElementById('jog').addEventListener('mousedown', () => n_jog++);
                o_app = createApp(o_component__scale);
                let o_vm = o_app.mount('#app');
                await nextTick();
                let f_button = s => [...document.querySelectorAll('.panel-scale .cockpit-pane button')].filter(el => el.getClientRects().length).find(el => el.textContent.trim() === s);
                let f_text = () => document.querySelector('.panel-scale').textContent;
                let f_pointer = (el, s_type, n_x, n_y) => el.dispatchEvent(new PointerEvent(s_type, { clientX: n_x, clientY: n_y, button: 0, pointerId: 1, bubbles: true, cancelable: true }));
                // a real click goes to whatever is on top at that place
                let f_click = (n_x, n_y) => {
                    let el = document.elementFromPoint(n_x, n_y);
                    f_pointer(el, 'pointerdown', n_x, n_y);
                    el.dispatchEvent(new MouseEvent('mousedown', { clientX: n_x, clientY: n_y, button: 0, bubbles: true }));
                    f_pointer(el, 'pointerup', n_x, n_y);
                    return el;
                };

                // ── calibrate ────────────────────────────────────────
                f_assert(f_text().includes('not calibrated'), 'header shows the missing scale');
                f_assert(f_button('Save').disabled, 'nothing to save without a line');
                f_assert(document.querySelector('#scale-known').value === '0.1' && document.querySelector('#scale-unit').value === 'mm', 'default is one cell of a 0.1 mm grid');
                f_assert(document.elementFromPoint(100, 100).id === 'jog', 'idle: the live image belongs to mouse movement');
                f_button('Set points').click(); await nextTick();
                f_assert(document.elementFromPoint(100, 100).classList.contains('size-pick-layer'), 'placing points covers mouse movement');
                f_click(100, 100); await nextTick();
                f_assert(o_vm.a_o_point.length === 1 && o_vm.b_picking, 'first point placed, waiting for the second');
                f_pointer(document.querySelector('.size-pick-layer'), 'pointermove', 200, 100); await nextTick();
                f_assert(document.querySelector('.size-line') && document.querySelector('.size-loupe').style.display !== 'none', 'rubber band and magnifier follow the cursor');
                f_click(300, 100); await nextTick();
                f_assert(n_jog === 0, 'placing points must not reach the mouse-movement overlay');
                f_assert(!o_vm.b_picking && o_vm.a_o_point.length === 2, 'second point ends placing');
                f_assert(JSON.stringify(o_vm.a_o_point) === JSON.stringify([{ n_x: 200, n_y: 200 }, { n_x: 600, n_y: 200 }]), 'points are stored in camera pixels');
                f_assert(f_text().includes('400.0 px') && f_text().includes('0.25 µm/px'), 'line length and new scale are shown');
                f_assert(document.querySelector('.size-loupe').style.display === 'none', 'magnifier hides after placing');
                f_assert(document.elementFromPoint(150, 150).id === 'jog', 'after placing the image belongs to mouse movement again');
                f_assert(o_vm._el_canvas__snapshot?.width === 800 && o_vm._el_canvas__snapshot.height === 600, 'the camera frame is kept when the second point is set');
                let f_snapshot_done = async () => { await nextTick(); while (o_vm.b_snapshot_saving) await new Promise(f => setTimeout(f, 10)); await nextTick(); };
                f_button('Save').click(); await f_snapshot_done();
                let o_record = o_state.o_calibration.o_scale__record;
                f_assert(o_record && o_record.n_um__known === 100 && o_record.n_px__line === 400 && o_record.a_o_point.length === 2 && o_record.n_scl_x === 800, 'how the scale was measured is stored with it');
                f_assert(o_record.s_path_image.startsWith('/scans/size_calibration/size_calibration_') && o_record.s_path_image.endsWith('.jpg'), 'snapshot path stored: ' + o_record.s_path_image);
                f_assert(a_o_save.at(-1)[0] === 'o_calibration' && a_o_save.at(-1)[1].o_scale__record.s_path_image === o_record.s_path_image, 'snapshot path saved');
                let el_snapshot = document.querySelector('.size-snapshot');
                f_assert(el_snapshot && el_snapshot.href.includes(encodeURIComponent(o_record.s_path_image)) && el_snapshot.target === '_blank', 'snapshot opens full size');
                f_assert(el_snapshot.querySelector('svg').getAttribute('viewBox') === '80 20 640 360', 'thumbnail frames the measured line');
                f_assert(f_text().includes('measured: 100 µm = 400.0 px'), 'the measurement is named next to the snapshot');
                f_assert(o_state.o_calibration.n_um__per_px === 0.25 && o_state.o_calibration.n_ts_ms__scale > 0, 'scale stored');
                f_assert(o_state.o_calibration.o_camera__scale.n_width === 800, 'camera image size stored with the scale');
                f_assert(a_o_save.some(a => a[0] === 'o_calibration' && a[1].n_um__per_px === 0.25), 'scale saved');
                f_assert(f_text().includes('100 µm'), 'the stored scale reads the same line as 100 µm');

                // drag a placed point: 0.1 mm now spans 200 camera px
                let el_handle = document.querySelectorAll('.size-handle')[1];
                f_pointer(el_handle, 'pointerdown', 300, 100); f_pointer(el_handle, 'pointermove', 200, 100); f_pointer(el_handle, 'pointerup', 200, 100);
                await nextTick();
                f_assert(o_vm.a_o_point[1].n_x === 400 && f_text().includes('0.5 µm/px'), 'dragging a point updates the new scale');
                f_assert(o_state.o_calibration.n_um__per_px === 0.25, 'nothing is stored until Save');

                // one press-drag-release draws the whole line; µm as unit
                let el_unit = document.querySelector('#scale-unit'); el_unit.value = 'um'; el_unit.dispatchEvent(new Event('change', { bubbles: true }));
                let el_known = document.querySelector('#scale-known'); el_known.value = '50'; el_known.dispatchEvent(new Event('input', { bubbles: true })); el_known.dispatchEvent(new Event('change', { bubbles: true }));
                f_button('Set points').click(); await nextTick();
                let el_layer = document.querySelector('.size-pick-layer');
                f_pointer(el_layer, 'pointerdown', 100, 200); f_pointer(el_layer, 'pointermove', 200, 200); f_pointer(el_layer, 'pointerup', 200, 200);
                await nextTick();
                f_assert(!o_vm.b_picking && f_near(o_vm.n_px__line, 200) && f_near(o_vm.o_scale__new.n_um__per_px, 0.25), 'drag gesture: 50 µm over 200 px');
                // an old app server: the scale is stored anyway and the window says what to do
                o_server.b_old = true; o_state.o_calibration.n_um__per_px = 0;
                f_button('Save').click(); await f_snapshot_done();
                f_assert(f_near(o_state.o_calibration.n_um__per_px, 0.25) && o_state.o_calibration.o_scale__record.s_path_image === '', 'scale stored without a snapshot');
                f_assert(f_text().includes('restart the app server') && !document.querySelector('.size-snapshot'), 'missing snapshot is explained');
                o_server.b_old = false;
                f_assert(a_o_save.some(a => a[0] === 'o_size' && a[1].n_known === 50 && a[1].s_unit === 'um'), 'known distance is remembered');
                f_button('Set points').click(); await nextTick();
                f_click(50, 50); await nextTick();
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
                f_assert(!o_vm.b_picking && o_vm.a_o_point.length === 0, 'Escape cancels and drops a single point');

                // typing a known scale
                let el_scale = document.querySelector('[aria-label="Stored scale"]');
                el_scale.value = '0.5'; el_scale.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
                f_assert(o_state.o_calibration.n_um__per_px === 0.5, 'typed scale stored');
                f_assert(o_state.o_calibration.o_scale__record === null && !f_text().includes('measured:') && !f_text().includes('restart the app server'), 'a typed scale has no measurement record');
                el_scale.value = '0.25'; el_scale.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();

                // ── measure ──────────────────────────────────────────
                document.querySelector('.cockpit-tab[data-tab="measure"]').click(); await nextTick();
                f_button('Set points').click(); await nextTick();
                f_click(100, 100); f_click(200, 100); f_click(200, 200); await nextTick();
                f_assert(n_jog === 0 && o_vm.a_o_point__measure.length === 3 && o_vm.b_picking, 'clicks add points to the path');
                f_assert(f_near(o_vm.n_um__measure, 100) && f_near(o_vm.n_um__measure__direct, Math.hypot(200, 200) * 0.25), 'path 2 x 200 px at 0.25 µm/px');
                let a_s_label = [...document.querySelectorAll('.size-drawing--measure text')].map(el => el.textContent);
                f_assert(a_s_label.filter(s => s === '50 µm').length === 2 && a_s_label.includes('total 100 µm'), 'each line and the total are labelled: ' + a_s_label);
                f_button('Done').click(); await nextTick();
                f_assert(!o_vm.b_picking && document.querySelector('.size-svg').classList.contains('interactive'), 'points can be grabbed after Done');
                let a_el_handle = document.querySelectorAll('.size-drawing--measure .size-handle');
                f_pointer(a_el_handle[2], 'pointerdown', 200, 200); f_pointer(a_el_handle[2], 'pointermove', 300, 100); f_pointer(a_el_handle[2], 'pointerup', 300, 100);
                await nextTick();
                f_assert(f_near(o_vm.n_um__measure, 100) && f_near(o_vm.n_um__measure__direct, 100), 'dragging the last point straightens the path');
                a_el_handle = document.querySelectorAll('.size-drawing--measure .size-handle');
                f_pointer(a_el_handle[1], 'pointerdown', 200, 100); f_pointer(a_el_handle[1], 'pointerup', 200, 100); await nextTick();
                f_assert(o_vm.a_o_point__measure.length === 2 && f_near(o_vm.n_um__measure, 100), 'a click on a point removes it');
                f_button('Undo').click(); await nextTick();
                f_assert(o_vm.a_o_point__measure.length === 1, 'Undo removes the last point');
                f_button('Clear').click(); await nextTick();
                f_assert(o_vm.a_o_point__measure.length === 0 && f_button('Clear').disabled, 'Clear removes the path');

                // ── reference ────────────────────────────────────────
                document.querySelector('.cockpit-tab[data-tab="reference"]').click(); await nextTick();
                let f_check = async s_label => { document.querySelector('[aria-label="' + s_label + '"]').click(); await nextTick(); };
                await f_check('Size grid');
                // 0.5 window px per camera px / 0.25 µm per camera px = 2 window px per µm -> 50 µm cells of 100 px
                let el_pattern = document.querySelector('#size-grid-pattern');
                f_assert(el_pattern && Number(el_pattern.getAttribute('width')) === 100 && document.querySelector('.size-grid'), 'automatic grid: 50 µm cells');
                f_assert([...document.querySelectorAll('.size-reference text')].some(el => el.textContent === 'grid 50 µm'), 'grid is labelled with its cell size');
                let el_cell = document.querySelector('#size-grid'); el_cell.value = '20'; el_cell.dispatchEvent(new Event('input', { bubbles: true })); el_cell.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
                f_assert(Number(document.querySelector('#size-grid-pattern').getAttribute('width')) === 40, 'typed cell size: 20 µm = 40 px');
                await f_check('Size ruler');
                f_assert([...document.querySelectorAll('.size-ruler text')].map(el => el.textContent).join('|') === '0|50 µm', 'ruler: a quarter of the 200 µm wide image');
                let el_object = document.querySelector('#size-object'); el_object.value = 'rbc'; el_object.dispatchEvent(new Event('change', { bubbles: true })); await nextTick();
                let el_shape = document.querySelector('.size-object ellipse');
                f_assert(el_shape && Number(el_shape.getAttribute('rx')) === 7.5, 'red blood cell: 7.5 µm = 15 px across');
                f_assert(document.querySelector('.size-object text').textContent.includes('Red blood cell'), 'object is named on the image');
                // drag the object: it starts at the image centre (200, 150)
                let el_group = document.querySelector('.size-object');
                f_pointer(el_group, 'pointerdown', 200, 150); f_pointer(el_group, 'pointermove', 100, 75); f_pointer(el_group, 'pointerup', 100, 75); await nextTick();
                f_assert(f_near(o_state.o_size.o_pos__object.n_x, 0.25) && f_near(o_state.o_size.o_pos__object.n_y, 0.25), 'object position is kept as a fraction of the image');
                f_assert(a_o_save.at(-1)[0] === 'o_size' && a_o_save.at(-1)[1].b_grid && a_o_save.at(-1)[1].s_object === 'rbc', 'reference settings saved');
                f_assert(document.querySelector('.size-reference').style.opacity === '0.6', 'references are semi-transparent');

                // references stay on the image when the window closes, but never take the mouse
                o_state.o_panel_visibility.scale = false; await nextTick();
                f_assert(document.querySelector('.size-grid') && document.querySelector('.size-ruler') && document.querySelector('.size-object'), 'references remain with the window closed');
                f_assert(!document.querySelector('.size-pick-layer') && !document.querySelector('.size-svg').classList.contains('interactive'), 'closed window: nothing interactive');
                f_assert(document.elementFromPoint(100, 75).id === 'jog', 'closed window: the object does not block mouse movement');
                o_state.o_panel_visibility.scale = true; await nextTick();

                // a scale stored for another camera image size is not used
                o_state.o_calibration.o_camera__scale = { n_width: 1600, n_height: 1200, n_width__sensor: 1600, n_height__sensor: 1200, o_hardware_crop: null };
                await nextTick();
                f_assert(f_text().includes('Calibrate again') && !document.querySelector('.size-reference'), 'changed camera resolution hides the references and says why');
                document.querySelector('.cockpit-tab[data-tab="measure"]').click(); await nextTick();
                f_assert(f_button('Set points').disabled, 'measuring needs a scale for this camera image');
                o_state.o_calibration.o_camera__scale = null; o_state.o_calibration.n_um__per_px = 0; await nextTick();
                f_assert(f_button('Set points').disabled && f_text().includes('calibrate the size first'), 'measuring needs a stored scale');

                // a camera that stops clears the drawings
                o_state.o_calibration.n_um__per_px = 0.25; await nextTick();
                document.querySelector('.cockpit-tab[data-tab="calibrate"]').click(); await nextTick();
                f_button('Set points').click(); await nextTick(); f_click(100, 100); f_click(300, 100); await nextTick();
                o_state.b_streaming__webcam = false; await nextTick();
                f_assert(o_vm.a_o_point.length === 0 && !document.querySelector('.size-svg') && f_button('Set points').disabled, 'no camera: nothing drawn, nothing to place');
                document.body.dataset.result = 'PASS';
            } catch (o_error) { document.body.dataset.result = 'FAIL'; document.body.textContent = o_error.stack; }
            finally { o_app?.unmount(); }
            </script>`, { headers: { 'content-type': 'text/html' } });
        try {
            return new Response(await Deno.readTextFile(new URL('../webserved_dir' + s_path, import.meta.url)),
                { headers: { 'content-type': s_path.endsWith('.css') ? 'text/css' : 'text/javascript' } });
        } catch { return new Response('', { status: 404 }); }
    });
    try {
        let o_result = await new Deno.Command('/usr/bin/google-chrome', { args: [
            '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--window-size=1000,700',
            '--user-data-dir=' + s_dir, '--virtual-time-budget=10000', '--dump-dom',
            'http://127.0.0.1:' + o_server.addr.port,
        ], stdout: 'piped', stderr: 'piped' }).output();
        let s_html = new TextDecoder().decode(o_result.stdout);
        assert.ok(s_html.includes('data-result="PASS"'), s_html.slice(-3000) || new TextDecoder().decode(o_result.stderr));
        // one snapshot was written: a JPEG in the size calibration folder
        assert.equal(a_o_upload.length, 1);
        assert.equal(a_o_upload[0].s_path_folder, '/scans/size_calibration');
        assert.match(a_o_upload[0].s_filename, /^size_calibration_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.jpg$/);
        assert.ok(a_o_upload[0].a_n_byte.length > 500 && a_o_upload[0].a_n_byte[0] === 0xff && a_o_upload[0].a_n_byte[1] === 0xd8, 'JPEG data');
    } finally { await o_server.shutdown(); await Deno.remove(s_dir, { recursive: true }); }
});
