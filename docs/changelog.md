# Changelog

What changed in the app, newest first. Before 2026-10-25 the entries are taken
from commit messages; commits titled only "updates" are not listed (see `git log`).

## 2026-10-25

**Calibration**
- X/Y auto-calibrate (one button per axis in Setup) now measures over a long travel and waits until the image stops moving, so it works on drives that stick and then jump. It sets steps per pixel and backlash.
- It saves nothing, and says why, when the image did not move, the view has too little detail, or the two directions disagree.
- Progress and result show in the Setup status line below the axis rows.
- Setup X/Y rows show steps per pixel (**st/px**) and accept a typed value.

**Fixed**
- Free outline scan planned a single row: a bad saved Y calibration (17.21 st/px instead of ~0.03) squashed the outline. The new calibration refuses such values. Details: `docs/features/hgc_image_stitching/24-10-2026_freeoutline_problem/summary_mgc.md`.

**Removed** (moved to `archive/`)
- Setup "Motor tests & calibration": Calibrate all, motor cards with test moves, Steps, Stop all, Refresh, advanced calibration settings and results.
- Calibration checklist.
- "Manual movement" block in Setup. Speed and mouse movement stay in the toolbar; directions follow the Reverse buttons.
- Flat-field and Hardware crop panels (no longer reachable).

**Other**
- Flash button tooltip shows the compiler version.

## 2026-10-24
- Manual stitch panel removed.

## 2026-10-21
- Calibration overlay (scale, flat-field) added; camera settings reworked.

## 2026-10-09
- Free outline scan: scan an area outlined by focused points, with interpolated focus.

## 2026-09-28
- Live stitching (archived later).

## 2026-09-21
- Video recording, timelapse, zoom.

## 2026-09-16
- Calibration hub with checklist; scale (µm/pixel) tool; focus step / depth-of-field calibration; Test X / Test Y in the scan panel.

## 2026-09-15
- Flat-field (dust removal) correction.

## 2026-09-14
- OMM v1.0.0, first release.
