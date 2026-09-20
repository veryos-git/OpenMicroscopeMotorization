# recording: time-lapse, video and still-image capture

design notes and implementation plan for recording features on this microscope.
this is a brainstorm + roadmap, not yet a spec — the open decisions at the end
change parts of it.

---

## 0. decisions locked (review round 1)

| question | answer | consequence |
| --- | --- | --- |
| camera location | **same machine as the server** | a server-side capture path is possible: the server can own `/dev/videoN` (ffmpeg or OpenCV) and keep writing frames with **no browser tab open**. this becomes the robustness mode for multi-day runs |
| primary need | **time-lapse over hours–days** | the engine is frame-based and drift-free; video modes are secondary |
| motors in v1 | **autofocus + multi-position early** | v1 is time-lapse **+ autofocus + point visiting**, not a single-field MVP |
| export | **PNG sequence + MP4** | OME-TIFF is out of v1 (but see below — it is nearly free) |

### what was verified in this environment

- `ffmpeg` / `ffprobe` 6.1.1 are installed.
- `./venv` already has `numpy 2.0.2`, `Pillow 12.3.0`, `OpenCV 5.0.0`,
  `scipy 1.18.1`, `tifffile 2026.4.11` — so server-side capture, focus scoring,
  image-based drift correction and OME-TIFF export need **no new dependencies**
  and fit the existing `cellpose_worker.py` worker pattern.
- the sandbox used for this review mounts a minimal `/dev`, so `/dev/video*`
  could not be confirmed from here. the app must probe it at runtime and show
  the result (see §9).
- the camera is currently owned by the browser (`getUserMedia`). a UVC device
  can only be streamed by one process, so **browser mode and server mode are
  mutually exclusive**; switching must release one before the other starts.

---

## 1. what a biologist actually records

the single most useful framing: **most biology is slow, and cameras are fast.**
a cell divides in 20–60 min, a wound closes in 12–24 h, an organoid grows over
days. recording 30 fps for a week produces terabytes to show something that a
frame every 2 minutes shows perfectly. so:

| process | timescale | right tool |
| --- | --- | --- |
| bacterial / yeast colony growth | 10 min – hours | time-lapse, 1 frame / 5–15 min, 12–72 h |
| wound healing / scratch assay | hours – days | time-lapse, 1 / 10 min, 24 h, multi-position |
| cell migration, chemotaxis | hours | time-lapse, 1 / 2–5 min, 12–24 h |
| embryo development (zebrafish, *C. elegans*) | hours – days | 4D: z-stack + time-lapse, 1 / 1–5 min, autofocus mandatory |
| organoid / spheroid growth | days | 4D, 1 / 30–60 min, multi-position |
| confluence / proliferation curve | days | time-lapse, 1 / 15–30 min, low mag, analysis downstream |
| ciliary beating, flagella, blood flow | ms – s | **video**, 30–200 fps, 1–30 s |
| vesicle / motor-protein transport | s – min | **kymograph** (line over time) or video |
| microfluidics / Flow[cell] events | variable | video bursts or event-triggered pre-roll |
| documentation, publication figures | once | **snapshot** with scale bar + metadata |
| 96-well screening | per well | one frame per well, circle/point visiting |

**answer to "a video record function over a long period of time?"** — almost
never as continuous video. the useful long-horizon modes are:

1. **time-lapse** (sparse frames) — the workhorse,
2. **scheduled video bursts** (e.g. 10 s at 20 fps every 10 min) — catches fast
   behaviour without 24/7 bitrate,
3. **event-triggered pre-roll** — keep the last N seconds in a ring buffer,
   save only when the interesting thing happens (button, or later: analysis).

continuous multi-hour video is only right for a genuinely continuous fast
process, and then the disk budget must be stated up front.

---

## 2. constraints this codebase imposes

