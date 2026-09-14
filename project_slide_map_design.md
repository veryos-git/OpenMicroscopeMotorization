> note: the live "grow" mosaic (SuperPoint + SuperGlue) described in older
> revisions of this document is **not** part of the public release — see
> `readme.md`. the data model below does not depend on it.

# Project → Slide → Map design

Status: draft design (decisions locked 2026-08-26, not yet implemented).

Goal: give the software a persistent *identity* for each physical slide, so a user
can save/load work, name a slide ("honey bee leg"), attach one main mosaic (map)
per slide, keep all of that slide's data editable, and auto-detect when the slide
under the camera changes.

This builds on what already exists — `stitch.py` (grid scan → mosaic) and
`locate_map.py` (template-matching "where am I") — and layers a data model over
them. Nothing in the imaging/motion pipeline is rewritten.

---

## 1. Locked decisions

| # | decision | choice |
|---|---|---|
| 1 | container depth | **Project → many Slides** (a project is a study/folder, e.g. "honey bee anatomy"; slides live inside it) |
| 2 | re-scanning a slide | **keep map history**, one *primary* map shown in the UI; older maps kept |
| 3 | markers belong to | **the slide**, anchored to the image the user was viewing; their position is found and stored **per map** (see §5) |
| 4 | files on disk | **reorganize into per-slide folders** under `projects/<project>/<slide>/` (see §4) |

---

## 2. Data model

The DB layer in `webserved_dir/constructors.module.js` + `database_functions.module.js`
auto-derives table names (`a_` + model name) and foreign keys (`n_<model>_n_id`).
Adding a model is just registering it in `a_o_model`. Five new models:

```
o_project
    n_id
    s_name                       e.g. "honey bee anatomy"
    s_note
    n_ts_ms_created
    n_ts_ms_updated

o_slide
    n_id
    n_o_project_n_id             FK -> a_o_project.n_id   (one project, many slides)
    s_name                       e.g. "honey bee leg"
    s_note                       specimen / stain / date / objective …
    n_x__stage                   last stage position (motor 0/1/2 step positions)
    n_y__stage
    n_z__stage
    n_ts_ms_created
    n_ts_ms_updated

o_map
    n_id
    n_o_slide_n_id               FK -> a_o_slide.n_id     (one slide, many maps)
    s_kind                       'grow' | 'scan'
    s_path_map                   map.jpg | stitched.png
    s_path_preview               map_preview.jpg | stitched_preview.jpg
    s_path_folder                folder holding tiles + state.json
    n_scl_x                      full map px width
    n_scl_y                      full map px height
    b_primary                    is this the slide's current map
    n_ts_ms_created
    n_ts_ms_updated

o_marker
    n_id
    n_o_slide_n_id               FK -> a_o_slide.n_id     (one slide, many markers)
    n_o_map_n_id__origin         FK -> a_o_map.n_id       (the map/image the user was viewing when drawn)
    s_name                       e.g. "leg hair"
    s_label                      optional class label (AI training datum)
    n_x__origin                  marker box top-left, origin-map px
    n_y__origin
    n_scl_x__origin              marker box size, origin-map px
    n_scl_y__origin
    s_path_patch                 saved crop of the webcam image at draw time (robust anchor)
    n_ts_ms_created
    n_ts_ms_updated

o_marker_map_position            (where a marker sits on a given map, if found)
    n_id
    n_o_marker_n_id              FK -> a_o_marker.n_id
    n_o_map_n_id                 FK -> a_o_map.n_id
    b_found                      located on this map (false = tried, not found)
    n_x                          marker box top-left, this map's px (valid when b_found)
    n_y
    n_scl_x
    n_scl_y
    n_ts_ms_created
    n_ts_ms_updated
```

Notes:

- **The marker is one logical annotation owned by the slide** (decision 3). Its
  position on each map is stored separately in `o_marker_map_position`, so the
  marker itself is never duplicated — one marker, one position per map that shows it.
- `n_x__origin / n_y__origin / n_scl_x__origin / n_scl_y__origin` correspond to the
  `n_x__world / n_y__world / n_scl_x__world / n_scl_y__world` fields
  `o_component__map.js` already writes, plus one FK to the map it was drawn on.
- `s_path_patch` is **always saved** when a marker is drawn: the crop of the webcam
  image at that moment. It is what lets a marker be re-found on any map (see §5)
  without depending on map-to-map alignment. (Stored as a lenient string so markers
  imported from the old `a_o_marker` setting can hold an empty patch until re-found.)
