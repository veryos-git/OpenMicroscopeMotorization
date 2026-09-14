#!/usr/bin/env python3
"""
fog_of_war.py -- real-time incremental microscope slide mosaicking (ML).

Builds a persistent "world map" of a slide as the stage moves under a fixed
camera, fog-of-war style: every successfully registered frame is composited
onto a growing canvas and stays revealed even after the camera moves away.

Registration uses SuperPoint + LightGlue (the learned matcher in
lgsp_imerge.py) -- robust to low-texture / repetitive / slightly-rotated
microscope content, unlike pure phase correlation.  A motor-predicted
displacement may be passed in as a *prior* sanity signal; the image-based
result is always the source of truth.

The classical (FFT phase correlation / ECC / ORB) implementation lives in
old/fog_of_war_classical.py.

Usage (testable in isolation):
    ./fog_of_war.py register a.png b.png
    ./fog_of_war.py build folder/ -o mosaic.png
    ./fog_of_war.py add frame.png --session s.json
    ./fog_of_war.py watch folder/ --session s.json
    ./fog_of_war.py export --session s.json -o mosaic.png
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

import cv2
import numpy as np

# import the SuperPoint + LightGlue matcher from the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lgsp_imerge import init_models, try_match

# --------------------------------------------------------------------------- #
# tunable constants
# --------------------------------------------------------------------------- #

N_KPT = 512                # SuperPoint keypoints
N_DOWNSCALE = 0.4          # registration downscale factor
N_USE_ECC = True           # ECC sub-pixel refinement after the LightGlue match
N_PX__ECC_SIDE = 512       # ECC refinement long side (px)
N_CONF__ECC_MIN = 0.20     # ECC correlation coefficient below this is untrusted
N_PX__ECC_MAX_CORR = 6.0   # max ECC correction (px) before reverting to the seed
N_PX__MIN_SHIFT = 6.0      # committed translation must exceed this (full-res px)
N_CONF__MIN = 0.30         # min inlier fraction to trust a match (0..1)
N_INLIER__MIN = 0.50       # min inlier fraction to re-locate against a keyframe
N_KEYFRAME_MAX = 8         # reference frames kept for re-acquisition / drift
N_IT__KEYFRAME = 5         # add a keyframe every this many commits
N_IT__DRIFT = 20           # re-anchor to a keyframe every this many commits
N_PX__FEATHER = 48         # feather band width at the frame border (px)
N_PX__CANVAS_MAX = 30000   # canvas side safety cap (px)
N_PX__PREVIEW = 1600       # client preview / minimap long side (px)
N_QUALITY__JPEG = 88


# --------------------------------------------------------------------------- #
# model init (once)
# --------------------------------------------------------------------------- #

_b_models_ready = False


def f_init():
    global _b_models_ready
    if not _b_models_ready:
        init_models(N_KPT)
        _b_models_ready = True


def f_o_register(o_ref, o_mov):
    """SuperPoint + LightGlue translation between two full-res images.

    Returns (dx, dy, confidence, method) with dx/dy in full-res px and
    confidence = inlier fraction (0..1), or (0, 0, 0, 'none') on failure.
    Convention: ``mov`` placed at ``ref + (dx, dy)`` aligns with ``ref``.
    """
    f_init()
    o_saved = sys.stdout
    sys.stdout = sys.stderr          # keep try_match's logs off the JSON stdout
    try:
        o_match, _o_stat = try_match(o_ref, o_mov, ['clahe'],
                                     min_match_pct=8.0, n_downscale=N_DOWNSCALE,
                                     matches_path=None)
    finally:
        sys.stdout = o_saved
    if o_match is None:
        return 0.0, 0.0, 0.0, "none"
    n_conf = float(o_match.get('n_pct__inlier', 0.0)) / 100.0
    # try_match returns (pts_ref - pts_mov), i.e. the *negated* placement shift;
    # we want "mov placed at ref + (dx, dy)", so flip the sign
    n_dx = -float(o_match['n_dx'])
    n_dy = -float(o_match['n_dy'])
    s_method = "lightglue"
    if N_USE_ECC:
        n_dx, n_dy = f_o_refine_ecc(o_ref, o_mov, n_dx, n_dy)
        s_method = "lightglue+ecc"
    return n_dx, n_dy, n_conf, s_method


def f_o_gray(o_img, n_scl):
    """Grayscale float32 resized by ``n_scl`` (no highpass — ECC uses intensity)."""
    if o_img.ndim == 3:
        o_img = cv2.cvtColor(o_img, cv2.COLOR_BGR2GRAY)
    o_img = o_img.astype(np.float32)
    if n_scl < 1.0:
        o_img = cv2.resize(o_img, None, fx=n_scl, fy=n_scl,
                           interpolation=cv2.INTER_AREA)
    return o_img


def f_o_refine_ecc(o_ref, o_mov, n_dx0, n_dy0):
    """Sub-pixel ECC translation refinement, seeded by an integer LightGlue shift.
    Returns (dx, dy) in full-res px; reverts to the seed if ECC diverges."""
    n_scl = N_PX__ECC_SIDE / max(o_ref.shape[:2])
    o_a = f_o_gray(o_ref, n_scl)
    o_b = f_o_gray(o_mov, n_scl)
    o_warp = np.eye(2, 3, dtype=np.float32)
    o_warp[0, 2] = n_dx0 * n_scl
    o_warp[1, 2] = n_dy0 * n_scl
    try:
        n_cc, o_warp = cv2.findTransformECC(
            o_a, o_b, o_warp, cv2.MOTION_TRANSLATION,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-5))
    except cv2.error:
        return n_dx0, n_dy0
    n_dx = float(o_warp[0, 2]) / n_scl
    n_dy = float(o_warp[1, 2]) / n_scl
    # keep the seed when ECC could not lock onto the true peak
    if n_cc < N_CONF__ECC_MIN or math.hypot(n_dx - n_dx0, n_dy - n_dy0) > N_PX__ECC_MAX_CORR:
        return n_dx0, n_dy0
    return n_dx, n_dy


# --------------------------------------------------------------------------- #
# compositing helpers
# --------------------------------------------------------------------------- #

def f_o_feather(n_h, n_w, n_band):
    """Blend weight: 1 in the interior, ramping to ~0 at the border over
    ``n_band`` px (distance transform)."""
    n_c = max(0, min(int(n_band), min(n_h, n_w) // 2 - 1))
    if n_c == 0:
        return np.ones((n_h, n_w), dtype=np.float32)
    o_m = np.zeros((n_h, n_w), dtype=np.uint8)
    o_m[n_c:n_h - n_c, n_c:n_w - n_c] = 255
    o_dist = cv2.distanceTransform(o_m, cv2.DIST_L2, 3)
    n_max = float(o_dist.max())
    if n_max <= 0:
        return np.ones((n_h, n_w), dtype=np.float32)
    o_wgt = (o_dist / n_max).astype(np.float32)
    return np.maximum(o_wgt, 1e-4)


# --------------------------------------------------------------------------- #
# growing mosaic
# --------------------------------------------------------------------------- #

class FogMosaic:
    """A persistent, auto-growing canvas frames get composited into.

    World coordinates are full-res px; a frame is placed at its top-left world
    position (n_x, n_y).  The canvas stores an origin (n_x__min, n_y__min) and
    grows in any direction as the stage explores.
    """

    def __init__(self):
        self.n_scl_x__frame = 0
        self.n_scl_y__frame = 0
        self.o_canvas = None          # uint8 BGR, full-res
        self.o_mask = None            # uint8 0/255 filled mask
        self.n_x__min = 0.0
        self.n_y__min = 0.0
        self.n_x__view = 0.0          # world pos of the last committed frame
        self.n_y__view = 0.0
        self.o_last_frame = None      # full-res BGR of the last committed frame
        self.o_feather = None         # cached feather mask
        self.a_o_keyframe = []        # [{n_x, n_y, o_frame}] reference frames
        self.n_commit = 0
        self.n_lost = 0
        self.n_skip = 0
        self.a_s_line = []

    # ------------------------------------------------------------ helpers --
    def f_log(self, s_line):
        self.a_s_line.append(s_line)
        sys.stderr.write(s_line + "\n")
        sys.stderr.flush()

    def f_o_status(self):
        n_scl_x__mosaic = n_scl_y__mosaic = 0
        if self.o_canvas is not None:
            n_scl_y__mosaic, n_scl_x__mosaic = self.o_canvas.shape[:2]
        return {
            "n_scl_x__frame": self.n_scl_x__frame,
            "n_scl_y__frame": self.n_scl_y__frame,
            "n_scl_x__mosaic": n_scl_x__mosaic,
            "n_scl_y__mosaic": n_scl_y__mosaic,
            "n_x__min": self.n_x__min,
            "n_y__min": self.n_y__min,
            "n_x__view": self.n_x__view,
            "n_y__view": self.n_y__view,
            "n_commit": self.n_commit,
            "n_lost": self.n_lost,
            "n_skip": self.n_skip,
        }

    def f_o_preview(self):
        """Downscaled BGR copy of the canvas for the client minimap."""
        if self.o_canvas is None:
            return None
        n_scl = N_PX__PREVIEW / max(self.o_canvas.shape[:2])
        if n_scl >= 1.0:
            return self.o_canvas.copy()
        return cv2.resize(self.o_canvas, None, fx=n_scl, fy=n_scl,
                          interpolation=cv2.INTER_AREA)

    # --------------------------------------------------------- compositing --
    def f_grow(self, n_x, n_y, n_w, n_h):
        """Grow the canvas so the rect (n_x, n_y, n_w, n_h) fits."""
        if self.o_canvas is None:
            self.o_canvas = np.zeros((n_h, n_w, 3), dtype=np.uint8)
            self.o_mask = np.zeros((n_h, n_w), dtype=np.uint8)
            self.n_x__min = float(n_x)
            self.n_y__min = float(n_y)
            return
        n_x0 = min(self.n_x__min, float(n_x))
        n_y0 = min(self.n_y__min, float(n_y))
        n_x1 = max(self.n_x__min + self.o_canvas.shape[1], float(n_x) + n_w)
        n_y1 = max(self.n_y__min + self.o_canvas.shape[0], float(n_y) + n_h)
        n_cw = int(np.ceil(n_x1 - n_x0))
        n_ch = int(np.ceil(n_y1 - n_y0))
        if n_cw > N_PX__CANVAS_MAX or n_ch > N_PX__CANVAS_MAX:
            raise RuntimeError("mosaic canvas exceeded the safety cap")
        if n_cw == self.o_canvas.shape[1] and n_ch == self.o_canvas.shape[0] \
                and n_x0 == self.n_x__min and n_y0 == self.n_y__min:
            return
        o_new = np.zeros((n_ch, n_cw, 3), dtype=np.uint8)
        o_mask_new = np.zeros((n_ch, n_cw), dtype=np.uint8)
        n_ox = int(round(self.n_x__min - n_x0))
        n_oy = int(round(self.n_y__min - n_y0))
        o_new[n_oy:n_oy + self.o_canvas.shape[0],
              n_ox:n_ox + self.o_canvas.shape[1]] = self.o_canvas
        o_mask_new[n_oy:n_oy + self.o_canvas.shape[0],
                   n_ox:n_ox + self.o_canvas.shape[1]] = self.o_mask
        self.o_canvas = o_new
        self.o_mask = o_mask_new
        self.n_x__min = n_x0
        self.n_y__min = n_y0

    def f_composite(self, o_frame, n_x, n_y):
        """Feather-blend a full-res frame into the canvas at world (n_x, n_y)."""
        n_h, n_w = o_frame.shape[:2]
        if self.o_feather is None or self.o_feather.shape[:2] != (n_h, n_w):
            self.o_feather = f_o_feather(n_h, n_w, N_PX__FEATHER)
        o_w = self.o_feather
        self.f_grow(n_x, n_y, n_w, n_h)
        n_cx = int(round(n_x - self.n_x__min))
        n_cy = int(round(n_y - self.n_y__min))
        n_cx0, n_cy0 = max(0, n_cx), max(0, n_cy)
        n_cx1 = min(self.o_canvas.shape[1], n_cx + n_w)
        n_cy1 = min(self.o_canvas.shape[0], n_cy + n_h)
        if n_cx1 <= n_cx0 or n_cy1 <= n_cy0:
            return
        n_sx0, n_sy0 = n_cx0 - n_cx, n_cy0 - n_cy
        o_patch = o_frame[n_sy0:n_sy0 + (n_cy1 - n_cy0),
                          n_sx0:n_sx0 + (n_cx1 - n_cx0)].astype(np.float32)
        o_w_patch = o_w[n_sy0:n_sy0 + (n_cy1 - n_cy0), n_sx0:n_sx0 + (n_cx1 - n_cx0)]
        o_canvas_patch = self.o_canvas[n_cy0:n_cy1, n_cx0:n_cx1].astype(np.float32)
        o_mask_patch = self.o_mask[n_cy0:n_cy1, n_cx0:n_cx1]
        o_is_new = (o_mask_patch == 0)
        o_is_old = (o_mask_patch == 255)
        o_blended = o_canvas_patch * (1.0 - o_w_patch[..., None]) + o_patch * o_w_patch[..., None]
        o_out = np.where(o_is_old[..., None], o_blended, o_canvas_patch)
        o_out = np.where(o_is_new[..., None], o_patch, o_out)
        self.o_canvas[n_cy0:n_cy1, n_cx0:n_cx1] = np.clip(o_out, 0, 255).astype(np.uint8)
        self.o_mask[n_cy0:n_cy1, n_cx0:n_cx1] = 255

    # --------------------------------------------------------- re-acquisition --
    def f_add_keyframe(self, o_frame, n_x, n_y):
        self.a_o_keyframe.append({"n_x": float(n_x), "n_y": float(n_y),
                                  "o_frame": o_frame})
        if len(self.a_o_keyframe) > N_KEYFRAME_MAX:
            self.a_o_keyframe.pop(0)

    def f_o_relocate(self, o_frame):
        """Match the frame against stored keyframes to re-localize after a jump.
        Returns (world_x, world_y, confidence) or None."""
        for o_kf in reversed(self.a_o_keyframe):
            n_dx, n_dy, n_conf, _ = f_o_register(o_kf["o_frame"], o_frame)
            if n_conf >= N_INLIER__MIN:
                return o_kf["n_x"] + n_dx, o_kf["n_y"] + n_dy, n_conf
        return None

    def f_drift_correct(self, o_frame):
        """Re-anchor the view against the nearest keyframe to cancel drift."""
        if not self.a_o_keyframe:
            return
        o_kf = min(self.a_o_keyframe,
                   key=lambda k: math.hypot(k["n_x"] - self.n_x__view,
                                            k["n_y"] - self.n_y__view))
        n_dx, n_dy, n_conf, _ = f_o_register(o_kf["o_frame"], o_frame)
        if n_conf >= N_INLIER__MIN:
            n_wx = o_kf["n_x"] + n_dx
            n_wy = o_kf["n_y"] + n_dy
            n_err = math.hypot(n_wx - self.n_x__view, n_wy - self.n_y__view)
            if n_err > 1.0:
                self.f_log(f"  drift: re-anchored to keyframe "
                            f"(correction {n_err:.1f} px)")
            self.n_x__view, self.n_y__view = n_wx, n_wy

    # ---------------------------------------------------------------- add --
    def f_o_add(self, o_frame, n_prior_dx=None, n_prior_dy=None):
        """Register and (maybe) composite one full-res BGR frame."""
        n_h, n_w = o_frame.shape[:2]
        o_result = {
            "b_committed": False, "b_skip": False, "b_lost": False,
            "n_dx": 0.0, "n_dy": 0.0, "n_confidence": 0.0, "s_method": "none",
            "n_x__view": self.n_x__view, "n_y__view": self.n_y__view,
            "n_scl_x__frame": n_w, "n_scl_y__frame": n_h,
            "n_scl_x__mosaic": 0, "n_scl_y__mosaic": 0,
            "n_x__min": self.n_x__min, "n_y__min": self.n_y__min,
            "n_commit": self.n_commit, "n_lost": self.n_lost,
            "n_skip": self.n_skip, "s_error": "",
        }

        if self.o_last_frame is None:
            self.n_scl_x__frame, self.n_scl_y__frame = n_w, n_h
            self.f_composite(o_frame, 0.0, 0.0)
            self.n_x__view, self.n_y__view = 0.0, 0.0
            self.o_last_frame = o_frame
            self.f_add_keyframe(o_frame, 0.0, 0.0)
            self.n_commit = 1
            o_result.update({"b_committed": True, "s_method": "seed",
                             "n_x__view": 0.0, "n_y__view": 0.0,
                             "n_confidence": 1.0, "n_commit": 1})
            self.f_o_status_into(o_result)
            return o_result

        # ---- frame-to-frame (ML) ----
        n_dx, n_dy, n_conf, s_method = f_o_register(self.o_last_frame, o_frame)
        n_wx = self.n_x__view + n_dx
        n_wy = self.n_y__view + n_dy

        if n_conf < N_CONF__MIN:
            # lost locally -> re-acquire against keyframes
            o_rel = self.f_o_relocate(o_frame)
            if o_rel is not None:
                n_wx, n_wy, n_conf = o_rel
                n_dx, n_dy = n_wx - self.n_x__view, n_wy - self.n_y__view
                s_method = "keyframe"
            else:
                self.n_lost += 1
                o_result.update({"b_lost": True, "n_lost": self.n_lost,
                                 "n_confidence": n_conf, "s_method": "none"})
                self.f_o_status_into(o_result)
                return o_result

        if math.hypot(n_dx, n_dy) < N_PX__MIN_SHIFT:
            self.n_skip += 1
            o_result.update({"b_skip": True, "n_skip": self.n_skip,
                             "n_confidence": n_conf, "s_method": s_method,
                             "n_dx": n_dx, "n_dy": n_dy})
            self.f_o_status_into(o_result)
            return o_result

        # ---- commit ----
        self.f_composite(o_frame, n_wx, n_wy)
        self.n_x__view, self.n_y__view = n_wx, n_wy
        self.o_last_frame = o_frame
        self.n_commit += 1
        o_result.update({"b_committed": True, "n_x__view": n_wx, "n_y__view": n_wy,
                         "n_confidence": n_conf, "n_commit": self.n_commit,
                         "s_method": s_method, "n_dx": n_dx, "n_dy": n_dy})

        if self.n_commit % N_IT__KEYFRAME == 0:
            self.f_add_keyframe(o_frame, n_wx, n_wy)
        if self.n_commit % N_IT__DRIFT == 0:
            self.f_drift_correct(o_frame)

        self.f_o_status_into(o_result)
        return o_result

    def f_o_status_into(self, o_result):
        o_status = self.f_o_status()
        for s_k in ("n_scl_x__mosaic", "n_scl_y__mosaic", "n_x__min", "n_y__min",
                    "n_commit", "n_lost", "n_skip"):
            o_result[s_k] = o_status[s_k]

    # --------------------------------------------------------- persistence --
    def f_save(self, s_path_session, s_path_mosaic):
        o_state = {
            "frame_size": [self.n_scl_x__frame, self.n_scl_y__frame],
            "origin": [self.n_x__min, self.n_y__min],
            "view": [self.n_x__view, self.n_y__view],
            "n_commit": self.n_commit,
            "n_lost": self.n_lost,
            "n_skip": self.n_skip,
        }
        o_tmp = s_path_session + ".tmp"
        with open(o_tmp, "w") as o_fh:
            json.dump(o_state, o_fh, indent=1)
        os.replace(o_tmp, s_path_session)
        if self.o_canvas is not None:
            cv2.imwrite(s_path_mosaic, self.o_canvas, [cv2.IMWRITE_JPEG_QUALITY, 95])
        if self.o_last_frame is not None:
            cv2.imwrite(os.path.splitext(s_path_session)[0] + "_last.jpg",
                        self.o_last_frame, [cv2.IMWRITE_JPEG_QUALITY, 90])

    def f_load(self, s_path_session, s_path_mosaic):
        with open(s_path_session) as o_fh:
            o_state = json.load(o_fh)
        if os.path.exists(s_path_mosaic):
            self.o_canvas = cv2.imread(s_path_mosaic)
            self.o_mask = np.full(self.o_canvas.shape[:2], 255, dtype=np.uint8)
        self.n_scl_x__frame, self.n_scl_y__frame = o_state["frame_size"]
        self.n_x__min, self.n_y__min = o_state["origin"]
        self.n_x__view, self.n_y__view = o_state["view"]
        self.n_commit = o_state.get("n_commit", 0)
        self.n_lost = o_state.get("n_lost", 0)
        self.n_skip = o_state.get("n_skip", 0)
        s_path_last = os.path.splitext(s_path_session)[0] + "_last.jpg"
        if os.path.exists(s_path_last):
            self.o_last_frame = cv2.imread(s_path_last)
            if self.o_last_frame is not None:
                self.f_add_keyframe(self.o_last_frame, self.n_x__view, self.n_y__view)


# --------------------------------------------------------------------------- #
# CLI (testable in isolation)
# --------------------------------------------------------------------------- #

_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp")


def _f_read(s_path):
    o_img = cv2.imread(s_path)
    if o_img is None:
        raise SystemExit(f"error: cannot read {s_path}")
    return o_img


def _f_b_image(s_name):
    return s_name.lower().endswith(_IMAGE_EXTS)


def _cmd_watch(s_folder, s_session, s_mosaic, n_interval):
    """Persistent folder watcher: adds frames as they arrive and prints one JSON
    line per frame on stdout (for the Deno server to forward to the client)."""
    f_init()
    o_mosaic = FogMosaic()
    if os.path.exists(s_session):
        o_mosaic.f_load(s_session, s_mosaic)

    a_s_done = set()
    try:
        for s_name in os.listdir(s_folder):
            if _f_b_image(s_name):
                a_s_done.add(os.path.join(s_folder, s_name))
    except OSError:
        pass

    o_seen = {}
    a_s_skip = {
        os.path.basename(s_session),
        os.path.basename(s_mosaic),
        os.path.splitext(os.path.basename(s_mosaic))[0] + "_preview.jpg",
        os.path.splitext(os.path.basename(s_session))[0] + "_last.jpg",
    }
    o_mosaic.f_log(f"fog watch (lightglue): folder {s_folder}")
    while True:
        try:
            time.sleep(n_interval)
        except KeyboardInterrupt:
            break
        a_s_new = []
        try:
            a_s_name = sorted(os.listdir(s_folder))
        except OSError:
            continue
        for s_name in a_s_name:
            if s_name in a_s_skip or not _f_b_image(s_name):
                continue
            s_path = os.path.join(s_folder, s_name)
            if s_path in a_s_done:
                continue
            n_size = os.path.getsize(s_path)
            if o_seen.get(s_path) == n_size and n_size > 0:
                a_s_new.append(s_path)
            o_seen[s_path] = n_size
        for s_path in a_s_new:
            a_s_done.add(s_path)
            o_result = o_mosaic.f_o_add(_f_read(s_path))
            o_mosaic.f_save(s_session, s_mosaic)
            o_preview = o_mosaic.f_o_preview()
            if o_preview is not None:
                cv2.imwrite(os.path.splitext(s_mosaic)[0] + "_preview.jpg",
                            o_preview, [cv2.IMWRITE_JPEG_QUALITY, N_QUALITY__JPEG])
            o_result["s_path_preview"] = os.path.splitext(s_mosaic)[0] + "_preview.jpg"
            print(json.dumps(o_result), flush=True)


def main(argv=None):
    o_p = argparse.ArgumentParser(
        prog="fog_of_war.py",
        description="ML incremental slide mosaicking (fog-of-war, SuperPoint+LightGlue)")
    o_sub = o_p.add_subparsers(dest="s_cmd")

    o_p_reg = o_sub.add_parser("register", help="register two images")
    o_p_reg.add_argument("s_ref")
    o_p_reg.add_argument("s_mov")

    o_p_build = o_sub.add_parser("build", help="mosaic a folder of frames")
    o_p_build.add_argument("s_folder")
    o_p_build.add_argument("-o", "--output", default="fog_mosaic.png")

    o_p_add = o_sub.add_parser("add", help="add one frame to a session")
    o_p_add.add_argument("s_frame")
    o_p_add.add_argument("--session", required=True)
    o_p_add.add_argument("--mosaic", default="")
    o_p_add.add_argument("--prior-dx", type=float, default=None)
    o_p_add.add_argument("--prior-dy", type=float, default=None)

    o_p_watch = o_sub.add_parser("watch", help="watch a folder and add frames")
    o_p_watch.add_argument("s_folder")
    o_p_watch.add_argument("--session", required=True)
    o_p_watch.add_argument("--mosaic", default="")
    o_p_watch.add_argument("--interval", type=float, default=0.25)

    o_p_exp = o_sub.add_parser("export", help="export the mosaic")
    o_p_exp.add_argument("--session", required=True)
    o_p_exp.add_argument("--mosaic", default="")
    o_p_exp.add_argument("-o", "--output", default="fog_mosaic.png")

    o_args = o_p.parse_args(argv)
    if o_args.s_cmd == "register":
        n_dx, n_dy, n_conf, s_method = f_o_register(_f_read(o_args.s_ref),
                                                    _f_read(o_args.s_mov))
        print(json.dumps({"n_dx": round(n_dx, 2), "n_dy": round(n_dy, 2),
                          "n_confidence": round(n_conf, 4), "s_method": s_method}))
        return 0

    o_mosaic = FogMosaic()

    if o_args.s_cmd == "build":
        a_s_path = sorted([
            os.path.join(o_args.s_folder, s)
            for s in os.listdir(o_args.s_folder)
            if _f_b_image(s)
        ])
        for s_path in a_s_path:
            o_result = o_mosaic.f_o_add(_f_read(s_path))
            s_state = ("commit" if o_result["b_committed"]
                       else ("skip" if o_result["b_skip"] else "lost"))
            o_mosaic.f_log(f"{os.path.basename(s_path)}: {s_state} "
                           f"({o_result['s_method']}, conf {o_result['n_confidence']:.2f})")
        cv2.imwrite(o_args.output, o_mosaic.o_canvas)
        o_mosaic.f_save(os.path.join(o_args.s_folder, "fog_session.json"),
                        os.path.abspath(o_args.output))
        o_mosaic.f_log(f"wrote {o_args.output} "
                       f"({o_mosaic.o_canvas.shape[1]}x{o_mosaic.o_canvas.shape[0]})")
        return 0

    s_mosaic = o_args.mosaic or os.path.splitext(o_args.session)[0] + "_mosaic.jpg"
    if o_args.s_cmd == "watch":
        return _cmd_watch(o_args.s_folder, o_args.session, s_mosaic, o_args.interval)

    if o_args.s_cmd == "add":
        if os.path.exists(o_args.session):
            o_mosaic.f_load(o_args.session, s_mosaic)
        o_result = o_mosaic.f_o_add(_f_read(o_args.s_frame),
                                    o_args.prior_dx, o_args.prior_dy)
        o_mosaic.f_save(o_args.session, s_mosaic)
        print(json.dumps(o_result))
        return 0

    if o_args.s_cmd == "export":
        o_mosaic.f_load(o_args.session, s_mosaic)
        cv2.imwrite(o_args.output, o_mosaic.o_canvas)
        o_mosaic.f_log(f"wrote {o_args.output} "
                       f"({o_mosaic.o_canvas.shape[1]}x{o_mosaic.o_canvas.shape[0]})")
        return 0

    o_p.print_help()
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