| constraint | consequence |
| --- | --- |
| camera is reached through browser `getUserMedia`, and it is on this host | **browser mode** needs the page open but gives full UVC control; **server mode** can own `/dev/videoN` and record unattended but has weaker UVC control and must serve the live view. one UVC owner at a time |
| UVC camera, 8-bit MJPEG | no 16-bit/raw; "exposure lock" and frame-rate limits come from UVC controls |
| `f_o_capture__frame()` grabs one frame from `<video>` and applies flat-field | reuse it; it is the single capture path |
| `f_save_image()` POSTs to `/api/scan/save_image`, path-guarded to `<root>/scans/` | recordings need either a `scans/recording_*/` folder or a sibling endpoint |
| server is Deno, no build step, plain ES modules | new UI = new `o_component__*.js`; new server logic = `webserver_denojs.js` or an exposed function |
| ffmpeg 6.1.1 + ffprobe available on the host | mp4 encoding, remuxing, thumbnails; OME-TIFF needs Python (`tifffile`) |
| `./venv` has numpy / Pillow / OpenCV / scipy / tifffile | server capture, focus scoring, drift correction and TIFF need no new dependencies |
| motors x/y/z with position feedback, `moveSteps`, `runContinuous`, backlash, circle | the whole reason 4D + multi-position is feasible here |
| DB is key/value settings + `o_project` / `o_slide` / `o_map` / `o_marker` | recordings should hang off a slide; add `o_recording` |
| no `MediaRecorder`, no Wake Lock used yet | both are available in the browser and should be adopted |

---

## 3. design principles

1. **one capture path.** everything goes through `f_o_capture__frame()` so the
   flash, flat-field and future processing stay in one place.
2. **frames on disk, metadata in a manifest.** never one DB row per frame — a
   week-long run is tens of thousands of frames. the DB gets one row per
   *session*, the folder gets an append-only `frame.jsonl`.
3. **absolute-time scheduling.** the next capture is computed from the session
   start (`n_ts_ms__start + n_idx__frame * n_ms__interval`), so a slow frame or a
   throttled tab never accumulates drift and never silently skips.
4. **provable provenance.** every frame records when, where (x/y/z), focus score,
   exposure, and the calibration in force. a recording without its pixel size is
   scientifically worthless.
5. **lock the camera first.** auto-exposure and auto-white-balance must be off
   for a time-lapse, or the series is not comparable frame to frame.
6. **fail safe for the sample and the stage.** motors stop on any error; a run
   never starts without a free-disk check and a position sanity check.

---

## 4. recording modes

each is a configuration of one engine, not a separate feature.

| mode | `s_kind` | what it does | motors |
| --- | --- | --- | --- |
| time-lapse | `timelapse` | one frame every interval, single position | z autofocus optional |
| 4D stack | `stack` | z-stack at every timepoint | z sweep + autofocus |
| multi-position | `position` | visit N stored x/y positions per timepoint | x/y, z per position |
| mosaic series | `mosaic` | full scan grid per timepoint (reuse `o_component__scan`) | x/y + z |
| video | `video` | real-time `MediaRecorder` at 10–200 fps | none |
| video burst | `burst` | short video every N minutes | none |
| pre-roll | `preroll` | ring buffer; save last N s on trigger | none |
| kymograph | `kymograph` | extract one line/column per interval, stack to an image | none (or x/y drift lock) |
| snapshot | `snapshot` | single frame + annotation + scale bar into the slide library | none |

priority: `timelapse` → `stack` → `position` → `video`/`burst` → the rest.

---

## 5. capture engine

a tiny state machine, one timer, no nested loops:

```
start
  f_preflight          free disk, camera present, exposure locked, positions in range
  f_prepare_folder     server: recordings/<s_name>/  + manifest.json
  loop
    n_ts_ms__target = n_ts_ms__start + n_idx__frame * n_ms__interval
    wait until target (absolute, drift-free)
    for each position (multi-position/stack/mosaic)
      move (if any) -> settle n_ms__settle -> optional autofocus -> capture
      write frame -> append frame.jsonl -> update progress
    n_idx__frame++
  until frame count / duration / stop
  finish               mark done, optional encode mp4, DB row update
```

**stop / pause / resume.** a `b_stop_requested` flag checked at the top of each
iteration (the scan panel already does this). pause = stop a *gate* variable, not
a torn-down loop. **resume** reads `frame.jsonl` to find the last complete index
and continues — this is what makes a 3-day run survivable.

