# Auto Stitch - AI Summary

## What I understood

The user wants a **real-time continuous stitching** feature that works like "fog of war" in strategy games. As the user explores a microscope slide by moving the stage, the application periodically captures the current webcam frame and incrementally stitches it onto a growing base image. Over time, the entire explored area of the slide is assembled into one large panorama.

## How it works

### Session setup
- The user enters a **session name** (e.g. "sample_a") and clicks Start.
- A folder is created at `scans/{name}_{mm}_{hh}_{DD}_{MM}_{YYYY}/` to store all frames and the base image.
- The capture **interval** is configurable (default: 5 seconds).

### Capture loop
Every N seconds the client:
1. Grabs the current webcam frame (PNG via canvas)
2. Uploads it to the server via `POST /api/scan/save_image`
3. Sends a WebSocket message `autostitch_add_image` to trigger incremental stitching

### Incremental stitching (server-side Python)
The server runs `autostitch.py` which:
1. Loads the existing **base image** (`base.jpg`) and the new frame
2. Detects **ORB features** (1500 keypoints) in both images
3. Matches features with `cv2.BFMatcher` (Hamming distance, cross-check)
4. Computes the **translation offset** (median dx/dy from matched keypoints) - no rotation since microscope images are orientation-consistent
5. Decides what to do:
   - **No overlap found** (<10 good matches or inconsistent matches): the user moved to a completely different region → **replace** the base with the current frame
   - **Overlap found, new area above threshold**: **extend** the base image by compositing the new frame onto an expanded canvas
   - **Overlap found, new area below threshold**: **skip** (the user hasn't moved enough) but still report the position

### Min extension threshold
To avoid redundant updates when the stage is stationary, the stitch only extends the base if the new frame adds more than `n_pct__min_extension` percent of new pixels (default: 5%). Below that threshold, the frame is skipped but the current position is still tracked for the red border display.

### Minimap display
- The accumulated stitched image is shown in the Auto Stitch panel as a minimap
- The current frame's position within the base is highlighted with a **red rectangular border**
- The position is computed from the translation offset returned by the Python script and scaled to the displayed image size
- The image reloads automatically after each successful stitch (cache-busted with a timestamp query parameter)

## Files involved

| File | Role |
|------|------|
| `autostitch.py` | Python script for incremental stitching (ORB features + translation compositing) |
| `webserver_denojs.js` | WebSocket handlers: `autostitch_create_session`, `autostitch_add_image` |
| `webserved_dir/o_component__autostitch.js` | Vue component with config UI, capture loop, minimap display |
| `webserved_dir/index.js` | Component registration and panel visibility state |
| `webserved_dir/o_component__toolbar.js` | "AStitch" toggle button |
| `webserved_dir/o_component__page_control.js` | Component placement |
| `webserved_dir/index.css` | Styling for the autostitch panel |
