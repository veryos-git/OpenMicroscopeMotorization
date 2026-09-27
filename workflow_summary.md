# Workflow implementation summary

Reviewed on 2026-09-24 against [hgc_workflow.md](hgc_workflow.md), [hgc_target_group.md](hgc_target_group.md), and the current application and firmware source.

**Highest current priority (WF-007): make forward/backward direction reversible for each axis without changing its motor assignment.** The operator reports that axis assignment is already correct, but direction cannot be changed in their setup. Treat this as an unresolved workflow blocker even though per-input CW/CCW settings exist in the source.

The application already implements many of the proposed solutions: controller status, camera selection, firmware flashing, motor reassignment, backlash calibration and compensation, configurable shortcuts, scanning, and map localization. The main remaining work is making setup failures understandable, validating the new manual XY/Z speed controls on hardware and improving desktop workspace organization. Existing mapping needs reliability evaluation before choosing a replacement stitching method.

### WF-004 / WF-005 — Speed controls delivered

[Shared speed controls](webserved_dir/o_component__manual_speed.js) now appear
in the toolbar, Setup and Gamepad. [Speed helpers](webserved_dir/manual_speed.module.js)
provide limits, presets and migration from the original shared jog setting.
Validation: 52 axis, gamepad, action and speed tests pass. The isolated browser
check passes for presets, independent editing, reload persistence, bounds, shared
panels and desktop layouts at 1920 and 3440 pixels wide. The workflow coverage
table reflects this implementation; physical acceptance remains pending.

### WF-007 — Direction hotfix follow-up

A hotfix now adds **Reverse X/Y/Z manual direction** directly to each assigned
motor card in Setup. It persists paired input mappings for keyboard, mouse and
gamepad, including right-mouse focus, without changing axis assignments or
requiring firmware flashing. Changes are blocked while hardware activity is in
progress. The 49 axis, gamepad and action tests pass, including new reversal
and saved-setting restoration checks.

This resolves the missing direct manual-axis control in the assessment below;
physical acceptance on the operator's assembly is still pending. It is scoped
to manual input: physical CW/CCW test buttons, automated moves and position
coordinates keep their existing meaning. A universal coordinate-polarity system
is not part of this hotfix. The original review and its priorities follow.

This is a source review, not a hardware acceptance test. “Implemented” means there is an active code path and UI; it does not establish that the feature works reliably on a physical assembly. Missing features below were not found in the reviewed active implementation. Archived code and design proposals are not counted as delivered features.

## Target users and priority assumptions

The target-group document specifies desktop computers with monitors of at least **1920 × 1080**, possibly wider. It does not specify operator experience, specimen type, or whether scanning is more important than manual observation.

The operator’s reported direction-reversal blocker takes precedence over the initial source-review priorities. The remaining proposed priorities favor getting connected and controlling the microscope reliably, followed by effective use of a 1080p or widescreen desktop. Small-screen redesign is lower priority, although a smaller browser window or display scaling can still reduce usable space on a large monitor. Priority reflects user impact and dependencies, not measured frequency or implementation effort.

- **P0 — current blocker:** reverse forward/backward on the correctly assigned axis.
- **P1 — next:** problems that block starting work or repeatedly impede basic movement and focus.
- **P2 — following:** measurement reliability, navigation, and desktop productivity improvements.
- **P3 — later:** optional customization and layouts outside the stated minimum display target.

## Workflow coverage

Problem IDs (`WF-001`–`WF-013`) are shared with [hgc_workflow.md](hgc_workflow.md).
They identify problems, not priorities or delivery order: keep an ID when its
status or priority changes, never reuse retired IDs, and assign the next unused
number to a new problem. Repeated mentions of the same problem use the same ID.

