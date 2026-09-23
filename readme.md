
# installation 

a glossary mapping the project's terms to standard imaging / microscopy /
motion-control terminology lives in [`glossary.md`](./glossary.md).

## install deno (js)
### mac os / linux 
curl -fsSL https://deno.land/install.sh | sh
### windows
irm https://deno.land/install.ps1 | iex


## run `deno task start`
this installs every missing dependency and then starts the web server on http://localhost:8000

installed on first run (skipped afterwards, so `deno task start` stays fast):
- `arduino-cli` into `~/.local/bin` + the `esp32:esp32` board package + the `ESP Async WebServer` / `Async TCP` / `ArduinoJson` libraries — these compile the ESP32 firmware on the server
  (`Async TCP` provides `AsyncTCP.h` and must be installed explicitly — arduino-cli does not pull it in as a dependency when run non-interactively)
- `./venv` with `numpy` + `opencv-python` — used by `stitch.py` (the tile scan mosaic) and `stich_image_in_folder.py`
- `torch` (cpu build) + `lightglue` + `kornia` — used by `autostitch.py` and by `stitch.py --matcher loftr`
- `./venv_cellpose` with `torch` + `cellpose` — used by `cellpose_worker.py` for the `Cell pose` panel

the installer also runs `stitch.py --help` inside the venv, so a broken numpy/opencv
install is reported before a scan is started rather than after it.

### other tasks
| task | what it does |
| --- | --- |
| `deno task start` | install what is missing, then start the server |
| `deno task doctor` | report what is installed / missing, install nothing |
| `deno task verify` | compile the firmware to prove every arduino dependency is present |
| `deno task install` | install only, do not start the server |
| `deno task server` | start the server without the dependency check |
| `deno task flash` | the guided flashing wizard (`startup.js`) |

`deno task install --skip-stitch-ai` leaves out torch/lightglue/kornia if you do not need
autostitch or the LoFTR rescue matcher. `stitch.py` itself only needs numpy + opencv.

`deno task install --skip-cellpose` leaves out the separate `./venv_cellpose` if you do
not need the `Cell pose` panel. `--cpu` installs the small CPU-only torch build instead
of the ~3 GB CUDA one.

## hardware setup and browser flashing

Open the Setup overlay from the toolbar to configure motor axes (including the optional Z/focus motor),
GPIO pins, backlash compensation, WiFi, and the controller connection. These
assignments are shared by all tools in Control. Each physical motor appears once,
with its axis assignment, live movement/direction/position, move and stop buttons,
and expandable wiring/backlash settings. Keyboard, mouse, and gamepad settings
are below the cards; the separate Jog and Motors windows have been removed. Firmware flashing is included
in the same overlay; there is no separate Setup or flashing page. Pin and WiFi changes require
flashing; axis assignments apply immediately.

For flashing, use desktop Chrome or Edge over HTTPS or `http://localhost:8000`.
Plug the ESP32-S3 into the **computer running the browser**, then click
**Generate Firmware & Flash ESP32** and select its USB port. WiFi credentials
are optional when using USB control.

The server compiles the firmware; the browser uploads it with Web Serial,
verifies the written images, and reconnects USB control after reset. The firmware
accepts commands on both native USB and the USB-to-UART connector. The app waits
for a motor-status reply before reporting a USB control connection. An existing
USB control connection is paused automatically. If the port changes after
reset, use **Connect via USB** to select it again. If bootloader connection
fails, hold BOOT and press RESET, then retry flashing.

The browser flasher is bundled locally in `webserved_dir/vendor`; it does not
need a CDN. `deno task flash` remains the separate command-line wizard and
uses a USB device attached to the machine running that command.

## tile scan -> mosaic
the scan panel drives the stage over a grid, saves every tile as
`tile_r<row>_c<col>.png` into `scans/scan_<date>_<time>/` and then hands the whole
folder to `stitch.py`. it infers the grid from those file names, registers the
neighbours by FFT cross correlation, solves all tile positions in one robust
least-squares pass and blends the mosaic into `stitched.png` (plus
`stitched_preview.jpg` for large mosaics, `positions.json` and `report.json`).
its progress is streamed into the scan panel while it runs.