**missed frames.** if the host sleeps, on wake the scheduler sees it is behind.
policy per run: `skip` (default, log a gap) or `catchup` (burst the missing
frames — only sane for fast processes).

**frame validation.** each capture is checked: not black, not blown out, focus
score sane, and not byte-identical to the previous frame (detects a frozen
camera — the classic 2 a.m. failure). failures are logged as events and
optionally retried once.

---

## 6. video: three implementations, one panel

**A. `MediaRecorder` on the camera stream** (short, high-fps events)
- `new MediaRecorder(o_stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond })`
- `start(5000)` timeslices → append each chunk to `video.webm` on the server →
  single continuous file; optional ffmpeg remux to `.mp4`.
- pros: real-time, hardware-encoded, survives UI jank.
- cons: page must stay open; records the **raw** frames, not the WebGL
  filter/flat-field view.

**B. canvas capture of the processed view** (what you see is what you get)
- render the visible pipeline (flat-field + filter) into a 2D canvas or set
  `preserveDrawingBuffer: true` on the filter canvas, then
  `el_canvas.captureStream(n_fps)` → `MediaRecorder`.
- needed if the recording must match the on-screen processed image.
- cost: a second render per frame; pick one deliberately and label it.

**C. frame sequence → ffmpeg** (default for anything long)
- identical to time-lapse; the "video" is just playback of the PNG series with
  `-framerate N`. lossless masters, exact frame timing, analysis-friendly.
- recommended default for time-lapse and bursts; A/B are for genuine real-time.

**pre-roll** = A with a ring buffer of timeslice chunks; on trigger, write the
buffered chunks plus continue for `n_sec__post`.

**high-speed reality check.** browser `MediaRecorder` and UVC often top out
around 30–60 fps at 1080p, more at 640×480 (MJPEG). the panel should *measure*
achievable fps before promising 200 fps, and warn when the requested rate is not
sustainable.

---

## 7. what the motors are for

this is the part that makes the plan more than "record a video".

1. **autofocus between timepoints** — run the existing focus search (or a short
   hill-climb around the last z) before each capture. thermal drift over days is
   the number-one killer of long runs. log `n_score__focus` and `n_step__z` per
   frame.
2. **z-stack per timepoint (4D)** — reuse the focus-stack sweep; store
   `pos_XX/z_YYYY.png`. enables 3D segmentation per timepoint.
3. **multi-position point visiting** — store a list of x/y/z positions (click
   "add position" after jogging, or pick up `o_marker` rows from the map) and
   visit all of them each interval. this is how you image 4 wells, or 20
   individual cells, unattended.
4. **mosaic over time (4D large area)** — wrap the existing scan grid in the
   time loop. already 90 % built (`o_component__scan.js` + autostitch).
5. **revisit exact fields** — positions are saved in step units, so a run can be
   reproduced or resumed on the same cells.
6. **image-based stage lock / re-centering** — cross-correlate each new frame
   with the first and nudge x/y to cancel sample drift (the locate_map machinery
   in reverse). optional, phase 5.
7. **z-focus lock** — periodic small z-sweep to keep the focal plane on a
   reference feature; cheaper than full autofocus every frame.
8. **background / flat-field capture** — move to an empty area, capture a
   defocused reference, move back. automates what flat-field calibration does by
   hand.
9. **one frame per well (screening)** — visit a plate grid, one image each; the
   existing `circle` command can orbit a well or centre a sample.
10. **pre-run backlash + calibration** — measure backlash and steps/px before a
    long run and refuse to start if the calibration is stale.

**safety rules** (non-negotiable once motors move unattended):
- never start without a target-position range check and a `stopAll` on any error;
- always settle `n_ms__settle` after a move before exposure (vibration blur);
- keep the z approach direction monotonic within a stack (backlash, already
  handled) — do the same for repeated z moves in autofocus;
- cap total travel per run and abort if a position command times out;
- motor movement is paused while the shutter-equivalent (capture) is open.

---

## 8. data model and storage