| ID | Operator problem | Current status and implementation | Remaining work | Suggested priority |
| --- | --- | --- | --- | --- |
| **WF-001** | USB camera does not appear; operator does not know how to select it | **Partial.** Toolbar camera selector; “No camera active” placeholder points to it. Browser camera permission and enumeration use `getUserMedia` and `enumerateDevices`; a saved available device can restart automatically. Enumeration/start failures are logged to the console. | Show permission denied, no device, unavailable/busy camera, and disconnected camera states with recovery actions. Add refresh/retry and device-change handling. Include camera readiness in onboarding. | **P1** |
| **WF-002** | Controller is disconnected or motors do not move | **Partial.** Toolbar shows USB/IP connection status. Setup provides USB and WiFi connection, serial errors, per-motor movement/status/position, and move/stop tests. USB connection waits for a firmware status response. | Provide a visible connection checklist and physical troubleshooting: controller USB, motor power, driver/motor wiring, selected axis, speed, and a short test movement. Make connection controls easier to discover; they currently sit in an expandable Setup section. A controller status response cannot prove physical movement. | **P1** |
| **WF-003** | Operator needs to re-flash the ESP32 | **Implemented, with usability follow-up.** Setup compiles firmware on the server, flashes through browser Web Serial, displays progress, verifies the upload, and attempts USB reconnection. Browser/context requirements and errors are surfaced. | Integrate this existing flow into troubleshooting after connection/power/wiring checks. Keep actionable recovery instructions close to failures and validate the complete recovery flow on hardware. | **P1** integration; no new flasher required |
| **WF-004** | Motors are too slow, or speed is hard to reach | **Implemented.** Always-visible toolbar controls provide XY/Z sliders, precise numeric RPM entry, and Slow/Normal/Fast presets. Setup and Gamepad share the controls. Values are saved together and restored on reload. | Validate speed ranges and preset usefulness on the physical assembly. | **P1 — implemented; hardware acceptance pending** |
| **WF-005** | XY speed is suitable but Z focus is too fast | **Implemented for manual movement.** XY and Z have independent persistent speeds. Keyboard, mouse, gamepad, motor-card tests and saved-position moves use the corresponding axis speed. Existing XY speed is preserved; Z defaults to 0.5 RPM. Speeds follow axis reassignment. | Verify physical focus response. Autofocus, scan and calibration movement settings remain separate. | **P1 — implemented; hardware acceptance pending** |
| **WF-006** | Image keeps drifting after XY stops | **Missing as a diagnostic.** Scanning has a settling delay; image-shift measurements exist in backlash calibration. Neither provides an automatic post-stop drift check or hardware-adjustment guidance. | First add hardware guidance about friction-drive pressure and inspection. Then evaluate image translation over a settling interval after stopping, with thresholds and confidence checks. Treat excessive shaft pressure as a possible cause from the workflow notes, not a diagnosis proved by an image shift. | **P1** guidance; **P2** detection |
| **WF-007** | Correct axis moves in the wrong forward/backward direction; operator cannot reverse it | **Operator-reported blocker.** Axis assignment is correct in the current setup. Source contains per-input CW/CCW selectors under Setup → Manual movement → Input directions & gamepad, but these are not a single axis inversion setting and do not establish that the operator can successfully reverse their controls. Setup motor tests use signed steps independently of these input mappings. | Reproduce the reported failure and provide a clear, persistent “Reverse direction” control per axis without reassigning motors. Keep paired forward/backward inputs opposite, apply a consistent direction convention across input methods, and explicitly verify the relationship to automated movement and position coordinates. | **P0 — highest current priority** |
| **WF-008** | WASD controls the wrong physical axes | **Implemented.** Setup assigns each physical motor to X/Y/optional Z, swaps occupied assignments, persists the mapping, and updates keyboard/mouse motor mappings. Per-input direction selectors exist in source, but the operator reports direction reversal is not usable; see WF-007 (P0). Scan and other tools use the shared axis mapping. | Add a guided “test X, test Y, test Z” setup step and verify direction visually. Maintain regression coverage when changing speed or input handling. | **P1** onboarding integration; no new assignment system required |
| **WF-009** | Small screen is crowded | **Partial.** A CSS breakpoint at 768 px makes overlays almost full width and adjusts selected controls. Panels can be hidden. | Add a deliberate compact/single-task layout if smaller viewports become a supported workflow; avoid stacked overlapping panels. Check window resizing and scaling during desktop validation. | **P3** dedicated redesign |
| **WF-010** | Large/wide screen does not use available space well | **Partial.** Live camera fills the main view; toolbar wraps and measures its height. Most tool panels use fixed widths and fixed overlay positions. | Provide a desktop layout with useful side areas or docking, preserving space for the live image and allowing map, movement, and focus controls to coexist. Validate 1920 × 1080 and representative wider viewports. | **P2** |
| **WF-011** | Backlash delays movement after reversing | **Implemented; physical accuracy unverified here.** Each motor has image-based calibration and editable compensation. XY uses image shift; focus can use sharpness. Results can be applied and saved. Firmware tracks slack and adds take-up steps on reversal without counting them as specimen position. | Validate repeated reversals and short moves on the actual friction drive; give useful guidance when a calibration is unreliable. Mechanical play still needs adjustment. Keep calibration discoverable in setup. | **P2** validation/improvement |
| **WF-012** | UI is not adapted to the operator's workflow | **Partial.** Panel visibility is saved. The action palette supports search and configurable input bindings. Zoom supports moving/resizing its window, but that behavior is not a general workspace system. Toolbar buttons are defined in code. | Add saved workspace presets and general panel placement/docking. If needed, allow users to pin/reorder favorite actions in the toolbar. Reuse the existing action registry. | **P2** workspace presets; **P3** arbitrary toolbar customization |
| **WF-013** | Operator does not know their position on the slide | **Implemented foundation; reliability not established.** Scan captures a grid and invokes stitching. Map selects a mosaic, uploads small live frames for localization, displays a location rectangle and match score, and supports click-to-go with steps-per-pixel values. Projects/slides/maps can be selected and stored. | Measure stitching/localization failures on representative slides. Improve stale/uncertain-location feedback, orientation/scale calibration, and recovery from ambiguous matches. Validate map-click accuracy and return positioning before treating the map as dependable navigation. | **P2**, promoted to **P1** if slide scanning/navigation is the main use case |

