#!/usr/bin/env python3
"""
fog_of_war.py -- real-time incremental microscope slide mosaicking.

Builds a persistent "world map" of a slide as the stage moves under a fixed
camera, fog-of-war style: every successfully registered frame is composited
onto a growing canvas and stays revealed even after the camera moves away.

Registration is classical / deterministic / CPU-friendly -- no ML, no learned
matchers:

  * primary   : FFT phase correlation (numpy) on windowed, high-passed,
                downsampled grayscale -- gives a translation + peak sharpness
  * refine    : cv2.findTransformECC (translation) for sub-pixel / low-texture
                refinements, seeded by the phase-correlation result
  * fallback  : ORB + brute-force Hamming + RANSAC translation for large jumps /
                small rotation where phase correlation is weak

A motor-predicted displacement may be passed in as a *prior* (seed for ECC /
a sanity signal); the image-based result is always the source of truth.

Usage (testable in isolation):
    ./fog_of_war.py register a.png b.png
    ./fog_of_war.py build folder/ -o mosaic.png
    ./fog_of_war.py add frame.png --session s.json
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

# --------------------------------------------------------------------------- #
# tunable constants
# --------------------------------------------------------------------------- #

N_PX__LONG_SIDE = 512        # registration downsample long side (px)
N_PX__MIN_SHIFT = 8.0        # committed translation must exceed this (full-res px)
N_CONF__PHASE_MIN = 0.10     # phase-correlation peak below this is untrusted
N_CONF__ECC_MIN = 0.30       # ECC correlation coefficient below this is untrusted
N_INLIER__ORB_MIN = 10       # ORB: minimum inliers to accept the fallback
N_IT__DRIFT = 25             # re-anchor to the mosaic every this many commits
N_PX__FEATHER = 48           # feather band width at the frame border (px)
N_PX__CANVAS_MAX = 30000     # canvas side safety cap (px)
N_PX__PREVIEW = 1600         # client preview / minimap long side (px)
N_QUALITY__JPEG = 88


# --------------------------------------------------------------------------- #
# image helpers
# --------------------------------------------------------------------------- #

def f_o_gray_at_scale(o_img, n_scl):
    """Grayscale float32, high-passed, resized by ``n_scl`` (<1 downsamples)."""
    if o_img.ndim == 3:
        o_img = cv2.cvtColor(o_img, cv2.COLOR_BGR2GRAY)
    o_img = o_img.astype(np.float32)
    if n_scl < 1.0:
        o_img = cv2.resize(o_img, None, fx=n_scl, fy=n_scl,
                           interpolation=cv2.INTER_AREA)
    # key on structure, not on smooth illumination / vignetting
    return o_img - cv2.GaussianBlur(o_img, (0, 0), 8.0)


def f_n_gray(o_img, n_long_side):
    """Grayscale downsampled so the long side == n_long_side.  Returns
    (array, scale) with scale = out_px / in_px."""
    n_scl = n_long_side / max(o_img.shape[:2])
    return f_o_gray_at_scale(o_img, n_scl), n_scl


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
# registration core
# --------------------------------------------------------------------------- #

def _f_o_phase_reg(o_a, o_b):
    """Phase correlation on two SAME-SIZE grayscale arrays.

    Returns (dx, dy, peak) in *reg px* (the arrays' own pixel units) and peak
    in [0, 1].  Convention: ``mov`` placed at ``ref + (dx, dy)`` aligns with
    ``ref`` (identical to stitch.py best_shift)."""
    n_h, n_w = o_a.shape
    o_win = cv2.createHanningWindow((n_w, n_h), cv2.CV_32F)
    o_a = o_a * o_win
    o_b = o_b * o_win
    o_r = np.fft.rfft2(o_a) * np.conj(np.fft.rfft2(o_b))
    o_r /= (np.abs(o_r) + 1e-9)
    o_c = np.fft.irfft2(o_r, s=(n_h, n_w))
    n_py, n_px = np.unravel_index(int(np.argmax(o_c)), o_c.shape)
    n_dy = n_py if n_py <= n_h // 2 else n_py - n_h
    n_dx = n_px if n_px <= n_w // 2 else n_px - n_w
    n_dx, n_dy = _f_o_subpixel(o_c, n_px, n_py, n_dx, n_dy)
    return -float(n_dx), -float(n_dy), float(o_c[n_py, n_px])


def _f_o_subpixel(o_c, n_px, n_py, n_dx, n_dy):
    """Parabolic sub-pixel interpolation of the phase-correlation peak."""
    n_h, n_w = o_c.shape
    if 0 < n_px < n_w - 1:
        o_v = [o_c[n_py, n_px - 1], o_c[n_py, n_px], o_c[n_py, n_px + 1]]
        n_den = o_v[0] - 2.0 * o_v[1] + o_v[2]
        if abs(n_den) > 1e-9:
            n_dx += 0.5 * (o_v[0] - o_v[2]) / n_den
    if 0 < n_py < n_h - 1:
        o_v = [o_c[n_py - 1, n_px], o_c[n_py, n_px], o_c[n_py + 1, n_px]]
        n_den = o_v[0] - 2.0 * o_v[1] + o_v[2]
        if abs(n_den) > 1e-9:
            n_dy += 0.5 * (o_v[0] - o_v[2]) / n_den
    return n_dx, n_dy


def f_o_phase(o_ref, o_mov):
    """Phase correlation on two full-res images.  Returns (dx, dy, peak) with
    dx/dy in full-res px."""
    o_a, n_scl = f_n_gray(o_ref, N_PX__LONG_SIDE)
    o_b, _ = f_n_gray(o_mov, N_PX__LONG_SIDE)
    n_dx, n_dy, n_peak = _f_o_phase_reg(o_a, o_b)
    return n_dx / n_scl, n_dy / n_scl, n_peak


def f_o_phase_locate(o_tpl, o_img):
    """Find a template inside a larger image (both at the SAME scale).

    Returns (x, y, peak) = template's top-left position in the image, or None
    if the template does not fit.  FFT-padded to avoid circular wrap-around."""
    n_th, n_tw = o_tpl.shape
    n_h, n_w = o_img.shape
    if n_th > n_h or n_tw > n_w:
        return None
    n_fh = cv2.getOptimalDFTSize(n_th + n_h)
    n_fw = cv2.getOptimalDFTSize(n_tw + n_w)
    o_fi = np.fft.rfft2(o_img, s=(n_fh, n_fw))
    o_ft = np.fft.rfft2(o_tpl, s=(n_fh, n_fw))
    o_r = o_fi * np.conj(o_ft)
    o_r /= (np.abs(o_r) + 1e-9)
    o_c = np.fft.irfft2(o_r, s=(n_fh, n_fw))[:n_h - n_th + 1, :n_w - n_tw + 1]
    n_py, n_px = np.unravel_index(int(np.argmax(o_c)), o_c.shape)
    return float(n_px), float(n_py), float(o_c[n_py, n_px])


def f_o_ncc_locate(o_tpl, o_img):
    """Find a template inside a larger image by normalised cross-correlation
    (cv2.matchTemplate, TM_CCOEFF_NORMED).  Robust to low texture, but requires
    the template to be fully inside the image.

    Returns (x, y, ncc) = template's top-left in the image, or None."""
    n_th, n_tw = o_tpl.shape
    n_h, n_w = o_img.shape
    if n_th > n_h or n_tw > n_w:
        return None
    o_res = cv2.matchTemplate(o_img, o_tpl, cv2.TM_CCOEFF_NORMED)
    n_min, n_max, n_minloc, n_maxloc = cv2.minMaxLoc(o_res)
    return float(n_maxloc[0]), float(n_maxloc[1]), float(n_max)


def f_o_orb_locate(o_frame, o_mosaic):
    """Locate the frame inside the mosaic via ORB feature matching (both at the
    SAME scale).  Robust to partial overlap / large jumps.

    Returns (x, y, confidence) = frame's top-left in the mosaic, or None."""
    o_f8 = np.clip(o_frame, 0, 255).astype(np.uint8)
    o_m8 = np.clip(o_mosaic, 0, 255).astype(np.uint8)
    o_orb = cv2.ORB_create(nfeatures=3000)
    o_kp_m, o_des_m = o_orb.detectAndCompute(o_m8, None)
    o_kp_f, o_des_f = o_orb.detectAndCompute(o_f8, None)
    if o_des_m is None or o_des_f is None or len(o_kp_m) < 8 or len(o_kp_f) < 8:
        return None
    o_match = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False).knnMatch(o_des_f, o_des_m, k=2)
    a_o_good = [m[0] for m in o_match if len(m) == 2 and m[0].distance < 0.75 * m[1].distance]
    if len(a_o_good) < N_INLIER__ORB_MIN:
        return None
    # frame's top-left = pt_mosaic - pt_frame
    o_delta = (np.float32([o_kp_m[m.trainIdx].pt for m in a_o_good])
               - np.float32([o_kp_f[m.queryIdx].pt for m in a_o_good]))
    n_x = float(np.median(o_delta[:, 0]))
    n_y = float(np.median(o_delta[:, 1]))
    n_inlier = int((np.linalg.norm(o_delta - np.array([n_x, n_y]), axis=1) < 4.0).sum())
    if n_inlier < N_INLIER__ORB_MIN:
        return None
    return n_x, n_y, min(1.0, 0.5 + 0.5 * n_inlier / len(a_o_good))