### new DB rows (proposed)

`o_recording`
```
n_id, n_o_project_n_id, n_o_slide_n_id
s_name, s_kind, s_status            # running | paused | done | stopped | interrupted | error
n_sec__interval, n_ms__settle
n_its__frame, n_its__frame__done
b_autofocus, n_its__autofocus
n_scl_x__roi, n_scl_y__roi          # optional crop, in camera px (reuse the zoom ROI)
n_um__per_px, n_scl_x, n_scl_y      # calibration + frame size actually used
s_path_folder, s_path_media
o_camera__setting                    # snapshot of exposure/wb/gain at start
n_ts_ms__start, n_ts_ms__end, s_note
```

`o_recording_position`
```
n_id, n_o_recording_n_id, s_label
n_x__stage, n_y__stage, n_z__stage, n_ts_ms__z
```

`o_recording_event` (optional, for provenance)
```
n_id, n_o_recording_n_id, s_kind, s_message, n_its__frame, n_ts_ms
```

naming follows the repo convention: `n_o_recording_n_id` (no plural table names,
no `is_` prefixes, `n_` / `s_` / `b_` prefixes).

### storage layout

```
recordings/
  rec_2026-09-20_193000/
    manifest.json          # config, provenance, positions, camera snapshot
    frame.jsonl            # one line per frame: idx, ts, pos, z, focus, exposure, file
    pos_00/
      t_000001.png         # time-lapse / stack frame
      t_000002.png
    pos_01/ ...
    media/
      timelapse.mp4
    thumb/
      t_000001.jpg
```

- `manifest.json` is written once at start, then only status/end fields are
  rewritten; `frame.jsonl` is append-only and is the source of truth for resume.
- PNG by default (lossless, analysis-friendly). JPEG optional for speed/size.
- thumbnails generated server-side with ffmpeg for the session library.

### data volume (so nobody is surprised)

at 1920×1080, PNG ≈ 2–4 MB, JPEG q90 ≈ 0.3–0.6 MB:

| run | frames | PNG | JPEG |
| --- | --- | --- | --- |
| 24 h @ 1/min | 1 440 | 3–6 GB | 0.5–0.9 GB |
| 24 h @ 1/5 min | 288 | 0.6–1.2 GB | 0.1–0.2 GB |
| 72 h @ 1/10 min | 432 | 0.9–1.7 GB | 0.15–0.25 GB |
| 7 d @ 1/30 min | 336 | 0.7–1.3 GB | 0.1–0.2 GB |
| video, 1080p, 30 fps, 1 min | — | — | ~50–150 MB (h264) |

the panel must show this estimate **before** start, plus free disk, and stop
gracefully below a reserve (e.g. 2 GB).

---

## 9. server API

reuse the existing mechanisms: WebSocket messages for actions, exposed
functions for DB CRUD, HTTP POST for frame bytes.

| endpoint / message | purpose |
| --- | --- |
| WS `recording_create_folder` | create `recordings/<s_name>/` (+ `pos_XX/`, `media/`, `thumb/`), return the path |
| WS `recording_write_manifest` | write/replace `manifest.json` |
| WS `recording_append_frame` | append one line to `frame.jsonl` |
| POST `/api/recording/save_frame` | frame bytes (mirrors `/api/scan/save_image`, guarded to `recordings/`) |
| WS `recording_encode` | ffmpeg → `media/*.mp4`; streams progress back |
| WS `recording_list` / `recording_delete` | session library |
| WS `recording_frame_status` | disk free, frame count, last ts — used by the live panel |

implementation notes:
- the guard in `save_image` (`s_path_folder.startsWith(scans/)`) is copied with
  `recordings/` — same path-safety test, no `..`, no separators in filename.
- `recording_encode`: `ffmpeg -framerate N -i pos_00/t_%06d.png -c:v libx264
  -pix_fmt yuv420p -crf 18 -movflags +faststart out.mp4`; `-framerate` is the
  playback rate, decoupled from the capture interval (a 1/10 min run plays at
  10 fps → 1 h of biology in 0.7 s).
