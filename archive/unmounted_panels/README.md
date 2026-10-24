# Archived: unmounted panels

Archived 2026-10-25.

Neither component was imported or mounted anywhere in the app any more, and no
toolbar entry opened them.

| file | what it was |
| --- | --- |
| `o_component__flat_field.js` | the old Flat-field panel. Flat-field capture now lives in the toolbar's Calibration overlay (`o_component__calibration_overlay.js`); correction itself (`o_flatfield.module.js`) is unchanged. |
| `o_component__hardware_crop.js` | the Hardware crop panel. It was already called retired in commit `1de6e8a`, which archived one of its tests. A crop saved earlier still applies (`o_state.o_hardware_crop`, `index.js`), but there is no UI to set or reset it. |

Their tests are in `archive/tests/` (`hardware_crop.browser.js`,
`hardware_crop_browser_test.js`, and the Flat tool test in
`setup_motor_tests_removed_test.js`). Their CSS is in
`archive/setup_motor_tests_and_probe_calibration/index__removed.css`.

## Former readme section

### Hardware crop for the optical image

Open **Camera Settings → Hardware crop**. Draw a rectangle inside the visible
tube edges on the full sensor preview, or enter Left, Top, Width and Height in
pixels, then press **Apply hardware crop**. **Reset to full sensor** removes it.
The setting is remembered separately for each camera and capture resolution.

This rectangle becomes the camera image for the live view, captures, stitching,
map matching, training, autofocus, calibration and recordings, including raw
video. Pixels are not resized. Digital zoom and training crops use coordinates
inside this image. Camera exposure, resolution and other USB controls still
operate on the original camera track.

Choose the hardware crop before calibrating or collecting images. Changing it
clears live selections and bypasses flat-field correction until its calibration
matches the new crop, including its position. Recalculate a manual scan grid
after changing the crop; free-scan coverage updates automatically. Crop changes
are locked during capture, scanning, calibration and recording.
