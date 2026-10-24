import { createApp, nextTick } from './lib/vue.esm-browser.js';
import { o_state, saved } from './index.js';
import { o_component__hardware_crop } from './o_component__hardware_crop.js';
import { o_component__webcam } from './o_component__webcam.js';
import { o_component__filter, f_o_filter__default } from './o_component__filter.js';
import { f_o_camera_geometry, f_b_camera_geometry_matches, f_el_camera_frame } from './camera_frame.module.js';
import { f_o_camera_snapshot, f_b_camera_resolution_locked } from './o_camera.module.js';
import { f_o_capture__frame, f_o_frame__imagedata } from './o_capture.module.js';
import { f_flat__set } from './o_flatfield.module.js';
import { f_o_source } from './o_video.module.js';
import { f_n_score__video } from './focus_search.module.js';
import { o_component__zoom } from './o_component__zoom.js';

const assert = (ok, message) => { if (!ok) throw Error(message); };
const equal = (a, b, message) => assert(JSON.stringify(a) === JSON.stringify(b), message + ': ' + JSON.stringify(a));
let app, filterApp, recording;
let result = { ok: false, error: 'Test did not finish' };
try {
    // A lossless synthetic sensor with native video metadata; drawImage accepts it
    // directly, so assertions detect even a one-pixel crop/ROI offset.
    const video = document.getElementById('webcamVideo');
    const ctx = video.getContext('2d');
    const pixels = ctx.createImageData(96, 64);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) pixels.data.set([x, y, 100, 255], (y * 96 + x) * 4);
    ctx.putImageData(pixels, 0, 0);
    const track = { readyState: 'live', getSettings: () => ({ width: 96, height: 64, deviceId: 'sensor-1' }) };
    Object.assign(video, { videoWidth: 96, videoHeight: 64, readyState: 4, srcObject: { getVideoTracks: () => [track] } });
    app = createApp(o_component__hardware_crop);
    const vm = app.mount('#crop');
    await nextTick();
    equal(vm.o_output.n_scl_x, 96, 'Default sensor size');
    const crop = { n_x: 16, n_y: 8, n_scl_x: 48, n_scl_y: 32 };
    // Reverse pointer selection uses sensor coordinates.
    const rect = vm.$refs.el_preview.getBoundingClientRect();
    const event = (x,y) => ({ clientX: rect.left + x * rect.width / 96, clientY: rect.top + y * rect.height / 64 });
    vm.o_start = { n_x: 64, n_y: 40 };
    vm.f_drag(event(16,8)); vm.o_start = null;
    equal(vm.o_draft, crop, 'Reverse drag geometry');
    document.querySelector('.hardware-crop form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await nextTick();
    equal(f_o_camera_geometry(video), crop, 'Applied crop');
    assert(Object.keys(saved.o_hardware_crop).length === 1, 'Crop not saved');
    assert(o_state.o_zoom.n_scl_x__roi === 0 && !o_state.o_cellpose.s_path_mask, 'Old overlay geometry retained');
    assert(document.querySelector('.hardware-crop').textContent.includes('48 × 32 px'), 'Output size not shown');
    const snapshot = f_o_camera_snapshot();
    equal([snapshot.n_width, snapshot.n_height, snapshot.n_width__sensor], [48,32,96], 'Camera metadata');

    const decode = async capture => {
        const bitmap = await createImageBitmap(capture.o_blob);
        const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
        const context = canvas.getContext('2d'); context.drawImage(bitmap,0,0); bitmap.close();
        return { width: canvas.width, height: canvas.height, pixel: (x,y) => [...context.getImageData(x,y,1,1).data] };
    };
    const capture = await f_o_capture__frame({ b_flash: false, b_flat: false });
    const raw = await decode(capture);
    equal([raw.width,raw.height,capture.n_scl_x__video,capture.n_scl_y__video], [48,32,48,32], 'Capture and map metadata');
    equal(raw.pixel(0,0), [16,8,100,255], 'Hardware crop origin');
    equal(raw.pixel(47,31), [63,39,100,255], 'Hardware crop bottom-right');
    video.currentTime = 1;
    f_el_camera_frame(video);
    ctx.fillStyle = '#fff'; ctx.fillRect(16,8,1,1);
    equal([...f_el_camera_frame(video).getContext('2d').getImageData(0,0,1,1).data], [16,8,100,255], 'Same decoded frame should share a crop copy');
    video.currentTime = 2;
    equal([...f_el_camera_frame(video).getContext('2d').getImageData(0,0,1,1).data], [255,255,255,255], 'New frame must refresh crop pixels');
    ctx.putImageData(pixels,0,0); video.currentTime = 3;
    const roi = await f_o_capture__frame({ b_flat: false, b_flash: false, o_roi: { n_x: 3, n_y: 2, n_scl_x: 10, n_scl_y: 6 } });
    const nested = await decode(roi);
    equal([nested.width,nested.height], [10,6], 'Nested ROI dimensions');
    equal(nested.pixel(0,0), [19,10,100,255], 'Training/zoom ROI must be relative to hardware crop');
    equal(roi.o_roi.n_x, 3, 'ROI metadata must stay in cropped image coordinates');
    const small = await f_o_capture__frame({ n_scl_max: 24, b_flash: false });
    equal([small.n_scl_x,small.n_scl_y,small.n_scl_x__video], [24,16,48], 'Map downscaling after crop');
    const flatFrame = await f_o_frame__imagedata();
    equal([flatFrame.n_scl_x,flatFrame.n_scl_y], [48,32], 'Flat calibration dimensions');
    equal([...flatFrame.o_imagedata.data.slice(0,4)], [16,8,100,255], 'Flat calibration sensor region');

    const preview = document.createElement('canvas');
    const webcam = { $refs: { el_video: video, el_frame: preview }, b_streaming: true };
    o_component__webcam.methods.f_draw_frame.call(webcam);
    cancelAnimationFrame(webcam._n_id__frame);
    equal([preview.width,preview.height,webcam.b_cropped], [48,32,true], 'Live preview geometry');
    equal([...preview.getContext('2d').getImageData(0,0,1,1).data], [16,8,100,255], 'Live preview pixels');
    const box = o_component__zoom.methods.f_o_box__video();
    equal([box.n_scl_x__video,box.n_scl_y__video], [48,32], 'Zoom overlay coordinates');
    const cache = {};
    f_n_score__video(video, { n_scl_x__measure: 96, n_pct__roi: 100, s_metric: 'tenengrad' }, cache);
    equal([cache.el_canvas.width,cache.el_canvas.height], [48,32], 'Autofocus measurement geometry');
    equal([...cache.el_canvas.getContext('2d').getImageData(0,0,1,1).data], [16,8,100,255], 'Autofocus crop');

    Object.assign(o_state.o_filter, f_o_filter__default(), { b_enabled: true, b_histogram: true });
    filterApp = createApp(o_component__filter);
    const filter = filterApp.mount('#filter');
    await nextTick(); filter.f_render(); filter.f_histogram(1000);
    assert(!filter.s_error && filter._o_gl, filter.s_error || 'Missing WebGL');
    assert(filter.o_histogram.n_pixels === 48 * 32, 'Histogram analyzed sensor borders');
    const gl = filter._o_gl;
    equal([gl.canvas.width,gl.canvas.height], [48,32], 'Filter resolution');
    const glPixel = new Uint8Array(4); gl.readPixels(0,31,1,1,gl.RGBA,gl.UNSIGNED_BYTE,glPixel);
    assert(Math.abs(glPixel[0]-16)<=1 && Math.abs(glPixel[1]-8)<=1, 'Filter uploaded uncropped or flipped pixels: '+glPixel);
    recording = f_o_source('raw', 15);
    equal([recording.el_canvas.width,recording.el_canvas.height], [48,32], 'Raw video must not bypass crop');
    equal([...recording.el_canvas.getContext('2d').getImageData(0,0,1,1).data], [16,8,100,255], 'Raw video source pixels');
    const recordedTrack = recording.o_stream.getVideoTracks()[0];
    equal([recordedTrack.getSettings().width,recordedTrack.getSettings().height], [48,32], 'Recorded stream size');
    recording.f_destroy(); recording = null;
    assert(recordedTrack.readyState === 'ended', 'Cropped stream cleanup');

    const flat = new Uint8ClampedArray(48*32*4);
    for (let i=0;i<48*32;i++) { const v=i%48<24?64:128; flat.set([v,v,v,255],i*4); }
    f_flat__set(flat,48,32);
    Object.assign(o_state.o_flat_field, { b_active: true, o_camera__flat: snapshot });
    const corrected = await decode(await f_o_capture__frame({ b_flash: false }));
    equal(corrected.pixel(0,0), [24,12,150,255], 'Crop must precede flat correction');
    vm.o_draft = { ...crop, n_x: 17 }; assert(vm.f_apply(false), vm.s_error);
    assert(!f_b_camera_geometry_matches(snapshot,video), 'Same-size shifted flat must be stale');
    const shifted = await decode(await f_o_capture__frame({ b_flash: false }));
    equal(shifted.pixel(0,0), [17,8,100,255], 'Stale flat applied to different sensor pixels');
    filter.f_render(); gl.readPixels(0,31,1,1,gl.RGBA,gl.UNSIGNED_BYTE,glPixel);
    assert(Math.abs(glPixel[0]-17)<=1 && Math.abs(glPixel[1]-8)<=1, 'Stale flat reached live WebGL');

    for (const lock of ['b_scanning','b_training_busy','b_training_capture_busy']) {
        o_state[lock] = true; await nextTick();
        assert(f_b_camera_resolution_locked() && vm.b_locked, 'Crop lock missing: '+lock);
        assert(!vm.f_apply(true), 'Locked crop changed');
        assert(document.querySelector('.hardware-crop fieldset').disabled, 'Crop inputs not locked');
        o_state[lock] = false;
    }
    for (const [key, flag] of [['o_record','b_running'],['o_video','b_recording'],['o_video','b_burst'],['o_video','b_preroll']]) {
        o_state[key] = { [flag]: true }; assert(!vm.f_apply(true), 'Recording lock missing'); o_state[key] = {};
    }
    const persisted = JSON.parse(JSON.stringify(saved.o_hardware_crop));
    o_state.s_id__webcam_device = 'sensor-2'; await nextTick();
    equal(f_o_camera_geometry(video).n_scl_x,96,'Crop leaked to another camera');
    o_state.s_id__webcam_device = 'sensor-1'; o_state.o_hardware_crop = persisted; await nextTick();
    equal(f_o_camera_geometry(video).n_x,17,'Crop not restored after reconnect');
    vm.o_draft = { ...crop, n_x: -1 }; assert(!vm.f_apply(false), 'Invalid crop accepted');
    equal(f_o_camera_geometry(video).n_x,17,'Invalid crop overwrote saved rectangle');
    assert(vm.f_apply(true), vm.s_error);
    equal(f_o_camera_geometry(video), { n_x:0,n_y:0,n_scl_x:96,n_scl_y:64 }, 'Reset full sensor');
    const reset = await decode(await f_o_capture__frame({ b_flat:false,b_flash:false }));
    equal([reset.width,reset.height], [96,64], 'Reset capture');
    document.body.dataset.result = 'PASS'; result = { ok: true };
} catch (error) {
    document.body.dataset.result = 'FAIL'; document.body.textContent = error.stack; result.error = error.stack;
} finally {
    recording?.f_destroy(); filterApp?.unmount(); app?.unmount();
    await fetch('/result', { method: 'POST', body: JSON.stringify(result) });
}