- on server start, any session with `s_status = running` and no finish event is
  marked `interrupted` — so a crash is visible, not silent.
- disk guard: `Deno.stat`/`statfs` before start and every N frames.

---

## 10. UI

**`Record` panel** (`o_component__record.js`), same overlay-panel pattern:

```
mode        [ timelapse | 4D stack | multi-position | video | burst ]   (tabs)
interval    [ 2 ] [ min ]        duration [ 24 ] [ h ]   → 720 frames
positions   ( ) current   ( ) list  [+ add current]   [go to]
focus       [x] autofocus every [10] frames   settle [400] ms
crop        [x] use zoom ROI   (400 × 300 px)      exposure [locked ✓]
--------------------------------------------------------------
est. 2.9 GB   free 412 GB        frames 143/720    next in 00:41
[ Start ]  [ Pause ]  [ Stop ]   ▓▓▓▓▓▓░░░░░░  19 %
```

**`Sessions` panel** (or a section of the slide library): list recordings for the
slide, thumbnail strip, play the mp4, "export mp4 / TIFF stack", "open folder",
"delete". reuses the slide-library table style.

**quality-of-life**
- a global "recording in progress" badge in the toolbar with a stop button —
  a run must be visible from anywhere, and stoppable in one click.
- camera is auto-locked (exposure/WB/gain) when a recording starts, with a
  warning if the camera cannot lock;
- optional ROI reuse of the digital-zoom selection (record only what you zoom);
- optional scale bar burned into the snapshot export (not the raw frames).

---

## 11. formats & exports

| need | format | how |
| --- | --- | --- |
| analysis (Fiji/napari) | PNG sequence + `manifest.json` | already the storage format |
| sharing / figures | MP4 H.264 | ffmpeg from the PNGs, or remux the webm |
| 3D/4D viewers | OME-TIFF | python `tifffile` worker (same pattern as `cellpose_worker.py`), phase 5 |
| quick look | WebM | MediaRecorder output, plays in the browser |
| documentation shot | PNG + scale bar + metadata | snapshot mode |

deliberately **not** inventing a new container: folders + JSON + ffmpeg cover
every export target.

---

## 12. long-run reliability (the part that decides success)

| failure | mitigation |
| --- | --- |
| OS sleep / screen off | Screen Wake Lock API; re-acquire on `visibilitychange`; document `systemd-inhibit` / `caffeinate` for the host |
| background tab timer throttling | timers in a Web Worker, and absolute-time scheduling so lateness never becomes drift |
| camera silently freezes | per-frame hash comparison; log + optional auto-restart of the stream |
| browser/tab closed | manifest + `frame.jsonl` allow **resume**; app offers it on load |
| server restart | sessions left `running` are marked `interrupted` on boot |
| disk full | preflight estimate, reserve threshold, graceful stop with a clear event |
| thermal focus drift | autofocus cadence + focus-score log; drift is visible in the data |
| exposure drift | lock UVC controls; store the values in the manifest |
| clock changes / NTP | store monotonic elapsed ms **and** wall-clock ts per frame |
| power loss | append-only jsonl + `fsync`-ish flush cadence; frames already written are safe |
| sample photodamage | interval + exposure budget shown in the panel; warn on aggressive settings |

**the honest limitation:** the camera is on this host, so the browser only owns
it by convention. a truly unattended 7-day run has two options: (a) a dedicated
kiosk browser with Wake Lock + auto-resume, or (b) the server owning
`/dev/videoN` (phase 2). v1 ships (a); (b) is the multi-day unlock and its one
real cost is that UVC exposure/WB control moves from the browser to OpenCV
properties or `v4l2-ctl`.

---

## 13. v1 specification — time-lapse + autofocus + multi-position

the first release, sized to the locked decisions: one engine that runs unattended
for hours or days at one or many fields, keeping focus.

### v1 engine