## How the existing implementation works

### Connection and recovery

[Toolbar](webserved_dir/o_component__toolbar.js) exposes camera selection and controller status. [Webcam](webserved_dir/o_component__webcam.js) requests browser permission, enumerates video inputs, and opens the selected stream. There is a useful empty state, but detailed camera failures currently remain in developer-console messages.

[Setup](webserved_dir/o_component__setup.js) combines physical motor cards, calibration, input settings, connection, and firmware controls. [Shared application state and transport](webserved_dir/index.js) manage settings persistence and controller communication; [serial handshake](webserved_dir/serial_handshake.module.js) checks that firmware responds. [Browser flashing](webserved_dir/flash_browser.module.js) and [server compilation](flash_functions.module.js) provide the existing recovery mechanism.

The [calibration checklist](webserved_dir/o_component__calibration.js) already orders optical baseline, backlash/scale, flat field, focus step, and physical scale. It is not yet a complete initial camera/controller/motor connection checklist. Extend these existing pieces rather than creating a competing setup system.

### Movement, speed, and backlash

**Axis assignment and direction inversion are separate requirements.** The current setup has the correct motor-to-axis assignment. The remaining blocker is reversing what forward/backward means on that axis. Jog direction selectors store individual `o_mapping__*.s_dir` values and `f_get_mapping` reads them for manual movement; they do not provide a shared axis-polarity setting. The root cause of the reported inability to change direction has not been reproduced, so it must not be marked solved merely because these selectors exist.

[Jog controls](webserved_dir/o_component__jog.js) implement keyboard, mouse, and gamepad movement, using independent XY and Z manual RPM settings. [Gamepad controls](webserved_dir/o_component__gamepad.js) scale the corresponding axis maximum with stick displacement. Setup's motor test buttons also use their assigned axis speed. [Autofocus](webserved_dir/o_component__focus.js) uses a separate fixed constant; independent autofocus behavior should not be mistaken for configurable manual focus speed.

[Backlash calibration](webserved_dir/o_component__backlash.js) measures a signal over probe movements and applies a fitted result. [Backlash math](webserved_dir/backlash_math.module.js) supports the analysis; [ESP32 firmware](stepper_websocket.ino) performs compensation during motion. This provides substantial implementation coverage, but cannot establish actual stage movement or eliminate friction-drive drift without physical validation.

### Desktop UI and customization

[Control page](webserved_dir/o_component__page_control.js) composes the live image and tool overlays. [Styles](webserved_dir/index.css) mainly position fixed-size panels; some hubs occupy the same default area. [Actions](webserved_dir/actions.module.js), [action integration](webserved_dir/o_actions.js), and [action UI](webserved_dir/o_component__actions.js) already provide a basis for searchable commands and configurable bindings. Saved panel visibility and the specialized [Zoom window](webserved_dir/o_component__zoom.js) do not yet amount to a saved, general-purpose desktop workspace.