## backlash calibration
In **Hardware Setup**, each motor card has a **Calibrate** button that measures
that physical motor’s backlash from the live image. Progress and **Stop calibration**
stay on the card. Expand **Advanced calibration settings & results** for probe
steps, limits, settling, repeats, compensation mode, plots, and results. Settings
are saved independently for each motor. Focus motors default to the sharpness
signal; stage motors use image shift. The calibration checklist and optical
settings are also available inside Hardware Setup. The calibration drives
well past the slack in one direction (preload), takes a reference frame, then
steps back in small probes and measures how far the image moved against that
reference. while the gears are loose the image stands still; once they engage it
moves proportionally to the steps.

instead of calling the first frame that "looks different" the backlash, the whole
curve is fitted as `y(s) = c + k * max(0, s - b)` and `b` is the answer. that uses
every sample, lands between two probe positions and does not inherit the noise
floor of a threshold. `1/k` falls out as the **steps per pixel** of that axis,
which is the number the tile scan needs for its step size.

image displacement is read from 1-D projections (column and row sums, high-passed
against the illumination gradient) correlated with sub-pixel interpolation — no
FFT needed, because the stage only translates. the displacements are projected
onto the direction the stage actually moved, so a camera that is not mounted
square does not matter and the noise in the flat part stays centred on zero.

a drive with any give does not engage in one go: there is a dead zone where
nothing moves, then a compliant take-up (belt stretch, printed teeth deflecting)
where the stage creeps, then one-to-one tracking. the fitted knee is the
back-extrapolation of the straight part and therefore lands at
`dead zone + half the take-up`, which can be twice the dead zone. compensating
that much drives the stage during the compensation burst — that is the jump you
see on a reversal. so the panel reports **both**:

| value | meaning | use it for |
| --- | --- | --- |
| onset | where the image first moves detectably | no jump on reversals (default) |
| full take-up | where the stage tracks the steps one to one | best position after a reversal |

both directions are measured, repeated, and reported with their spread. the mean
of the selected column is written into the motor's backlash setting automatically
as soon as the run ends (a `re-apply` button repeats it by hand). while a run is going, any backlash
already configured for that motor is switched off on the ESP32 — the firmware
would otherwise compensate exactly the slack the run is trying to see — and it is
restored if nothing usable comes out.

on the firmware side the compensation tracks where the drive currently sits
inside its play, so a reversal that follows a short move (or another reversal)
only inserts what is actually left instead of the full value. compensation steps
turn the motor but not the stage, so they are no longer counted into the reported
position. **these live in `stepper_websocket.ino`, so they need a re-flash**
(`deno task flash`).

for the focus motor pick the sharpness signal instead of image shift, and park the
stage clearly off focus — there sharpness still changes monotonically with the
movement, which image shift never does for a z axis.

## auto focus
the `Focus` panel searches the sharpest position of the focus motor. it scores
every frame with a sharpness metric (tenengrad = mean squared sobel gradient, or
the variance of the laplacian), both divided by the mean luminance squared so a
brighter frame does not read as a sharper one. only the center of the image is
measured.

the search is a coarse sweep in one direction, a fine sweep around the peak, and
a parabola through the best sample and its two neighbours to land between two
sampled positions. every position is approached from the same side so the gear
backlash is identical for every sample and cannot fake a peak.

the panel also works as a plain focus meter: a live sharpness bar for focusing by
hand, and a plot of the last sweep. use manual camera exposure — an auto exposure
that reacts to the defocus distorts the measurement.

## focus on every tile
the scan panel can find the focus before each image (`Find focus before every
image`). it does not repeat the panel's full sweep — between neighbouring tiles
the focus barely moves, so it starts from where the previous tile ended, walks
uphill only as far as it must and finishes with a parabola through the best three
samples:

    measure here -> probe one step -> walk while it improves -> parabola -> verify

that is 3-8 measurements instead of the 20 positions (at 2 frames each) the panel
sweeps, and on a gently tilted slide it usually settles after 4. the search always
ends on the position it decided on, not where the last probe left the motor.

## digital zoom (`Zoom` panel)
the `Zoom` button opens a floating magnifier window. hold `Ctrl` and drag a box on
the live image and the region inside it is shown magnified in the window — a
cheap way to read the pixels of a small detail without moving the stage or
changing the objective.

- the picked region is stored in camera pixels, so the frame stays on the same
  spot when the browser window is resized.
- the wheel over the preview window zooms in and out around the centre of the
  region. with nothing picked yet the first scroll-in starts from the centre of
  the frame.
- drag inside the preview window to pan: the magnified picture follows the
  pointer, so the picked region slides across the main image.
