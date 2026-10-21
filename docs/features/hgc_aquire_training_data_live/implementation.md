# Live training data acquisition — implementation status

Training now follows the photographed mockup and the operator's clarified workflow:
**select or create dataset → annotate the main live image → Capture the focus sweep → review → Next region**.
The original frozen-frame annotation workflow has been replaced.

## Use

1. Open **Train model**, then select a dataset or enter a name and click
   **Create dataset** at the top of the panel. Existing captures appear in
   **Default dataset**. The selected dataset is remembered in this browser.
   Connect the camera and XYZ stage and move to an interesting region. The compact
   panel sits beside the main live camera image, or below it on narrow screens.
2. Add label names and colors. Click the numbered selector or press **1–9** to
   select a label. Shortcuts can be reassigned through the existing Actions UI.
   Each dataset has its own label palette, persisted in this browser.
3. Set X/Y region counts and step distances. Arrow buttons immediately move one
   configured distance, using the existing manual axis direction settings.
   These are test moves, not direction selectors.
4. Move focus to one endpoint and click **Start**; move to the other and click
   **End**. Set the total number of planes, including both endpoints. One plane
   means Start only. **Test** visits Start and End and returns to the previous Z.
5. Optionally click **Crop**, then click two opposite corners in either live view.
   The outside area is darkened at 80% opacity. Hold **Ctrl** and drag colored boxes on the main live image or digital zoom
   preview. Both views edit the same full-camera annotations. Plain dragging in
   the zoom preview pans; scrolling zooms without changing annotation coordinates.
   While Training is open, use zoom’s **Select area** button to choose its region. Dashed horizontal and
   vertical helper guides follow the pointer and disappear when it leaves the image. Use **Delete box** for a
   mistake. Each box has a **10×10 screen-pixel bottom-left handle**: hover for the
   diagonal resize cursor and drag to resize while keeping the top-right fixed.
   Hold **Shift** for the hand cursor and drag inside a box to reposition it.
   Boxes stay inside the image; edits preserve their labels/colors. Escape, pointer
   cancellation, or window blur cancels an in-progress edit. XY movement clears
   boxes; Z movement preserves them.
6. Click **Capture**. It moves through unique integer Z positions between Start
   and End, waits 500 ms and a fresh camera frame at each plane, and saves each
   image with the same boxes. On completion it returns to the Z position at which
   Capture started. There is no separate Save action.
7. Review the annotated image and its horizontally scrolling target crops in each
   row. Quality and deletion apply to each saved image. Click **Next** to advance
   along the snake grid; draw new boxes and capture again.

## Grid, movement, and cancellation

- The initial grid origin is the position of the first Capture or Next action.
  **Start new grid here** resets the session and its coverage. Grid changes or
  external XY movement also reset navigation; existing saved images remain.
- Next moves along rows, reversing X direction on alternate rows. Grid travel
  starts in the configured right/down manual directions and retains those signs
  for the grid. The current cell is outlined, visited cells have a dot, and a
  completed capture marks the cell green.
- Test arrows reset the grid because they move outside the Next sequence.
- Focus Test and Capture return to the prior Z position. An image-upload failure
  also attempts that return; already saved planes remain available for review.
- **Stop**, disconnection, motor cancellation, or a movement timeout abort the
  operation. No automatic return move occurs after these events. This keeps Stop
  from unexpectedly restarting the stage. A motor move has a 120-second timeout.
- Training uses the shared movement-busy flag and rejects competing movement
  commands while it owns the stage. It uses the saved XY and Z manual speeds.
  Opening Training disables mouse jogging so dragging draws boxes; keyboard and
  gamepad positioning remain available between operations.
- Camera replacement, resolution changes, hardware zoom changes, and XY status
  changes invalidate boxes. Physical drift or movement without controller
  telemetry cannot currently be detected.

## Storage and export