```
preflight
  probe /dev/video* and warn if the browser holds the camera (server mode)
  camera present + exposure/WB/gain locked (browser mode)
  positions inside travel limits, z reference sane
  free disk above reserve, delete policy known
  calibration fresh (n_um__per_px, backlash) else refuse or warn

start
  server: recordings/<s_name>/{manifest.json, frame.jsonl, pos_XX/, media/, thumb/}
  DB: create o_recording (running) + o_recording_position rows
  anchor n_ts_ms__start = server now

loop while frames < target and not stopped
  n_ts_ms__target = n_ts_ms__start + n_idx__frame * n_ms__interval
  if now < target: sleep (worker timer)         # absolute time -> no drift
  if now > target + n_ms__interval: log a gap   # host slept / tab throttled
  for each o_position
     if moved: move x/y (same approach direction) -> wait n_ms__settle
     if autofocus due: focus search -> store n_step__z, n_score__focus
     o_cap = f_o_capture__frame({ b_flat: true })
     validate frame (black / blown / identical to previous)
     f_save_image(o_cap.o_blob, s_path_folder + pos_XX, t_%06d.png)
     append frame.jsonl { idx, ts_ms, pos, x, y, z, focus, exposure, file }
  n_idx__frame++
  every N frames: disk guard + status broadcast

finish
  write manifest end fields, mark DB done, optional ffmpeg -> media/*.mp4
```

### v1 configuration

| field | default | note |
| --- | --- | --- |
| `s_kind` | `timelapse` | `stack` comes in phase 3 |
| `n_sec__interval` | 600 | 10 min |
| `n_its__frame` | 144 | 24 h at 10 min |
| `b_position__all` | false | visit every stored position each timepoint |
| `b_autofocus` | true | |
| `n_its__autofocus` | 1 | autofocus every N timepoints |
| `n_ms__settle` | 400 | after any move, before exposure |
| `b_roi` + `n_x__roi`/`n_y__roi`/`n_scl_x__roi`/`n_scl_y__roi` | off | reuse the digital-zoom selection |
| `s_format` | `png` | `jpg` optional for size |
| `b_mp4` | true | encode on finish |
| `n_fps__mp4` | 10 | playback rate, independent of capture interval |

### v1 accept criteria

1. a 30 min run at 1 frame / 10 s produces 180 files, a valid `manifest.json` and
   a 180-line `frame.jsonl`, max lateness < 200 ms, no missing index.
2. every frame line carries ts, position, stage x/y/z, focus score and file.
3. autofocus before each timepoint keeps a deliberately drifting z inside the
   depth of field (focus score within 20 % of the best sweep score).
4. a 4-position run visits all four positions each timepoint, in order, every time.
5. killing the browser and reopening offers "resume"; the run continues at the
   next index without overwriting a frame.
6. the disk guard stops the run cleanly below the reserve and writes an event.
7. the encoded mp4 plays with the correct frame order and duration.

---

## 14. roadmap after v1

**phase 2 — unattended mode (the multi-day unlock)**
- server-side camera: a Python worker (`recording_worker.py`, same pattern as
  `cellpose_worker.py`) owns `/dev/videoN` via OpenCV/ffmpeg, grabs frames on
  demand and serves the live preview as JPEG; the browser releases the camera.
- move focus scoring and drift correction into that worker (numpy/OpenCV already
  present) so focus survives a closed tab.
- *open:* the ESP link is held by the browser today, so full unattended
  autofocus needs either the browser alive as the motor driver (frames continue,
  focus pauses) or a server-side ESP client. decide in phase 2, not now.
- *accept:* close the browser mid-run; frames keep arriving; reopening continues
  the session.
**phase 3 — 4D stacks**
- z-stack per timepoint reusing the focus-stack sweep; per-position z memory.
- *accept:* a 3-position × 5-z × 10-timepoint run is written, encoded and browsable.
**phase 4 — video**
- `MediaRecorder` record / burst / pre-roll; raw vs processed-view choice;
  measured sustainable fps; remux to mp4.
- *accept:* 60 s at 30 fps plays with no dropped-second gaps; pre-roll saves
  exactly the preceding N seconds.
**phase 5 — library, exports, analysis**
- sessions panel with thumbnails/playback/delete; OME-TIFF via `tifffile`;
  cellpose-per-frame; kymograph; image-based x/y drift lock (OpenCV phase
  correlation).