- drag the window's corner (or use the `Preview` slider) to resize it. the
  picture keeps the region's aspect ratio, so it is never stretched. there is no
  fixed size cap — the preview grows until it fills the browser window.
- `Resample` picks `interpolated` (smooth) or `pixelated` (nearest neighbour —
  shows the real sensor pixels at a strong zoom).
- move the window by its header. `Clear` drops the region, `Select area` arms a
  plain drag for when no keyboard is at hand, `Esc` cancels while picking.

while picking is armed the drag layer only then takes the pointer, so a plain
drag on the image still jogs the stage; `Ctrl` + drag never jogs and does not
fight `Mouse Jog`.

## recording: time-lapse and video (`Record` / `Video` panels)
two recording engines share one storage layout under `recordings/<session>/`
(`manifest.json`, append-only `frame.jsonl`, `pos_XX/t_000001.png`, `media/`,
`thumb/`). see `recording_design.md` for the reasoning.

**`Record` — time-lapse, built for hours and days**
- interval plus frame count, with 1 h / 6 h / 12 h / 24 h / 3 d shortcuts
  (default 1 frame every 10 min for 24 h);
- **autofocus between timepoints** using the existing focus search, with the
  focus score stored next to every frame, so thermal drift is visible in the data;
- **multi-position**: add the current stage position to a list and every
  timepoint visits all of them (settle delay after a move, coordinates recorded
  per frame);
- optional **crop to the digital-zoom region** — record only what you zoomed;
- the camera is **locked** (manual exposure / white balance) when a run starts;
- frames are numbered PNGs (or jpg), timing is scheduled against absolute time so
  a slow frame never accumulates drift, and a frozen / black / blown frame is
  logged and retried once;
- on finish an **mp4 is encoded with ffmpeg** at a playback rate independent of
  the capture interval;
- a **disk reserve** stops the run cleanly before the volume fills up;
- **resume**: `frame.jsonl` is the truth, so a browser reload or a server restart
  leaves a session that can be continued from the next frame.

**`Video` — real time, for fast events**
- **record** one clip (raw camera, or the processed flat-field / filter view);
- **burst**: a short clip every N minutes until stopped;
- **pre-roll**: keep the last N seconds in a ring buffer and save them only when
  the interesting thing happens, plus a configurable tail;
- timeslices are appended to the server as they arrive, so a long recording never
  sits in browser memory; mp4 + thumbnail use the same ffmpeg path.

**`sessions…` library** — every recording: thumbnail, playback, `export mp4`,
`export TIFF` (OME-TIFF with physical pixel size and time increment, opens in
Fiji / napari), `resume` for interrupted runs, `delete`.

the camera belongs to the browser, so the page must stay open for the length of a
run; a Screen Wake Lock is requested while recording, and gaps caused by a hidden
tab or a sleeping host are recorded as events instead of silently losing time.
the `Record` panel also probes the server for `/dev/video*`, the prerequisite for
a future unattended server-side capture mode.

