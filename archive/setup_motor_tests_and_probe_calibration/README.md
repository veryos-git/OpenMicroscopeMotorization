# Archived: Setup motor tests & probe calibration

Archived 2026-10-25.

The X/Y calibration was replaced by a travel run that works on the stick-slip
friction drive (see `docs/features/hgc_image_stitching/24-10-2026_freeoutline_problem/summary_mgc.md`).
Calibration now starts only from the auto-calibrate button in each Setup axis row,
so the "Motor tests & calibration" section of the Setup window was no longer used.

| file | what it was |
| --- | --- |
| `o_component__backlash.js` | the calibration component as of commit `ae5cdd1`: the old X/Y probe run (small probes until the image moved 25 px, then a knee fit), plus its motor-card UI: Calibrate button, hints, advanced settings, results table and plot. The live file `webserved_dir/o_component__backlash.js` keeps the Z sharpness run and the new X/Y travel run, without UI. |
| `o_component__setup__motor_tests.js` | the removed Setup section (Calibrate all, motor cards with position and ↶ ↷ test moves, Steps, Stop all, Refresh) and the methods only it used. The compiler note moved into the Flash button's tooltip. |
| `o_component__jog__manual_movement.js` | the "Manual movement" section of the jog component (speed, mouse movement toggle, per-key input directions). Speed and mouse movement are in the toolbar; key directions follow the Reverse buttons. The jog component itself stays mounted for keyboard, mouse and gamepad movement. |
| `o_component__calibration.js` | the calibration checklist ("Calibration checklist & optical settings"), only shown inside that section. Its main link opened the advanced settings above. Scale and flat-field are in the toolbar's Calibration overlay. |
| `index__removed.css` | the CSS rules that only styled the UI above, the unmounted panels in `archive/unmounted_panels/`, and older motor-card leftovers (`.hardware-motors`, `.motor-rotor`, `.hardware-wiring`). |

Removed tests are in `archive/tests/` (`motor_calibration_browser_smoke.mjs`,
`setup_motor_tests_removed_test.js`).

## Why the old X/Y run failed

- It stopped once the image had moved 25 px. At about 0.03–0.05 steps per pixel
  in 4K, a 10-step probe already moves the image about 23 px, so a quick run
  left only one or two samples after the slack. The fit needs three.
- On a stage that sticks and then jumps, a short run shows one jump instead of
  a ramp, so the run never produced a usable measurement.
- A run whose image barely moved could still fit a straight line through noise
  and save an absurd scale (Y once got 17.21 st/px against 0.045 for X).
