# Changelog

What changed in the app, newest first. Before 2026-10-25 the entries are taken
from commit messages; commits titled only "updates" are not listed (see `git log`).

## 2026-11-10

**Size** (notes: `docs/features/hgc_size/notes_mgc.md`)
- New **Size** window with three tabs. It replaces the old Scale window.
- Calibrate: click two points a known distance apart on the live image (for example one cell of a 0.1 mm grid slide), type the distance in mm or µm, save. A magnifier follows the cursor; placed points can be dragged.
- Calibrate keeps a snapshot: the camera image from the moment the second point is set is saved with the measured line drawn in (`scans/size_calibration/`). Its thumbnail sits under the stored scale; click it to open the full image. Needs an app server restart.
- Measure: click points on the live image; every line shows its length and the last point the total. Drag a point to move it, click it to remove it.
- Reference: grid, ruler, or an object of typical size (human hair, red blood cell, …) or an own picture, semi-transparent over the live image. They stay on while the window is closed and get a switch-off icon in the top bar.
- Measure and Reference need a stored scale. A scale stored for another camera resolution is not used and the window says so.
- The Calibration window is now **Flat field** only.

**Fixed**
- Marking calibration points on the live image no longer moves the stage (the clicks used to reach mouse movement).

**Cockpit UI pass** (rules: `docs/features/hgc_ui/cockpit_rules.md`)
- No window scrolls any more at 1366 × 768 and larger. Only data lists scroll inside their own area (scans, saved training captures, recordings, macro commands, logs).
- Large windows have pictogram tabs, one pane per function: Scan → Area / Focus / Stitch / Scans; Training → Data / Stage / Draw / Model / Saved. Start scan and Capture stay in a fixed footer.
- Explanations moved out of the windows into tooltips. Hover (or focus) a field, a button or an **i** pictogram to read them. Every plain `title` now shows as the same instant tooltip.
- Every window header carries the pictogram of its tool, plus its state and quick actions (Filter on/off + reset, Statistics reset, Recordings refresh, Motion detection switch).
- Search (Ctrl+Shift+P) switches to the pane that holds the found control.
- Statistics is one table (a column per motor). Recordings is one line per session; the player opens for the selected one. Slide library shows projects and slides side by side.
- Auto stitch and Focus step have their own pictograms.
- Speed presets: Z focus is now 1 / 3 / 9 RPM for Slow / Normal / Fast (was 0.15 / 0.5 / 1.5). XY is unchanged.

**Removed** (moved to `archive/hub_panels/`)
- Motion and Optics windows: they only opened other windows, which Tools already does.
- Scan and AStitch buttons at the bottom of the Map window (same reason); the Scan button stays when a slide has no map yet.
- "Recapture" in Scale (Capture does the same).
- Camera settings button and Setup link in Quick settings. Camera is opened from Tools (or its pinned shortcut) only; the hardware line in Quick settings is now a read-only status.

## 2026-10-25

**Calibration**
- X/Y auto-calibrate (one button per axis in Setup) now measures over a long travel and waits until the image stops moving, so it works on drives that stick and then jump. It sets steps per pixel and backlash.
- It saves nothing, and says why, when the image did not move, the view has too little detail, or the two directions disagree.
- Progress and result show in the Setup status line below the axis rows.
- Setup X/Y rows show steps per pixel (**st/px**) and accept a typed value.

**Fixed**
- Motors no longer stop briefly once per second during long moves. The status reply blocked the firmware loop for ~70 ms; both serial ports now have a transmit buffer. Needs a re-flash. Details: `docs/features/hgc_usb_connection/usb_connection.md`.
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
