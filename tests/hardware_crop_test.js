import assert from 'node:assert/strict';
import { f_o_free_scan_plan } from '../webserved_dir/free_scan.module.js';
import { f_set_camera_crop_provider, f_s_camera_crop_key, f_b_camera_crop_valid,
    f_o_camera_geometry, f_o_camera_geometry_snapshot, f_b_camera_geometry_matches } from '../webserved_dir/camera_frame.module.js';

Deno.test('hardware crop rejects malformed and out-of-bounds rectangles without rescaling', () => {
    const video = { videoWidth: 1920, videoHeight: 1080 };
    const crop = { n_x: 200, n_y: 100, n_scl_x: 1200, n_scl_y: 800 };
    try {
        assert.equal(f_b_camera_crop_valid(crop, 1920, 1080), true);
        for (const invalid of [null, {}, { ...crop, n_x: -1 }, { ...crop, n_y: NaN },
            { ...crop, n_scl_x: 0 }, { ...crop, n_scl_y: 1000 }, { ...crop, n_x: .5 },
            { ...crop, n_scl_x: Infinity }, { ...crop, n_y: '100' }]) {
            assert.equal(f_b_camera_crop_valid(invalid, 1920, 1080), false);
            f_set_camera_crop_provider(() => invalid);
            assert.deepEqual(f_o_camera_geometry(video), { n_x: 0, n_y: 0, n_scl_x: 1920, n_scl_y: 1080 });
        }
        f_set_camera_crop_provider(() => crop);
        assert.deepEqual(f_o_camera_geometry(video), crop);
        assert.deepEqual(f_o_camera_geometry(null), { n_x: 0, n_y: 0, n_scl_x: 0, n_scl_y: 0 });
    } finally { f_set_camera_crop_provider(() => null); }
});

Deno.test('hardware crop restores only the same camera and sensor resolution', () => {
    let device = 'camera-1';
    const crop = { n_x: 10, n_y: 20, n_scl_x: 600, n_scl_y: 400 };
    const saved = JSON.parse(JSON.stringify({ [f_s_camera_crop_key(device, 640, 480)]: crop }));
    const video = { videoWidth: 640, videoHeight: 480 };
    try {
        f_set_camera_crop_provider((w, h) => saved[f_s_camera_crop_key(device, w, h)]);
        assert.deepEqual(f_o_camera_geometry(video), crop);
        device = 'camera-2'; assert.equal(f_o_camera_geometry(video).n_scl_x, 640);
        device = 'camera-1'; video.videoWidth = 1280; assert.equal(f_o_camera_geometry(video).n_scl_x, 1280);
        video.videoWidth = 640; assert.deepEqual(f_o_camera_geometry(video), crop);
    } finally { f_set_camera_crop_provider(() => null); }
});

Deno.test('flat fields match crop origin as well as dimensions, including legacy full-frame snapshots', () => {
    const video = { videoWidth: 640, videoHeight: 480 };
    let crop = null;
    try {
        f_set_camera_crop_provider(() => crop);
        const legacy = { n_width: 640, n_height: 480 };
        assert.equal(f_b_camera_geometry_matches(legacy, video), true);
        crop = { n_x: 10, n_y: 20, n_scl_x: 600, n_scl_y: 400 };
        assert.equal(f_b_camera_geometry_matches(legacy, video), false);
        assert.equal(f_b_camera_geometry_matches(null, video), false);
        const snapshot = f_o_camera_geometry_snapshot(video);
        assert.equal(snapshot.n_width, 600);
        assert.equal(snapshot.n_width__sensor, 640);
        assert.equal(f_b_camera_geometry_matches(snapshot, video), true);
        crop = { ...crop, n_x: 11 };
        assert.equal(f_b_camera_geometry_matches(snapshot, video), false);
        crop = null;
        assert.equal(f_b_camera_geometry_matches(snapshot, video), false);
    } finally { f_set_camera_crop_provider(() => null); }
});

Deno.test('grid and free scan coverage use the cropped field of view at unchanged motor scale', async () => {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__scan.js', import.meta.url)))
        .replace(/^import .*;\n/gm, '').replace(/export \{[^}]+\};?/, '');
    const state = { o_camera: { n_width: 640, n_height: 480 } };
    const video = { videoWidth: 640, videoHeight: 480 };
    const component = new Function('o_state', 'f_o_camera_geometry', 'f_o_free_scan_plan', 'document',
        source + '\nreturn o_component__scan;')(state, f_o_camera_geometry, f_o_free_scan_plan, { getElementById: () => video });
    const vm = { n_step__per_px__x: 2, n_step__per_px__y: 3, n_overlap__pct: 20,
        o_box__grid: { n_extent_x: 4000, n_extent_y: 4000, n_min_x: 0, n_min_y: 0 },
        a_o_point__free: [{ n_x: 0, n_y: 0, n_z: 0 }, { n_x: 4000, n_y: 0, n_z: 0 },
            { n_x: 4000, n_y: 4000, n_z: 0 }, { n_x: 0, n_y: 4000, n_z: 0 }], f_save_config() {},
    };
    try {
        component.methods.f_auto_grid.call(vm);
        const uncroppedTiles = vm.n_tile_x * vm.n_tile_y;
        f_set_camera_crop_provider(() => ({ n_x: 160, n_y: 120, n_scl_x: 320, n_scl_y: 240 }));
        component.methods.f_auto_grid.call(vm);
        assert.deepEqual([vm.n_step__x, vm.n_step__y], [512, 576]);
        assert.ok(vm.n_tile_x * vm.n_tile_y > uncroppedTiles);
        const result = component.computed.o_free_plan_result.call(vm);
        assert.equal(result.s_error, '');
        assert.deepEqual([result.o_plan.n_width, result.o_plan.n_height], [320, 240]);
        assert.deepEqual([result.o_plan.n_step__x, result.o_plan.n_step__y], [512, 576]);
    } finally { f_set_camera_crop_provider(() => null); }
});

Deno.test('calibration checklist marks legacy and shifted flat fields stale after cropping', async () => {
    const source = (await Deno.readTextFile(new URL('../webserved_dir/o_component__calibration.js', import.meta.url)))
        .replace(/^import .*;\n/gm, '').replace(/export \{[^}]+\};?/, '');
    const state = { o_camera: { b_active: true, n_width: 640, n_height: 480 },
        o_flat_field: { s_path_flat: 'flat.png', o_camera__flat: null } };
    const component = new Function('o_state', 'f_b_camera_geometry_matches', source + '\nreturn o_component__calibration;')(
        state, f_b_camera_geometry_matches);
    const status = () => component.computed.s_status__flat.call(component.methods);
    let crop = null;
    try {
        f_set_camera_crop_provider(() => crop);
        assert.equal(status(), 'ready');
        crop = { n_x: 100, n_y: 80, n_scl_x: 400, n_scl_y: 300 };
        assert.equal(status(), 'stale');
        state.o_flat_field.o_camera__flat = f_o_camera_geometry_snapshot({ videoWidth: 640, videoHeight: 480 });
        assert.equal(status(), 'ready');
        crop = { ...crop, n_y: 81 };
        assert.equal(status(), 'stale');
    } finally { f_set_camera_crop_provider(() => null); }
});