New datasets store captures as
`training_data/dataset/<dataset-id>/capture/<capture-id>/image.png` plus
`metadata.json` on the server. Each dataset has a `dataset.json` manifest.
Default dataset retains the original `training_data/<capture-id>/` location;
existing images are not moved. The folder is excluded from Git. Switching datasets
changes the gallery, export, palette, and model list together and clears unsaved
boxes, prediction previews, grid coverage, and focus endpoints. Dataset switching
is disabled during capture. Metadata includes the dataset ID.

Capture metadata records
normalized boxes, labels/colors, timestamps, relative XYZ motor positions, axis
assignments, camera settings, quality, capture-set ID, focus-plane index/count,
and grid identity/configuration/region.

Frames are raw PNGs without digital filtering or flat-field correction. With a
training crop selected, only its pixels are saved, at original camera resolution;
there is no downscaling. Without a crop, the full camera frame is saved. The gallery overlays annotations and displays crops without altering
stored pixels. Editing a label does not rewrite already drawn or saved boxes.

**Export YOLO dataset** exports only the selected dataset and downloads `training-data.tar`, containing `images/`,
YOLO `labels/`, `classes.txt`, and `metadata.json`. All image quality ratings are
included. Class IDs share one sorted class mapping within an export. Keep its class
list with that export. Train/validation splitting is not generated. Avoid deleting
captures during export.

## Training crop

**Crop** enters two-click selection: click the first corner and then the opposite
corner on the main live image or zoom preview. A crop cursor and live rectangle
preview indicate selection; Escape or **Cancel crop** keeps the previous crop.
The selected area is aligned to integer camera pixels and must be at least 2 × 2
pixels. Outside pixels are darkened with alpha 0.8 in both views.

Only the selected area is saved, exported, and used for fine-tuning. Annotate every
target inside it: unannotated targets inside the crop still count as background.
Drawing cannot start outside the crop; drawing, moving, and resizing cannot extend
boxes past its boundaries. Changing or clearing the crop clears unsaved annotations
and predictions, without modifying saved captures. The crop stays across XY grid
moves and focus planes; dataset/camera geometry changes reset it. Crop settings
last for the open page and are separate from the digital zoom region.

Live boxes remain in full-camera coordinates. Capture converts them to coordinates
relative to the saved crop, and metadata records the pixel crop and original camera
dimensions. Galleries, exports, and YOLO snapshots consequently use matching cropped
pixels and labels. Inference captures the same selected crop and maps predictions
back to the live views; changing the crop discards pending inference previews.

## Fine-tune and infer YOLO

The Training panel now includes **Fine tune YOLO** and **Infer YOLO**.
Install optional dependencies once with `deno task install-yolo`. This creates
`venv_yolo` separately from Cellpose/stitching; the default installer uses CPU
PyTorch wheels. An existing GPU-capable PyTorch environment is retained. The
worker uses one CUDA device when available, otherwise CPU. YOLO support is
already installed in the current development workspace.

- **Fine tune YOLO** snapshots all saved captures except those rated **bad**.
  Set the epoch count (default 50) and optionally name the new model. By default
  runs start from pretrained YOLO11n, downloaded on first use. To start from a
  saved checkpoint, choose it in **Saved model** and enable **Fine-tune selected
  model**. Its class mapping must match the dataset; if labels changed, start
  from pretrained YOLO. Each run creates a separate model and does not resume
  the previous optimizer. The model trains at 640 pixels with batch size 4.
- Training and validation use different XY-region groups. Focus planes and
  repeated captures with the same recorded XY position stay together. Around
  20% of regions are held out, while every label must remain represented in the
  training group. At least two regions are required; a dataset without a valid
  split produces an actionable error rather than reusing training images for
  validation. Nearby overlapping but unequal XY positions are not deduplicated.
- Progress, epoch count, logs, errors, and **Cancel YOLO** appear in the panel.
  One job runs at a time. Training continues if the panel is closed. Cancellation
  kills the worker and preserves the previous completed model. Finishing model
  publication is atomic and cannot be interrupted by cancellation.