def f_o_ecc(o_ref, o_mov, n_dx0, n_dy0):
    """ECC translation refinement seeded by (dx0, dy0).  Returns (dx, dy, cc)
    in full-res px; cc in [-1, 1]."""
    o_a, n_scl = f_n_gray(o_ref, N_PX__LONG_SIDE)
    o_b, _ = f_n_gray(o_mov, N_PX__LONG_SIDE)
    o_a8 = np.clip(o_a, 0, 255).astype(np.uint8)
    o_b8 = np.clip(o_b, 0, 255).astype(np.uint8)
    o_warp = np.eye(2, 3, dtype=np.float32)
    o_warp[0, 2] = n_dx0 * n_scl
    o_warp[1, 2] = n_dy0 * n_scl
    try:
        n_cc, o_warp = cv2.findTransformECC(
            o_a8, o_b8, o_warp, cv2.MOTION_TRANSLATION,
            (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 60, 1e-4))
    except cv2.error:
        return n_dx0, n_dy0, 0.0
    return float(o_warp[0, 2]) / n_scl, float(o_warp[1, 2]) / n_scl, float(n_cc)


def f_o_orb(o_ref, o_mov):
    """ORB + Hamming + RANSAC translation fallback.  Returns
    (dx, dy, n_inlier, n_ratio) in full-res px, or None."""
    o_a, n_scl = f_n_gray(o_ref, N_PX__LONG_SIDE)
    o_b, _ = f_n_gray(o_mov, N_PX__LONG_SIDE)
    o_a8 = np.clip(o_a, 0, 255).astype(np.uint8)
    o_b8 = np.clip(o_b, 0, 255).astype(np.uint8)
    o_orb = cv2.ORB_create(nfeatures=2000)
    o_kp_a, o_desc_a = o_orb.detectAndCompute(o_a8, None)
    o_kp_b, o_desc_b = o_orb.detectAndCompute(o_b8, None)
    if o_desc_a is None or o_desc_b is None or len(o_kp_a) < 8 or len(o_kp_b) < 8:
        return None
    o_match = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False).knnMatch(o_desc_a, o_desc_b, k=2)
    a_o_good = [m[0] for m in o_match if len(m) == 2 and m[0].distance < 0.75 * m[1].distance]
    if len(a_o_good) < N_INLIER__ORB_MIN:
        return None
    o_delta = np.float32([o_kp_a[m.queryIdx].pt for m in a_o_good]) \
        - np.float32([o_kp_b[m.trainIdx].pt for m in a_o_good])
    n_dx = float(np.median(o_delta[:, 0]))
    n_dy = float(np.median(o_delta[:, 1]))
    n_inlier = int((np.linalg.norm(o_delta - np.array([n_dx, n_dy]), axis=1) < 4.0).sum())
    if n_inlier < N_INLIER__ORB_MIN:
        return None
    return n_dx / n_scl, n_dy / n_scl, n_inlier, n_inlier / len(a_o_good)