- *accept:* from the library, export TIFF, play mp4, run cellpose on every 10th frame.
**phase 6 — hardening**
- Wake Lock, web-worker timers, auto-resume on load, frozen-stream watchdog,
  alerting, retention/quota policy.

---

## 15. remaining open decisions

1. **default long-run mode:** browser (full UVC control, page must stay open) vs
   server (unattended, weaker UVC control). recommendation: browser as the v1
   default, server mode as the opt-in "unattended" choice in phase 2 once the
   preview path is proven.
2. **UVC control in server mode:** with the server owning the camera,
   exposure/WB must go through OpenCV properties or `v4l2-ctl` (not installed).
   is a one-time lock on the camera acceptable, or is per-run control required?
3. **illumination/filters:** anything beyond transmitted light switched in
   hardware? decides whether channels and phototoxicity budgeting are real.
4. **environmental control:** incubator / temperature / CO2 stage to log or control?
5. **retention:** what gets deleted, by whom, and is there a quota per project?
6. **unattended autofocus:** may the server talk to the ESP directly over WiFi,
   or must the browser stay the only motor driver?

---

## 16. risks

- **scope:** "record video" hides three different products. v1 is time-lapse +
  autofocus + multi-position; shipping that well beats shipping every mode
  half-working.
- **browser dependence (v1):** the page must stay open, so v1 leans on Wake Lock,
  worker timers and resume. phase 2 exists because this is the main technical risk.
- **UVC control in server mode:** the server has no `v4l2-ctl`; exposure/WB lock
  must be proven through OpenCV before unattended mode is trusted.
- **disk exhaustion** during a multi-day run is a real, avoidable failure.
- **focus drift** will make or break day-long runs; autofocus is not optional.
- **motor safety** once unattended: every mode that moves the stage needs the
  hard stop-all path and travel limits before it ships.
- **data model churn:** recordings should be attached to a slide from the start,
  or every session becomes an orphan later.

---

## 17. implementation status

shipped and verified end to end (headless Chrome + the real server, fake camera):

| piece | where | verified |
| --- | --- | --- |
| `o_recording` / `o_recording_position` / `o_recording_event` models | `webserved_dir/constructors.module.js` | tables created, rows written |
| recordings storage + ffmpeg encode + OME-TIFF + probe | `recording_functions.module.js`, `recording_worker.py` | 3-frame run → mp4 (h264 1080p) + `pos_00.ome.tif` (TYXS, 0.45 µm/px, TimeIncrement) |
| time-lapse engine (absolute schedule, validation, disk guard, wake lock, resume) | `webserved_dir/o_recording.module.js` | 20–36 ms timing accuracy over targets, gaps logged, resume reads `frame.jsonl` |
| autofocus + multi-position | same | wired to `f_o_focus__fast` / `f_move_to__position`; **not run on hardware** (no stage in this environment), preflight blocks clearly when the stage is absent |
| `Record` panel, `Video` panel, sessions library | `o_component__record.js`, `o_component__video.js`, `o_component__recording_library.js` | panel renders, 7 sessions listed, mp4 playback, TIFF button |
| video record / burst / pre-roll | `webserved_dir/o_video.module.js` | 4 s vp9 webm → 4 s h264 mp4; pre-roll saved 3 s buffer + 1 s tail; burst produced and encoded a clip |
| roi crop of a recording | `webserved_dir/o_capture.module.js` | crop path exercised, frame size follows the zoom region |

deferred (explicitly not built yet):

- **server-side capture** (phase 2): only the `/dev/video*` probe exists. the
  server owning the camera needs the browser to release it and a server-served
  preview — a deliberate architectural step, not a small patch.
- **4D z-stacks per timepoint** (phase 3): the focus motor is used for autofocus
  only; a z sweep per timepoint is the next motor feature.
- **analysis hooks** (phase 5): kymograph mode, cellpose-per-frame and the
  image-based x/y drift lock are not implemented.

operational note: the new server modules and tables load only after the app
server is restarted (`deno task server`). `recordings/` is gitignored.
