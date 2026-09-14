
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
- `arduino-cli` into `~/.local/bin` + the `esp32:esp32` board package + the `ESP Async WebServer` / `Async TCP` / `ArduinoJson` libraries — without these the setup page cannot detect the ESP32
  (`Async TCP` provides `AsyncTCP.h` and must be installed explicitly — arduino-cli does not pull it in as a dependency when run non-interactively)
- `./venv` with `numpy` + `opencv-python` — used by `stitch.py` (the tile scan mosaic) and `stich_image_in_folder.py`
- `torch` (cpu build) + `lightglue` + `kornia` — used by `autostitch.py` and by `stitch.py --matcher loftr`

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

## tile scan -> mosaic
the scan panel drives the stage over a grid, saves every tile as
`tile_r<row>_c<col>.png` into `scans/scan_<date>_<time>/` and then hands the whole
folder to `stitch.py`. it infers the grid from those file names, registers the
neighbours by FFT cross correlation, solves all tile positions in one robust
least-squares pass and blends the mosaic into `stitched.png` (plus
`stitched_preview.jpg` for large mosaics, `positions.json` and `report.json`).
its progress is streamed into the scan panel while it runs.

## backlash calibration
the `Backlash` panel measures the slack of a motor from the live image. it drives
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
