# Proposed UI rules for Open Microscope Motorization

**Keep the fullscreen live camera image as the foundation, and organize its overlay tools around tasks.** These are proposed rules for a redesign, not claims about behavior already implemented. The aim is to make each new feature fit an existing structure. This follows the [main UI decisions](../crucial_decisions.md), including the need to distinguish live images from recorded snapshots.

## One application structure

Use five top-level task groups. Keep the first group selected on startup, and expose the others through a compact, consistently positioned task selector.

| Task group | Contents | Default visible controls |
| --- | --- | --- |
| **Live** | Camera, illumination, stage navigation, focus assistance, snapshots, video | Capture, Record, Stop motion, camera state, XY speed and Z speed |
| **Scan** | Region planning, focus points, tile scans, mosaic jobs, focus stacks | Map/plan, prerequisites, acquisition summary, Start or Stop scan |
| **Review** | Slides, images, recordings, mosaics, annotation, measurement, processing/export | Selected asset, its identity, context tools |
| **Analyze** | Cell segmentation, motion analysis, model training, training annotations | Selected input, method, results; advanced parameters collapsed |
| **Setup** | Devices, axes, input bindings, calibration, connection, firmware | Hardware overview and unresolved prerequisites |

The group chooses the working context and overlay tools; it does not silently start an operation or replace the live image. Opening a saved image or mosaic is a separate, explicit action into a labeled review view. Frequent capture and motion actions stay directly accessible. Background jobs and recording remain visible when the group changes.

Place a feature in one canonical location. A command-search result or prerequisite link may open that location from elsewhere. A second UI entry must use the same value and operation, rather than introduce another independent setting.

## Stable screen regions

