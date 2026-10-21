# Applications to study for microscope UI design

**My recommended starting trio is OpenFlexure, Nikon NIS-Elements LE, and SharpCap.** They answer three different questions: how to organize the application, how little interface is needed for everyday use, and how to expose extensive camera controls.

The ranking below is a design judgment for this project, not a product quality ranking. Compatibility descriptions distinguish camera and microscope ecosystems; none promises support for your particular USB camera or ESP32 stage.

## Shortlist

| Application | Camera or microscope relationship | Best design lesson | Local references |
| --- | --- | --- | --- |
| OpenFlexure | Browser-accessible control of its microscope system; not evidence of generic USB webcam support | Quiet default view and contextual navigation | [View](screenshots/01_openflexure_view.png), [Navigate](screenshots/02_openflexure_navigate.png) |
| Nikon NIS-Elements LE | Live imaging with supported Nikon cameras | Image-focused capture and annotation | [Live](screenshots/11_nikon_live.webp), [Annotate](screenshots/12_nikon_annotation.webp) |
| SharpCap | Astronomy acquisition with supported USB/network cameras and video devices | Camera inspector, working area, capture status | [Main interface](screenshots/03_sharpcap_live.png) |
| Evident cellSens | Microscope imaging; hardware features vary by package/system | Simple layout, task layouts, optional customization | [Simple Layout](screenshots/17_cellsens_simple_layout.png), [Layout variants](screenshots/09_cellsens_layout_options.png) |
| ZEISS ZEN | Integrated ZEISS microscopy environment | Workflow groups and progressive disclosure | [Workspace](screenshots/07_zen_workspace.png) |
| Leica LAS X | Leica microscopy environment and supported devices | Spatial planning of scans and focus points | [Navigator](screenshots/14_leica_focus_map.jpg) |
| Micro-Manager | Configured camera/stage device adapters | Acquisition dimensions, stage semantics, presets | [Acquisition](screenshots/05_micromanager_acquisition.png), [Stage](screenshots/06_micromanager_stage.png) |
| OBS Studio | Webcam/video-source capture; no microscope-stage model in these references | Processing stacks and recording controls | [Workspace](screenshots/15_obs_workspace.png), [Filters](screenshots/16_obs_filters.png) |

## OpenFlexure

**Observed:** The View screenshot gives nearly the whole window to the specimen. Navigate adds a control column beside the same image, with coordinates, Move, autofocus choices, and a collapsed Configure section. Icons retain short text labels.