def f_o_register(o_ref, o_mov, n_prior_dx=None, n_prior_dy=None):
    """Register mov against ref (full-res).  Returns (dx, dy, confidence,
    method) or (0, 0, 0, 'none')."""
    n_dx, n_dy, n_peak = f_o_phase(o_ref, o_mov)
    if n_peak >= N_CONF__PHASE_MIN:
        if n_peak < 0.35:
            n_dx2, n_dy2, n_cc = f_o_ecc(o_ref, o_mov, n_dx, n_dy)
            if n_cc >= N_CONF__ECC_MIN:
                return n_dx2, n_dy2, max(n_peak, n_cc * 0.5), "ecc"
        return n_dx, n_dy, n_peak, "phase"
    o_orb = f_o_orb(o_ref, o_mov)
    if o_orb is not None:
        n_dx, n_dy, n_inlier, n_ratio = o_orb
        return n_dx, n_dy, min(1.0, 0.5 + 0.5 * n_ratio), "orb"
    n_dx0 = n_prior_dx if n_prior_dx is not None else 0.0
    n_dy0 = n_prior_dy if n_prior_dy is not None else 0.0
    n_dx2, n_dy2, n_cc = f_o_ecc(o_ref, o_mov, n_dx0, n_dy0)
    if n_cc >= N_CONF__ECC_MIN:
        return n_dx2, n_dy2, n_cc * 0.5, "ecc"
    return 0.0, 0.0, 0.0, "none"


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
        self.o_last_gray = None       # downsampled gray of the last frame
        self.o_last_frame = None      # full-res BGR of the last frame
        self.o_feather = None         # cached feather mask
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

    # --------------------------------------------------------- relocation --
    def f_o_relocate(self, o_frame):
        """Search the whole (downsampled) mosaic for the frame.  Returns
        (world_x, world_y, confidence) of the frame's top-left, or None."""
        if self.o_canvas is None:
            return None
        n_scl = N_PX__LONG_SIDE / max(self.n_scl_x__frame, self.n_scl_y__frame)
        o_frame_small = f_o_gray_at_scale(o_frame, n_scl)
        o_mosaic_small = f_o_gray_at_scale(self.o_canvas, n_scl)
        # ORB first: handles partial overlap (frame poking out of the mosaic)
        # and large jumps; NCC is the low-texture fallback
        o_loc = f_o_orb_locate(o_frame_small, o_mosaic_small)
        if o_loc is None:
            o_loc = f_o_ncc_locate(o_frame_small, o_mosaic_small)
            if o_loc is not None:
                n_px, n_py, n_ncc = o_loc
                if n_ncc < N_CONF__ECC_MIN:
                    o_loc = None
                else:
                    o_loc = (n_px, n_py, min(1.0, max(0.0, (n_ncc + 1.0) * 0.5)))
        if o_loc is None:
            return None
        n_px, n_py, n_conf = o_loc
        n_wx = self.n_x__min + n_px / n_scl
        n_wy = self.n_y__min + n_py / n_scl
        return n_wx, n_wy, n_conf

    # ---------------------------------------------------------------- add --
    def f_o_add(self, o_frame, n_prior_dx=None, n_prior_dy=None):
        """Register and (maybe) composite one full-res BGR frame.  Returns a
        dict describing commit / skip / lost plus the geometry the client needs
        for its minimap viewport."""
        n_h, n_w = o_frame.shape[:2]
        o_result = {
            "b_committed": False,
            "b_skip": False,
            "b_lost": False,
            "n_dx": 0.0,
            "n_dy": 0.0,
            "n_confidence": 0.0,
            "s_method": "none",
            "n_x__view": self.n_x__view,
            "n_y__view": self.n_y__view,
            "n_scl_x__frame": n_w,
            "n_scl_y__frame": n_h,
            "n_scl_x__mosaic": 0,
            "n_scl_y__mosaic": 0,
            "n_x__min": self.n_x__min,
            "n_y__min": self.n_y__min,
            "n_commit": self.n_commit,
            "n_lost": self.n_lost,
            "n_skip": self.n_skip,
            "s_error": "",
        }

        if self.o_last_gray is None:
            self.n_scl_x__frame, self.n_scl_y__frame = n_w, n_h
            self.f_composite(o_frame, 0.0, 0.0)
            self.n_x__view, self.n_y__view = 0.0, 0.0
            self.o_last_frame = o_frame
            self.o_last_gray, _ = f_n_gray(o_frame, N_PX__LONG_SIDE)
            self.n_commit = 1
            o_result.update({"b_committed": True, "s_method": "seed",
                             "n_x__view": 0.0, "n_y__view": 0.0,
                             "n_confidence": 1.0, "n_commit": 1})
            self.f_o_status_into(o_result)
            return o_result

        n_scl = N_PX__LONG_SIDE / max(self.n_scl_x__frame, self.n_scl_y__frame)
        o_frame_small = f_o_gray_at_scale(o_frame, n_scl)
        n_dx, n_dy, n_conf = _f_o_phase_reg(self.o_last_gray, o_frame_small)
        n_dx, n_dy = n_dx / n_scl, n_dy / n_scl
        s_method = "phase"

        n_diag = math.hypot(self.n_scl_x__frame, self.n_scl_y__frame)
        if n_conf < N_CONF__PHASE_MIN or math.hypot(n_dx, n_dy) > 1.5 * n_diag:
            # phase correlation weak or implausibly large -> full register
            # against the last frame (adds ECC + ORB fallback for large jumps)
            n_dx, n_dy, n_conf, s_method = f_o_register(
                self.o_last_frame, o_frame, n_prior_dx, n_prior_dy)

        if n_conf < N_CONF__PHASE_MIN:
            # still not confident locally -> re-acquire against the whole mosaic
            o_rel = self.f_o_relocate(o_frame)
            if o_rel is not None:
                n_wx, n_wy, n_conf = o_rel
                n_dx, n_dy = n_wx - self.n_x__view, n_wy - self.n_y__view
                s_method = "reacquire"
            else:
                self.n_lost += 1
                o_result.update({"b_lost": True, "n_lost": self.n_lost,
                                 "n_confidence": n_conf, "s_method": "none"})
                self.f_o_status_into(o_result)
                return o_result

        # motor prior (if given) is a sanity signal, not the source of truth
        if n_prior_dx is not None and n_prior_dy is not None:
            n_prior_err = math.hypot(n_dx - n_prior_dx, n_dy - n_prior_dy)
            if n_prior_err > 0.5 * n_diag:
                self.f_log(f"  prior disagreement {n_prior_err:.0f} px "
                            f"(motor said {n_prior_dx:.0f},{n_prior_dy:.0f}, "
                            f"image says {n_dx:.0f},{n_dy:.0f})")

        o_result.update({"n_dx": n_dx, "n_dy": n_dy, "n_confidence": n_conf,
                         "s_method": s_method})

        if math.hypot(n_dx, n_dy) < N_PX__MIN_SHIFT:
            self.n_skip += 1
            o_result.update({"b_skip": True, "n_skip": self.n_skip,
                             "n_confidence": n_conf, "s_method": s_method})
            self.f_o_status_into(o_result)
            return o_result

        n_wx = self.n_x__view + n_dx
        n_wy = self.n_y__view + n_dy
        self.f_composite(o_frame, n_wx, n_wy)
        self.n_x__view, self.n_y__view = n_wx, n_wy
        self.o_last_gray = o_frame_small
        self.o_last_frame = o_frame
        self.n_commit += 1
        o_result.update({"b_committed": True, "n_x__view": n_wx, "n_y__view": n_wy,
                         "n_confidence": n_conf, "n_commit": self.n_commit,
                         "s_method": s_method})

        if self.n_commit % N_IT__DRIFT == 0:
            o_rel = self.f_o_relocate(o_frame)
            if o_rel is not None:
                n_wx2, n_wy2, n_conf2 = o_rel
                n_err = math.hypot(n_wx2 - n_wx, n_wy2 - n_wy)
                self.f_log(f"  drift: re-anchored to the mosaic "
                            f"(correction {n_err:.1f} px)")
                self.n_x__view, self.n_y__view = n_wx2, n_wy2
                o_result.update({"n_x__view": n_wx2, "n_y__view": n_wy2})

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
        # restore the last frame so the next add continues frame-to-frame
        s_path_last = os.path.splitext(s_path_session)[0] + "_last.jpg"
        if os.path.exists(s_path_last):
            self.o_last_frame = cv2.imread(s_path_last)
            if self.o_last_frame is not None:
                self.o_last_gray, _ = f_n_gray(self.o_last_frame, N_PX__LONG_SIDE)


