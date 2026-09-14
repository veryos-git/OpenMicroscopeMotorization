# Glossary — microscope motorization & imaging project

Purpose: map the **names we already use in the code/UI** onto the **standard
technical terms** used in imaging, computer vision, microscopy and motion
control, so the project can be described consistently in documentation, a
paper, or a talk.

Format of each entry:

> **`recommended term`** — one-line definition.
> — *used here as:* the name(s) found in this repo · *also known as:* synonyms / options

Prefer the **recommended term** in prose; the repo-internal names can stay as
they are (renaming code is not required).

---

## 1. The composite image itself (the "big picture")

> **image mosaic** — a seamless composite of many overlapping images covering a
> larger area than a single field of view.
> — *used here as:* `mosaic`, `stitched.png` · *also known as:* mosaicking (the process), tile stitching, montage

> **stitching** — the *process* of aligning and blending overlapping images into
> one composite. The everyday umbrella term.
> — *used here as:* `stitch`, `stitch.py` · *also known as:* image registration + compositing, mosaicking

> **panorama** — technically a wide-field-of-view capture (often of a scene with
> perspective); a loose synonym for a mosaic. For a flat microscope slide,
> "mosaic" is more precise than "panorama".
> — *used here as:* (loosely, for a flat slide mosaic) · *also known as:* panoramic image

> **whole-slide image (WSI)** — the standard clinical term for a high-resolution
> mosaic of an entire microscope slide.
> — *used here as:* (implicitly, the scan result) · *also known as:* virtual slide, digital slide

> **overview / reference map** — the finished mosaic used as a navigational map.
> — *used here as:* `map.jpg`, "map" · *also known as:* atlas, overview image, reference image

---

## 2. Acquisition & scanning

> **tile** — one captured image of the specimen at a given stage position.
> — *used here as:* `tile`, `frame`, `tile_r.._c...png` · *also known as:* field of view (FOV), frame, sub-image

> **tile scan** — moving the stage in a grid and capturing overlapping tiles.
> — *used here as:* `scan` mode · *also known as:* raster scan, stage scanning, grid acquisition

> **serpentine (boustrophedon) path** — the "snake" acquisition order that sweeps
> back and forth to minimise travel time.
> — *used here as:* `serpentine` · *also known as:* raster-snake, S-shaped scan path

> **overlap** — the fraction (or pixel area) shared by neighbouring tiles, needed
> so they can be registered.
> — *used here as:* `overlap`, `min_overlap_frac` · *also known as:* overlap ratio, overlap fraction

> **step size / pitch** — the stage travel between consecutive tiles.
> — *used here as:* `n_step__min_move`, tile spacing · *also known as:* scan pitch, tile pitch

---

## 3. Registration & alignment

> **image registration** — estimating the geometric transform that aligns two (or
> more) images into a common coordinate frame.
> — *used here as:* `register_pair`, `registration` · *also known as:* alignment, geometric alignment

> **homography** — a 2-D projective transform (8 parameters) relating two views of
> a planar scene; the model used by feature-based stitching.
> — *used here as:* `homography`, `estimate_homography` · *also known as:* projective transform, perspective transform

> **translation-only model** — a rigid shift (2 parameters) with no rotation/scale;
> the model used by `stitch.py` because the motorised stage moves in a known grid.
> — *used here as:* `dx`/`dy` shifts, `solve_positions` · *also known as:* shift model, rigid translation

> **sub-pixel accuracy** — refining a shift to a fraction of a pixel.
> — *used here as:* `subpixel_residual` · *also known as:* sub-pixel registration

> **RANSAC** — a robust estimator that fits a model while ignoring outlier matches.
> — *used here as:* `ransac_thresh`, `estimate_homography` · *also known as:* robust model fitting, outlier rejection

> **inlier / outlier** — a match that is consistent (inlier) vs. inconsistent
> (outlier) with the estimated transform.
> — *used here as:* `inliers` · *also known as:* valid / spurious matches

> **global position solve** — jointly solving all tile positions from pairwise
> constraints (least squares), so errors do not accumulate frame-to-frame.
> — *used here as:* `solve_positions` · *also known as:* bundle adjustment (simplified), global alignment

