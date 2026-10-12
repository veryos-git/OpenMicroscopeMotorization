problem: 
the hardware is not consisting of correct parts, the camera sensor might be away to much from the optical tube or the semsor is to large or small. 
the live image seen has round edges of the tube visible. this might conflict with other functionalities
- image stitching does not work properly
- training ai data is not good data
- calibration (flat , and other calibration) fails
- finding position on map fails

possible solution: 
- the operator can set a hardware crop. this crop will crop the live image before any other manipulation of the image  as if this cropped image was the image that is being delivered from the usb camera

## Implemented solution

**Camera Settings → Hardware crop** provides an uncropped sensor preview with
rectangle selection and Left/Top/Width/Height pixel inputs. Apply commits the
rectangle; Reset restores the full sensor frame. Rectangles must contain whole
pixels and fit entirely inside the current frame. Settings are persisted per
camera device and native capture resolution; another format uses its own saved
rectangle or the full frame.

`webserved_dir/camera_frame.module.js` defines the shared frame geometry and
native-pixel image source. The crop precedes flat-field correction, filters,
histograms, autofocus, motion analysis, scan/stack capture, map localization,
training and raw/processed recordings. The USB track remains available for
hardware controls and fresh-frame timestamps. Digital zoom and training ROIs
are relative to the cropped image. Scan coverage uses its reduced dimensions;
pixel-to-motor scale is unchanged.

Changing geometry clears live selections. Flat-field calibration records the
crop origin and size, and correction is bypassed for mismatched geometry even
when the old and new rectangles have the same dimensions. Set the crop before
collecting a dataset or mosaic and recalibrate the flat field afterward.
Recalculate manual scan grids after a crop change. Crops cannot be changed
while capture, calibration, scanning or recording is busy.

Validation: `deno test -A tests/hardware_crop_test.js tests/hardware_crop_browser_test.js`.
The browser test uses headless Chrome and a synthetic sensor to check exact
pixels, nested ROIs, preview, WebGL, calibration, persistence, locks and video
stream geometry. Real microscope optics and camera throughput still need an
operator check.