## cell segmentation with cellpose (`Cell pose` panel)
the `Cell pose` button opens a panel that segments the live camera image with
[Cellpose](https://github.com/MouseLand/cellpose) and draws the found cells
**straight onto the live image** as a coloured mask — the mask is an overlay on
the main window, not a second preview inside the panel. two modes:

| mode | what it does |
| --- | --- |
| `Single image` | grab one frame, segment it, stop. the safe default on a CPU |
| `Loop` | capture → segment → pause → repeat until you press stop |

the mask stays on the image after a single run, so you can compare it with the
next one; **Remove mask** takes it off (during a loop it also stops the loop).
the opacity slider blends it over the video, and the overlay ignores mouse
events, so mouse jog keeps working underneath.

**the stage has to stand still.** `Capture & segment` is disabled while any motor
is turning, and the mask is taken off the image the moment a motor starts again —
a frame grabbed mid-move is smeared, and a mask computed from it points at cells
that are no longer under the crosshair. a running `Loop` does not fail on motion:
it pauses and picks up again once the stage is still. this covers every source of
motion (jog keys, mouse jog, gamepad, macro, autofocus), because it watches the
motor state the firmware reports rather than the input device.

the mask is cleared whenever a motor starts — even while a `Loop` is paused
between frames — so you see the mask go the moment you touch the jog keys, and
the next paused frame draws a fresh one. clearing it during a seek inside one
inference cost nothing: the mask is already being redrawn.

the model runs on the **server**, not in the browser (`cellpose_worker.py`, driven
by `cellpose_functions.module.js`). the worker is started once and kept alive, so
the weights are loaded a single time instead of once per frame. the browser only
grabs frames and uploads them (`POST /api/cellpose/frame`), which also means the
flat-field correction is applied to what the model sees.

`Inference size` is the long side the frame is scaled to before the network sees
it (the mask is scaled back up to the full frame afterwards). **this is the
speed/accuracy dial.** `cpsam` (Cellpose-SAM, the default) and `cyto3` (the
smaller Cellpose 3 cytoplasm model) are both available. measured here on a
32-core CPU with no GPU, one 1920×1080 blood-smear frame, through the full worker
path:

| model | inference size | time per frame | cells found |
| --- | --- | --- | --- |
| `cyto3` | 384 px | ~51 s | ~950 |
| `cpsam` | 384 px | ~50 s | ~910 |
| `cyto3` | 512 px | ~150 s | ~1110 |
| `cpsam` | 512 px | ~155 s | ~1100 |
| `cpsam` | 1024 px | ~380 s | ~1120 |

two things worth knowing before you pick a model or a size:

- **there is no fast setting on a CPU.** even a 144 px inference costs ~50 s,
  because the cost is dominated by the network's fixed work, not by the pixel
  count; below ~300 px the cells are simply too small to resolve and the mask
  comes back empty. budget roughly a minute per frame at 384 px, several minutes
  at 512 px. **these numbers are the no-GPU case** — see below.
- **`cyto3` is not the shortcut it sounds like** *in the Cellpose 4 venv this
  project installs*: it is segmented through the same pipeline and takes about
  as long as `cpsam` (it does find slightly more of the tightly packed cells at
  512 px). pick it for the smaller 25 MB weight download and its cytoplasm
  training, not for speed.

### GPU

`deno task install` detects an NVIDIA card and installs a **CUDA build of
torch**; on a GPU a frame is 1–2 s instead of 50–150 s and the `Loop` mode becomes
genuinely live. the panel shows the device it is running on next to the frame
stats (`CUDA` / `CPU`), and the worker logs it when the model loads.

if the panel says `CPU` on a machine that has a card, the usual cause is that the
process cannot open `/dev/nvidia*` — `nvidia-smi` and `torch.cuda.is_available()`
have to be run **by the same process that runs the server**. check inside that
environment with:

```sh
venv_cellpose/bin/python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"
```

a CUDA build degrades to the CPU on its own, so an unreadable device is not an
error — it is just slow. use `--cpu` to install the smaller CPU-only build when
you know the machine will never have a card.

the weights are downloaded on first use into `weights/cellpose/` — ~1.2 GB for
`cpsam`, ~25 MB for `cyto3` — and every frame with its `.json` numbers (cell
count, areas, inference seconds) is written into
`scans/cellpose_<date>_<time>/`.

**licence note:** the Cellpose *code* is BSD-3-Clause, but every pretrained model
is trained on **CC-BY-NC** data and is therefore **non-commercial use only** (see
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md)).

## live "grow" stitching — not in this release
earlier builds could grow a mosaic in real time while you drive the stage by
hand. that used the `image_stitching2` python stitcher (`IncrementalStitcher`,
SuperPoint + SuperGlue). SuperGlue is published by Magic Leap under a
non-commercial licence that forbids redistribution, so that code is **not** part
of this public release and the `Grow` and `Marker` panels are absent. use the
`Scan` panel for a full-slide mosaic (the FFT-based `stitch.py`) or `AStitch`
for the LightGlue based matcher.

## serial port permission
the ESP32 shows up as `/dev/ttyACM0` (CH343 chip) or `/dev/ttyUSB0` (CH340 chip).
if flashing keeps asking for a sudo password:
```
sudo usermod -aG dialout $USER
```
then log out and back in.

## find out the ESP32 IP address
the setup page prints the ESP32 IP at the end of a successful flash. to read it
by hand instead, open the serial monitor of the arduino IDE at 115200 baud and
click the `RET` button on the ESP32 — the firmware prints its IP on boot. then
open http://localhost:8000; USB serial works without the IP.

---

# microscope motorization
this is the software used to run the xy table (z optional ) for the 3d printable microscope motorization
download the 3d printable files here
https://makerworld.com/en/models/2389756-microscope-motorized-xy-table-28byj-48#profileId-2617806