### Slide maps and stitching

[Scan](webserved_dir/o_component__scan.js) moves over a grid, waits for settling, optionally focuses, and captures tiles. [Stitching integration](stitch_functions.module.js) runs [stitch.py](stitch.py), which uses FFT normalized cross-correlation, a robust global position solve, prior-guided registration, and blending. The current scan stitcher is not a trained AI model.

[Map](webserved_dir/o_component__map.js), [localization service](locate_map.module.js), and [localization worker](locate_map.py) periodically match downscaled camera frames against a selected mosaic with OpenCV template matching. A score threshold supplies a found/not-found result. Click-to-go translates map displacement into X/Y motor steps using entered scale values; this is a simpler model than a calibrated camera-to-stage transform that handles rotation and axis direction.

The workflow document proposes that trained AI is required because classical stitching is insufficient. **That requirement is not established by this source review.** No comparative accuracy evaluation was performed. First collect representative successful and failed scans and define acceptable seam alignment, localization accuracy, failure detection, and runtime. Then compare improvements to the existing pipeline with learned registration if the results justify it. The existing Cellpose feature performs segmentation and is not evidence of AI stitching.

## Suggested delivery order and completion criteria

1. **Resolve axis direction reversal (WF-007; P0).** Reproduce why forward/backward cannot be changed in the operator’s setup, then make inversion discoverable and persistent per axis. Completion: reversing X, Y, or optional Z leaves its assigned motor unchanged, makes paired controls move in opposite physical directions, works consistently with keyboard/mouse/gamepad, and survives reload. Check Setup tests and automated moves against the chosen coordinate convention. Verify on the actual assembly.
2. **Make connection and first movement understandable (WF-001, WF-002, WF-003, WF-008; P1).** Combine camera status, controller handshake, physical wiring/power guidance, axis tests, and links to existing flashing. Completion: an operator can identify the failed setup stage and see a specific next action without opening developer tools. Confirm actual movement separately from controller-reported movement.
3. **Make everyday movement and focus controllable (WF-004, WF-005, WF-006; P1).** XY/Z controls and presets are now implemented for WF-004/WF-005; physical acceptance remains. WF-006 drift guidance is still outstanding. Completion: XY remains fast while Z is slow across keyboard, mouse, gamepad, and motor tests, including after reassignment and reload. Include concise drift-adjustment guidance.
4. **Validate mechanics and calibration (WF-006, WF-011; P2).** Check backlash repeatability and post-stop settling on real assemblies; prototype drift detection using existing image-shift tools. Completion: calibration quality and unsettled images produce useful feedback, with results checked against observed movement.
5. **Arrange the desktop around the workflow (WF-010, WF-012; P2).** Deliver useful default observation/scanning layouts and saved workspace state. Completion: essential controls remain reachable at 1920 × 1080 and on wider displays, with room for the live image, map, and active tool.
6. **Establish dependable map navigation (WF-013; P2, conditional P1).** Benchmark scan stitching and localization; validate map-to-stage orientation/scale and handle uncertain/stale matches. Completion: documented accuracy and failure behavior on representative slides, including repetitive/low-detail regions and return-to-position checks. Select any AI work from measured failures.
7. **Extend optional customization (WF-009, WF-012; P3).** Add toolbar favorites and compact layouts after the desktop workflow is satisfactory.

Steps 4–6 can be reordered according to observed operator failures. Calibration and mechanical stability support trustworthy maps; a widescreen layout alone will not resolve inaccurate localization.

## Verification scope and remaining evidence

Existing tests cover parts of axis reassignment, gamepad behavior, action bindings, serial handshake, and browser flashing; browser smoke scripts also exist for actions and calibration UI in [tests](tests/). Their presence is evidence of test coverage intent, not a passing result from this review.

The original documentation-only review ran no application tests, browser sessions, firmware uploads, or hardware measurements. Subsequent direction and speed implementation checks are recorded in the follow-ups above; no physical hardware measurements or firmware uploads were performed. Before closing the workflow issues, validate camera unplug/replug and denied permissions, connection recovery, real motor direction/speed, backlash/drift, desktop layouts, and map accuracy. P0 reflects direct operator feedback. The remaining priority order is a proposal pending further operator feedback and failure-frequency evidence.