- Every successful run publishes its own `weights/yolo/run/<id>/model.json`,
  with its dataset, name, class mapping, and optional parent checkpoint ID.
  Snapshots and checkpoints stay in that run folder. Previous models remain
  selectable after further training and server restarts. An existing legacy
  `weights/yolo/latest.json` model appears under Default dataset. Partial runs
  are retained for inspection but are not selectable. Server restarts do not
  resume interrupted training. One worker is shared across all datasets, and
  progress identifies the dataset that owns the job.
- **Infer YOLO** uses the selected saved model from the current dataset on one cropped
  camera frame (or full frame without a crop), with a
  configurable confidence threshold (default 0.25). Dashed cyan boxes and
  confidence scores preview detections on the live image. This is a single-frame
  inference action, not continuous video tracking.
- **Use detections as boxes** explicitly copies previews into editable annotations.
  Manual boxes are preserved. Moving XYZ or changing camera geometry clears
  previews; an inference result is discarded if the stage/camera changed while
  it was running. No predictions are automatically saved as training labels.
- YOLO jobs do not move the microscope. Real hardware image quality and model
  usefulness still depend on the collected dataset. No accuracy claim is made
  by the integration smoke test.

Implementation references: [Ultralytics training](https://docs.ultralytics.com/modes/train/),
[prediction](https://docs.ultralytics.com/modes/predict/), and
[YOLO11](https://docs.ultralytics.com/models/yolo11/).

## Remaining work and acceptance

- Physical microscope acceptance testing: direction, settling time, focus return,
  cancellation, and image/annotation alignment across the focus range.
- Resume navigation/coverage after page reload or application restart. Images,
  metadata, and the label palette persist, but active grid/focus settings currently
  last for the open page only.
- Physical ISO/gain and exposure bracketing and exposure rejection. Current
  acquisition uses and records the existing camera settings.
- Per-target quality tags and capture-set filtering/group controls.
  Current quality ratings apply to whole images; each plane is a review row.
- Optional stitched slide map in addition to the snake-grid overview.

## Verification

- `deno test --allow-read --allow-write tests/training_data_test.js`
  verifies storage/export, geometry, snake order, integer focus planes, focus
  restoration, cancellation, and motor listener cleanup.
- `deno test -A tests/training_browser_test.js`
  uses an isolated server, generated camera stream, and simulated controller in
  headless Chrome. It checks live drawing before capture, shortcuts, three-plane
  acquisition, Z restoration, XY invalidation, snake navigation, arrow movement,
  crop previews, quality/deletion, cancellation, palette/image persistence, box
  resizing, Shift-drag movement, cursor feedback, saving edited geometry, dataset
  creation/switching, separate captures/palettes, multiple-model selection, zoom drawing/resizing/moving, and coordinate
  preservation through pan and wheel zoom.
  `TRAINING_WINDOW=600,1000` selects the narrow layout; default is `1440,1000`.
- The targeted unit/regression suite covers actions,
  gamepad, axis mapping, manual speed, serial handshake, and training data.

YOLO verification:

- `deno test --allow-read --allow-write tests/dataset_test.js`: dataset persistence,
  scoped capture access/export, legacy data preservation, multiple-model registry,
  and rejection of cross-dataset model selection.
- `deno test tests/yolo_test.js`: class mapping, region-based split, bad-quality
  exclusion, invalid configuration, and insufficient dataset handling.
- The browser test also checks model-button availability, inference previews,
  explicit annotation acceptance, and stale-result rejection.
- `deno run -A tests/yolo_smoke.js`: optional real one-epoch fine-tuning on generated
  images in temporary storage across multiple datasets, fine-tuning from an
  existing model, selecting older checkpoints, inference, rediscovery, and cancellation
  preserving the existing model. Passed with Ultralytics 8.4.162 and CPU PyTorch.
  This does not train on or replace the user's dataset/model.

Crop verification: `deno test tests/training_crop_test.js` checks pixel rounding,
coordinate transforms, bounds, and metadata validation. The browser test also checks
two-click selection in both views, cancellation, boundary enforcement, actual PNG
dimensions and raw pixels, crop-relative exports, and inference alignment.
