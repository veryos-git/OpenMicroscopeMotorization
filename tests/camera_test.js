import assert from 'node:assert/strict';
import { f_a_o_camera_mode, f_a_o_camera_control } from '../camera_functions.module.js';

Deno.test('v4l2-ctl format list becomes the unique sensor sizes, smallest first', () => {
    const s_format = `ioctl: VIDIOC_ENUM_FMT
\tType: Video Capture

\t[0]: 'MJPG' (Motion-JPEG, compressed)
\t\tSize: Discrete 2592x1944
\t\t\tInterval: Discrete 0.033s (30.000 fps)
\t\tSize: Discrete 1280x720
\t\t\tInterval: Discrete 0.033s (30.000 fps)
\t[1]: 'YUYV' (YUYV 4:2:2)
\t\tSize: Discrete 2592x1944
\t\t\tInterval: Discrete 0.500s (2.000 fps)
\t\tSize: Discrete 640x480
\t\t\tInterval: Discrete 0.033s (30.000 fps)
`;
    assert.deepEqual(f_a_o_camera_mode(s_format), [
        { n_scl_x: 640, n_scl_y: 480 }, { n_scl_x: 1280, n_scl_y: 720 }, { n_scl_x: 2592, n_scl_y: 1944 },
    ]);
    // the metadata node of a camera lists no size
    assert.deepEqual(f_a_o_camera_mode('ioctl: VIDIOC_ENUM_FMT\n\tType: Video Capture\n'), []);
});

Deno.test('v4l2-ctl control list becomes the sliders with range, value and inactive flag', () => {
    const s_control = `
User Controls

                     brightness 0x00980900 (int)    : min=-64 max=64 step=1 default=0 value=17 flags=has-min-max
        white_balance_automatic 0x0098090c (bool)   : default=1 value=1
                           gain 0x00980913 (int)    : min=0 max=100 step=1 default=0 value=100 flags=has-min-max
           power_line_frequency 0x00980918 (menu)   : min=0 max=2 default=1 value=1 (50 Hz)

Camera Controls

         exposure_time_absolute 0x009a0902 (int)    : min=1 max=5000 step=1 default=157 value=80 flags=inactive, has-min-max
`;
    assert.deepEqual(f_a_o_camera_control(s_control), [
        { s_name: 'brightness', n_min: -64, n_max: 64, n_step: 1, n_default: 0, n_val: 17, b_inactive: false },
        { s_name: 'gain', n_min: 0, n_max: 100, n_step: 1, n_default: 0, n_val: 100, b_inactive: false },
        { s_name: 'exposure_time_absolute', n_min: 1, n_max: 5000, n_step: 1, n_default: 157, n_val: 80, b_inactive: true },
    ]);
});