- **Optional provenance table** (only needed if we register whole maps rather than
  template-matching each marker's patch; see §5):

```
o_map_transform
    n_id
    n_o_map_n_id__from           FK -> a_o_map.n_id   (source / older map)
    n_o_map_n_id__to             FK -> a_o_map.n_id   (target / newer map)
    s_transform_json             the homography/affine as JSON
    n_ts_ms_created
    n_ts_ms_updated
```

- `o_setting` stays for **global** state (motor pins, jog speed, panel visibility,
  camera device, ESP IP, backlash). Per-slide / per-map data moves into the tables
  above.
- **Schema migration:** `f_init_db` now syncs missing columns via `ALTER TABLE`
  (`database_functions.module.js`), so adding a property to a model applies to an
  existing `app.db` on the next start — no manual wipe needed.

---

## 3. Filesystem layout (decision 4)

New captures are written into per-slide folders instead of the flat timestamped
`scans/` folders:

```
projects/
  <project-slug>/                    e.g. honey-bee-anatomy/
    <slide-slug>/                    e.g. honey-bee-leg/
      map__primary/                  the slide's current map (decision 2)
        map.jpg | stitched.png
        map_preview.jpg
        state.json                   (grow state / scan state)
        tiles/                       tile_r0_c0.png … or grow_*.png
      map__<n_id>/                   older map versions, one folder each
        …same contents…
      capture/
        focus_stack_<ts>/            z-stacks and other per-slide artifacts
```

- `map__primary` is the folder the UI points at; on a re-scan the old folder is
  renamed `map__<n_id>` and the new one becomes `map__primary`. The authoritative
  "which map is primary" flag stays in the DB (`o_map.b_primary`) — the folder
  name is just a human-friendly mirror. (A symlink is an option on Linux/macOS;
  not relied upon, so Windows is unaffected.)
- The DB stores the real paths (`o_map.s_path_map` etc.), so exact folder naming
  is flexible.

**Plumbing impact (small):** `locate_map.module.js`,
`focus_stack` and the scan-folder handlers currently generate a timestamped folder
under `scans/`. They must accept a *target folder* (the slide's `map__primary/`)
instead. The Python scripts already take `--out` / `--map` / folder args, so this
is a change in the Deno modules that call them, not in the Python.

**Migration of existing data:** current `scans/<name>/` folders are imported once
into the new layout (or referenced by path) — nothing is lost. A small
"import scans" routine reads existing `grow_*/scan_*/focus_stack_*/` folders and
creates `o_slide` + `o_map` rows pointing at them.

---

## 4. Slide auto-detection

`locate_map.py` already does `cv2.matchTemplate` (NCC) of the live frame against
one downscaled map. Reuse it for slide identity:

1. **Tier 1 — cheap:** try the *currently loaded* slide's primary map first (locate
   is already running against it). High score → still on that slide, and position
   comes for free.
2. **Tier 2 — on low score only:** run the live frame against the other slides'
   primary maps (all downscaled to ≤512 px long side, so a few ms each). Highest
   confident match wins → load that slide + restart `locate_map` on its map.
3. **No match above threshold** → "unknown slide — create new?" (the naming moment
   for "honey bee leg").

Robustness notes:

- **Stage position is a strong prior.** The same physical slide usually sits at
  roughly the same motor coordinates; if only one slide's map covers the current
  stage position, confirmation is enough and the search is skipped.
- **Featureless regions** (blank glass, uniform specimen) give weak NCC. Optional
  phase-2: a cheap perceptual-hash *filter* to shortlist candidate slides, then
  `matchTemplate` for exact position + confidence.

---

## 5. Marker relocalization across maps (decision 3)

A marker is one logical annotation owned by the **slide**, anchored to the **image
the user was viewing when they drew the box** (the origin map, plus a saved patch
snapshot of that moment's webcam frame). The marker is **not duplicated** per map;
instead its position is *found* on each map and stored in `o_marker_map_position`.

The patch snapshot is the robust anchor. Finding a marker on a map is exactly what
`locate_map.py` already does for live frames (`cv2.matchTemplate`, downscaled) —
just with the marker's patch instead of a live frame. This works whether the new
map is bigger, smaller, or shifted, because a patch that isn't in the map simply
yields a low score.

When a **new map** is created for a slide (a re-scan, which may be a smaller
high-quality scan, a larger one, or a differently-shifted one), for each marker:

1. Match the marker's patch (or its origin-map region) against the new map:
   - **same-magnification re-scan:** template-match the patch directly;
   - **different magnification/settings:** multi-scale template match, or
     feature-match origin map ↔ new map (ORB/SIFT via OpenCV) and transform the
     anchor.
2. If a confident match is found **and** it lands inside the new map → write an
   `o_marker_map_position` row with `b_found = true` + coordinates.
3. If no confident match (the new map does not cover that region — e.g. a smaller
   high-quality re-scan — or the content changed) → write a row with
   `b_found = false`, and report it. The marker is still shown on the origin map.

Result: markers are displayed as slide-level annotations. On the currently
selected map, each marker is drawn at that map's stored position when `b_found`,
and skipped (or greyed) when not. Nothing is deleted or duplicated — the origin
map and its markers stay intact (decision 2 keeps the history).

"Found" only means "this map shows that region". A smaller map legitimately won't
contain every marker; those are reported, not dropped.

---

## 6. Mapping existing features onto the model

| existing feature | role in the new model |
|---|---|
| `stitch.py` (scan) → `stitched.png` | builds a slide's primary map (batch scan) |
| `locate_map.py` | slide auto-detect + "where am I" position |
| `focus_stack.py` | per-slide artifacts → `capture/focus_stack_*/` |
| backlash / steps-per-pixel | global hardware calibration — stays in `o_setting` |

---

## 7. Suggested build order

1. Add the five models to `constructors.module.js` (`a_o_model`) — no UI yet.
2. New folder plumbing: target-folder args for grow/scan/locate/focus-stack.
3. Slide library UI: list projects → slides, create/name a slide.
4. Save/load/resume: persist map + markers + last stage position, restore them.
5. Marker → `o_marker` migration (move off the global `a_o_marker` setting).
6. Slide auto-detection (tier 1 → tier 2 → create-new prompt).
7. Re-scan → new map → marker relocalization across maps (§5).

---

## 8. Open questions (non-blocking)

- Should `s_name` be unique per project, or allow duplicates with a warning?
- Import existing `scans/` folders *by reference* (keep files where they are) or
  physically *move* them into `projects/`?
- Is the `o_map_transform` provenance table worth adding now, or only when the
  relocalization (step 7) needs the whole-map homography path?