**Documented:** This is a web application accessible through a browser or OpenFlexure Connect. Navigation supports coordinate moves and keyboard movement outside text fields; image centering depends on camera-stage calibration. [Interface guide](https://openflexure-microscope-software.readthedocs.io/en/latest/webapp/index.html), [Navigate guide](https://openflexure-microscope-software.readthedocs.io/en/latest/webapp/pane_navigate.html).

**Adapt:** Start with a usable Live view. Reveal navigation details in one predictable place. Keep routine movement separate from motor configuration.

**Watch:** The reference's scroll-to-Z behavior would conflict with image zoom in your application. Define your own explicit gesture ownership. Study the structure, not every gesture.

## Nikon NIS-Elements LE

**Observed:** Large specimen image, narrow left action rail, and a top strip for annotation, measurement, saving, and viewing. The annotation screenshot reveals a compact palette containing tool, color, and line width. The selected tool has more than a color change.

**Documented:** The LE product page describes live acquisition, measurements, annotations, and synchronized live/saved comparison with supported Nikon cameras. [Official product page](https://www.microscope.healthcare.nikon.com/products/cameras/nis-elements-le).

**Adapt:** This is the strongest visual reference for your everyday view. Keep annotation options near the selected tool and retain a short label for unfamiliar icons.

**Watch:** LE's pictured simplicity does not establish a solution for XYZ automation. Pair it with a stronger stage/scan reference. The saved comparison image is a specimen crop, so use it to understand comparison intent, not toolbar arrangement.

## SharpCap

**Observed:** The annotated screenshot divides the interface into camera image, right-side camera controls, a lower working area, toolbar, and status strip. The inspector groups exposure/gain, image controls, preprocessing, and histogram controls.

**Documented:** Camera controls depend on the attached device. Groups can collapse and reorder; the work area hosts tools such as histogram and focus score. Capture progress and frame statistics appear in the status area. [SharpCap 4.1 interface manual](https://docs.sharpcap.co.uk/4.1/4_TheSharpCapUserInterface.htm).

**Adapt:** Use one camera inspector, explicit units, and a collapsible diagnostic area. Keep the current capture state visible even when the settings panel closes.

**Watch:** The dense controls and long toolbar are not an appropriate default for your quick-look use case. The supplied screenshot is only 607 × 484 pixels; it is strongest as a region diagram.

## Evident cellSens

**Observed:** The demonstration frame at 00:25 places a large live specimen beside a narrow Smooth Control panel. Separate product images illustrate full-screen, floating, and docked layouts and a customizable My Functions panel.

**Documented:** Simple Layout offers contextual tools; workflow tabs can replace acquisition controls with processing controls. My Functions supports customization. [Official cellSens page](https://evidentscientific.com/en/products/software/cellsens), [Simple Layout demonstration](https://adobeassets.evidentscientific.com/content/dam/video/video/library/cellSens_SimpleLayout_e(2)_404.mp4).

**Adapt:** Provide a useful default layout before offering customization. Offer task presets that restore a coherent arrangement with one action.

**Watch:** A configurable panel can become another unstructured collection of buttons. Your component and placement rules should apply to customized layouts too. The older demonstration is 720 × 404 pixels and includes the publisher's explanatory overlays.

## ZEISS ZEN

**Observed:** The left area groups Locate, Acquisition, Processing, Analysis, and Applications. The image remains central, while the right area holds documents and hardware sections. Several sections expose a Show All control.

**Documented:** The main tool tabs follow the experiment workflow, with microscope/camera settings separated from acquisition, processing, and analysis. [Left Tool Area](https://knowledge.zeiss.com/rms/en/zen/getting-started-first-steps/user-interface/left-tool-area), [Workspace overview](https://knowledge.zeiss.com/rms/en/zen/getting-started-first-steps/user-interface).

**Adapt:** Let task choice determine the inspector's contents. Use Basic and Advanced sections consistently within a task.

**Watch:** This screenshot is intentionally feature-rich. Importing every surrounding panel would recreate your crowding problem. Use it as a taxonomy reference. The downloaded PNG is the original image embedded in the official overview figure, without that figure's outer numbered callouts.

## Leica LAS X and Navigator

**Observed:** The focus-map screenshot gives most of the window to a plate overview with spatial markers. A focus-point list sits over the lower-right region. It demonstrates planning in specimen space rather than only through numeric fields.

**Documented:** Navigator supports sample overviews, region selection for acquisition, and multiple focus points for a focus map. [Official LAS X page](https://www.leica-microsystems.com/products/microscope-software/p/leica-las-x-ls/).

**Adapt:** Show scan outline, tiles, saved focus points, and progress on one map. Selecting a point should connect the map marker and the corresponding list entry.

**Watch:** The screenshot is 768 × 432 and individual labels are small. It does not establish the exact interaction for adding or editing points. Your slide workflow also needs less plate-management UI than this example.

## Micro-Manager

**Observed:** The main control window separates Snap/Live from complex acquisition. Its acquisition dialog groups time, positions, Z slices, channels, saving, and a summary. Stage Control distinguishes XY from Z and exposes movement increments with units.

**Documented:** The 2.0 guide explains multidimensional acquisition and simulated hardware configuration for exploration. [Official user guide](https://micro-manager.org/Version_2.0_Users_Guide).

**Adapt:** Give scan planning an explicit summary before Start: region, tile count, Z strategy, output, and estimated duration. Preserve a clear distinction between movement speed and step distance.

**Watch:** The screenshots show an early 2.0 development build and separate windows. They are valuable domain references but a weak visual target for your clean fullscreen browser UI. Camera support is adapter-specific.

## OBS Studio

**Observed:** The main screenshot separates preview, sources, controls, and status. The older Filters dialog presents a list of enabled effects and parameters for the selected effect, with visibility controls distinct from removal.

**Documented:** OBS offers movable docks; filters can be enabled or disabled. Webcam capture is described in its platform-specific video-source documentation. [Official overview and docks](https://obsproject.com/), [Filters guide section](https://obsproject.com/kb/obs-studio-overview#filters), [Video capture sources](https://obsproject.com/kb/video-capture-sources).

**Adapt:** Present your active processing as an inspectable stack. Give recording persistent state and an accessible Stop control.

**Watch:** Scenes and audio mixing solve broadcasting problems. They do not belong in your default microscope view. An OBS-style effects stack also needs extra scientific-image semantics in your application: what changes the preview, what changes acquisition, and what is saved.

## What to borrow for each problem

| Your problem | First reference | Proposed response |
| --- | --- | --- |
| Too many windows | OpenFlexure + cellSens | One main task panel; optionally pinned secondary panels |
| Inconsistent panel appearance | Nikon + ZEN | One panel template and one control vocabulary |
| Camera settings overwhelm Live | SharpCap | A compact camera section with Advanced disclosure |
| Stage controls mix with configuration | OpenFlexure + Micro-Manager | Routine Navigate controls; hardware details in Setup |
| Mosaic planning is hard to understand | Leica Navigator | A spatial plan tied to a focused-point list |
| Processing accumulates invisibly | OBS | A named active-effects list with separate bypass/reset/remove |
| New users need a clean start | Nikon + cellSens | A default Live layout that can always be restored |

These are independent design proposals. The next document turns them into rules specific to this repository.
