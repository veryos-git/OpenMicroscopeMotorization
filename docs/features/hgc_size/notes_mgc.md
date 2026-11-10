# Size — notes

10.11.2026 · window **Size** (Tools → Image → Size) · three tabs

## Calibrate
- grid slide in view (e.g. 0.1 mm cells)
- **Set points** → click 2 points on live image (or drag a line)
- magnifier at cursor → hit the grid line exactly
- type known distance → `0.1` `mm` (or µm)
- **Save** → stores µm/px (and px/µm)
- more cells = more accurate (5 cells → type `0.5`)
- drag a point → fine-tune
- check: draw line over another cell → "stored scale says" ≈ 100 µm
- known value? type it into "Stored scale"
- clicks do NOT move the stage · Esc = cancel

### Snapshot (why / how was it measured)
- 2nd point set → camera image kept (drag a point → new image)
- **Save** → JPEG with line + label (`100 µm = 400.0 px -> 0.25 µm/px`)
- folder: `scans/size_calibration/` · file: `size_calibration_<date>_<time>.jpg`
- thumbnail under "Stored scale" → zoomed on the line → click = full size
- old snapshots stay in the folder
- typed scale → no snapshot
- needs app server restart once (new folder request)

## Measure
- like Google Maps "measure distance"
- **Set points** → click, click, click …
- each line: length · last point: total
- drag point = move · click point = remove
- Undo · Clear

## Reference
- **Grid** → cell size auto or typed (µm)
- **Ruler** → round length + ticks · drag it
- **Object** → hair, paper edge, salt grain, paramecium, egg cell, red blood cell, yeast, E. coli (typical sizes)
- **Own image…** → load picture + real width (µm) · gone after reload
- **Opacity** → all semi-transparent
- stay on when window is closed · top bar icon = switch off

## Rules
- no scale → Measure + Reference locked
- scale = 1 objective + 1 camera resolution
- resolution changed → warning, calibrate again
- objective changed → calibrate again (app cannot know)
- overlays are NOT in saved photos / videos

## Changed / removed
- old **Scale** window (still image + line) → replaced by Size
- old **Calibration** window → now **Flat field** only
- old Measure moved the stage on every click (mouse movement) → fixed

## Files
- `webserved_dir/o_component__scale.js` — window + drawings
- `webserved_dir/scale_calibration.module.js` — math, object list
- `webserver_denojs.js` — `size_calibration_create_folder`
- `tests/scale_calibration_test.js`, `tests/scale_browser_test.js`
