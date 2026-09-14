#!/usr/bin/env python3
"""
stitch.py -- robust mosaic stitcher for overlapping image tiles.

Designed for grid/raster scans (microscope slide scans, flatbed/camera scans,
drone lawn-mower patterns) where the tiles overlap and are related by
translation.  Instead of feature matching + homographies (which breaks down on
low-texture, repetitive or thin-overlap tiles) it uses:

  1. discovery + grid inference from file names (tile_r00_c01.png, 0_1.tif, ...)
  2. pairwise translation estimation by exact FFT normalised cross-correlation
     over *all* integer shifts, refined hierarchically to sub-pixel accuracy
  3. a robust global least-squares solve (IRLS / Huber) over the tile graph so
     that a few bad pairs cannot break the layout
  4. a second, prior-guided registration pass for the pairs that failed
  5. optional flat-field (vignetting) correction and per-tile gain compensation
  6. memory-bounded, banded compositing with distance-transform feathering

Only numpy and OpenCV are required.

Examples
--------
    ./stitch.py scan_2026-08-15_152408
    ./stitch.py tiles/ -o mosaic.png --blend feather --jobs 8
    ./stitch.py tiles/ --dry-run                 # just report the layout
    ./stitch.py tiles/ --positions out.json      # save/reuse tile positions
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

try:
    import cv2
except ImportError:  # pragma: no cover
    sys.exit("error: OpenCV is required.  Install it with:  pip install opencv-python")
try:
    import numpy as np
except ImportError:  # pragma: no cover
    sys.exit("error: numpy is required.  Install it with:  pip install numpy")


IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".jp2")
NEG_INF = -2.0


# --------------------------------------------------------------------------- #
# logging
# --------------------------------------------------------------------------- #

_T0 = time.time()
_VERBOSE = True


def log(msg: str = "") -> None:
    if _VERBOSE:
        sys.stderr.write(f"[{time.time() - _T0:7.1f}s] {msg}\n")
        sys.stderr.flush()


def warn(msg: str) -> None:
    sys.stderr.write(f"  ! {msg}\n")
    sys.stderr.flush()


def f_s_dur(n_sec: float) -> str:
    """Human-readable duration for the timing logs ('850ms', '1.4s')."""
    if n_sec >= 1.0:
        return f"{n_sec:.1f}s"
    return f"{n_sec * 1000:.0f}ms"


# --------------------------------------------------------------------------- #
# tile discovery / grid inference
# --------------------------------------------------------------------------- #

@dataclass
class Tile:
    idx: int
    path: str
    row: Optional[int] = None
    col: Optional[int] = None
    x: float = 0.0          # solved position on the canvas
    y: float = 0.0
    x_mot: Optional[float] = None   # motor X position (steps) from the file name
    y_mot: Optional[float] = None   # motor Y position (steps) from the file name

    @property
    def name(self) -> str:
        return os.path.basename(self.path)


# ordered by how explicit they are
_GRID_PATTERNS = [
    re.compile(r"r(?:ow)?[_\-]?(\d+).*?c(?:ol(?:umn)?)?[_\-]?(\d+)", re.I),
    re.compile(r"c(?:ol(?:umn)?)?[_\-]?(\d+).*?r(?:ow)?[_\-]?(\d+)", re.I),
    re.compile(r"y[_\-]?(\d+).*?x[_\-]?(\d+)", re.I),
    re.compile(r"x[_\-]?(\d+).*?y[_\-]?(\d+)", re.I),
]

# 'fog_0001_1234_-5678.png' -> motor X=1234, Y=-5678 (the two trailing ints)
_MOTOR_PATTERN = re.compile(r"_(-?\d+)_(-?\d+)\.[^.]+$", re.I)


def infer_motor(tiles: List[Tile]) -> bool:
    """Fill tile.x_mot / tile.y_mot from trailing '_<x>_<y>' step positions.

    Returns True only if *every* tile carries motor positions (so a folder that
    merely happens to have one matching file is not treated as a motor scan)."""
    n_got = 0
    for t in tiles:
        m = _MOTOR_PATTERN.search(t.name)
        if m:
            t.x_mot = float(m.group(1))
            t.y_mot = float(m.group(2))
            n_got += 1
    return n_got == len(tiles) and n_got > 0


def discover_tiles(inputs: Sequence[str], pattern: Optional[str],
                   recursive: bool) -> List[Tile]:
    """Collect image files from files/dirs, sorted naturally."""
    paths: List[str] = []
    for item in inputs:
        if os.path.isdir(item):
            if recursive:
                for root, _dirs, files in os.walk(item):
                    paths += [os.path.join(root, f) for f in files]
            else:
                paths += [os.path.join(item, f) for f in sorted(os.listdir(item))]
        elif os.path.isfile(item):
            paths.append(item)
        else:
            raise SystemExit(f"error: no such file or directory: {item}")

    paths = [p for p in paths if p.lower().endswith(IMAGE_EXTS)]
    if pattern:
        rx = re.compile(pattern)
        paths = [p for p in paths if rx.search(os.path.basename(p))]
    if not paths:
        raise SystemExit("error: no images found (looked for %s)" % ", ".join(IMAGE_EXTS))

    def natural_key(p: str):
        parts = re.split(r"(\d+)", os.path.basename(p))
        return [int(s) if s.isdigit() else s.lower() for s in parts]

    paths = sorted(set(paths), key=natural_key)
    return [Tile(i, p) for i, p in enumerate(paths)]


def infer_grid(tiles: List[Tile], transpose: bool = False
               ) -> Tuple[bool, List[Tile]]:
    """
    Fill in tile.row / tile.col from file names.

    Files that do not carry grid indices are ignored as long as the ones that do
    form a complete rectangle -- scan folders often also hold previous stitching
    output (``stitched.jpg``, ``stitched_row_0003.png``, ...).

    Returns (success, ignored_files).
    """
    for pat_i, rx in enumerate(_GRID_PATTERNS):
        got: List[Tuple[Tile, Tuple[int, int]]] = []
        skipped: List[Tile] = []
        for t in tiles:
            m = rx.search(os.path.splitext(t.name)[0])
            if not m:
                skipped.append(t)
                continue
            a, b = int(m.group(1)), int(m.group(2))
            got.append((t, (b, a) if pat_i in (1, 3) else (a, b)))
        if len(got) < 4 or len(got) < len(skipped):
            continue  # too few real tiles to call this a grid
        rc = [v for _t, v in got]
        rows = sorted({r for r, _ in rc})
        cols = sorted({c for _, c in rc})
        if len(rows) * len(cols) != len(got) or len(set(rc)) != len(got):
            continue  # not a complete rectangular grid -> keep looking
        rmap = {v: i for i, v in enumerate(rows)}
        cmap = {v: i for i, v in enumerate(cols)}
        for t, (r, c) in got:
            t.row, t.col = (cmap[c], rmap[r]) if transpose else (rmap[r], cmap[c])
        return True, skipped
    return False, []


def assign_grid(tiles: List[Tile], nrows: int, ncols: int, serpentine: bool) -> None:
    """Assign row/col from the sorted order (used with --grid)."""
    if nrows * ncols < len(tiles):
        raise SystemExit(f"error: --grid {nrows}x{ncols} cannot hold {len(tiles)} tiles")
    for i, t in enumerate(tiles):
        r, c = divmod(i, ncols)
        if serpentine and r % 2 == 1:
            c = ncols - 1 - c
        t.row, t.col = r, c


# --------------------------------------------------------------------------- #
# image loading
# --------------------------------------------------------------------------- #

def imread(path: str, flags: int = cv2.IMREAD_COLOR) -> np.ndarray:
    """imread that tolerates non-ASCII paths."""
    img = cv2.imread(path, flags)
    if img is None:
        try:
            buf = np.fromfile(path, dtype=np.uint8)
            img = cv2.imdecode(buf, flags)
        except OSError:
            img = None
    if img is None:
        raise SystemExit(f"error: cannot read image: {path}")
    return img


def odd_sized(tiles: List[Tile], shape: Tuple[int, int]) -> List[str]:
    """Names of tiles whose size differs from ``shape``, read from headers only."""
    try:
        from PIL import Image
    except ImportError:
        return []
    h, w = shape
    out = []
    for t in tiles:
        try:
            with Image.open(t.path) as im:
                if im.size != (w, h):
                    out.append(t.name)
        except Exception:
            continue
    return out


def to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 3:
        img = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if img.dtype == np.uint16:
        img = (img.astype(np.float32) / 257.0)
    return img.astype(np.float32)


def highpass(img: np.ndarray, sigma: float) -> np.ndarray:
    """Remove smooth illumination so correlation keys on structure, not vignetting."""
    if sigma <= 0:
        return img
    return img - cv2.GaussianBlur(img, (0, 0), sigma)


# --------------------------------------------------------------------------- #
# correlation core
# --------------------------------------------------------------------------- #

def _rect_sums(integ: np.ndarray, y0: np.ndarray, y1: np.ndarray,
               x0: np.ndarray, x1: np.ndarray) -> np.ndarray:
    """Vectorised rectangle sums from an integral image, broadcast over dy x dx."""
    return (integ[y1[:, None], x1[None, :]] - integ[y0[:, None], x1[None, :]]
            - integ[y1[:, None], x0[None, :]] + integ[y0[:, None], x0[None, :]])


def ncc_map(a: np.ndarray, b: np.ndarray, min_area: int
            ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Exact normalised cross-correlation for *every* integer shift.

    A shift (dx, dy) means: tile ``b`` sits at offset (dx, dy) relative to ``a``,
    i.e. a[y, x] overlaps b[y - dy, x - dx].  ``a`` and ``b`` may differ in size.

    Returns (score[dy, dx], dys, dxs) with score = -2 where the overlap is
    smaller than ``min_area`` pixels.
    """
    Ha, Wa = a.shape
    Hb, Wb = b.shape
    fh = cv2.getOptimalDFTSize(Ha + Hb)
    fw = cv2.getOptimalDFTSize(Wa + Wb)

    fa = np.fft.rfft2(a, s=(fh, fw))
    fb = np.fft.rfft2(b, s=(fh, fw))
    corr = np.fft.irfft2(fa * np.conj(fb), s=(fh, fw))

    dys = np.arange(-(Hb - 1), Ha)
    dxs = np.arange(-(Wb - 1), Wa)
    sxy = corr[np.mod(dys, fh)[:, None], np.mod(dxs, fw)[None, :]]

    ia = cv2.integral(a, sdepth=cv2.CV_64F)
    iaa = cv2.integral(np.multiply(a, a), sdepth=cv2.CV_64F)
    ib = cv2.integral(b, sdepth=cv2.CV_64F)
    ibb = cv2.integral(np.multiply(b, b), sdepth=cv2.CV_64F)

    ay0 = np.maximum(dys, 0)
    ay1 = np.minimum(Hb + dys, Ha)
    ax0 = np.maximum(dxs, 0)
    ax1 = np.minimum(Wb + dxs, Wa)
    by0, by1 = ay0 - dys, ay1 - dys
    bx0, bx1 = ax0 - dxs, ax1 - dxs

    area = (np.maximum(ay1 - ay0, 0)[:, None]
            * np.maximum(ax1 - ax0, 0)[None, :]).astype(np.float64)
    valid = area >= max(1, min_area)
    if not valid.any():
        return np.full(area.shape, NEG_INF), dys, dxs
    area_safe = np.where(valid, area, 1.0)

    sa = _rect_sums(ia, ay0, ay1, ax0, ax1)
    saa = _rect_sums(iaa, ay0, ay1, ax0, ax1)
    sb = _rect_sums(ib, by0, by1, bx0, bx1)
    sbb = _rect_sums(ibb, by0, by1, bx0, bx1)

    num = sxy - sa * sb / area_safe
    va = np.maximum(saa - sa * sa / area_safe, 0.0)
    vb = np.maximum(sbb - sb * sb / area_safe, 0.0)
    den = np.sqrt(va * vb)
    # a near-flat region (black canvas, JPEG noise) has no variance -- its NCC
    # is numerically unstable and can even exceed 1.0, so it must not win the
    # argmax; the inputs are high-passed, so real structure sits far above this
    b_struct = (va > 4.0) & (vb > 4.0)
    score = np.where(valid & b_struct, num / np.maximum(den, 1e-9), NEG_INF)
    return score, dys, dxs


def best_shift(a: np.ndarray, b: np.ndarray, min_area: int,
               window: Optional[Tuple[int, int, int]] = None
               ) -> Tuple[int, int, float]:
    """Best (dx, dy, score).  ``window`` = (cx, cy, radius) restricts the search."""
    score, dys, dxs = ncc_map(a, b, min_area)
    if window is not None:
        cx, cy, rad = window
        mask = (np.abs(dys - cy) <= rad)[:, None] & (np.abs(dxs - cx) <= rad)[None, :]
        score = np.where(mask, score, NEG_INF)
    k = int(np.argmax(score))
    iy, ix = np.unravel_index(k, score.shape)
    return int(dxs[ix]), int(dys[iy]), float(score[iy, ix])