# this project in short 
Project: Low-cost, open-source microscope automation. A fully 3D-printed XY-stage powered by an ESP32 and 28BYJ-48 stepper motors, assembled in ~3 hours. Controlled via web app (Web Serial over USB as the low-latency primary transport, WebSocket as a network fallback), keyboard, game controllers (e.g. PS4 DualShock), or programmable API, it enables local or remote automated slide scanning using a microscope camera as a webcam. The system requires only four M3 screws in addition to widely available electronics (ESP32, ULN2003 drivers, motors). All structural parts are 3D printed and field-replaceable, allowing independent production and repair even in remote locations. Designed as a 99.75% lower-cost alternative to commercial systems, it democratizes lab automation for education, DIY biology, and resource-limited laboratories


# stepper motor info 
Description
Reviews (0)
Stepper Motor 5V 1/64 (28BYJ-48)
This unipolar stepper motor is perfect for small craft projects with motors. The stepper motor can be easily connected via a plug connection to a stepper motor driver module. In our shop, we have various stepper motor drivers (ULN2003) on offer that fit this motor. The stepper motor has a gearbox with a ratio of 1:64 this gear ratio has a certain deviation. If the motor is always turned in the same direction, for example in a clock, a fault can occur. This fault can be compensated if the position is sporadically determined anew with a light barrier module. This also has the advantage that the start position of the stepper motor can be precisely determined when it is switched on for the first time.

Connections:
5-Pin Connector
Technical Details:
Operating voltage: 5V DC
Operating voltage: 5V
Phases: 4
Step angle: 5.625° (64 steps/revolution)
DC resistance : 50 Ω
Noise level: 40 dB
Torque: > 34.3mNm
Gear ratio: 1/64
Motor diameter: 28mm
Motor shaft: Ø 5mm
Motor shaft length: 8mm
Mounting hole distance: 35mm
Weight: 38g
Delivery Includes:
1x Stepper Motor 28BYJ-48 with connection cable

---

# license
OMM — open microscope motorization is released under the **GNU General Public
License, version 3 or later** (see [`LICENSE`](./LICENSE)).

third-party components and their licences are listed in
[`THIRD-PARTY-NOTICES.md`](./THIRD-PARTY-NOTICES.md). note that the firmware
links the LGPL-3.0 `ESP Async WebServer` / `Async TCP` libraries and the
LGPL-2.1 ESP32 arduino core; the full source of this project is provided, so the
relinking condition of those licences is met.

### Actions and input bindings

Open **find (ctrl+f)** in the toolbar, or press **Ctrl+F** / **F3**. Search by
name, category, description, or keyword; use arrow keys and Enter to invoke a
result. **Capture Image** downloads the current camera frame (Ctrl+Shift+I or
gamepad button 0 by default). Manual stitch capture uses Ctrl+Shift+F; R runs
stitching. F opens/closes Flat. Escape stops motors and cancels zoom selection.

Enable **Edit bindings** to select an action and add keyboard chords or gamepad
buttons/axes (indices are zero-based; D-pad buttons are 12–15 on standard pads,
triggers are buttons 6/7). Multiple bindings are supported. Conflicts can be
cancelled or overridden; overriding removes only the conflicting assignment.
Record keys by holding them together. Sequential shortcuts are not supported.

Profiles are stored in this browser, independently of other browsers/users.
Enter a profile name to switch or create one. Export/import versioned JSON to
transfer a keymap. Invalid or conflicting imports leave the current map intact.
Clear individual bindings, restore an action's defaults and Save, or reset all.
Auto-repeat waits for the configured delay, then fires at the interval (both
in milliseconds). Analog values support deadzone, sensitivity and a power
response curve; threshold converts an analog input into a digital press.

Movement retains connection, scan, focus and controller arming checks. Opening
action search releases held actions; center the controller before resuming.
Movement invoked from the palette is a short 150 ms pulse. Global shortcuts
apply inside this application, not across the operating system. Plain keys are
suppressed while typing in fields. Browser-reserved shortcuts may require a
different binding on some platforms.

The framework-independent registry is in `webserved_dir/actions.module.js`;
application handlers share `o_actions` in `webserved_dir/o_actions.js`. Register
stable IDs with metadata and callbacks. Digital callbacks receive press/repeat
and release phases; analog callbacks receive normalized values and zero on
release. The `f_action` helper ignores digital releases for one-shot operations.
Additional contexts can be activated with `f_context`; global remains active.
Run regression tests with `deno test -A tests`.