Proposed desktop placement of foreground controls over the fullscreen live canvas:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Task selector   Camera / slide    Capture   Record   Search   Stop   │
├──────────┬──────────────────────────────────────┬───────────────────┤
│ Task     │                                      │ Task inspector    │
│ tools    │          Main image or scan map      │                   │
│          │          LIVE / SAVED / MOSAIC       │ Basic controls    │
│          │                                      │                   │
│          │                                      │ Advanced ▸        │
├──────────┴──────────────────────────────────────┴───────────────────┤
│ Optional strip: histogram / focus plot / scan progress / assets     │
├─────────────────────────────────────────────────────────────────────┤
│ Camera state   Stage state   XY speed   Z speed   Capture/job state │
└─────────────────────────────────────────────────────────────────────┘
```

Treat these as consistent overlay positions, not a requirement to show every region or reserve permanent columns. The live camera canvas fills the workspace underneath. The default Live layout hides the inspector and lower strip until needed. Opening an overlay should not rescale or reposition the underlying image. A scan map can be an overlay; expanding a map or saved image into the main review area must be explicit and clearly labeled.

The existing implementation supports moving overlays, while the main UI decisions leave fixed versus movable placement open. My proposal is a predictable edge-aligned position on first open, with optional user movement and pinning afterward. Fixed placement is easier to learn; movement lets an operator uncover a specimen region but can create overlap. A reliable default plus **Restore Live layout** addresses both concerns. Keep **Hide panels** separate from resetting camera or hardware settings. Docking that reduces the camera viewport is only a later alternative if you choose to relax the fullscreen-overlay model.

**Proposed layout budget:** on a 1440 × 900 desktop, aim to leave at least 70% of the usable workspace unobscured in default Live and 55% with one inspector. Count space available to the image viewport, not the sensor image's aspect-ratio-dependent pixel coverage. Start with a 320–360 px inspector; adjust after trying the actual controls.

On narrower screens, collapse the secondary strip first, then use one closable inspector drawer. Preserve Capture, recording state, and Stop motion. Do not shrink motor or numeric controls until they become difficult to operate.

## Panel contract

Every panel follows the same sequence:

1. **Header:** icon, short title, optional status, pin/dock affordance where supported, Close.
2. **Context:** the camera, slide, image, motor axis, or job affected.
3. **Basic controls:** the few parameters needed to perform the task.
4. **Advanced:** less frequent parameters and diagnostics.
5. **Action and feedback:** explicit start/apply action where needed, progress, result, and next useful action.

Opening a primary panel replaces the previous unpinned primary panel. Closing a panel changes visibility only. Recording, scanning, or an enabled filter continues until its own stop/bypass action is used. A running task must have a persistent status entry that reopens its panel.

Preserve an unfinished task's input when users temporarily open Setup. Return from calibration to the same scan plan. Invalidate only the plan elements affected by a changed slide, axis mapping, or calibration, with a clear explanation.

## A small visual vocabulary

These values are starting tokens for this project, not measurements copied from the reference applications.

| Property | Proposed starting rule |
| --- | --- |
| Spacing | Use 4, 8, 12, 16, 24, and 32 px consistently |
| Typography | One UI font; 14 px normal controls, 12 px secondary metadata, 16 px panel titles |
| Control size | 36 px standard control height; 44 px hit area for touch and motion controls |
| Icons | One existing icon family, normally 18–20 px; consistent stroke/weight |
| Shape | One 6 px control radius and one 8 px panel radius |
| Surfaces | Neutral canvas surround, panel surface, and raised control surface; thin separators |
| Accent | One selection/action accent; separate semantic recording, warning, and error treatments |
| Numbers | Align numeric fields and units; use tabular numerals for changing readouts |
| Selection | Pair color with a border, check, icon, or text state |
| Focus | A visible keyboard-focus outline on every interactive control |

Prefer a neutral dark surround for the image, with an optional light UI theme. Avoid colored panel surfaces that compete with specimen colors. Test the actual palette against both brightfield and fluorescence images.

Use icons for familiar frequent actions, and short labels for task groups and unfamiliar functions. Always label Stop and active recording. Tooltips include action, target, and shortcut, and also appear on keyboard focus. Do not make hover the only way to discover essential meaning. Keep accessible names even when visual text is hidden.

## Controls have predictable meanings

| Situation | Control rule |
| --- | --- |
| Continuous value, such as exposure or speed | Slider plus numeric field and explicit unit; both edit the same value |
| Small finite choice | Segmented choice or select; show the current choice |
| An ongoing independent state | Toggle with On/Off state |
| One operation | Verb-led button, such as Capture, Calibrate, or Export |
| Capability unavailable | Disabled control with an adjacent reason and relevant next action |
| Device does not support a parameter | Explain this once in the relevant section; avoid an empty forest of controls |
| Value has changed | Show the current value and a clearly scoped reset affordance |
| Background work | Inline progress plus persistent job state, with Stop/Cancel where supported |

Distinguish **Apply**, **Save preset**, **Reset to default**, **Revert change**, **Bypass effect**, and **Remove effect**. These are different operations and should not all use an unexplained ×.

Immediate camera adjustments do not require a generic Save button. Changes that need firmware flashing belong in an explicit staged workflow with a summary of what will be applied. Numeric fields validate before committing; retain the user's input and explain invalid values.

For speed controls, preserve the current project's separate XY and Z values and established RPM units. Do not relabel them as µm/s without a valid conversion. Keep step distance/increment separate from speed.

## Motion and image gestures

Give the canvas an explicit interaction mode: **Pan image**, **Move stage**, **Annotate**, or **Select scan area**. Display the active mode near the image and use an appropriate cursor. A drag has one meaning at a time.

Keyboard, gamepad, mouse, and on-screen movement controls should share the same axis mapping and speed values. Typing in an input must not jog the stage. Show whether the gamepad is connected, whether movement input is armed, and whether a task owns the stage.

Keep **Stop motion** visible whenever motion is possible. Define its scope as manual movement plus automated motion, including the scan/calibration job that could issue the next move. That job must enter a stopped/aborted state and must not immediately restart movement. Recording has its own Stop recording action.

The project already binds Escape to Stop All Motors. In a redesign, define precedence explicitly: while motion or a motion job is active, Escape requests that stop even if search or a dialog is open; otherwise it dismisses the current temporary UI. Stopping motion must not wait for a confirmation dialog.

Hold-to-move input should release on key/button release, window blur, pointer cancellation, and controller disconnect. Treat **stop requested**, **stopped**, and **connection lost** as different statuses. A GUI cannot truthfully claim that hardware stopped when the communication path is unavailable. These are implementation requirements to verify later, not behavior established by the screenshots.

Show stage coordinates in honest units. If positions are open-loop estimates, identify them as estimated. If specimen scale is uncalibrated, show steps or uncalibrated status rather than plausible-looking µm values.

## Image processing and changed settings

Provide a compact active-state summary, such as **Display 3 · Correction 1**. Opening it reveals named entries with current values and individual controls. Cap the summary's size rather than allowing an unlimited row of identical reset icons.

| Category | Examples | What the UI must explain |
| --- | --- | --- |
| Acquisition | Exposure, gain, camera ROI, resolution | Changes which camera frames are acquired |
| Correction | Flat-field correction, applicable calibration | Which data is corrected and which calibration is used |
| Display | Display contrast, pseudocolor, preview sharpening | Whether it changes only the view |
| Annotation | Scale bar, arrows, labels | Whether saved separately or rendered into an export |

Do not assume an existing filter is display-only: trace its actual path to capture and export when implementing this design. A decoded webcam frame is not necessarily sensor RAW, so call it **original camera frame**, not RAW.

For effects, use an enable/bypass control and an explicit reset/remove command. Revert should state its baseline, for example “Restore contrast to the value before this edit.” Saved presets can keep effects active without appearing as newly changed settings; **active** and **changed** are different lists.

Flat-field calibration needs a compact validity summary tied to the camera and relevant optical/acquisition configuration. If a change invalidates its use, explain the mismatch and offer recalibration. A closed calibration panel must not hide the active correction state.

## Capture and review

Make **Live**, **Paused preview**, **Saved image**, and **Mosaic** visually distinct. A frozen last frame after disconnection must not retain a Live label. In saved-image review, suspend manual stage gestures and provide an obvious Return to Live action; reopening the live view must not resume a previous held movement.

Capture should give immediate feedback and a recent-item thumbnail with Open/View location. Recording needs a persistent indicator, elapsed time, target/destination, and Stop recording. Surface an actual save failure at the capture entry, with recovery options supported by the implementation.

Before annotation, identify the target. A suitable default is to capture a still and annotate that saved image. If live annotations are supported, indicate whether their coordinates follow the camera frame or a calibrated specimen/map; do not silently carry image-space marks onto a different stage position.

Define export options explicitly: original camera frame, processed image, and image with annotations. Show only variants the implementation can actually produce. Review should preserve the original asset and maintain enough metadata to identify how a processed output was produced.

## Scan and calibration workflows

Use a predictable scan sequence: **Region → Focus → Capture settings → Summary → Run → Review**. It can be one inspector with steps; it need not become six modal dialogs.

Keep the map visible during region selection. Relate each focused point to its position and Z value. Before Start, show valid area, tile count, overlap, movement/calibration prerequisites, focus strategy, output destination, and estimates where available. Unknown estimates should remain unknown.

During scanning, show current/total tiles, elapsed time, completed/failed regions, and Stop scan. If pause/resume is not supported, do not present a Pause button. A failed tile should be identifiable on the map and in job details. Review should link the stitched result to its tile job.

Calibration should follow **Explain → Prepare → Measure → Inspect result → Apply**. Routine use shows calibration status, not the full calibration form. Advanced probe settings and plots remain available in the calibration inspector. Preserve the previous usable calibration until a replacement succeeds and is accepted according to the workflow.

## Apply the rules to this repository

The inspected source already contains several building blocks:

| Existing area | Evidence | Recommended next design step |
| --- | --- | --- |
| Quick actions, speeds, tool groups, changed settings | [Toolbar](../../../webserved_dir/o_component__toolbar.js) | Consolidate into the stable regions above; limit default visible items |
| Command search and keyboard bindings | [Actions component](../../../webserved_dir/o_component__actions.js) | Preserve Ctrl+Shift+P and searchable settings; define Escape precedence |
| Control lookup and change tracking | [Control catalog](../../../webserved_dir/control_catalog.module.js) | Distinguish active effects from changed values and clarify reset baselines |
| Movable windows | [Overlay behavior](../../../webserved_dir/overlay_windows.module.js) and [UI brief](../readme.md) | Standardize panel anatomy and first-open placement; add optional docking later |
| Hardware setup and calibration | [Setup component](../../../webserved_dir/o_component__setup.js) | Keep configuration out of routine navigation and link prerequisites back to tasks |
| Scans and focus points | [Scan component](../../../webserved_dir/o_component__scan.js) | Make the visual plan and state transitions the center of the workflow |

These are source observations, not a runtime usability audit. The UI brief explicitly says general overlay resizing remains separate work; it must not be assumed available merely because the design permits it.

## A feature admission checklist

Before accepting a new UI feature, answer:

- Which task group and existing panel own it?
- What object does it affect: camera, image, stage, slide, or job?
- Must it be visible during ordinary Live use, or can it be contextual?
- Does an existing control pattern express it?
- Where are active, running, unavailable, and failed states visible?
- Does it modify acquisition, correction, display, annotation, or export?
- How is it discovered through search and operated by keyboard?
- What happens when its panel closes or its device disconnects?

Implement the shared panel and control patterns first, then migrate one workflow at a time. A useful first slice is Live with camera tuning, motion status, capture, and one active-effects list. Use the exercises in the next document before expanding to Scan and Setup.