def overlap_rects(shape: Tuple[int, int], dx: int, dy: int,
                  shape_b: Optional[Tuple[int, int]] = None):
    """Overlap rectangle in a-coords and b-coords for shift (dx, dy)."""
    ha, wa = shape
    hb, wb = shape_b if shape_b is not None else shape
    ax0, ax1 = max(0, dx), min(wa, wb + dx)
    ay0, ay1 = max(0, dy), min(ha, hb + dy)
    return (ax0, ay0, ax1, ay1), (ax0 - dx, ay0 - dy, ax1 - dx, ay1 - dy)


def subpixel_residual(a: np.ndarray, b: np.ndarray, dx: int, dy: int) -> Tuple[float, float]:
    """Sub-pixel refinement of an already integer-aligned pair."""
    (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = overlap_rects(a.shape, dx, dy)
    if ax1 - ax0 < 24 or ay1 - ay0 < 24:
        return 0.0, 0.0
    pa = np.ascontiguousarray(a[ay0:ay1, ax0:ax1], dtype=np.float32)
    pb = np.ascontiguousarray(b[by0:by1, bx0:bx1], dtype=np.float32)
    try:
        win = cv2.createHanningWindow((pa.shape[1], pa.shape[0]), cv2.CV_32F)
        (rx, ry), _resp = cv2.phaseCorrelate(pa, pb, win)
    except cv2.error:
        return 0.0, 0.0
    if not (math.isfinite(rx) and math.isfinite(ry)):
        return 0.0, 0.0
    # phaseCorrelate returns the shift of pa relative to pb -> invert sign
    rx, ry = -rx, -ry
    lim = 0.9
    return float(np.clip(rx, -lim, lim)), float(np.clip(ry, -lim, lim))


# --------------------------------------------------------------------------- #
# pairwise registration
# --------------------------------------------------------------------------- #

@dataclass
class Edge:
    i: int
    j: int
    dx: float = 0.0
    dy: float = 0.0
    score: float = NEG_INF
    area: int = 0
    kind: str = "measured"      # measured | prior
    weight: float = 0.0
    residual: float = 0.0
    ms: float = 0.0             # registration wall-time (ms), for timing logs


# worker globals (populated by the pool initialiser)
_W: Dict[str, object] = {}


def _worker_init(paths, coarse_scale, hp_sigma, min_overlap_frac, refine_margin,
                 cache_size, b_keep_cache=False):
    cv2.setNumThreads(1)
    paths = list(paths)
    old_paths = _W.get("paths") or []
    if b_keep_cache and _W.get("full_cache") is not None:
        # 'watch' adds keep re-initialising between ticks: drop only the cache
        # entries whose path changed, so neighbours do not get decoded and
        # high-passed again for every incoming frame
        for s_cache in ("full_cache", "coarse_cache"):
            o_cache = _W[s_cache]
            for k in [k for k in o_cache
                      if k >= len(old_paths) or k >= len(paths)
                      or old_paths[k] != paths[k]]:
                o_cache.pop(k, None)
        o_full_cache, o_coarse_cache = _W["full_cache"], _W["coarse_cache"]
        # the coarse cache normally allows 4096 entries; a persistent process
        # must not accumulate that over a long live session
        while len(o_coarse_cache) > cache_size:
            o_coarse_cache.pop(next(iter(o_coarse_cache)))
    else:
        o_full_cache, o_coarse_cache = {}, {}
    _W.update(paths=paths, coarse_scale=coarse_scale, hp_sigma=hp_sigma,
              min_overlap_frac=min_overlap_frac, refine_margin=refine_margin,
              full_cache=o_full_cache, coarse_cache=o_coarse_cache,
              cache_size=cache_size)


def _cached(cache: dict, key, make, limit: int):
    if key in cache:
        return cache[key]
    val = make()
    if len(cache) >= limit:
        cache.pop(next(iter(cache)))
    cache[key] = val
    return val


def _full_gray(i: int) -> np.ndarray:
    def make():
        n_ms__t0 = time.perf_counter()
        g = to_gray(imread(_W["paths"][i], cv2.IMREAD_UNCHANGED))
        g = highpass(g, float(_W["hp_sigma"]))
        n_ms = (time.perf_counter() - n_ms__t0) * 1000
        if n_ms > 150:                       # slow decode -> worth knowing about
            log(f"  decode {os.path.basename(_W['paths'][i])}: {n_ms:.0f} ms")
        return g
    return _cached(_W["full_cache"], i, make, int(_W["cache_size"]))


def _coarse_gray(i: int) -> np.ndarray:
    def make():
        s = float(_W["coarse_scale"])
        g = _full_gray(i)
        return cv2.resize(g, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    return _cached(_W["coarse_cache"], i, make, 4096)


def register_pair(task) -> Edge:
    """task = (i, j, prior_dx, prior_dy, radius)  -- prior may be None."""
    i, j, prior, radius = task
    e = Edge(i, j)
    n_ms__t0 = time.perf_counter()
    n_ms__coarse = n_ms__refine = n_ms__sub = 0.0
    try:
        a_f, b_f = _full_gray(i), _full_gray(j)
        H, W = a_f.shape
        min_area_full = max(1024, int(_W["min_overlap_frac"] * H * W))
        margin = int(_W["refine_margin"])

        if prior is None:
            n_ms__t1 = time.perf_counter()
            s = float(_W["coarse_scale"])
            a_c, b_c = _coarse_gray(i), _coarse_gray(j)
            hc, wc = a_c.shape
            min_area_c = max(64, int(_W["min_overlap_frac"] * hc * wc))
            dxc, dyc, _sc = best_shift(a_c, b_c, min_area_c)
            dx0, dy0 = int(round(dxc / s)), int(round(dyc / s))
            margin = max(margin, int(round(2.0 / s)) + 2)
            n_ms__coarse = (time.perf_counter() - n_ms__t1) * 1000
        else:
            dx0, dy0 = int(round(prior[0])), int(round(prior[1]))
            margin = int(radius)

        # ---- refine on the (expanded) overlap crops, at full resolution ----
        n_ms__t1 = time.perf_counter()
        (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = overlap_rects((H, W), dx0, dy0)
        if (ax1 - ax0) * (ay1 - ay0) <= 0:
            e.score, e.area = NEG_INF, 0
            return e
        cax0, cay0 = max(0, ax0 - margin), max(0, ay0 - margin)
        cax1, cay1 = min(W, ax1 + margin), min(H, ay1 + margin)
        cbx0, cby0 = cax0 - dx0, cay0 - dy0
        cbx1, cby1 = cax1 - dx0, cay1 - dy0
        # clip the b crop, keeping the crop-shift bookkeeping consistent
        sbx0, sby0 = max(0, cbx0), max(0, cby0)
        sbx1, sby1 = min(W, cbx1), min(H, cby1)
        A = a_f[cay0:cay1, cax0:cax1]
        B = b_f[sby0:sby1, sbx0:sbx1]
        if A.size == 0 or B.size == 0:
            e.score, e.area = NEG_INF, 0
            return e

        # A[Y,X] overlaps B[Y-DY, X-DX]  <=>  dx = DX + off_x, dy = DY + off_y
        off_x = cax0 - sbx0
        off_y = cay0 - sby0
        min_area_crop = max(1024, int(0.35 * min(A.size, B.size)))
        rdx, rdy, sc = best_shift(A, B, min_area_crop,
                                  window=(dx0 - off_x, dy0 - off_y, margin))
        dx = rdx + off_x
        dy = rdy + off_y
        n_ms__refine = (time.perf_counter() - n_ms__t1) * 1000

        (ax0, ay0, ax1, ay1), _ = overlap_rects((H, W), dx, dy)
        area = max(0, ax1 - ax0) * max(0, ay1 - ay0)
        if area < min_area_full:
            e.dx, e.dy, e.score, e.area = float(dx), float(dy), NEG_INF, area
            return e

        n_ms__t1 = time.perf_counter()
        fx, fy = subpixel_residual(a_f, b_f, dx, dy)
        n_ms__sub = (time.perf_counter() - n_ms__t1) * 1000
        e.dx, e.dy = dx + fx, dy + fy
        e.score, e.area = float(sc), int(area)
    except Exception as exc:                      # never let one pair kill the run
        e.score, e.area = NEG_INF, 0
        e.kind = f"failed:{type(exc).__name__}"
    e.ms = (time.perf_counter() - n_ms__t0) * 1000
    if e.ms > 300:
        log(f"  slow pair {i}->{j}: {f_s_dur(e.ms / 1000)} "
            f"(coarse {n_ms__coarse:.0f}ms, refine {n_ms__refine:.0f}ms, "
            f"subpixel {n_ms__sub:.0f}ms, score {e.score:.2f})")
    return e


# --------------------------------------------------------------------------- #
# optional: learned dense matching (LoFTR via kornia) as a fallback proposer
# --------------------------------------------------------------------------- #

class LoFTRMatcher:
    """
    Detector-free dense matcher used only for pairs that correlation could not
    solve (thin or low-texture overlaps).  It *proposes* a translation; the
    normal full-resolution NCC stage then verifies and sub-pixel refines it, so
    a hallucinated match cannot silently enter the layout.

    Needs:  pip install torch kornia
    """

    def __init__(self, weights: str = "outdoor", device: str = "auto",
                 long_side: int = 1024, conf: float = 0.5):
        try:
            import torch
            import kornia
            import kornia.feature as KF
        except ImportError as exc:
            hint = ""
            local = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 ".venv", "bin", "python")
            if os.path.exists(local):
                hint = f"\n       (or run this script with {local})"
            raise SystemExit(
                "error: --matcher loftr needs PyTorch and Kornia.\n"
                "       pip install torch kornia        (add --index-url "
                "https://download.pytorch.org/whl/cu124 for CUDA)\n"
                f"       (import failed: {exc}){hint}")
        self.torch = torch
        self.kornia = kornia
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device)
        self.long_side = long_side
        self.conf = conf
        log(f"loading LoFTR ({weights}) on {self.device}")
        self.net = KF.LoFTR(pretrained=weights).to(self.device).eval()

    def _tensor(self, path: str) -> Tuple["object", float]:
        img = to_gray(imread(path, cv2.IMREAD_COLOR))
        s = min(1.0, self.long_side / max(img.shape[:2]))
        if s < 1.0:
            img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        # LoFTR wants 1x1xHxW in [0, 1], and coarse features on an /8 grid
        h = (img.shape[0] // 8) * 8
        w = (img.shape[1] // 8) * 8
        img = img[:h, :w] / 255.0
        t = self.torch.from_numpy(img).float()[None, None].to(self.device)
        return t, s

    def match(self, path_a: str, path_b: str) -> Optional[Tuple[float, float, int, float, float]]:
        """Returns (dx, dy, n_inliers, rotation_deg, scale) or None."""
        ta, sa = self._tensor(path_a)
        tb, sb = self._tensor(path_b)
        with self.torch.inference_mode():
            out = self.net({"image0": ta, "image1": tb})
        kp0 = out["keypoints0"].cpu().numpy()
        kp1 = out["keypoints1"].cpu().numpy()
        conf = out["confidence"].cpu().numpy()
        keep = conf >= self.conf
        kp0, kp1 = kp0[keep], kp1[keep]
        if len(kp0) < 8:
            return None
        kp0 = kp0 / sa
        kp1 = kp1 / sb

        # a[y, x] matches b[y - dy, x - dx]  ->  d = kp0 - kp1
        d = kp0 - kp1
        med = np.median(d, axis=0)
        mad = np.median(np.abs(d - med), axis=0) * 1.4826
        tol = np.maximum(3.0 * mad, 3.0)
        inl = np.all(np.abs(d - med) <= tol, axis=1)
        if inl.sum() < 8:
            return None
        dx, dy = np.median(d[inl], axis=0)

        rot = scale = float("nan")
        if inl.sum() >= 12:
            M, _ = cv2.estimateAffinePartial2D(
                kp1.astype(np.float32), kp0.astype(np.float32),
                method=cv2.RANSAC, ransacReprojThreshold=4.0)
            if M is not None:
                scale = float(math.hypot(M[0, 0], M[1, 0]))
                rot = float(math.degrees(math.atan2(M[1, 0], M[0, 0])))
        return float(dx), float(dy), int(inl.sum()), rot, scale


_MATCHER: Dict[str, "LoFTRMatcher"] = {}


def loftr_rescue(tiles: List[Tile], edges: List[Edge], args, tile_shape: Tuple[int, int],
                 tile_area: int) -> int:
    """Re-try failed pairs with LoFTR + NCC verification.  Returns #recovered."""
    failed = [e for e in edges if e.score < args.min_score]
    if not failed:
        log("matcher: nothing to rescue, every pair already registered")
        return 0
    matcher = _MATCHER.get("loftr")
    if matcher is None:
        matcher = LoFTRMatcher(args.matcher_weights, args.matcher_device,
                               args.matcher_long_side, args.matcher_conf)
        _MATCHER["loftr"] = matcher
    _worker_init([t.path for t in tiles], 1.0, args.highpass, args.min_overlap,
                 args.refine_margin, 4)
    log(f"matcher: LoFTR on {len(failed)} unsolved pairs")
    recovered = 0
    for e in failed:
        m = matcher.match(tiles[e.i].path, tiles[e.j].path)
        if m is None:
            log(f"  {tiles[e.i].name} -> {tiles[e.j].name}: no consistent matches")
            continue
        dx, dy, n, rot, scale = m
        # only meaningful when the match is substantial; a handful of scattered
        # correspondences always "sees" some rotation
        if n >= 100 and math.isfinite(rot) and (abs(rot) > 1.0 or abs(scale - 1) > 0.02):
            warn(f"{tiles[e.i].name} -> {tiles[e.j].name}: LoFTR sees {rot:.1f} deg "
                 f"rotation / scale {scale:.3f} over {n} matches; these tiles are "
                 "not related by translation alone")
        # verify + sub-pixel refine at full resolution
        cand = register_pair((e.i, e.j, (dx, dy), args.matcher_window))
        if cand.score >= args.min_score:
            cand.kind = "loftr"
            e.dx, e.dy, e.score, e.area, e.kind = (cand.dx, cand.dy, cand.score,
                                                   cand.area, "loftr")
            recovered += 1
            log(f"  {tiles[e.i].name} -> {tiles[e.j].name}: recovered "
                f"({n} inliers, NCC {cand.score:.2f})")
        else:
            hint = (" (many matches but no photometric agreement: check for "
                    "rotation/scale between tiles)" if n >= 100 else
                    " (match count is at noise level: these tiles most likely "
                    "share no image content)")
            log(f"  {tiles[e.i].name} -> {tiles[e.j].name}: {n} inliers but NCC "
                f"only {max(cand.score, 0.0):.2f} -> rejected{hint}")
    log(f"matcher: recovered {recovered}/{len(failed)} pairs")
    return recovered


# --------------------------------------------------------------------------- #
# global layout solve
# --------------------------------------------------------------------------- #

def solve_positions(n: int, edges: List[Edge], anchor: int = 0,
                    irls_iters: int = 6) -> np.ndarray:
    """
    Weighted least squares over p_j - p_i = d_ij with Huber IRLS.
    Returns an (n, 2) array of positions.
    """
    pos = np.zeros((n, 2), dtype=np.float64)
    if not edges:
        return pos
    w = np.array([e.weight for e in edges], dtype=np.float64)
    ii = np.array([e.i for e in edges])
    jj = np.array([e.j for e in edges])
    d = np.array([[e.dx, e.dy] for e in edges], dtype=np.float64)

    free = [k for k in range(n) if k != anchor]
    index = {k: m for m, k in enumerate(free)}

    for it in range(irls_iters):
        lap = np.zeros((len(free), len(free)), dtype=np.float64)
        rhs = np.zeros((len(free), 2), dtype=np.float64)
        for k in range(len(edges)):
            i, j, wk = ii[k], jj[k], w[k]
            if wk <= 0:
                continue
            for a, b, sgn in ((i, j, -1.0), (j, i, 1.0)):
                if a == anchor:
                    continue
                ai = index[a]
                lap[ai, ai] += wk
                rhs[ai] += sgn * wk * d[k]
                if b != anchor:
                    lap[ai, index[b]] -= wk
        lap += np.eye(len(free)) * 1e-9
        try:
            sol = np.linalg.solve(lap, rhs)
        except np.linalg.LinAlgError:
            sol = np.linalg.lstsq(lap, rhs, rcond=None)[0]
        pos = np.zeros((n, 2))
        for k, m in index.items():
            pos[k] = sol[m]

        res = (pos[jj] - pos[ii]) - d
        rnorm = np.linalg.norm(res, axis=1)
        for k, e in enumerate(edges):
            e.residual = float(rnorm[k])
        if it == irls_iters - 1:
            break
        med = np.median(rnorm)
        mad = np.median(np.abs(rnorm - med)) * 1.4826
        sigma = max(2.0, med + 2.0 * mad, mad)
        base = np.array([e.weight for e in edges], dtype=np.float64)
        huber = np.where(rnorm <= sigma, 1.0, sigma / np.maximum(rnorm, 1e-9))
        w = base * huber
    return pos


def components(n: int, edges: List[Edge]) -> List[List[int]]:
    """Connected groups of the tile graph (union-find over weighted edges)."""
    parent = list(range(n))

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in edges:
        if e.weight <= 0:
            continue
        ra, rb = find(e.i), find(e.j)
        if ra != rb:
            parent[ra] = rb
    groups: Dict[int, List[int]] = {}
    for k in range(n):
        groups.setdefault(find(k), []).append(k)
    return sorted(groups.values(), key=len, reverse=True)


def edge_weight(e: Edge, tile_area: int) -> float:
    """Confidence -> least-squares weight."""
    if e.kind.startswith("prior"):
        return 0.02
    s = max(0.0, e.score)
    return float((s ** 2) * (0.25 + min(1.0, e.area / max(1.0, 0.5 * tile_area))))


# --------------------------------------------------------------------------- #
# photometric correction
# --------------------------------------------------------------------------- #

def estimate_flatfield(paths: Sequence[str], n_samples: int, percentile: float,
                       band: int = 160) -> np.ndarray:
    """Per-pixel illumination field (H, W, C) normalised to mean 1.0."""
    step = max(1, len(paths) // max(1, n_samples))
    sample = list(paths)[::step][:n_samples]
    probe = imread(sample[0], cv2.IMREAD_COLOR)
    H, W = probe.shape[:2]
    field = np.zeros((H, W, 3), dtype=np.float32)
    for y0 in range(0, H, band):
        y1 = min(H, y0 + band)
        stack = np.empty((len(sample), y1 - y0, W, 3), dtype=np.uint8)
        for k, p in enumerate(sample):
            img = imread(p, cv2.IMREAD_COLOR)
            if img.shape[:2] != (H, W):
                img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
            stack[k] = img[y0:y1]
        field[y0:y1] = np.percentile(stack, percentile, axis=0).astype(np.float32)
        del stack
    sigma = max(8.0, min(H, W) / 12.0)
    field = cv2.GaussianBlur(field, (0, 0), sigma)
    field = np.maximum(field, 1e-3)
    field /= float(field.mean())
    return np.maximum(field, 0.15)


def solve_gains(n: int, edges: List[Edge], means: Dict[Tuple[int, int], float],
                clamp: Tuple[float, float] = (0.75, 1.35)) -> np.ndarray:
    """Per-tile scalar gains equalising overlap brightness (Brown & Lowe style)."""
    A = np.zeros((n, n), dtype=np.float64)
    for e in edges:
        mi = means.get((e.i, e.j))
        mj = means.get((e.j, e.i))
        if mi is None or mj is None or mi <= 1 or mj <= 1:
            continue
        w = max(0.0, e.score) ** 2
        if w <= 0:
            continue
        A[e.i, e.i] += w * mi * mi
        A[e.j, e.j] += w * mj * mj
        A[e.i, e.j] -= w * mi * mj
        A[e.j, e.i] -= w * mi * mj
    reg = 1e-2 * (np.trace(A) / max(1, n) + 1.0)
    A += np.eye(n) * reg
    g = np.linalg.solve(A, np.full(n, reg, dtype=np.float64))
    g /= max(1e-9, float(np.mean(g)))
    return np.clip(g, *clamp)


# --------------------------------------------------------------------------- #
# compositing
# --------------------------------------------------------------------------- #

def feather_mask(h: int, w: int, crop: int, power: float) -> np.ndarray:
    m = np.zeros((h, w), dtype=np.uint8)
    c = max(0, min(crop, min(h, w) // 2 - 1))
    m[c:h - c if c else h, c:w - c if c else w] = 255
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
    mx = float(dist.max())
    if mx <= 0:
        return np.ones((h, w), dtype=np.float32)
    wgt = (dist / mx).astype(np.float32)
    if power != 1.0:
        wgt = np.power(wgt, power, dtype=np.float32)
    return np.maximum(wgt, 1e-4) * (m > 0)


def composite(tiles: List[Tile], pos: np.ndarray, tile_shape: Tuple[int, int],
              args, field: Optional[np.ndarray], gains: Optional[np.ndarray],
              origin: Optional[Tuple[float, float]] = None,
              canvas: Optional[Tuple[int, int]] = None,
              region: Optional[Tuple[int, int, int, int]] = None
              ) -> Tuple[np.ndarray, Tuple[float, float]]:
    """
    Banded, memory-bounded feather blend.  Returns (image BGR uint8, origin).

    ``origin`` and ``canvas`` pin the canvas instead of deriving it from the
    positions (needed when adding tiles to an existing mosaic), and ``region``
    = (x0, y0, x1, y1) in canvas pixels renders just that rectangle.  A region
    is blended from *every* tile that touches it, so the feathering across the
    boundary between old and new tiles is identical to a full re-blend.
    """
    h, w = tile_shape
    if origin is None:
        origin = (float(pos[:, 0].min()), float(pos[:, 1].min()))
    ox, oy = origin
    px = pos[:, 0] - ox
    py = pos[:, 1] - oy
    if canvas is None:
        canvas = (int(math.ceil(px.max() + w)), int(math.ceil(py.max() + h)))
    Wc, Hc = canvas
    rx0, ry0, rx1, ry1 = region if region is not None else (0, 0, Wc, Hc)
    rx0, ry0 = max(0, rx0), max(0, ry0)
    rx1, ry1 = min(Wc, rx1), min(Hc, ry1)
    if rx1 <= rx0 or ry1 <= ry0:
        return np.zeros((0, 0, 3), np.uint8), (ox, oy)
    if region is None:
        log(f"canvas: {Wc} x {Hc} px ({Wc * Hc / 1e6:.1f} Mpx)")
    else:
        log(f"repainting region x {rx0}-{rx1}, y {ry0}-{ry1} "
            f"({(rx1 - rx0) * (ry1 - ry0) / 1e6:.1f} Mpx of {Wc} x {Hc})")

    mask = feather_mask(h, w, args.crop, args.feather_power)
    if args.blend == "none":
        mask = (mask > 0).astype(np.float32)
    out = np.zeros((ry1 - ry0, rx1 - rx0, 3), dtype=np.uint8)

    ix = np.floor(px).astype(np.int64)
    iy = np.floor(py).astype(np.int64)
    fx = px - ix
    fy = py - iy

    cache: Dict[int, np.ndarray] = {}

    def prepared(k: int) -> np.ndarray:
        if k in cache:
            return cache[k]
        img = imread(tiles[k].path, cv2.IMREAD_COLOR)
        if img.shape[:2] != (h, w):
            img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        img = img.astype(np.float32)
        if field is not None:
            img /= field
        if gains is not None:
            img *= float(gains[k])
        if args.subpixel and (abs(fx[k]) > 0.02 or abs(fy[k]) > 0.02):
            M = np.float32([[1, 0, fx[k]], [0, 1, fy[k]]])
            img = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_REPLICATE)
        if len(cache) >= max(2, args.tile_cache):
            cache.pop(next(iter(cache)))
        cache[k] = img
        return img

    band = max(64, args.band)
    nbands = (ry1 - ry0 + band - 1) // band
    for bi, y0 in enumerate(range(ry0, ry1, band)):
        y1 = min(ry1, y0 + band)
        acc = np.zeros((y1 - y0, rx1 - rx0, 3), dtype=np.float32)
        wsum = np.zeros((y1 - y0, rx1 - rx0), dtype=np.float32)
        hits = np.nonzero((iy < y1) & (iy + h > y0)
                          & (ix < rx1) & (ix + w > rx0))[0]
        for k in hits:
            ty0, ty1 = max(y0, iy[k]), min(y1, iy[k] + h)
            sy0, sy1 = ty0 - iy[k], ty1 - iy[k]
            tx0, tx1 = max(rx0, ix[k]), min(rx1, ix[k] + w)
            sx0, sx1 = tx0 - ix[k], tx1 - ix[k]
            if ty1 <= ty0 or tx1 <= tx0:
                continue
            img = prepared(int(k))[sy0:sy1, sx0:sx1]
            m = mask[sy0:sy1, sx0:sx1]
            acc[ty0 - y0:ty1 - y0, tx0 - rx0:tx1 - rx0] += img * m[..., None]
            wsum[ty0 - y0:ty1 - y0, tx0 - rx0:tx1 - rx0] += m
        np.maximum(wsum, 1e-6, out=wsum)
        acc /= wsum[..., None]
        out[y0 - ry0:y1 - ry0] = np.clip(acc, 0, 255).astype(np.uint8)
        log(f"  blended band {bi + 1}/{nbands}  rows {y0}-{y1}  ({len(hits)} tiles)")
    return out, (ox, oy)


def write_image(path: str, img: np.ndarray, jpeg_quality: int) -> None:
    ext = os.path.splitext(path)[1].lower()
    params: List[int] = []
    if ext in (".jpg", ".jpeg"):
        params = [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
    elif ext == ".png":
        params = [cv2.IMWRITE_PNG_COMPRESSION, 3]
    ok = cv2.imwrite(path, img, params)
    if not ok:
        raise SystemExit(f"error: failed to write {path}")


# --------------------------------------------------------------------------- #
# incremental sessions
# --------------------------------------------------------------------------- #

SESSION_VERSION = 1


class Session:
    """
    A mosaic you can keep adding to.

    Holds the tiles, their solved positions, the measured pair offsets and the
    photometric state, next to the mosaic image itself.  Adding images places
    them against what is already there and repaints only the affected area, so
    the cost of an update is proportional to the new material, not to the size
    of the mosaic.
    """

    def __init__(self, path: str):
        self.path = os.path.abspath(path)
        self.dir = os.path.dirname(self.path)
        self.tiles: List[Tile] = []
        self.edges: List[Edge] = []
        self.gains: List[float] = []
        self.pending: List[str] = []
        self.tile_size: Tuple[int, int] = (0, 0)     # (w, h)
        self.origin: Tuple[float, float] = (0.0, 0.0)
        self.canvas: Tuple[int, int] = (0, 0)        # (W, H)
        self.mosaic_name = ""
        self.field_name = ""
        self.config: Dict[str, object] = {}

    # ---------------------------------------------------------------- paths --
    def rel(self, name: str) -> str:
        return os.path.join(self.dir, name) if name else ""

    @property
    def mosaic_path(self) -> str:
        return self.rel(self.mosaic_name)

    # ----------------------------------------------------------- persistence --
    def save(self) -> None:
        n_ms__t0 = time.perf_counter()
        data = {
            "version": SESSION_VERSION,
            "tile_size": list(self.tile_size),
            "origin": list(self.origin),
            "canvas": list(self.canvas),
            "mosaic": self.mosaic_name,
            "flatfield": self.field_name,
            "config": self.config,
            "pending": self.pending,
            "tiles": [{"file": t.name, "path": os.path.relpath(t.path, self.dir),
                       "row": t.row, "col": t.col, "x": t.x, "y": t.y,
                       "gain": self.gains[k] if k < len(self.gains) else 1.0}
                      for k, t in enumerate(self.tiles)],
            "edges": [{"i": e.i, "j": e.j, "dx": e.dx, "dy": e.dy,
                       "score": e.score, "area": e.area, "kind": e.kind}
                      for e in self.edges],
        }
        tmp = self.path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(data, fh, indent=1)
        os.replace(tmp, self.path)     # never leave a half-written session
        n_ms = (time.perf_counter() - n_ms__t0) * 1000
        if n_ms > 20:
            log(f"session saved ({n_ms:.0f}ms)")

    @classmethod
    def load(cls, path: str) -> "Session":
        s = cls(path)
        if not os.path.exists(s.path):
            raise SystemExit(f"error: no session at {s.path}\n"
                             "       create one with:  stitch.py <tiles> --session "
                             f"{os.path.basename(path)}")
        with open(s.path) as fh:
            d = json.load(fh)
        if d.get("version") != SESSION_VERSION:
            raise SystemExit(f"error: {s.path} is a v{d.get('version')} session, "
                             f"this build writes v{SESSION_VERSION}")
        s.tile_size = tuple(d["tile_size"])
        s.origin = tuple(d["origin"])
        s.canvas = tuple(d["canvas"])
        s.mosaic_name = d.get("mosaic", "")
        s.field_name = d.get("flatfield", "")
        s.config = d.get("config", {})
        s.pending = d.get("pending", [])
        for k, t in enumerate(d["tiles"]):
            tile = Tile(k, os.path.normpath(os.path.join(s.dir, t["path"])),
                        t.get("row"), t.get("col"))
            tile.x, tile.y = float(t["x"]), float(t["y"])
            s.tiles.append(tile)
            s.gains.append(float(t.get("gain", 1.0)))
        for e in d.get("edges", []):
            s.edges.append(Edge(e["i"], e["j"], e["dx"], e["dy"], e["score"],
                                e.get("area", 0), e.get("kind", "measured")))
        return s

    # ---------------------------------------------------------------- state --
    def positions(self) -> np.ndarray:
        return np.array([[t.x, t.y] for t in self.tiles], dtype=np.float64)

    def known_paths(self) -> Dict[str, int]:
        return {os.path.realpath(t.path): k for k, t in enumerate(self.tiles)}

    def field(self) -> Optional[np.ndarray]:
        if not self.field_name:
            return None
        p = self.rel(self.field_name)
        return np.load(p) if os.path.exists(p) else None

    def apply_config(self, args) -> None:
        """
        Reuse the build's settings so later adds stay consistent.

        Registration and blending must match what produced the existing pixels;
        a different high-pass or feather power part-way through would show up as
        a discontinuity in the mosaic.  Any override is reported rather than
        applied silently.
        """
        for k, v in self.config.items():
            old = getattr(args, k, None)
            if old != v:
                setattr(args, k, v)
                log(f"using session setting --{k.replace('_', '-')} {v} "
                    f"(instead of {old})")


CONFIG_KEYS = ("highpass", "min_overlap", "min_score", "coarse_scale",
               "refine_margin", "crop", "feather_power", "blend", "subpixel")


def thumbs_path(session: Session) -> str:
    return os.path.splitext(session.path)[0] + "_thumbs.npy"


def build_thumbs(session: Session, scale: float, jobs: int) -> np.ndarray:
    """
    Small grey copies of every placed tile, cached next to the session.

    Screening a new image against every placed tile is what makes it possible to
    add images with uninformative names; decoding the full mosaic's worth of
    PNGs on every add would dominate the runtime, so the thumbnails are kept.
    """
    path = thumbs_path(session)
    w, h = session.tile_size
    th, tw = int(round(h * scale)), int(round(w * scale))
    n = len(session.tiles)
    cached = None
    if os.path.exists(path):
        try:
            cached = np.load(path)
        except (OSError, ValueError):
            cached = None
        if cached is not None and cached.shape[1:] != (th, tw):
            cached = None                      # geometry changed, start over
        if cached is not None and cached.shape[0] > n:
            cached = None                      # session shrank, start over
    start = 0 if cached is None else cached.shape[0]
    if start == n and cached is not None:
        return cached

    # tiles are only ever appended, so anything already cached stays valid
    out = np.zeros((n, th, tw), dtype=np.uint8)
    if cached is not None:
        out[:start] = cached
    n_ms__t0 = time.perf_counter()
    log(f"caching thumbnails for {n - start} tile(s)"
        + (f" (reusing {start})" if start else ""))
    for k in range(start, n):
        g = to_gray(imread(session.tiles[k].path, cv2.IMREAD_COLOR))
        out[k] = cv2.resize(g, (tw, th), interpolation=cv2.INTER_AREA)
    np.save(path, out)
    log(f"thumbnails ready ({f_s_dur(time.perf_counter() - n_ms__t0)})")
    return out


def screen_candidates(new_gray_small: np.ndarray, thumbs: np.ndarray,
                      hp_sigma_small: float, top_k: int,
                      only: Optional[List[int]] = None
                      ) -> List[Tuple[int, float, Tuple[int, int]]]:
    """
    Rank placed tiles by coarse correlation with a new image.

    The returned shift is the new image's offset *relative to the placed tile*,
    matching the direction register_pair() expects for the edge (placed, new).

    ``only`` restricts the sweep to those placed tiles -- a live capture almost
    always neighbours the frame before it, so screening just that
    neighbourhood costs a fraction of the full sweep.
    """
    b = highpass(new_gray_small.astype(np.float32), hp_sigma_small)
    th, tw = b.shape
    min_area = max(64, int(0.05 * th * tw))
    out = []
    for k in (only if only is not None else range(len(thumbs))):
        a = highpass(thumbs[k].astype(np.float32), hp_sigma_small)
        dx, dy, sc = best_shift(a, b, min_area)
        out.append((k, sc, (dx, dy)))
    out.sort(key=lambda r: -r[1])
    return out[:top_k]


def place_new_tiles(session: Session, new_paths: List[str], args, jobs: int
                    ) -> Tuple[List[int], List[str]]:
    """
    Place new images, repeating while progress is being made.

    An image that matches nothing on one pass may well match on the next, once
    the tile that bridges it has been placed -- so passes repeat until one adds
    nothing.  Whatever is left over is returned as still-pending; in a live scan
    an image often arrives before its neighbour does.
    """
    placed: List[int] = []
    remaining = list(new_paths)
    while remaining:
        got, remaining = _place_pass(session, remaining, args, jobs)
        placed += got
        if not got:
            break
    return placed, remaining


def _place_pass(session: Session, new_paths: List[str], args, jobs: int
                ) -> Tuple[List[int], List[str]]:
    """One placement pass over ``new_paths`` (see place_new_tiles)."""
    w, h = session.tile_size
    tile_area = w * h
    scale = float(session.config.get("coarse_scale") or args.coarse_scale
                  or min(1.0, 512.0 / max(w, h)))
    grid_mode = all(t.row is not None for t in session.tiles) and session.tiles

    placed: List[int] = []
    still_pending: List[str] = []
    thumbs = None

    for path in new_paths:
        name = os.path.basename(path)
        tile = Tile(len(session.tiles), path)
        if grid_mode:
            for pat_i, rx in enumerate(_GRID_PATTERNS):
                m = rx.search(os.path.splitext(name)[0])
                if m:
                    a_i, b_i = int(m.group(1)), int(m.group(2))
                    r, c = (b_i, a_i) if pat_i in (1, 3) else (a_i, b_i)
                    tile.row, tile.col = r, c
                    break

        # ---- pick which placed tiles to try ----
        cands: List[Tuple[int, Optional[Tuple[int, int]]]] = []
        b_local = False
        if tile.row is not None:
            by_rc = {(t.row, t.col): k for k, t in enumerate(session.tiles)}
            for dr, dc in ((0, -1), (0, 1), (-1, 0), (1, 0),
                           (-1, -1), (-1, 1), (1, -1), (1, 1)):
                k = by_rc.get((tile.row + dr, tile.col + dc))
                if k is not None:
                    cands.append((k, None))
        elif session.tiles:
            # live captures almost always overlap the frame captured right
            # before them: screen that one tile first (a single FFT), then its
            # close neighbourhood, and only then the whole mosaic.  Every
            # candidate is verified around its screened position, so a tile with
            # no real overlap cannot match on a tiny random fringe of pixels.
            if thumbs is None:
                thumbs = build_thumbs(session, scale, jobs)
            g = to_gray(imread(path, cv2.IMREAD_COLOR))
            small = cv2.resize(g, (thumbs.shape[2], thumbs.shape[1]),
                               interpolation=cv2.INTER_AREA)
            o_tile__last = session.tiles[-1]
            n_radius = 1.5 * math.hypot(w, h)
            a_a_n_idx__local = [
                [len(session.tiles) - 1],
                [k for k, o_tile in enumerate(session.tiles)
                 if k != len(session.tiles) - 1
                 and math.hypot(o_tile.x - o_tile__last.x,
                                o_tile.y - o_tile__last.y) <= n_radius],
            ]
            for a_n_idx__local in a_a_n_idx__local:
                if not a_n_idx__local:
                    continue
                n_ms__t0 = time.perf_counter()
                ranked = screen_candidates(small, thumbs, args.highpass * scale,
                                           args.add_candidates,
                                           only=a_n_idx__local)
                cands = [(k, (int(round(dx / scale)), int(round(dy / scale))))
                         for k, sc, (dx, dy) in ranked if sc > 0.1]
                log(f"{name}: screened {len(a_n_idx__local)} local tile(s) in "
                    f"{f_s_dur(time.perf_counter() - n_ms__t0)} -> "
                    f"{len(cands)} candidate(s)")
                b_local = True
                if cands:
                    break

        if not cands:
            if thumbs is None:
                thumbs = build_thumbs(session, scale, jobs)
            n_ms__t0 = time.perf_counter()
            g = to_gray(imread(path, cv2.IMREAD_COLOR))
            small = cv2.resize(g, (thumbs.shape[2], thumbs.shape[1]),
                               interpolation=cv2.INTER_AREA)
            ranked = screen_candidates(small, thumbs, args.highpass * scale,
                                       args.add_candidates)
            cands = [(k, (int(round(dx / scale)), int(round(dy / scale))))
                     for k, sc, (dx, dy) in ranked if sc > 0.1]
            log(f"{name}: screened {len(thumbs)} placed tiles in "
                f"{f_s_dur(time.perf_counter() - n_ms__t0)} -> "
                f"{len(cands)} candidate(s)")
            b_local = False

        if not cands:
            log(f"{name}: no candidate neighbour found")
            still_pending.append(os.path.abspath(path))
            continue

        # ---- full-resolution registration against each candidate ----
        paths = [t.path for t in session.tiles] + [path]
        new_idx = len(session.tiles)
        # keep decoded/high-passed tiles across adds -- 'watch' keeps this
        # process alive, so neighbours are not decoded and filtered again for
        # every incoming frame (the cache is memory-bounded by the tile area)
        n_cache = max(6, min(32, int(128e6 / max(1, 4 * w * h))))
        _worker_init(paths, scale, args.highpass, args.min_overlap,
                     args.refine_margin, n_cache, b_keep_cache=True)

        def match_candidates(cands):
            found: List[Edge] = []
            for k, prior in cands:
                window = args.add_window if prior is not None else args.refine_margin
                e = register_pair((k, new_idx, prior, window))
                # a tight window can clip the true peak on repetitive texture:
                # escalate once to the wide window before the pair counts as lost
                if (prior is not None and args.add_window < args.refine_window
                        and e.score < args.min_score + 0.05):
                    e2 = register_pair((k, new_idx, prior, args.refine_window))
                    if e2.score > e.score:
                        e = e2
                if e.score >= args.min_score:
                    e.weight = edge_weight(e, tile_area)
                    found.append(e)
            return found

        n_ms__t0 = time.perf_counter()
        found = match_candidates(cands)
        if not found and b_local and not grid_mode:
            # the frame left the local neighbourhood (a jump, or a move back
            # into older territory) -> global thumbnail screening as fallback
            if thumbs is None:
                thumbs = build_thumbs(session, scale, jobs)
            n_ms__t1 = time.perf_counter()
            g = to_gray(imread(path, cv2.IMREAD_COLOR))
            small = cv2.resize(g, (thumbs.shape[2], thumbs.shape[1]),
                               interpolation=cv2.INTER_AREA)
            ranked = screen_candidates(small, thumbs, args.highpass * scale,
                                       args.add_candidates)
            cands = [(k, (int(round(dx / scale)), int(round(dy / scale))))
                     for k, sc, (dx, dy) in ranked if sc > 0.1]
            log(f"{name}: local neighbours did not match -> screened "
                f"{len(thumbs)} placed tiles in "
                f"{f_s_dur(time.perf_counter() - n_ms__t1)} -> "
                f"{len(cands)} candidate(s)")
            found = match_candidates(cands)
        if not found and args.matcher != "none":
            for k, _prior in cands[:2]:
                m = _MATCHER.get("loftr") or LoFTRMatcher(
                    args.matcher_weights, args.matcher_device,
                    args.matcher_long_side, args.matcher_conf)
                _MATCHER["loftr"] = m
                res = m.match(session.tiles[k].path, path)
                if res is None:
                    continue
                e = register_pair((k, new_idx, (res[0], res[1]), args.matcher_window))
                if e.score >= args.min_score:
                    e.kind = "loftr"
                    e.weight = edge_weight(e, tile_area)
                    found.append(e)
                    break
        n_ms__reg = (time.perf_counter() - n_ms__t0) * 1000

        if not found:
            log(f"{name}: no overlap with the mosaic (tried "
                f"{len(cands)} candidate(s)) -> pending")
            still_pending.append(os.path.abspath(path))
            continue

        # ---- position it: weighted mean of neighbour + measured offset ----
        wsum = sum(e.weight for e in found)
        tile.x = sum(e.weight * (session.tiles[e.i].x + e.dx) for e in found) / wsum
        tile.y = sum(e.weight * (session.tiles[e.i].y + e.dy) for e in found) / wsum
        spread = max(
            math.hypot(session.tiles[e.i].x + e.dx - tile.x,
                       session.tiles[e.i].y + e.dy - tile.y) for e in found)
        session.tiles.append(tile)
        session.gains.append(1.0)
        session.edges.extend(found)
        placed.append(tile.idx)
        if thumbs is not None:
            # so the next image in this same batch can match against it
            g = to_gray(imread(path, cv2.IMREAD_COLOR))
            thumbs = np.concatenate([thumbs, cv2.resize(
                g, (thumbs.shape[2], thumbs.shape[1]),
                interpolation=cv2.INTER_AREA)[None].astype(np.uint8)])
        best = max(found, key=lambda e: e.score)
        log(f"{name}: placed at ({tile.x:.0f}, {tile.y:.0f}) from {len(found)} "
            f"match(es) in {f_s_dur(n_ms__reg / 1000)}, best NCC {best.score:.2f}"
            + (f", neighbours disagree by {spread:.1f} px" if spread > 3 else ""))
        if spread > 25:
            warn(f"{name}: its matches disagree by {spread:.0f} px -- the tile is "
                 "placed at their weighted mean but something is off")
    return placed, still_pending


def paint_tiles(session: Session, new_idx: List[int], args) -> None:
    """Grow the mosaic if needed and repaint only the area the new tiles touch."""
    w, h = session.tile_size
    pos = session.positions()
    field = session.field()
    gains = np.array(session.gains, dtype=np.float64)

    ox, oy = session.origin
    Wc, Hc = session.canvas
    nx0 = min(ox, float(min(pos[k][0] for k in new_idx)))
    ny0 = min(oy, float(min(pos[k][1] for k in new_idx)))
    nx1 = max(ox + Wc, float(max(pos[k][0] for k in new_idx)) + w)
    ny1 = max(oy + Hc, float(max(pos[k][1] for k in new_idx)) + h)
    shift_x = int(math.floor(ox - nx0))
    shift_y = int(math.floor(oy - ny0))
    new_origin = (ox - shift_x, oy - shift_y)
    new_canvas = (int(math.ceil(nx1 - new_origin[0])),
                  int(math.ceil(ny1 - new_origin[1])))

    mosaic = None
    if session.mosaic_name and os.path.exists(session.mosaic_path):
        mosaic = imread(session.mosaic_path, cv2.IMREAD_COLOR)
    if mosaic is None:
        mosaic = np.zeros((new_canvas[1], new_canvas[0], 3), np.uint8)
    elif (shift_x, shift_y) != (0, 0) or new_canvas != (Wc, Hc):
        log(f"growing mosaic {Wc}x{Hc} -> {new_canvas[0]}x{new_canvas[1]}")
        grown = np.zeros((new_canvas[1], new_canvas[0], 3), np.uint8)
        grown[shift_y:shift_y + mosaic.shape[0],
              shift_x:shift_x + mosaic.shape[1]] = mosaic
        mosaic = grown
    session.origin, session.canvas = new_origin, new_canvas

    # region covered by the new tiles, in canvas pixels
    rx0 = int(math.floor(min(pos[k][0] for k in new_idx) - new_origin[0]))
    ry0 = int(math.floor(min(pos[k][1] for k in new_idx) - new_origin[1]))
    rx1 = int(math.ceil(max(pos[k][0] for k in new_idx) - new_origin[0] + w))
    ry1 = int(math.ceil(max(pos[k][1] for k in new_idx) - new_origin[1] + h))
    n_ms__t0 = time.perf_counter()
    patch, _ = composite(session.tiles, pos, (h, w), args, field, gains,
                         origin=new_origin, canvas=new_canvas,
                         region=(rx0, ry0, rx1, ry1))
    rx0, ry0 = max(0, rx0), max(0, ry0)
    mosaic[ry0:ry0 + patch.shape[0], rx0:rx0 + patch.shape[1]] = patch

    write_image(session.mosaic_path, mosaic, args.jpeg_quality)
    log(f"wrote {session.mosaic_path} ({mosaic.shape[1]} x {mosaic.shape[0]}) "
        f"in {f_s_dur(time.perf_counter() - n_ms__t0)}")
    if args.preview:
        n_ms__t1 = time.perf_counter()
        s = args.preview / max(mosaic.shape[:2])
        if s < 1.0:
            prev = cv2.resize(mosaic, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            write_image(os.path.splitext(session.mosaic_path)[0] + "_preview.jpg",
                        prev, args.jpeg_quality)
            log(f"preview written in {f_s_dur(time.perf_counter() - n_ms__t1)}")


def gains_for_new(session: Session, new_idx: List[int], args) -> None:
    """Match each new tile's exposure to the neighbours it overlaps."""
    if args.no_gain_comp:
        return
    n_ms__t0 = time.perf_counter()
    w, h = session.tile_size
    field = session.field()
    fgray = cv2.cvtColor(field, cv2.COLOR_BGR2GRAY) if field is not None else None

    def gray_of(k: int) -> np.ndarray:
        g = to_gray(imread(session.tiles[k].path, cv2.IMREAD_COLOR))
        return g / fgray if fgray is not None else g

    for k in new_idx:
        num = den = 0.0
        for e in session.edges:
            if e.j != k and e.i != k:
                continue
            other = e.i if e.j == k else e.j
            if other >= len(session.tiles) or other in new_idx:
                continue
            (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = overlap_rects(
                (h, w), int(round(e.dx)), int(round(e.dy)))
            if e.j != k:                      # k is the first tile of the pair
                (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = (
                    (bx0, by0, bx1, by1), (ax0, ay0, ax1, ay1))
            if ax1 - ax0 < 8 or ay1 - ay0 < 8:
                continue
            mine = float(gray_of(k)[ay0:ay1, ax0:ax1].mean())
            theirs = float(gray_of(other)[by0:by1, bx0:bx1].mean())
            if mine <= 1:
                continue
            wgt = max(0.0, e.score) ** 2
            num += wgt * theirs * session.gains[other]
            den += wgt * mine
        if den > 0:
            session.gains[k] = float(np.clip(num / den, 0.75, 1.35))
    log(f"gains for {len(new_idx)} tile(s) in "
        f"{f_s_dur(time.perf_counter() - n_ms__t0)}")


def compute_gains(tiles: List[Tile], edges: List[Edge], field: Optional[np.ndarray],
                  tile_shape: Tuple[int, int]) -> np.ndarray:
    """Per-tile exposure gains equalising the overlaps."""
    h, w = tile_shape
    means: Dict[Tuple[int, int], float] = {}
    cache: Dict[int, np.ndarray] = {}
    fgray = cv2.cvtColor(field, cv2.COLOR_BGR2GRAY) if field is not None else None

    def gray_of(k: int) -> np.ndarray:
        if k not in cache:
            img = to_gray(imread(tiles[k].path, cv2.IMREAD_COLOR))
            if fgray is not None:
                img = img / fgray
            if len(cache) > 32:
                cache.pop(next(iter(cache)))
            cache[k] = img
        return cache[k]

    meas = [e for e in edges if e.kind != "prior" and not e.kind.startswith("prior")]
    for e in sorted(meas, key=lambda e: (e.i, e.j)):
        (ax0, ay0, ax1, ay1), (bx0, by0, bx1, by1) = overlap_rects(
            (h, w), int(round(e.dx)), int(round(e.dy)))
        if (ax1 - ax0) < 8 or (ay1 - ay0) < 8:
            continue
        means[(e.i, e.j)] = float(gray_of(e.i)[ay0:ay1, ax0:ax1].mean())
        means[(e.j, e.i)] = float(gray_of(e.j)[by0:by1, bx0:bx1].mean())
    return solve_gains(len(tiles), meas, means)


def repaint_all(session: Session, args) -> None:
    """Re-estimate photometry over every tile and re-blend the whole canvas."""
    w, h = session.tile_size
    paths = [t.path for t in session.tiles]
    field = None
    if not args.no_flatfield:
        log(f"re-estimating flat-field from {len(paths)} tiles")
        field = estimate_flatfield(paths, args.flatfield_samples,
                                   args.flatfield_percentile)
        if field.shape[:2] != (h, w):
            field = cv2.resize(field, (w, h), interpolation=cv2.INTER_LINEAR)
        if not session.field_name:
            session.field_name = os.path.basename(
                os.path.splitext(session.path)[0] + "_flatfield.npy")
        np.save(session.rel(session.field_name), field)
    gains = np.ones(len(session.tiles))
    if not args.no_gain_comp:
        log("re-computing exposure gains")
        gains = compute_gains(session.tiles, session.edges, field, (h, w))
    session.gains = [float(g) for g in gains]

    pos = session.positions()
    ox = float(pos[:, 0].min())
    oy = float(pos[:, 1].min())
    canvas = (int(math.ceil(pos[:, 0].max() - ox + w)),
              int(math.ceil(pos[:, 1].max() - oy + h)))
    mosaic, origin = composite(session.tiles, pos, (h, w), args, field, gains,
                               origin=(ox, oy), canvas=canvas)
    session.origin, session.canvas = origin, canvas
    write_image(session.mosaic_path, mosaic, args.jpeg_quality)
    log(f"wrote {session.mosaic_path} ({canvas[0]} x {canvas[1]})")
    if args.preview:
        s = args.preview / max(mosaic.shape[:2])
        if s < 1.0:
            write_image(os.path.splitext(session.mosaic_path)[0] + "_preview.jpg",
                        cv2.resize(mosaic, None, fx=s, fy=s,
                                   interpolation=cv2.INTER_AREA), args.jpeg_quality)


def stable_images(folder: str, pattern: Optional[str], seen: Dict[str, int]
                  ) -> List[str]:
    """Images in ``folder`` whose size stopped changing (i.e. finished writing)."""
    out = []
    try:
        names = sorted(os.listdir(folder))
    except OSError:
        return out
    rx = re.compile(pattern) if pattern else None
    for n in names:
        if not n.lower().endswith(IMAGE_EXTS) or (rx and not rx.search(n)):
            continue
        p = os.path.join(folder, n)
        try:
            size = os.path.getsize(p)
        except OSError:
            continue
        if seen.get(p) == size and size > 0:
            out.append(p)
        seen[p] = size
    return out


def cmd_add(args) -> int:
    n_ms__t0 = time.perf_counter()
    session = Session.load(args.session)
    session.apply_config(args)
    n_ms__load = (time.perf_counter() - n_ms__t0) * 1000
    jobs = args.jobs or min(os.cpu_count() or 4, 16)
    known = session.known_paths()

    incoming: List[str] = []
    for item in args.input:
        if os.path.isdir(item):
            incoming += [os.path.join(item, n) for n in sorted(os.listdir(item))
                         if n.lower().endswith(IMAGE_EXTS)]
        elif os.path.isfile(item):
            incoming.append(item)
        else:
            warn(f"skipping {item}: not a file or directory")
    incoming = [p for p in incoming if os.path.realpath(p) not in known]
    retry = [p for p in session.pending
             if os.path.exists(p) and os.path.realpath(p) not in known]
    # new images first: a pending one may only become placeable because of them
    todo = list(dict.fromkeys(incoming + retry))
    if not todo:
        if args.repaint_all:
            log(f"nothing new to add -- repainting {len(session.tiles)} tiles")
            repaint_all(session, args)
            session.save()
            return 0
        log("nothing new to add")
        return 0

    log(f"adding {len(todo)} image(s) to a mosaic of {len(session.tiles)}"
        + (f" (including {len(retry)} pending)" if retry else ""))
    placed, pending = place_new_tiles(session, todo, args, jobs)
    n_ms__place = (time.perf_counter() - n_ms__t0) * 1000
    session.pending = pending
    if not placed:
        n_ms__t_save = time.perf_counter()
        session.save()
        log(f"add: load {n_ms__load:.0f}ms, place {n_ms__place:.0f}ms, "
            f"save {(time.perf_counter() - n_ms__t_save) * 1000:.0f}ms, "
            f"TOTAL {f_s_dur(time.perf_counter() - n_ms__t0)}")
        warn("nothing could be placed")
        return 1
    if args.repaint_all:
        repaint_all(session, args)
        n_ms__photometry = (time.perf_counter() - n_ms__t0) * 1000 - n_ms__place
    else:
        n_ms__t1 = time.perf_counter()
        gains_for_new(session, placed, args)
        n_ms__gains = (time.perf_counter() - n_ms__t1) * 1000
        n_ms__t1 = time.perf_counter()
        paint_tiles(session, placed, args)
        n_ms__paint = (time.perf_counter() - n_ms__t1) * 1000
        n_ms__photometry = n_ms__gains + n_ms__paint
    n_ms__t_save = time.perf_counter()
    session.save()
    n_ms__save = (time.perf_counter() - n_ms__t_save) * 1000
    if args.repaint_all:
        log(f"add: load {n_ms__load:.0f}ms, place {n_ms__place:.0f}ms, "
            f"repaint {n_ms__photometry:.0f}ms, save {n_ms__save:.0f}ms, "
            f"TOTAL {f_s_dur(time.perf_counter() - n_ms__t0)}")
    else:
        log(f"add: load {n_ms__load:.0f}ms, place {n_ms__place:.0f}ms, "
            f"gains {n_ms__gains:.0f}ms, paint {n_ms__paint:.0f}ms, "
            f"save {n_ms__save:.0f}ms, "
            f"TOTAL {f_s_dur(time.perf_counter() - n_ms__t0)}")
    log(f"session now holds {len(session.tiles)} tiles"
        + (f", {len(pending)} still pending" if pending else ""))
    return 0


def cmd_watch(args) -> int:
    folder = args.input[0]
    if not os.path.isdir(folder):
        raise SystemExit(f"error: watch needs a directory, got {folder}")
    log(f"watching {folder} every {args.interval}s -- Ctrl-C to stop")
    seen: Dict[str, int] = {}
    stable_images(folder, args.pattern, seen)      # first pass records sizes only
    idle = 0
    while True:
        try:
            time.sleep(args.interval)
        except KeyboardInterrupt:
            log("stopped")
            return 0
        session = Session.load(args.session)
        known = session.known_paths()
        ready = [p for p in stable_images(folder, args.pattern, seen)
                 if os.path.realpath(p) not in known]
        if not ready:
            idle += 1
            if idle % 20 == 1:
                log(f"waiting -- {len(session.tiles)} tiles so far")
            continue
        idle = 0
        log(f"{len(ready)} new image(s) detected")
        n_ms__t0 = time.perf_counter()
        args.input = ready
        try:
            cmd_add(args)
        except SystemExit as exc:
            warn(f"add failed: {exc}")
        except KeyboardInterrupt:
            log("stopped")
            return 0
        log(f"watch: tick took {f_s_dur(time.perf_counter() - n_ms__t0)} "
            f"for {len(ready)} image(s)")


def cmd_locate(args) -> int:
    """
    Locate a small patch inside the session mosaic (used by the marker mode).

    Prints one JSON line on stdout:
      n_x, n_y          top-left of the patch in world coordinates
                        (same space as session tiles[].x/y)
      n_score           NCC of the match (-2 = no overlap found)
      n_scl__mosaic     scale of the image the search ran on (1.0 = full mosaic)
      n_scl_x__patch, n_scl_y__patch   patch size in full-resolution mosaic px
    """
    if not args.patch:
        raise SystemExit("error: 'locate' needs --patch FILE")
    n_ms__t0 = time.perf_counter()
    session = Session.load(args.session)
    session.apply_config(args)

    mosaic_path = session.mosaic_path
    b_preview = False
    scl = 1.0                      # search-image px per full-resolution mosaic px
    if not os.path.exists(mosaic_path):
        preview_path = os.path.splitext(mosaic_path)[0] + "_preview.jpg"
        if not os.path.exists(preview_path):
            raise SystemExit(f"error: no mosaic at {mosaic_path}")
        mosaic_path = preview_path
        b_preview = True
    mosaic = to_gray(imread(mosaic_path, cv2.IMREAD_COLOR))
    Hm, Wm = mosaic.shape
    if b_preview:
        scl = Wm / max(1, session.canvas[0])
        log(f"full mosaic missing -- searching the preview "
            f"(scale {scl:.3f})")
    patch = to_gray(imread(args.patch, cv2.IMREAD_COLOR))
    # the patch is usually cut from the live camera view while the session
    # tiles are downscaled copies of it -- bring it to the session scale first
    if args.patch_scale != 1.0:
        patch = cv2.resize(patch, None, fx=args.patch_scale, fy=args.patch_scale,
                           interpolation=cv2.INTER_AREA)
    if scl != 1.0:
        patch = cv2.resize(patch, None, fx=scl, fy=scl,
                           interpolation=cv2.INTER_AREA)
    ph, pw = patch.shape
    if pw >= Wm or ph >= Hm:
        raise SystemExit(f"error: patch ({pw}x{ph}) is not smaller than the "
                         f"mosaic ({Wm}x{Hm})")

    sigma = float(args.highpass) * scl
    mosaic = highpass(mosaic, sigma)
    patch = highpass(patch, sigma)
    if float(patch.std()) < 1.0:
        raise SystemExit("error: patch has no structure -- pick a textured region")
    # the patch was cut out of a live view that the mosaic contains, so only
    # (near-)full overlaps are valid; that also keeps near-flat background
    # regions of the mosaic from winning the argmax with a degenerate NCC
    min_area = int(0.99 * pw * ph)

    # restrict the search to a crop around the expected position if given
    x0, y0 = 0, 0
    region = mosaic
    if args.expect_x is not None and args.expect_y is not None and args.radius > 0:
        ex = (args.expect_x - session.origin[0]) * scl
        ey = (args.expect_y - session.origin[1]) * scl
        rad = args.radius * scl
        x0 = int(max(0, math.floor(ex - rad)))
        y0 = int(max(0, math.floor(ey - rad)))
        x1 = int(min(Wm, math.ceil(ex + pw + rad)))
        y1 = int(min(Hm, math.ceil(ey + ph + rad)))
        region = np.ascontiguousarray(mosaic[y0:y1, x0:x1])
        log(f"windowed search in [{x0},{y0} .. {x1},{y1}]")

    n_ms__t1 = time.perf_counter()
    dx, dy, score = best_shift(region, patch, min_area)
    rx, ry = subpixel_residual(region, patch, dx, dy)
    n_x = (x0 + dx + rx) / scl + session.origin[0]
    n_y = (y0 + dy + ry) / scl + session.origin[1]
    n_ms__search = (time.perf_counter() - n_ms__t1) * 1000
    log(f"locate: search {n_ms__search:.0f}ms, "
        f"total {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms")
    print(json.dumps({
        "n_x": round(n_x, 2),
        "n_y": round(n_y, 2),
        "n_score": round(score, 4),
        "n_scl__mosaic": round(scl, 6),
        "n_scl_x__patch": round(pw / scl, 2),
        "n_scl_y__patch": round(ph / scl, 2),
    }))
    return 0


# --------------------------------------------------------------------------- #
# driver
# --------------------------------------------------------------------------- #

def build_pairs(tiles: List[Tile], grid: bool, max_pairs_warn: int = 20000):
    """Neighbour pairs to register."""
    pairs: List[Tuple[int, int]] = []
    if grid:
        by_rc = {(t.row, t.col): t.idx for t in tiles}
        for t in tiles:
            for dr, dc in ((0, 1), (1, 0)):
                nb = by_rc.get((t.row + dr, t.col + dc))
                if nb is not None:
                    pairs.append((t.idx, nb))
    else:
        n = len(tiles)
        if n * (n - 1) // 2 > max_pairs_warn:
            warn(f"{n} tiles without grid info -> {n * (n - 1) // 2} pairs; "
                 "this will be slow.  Consider --grid ROWSxCOLS.")
        pairs = [(i, j) for i in range(n) for j in range(i + 1, n)]
    return pairs


def build_motor_pairs(tiles: List[Tile], k: int) -> List[Tuple[int, int]]:
    """Spatial neighbour graph from motor step positions.

    Each tile is registered against its ``k`` nearest tiles (by step distance)
    plus its temporal neighbours (capture order).  This turns the O(n^2)
    all-pairs search into O(n*k), and revisits add loop-closure edges so the
    global solve can cancel drift.
    """
    n = len(tiles)
    o_pos = np.array([[t.x_mot, t.y_mot] for t in tiles], dtype=np.float64)
    a_o_pair: set = set()
    # temporal neighbours (capture order) -- the "chain"
    for i in range(n - 1):
        a_o_pair.add((i, i + 1))
        if i + 2 < n:
            a_o_pair.add((i, i + 2))
    # k nearest by motor distance -- the "loops" (revisits)
    for i in range(n):
        a_n_d = np.linalg.norm(o_pos - o_pos[i], axis=1)
        a_n_order = np.argsort(a_n_d)
        for n_j in a_n_order[1:k + 1]:
            j = int(n_j)
            a_o_pair.add((min(i, j), max(i, j)))
    return sorted(a_o_pair)


def f_o_motor_scl(tiles: List[Tile], edges: List[Edge],
                  min_score: float) -> Optional[Tuple[float, float]]:
    """Estimate (px_per_step_x, px_per_step_y) from registered chain edges.

    Uses the median ratio of measured pixel shift to motor step delta over the
    temporal neighbours (i, i+1).  Returns None when there are too few good
    chain edges to calibrate."""
    a_n_dx_pix: List[float] = []
    a_n_dx_step: List[float] = []
    a_n_dy_pix: List[float] = []
    a_n_dy_step: List[float] = []
    for e in edges:
        if e.j == e.i + 1 and e.score >= min_score:
            n_sx = tiles[e.j].x_mot - tiles[e.i].x_mot
            n_sy = tiles[e.j].y_mot - tiles[e.i].y_mot
            if abs(n_sx) > 1e-6:
                a_n_dx_pix.append(e.dx)
                a_n_dx_step.append(n_sx)
            if abs(n_sy) > 1e-6:
                a_n_dy_pix.append(e.dy)
                a_n_dy_step.append(n_sy)
    if len(a_n_dx_pix) < 2 or len(a_n_dy_pix) < 2:
        return None
    n_scl_x = float(np.median(np.array(a_n_dx_pix) / np.array(a_n_dx_step)))
    n_scl_y = float(np.median(np.array(a_n_dy_pix) / np.array(a_n_dy_step)))
    if not (math.isfinite(n_scl_x) and math.isfinite(n_scl_y)):
        return None
    return n_scl_x, n_scl_y


def robust_step(edges: List[Edge], min_score: float) -> Optional[Tuple[float, float]]:
    good = [e for e in edges if e.score >= min_score]
    if len(good) < max(1, len(edges) // 8):
        good = sorted(edges, key=lambda e: -e.score)[:max(1, len(edges) // 8)]
    good = [e for e in good if e.score > 0]
    if not good:
        return None
    return (float(np.median([e.dx for e in good])),
            float(np.median([e.dy for e in good])))


def _robust_line(vals: np.ndarray, comp: np.ndarray) -> Tuple[float, float]:
    """Least-squares line with one outlier-rejection round."""
    coef = np.polyfit(vals, comp, 1)
    res = np.abs(comp - np.polyval(coef, vals))
    mad = np.median(res) * 1.4826
    keep = res <= max(3.0 * mad, 4.0)
    if keep.sum() >= 3 and keep.sum() < len(vals):
        coef = np.polyfit(vals[keep], comp[keep], 1)
    return float(coef[0]), float(coef[1])


class StepModel:
    """
    Predicts the translation of a tile pair that could not be registered.

    Stage steps drift smoothly along a scan line, so a pair that failed (usually
    because its overlap is tiny or empty) is much better predicted by fitting
    its own scan line than by a global median.
    """

    def __init__(self, tiles: List[Tile], edges: List[Edge], min_score: float):
        self.kind_median: Dict[str, Tuple[float, float]] = {}
        self.groups: Dict[Tuple[str, int], List[Tuple[int, float, float]]] = {}
        per_kind: Dict[str, List[Edge]] = {"right": [], "down": []}
        for e in edges:
            k = self.classify(tiles, e)
            if k is None or e.score < min_score:
                continue
            ti = tiles[e.i]
            per_kind[k].append(e)
            self.groups.setdefault((k, ti.row), []).append((ti.col, e.dx, e.dy))
        for k, es in per_kind.items():
            st = robust_step(es, min_score) if es else None
            if st is not None:
                self.kind_median[k] = st
        self.fits: Dict[Tuple[str, int], Tuple[Tuple[float, float], Tuple[float, float]]] = {}
        for key, pts in self.groups.items():
            if len(pts) < 4:
                continue
            v = np.array([p[0] for p in pts], dtype=np.float64)
            if v.max() - v.min() < 1:
                continue
            self.fits[key] = (_robust_line(v, np.array([p[1] for p in pts])),
                              _robust_line(v, np.array([p[2] for p in pts])))

    @staticmethod
    def classify(tiles: List[Tile], e: Edge) -> Optional[str]:
        ti, tj = tiles[e.i], tiles[e.j]
        if ti.row is None or tj.row is None:
            return None
        if tj.row == ti.row and tj.col == ti.col + 1:
            return "right"
        if tj.col == ti.col and tj.row == ti.row + 1:
            return "down"
        return None

    def predict(self, tiles: List[Tile], e: Edge) -> Optional[Tuple[float, float, str]]:
        k = self.classify(tiles, e)
        if k is None:
            return None
        ti = tiles[e.i]
        key = (k, ti.row)
        if key in self.fits:
            (ax, bx), (ay, by) = self.fits[key]
            return ax * ti.col + bx, ay * ti.col + by, "prior:fit"
        pts = self.groups.get(key)
        if pts:
            return (float(np.median([p[1] for p in pts])),
                    float(np.median([p[2] for p in pts])), "prior:line")
        if k in self.kind_median:
            return self.kind_median[k][0], self.kind_median[k][1], "prior:global"
        return None


def coverage_report(tiles: List[Tile], pos: np.ndarray, tile_shape: Tuple[int, int],
                    scale: float = 0.04) -> float:
    """
    Fraction of the scanned area that no tile covers.

    "Scanned area" is the convex hull of the tile *centres*: everything the
    stage travelled over should be imaged, so anything uncovered in there is a
    real acquisition gap.  Using centres rather than corners keeps the ragged
    outer border of a skewed scan from counting as missing data.
    """
    h, w = tile_shape
    px = pos[:, 0] - pos[:, 0].min()
    py = pos[:, 1] - pos[:, 1].min()
    W = int((px.max() + w) * scale) + 2
    H = int((py.max() + h) * scale) + 2
    cov = np.zeros((H, W), np.uint8)
    for x, y in zip(px, py):
        cv2.rectangle(cov, (int(x * scale), int(y * scale)),
                      (int((x + w) * scale), int((y + h) * scale)), 255, -1)
    centres = np.array([[(x + w / 2) * scale, (y + h / 2) * scale]
                        for x, y in zip(px, py)], dtype=np.float32)
    if len(centres) < 3:
        return 0.0
    hull = np.zeros_like(cov)
    cv2.fillConvexPoly(hull, cv2.convexHull(centres).astype(np.int32), 255)
    inside = hull > 0
    if inside.sum() < 16:
        return 0.0
    return float(((cov == 0) & inside).sum()) / float(inside.sum())


def main(argv: Optional[Sequence[str]] = None) -> int:
    global _VERBOSE
    argv = list(sys.argv[1:] if argv is None else argv)
    mode = "build"
    if argv and argv[0] in ("build", "add", "watch", "locate"):
        mode = argv.pop(0)

    p = argparse.ArgumentParser(
        prog="stitch.py",
        usage="%(prog)s [build|add|watch|locate] input... [options]",
        description="Stitch overlapping image tiles into one large mosaic.\n\n"
                    "  stitch.py tiles/                     build a mosaic\n"
                    "  stitch.py tiles/ --session m.json    build one you can extend\n"
                    "  stitch.py add new.png --session m.json     add to it\n"
                    "  stitch.py watch incoming/ --session m.json  add as files appear\n"
                    "  stitch.py locate . --session m.json --patch p.png  find a patch",
        formatter_class=type("Fmt", (argparse.ArgumentDefaultsHelpFormatter,
                                     argparse.RawDescriptionHelpFormatter), {}))
    p.add_argument("input", nargs="+", help="folder(s) of tiles, or image files")
    p.add_argument("-o", "--output", help="output image (default: <input>_mosaic.png)")
    p.add_argument("--pattern", help="regex a file name must match to be used")
    p.add_argument("--recursive", action="store_true", help="descend into sub-folders")

    g = p.add_argument_group("layout")
    g.add_argument("--grid", metavar="RxC",
                   help="force a grid, e.g. 12x12, using sorted file order")
    g.add_argument("--serpentine", action="store_true",
                   help="with --grid: every other row is scanned backwards")
    g.add_argument("--transpose", action="store_true",
                   help="swap the meaning of the row/col indices in file names")
    g.add_argument("--no-grid", action="store_true",
                   help="ignore file names, match every pair of tiles")
    g.add_argument("--motor-pairs", type=int, default=None, metavar="K",
                   help="use trailing _<x>_<y> motor step positions in file names "
                        "to build a spatial neighbour graph (K nearest + temporal) "
                        "and seed registration; auto-detected when every file "
                        "carries the positions")

    g = p.add_argument_group("registration")
    g.add_argument("--coarse-scale", type=float, default=0.0,
                   help="downscale for the global search (0 = auto)")
    g.add_argument("--highpass", type=float, default=8.0,
                   help="high-pass sigma (px, at full res) before correlating")
    g.add_argument("--min-overlap", type=float, default=0.02,
                   help="minimum overlap as a fraction of a tile's area")
    g.add_argument("--min-score", type=float, default=0.3,
                   help="NCC below this counts as a failed pair")
    g.add_argument("--refine-margin", type=int, default=12,
                   help="refinement search radius in px (pass 1)")
    g.add_argument("--refine-window", type=int, default=90,
                   help="search radius around the predicted position (pass 2)")
    g.add_argument("--passes", type=int, default=2, choices=(1, 2),
                   help="2 = re-try failed pairs using the solved layout as prior")
    g.add_argument("--jobs", type=int, default=0, help="worker processes (0 = auto)")

    g = p.add_argument_group("learned matching (optional, needs torch + kornia)")
    g.add_argument("--matcher", choices=("none", "loftr"), default="none",
                   help="dense neural matcher to rescue pairs correlation cannot "
                        "solve; its proposal is always verified by NCC")
    g.add_argument("--matcher-weights", choices=("outdoor", "indoor"), default="outdoor",
                   help="LoFTR pretrained weights")
    g.add_argument("--matcher-device", default="auto", help="cuda | cpu | auto")
    g.add_argument("--matcher-long-side", type=int, default=1024,
                   help="resize tiles to this long side before matching")
    g.add_argument("--matcher-conf", type=float, default=0.5,
                   help="minimum LoFTR match confidence")
    g.add_argument("--matcher-window", type=int, default=64,
                   help="NCC verification radius around the LoFTR proposal (px)")

    g = p.add_argument_group("photometry / blending")
    g.add_argument("--blend", choices=("feather", "none"), default="feather")
    g.add_argument("--feather-power", type=float, default=1.0,
                   help=">1 narrows the blend zone, <1 widens it")
    g.add_argument("--crop", type=int, default=0,
                   help="discard this many px from every tile border")
    g.add_argument("--no-flatfield", action="store_true",
                   help="skip vignetting / illumination correction")
    g.add_argument("--flatfield-samples", type=int, default=48)
    g.add_argument("--flatfield-percentile", type=float, default=50.0)
    g.add_argument("--no-gain-comp", action="store_true",
                   help="skip per-tile exposure equalisation")
    g.add_argument("--no-subpixel", dest="subpixel", action="store_false",
                   help="place tiles on integer pixels only")

    g = p.add_argument_group("output")
    g.add_argument("--preview", type=int, default=4000,
                   help="also write a downscaled preview JPEG (0 = off)")
    g.add_argument("--max-dim", type=int, default=0,
                   help="downscale the mosaic so neither side exceeds this")
    g.add_argument("--jpeg-quality", type=int, default=92)
    g.add_argument("--positions", help="JSON file to write (and reuse) tile positions")
    g.add_argument("--report", help="JSON file with per-pair registration quality")
    g.add_argument("--dry-run", action="store_true",
                   help="register and report, but do not blend/write the mosaic")
    g.add_argument("--band", type=int, default=2048, help="compositing band height (px)")
    g.add_argument("--tile-cache", type=int, default=24,
                   help="tiles kept decoded in RAM while blending")
    g.add_argument("-q", "--quiet", action="store_true")

    g = p.add_argument_group("incremental sessions")
    g.add_argument("--session", metavar="FILE",
                   help="mosaic state you can keep extending.  On a build it is "
                        "written; 'add' and 'watch' require it")
    g.add_argument("--add-candidates", type=int, default=8,
                   help="how many placed tiles a new image is matched against "
                        "when its name carries no grid indices")
    g.add_argument("--add-window", type=int, default=24,
                   help="add: registration search radius (px) around a screened "
                        "position; a pair that fails in it is retried once with "
                        "--refine-window")
    g.add_argument("--interval", type=float, default=3.0,
                   help="watch: seconds between folder scans")
    g.add_argument("--repaint-all", action="store_true",
                   help="after adding, re-estimate the flat-field and gains over "
                        "every tile and re-blend the whole mosaic instead of only "
                        "the new area (slower, removes photometric drift)")

    g = p.add_argument_group("locate (marker mode)")
    g.add_argument("--patch", metavar="FILE",
                   help="locate: image patch to find inside the session mosaic")
    g.add_argument("--patch-scale", type=float, default=1.0,
                   help="locate: resize the patch by this factor before searching "
                        "(video px -> mosaic px, e.g. 0.5 when the session tiles "
                        "are half-resolution copies of the camera frame)")
    g.add_argument("--expect-x", type=float, default=None,
                   help="locate: expected patch position (world px), speeds up "
                        "and stabilises the search")
    g.add_argument("--expect-y", type=float, default=None)
    g.add_argument("--radius", type=float, default=0.0,
                   help="locate: search radius around --expect-x/--expect-y "
                        "(world px, 0 = search the whole mosaic)")

    args = p.parse_args(argv)
    _VERBOSE = not args.quiet
    args.mode = mode

    if mode in ("add", "watch"):
        if not args.session:
            raise SystemExit(f"error: '{mode}' needs --session FILE")
        return cmd_add(args) if mode == "add" else cmd_watch(args)

    if mode == "locate":
        if not args.session:
            raise SystemExit("error: 'locate' needs --session FILE")
        return cmd_locate(args)

    # ---------------------------------------------------------------- tiles --
    tiles = discover_tiles(args.input, args.pattern, args.recursive)
    log(f"found {len(tiles)} images")
    if len(tiles) < 2:
        raise SystemExit("error: need at least 2 images to stitch")

    grid = False
    if not args.no_grid:
        if args.grid:
            m = re.fullmatch(r"(\d+)\s*[xX,]\s*(\d+)", args.grid.strip())
            if not m:
                raise SystemExit("error: --grid expects ROWSxCOLS, e.g. 12x12")
            assign_grid(tiles, int(m.group(1)), int(m.group(2)), args.serpentine)
            grid = True
        else:
            grid, ignored = infer_grid(tiles, args.transpose)
            if ignored:
                names = ", ".join(t.name for t in ignored[:3])
                more = f" (+{len(ignored) - 3} more)" if len(ignored) > 3 else ""
                log(f"ignoring {len(ignored)} file(s) without grid indices: "
                    f"{names}{more}")
                keep = {t.idx for t in ignored}
                tiles = [t for t in tiles if t.idx not in keep]
                for i, t in enumerate(tiles):
                    t.idx = i
    if grid:
        nr = max(t.row for t in tiles) + 1
        nc = max(t.col for t in tiles) + 1
        log(f"grid layout: {nr} rows x {nc} cols ({len(tiles)} tiles)")
    else:
        log("no grid layout detected -> matching all tile pairs")

    # ---- motor prior (fog-of-war): spatial neighbour graph from step positions --
    b_motor = False
    if not grid:
        if args.motor_pairs is not None:
            if not infer_motor(tiles):
                raise SystemExit("error: --motor-pairs needs file names with "
                                 "trailing _<x>_<y> step positions")
            b_motor = True
        elif infer_motor(tiles):
            b_motor = True
    if b_motor:
        log(f"motor prior: {len(tiles)} tiles carry step positions -> "
            f"spatial neighbour graph (k={args.motor_pairs or 6})")

    probe = imread(tiles[0].path, cv2.IMREAD_COLOR)
    h, w = probe.shape[:2]
    tile_area = h * w
    log(f"tile size: {w} x {h}")
    del probe

    odd = odd_sized(tiles, (h, w))
    if odd:
        warn(f"{len(odd)} image(s) differ in size from {tiles[0].name} "
             f"(e.g. {odd[0]}); they will be resized to {w} x {h}")

    scale = args.coarse_scale or min(1.0, 512.0 / max(w, h))
    jobs = args.jobs or min(os.cpu_count() or 4, 16)
    paths = [t.path for t in tiles]

    # ------------------------------------------------------------- register --
    import multiprocessing as mp

    def run_pool(tasks) -> List[Edge]:
        if jobs <= 1:
            _worker_init(paths, scale, args.highpass, args.min_overlap,
                         args.refine_margin, 8)
            return [register_pair(t) for t in tasks]
        ctx = mp.get_context("fork" if hasattr(os, "fork") else "spawn")
        out: List[Edge] = []
        with ctx.Pool(jobs, initializer=_worker_init,
                      initargs=(paths, scale, args.highpass, args.min_overlap,
                                args.refine_margin, 6)) as pool:
            for k, e in enumerate(pool.imap_unordered(register_pair, tasks, chunksize=1), 1):
                out.append(e)
                if k % 25 == 0 or k == len(tasks):
                    log(f"  {k}/{len(tasks)} pairs")
        return out

    n_ms__t0 = time.perf_counter()
    if b_motor:
        # phase A: register the temporal chain (no prior) -- fast and establishes
        # the frame-to-frame pixel shifts used to calibrate px/step
        pairs = build_motor_pairs(tiles, args.motor_pairs or 6)
        a_chain = [(i, j) for (i, j) in pairs if j == i + 1]
        a_loop = [(i, j) for (i, j) in pairs if j != i + 1]
        log(f"registering {len(pairs)} pairs ({len(a_chain)} chain, "
            f"{len(a_loop)} loop) on {jobs} workers (coarse scale {scale:.3f})")
        edges = run_pool([(i, j, None, 0) for i, j in a_chain])
        o_scl = f_o_motor_scl(tiles, edges, args.min_score)
        if o_scl is not None:
            log(f"motor calibration: {o_scl[0]:.4f} px/step (x), "
                f"{o_scl[1]:.4f} px/step (y)")
            # phase B: seed the loop pairs with the motor-predicted offset
            a_task = []
            for (i, j) in a_loop:
                n_dx = (tiles[j].x_mot - tiles[i].x_mot) * o_scl[0]
                n_dy = (tiles[j].y_mot - tiles[i].y_mot) * o_scl[1]
                n_radius = max(args.refine_margin,
                               int(0.2 * math.hypot(n_dx, n_dy)) + 40)
                a_task.append((i, j, (n_dx, n_dy), n_radius))
            edges += run_pool(a_task)
        else:
            log("motor calibration: too few good chain edges -> loop pairs "
                "registered without a prior")
            edges += run_pool([(i, j, None, 0) for i, j in a_loop])
        edges.sort(key=lambda e: (e.i, e.j))
    else:
        pairs = build_pairs(tiles, grid)
        log(f"registering {len(pairs)} pairs on {jobs} workers "
            f"(coarse scale {scale:.3f})")
        edges = run_pool([(i, j, None, 0) for i, j in pairs])
        edges.sort(key=lambda e: (e.i, e.j))
    n_ms__reg1 = (time.perf_counter() - n_ms__t0) * 1000

    def report(tag: str):
        ok = [e for e in edges if e.score >= args.min_score]
        sc = [e.score for e in edges if e.score > NEG_INF]
        a_n_ms = [e.ms for e in edges if e.ms > 0]
        s_ms = ""
        if a_n_ms:
            s_ms = (f", pairs median {np.median(a_n_ms):.0f}ms "
                    f"max {max(a_n_ms):.0f}ms")
        log(f"{tag}: {len(ok)}/{len(edges)} pairs accepted "
            f"(median NCC {np.median(sc) if sc else float('nan'):.3f}){s_ms}")
        return ok

    report("pass 1")

    def any_accepted() -> bool:
        return any(e.score >= args.min_score for e in edges)

    if not any_accepted() and args.matcher != "none":
        # nothing to build a layout prior from -- give the matcher its turn first
        log("no pair solved by correlation -> going straight to the matcher")
        loftr_rescue(tiles, edges, args, (h, w), tile_area)
        report("after matcher")

    if not any_accepted():
        raise SystemExit(
            "error: no tile pair could be registered.  Are these images really "
            "overlapping?  Try --min-score 0.15, --no-grid, or --matcher loftr.")

    def make_edge_set(base: List[Edge]) -> List[Edge]:
        """Accepted pairs + weak predicted priors so the graph stays connected."""
        es = [e for e in base if e.score >= args.min_score]
        for e in es:
            e.weight = edge_weight(e, tile_area)
        if grid:
            model = StepModel(tiles, base, args.min_score)
            for kind, st in sorted(model.kind_median.items()):
                log(f"median {kind} step: ({st[0]:.1f}, {st[1]:.1f})")
            for e in base:
                if e.score >= args.min_score:
                    continue
                pred = model.predict(tiles, e)
                if pred is None:
                    continue
                pe = Edge(e.i, e.j, pred[0], pred[1], score=0.0, kind=pred[2])
                pe.weight = edge_weight(pe, tile_area)
                es.append(pe)
        return es

    n_ms__t1 = time.perf_counter()
    used = make_edge_set(edges)
    pos = solve_positions(len(tiles), used)
    n_ms__solve = (time.perf_counter() - n_ms__t1) * 1000

    # ------------------------------------------------- pass 2: guided retry --
    n_ms__pass2 = 0.0
    if args.passes >= 2:
        retry = [e for e in edges if e.score < args.min_score]
        if retry:
            log(f"pass 2: re-registering {len(retry)} pairs around the solved layout")
            tasks = [(e.i, e.j,
                      (pos[e.j][0] - pos[e.i][0], pos[e.j][1] - pos[e.i][1]),
                      args.refine_window) for e in retry]
            n_ms__t2 = time.perf_counter()
            improved = run_pool(tasks)
            n_ms__pass2 = (time.perf_counter() - n_ms__t2) * 1000
            byij = {(e.i, e.j): e for e in edges}
            for e in improved:
                old = byij[(e.i, e.j)]
                if e.score > old.score:
                    byij[(e.i, e.j)] = e
            edges = sorted(byij.values(), key=lambda e: (e.i, e.j))
            report("pass 2")
            n_ms__t3 = time.perf_counter()
            used = make_edge_set(edges)
            pos = solve_positions(len(tiles), used)
            n_ms__solve = (time.perf_counter() - n_ms__t3) * 1000

    # ------------------------------------------- pass 3: learned matching --
    n_ms__match = 0.0
    if args.matcher != "none":
        n_ms__t2 = time.perf_counter()
        if loftr_rescue(tiles, edges, args, (h, w), tile_area):
            report("after matcher")
            n_ms__t3 = time.perf_counter()
            used = make_edge_set(edges)
            pos = solve_positions(len(tiles), used)
            n_ms__solve = (time.perf_counter() - n_ms__t3) * 1000
        n_ms__match = (time.perf_counter() - n_ms__t2) * 1000

    groups = components(len(tiles), used)
    if len(groups) > 1:
        warn(f"the tiles form {len(groups)} disconnected groups "
             f"(sizes {', '.join(str(len(g)) for g in groups[:6])}"
             f"{'...' if len(groups) > 6 else ''}).  Nothing ties them together, "
             "so their relative placement is arbitrary and the mosaic will have "
             "overlapping junk.  Stray images in the folder?  Otherwise try "
             "--min-score 0.15 or --matcher loftr.")
        for g in groups[1:]:
            if len(g) <= 4:
                warn(f"  unconnected: {', '.join(tiles[k].name for k in g)}")

    meas = [e for e in used if e.kind == "measured"]
    if meas:
        res = np.array([e.residual for e in meas])
        log(f"layout residuals: median {np.median(res):.2f} px, "
            f"90th pct {np.percentile(res, 90):.2f} px, max {res.max():.2f} px")
        bad = [e for e in meas if e.residual > 25]
        if bad:
            warn(f"{len(bad)} well-scored pairs disagree with the layout by >25 px "
                 f"(worst: {tiles[bad[0].i].name} -> {tiles[bad[0].j].name})")

    for t, (x, y) in zip(tiles, pos):
        t.x, t.y = float(x), float(y)

    if args.positions:
        with open(args.positions, "w") as fh:
            json.dump({"tile_size": [w, h],
                       "tiles": [{"file": t.name, "path": t.path, "row": t.row,
                                  "col": t.col, "x": t.x, "y": t.y} for t in tiles]},
                      fh, indent=1)
        log(f"wrote positions -> {args.positions}")
    if args.report:
        with open(args.report, "w") as fh:
            json.dump([{"a": tiles[e.i].name, "b": tiles[e.j].name, "dx": e.dx,
                        "dy": e.dy, "ncc": e.score, "overlap_px": e.area,
                        "kind": e.kind, "residual": e.residual} for e in edges],
                      fh, indent=1)
        log(f"wrote report -> {args.report}")

    span_x = pos[:, 0].max() - pos[:, 0].min() + w
    span_y = pos[:, 1].max() - pos[:, 1].min() + h
    log(f"mosaic extent: {span_x:.0f} x {span_y:.0f} px")

    holes = coverage_report(tiles, pos, (h, w))
    if holes > 0.0005:
        warn(f"{holes * 100:.2f}% of the scanned area is not covered by any tile: "
             "the scan itself has gaps (stage stepped further than one tile). "
             "Those areas stay black -- no stitcher can recover them.")
    if args.dry_run:
        log(f"dry run -> not blending "
            f"(register {f_s_dur(n_ms__reg1 / 1000)}, "
            f"solve {f_s_dur(n_ms__solve / 1000)})")
        return 0

    # ------------------------------------------------------------ photometry --
    n_ms__flat = n_ms__gain = 0.0
    field = None
    if not args.no_flatfield:
        log("estimating flat-field (vignetting) correction")
        n_ms__t2 = time.perf_counter()
        field = estimate_flatfield(paths, args.flatfield_samples,
                                   args.flatfield_percentile)
        n_ms__flat = (time.perf_counter() - n_ms__t2) * 1000
        if field.shape[:2] != (h, w):
            field = cv2.resize(field, (w, h), interpolation=cv2.INTER_LINEAR)

    gains = None
    if not args.no_gain_comp:
        log("computing exposure gains")
        n_ms__t2 = time.perf_counter()
        gains = compute_gains(tiles, [e for e in used if e.kind == "measured"],
                              field, (h, w))
        n_ms__gain = (time.perf_counter() - n_ms__t2) * 1000
        log(f"gains: min {gains.min():.3f}, max {gains.max():.3f}")

    # ------------------------------------------------------------- composite --
    n_ms__t2 = time.perf_counter()
    mosaic, origin = composite(tiles, pos, (h, w), args, field, gains)
    n_ms__comp = (time.perf_counter() - n_ms__t2) * 1000

    out_path = args.output
    if not out_path:
        src = os.path.abspath(args.input[0].rstrip(os.sep))
        base = os.path.basename(src) or "mosaic"
        out_path = os.path.join(os.path.dirname(src), f"{base}_mosaic.png")

    # ---------------------------------------------------- extendable session --
    if args.session:
        if args.max_dim:
            warn("--max-dim rescales the mosaic but the session stores full-"
                 "resolution positions; later 'add' runs would not line up.  "
                 "Not writing a session.")
            args.session = None
        else:
            sess = Session(args.session)
            sess.tile_size = (w, h)
            sess.origin = origin
            sess.canvas = (mosaic.shape[1], mosaic.shape[0])
            sess.mosaic_name = os.path.relpath(os.path.abspath(out_path), sess.dir)
            sess.tiles = tiles
            sess.gains = list(gains) if gains is not None else [1.0] * len(tiles)
            sess.edges = [e for e in used if e.kind != "prior"]
            sess.config = {k: getattr(args, k) for k in CONFIG_KEYS}
            sess.config["coarse_scale"] = scale
            if field is not None:
                sess.field_name = os.path.basename(
                    os.path.splitext(args.session)[0] + "_flatfield.npy")
                np.save(sess.rel(sess.field_name), field)
            sess.save()
            log(f"wrote session -> {sess.path}  "
                f"(extend it with:  stitch.py add <images> --session "
                f"{os.path.basename(sess.path)})")

    if args.max_dim:
        m = args.max_dim / max(mosaic.shape[0], mosaic.shape[1])
        if m < 1.0:
            log(f"downscaling mosaic by {m:.3f} (--max-dim {args.max_dim})")
            mosaic = cv2.resize(mosaic, None, fx=m, fy=m, interpolation=cv2.INTER_AREA)

    n_ms__t2 = time.perf_counter()
    log(f"writing {out_path} ({mosaic.shape[1]} x {mosaic.shape[0]})")
    write_image(out_path, mosaic, args.jpeg_quality)
    if args.preview:
        s = args.preview / max(mosaic.shape[0], mosaic.shape[1])
        if s < 1.0:
            prev = cv2.resize(mosaic, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
            ppath = os.path.splitext(out_path)[0] + "_preview.jpg"
            write_image(ppath, prev, args.jpeg_quality)
            log(f"wrote preview -> {ppath}")
    n_ms__write = (time.perf_counter() - n_ms__t2) * 1000

    a_s_timing = [
        f"register {f_s_dur(n_ms__reg1 / 1000)}",
        f"solve {f_s_dur(n_ms__solve / 1000)}",
    ]
    if n_ms__pass2:
        a_s_timing.append(f"pass2 {f_s_dur(n_ms__pass2 / 1000)}")
    if n_ms__match:
        a_s_timing.append(f"matcher {f_s_dur(n_ms__match / 1000)}")
    if n_ms__flat:
        a_s_timing.append(f"flatfield {f_s_dur(n_ms__flat / 1000)}")
    if n_ms__gain:
        a_s_timing.append(f"gains {f_s_dur(n_ms__gain / 1000)}")
    a_s_timing.append(f"composite {f_s_dur(n_ms__comp / 1000)}")
    a_s_timing.append(f"write {f_s_dur(n_ms__write / 1000)}")
    log("build timing: " + " | ".join(a_s_timing))

    log("done")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