---

## 4. Feature detection & matching

> **keypoint** — a distinctive, repeatable image location (corner, blob, learned
> point).
> — *used here as:* `keypoint`, `kpt` · *also known as:* feature point, interest point

> **feature descriptor** — a vector summarising the appearance around a keypoint.
> — *used here as:* `descriptor`, `desc` · *also known as:* feature vector

> **feature matching** — pairing keypoints across two images by descriptor
> similarity.
> — *used here as:* `match`, `engine.match` · *also known as:* correspondence search

> **SIFT / ORB** — classical hand-crafted keypoint detectors+descriptors.
> — *used here as:* `sift`, `orb` engine · *also known as:* classical features

> **SuperPoint** — a learned keypoint detector (deep neural network), used
> through the LightGlue package.
> — *used here as:* `lightglue.SuperPoint` · *also known as:* learned detector

> **LoFTR** — a dense, detector-free matcher (used as a fallback in `stitch.py`).
> — *used here as:* `LoFTRMatcher`, `loftr_rescue` · *also known as:* detector-free matching

---

## 5. Photometric correction

> **exposure compensation** — per-image scalar gains that equalise brightness in
> the overlaps.
> — *used here as:* `solve_gains`, `_estimate_gain` · *also known as:* gain compensation, photometric alignment, radiometric alignment

> **flat-field correction** — dividing out the pixel-wise illumination/vignetting
> pattern of the optics.
> — *used here as:* `estimate_flatfield`, `field` · *also known as:* shading correction, vignetting correction, non-uniform illumination correction

> **white balance** — normalising the colour channels of the camera.
> — *used here as:* (camera setting) · *also known as:* colour balance

---

## 6. Blending & compositing

> **blending / compositing** — merging aligned images into one output so seams are
> invisible.
> — *used here as:* `blend`, `composite` · *also known as:* image fusion, merging

> **feather blending** — weighting each image by a smooth (distance-based) mask so
> contributions ramp in/out without a hard edge.
> — *used here as:* `feather_mask`, `feather` blend mode · *also known as:* alpha blending, distance-weighted blending, feathering

> **multi-band blending** — blending in a Laplacian pyramid so low-frequency
> (brightness) and high-frequency (detail) differences are handled separately.
> — *used here as:* `multi_band_blend`, `blend_levels` · *also known as:* Laplacian pyramid blending, pyramid blending (Burt–Adelson)

> **seam** — the visible boundary between two blended images.
> — *used here as:* (implicit) · *also known as:* seam line, blend boundary

> **ghosting** — a double-image artefact when two misaligned images are blended.
> — *used here as:* (implicit) · *also known as:* parallax artefact, double exposure

> **raw paste** — copying a new image's pixels directly (no feathering); our
> fallback/old behaviour.
> — *used here as:* `raw` blend mode, `_blend_into_map` · *also known as:* hard paste, nearest-copy compositing

---

## 7. Localization

> **template matching** — sliding a small image (the live frame) over a larger one
> (the map) to find where it fits, via normalised cross-correlation.
> — *used here as:* `locate` mode, `matchTemplate`, `TM_CCOEFF_NORMED` · *also known as:* normalised cross-correlation (NCC), template localization

> **localization** — determining the current camera's position within the map.
> — *used here as:* `locate` · *also known as:* self-localization, "where am I", camera pose estimation (2-D)

> **viewport / field-of-view indicator** — the rectangle showing where the current
> camera view sits on the overview.
> — *used here as:* `fog-viewport`, `last_view` · *also known as:* camera footprint, FOV marker

> **overview minimap** — a small navigational map of the slide with a position
> indicator. *(Note: this repo's `minimap` panel is currently a motor-position
> trace, not an image overview — see §10.)*
> — *used here as:* (Locate panel map) · *also known as:* navigation map, overview, minimap

> **marker / annotation** — a user-placed landmark stored in map coordinates.
> — *used here as:* `marker`, `a_o_marker` · *also known as:* annotation, landmark, region of interest (ROI)

> **coverage map** — showing which regions have been visited/stitched.
> — *used here as:* archived `fog` (fog-of-war) overlay · *also known as:* explored-region map, fog-of-war map

