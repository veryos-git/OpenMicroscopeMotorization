# Free outline scan: everything on one line (24-10-2026)

## Symptom
Four focused corners (X 365–885, Y 1626–2066 steps) form a rectangle, but the preview shows a flat line and the plan is one row of 7 images. See `image.png`.

## Cause
The Y steps-per-pixel calibration was wrong, not the free outline code (`free_scan.module.js`, unchanged since 09-10-2026; its tests pass).

| Motor | Steps per px |
|---|---|
| X (M1) | 0.0449 (was 0.0792) |
| Y (M2) | **17.21**, from a bad run on 21-10-2026 00:54 |

Image spacing is `camera px × st/px × (1 − overlap)`. At 4K with 50% overlap that gives 86 steps in X and 18,589 in Y, so the whole rectangle fits into one row.

Sanity check with 0.213 µm/px: X is about 4.7 µm per step, which fits a 28BYJ-48 driving an O-ring. Y would be 12 nm per step, which is impossible. With the same drive on both axes, the values should be roughly equal.

## Why Y calibration fails
- The Y stage sticks for several probes, then jumps (stick-slip from the rubber friction drive).
- The fit needs a gradual ramp over several probes. One jump gives only one point, so you get "no run produced a usable measurement" and the old value stays.
- The 17.21 probably came from a run where Y barely moved and the fit accepted noise. There is no check against that.
- The camera was still on auto exposure. Calibration needs manual exposure.

## Changes (not committed)
- Setup: a **st/px** input per X/Y axis row next to Backlash, saved per physical motor (`o_component__setup.js`, `index.css`). Not in the UI drawing yet.
- Calibration results now show st/px in full camera pixels. They were in units of the 400-px measurement frame, about 9.6× too high at 4K (`o_component__backlash.js`).
- Test: `tests/microcontroller_browser_test.js`. 38 tests pass.

## Workaround
Set Y st/px to the X value (0.0449), keep 50% overlap, and run the scan.

## Open
- Hardware: fix Y stick-slip (drive pressure, stage friction, rail surface; see `docs/hardware/research/antrieb/reibungsantrieb`).
- Calibration: refuse to save st/px when the image barely moved, and report stick-slip instead of the generic failure.
- Scan panel: warn when X and Y st/px differ by a large factor.
