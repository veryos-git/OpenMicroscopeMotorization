import assert from 'node:assert/strict';

// Isolate the camera controller from index.js, which boots the full application.
const s_source = await Deno.readTextFile(new URL('../webserved_dir/o_camera.module.js', import.meta.url));
function fixture() {
    const state = { o_camera: { o_capability: {} }, a_o_setting: [], s_id__webcam_device: 'usb-1' };
    let settings = { deviceId: 'usb-1', width: 1920, height: 1080, frameRate: 30 };
    let constraints = { deviceId: { exact: 'usb-1' }, advanced: [{ exposureMode: 'manual' }] };
    const saves = [];
    const track = {
        label: 'USB Microscope', readyState: 'live',
        getSettings: () => ({ ...settings }),
        getCapabilities: () => ({ width: { min: 640, max: 4096 }, height: { min: 480, max: 2160 }, frameRate: { min: 1, max: 60 }, exposureTime: { min: 0, max: 200, step: 0.25 }, resizeMode: ['none', 'crop-and-scale'] }),
        getConstraints: () => structuredClone(constraints),
        applyConstraints: async c => {
            if (c.width?.exact === 1234) throw Object.assign(new Error('unsupported'), { name: 'OverconstrainedError' });
            constraints = structuredClone(c);
            settings.width = c.width?.exact || c.width?.ideal || settings.width;
            settings.height = c.height?.exact || c.height?.ideal || settings.height;
            settings.frameRate = c.frameRate?.exact ?? settings.frameRate;
            for (const entry of c.advanced || []) Object.assign(settings, entry);
        },
    };
    let current = track;
    const video = { srcObject: { getVideoTracks: () => current ? [current] : [] } };
    const save = (key, value) => {
        saves.push([key, structuredClone(value)]);
        state.a_o_setting = state.a_o_setting.filter(o => o.s_key !== key);
        state.a_o_setting.push({ s_key: key, s_value: JSON.stringify(value) });
    };
    const api = new Function('o_state', 'f_save_setting', 'document', 'setTimeout', 'clearTimeout',
        s_source.replace(/^import .*;\n/, '').replace('export {', 'return {'))(
        state, save, { getElementById: () => video }, () => 0, () => {});
    api.f_read_camera();
    return { state, track, saves, api, switchTrack: t => { current = t; } };
}

Deno.test('camera resolution: native 4K, readback, per-device persistence and exposure changes', async () => {
    const { state, track, saves, api } = fixture();
    assert.equal(state.o_camera.s_label, 'USB Microscope');
    assert.equal(await api.f_apply_camera_resolution(3840, 2160), true);
    assert.equal(state.o_camera.n_width, 3840);
    assert.equal(state.o_camera.n_frame_rate, 30);
    assert.deepEqual(saves[0], ['o_camera_resolution', { 'usb-1': { n_width: 3840, n_height: 2160 } }]);
    assert.deepEqual(track.getConstraints().resizeMode, { exact: 'none' });
    await api.f_apply_camera_setting('exposureTime', 100);
    assert.deepEqual(track.getConstraints().width, { exact: 3840 });
    assert.deepEqual(track.getConstraints().advanced, [{ exposureMode: 'manual' }, { exposureTime: 100 }]);
    assert.equal(api.f_o_camera_snapshot().n_width, 3840);
});

Deno.test('camera resolution: rejection and invalid input preserve stream and saved choice', async () => {
    const { state, api, saves } = fixture();
    assert.equal(await api.f_apply_camera_resolution(1234, 567), false);
    assert.match(state.o_camera.s_error__resolution, /cannot use/);
    assert.equal(state.o_camera.n_width, 1920);
    assert.equal(state.o_camera.b_applying_resolution, false);
    assert.equal(await api.f_apply_camera_resolution(NaN, 2160), false);
    assert.equal(saves.length, 0);
    state.b_scanning = true;
    assert.equal(await api.f_apply_camera_resolution(3840, 2160), false);
    assert.match(state.o_camera.s_error__resolution, /Stop scanning/);
});

Deno.test('camera resolution: maximum uses preferences and a replaced track cannot save stale values', async () => {
    const { state, track, api, saves, switchTrack } = fixture();
    assert.equal(await api.f_apply_camera_resolution(4096, 2160, true), true);
    assert.deepEqual(track.getConstraints().width, { ideal: 4096 });
    const apply = track.applyConstraints;
    track.applyConstraints = async c => { await apply(c); switchTrack(null); api.f_camera_stopped(); };
    assert.equal(await api.f_apply_camera_resolution(3840, 2160), false);
    assert.equal(saves.length, 1);
    assert.equal(state.o_camera.b_active, false);
});

Deno.test('camera resolution: restore only the matching device, including without capabilities API', async () => {
    const { state, track, api, saves } = fixture();
    state.a_o_setting.push({ s_key: 'o_camera_resolution', s_value: JSON.stringify({
        'usb-1': { n_width: 4096, n_height: 2160 },
        'usb-2': { n_width: 640, n_height: 480 },
    }) });
    try {
        await api.f_apply_camera__saved();
        assert.equal(state.o_camera.n_width, 4096);
        assert.equal(saves.length, 0);
        api.f_camera_stopped();
        track.getCapabilities = undefined;
        const warn = console.warn;
        console.warn = () => {};
        try { await api.f_apply_camera__saved(); } finally { console.warn = warn; }
        assert.equal(state.o_camera.n_width, 4096);
    } finally { api.f_camera_stopped(); }
});


Deno.test('camera format: exact FPS combined with size, verified and restored', async () => {
    const { state, track, api, saves } = fixture();
    assert.equal(await api.f_apply_camera_resolution(3840, 2160, false, true, 15), true);
    assert.deepEqual(track.getConstraints().frameRate, { exact: 15 });
    assert.equal(saves[0][1]['usb-1'].n_frame_rate, 15);
    api.f_camera_stopped();
    try {
        await api.f_apply_camera__saved();
        assert.equal(state.o_camera.n_frame_rate, 15);
    } finally { api.f_camera_stopped(); }
});

Deno.test('camera format: silently ignored exact request is not saved', async () => {
    const { state, track, api, saves } = fixture();
    track.applyConstraints = async () => {};
    assert.equal(await api.f_apply_camera_resolution(3840, 2160, false, true, 60), false);
    assert.match(state.o_camera.s_error__resolution, /did not confirm/);
    assert.equal(state.o_camera.n_width, 1920);
    assert.equal(saves.length, 0);
});

Deno.test('camera hardware: fractional steps, unavailable ISO, and ignored requests', async () => {
    const { state, track, api } = fixture();
    assert.equal(await api.f_apply_camera_setting('exposureTime', 100.25), true);
    assert.equal(state.o_camera.o_setting.exposureTime, 100.25);
    assert.equal(await api.f_apply_camera_setting('exposureTime', 100.3), false);
    assert.match(state.o_camera.s_error__setting, /step/);
    assert.equal(await api.f_apply_camera_setting('iso', 400), false);
    assert.match(state.o_camera.s_error__setting, /unavailable/);
    assert.equal(api.f_s_key__iso({ gain: { min: 0, max: 10 } }), '');
    track.applyConstraints = async () => {};
    assert.equal(await api.f_apply_camera_setting('exposureTime', 99), false);
    assert.equal(state.o_camera.o_requested.exposureTime, 99);
    assert.equal(state.o_camera.n_time__exposure, 100.25);
    assert.match(state.o_camera.s_error__setting, /did not confirm/);
});
