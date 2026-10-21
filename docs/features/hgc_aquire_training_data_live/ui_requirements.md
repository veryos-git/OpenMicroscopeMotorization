# Training mode — mockup interpretation

Source of truth: the two photographed mockups, `readme.md`, and the current
workflow in `hgc_computer_vision_model.md`. This document distinguishes required
behavior from the first implementation; it is not an implementation completion claim.

## Layout, from top to bottom

1. **Dataset:** select an existing dataset or enter a name and create one.
   Captures, label palettes, exports, and saved models belong to that dataset.
2. **Label rows:** editable label text, visible numeric shortcut, color picker,
   remove button. An add button creates another row. The selected label determines
   the class and color of new boxes. Number keys switch the selected label.
3. **X region configuration:** number of regions, motor-step distance, left/right
   direction controls, and a test control.
4. **Y region configuration:** number of regions, motor-step distance, up/down
   direction controls, and a test control. The sketch's example is 5 × 4 regions
   with respective step distances of 70 and 60; these are separate quantities.
5. **Coverage overview and Next:** show the grid and current region together;
   Next advances along a snake pattern. Captured coverage must be distinguishable
   from simply visited regions. The main Capture action must not advance XY.
6. **Focus configuration:** number of planes, Start and End controls that record
   the current Z position, and Test. Plane count controls acquisition throughout
   the defined start/end range.
7. **Large Capture button:** captures one set of training data, applying the same
   XY bounding boxes at each focus plane. It is not a prerequisite for drawing.
8. **Review list:** each saved image appears with its annotated full-image preview
   at the left and a horizontally scrolling row of target crops at the right.
   Images can be deleted or given quality ratings. Captures from a focus sweep
   must remain associated with their acquisition set and grid region.

## Interaction contract

- Hold **Ctrl** and drag to draw colored boxes on the live camera image or
  digital zoom preview before Capture. Hold **Shift** and drag a box to move it.
  Plain zoom-preview dragging pans; use **Select area** to choose the zoom region
  while Training reserves Ctrl for drawing. Both views share full-image coordinates.
- Box deletion corrects mistakes without requiring another camera capture.
- Z movement preserves annotation XY geometry. XY movement clears annotations.
- Starting acquisition moves to the first focus position, then captures throughout
  the focus range. Images and annotations are saved as part of that action;
  a separate manual Save step is not part of the specified workflow.
- Acquisition must retain camera, timestamp, position, region, and focus-plane
  metadata, so the operator can inspect what was collected.
- Next is a separate, explicit action after review, following the snake grid.
- Hardware exposure/ISO variation is mentioned in the general requirements, but
  the updated detailed workflow centers on focus planes. It must not delay or
  replace implementing the specified live-annotation/grid/focus workflow.

## Implementation alignment

The original frozen-frame workflow has been replaced by a main-image annotation
layer. The panel starts with dataset selection/creation and contains the label shortcuts, XY grid configuration,
arrow test moves, coverage/Next, focus configuration/Test, and a combined Capture
operation. Each saved plane carries capture-set and grid-region metadata.
See `implementation.md` for verification and remaining limitations.

## Confirmed operator decisions

- Draw boxes on the main live image, with a compact Training panel beside it.
- XY arrows immediately move one configured step distance.
- Focus Test and Capture return to the Z position at which the operation began.
  Explicit Stop or connection/movement failure aborts without further movement.

## Multiple YOLO models

The YOLO section lists saved models for the selected dataset. A new run can be
named and can start from pretrained YOLO or the selected compatible checkpoint.
Each successful run preserves previous models. Infer uses the selected model.

## Training crop

Crop selection uses a button and two clicks, with a crop cursor, rectangle preview,
and alpha-0.8 darkening outside the selected area. It works on both live views.
Only cropped pixels are saved, with labels normalized to that image. Annotation
cannot extend outside the crop. Changing/clearing a crop clears unsaved boxes;
Escape cancels selection while keeping the previous crop.