---

## 8. Focus & depth

> **autofocus** — automatically finding the sharpest focal position.
> — *used here as:* `focus` panel, `focus_search` · *also known as:* focus search, contrast autofocus

> **focus stacking** — capturing several focal planes and merging the in-focus
> parts into one all-sharp image.
> — *used here as:* `focus_stack` · *also known as:* z-stacking, extended depth of field (EDOF), focal plane merging

> **depth of field (DoF)** — the axial range that appears acceptably sharp.
> — *used here as:* (implicit) · *also known as:* focus depth

---

## 9. Motion hardware

> **stepper motor** — a motor that moves in discrete steps; ideal for open-loop
> positioning.
> — *used here as:* `stepper`, `o_stepper_28byj_48` · *also known as:* step motor, stepper

> **stage** — the moving platform carrying the specimen.
> — *used here as:* (implicit, "stage") · *also known as:* translation stage, XY stage, specimen stage

> **axis** — one direction of motion (X, Y, Z).
> — *used here as:* `n_position` per motor · *also known as:* degree of freedom

> **microstepping** — electronically subdividing a full step for smoother/finer
> motion.
> — *used here as:* (in firmware) · *also known as:* micro-stepping, step subdivision

> **backlash** — the lost motion when reversing direction due to mechanical
> play/hysteresis.
> — *used here as:* `backlash` panel/calibration · *also known as:* hysteresis, lost motion

> **jog** — manual, incremental stage movement.
> — *used here as:* `jog` panel, "jogging" · *also known as:* manual move, manual positioning

> **homing** — moving to a known reference (limit switch) to establish an origin.
> — *used here as:* (implicit) · *also known as:* referencing, endstop calibration

---

## 10. Software architecture & UI

> **control server** — the web server that relays commands between the browser and
> the hardware/imaging processes.
> — *used here as:* `webserver_denojs.js` · *also known as:* web backend, control daemon

> **background process / daemon** — a long-running worker (e.g. the
> localizer) managed by the server.
> — *used here as:* `locate_map.py` · *also known as:* worker process, service, daemon

> **WebSocket** — a persistent two-way channel for low-latency browser↔server
> messaging.
> — *used here as:* `f_o_wsmsg`, `o_socket` · *also known as:* real-time messaging

> **overlay / HUD** — UI drawn on top of the live video (viewport, markers, jog).
> — *used here as:* `overlay-panel`, `o_component__*` · *also known as:* heads-up display, on-screen display

> **panel** — one toggleable UI window.
> — *used here as:* `o_component__*`, `o_panel_visibility` · *also known as:* widget, window, dock

> **stage-position trace** — a plot of the motor's X/Y path (what the current
> `minimap` panel shows).
> — *used here as:* `minimap` panel, `o_component__minimap` · *also known as:* path trace, trajectory plot

---

## Quick "which word do I use?" cheat sheet

| You said | Prefer in writing | In the code |
| --- | --- | --- |
| stitching | mosaicking / stitching | `stitch` |
| scan | tile scan → mosaic | `stitch.py` (batch) |
| map | mosaic / overview | `map.jpg` |
| locate | template-matching localization | `locate_map.py` |
| feather | feather blending | `feather` blend mode |
| multiband | multi-band (pyramid) blending | `multi_band_blend` |
| gain / exposure | exposure compensation | `solve_gains` |
| flatfield | flat-field correction | `estimate_flatfield` |
| keypoints | keypoints / feature points | `keypoint` |
| homography | homography (projective transform) | `estimate_homography` |
| inliers | inliers | `inliers` |
| subpixel | sub-pixel registration | `subpixel_residual` |
| overlap | overlap ratio | `overlap` |
| focus stack | focus stacking / EDOF | `focus_stack` |
| backlash | backlash / hysteresis | `backlash` |
| jog | manual move / jog | `jog` |
| viewport rect | field-of-view indicator | `fog-viewport`, `last_view` |
| minimap (trace) | stage-position trace | `minimap` panel |
| marker | marker / annotation / ROI | `marker` |
| fog-of-war | coverage map | archived `fog` overlay |
