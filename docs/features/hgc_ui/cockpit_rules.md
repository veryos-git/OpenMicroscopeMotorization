# Cockpit rules for overlay windows

10.11.2026 — applied to every window in `webserved_dir`. The shared pieces are the
"Cockpit layout system" section at the end of `index.css`, `o_component__cockpit.js`
(tabs) and `tooltips.module.js`.

These rules cover density, tabs and tooltips. They do not replace a drawing: the
exact arrangement of a window still follows its drawing in `ui_guide` when one exists.

## 1. No window scrolls
- A window fits on a 1366 × 768 screen below the top bar.
- Only a list of data may scroll, inside its own area (`.cockpit-list`): scans,
  saved captures, recordings, positions, logs.
- Fields go side by side in a grid (`.cockpit-grid`, 2–4 columns), not one per row.
- A slider is one row: pictogram + name, slider, exact value.

## 2. Every function has one place
- A window with more than one screen of controls gets pictogram tabs
  (`<ui_tab>`), one pane per function. Panes stay mounted (`v-show` +
  `data-cockpit-pane`) so search still finds every control.
- The main action of a window (Start, Capture, Stop) sits in `.cockpit-footer`
  and stays visible in every pane.
- No window that only opens other windows. Tools and Search do that.
- A window is opened from one place: Tools (and the shortcut the user pins from
  there). No extra button for it inside another window.

## 3. Text goes into tooltips
- A window shows names, values and state. Explanations are tooltips.
- Field: `data-tooltip` on the field wrapper; its label gets a small **i**.
- Section or window: `<span class="ui-info" data-tooltip="…">` next to the title.
- Button: `data-tooltip` on the button.
- First line = heading, then a line break (`&#10;`), then the explanation.
- A plain `title` attribute is shown as the same instant tooltip.
- Text that stays visible: errors, the reason an action is blocked, live status.

## 4. Header
- Pictogram of the tool (same as in Tools and the top bar), title, then on the
  right: state (`.panel-state`), quick actions (`.cockpit-icon-button`), close.
- One pictogram per tool. Do not reuse a pictogram for two tools.

## Still open
- Quick settings repeats values that have their own place: speeds (also in
  Gamepad), project / slide / map (Slide library, Map) and hardware state (Setup).
- Capture image and Camera use the same pictogram.
- The Search window and the keybinding editor are not restyled.
