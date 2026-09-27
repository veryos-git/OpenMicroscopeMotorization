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

Installed into `./venv` by `deno task install` (Cellpose additionally gets its
own `./venv_cellpose`, see below).

| component | use | licence |
| --- | --- | --- |
| [NumPy](https://numpy.org/) | array maths throughout the imaging pipeline | BSD-3-Clause |
| [OpenCV](https://opencv.org/) (`opencv-python`) | image processing, `stitch.py`, `focus_stack.py`, `locate_map.py` | Apache-2.0 (the `opencv-python` packaging is MIT) |
| [PyTorch](https://pytorch.org/) / torchvision | inference for the learned matcher | BSD-3-Clause |
| [LightGlue](https://github.com/cvg/LightGlue) | learned feature matcher (`lgsp_imerge.py`, `autostitch.py`) | Apache-2.0 |
| [Kornia](https://github.com/kornia/kornia) | LoFTR rescue matcher and image ops | Apache-2.0 |
| [Matplotlib](https://matplotlib.org/) | plots in the focus/backlash panels | PSF-based, BSD-compatible |
| [Pillow](https://python-pillow.org/) | image I/O | MIT-CMU |
| NetworkX, SymPy, Jinja2, MarkupSafe, ContourPy, cycler, fontTools, kiwisolver, mpmath, fsspec, filelock, packaging, pyparsing, python-dateutil, six, typing_extensions, Triton, natsort, tifffile, imagecodecs, roifile, fastremap, fill_voids, llvmlite, numba, segment_anything | transitive dependencies of the above and of Cellpose | BSD / MIT / Apache-2.0 |
| NVIDIA CUDA wheels (`nvidia-*`, `cuda-*`), Triton | GPU runtime pulled in by the CUDA build of PyTorch, which is what `deno task install` picks whenever the machine has an NVIDIA card (use `--cpu` for the CPU-only build) | NVIDIA proprietary / BSD-3-Clause (Triton); separately licensed, not part of this repository |
| `m2stitch` | optional, only used by the `test_m2stitch.py` comparison script | see the package metadata |

### Cellpose (the `Cell pose` panel)

Installed into its own `./venv_cellpose` by `deno task install`; the panel is
optional and skipped entirely with `--skip-cellpose`.

| component | use | licence |
| --- | --- | --- |
| [Cellpose](https://github.com/MouseLand/cellpose) (`cellpose`, `cellpose_worker.py`) | cell / nucleus segmentation of the camera feed | BSD-3-Clause (Copyright © 2020 Howard Hughes Medical Institute) |

**The pretrained Cellpose models are not BSD.** Every model Cellpose downloads
(`cpsam_v2`, `cyto3`, …) is trained on datasets released under **CC-BY-NC**, so
the weights — and the segmentations produced with them — are for
**non-commercial use only**. They are fetched at runtime into
`./weights/cellpose/` (about 1.2 GB for `cpsam`, 25 MB for `cyto3`) by the
dependency, not redistributed in this repository, in the same way the LightGlue
SuperPoint weights are handled above. If you need a segmentation model for
commercial use, train one on your own data (Cellpose supports this) or use a
permissively licensed model.

The BSD-3-Clause Cellpose *code* is compatible with this project's GPL-3.0
licence; the CC-BY-NC model weights are a separate, non-commercial asset.

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

## Browser firmware flashing

`webserved_dir/vendor/esptool-js-0.6.1.js` is the unmodified npm bundle from
[Espressif esptool-js 0.6.1](https://github.com/espressif/esptool-js), licensed
under Apache-2.0. Its license is included in `webserved_dir/vendor/esptool-js-LICENSE`.
The bundle includes pako (MIT/Zlib), tslib (0BSD), and atob-lite (MIT);
their licenses are included alongside the bundle.

## Ultralytics YOLO (optional training/inference)

- Source: https://github.com/ultralytics/ultralytics
- License: GNU Affero General Public License, version 3
  (https://github.com/ultralytics/ultralytics/blob/main/LICENSE).
- Used by `yolo_worker.py` through the separately installed `venv_yolo` environment.
  The pretrained YOLO11n checkpoint is downloaded from upstream on first training
  use. No Ultralytics source code or weights are committed in this repository.
