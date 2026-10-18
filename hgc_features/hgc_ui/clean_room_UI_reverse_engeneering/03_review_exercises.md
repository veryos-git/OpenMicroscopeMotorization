# Exercises for studying and validating the interface

Use the local gallery to extract one concrete rule per reference. Then test the proposed rule in your own application. A screenshot can establish position and visible state; confirm sequences, persistence, keyboard behavior, and recovery through documentation or an interactive trial.

## A 45 minute reference review

| Time | Reference | Exercise | Output |
| --- | --- | --- | --- |
| 0–8 min | OpenFlexure View/Navigate | Trace permanent regions and the region that changes between the two screens | A default Live layout and one expanded state |
| 8–16 min | Nikon Live/Annotate | List permanent controls versus options revealed for a selected tool | A maximum default toolbar inventory |
| 16–23 min | SharpCap | Group its camera controls by acquisition, correction, and display; mark uncertain cases for documentation | A camera-inspector outline |
| 23–30 min | cellSens Simple Layout and layout variants | Identify which controls a quick-look session needs; compare floating with docked arrangements | A default layout and one advanced layout |
| 30–37 min | Micro-Manager acquisition + Leica Navigator | Connect numeric acquisition parameters to a spatial scan plan | A scan summary and map/list interaction proposal |
| 37–45 min | OBS filters + ZEN | Separate active effects from selected tasks and advanced settings | Effect-list behavior and task-group rules |

## Record observations without inventing behavior

For each useful pattern, capture this small record:

```text
Reference and image ID:
Visible observation:
Documented behavior and source URL:
Unanswered interaction question:
Rule proposed for our application:
Task that will test that rule:
```

For example, OBS's filter screenshot visibly has eye controls and a separate removal control. Its official guide documents enable/disable behavior. That supports proposing distinct bypass and remove actions. It does not establish how your microscope should save original versus processed images; that requires your own explicit data policy.

## Prototype tasks

These are proposed acceptance checks for a later UI implementation. They were not performed against the current hardware or application.

| Task | What should be observable |
| --- | --- |
| Connect a camera and look at a specimen | Live state is clear; the image dominates; a motor controller is not required for viewing |
| Change exposure, then capture | Numeric value and unit remain visible; the saved item and destination can be found immediately |
| Record while adjusting focus | Recording state and Stop recording remain accessible as the focus panel opens/closes |
| Move XY and Z with keyboard/gamepad | Active input mode and speed are clear; typing does not move the stage; release ends the held move |
| Stop during an automated scan | The next move cannot restart automatically; stopped versus stop-requested status is honest |
| Switch between pan and annotation | The active gesture mode is obvious before dragging; the annotation target is identifiable |
| Apply three filters, then bypass one | All active effects can be found together; bypass retains parameters; reset/remove have distinct meanings |
| Start a scan without calibration | The blocked action explains what is missing and opens the appropriate calibration context |
| Return from calibration | The previous scan plan is retained, with any invalidated elements explained |
| Review a saved image while the camera is connected | Saved and Live contexts are clearly distinguishable; edits affect the selected asset |
| Disconnect camera/controller during work | Last-frame/stale state is visible; a lost connection does not masquerade as successful completion |
| Close/reopen panels and restore layout | Task state survives visibility changes; restoring the layout does not reset instrument settings |

## Compare alternatives with evidence

Try the same tasks with the current UI and a proposed layout. Record completion, time, wrong-panel openings, accidental actions, and requests for help. Ask the participant to point to the current image type, movement mode, recording state, active processing, and save destination. A clean-looking screen that hides these answers still needs work.

As a first design target, keep capture and Stop motion directly available, and make common parameters reachable through one contextual panel. Treat panel counts, target sizes, and image-area percentages from the rules as hypotheses to validate on the actual screen and input devices.

## Smallest useful next implementation

Build one complete Live workflow with the shared panel header, control rows, keyboard-focus treatment, camera section, motion status, capture feedback, and active-effects list. Check it on a normal desktop and a narrower window. Then reuse the same components for Scan. This establishes the rules before migrating every feature.
