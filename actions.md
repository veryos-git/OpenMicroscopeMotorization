# Actions & Keybindings Requirements

## Purpose
Define how user-facing operations are exposed as **actions** and bound to keyboard/gamepad inputs.

## Definitions
- **Action**: Named user-facing operation, e.g. `Capture Image`.
- **Binding**: Input assigned to an action, e.g. `Ctrl+Shift+I`, gamepad button.
- **Keymap / Input Map**: Complete set of action bindings.
- **Digital action**: Boolean trigger, e.g. button press.
- **Analog action**: Float/axis value, normalized `-1..1` or `0..1`.
- **Auto-repeat**: Digital action invokes repeatedly while held.
- **Command Palette / Action Search**: Searchable UI to find and invoke actions.
- **Global**: Application-wide, active in every context of the app (not OS-wide).
- **Context**: The area/mode where an action is active. Currently only `global` exists; the model shall allow more contexts in the future.
- **Chord**: Multiple keys held simultaneously as one binding, e.g. `Ctrl+F`.

## Requirements

### Action Registry
1. The system shall maintain a registry of all actions exposed to the shortcut system.
2. Each action shall have:
   - stable action ID
   - display name
   - description
   - category
   - input type: `digital` or `analog`
   - default binding(s)
   - context/scope (currently always `global`)
   - rebindable flag
   - repeat mode: `none`, `single-shot`, `auto-repeat`
   - optional search keywords
3. Actions shall be invokable from keybindings, command palette, and UI controls where applicable.
4. The action model shall be context-aware even though only the `global` context exists today, so additional contexts can be added later without redesign.

### Input Sources
5. The system shall support keyboard input: single keys, modifier keys, and multi-key chords (e.g. `Ctrl+F`).
6. The system shall support gamepad input: buttons, D-pad, triggers, analog axes.
7. An action may have multiple bindings, e.g. primary and secondary.
8. Multiple actions may be active simultaneously, e.g. holding throttle on a gamepad trigger while pressing a button to capture an image.

### Rebinding
9. The user shall be able to assign, change, clear, and reset bindings for rebindable actions.
10. The system shall detect binding conflicts within the same context.
11. On conflict, the user shall be warned and may cancel or override.
12. Bindings shall persist per user/profile and restore on startup.
13. The system shall support reset-to-default, import, and export of keymaps.
14. Keymap import/export format shall be JSON.

### Auto-repeat
15. Digital actions shall support `single-shot` or `auto-repeat`.
16. In `auto-repeat`, the action shall invoke repeatedly while held, after an optional **repeat delay** and at a configurable **repeat interval** in milliseconds.
17. Auto-repeat shall stop when the input is released.
18. If an analog input is bound to a digital action, the system shall use a configurable threshold/deadzone to convert it to press/release.

### Analog Actions
19. Analog actions shall receive a normalized float value.
20. Gamepad axes/triggers may map directly to analog actions.
21. Analog actions should support deadzone, sensitivity, and response curve settings.

### Command Palette / Action Search
22. The system shall provide an action search overlay.
23. The overlay shall open via configurable shortcuts, with defaults `Ctrl+F` and `F3`.
24. The user shall be able to search by action name, description, category, and keywords.
25. The UI should show the current binding for each result.
26. Pressing Enter shall invoke the selected action.

### Contexts
27. Actions shall only fire when their context is active.
28. "Global" means application-wide: active in every context of the app.
29. Only the `global` context exists at this time; the system shall be designed to support additional contexts later.
30. OS-level global hotkeys, if ever needed, are a separate feature and shall be specified separately.

## Acceptance Criteria
- Given `image.capture` is bound to `Ctrl+Shift+I`, when pressed, the image is captured.
- Given `image.capture` has auto-repeat delay `500 ms` and interval `100 ms`, when held, it fires after `500 ms`, then every `100 ms` until release.
- Given the command palette is open, typing `cap` shows `Capture Image`; pressing Enter invokes it.
- Given `Ctrl+F` or `F3` is pressed, the command palette opens.
- Given the user binds a shortcut already used in the same context, the system warns and allows cancel or override.
- Given a gamepad axis is bound to an analog action, the action receives a normalized float value.
- Given the user holds throttle on a gamepad trigger, pressing the capture button simultaneously still fires the capture action.
- Given a multi-key chord such as `Ctrl+F` is bound to an action, pressing all keys together invokes the action; pressing them non-simultaneously does not.

## Open Questions
- Should key sequences (e.g. `Ctrl+K, Ctrl+C`) be supported, or only chords and single keys?