# Cockpit — how the windows are built

10.11.2026 · machine-written · applied to every window in `webserved_dir`

- UI rules → `readme_hgc.md` (source of truth, not repeated here)
- drawings → `overlay_windows/[name]`, `input_elements/[name]`
- this file → only the code pieces that carry out those rules

## Shared pieces
- `index.css` → section "Cockpit layout system" (end of file)
- `o_component__cockpit.js` → `<ui_tab>`
- `tooltips.module.js` → instant tooltip

## Fit on one screen
- fields side by side → `.cockpit-grid` (2–4 columns), `.cockpit-field`
- slider = one row → pictogram + name, slider, exact value
- data lists scroll inside their own area → `.cockpit-list` (scans, saved captures, recordings, logs)
- main action fixed at the bottom → `.cockpit-footer`
- large window → `<ui_tab>`, one pane per function, panes stay mounted (`v-show` + `data-cockpit-pane`) so search finds every control

## Tooltip
- field → `data-tooltip` on the field wrapper, label gets a small **i**
- section / window → `<span class="ui-info" data-tooltip="…">`
- button → `data-tooltip`
- heading line, then `&#10;`, then the explanation
- plain `title` → shown as the same tooltip

## Header
- pictogram of the tool · title · state (`.panel-state`) · quick actions (`.cockpit-icon-button`) · close
- one pictogram per tool

## One place per window
- opened from Tools (and its pinned shortcut) only
- no window that only opens other windows

## Still open
- tabs vs. "no collapsible sections" in `readme_hgc.md` → to decide
- blocked-reason lines (e.g. Scan start) are visible text → `readme_hgc.md` wants them in a tooltip
- built for 1366 × 768; `readme_hgc.md` expects 1920 × 1080
- Quick settings repeats values: speeds (also Gamepad), project / slide / map, hardware state
- Capture image and Camera share one pictogram
- Search window and keybinding editor not restyled
