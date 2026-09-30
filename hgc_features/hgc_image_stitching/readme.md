there should be a very robust image stitching mechanism that can stich hundrets of small single images together and create one huge ginormous image.

classical non machine learned algorithms like SIFT and ORB are NOT suitable. they are not robust at all and are a relic of time. 

machine learning feature detectors have to be used, such as SuperPoint and SuperGlue. 



here is a workflow that describes the process of scanning image information of the slide

# workflow 
- operator needs to make sure motors are calibrated. this is curcial
- move stage to start position and set start position and also manually 'level' the slide , meaning find focus point and set it
- move stage to end position and set end position, also manually 'level' the slide
- set overlap (default 30%)
- the steps needed to move the stage for one grid cell is automatically caluclated (but can be manually adjusted by the user)
- set focus options
- start scan

the scan can then use autofocus before each image, but it can also use the 'level' information to compensate for possible uneven slides. 



# possible future extensions
each region could be taken on multiple z layers. each layer could be focus stacked later before stitching. 

# possible problems
problem: 
stitching does not work ,the algorithm fails and stitches incorrectly or does not stitch at all
possible solution: 
better stitching algorithm.
problem:
stitching does not work, features on single region images are not prominent enough
possible solution: 
image postprocessing could be used to amplify features such as sobel edge detection. sharpening or increasing image contrast


problem: 
stitching takes a very long time
possible solution: 
harden the stitching algorithm. use heavily downscaled image data to find coarse alignment and then add fine alignment later


problem: 
stitching does not work, because images do not overlap enought or do not overlap at all
possible solution: 

problem: 
stitching does not work correctly, there is a result but the images are not really overlayed correctly and there are many small blending issues
solution: 
harden the stitching algorithm. due to different lighting conditions and other stuff, the classical algorhitms may not work well. SIFT and ORB are outdated, use machine learning approaches like SuperPoint and SuperGlue. 
consider creating and maintaining a separate stitching software repository to ensure a proper solid stitching library is outsorced and does not pollute this project scope.  

problem: 
end result stitched image is like diagonal because in one direction some stepper motor steps are always lost and a slope builds over time which is then visible in the resulting stitched image 
possible solution: 
hardware needs to be more precise set up 


problem: 
the stitching is still pending but the operator wants to scan multiple slides after each other
possible solution: 
- allow scanning while stitching is still runnning. 
- there is a good overview of what scans still have to be stitched, what scans have a result, where and how to access it 'open folder' button. basically a good UI for managing scans , including a stitching job queue


problem: 
the operator needs as much information as possible to stich with a better newer algorithm later
possible solution:
add meta data as a .json file in the 'scan' folder, metadata with all helpful information like camera exposure , iso, but also hardware info like relative x y z steps of the  motors. 
also add some information to the image names. 

problem:
the scan worked but one direction stepper motor has some steps that are lost. there is drifting over time and the resulting image is 
diagonal 
possible solution: 
the scan result large image can be exported as a crop version 


# scan workflow without autofocus
problem: the scan with autofocus does take a long time. each autofocus takes about 3 seconds and makes the process slow. 
also the focus might get lost and the autofocus drifts away from the actual target plane. 
possible solution:
since the scan is like a big rectangle operator can first manually define what the best focus position is at each of the 4 corners
after this information has been set, the scan can calculate /interpolate the focus between the corners. it is like leveling a 3d printer by probing the distance between nozzle and printbed. 

problem: 
the scan has to cover the full subject and should overshoot a bit with the area it covers. when the operator navigates to the corners of the scan area, the subject might not be in the field of view and therefore the operator cannot find the correct focus. 
possible solution: 
- the focus corner points have a certain padding from the actual corner points so that the operator still sees the subject
- after navigating to a corner end point the operator can still navigate freely and find the closest field of view where the subject can be seen then the operator can set the desired focus point 

