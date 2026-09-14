# Third-party components and licences

OMM — open microscope motorization is licensed under the **GNU General Public
License, version 3 or later** (`LICENSE`). Everything in this repository that is
not listed below is original work covered by that licence.

This file lists the third-party components OMM depends on, how they are used,
and the licence they are used under. None of them are GPL-incompatible.

## Deliberately excluded

**SuperGlue / SuperPoint (Magic Leap)** — the `image_stitching2` incremental
stitcher (`stitcher/`), `grow_stitch.py`, the `Grow` panel and the `Marker`
panel are **not** part of this release. SuperGlue is published by Magic Leap,
Inc. under an *"academic or non-profit organization noncommercial research use
only"* agreement that grants no right to distribute, sublicense or publish the
software or its derivatives. Those files therefore cannot be redistributed here.
The `Scan` (FFT-based `stitch.py`) and `AStitch` (LightGlue) panels cover the
mosaic use case.

## JavaScript / Deno

| component | use | licence |
| --- | --- | --- |
| [Vue 3](https://github.com/vuejs/core) | UI framework, vendored at `webserved_dir/lib/vue.esm-browser.js` | MIT |
| [Vue Router](https://github.com/vuejs/router) | routing, vendored at `webserved_dir/lib/vue-router.esm-browser.js` | MIT |
| `@vue/devtools-api` | compatibility shim (`webserved_dir/lib/devtools-api-shim.js`) | MIT |
| [`jsr:@db/sqlite`](https://jsr.io/@db/sqlite) | SQLite bindings for the local settings/project database | MIT |
| `jsr:@denosaurs/plug` | native library loader used by `@db/sqlite` | MIT |
| `jsr:@std/*` | Deno standard library modules | MIT |

Deno itself (the runtime, not distributed here) is MIT licensed.

## Python

Installed into `./venv` by `deno task install`.

| component | use | licence |
| --- | --- | --- |
| [NumPy](https://numpy.org/) | array maths throughout the imaging pipeline | BSD-3-Clause |
| [OpenCV](https://opencv.org/) (`opencv-python`) | image processing, `stitch.py`, `focus_stack.py`, `locate_map.py` | Apache-2.0 (the `opencv-python` packaging is MIT) |
| [PyTorch](https://pytorch.org/) / torchvision | inference for the learned matcher | BSD-3-Clause |
| [LightGlue](https://github.com/cvg/LightGlue) | learned feature matcher (`lgsp_imerge.py`, `autostitch.py`) | Apache-2.0 |
| [Kornia](https://github.com/kornia/kornia) | LoFTR rescue matcher and image ops | Apache-2.0 |
| [Matplotlib](https://matplotlib.org/) | plots in the focus/backlash panels | PSF-based, BSD-compatible |
| [Pillow](https://python-pillow.org/) | image I/O | MIT-CMU |
| NetworkX, SymPy, Jinja2, MarkupSafe, ContourPy, cycler, fontTools, kiwisolver, mpmath, fsspec, filelock, packaging, pyparsing, python-dateutil, six, typing_extensions, Triton | transitive dependencies of the above | BSD / MIT / Apache-2.0 |
| NVIDIA CUDA wheels (`nvidia-*`) | optional GPU runtime pulled in by PyTorch | NVIDIA proprietary, separately licensed; not part of this repository |
| `m2stitch` | optional, only used by the `test_m2stitch.py` comparison script | see the package metadata |

Note: LightGlue downloads the pretrained **SuperPoint** weights at runtime into
PyTorch's cache. Those weights originate from Magic Leap's SuperPoint release;
they are fetched by the dependency, not redistributed in this repository. Review
[LightGlue issue #38](https://github.com/cvg/LightGlue/issues/38) if you need to
use this path commercially.

## ESP32 firmware

`stepper_websocket.ino` is compiled and uploaded by `arduino-cli`; the libraries
below are installed into the user's arduino-cli data directory, not bundled here.

| component | licence |
| --- | --- |
| ESP32 Arduino core (`esp32:esp32`) | LGPL-2.1 |
| [ESP Async WebServer](https://github.com/me-no-dev/ESPAsyncWebServer) | LGPL-3.0 |
| [Async TCP](https://github.com/me-no-dev/AsyncTCP) | LGPL-3.0 |
| [ArduinoJson](https://arduinojson.org/) | MIT |

The firmware links the LGPL libraries above. The complete source of this project
is published, and the libraries are installed as separate, replaceable packages,
so the relinking condition of the LGPL is satisfied (LGPL-3.0 §4.d.1). Note that
LGPL-3.0 is compatible with this project's GPL-3.0 licence.

## Build tools

| tool | use | licence |
| --- | --- | --- |
| [arduino-cli](https://github.com/arduino/arduino-cli) | compiles and uploads the firmware; downloaded at install time and invoked as a separate program | GPL-3.0 |
| `esptool` | bundled with the ESP32 core, used by `arduino-cli upload` | GPL-2.0 |