# --------------------------------------------------------------------------- #
# CLI (testable in isolation)
# --------------------------------------------------------------------------- #

def _f_read(s_path):
    o_img = cv2.imread(s_path)
    if o_img is None:
        raise SystemExit(f"error: cannot read {s_path}")
    return o_img


_IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp")


def _f_b_image(s_name):
    return s_name.lower().endswith(_IMAGE_EXTS)


def _cmd_watch(s_folder, s_session, s_mosaic, n_interval):
    """Persistent folder watcher: adds frames as they arrive and prints one JSON
    line per frame on stdout (for the Deno server to forward to the client)."""
    o_mosaic = FogMosaic()
    if os.path.exists(s_session):
        o_mosaic.f_load(s_session, s_mosaic)

    # never re-add frames that were already there at startup (a resumed session)
    a_s_done = set()
    try:
        for s_name in os.listdir(s_folder):
            if _f_b_image(s_name):
                a_s_done.add(os.path.join(s_folder, s_name))
    except OSError:
        pass

    o_seen = {}
    n_since_save = 0
    # never pick up the watch's own output files as input frames
    a_s_skip = {
        os.path.basename(s_session),
        os.path.basename(s_mosaic),
        os.path.splitext(os.path.basename(s_mosaic))[0] + "_preview.jpg",
        os.path.splitext(os.path.basename(s_session))[0] + "_last.jpg",
    }
    o_mosaic.f_log(f"fog watch: folder {s_folder}")
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
            n_since_save += 1
            # keep the persistent state + client preview current; the full
            # mosaic is only re-encoded periodically (it is the expensive part)
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
        description="classical incremental slide mosaicking (fog-of-war)")
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
            if s.lower().endswith((".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"))
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