## possible workflow
- operator sets size / tiles x and y 
- operator can go to corners and set the desired focus. 
    - corner 1, 2, 3, 4
    - since the operator is likely to define a larger scan area to cover than the actual sample  will take space , the focus points should have a certain padding to the actual scan edge points. this padding is by default 10% of the defined scan size  
- operator can start the scan
- the scan automatically adjusts the focus so that it matches the set values on the corners , focus is interpolated between the values


# Scan alignment at reduced resolution

Scan capture saves each original tile and an aspect-preserving copy at most 256
pixels wide in `dowscaled/` (including scans without automatic stitching).
Scan stitching uses `stitch.py --registration-max-width 256`: correlation,
subpixel alignment, guided retries, and optional LoFTR rescue all use these small
copies. Fresh copies are reused; missing or stale copies are regenerated for older
scans. Recursive tile discovery skips `dowscaled/` to avoid duplicate inputs.

Translations are converted using the actual horizontal and vertical resize ratios
before solving the layout. `positions.json` and `report.json` remain in original
pixel coordinates, and blending reads the original images. The output-size setting
still applies after compositing. Full-resolution fine alignment is not performed
in scan mode; it can be added later as an optional refinement. Standalone CLI
runs retain full-resolution refinement unless this option is supplied.

# Implementation audit (2026-09-26)

| Requirement | Status |
| --- | --- |
| Mark scan bounds, compute overlapping grid using steps/pixel calibration, manual step overrides, serpentine capture | Implemented. Calibration is required for automatic grid calculation; manual grids remain available. |
| Default 30% overlap | Implemented for new configurations; existing saved preferences are preserved. |
| Autofocus before each tile | Implemented with a local focus search. |
| Record focus at boundary points and interpolate a level/tilt model | Not implemented; marked points currently store X/Y only. |
| Scan multiple Z layers and focus-stack each tile | Not integrated into scan mode. A separate focus-stack tool exists. |
| Fast downscaled registration, original-resolution compositing | Implemented; see above. Fine alignment on original images is still deferred. |
| Learned feature matching | Partial: optional LoFTR rescue exists. Default registration uses FFT normalized correlation. SuperPoint/SuperGlue and a learned-first scan pipeline are not implemented. |
| Contrast/illumination compensation and blending | Implemented: high-pass registration, optional flat-field correction, exposure gains and feather blending. These do not guarantee correct alignment on difficult slides. |
| Start another scan while stitching | Implemented: capture finishes independently of background server jobs. The camera/motor capture lock remains held through the return-to-start move. |
| Scan overview, stitching queue, logs, result and folder access | Implemented in the scan panel. Jobs run sequentially with two registration workers; captures can continue. Existing tile scan folders are discovered at startup. |
| Job recovery | `stitch_job.json` preserves state/options/logs/results and the original slide ID. Browser disconnects do not cancel jobs. After server restart, queued jobs resume; interrupted captures/running jobs are marked for explicit retry. |
| Detailed capture metadata for future algorithms | Still needed: camera exposure/ISO/settings, optics/calibration, per-frame timestamps and XYZ motor positions. Job metadata is not a substitute for capture metadata. Tile names currently encode row/column only. |
| Crop export to remove drift-related empty edges | Not implemented in the scan UI. Blending border crop in the CLI is not equivalent to final mosaic crop export. |
| Separate reusable stitching repository/library | Not implemented; stitching remains in this repository. |

The **Scans** overview remains available during configuration, capture and after
capture. **New Scan** becomes available after capture and stage return, without
waiting for stitching. Each entry has separate status and logs, **Open folder**
(a browser file listing), **Open mosaic** on success, and **Stitch / Stitch again**
for ready or finished jobs. Duplicate requests for queued/running scans reuse the
same job. Successful mosaics are linked to the slide selected at capture start,
not whichever slide the operator selects later. Job files are local to each scan;
this version manages immediate subfolders of `scans/`.
