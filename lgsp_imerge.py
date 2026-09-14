
# --- DO_NOT_EDIT_THIS_COMMENT_START---
# data in this comment may be old and not up to date, 
# but it represent the initial plan and thought process for the code, and should not be deleted.

# import libraries

# take arguments
# log to the console about what arguments are possible
# and what are set

# compare
    # apply a preprocessing to both images (according to what is set with arguemtns)
    # find matches with
    # decide if a stich shoudl be done
    # save debug compare image with all infos
        # what preprocessing was applied
        # mark keypoints in each image
        # mark conntections between keypoints
        # mark inliers and outliers
        # mark the decision (stitch or not) and the reason for it (e.g

# possible preprocessings are
# image correction
# - vignette removal

# feature amplification
    # Unsharp Mask
    # CLAHE
    # Laplacian Pyramid Boost
    # Morphological Top/Black-Hat
    # High-Pass Boost
    # Histogram Equalization
    # Gabor Filter Enhancement
    # Multi-Scale Retinex

#

# process description

# take first img as ref
# iterate over other imgs
# try to stitch
# if stitched take result as ref
# continue for each other image to stitch
# if stitching not possible use mov image as ref
# repeat as long as there are images to stitch

# after a stiching has been successfully done, blend the images smoothly, 'harmonize' the images


# example
# images [a,b,c,d]
# ref_a
# mov_b
# compare (save debug info about the comparison)
# match => ab

# ref_ab
# mov_c
# compare (save debug info about the comparison)
# no match

# ref_c
# mov_d
# compare (save debug info about the comparison)
# match => cd

# ref_ab
# mov_cd

# match => abcd
# --- DO_NOT_EDIT_THIS_COMMENT_END ---

import sys
import os
import argparse
import json
import time
from datetime import datetime

try:
    import cv2
    import numpy as np
    import torch
    from lightglue import LightGlue, SuperPoint
    from lightglue.utils import load_image, rbd
except ImportError as e:
    print(f"Missing package: {e.name}\n")
    print("Modern Linux prevents installing packages globally with pip.")
    print("Use a virtual environment instead:\n")
    print("  python3 -m venv venv")
    print("  source venv/bin/activate")
    print("  pip install git+https://github.com/cvg/LightGlue")
    print("\nThen run the script again from inside the venv.")
    sys.exit(1)

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.tif', '.tiff', '.webp'}

device = "cpu"
extractor = None
matcher = None


def init_models(n_keypoint=1024):
    """Initialize SuperPoint extractor and LightGlue matcher with given keypoint count."""
    global extractor, matcher

    extractor = SuperPoint(max_num_keypoints=n_keypoint).eval().to(device)
    #extractor = torch.compile(extractor, mode="reduce-overhead")
    matcher = LightGlue(features='superpoint').eval().to(device)


# Thresholds
INLIER_RESIDUAL_PX = 10.0
MIN_INLIER_PCT = 20.0
MIN_NCC = None  # disabled

# ── .env loading ──────────────────────────────────────────────────────────

def load_env(s_path=None):
    """Load key=value pairs from a .env file next to this script."""
    if s_path is None:
        s_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    o_env = {}
    if os.path.isfile(s_path):
        with open(s_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, value = line.split("=", 1)
                    o_env[key.strip()] = value.strip()
    return o_env


def emit_tagged(s_uuid, s_format, s_data):
    """Emit a machine-readable tagged block to stdout."""
    print(f"{s_uuid}_start_{s_format}")
    print(s_data)
    print(f"{s_uuid}_end_{s_format}")


# ── preprocessing registry ──────────────────────────────────────────────
# Each entry: (name, description, default_enabled, function)
# The function signature is  f(img, **kwargs) -> img

PREPROCESSING_REGISTRY = {}


def register_preprocessing(name, description, default_enabled=False):
    """Decorator to register a preprocessing function."""
    def decorator(func):
        PREPROCESSING_REGISTRY[name] = {
            'description': description,
            'default': default_enabled,
            'func': func,
        }
        return func
    return decorator


# ── image corrections ───────────────────────────────────────────────────

@register_preprocessing(
    'vignette',
    'Vignette removal via Gaussian flat-field correction (good for microscopy)',
    default_enabled=False,
)
def vignette_removal(img):
    """Remove vignetting by dividing by a heavily blurred version of the image."""
    h, w = img.shape[:2]
    sigma = max(h, w) / 4.0
    f = img.astype(np.float32)
    blur = cv2.GaussianBlur(f, (0, 0), sigmaX=sigma)
    blur_mean = blur.mean()
    if blur_mean < 1e-6:
        return img
    corrected = f / (blur + 1e-6) * blur_mean
    return np.clip(corrected, 0, 255).astype(np.uint8)


# ── feature amplification ──────────────────────────────────────────────

@register_preprocessing(
    'clahe',
    'CLAHE adaptive local contrast enhancement (L channel in LAB)',
    default_enabled=True,
)
def clahe_enhance(img, clip_limit=3.0, grid_size=(8, 8)):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=grid_size)
    lab[:, :, 0] = clahe.apply(lab[:, :, 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


@register_preprocessing(
    'unsharp',
    'Unsharp mask – amplifies high-frequency details',
    default_enabled=False,
)
def unsharp_mask(img, sigma=3, strength=2.0):
    f = img.astype(np.float32)
    blurred = cv2.GaussianBlur(f, (0, 0), sigmaX=sigma)
    details = f - blurred
    return np.clip(f + details * strength, 0, 255).astype(np.uint8)


@register_preprocessing(
    'laplacian',
    'Laplacian pyramid boost – multi-scale detail amplification',
    default_enabled=False,
)
def laplacian_pyramid_boost(img, levels=5, boost_range=(1, 4), factor=2.5):
    f = img.astype(np.float32)
    G = [f.copy()]
    for _ in range(levels):
        G.append(cv2.pyrDown(G[-1]))
    L = []
    for i in range(len(G) - 1):
        up = cv2.pyrUp(G[i + 1], dstsize=(G[i].shape[1], G[i].shape[0]))
        L.append(G[i] - up)
    for i in range(boost_range[0], min(boost_range[1], len(L))):
        L[i] = L[i] * factor
    result = G[-1]
    for i in range(len(L) - 1, -1, -1):
        result = cv2.pyrUp(result, dstsize=(L[i].shape[1], L[i].shape[0])) + L[i]
    return np.clip(result, 0, 255).astype(np.uint8)


@register_preprocessing(
    'tophat',
    'Morphological top-hat / black-hat feature extraction',
    default_enabled=False,
)
def morphological_tophat(img, kernel_size=15):
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, kernel)
    blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
    enhanced = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR).astype(np.float32)
    enhanced += cv2.cvtColor(tophat * 2, cv2.COLOR_GRAY2BGR).astype(np.float32)
    enhanced -= cv2.cvtColor(blackhat * 2, cv2.COLOR_GRAY2BGR).astype(np.float32)
    return np.clip(enhanced, 0, 255).astype(np.uint8)


@register_preprocessing(
    'highpass',
    'High-pass boost – emphasizes edges and fine detail',
    default_enabled=False,
)
def high_pass_boost(img, sigma=10, boost=1.5):
    f = img.astype(np.float32)
    low = cv2.GaussianBlur(f, (0, 0), sigmaX=sigma)
    high_pass = f - low
    return np.clip(f + high_pass * boost, 0, 255).astype(np.uint8)


@register_preprocessing(
    'histeq',
    'Global histogram equalization on luminance channel',
    default_enabled=False,
)
def histogram_equalization(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.equalizeHist(lab[:, :, 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


@register_preprocessing(
    'gabor',
    'Gabor filter bank – amplifies texture / oriented features',
    default_enabled=False,
)
def gabor_enhance(img, num_orientations=8, frequency=0.1):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    accum = np.zeros_like(gray)
    for i in range(num_orientations):
        theta = i * np.pi / num_orientations
        kernel = cv2.getGaborKernel(
            (31, 31), sigma=4.0, theta=theta,
            lambd=1.0 / frequency, gamma=0.5, psi=0,
        )
        filtered = cv2.filter2D(gray, cv2.CV_32F, kernel)
        accum = np.maximum(accum, np.abs(filtered))
    accum = cv2.normalize(accum, None, 0, 255, cv2.NORM_MINMAX)
    result = img.astype(np.float32) + cv2.cvtColor(accum, cv2.COLOR_GRAY2BGR) * 0.5
    return np.clip(result, 0, 255).astype(np.uint8)


@register_preprocessing(
    'retinex',
    'Multi-Scale Retinex – enhances dynamic range and local contrast',
    default_enabled=False,
)
def retinex_enhance(img, sigmas=(15, 80, 250)):
    f = img.astype(np.float32) + 1.0
    retinex = np.zeros_like(f)
    for sigma in sigmas:
        blurred = cv2.GaussianBlur(f, (0, 0), sigmaX=sigma)
        retinex += np.log(f) - np.log(blurred + 1.0)
    retinex /= len(sigmas)
    for c in range(3):
        retinex[:, :, c] = cv2.normalize(retinex[:, :, c], None, 0, 255, cv2.NORM_MINMAX)
    return retinex.astype(np.uint8)


# ── helpers ─────────────────────────────────────────────────────────────

def apply_preprocessing(img, enabled_steps):
    """Apply each enabled preprocessing step in order.

    Returns (processed_image, timings_dict) where timings maps step name to ms.
    """
    result = img.copy()
    timings = {}
    for name in enabled_steps:
        entry = PREPROCESSING_REGISTRY[name]
        t0 = time.perf_counter()
        result = entry['func'](result)
        timings[name] = (time.perf_counter() - t0) * 1000
    return result, timings


def make_debug_dir(parent):
    """Create a unique per-run debug directory under *parent*.

    Name format: debug_lgsp_imerge_YYYY_mm_dd_HH_MM_SS  (with _N suffix if it already exists).
    """
    base = f"debug_lgsp_imerge_{datetime.now().strftime('%Y_%m_%d_%H_%M_%S')}"
    candidate = os.path.join(parent, base)
    if not os.path.exists(candidate):
        os.makedirs(candidate)
        return candidate
    n = 1
    while True:
        candidate = os.path.join(parent, f"{base}_{n}")
        if not os.path.exists(candidate):
            os.makedirs(candidate)
            return candidate
        n += 1


def color_transfer(src, ref):
    """Transfer colour distribution from ref to src (mean/std matching in LAB)."""
    src_lab = cv2.cvtColor(src, cv2.COLOR_BGR2LAB).astype(np.float64)
    ref_lab = cv2.cvtColor(ref, cv2.COLOR_BGR2LAB).astype(np.float64)
    for ch in range(3):
        s_mean, s_std = src_lab[..., ch].mean(), src_lab[..., ch].std()
        r_mean, r_std = ref_lab[..., ch].mean(), ref_lab[..., ch].std()
        if s_std < 1e-6:
            s_std = 1e-6
        src_lab[..., ch] = (src_lab[..., ch] - s_mean) * (r_std / s_std) + r_mean
    src_lab = np.clip(src_lab, 0, 255).astype(np.uint8)
    return cv2.cvtColor(src_lab, cv2.COLOR_LAB2BGR)


def draw_matches(img0, img1, pts0, pts1, inlier_mask, out_path, debug_lines=None):
    """Side-by-side visualisation with keypoints, match lines, inlier/outlier colouring."""
    h0, w0 = img0.shape[:2]
    h1, w1 = img1.shape[:2]
    h = max(h0, h1)
    vis = np.zeros((h, w0 + w1, 3), dtype=np.uint8)
    vis[:h0, :w0] = img0
    vis[:h1, w0:] = img1

    for i in range(len(pts0)):
        x0, y0 = int(round(pts0[i, 0])), int(round(pts0[i, 1]))
        x1, y1 = int(round(pts1[i, 0])) + w0, int(round(pts1[i, 1]))
        if inlier_mask is not None and i < len(inlier_mask):
            color = (0, 255, 0) if inlier_mask[i] else (0, 0, 255)  # green=inlier, red=outlier
        else:
            color = (0, 200, 255)  # orange when no mask available
        cv2.circle(vis, (x0, y0), 6, color, -1)
        cv2.circle(vis, (x1, y1), 6, color, -1)
        cv2.line(vis, (x0, y0), (x1, y1), color, 1, cv2.LINE_AA)

    if debug_lines:
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.7
        thickness = 2
        line_h = 28
        pad = 10
        box_h = pad * 2 + line_h * len(debug_lines)
        overlay = vis.copy()
        cv2.rectangle(overlay, (0, 0), (w0 + w1, box_h), (0, 0, 0), -1)
        cv2.addWeighted(overlay, 0.6, vis, 0.4, 0, vis)
        for i, line in enumerate(debug_lines):
            y = pad + line_h * (i + 1) - 4
            cv2.putText(vis, line, (pad, y), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    cv2.imwrite(out_path, vis)


# ── core matching ──────────────────────────────────────────────────────

def try_match(img0, img1, enabled_steps, min_match_pct=8.0, n_downscale=0.5, matches_path=None):
    """Find translation alignment between img0 (ref) and img1 (mov).

    Runs downscale + preprocessing + feature extraction + matching + inlier filtering.
    Does NOT composite — just returns the translation offset in original resolution.

    Returns (o_match, o_stat) on success, (None, o_stat) on failure.
    o_match = {'n_dx': int, 'n_dy': int, 'n_pct__match': float, 'n_pct__inlier': float, ...}
    """
    a_s_debug_line = []
    o_timing = {}

    # downscale for faster feature extraction
    if n_downscale < 1.0:
        h0_orig, w0_orig = img0.shape[:2]
        h1_orig, w1_orig = img1.shape[:2]
        img0_ds = cv2.resize(img0, (int(w0_orig * n_downscale), int(h0_orig * n_downscale)), interpolation=cv2.INTER_AREA)
        img1_ds = cv2.resize(img1, (int(w1_orig * n_downscale), int(h1_orig * n_downscale)), interpolation=cv2.INTER_AREA)
        a_s_debug_line.append(f"Downscale: {n_downscale:.0%}")
    else:
        img0_ds = img0
        img1_ds = img1

    # preprocess for feature extraction only
    pre0, t_pre0 = apply_preprocessing(img0_ds, enabled_steps)
    pre1, t_pre1 = apply_preprocessing(img1_ds, enabled_steps)
    if enabled_steps:
        for name in enabled_steps:
            n_ms = t_pre0.get(name, 0) + t_pre1.get(name, 0)
            o_timing[f"preproc_{name}"] = n_ms
            print(f"  Preprocessing [{name}]: {n_ms:.0f}ms")
        s_summary = ', '.join(f"{n} {t_pre0.get(n,0)+t_pre1.get(n,0):.0f}ms" for n in enabled_steps)
        a_s_debug_line.append(f"Preprocessing: {s_summary}")

    # feature extraction & matching
    t0 = time.perf_counter()
    tensor0 = torch.from_numpy(cv2.cvtColor(pre0, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float() / 255.0
    tensor1 = torch.from_numpy(cv2.cvtColor(pre1, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float() / 255.0
    
    tensor0 = tensor0.to(device)
    tensor1 = tensor1.to(device)

    feats0 = extractor.extract(tensor0)
    feats1 = extractor.extract(tensor1)
    matches01 = matcher({'image0': feats0, 'image1': feats1})
    feats0, feats1, matches01 = [rbd(x) for x in [feats0, feats1, matches01]]
    n_ms__feature = (time.perf_counter() - t0) * 1000
    o_timing['feature_extract_match'] = n_ms__feature
    print(f"  Feature extraction + matching: {n_ms__feature:.0f}ms")

    kpts0 = feats0['keypoints']
    kpts1 = feats1['keypoints']
    match_indices = matches01['matches']
    mkpts0 = kpts0[match_indices[..., 0]]
    mkpts1 = kpts1[match_indices[..., 1]]

    n_kpt0 = len(kpts0)
    n_kpt1 = len(kpts1)
    n_match = len(match_indices)
    n_kpt__min = min(n_kpt0, n_kpt1)
    n_pct__match = (n_match / n_kpt__min) * 100 if n_kpt__min > 0 else 0

    o_stat = {
        'n_kpt0': n_kpt0, 'n_kpt1': n_kpt1,
        'n_match': n_match, 'n_pct__match': n_pct__match,
    }

    print(f"  Keypoints: {n_kpt0} (ref), {n_kpt1} (mov)")
    a_s_debug_line.append(f"Keypoints: {n_kpt0} (ref), {n_kpt1} (mov)")
    print(f"  Matches: {n_match}/{n_kpt__min} ({n_pct__match:.1f}%)")
    a_s_debug_line.append(f"Matches: {n_match}/{n_kpt__min} ({n_pct__match:.1f}%)")

    if n_match < 1:
        print("  Not enough matches to compute translation.")
        a_s_debug_line.append("REJECTED: not enough matches")
        if matches_path:
            draw_matches(pre0, pre1, np.zeros((0, 2)), np.zeros((0, 2)), None, matches_path, a_s_debug_line)
        return None, o_stat

    pts0 = mkpts0.numpy().astype(np.float64)
    pts1 = mkpts1.numpy().astype(np.float64)

    if n_pct__match < min_match_pct:
        print(f"  Match % too low: {n_pct__match:.1f}% < {min_match_pct:.1f}% — skipping.")
        a_s_debug_line.append(f"REJECTED: {n_pct__match:.1f}% < {min_match_pct:.1f}% min")
        if matches_path:
            draw_matches(pre0, pre1, pts0, pts1, None, matches_path, a_s_debug_line)
            print(f"  >> Saved debug image: {matches_path}")
        return None, o_stat

    # median translation
    deltas = pts0 - pts1
    n_dx = float(np.median(deltas[:, 0]))
    n_dy = float(np.median(deltas[:, 1]))
    print(f"  Translation offset: dx={n_dx:.1f}, dy={n_dy:.1f}")
    a_s_debug_line.append(f"Translation: dx={n_dx:.1f}, dy={n_dy:.1f}")

    # inlier check
    residuals = np.linalg.norm(deltas - np.array([n_dx, n_dy]), axis=1)
    inlier_mask = residuals < INLIER_RESIDUAL_PX
    n_inlier = int(inlier_mask.sum())
    n_pct__inlier = n_inlier / len(residuals) * 100
    n_residual__median = float(np.median(residuals))
    o_stat.update({
        'n_inlier': n_inlier,
        'n_pct__inlier': n_pct__inlier,
        'n_residual__median': n_residual__median,
    })

    print(f"  Inliers: {n_inlier}/{len(residuals)} ({n_pct__inlier:.1f}%) (< {INLIER_RESIDUAL_PX:.0f}px)")
    print(f"  Median residual: {n_residual__median:.2f}px")
    a_s_debug_line.append(f"Inliers: {n_inlier}/{len(residuals)} ({n_pct__inlier:.1f}%), residual: {n_residual__median:.2f}px")

    if n_pct__inlier < MIN_INLIER_PCT:
        print(f"  Inlier % too low: {n_pct__inlier:.1f}% < {MIN_INLIER_PCT:.0f}% — skipping.")
        a_s_debug_line.append(f"REJECTED: inlier {n_pct__inlier:.1f}% < {MIN_INLIER_PCT:.0f}%")
        if matches_path:
            draw_matches(pre0, pre1, pts0, pts1, inlier_mask, matches_path, a_s_debug_line)
            print(f"  >> Saved debug image: {matches_path}")
        return None, o_stat

    # refine with inliers only
    inlier_deltas = deltas[inlier_mask]
    n_dx = float(np.median(inlier_deltas[:, 0]))
    n_dy = float(np.median(inlier_deltas[:, 1]))
    print(f"  Refined translation (inliers): dx={n_dx:.1f}, dy={n_dy:.1f}")
    a_s_debug_line.append(f"Refined: dx={n_dx:.1f}, dy={n_dy:.1f} ({n_inlier} inliers)")

    # scale translation back to original resolution
    if n_downscale < 1.0:
        n_dx = n_dx / n_downscale
        n_dy = n_dy / n_downscale
        print(f"  Scaled to original res: dx={n_dx:.1f}, dy={n_dy:.1f}")
        a_s_debug_line.append(f"Original res: dx={n_dx:.1f}, dy={n_dy:.1f}")

    a_s_debug_line.append("ACCEPTED")
    if matches_path:
        draw_matches(pre0, pre1, pts0, pts1, inlier_mask, matches_path, a_s_debug_line)
        print(f"  >> Saved debug image: {matches_path}")

    o_match = {
        'n_dx': int(round(n_dx)),
        'n_dy': int(round(n_dy)),
        'n_pct__match': n_pct__match,
        'n_pct__inlier': n_pct__inlier,
        'n_residual__median': n_residual__median,
    }
    o_stat['o_timing'] = o_timing

    return o_match, o_stat


# ── core stitching ──────────────────────────────────────────────────────

def try_stitch(img0, img1, enabled_steps, min_match_pct=8.0, harmonize=False, n_downscale=0.5, matches_path=None):
    """Try to stitch img1 (mov) onto img0 (ref) using translation-only alignment.

    Preprocessing from *enabled_steps* is applied before feature extraction.
    Images are downscaled by n_downscale for matching, but original images are used for compositing.

    Returns (stitched_image, stats_dict) on success, (None, stats_dict) on failure.
    """
    h0, w0 = img0.shape[:2]
    h1, w1 = img1.shape[:2]

    debug_lines = []
    timings = {}  # stage -> ms

    # downscale for faster feature extraction
    if n_downscale < 1.0:
        img0_ds = cv2.resize(img0, (int(w0 * n_downscale), int(h0 * n_downscale)), interpolation=cv2.INTER_AREA)
        img1_ds = cv2.resize(img1, (int(w1 * n_downscale), int(h1 * n_downscale)), interpolation=cv2.INTER_AREA)
        debug_lines.append(f"Downscale: {n_downscale:.0%}")
    else:
        img0_ds = img0
        img1_ds = img1

    # preprocess for feature extraction only
    pre0, t_pre0 = apply_preprocessing(img0_ds, enabled_steps)
    pre1, t_pre1 = apply_preprocessing(img1_ds, enabled_steps)
    if enabled_steps:
        # merge per-step timings (sum across both images)
        for name in enabled_steps:
            ms = t_pre0.get(name, 0) + t_pre1.get(name, 0)
            timings[f"preproc_{name}"] = ms
            print(f"  Preprocessing [{name}]: {ms:.0f}ms")
        preproc_summary = ', '.join(f"{n} {t_pre0.get(n,0)+t_pre1.get(n,0):.0f}ms" for n in enabled_steps)
        debug_lines.append(f"Preprocessing: {preproc_summary}")

    # feature extraction & matching
    t0 = time.perf_counter()
    tensor0 = torch.from_numpy(cv2.cvtColor(pre0, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float() / 255.0
    tensor1 = torch.from_numpy(cv2.cvtColor(pre1, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float() / 255.0
    tensor0 = tensor0.to(device)
    tensor1 = tensor1.to(device)

    feats0 = extractor.extract(tensor0)
    feats1 = extractor.extract(tensor1)
    matches01 = matcher({'image0': feats0, 'image1': feats1})
    feats0, feats1, matches01 = [rbd(x) for x in [feats0, feats1, matches01]]
    ms_features = (time.perf_counter() - t0) * 1000
    timings['feature_extract_match'] = ms_features
    print(f"  Feature extraction + matching: {ms_features:.0f}ms")

    kpts0 = feats0['keypoints']
    kpts1 = feats1['keypoints']
    match_indices = matches01['matches']
    mkpts0 = kpts0[match_indices[..., 0]]
    mkpts1 = kpts1[match_indices[..., 1]]

    num_kpts0 = len(kpts0)
    num_kpts1 = len(kpts1)
    num_matches = len(match_indices)
    min_kpts = min(num_kpts0, num_kpts1)
    match_pct = (num_matches / min_kpts) * 100 if min_kpts > 0 else 0

    stats = {
        'num_kpts0': num_kpts0, 'num_kpts1': num_kpts1,
        'matches': num_matches, 'match_pct': match_pct,
        'pts0': None, 'pts1': None,
    }

    print(f"  Keypoints: {num_kpts0} (ref), {num_kpts1} (mov)")
    debug_lines.append(f"Keypoints: {num_kpts0} (ref), {num_kpts1} (mov)")
    print(f"  Matches: {num_matches}/{min_kpts} ({match_pct:.1f}%)")
    debug_lines.append(f"Matches: {num_matches}/{min_kpts} ({match_pct:.1f}%)")

    if num_matches < 1:
        print("  Not enough matches to compute translation.")
        debug_lines.append("REJECTED: not enough matches")
        if matches_path:
            draw_matches(pre0, pre1, np.zeros((0, 2)), np.zeros((0, 2)), None, matches_path, debug_lines)
        return None, stats

    pts0 = mkpts0.numpy().astype(np.float64)
    pts1 = mkpts1.numpy().astype(np.float64)
    stats['pts0'] = pts0
    stats['pts1'] = pts1

    if match_pct < min_match_pct:
        print(f"  Match % too low: {match_pct:.1f}% < {min_match_pct:.1f}% — skipping.")
        debug_lines.append(f"REJECTED: {match_pct:.1f}% < {min_match_pct:.1f}% min")
        if matches_path:
            draw_matches(pre0, pre1, pts0, pts1, None, matches_path, debug_lines)
            print(f"  >> Saved debug image: {matches_path}")
        return None, stats

    # median translation
    deltas = pts0 - pts1
    dx = np.median(deltas[:, 0])
    dy = np.median(deltas[:, 1])
    print(f"  Translation offset: dx={dx:.1f}, dy={dy:.1f}")
    debug_lines.append(f"Translation: dx={dx:.1f}, dy={dy:.1f}")

    # inlier check
    residuals = np.linalg.norm(deltas - np.array([dx, dy]), axis=1)
    inlier_mask = residuals < INLIER_RESIDUAL_PX
    inlier_count = int(inlier_mask.sum())
    inlier_pct = inlier_count / len(residuals) * 100
    median_residual = float(np.median(residuals))
    stats.update({'inlier_count': inlier_count, 'inlier_pct': inlier_pct, 'median_residual': median_residual})

    print(f"  Inliers: {inlier_count}/{len(residuals)} ({inlier_pct:.1f}%) (< {INLIER_RESIDUAL_PX:.0f}px)")
    print(f"  Median residual: {median_residual:.2f}px")
    debug_lines.append(f"Inliers: {inlier_count}/{len(residuals)} ({inlier_pct:.1f}%), residual: {median_residual:.2f}px")

    if inlier_pct < MIN_INLIER_PCT:
        print(f"  Inlier % too low: {inlier_pct:.1f}% < {MIN_INLIER_PCT:.0f}% — skipping.")
        debug_lines.append(f"REJECTED: inlier {inlier_pct:.1f}% < {MIN_INLIER_PCT:.0f}%")
        if matches_path:
            draw_matches(pre0, pre1, pts0, pts1, inlier_mask, matches_path, debug_lines)
            print(f"  >> Saved debug image: {matches_path}")
        return None, stats

    # refine with inliers only
    inlier_deltas = deltas[inlier_mask]
    dx = np.median(inlier_deltas[:, 0])
    dy = np.median(inlier_deltas[:, 1])
    print(f"  Refined translation (inliers): dx={dx:.1f}, dy={dy:.1f}")
    debug_lines.append(f"Refined: dx={dx:.1f}, dy={dy:.1f} ({inlier_count} inliers)")

    # scale translation back to original resolution
    if n_downscale < 1.0:
        dx = dx / n_downscale
        dy = dy / n_downscale
        print(f"  Scaled to original res: dx={dx:.1f}, dy={dy:.1f}")
        debug_lines.append(f"Original res: dx={dx:.1f}, dy={dy:.1f}")

    img1_x = int(round(dx))
    img1_y = int(round(dy))

    # colour correction
    if harmonize:
        t0 = time.perf_counter()
        img1 = color_transfer(img1, img0)
        ms_harmonize = (time.perf_counter() - t0) * 1000
        timings['harmonize'] = ms_harmonize
        print(f"  Colour transfer (harmonize): {ms_harmonize:.0f}ms")

    # canvas
    x_min = min(0, img1_x)
    y_min = min(0, img1_y)
    x_max = max(w0, img1_x + w1)
    y_max = max(h0, img1_y + h1)
    out_w = x_max - x_min
    out_h = y_max - y_min

    canvas0 = np.zeros((out_h, out_w, 3), dtype=np.uint8)
    ox0, oy0 = -x_min, -y_min
    canvas0[oy0:oy0 + h0, ox0:ox0 + w0] = img0

    placed1 = np.zeros((out_h, out_w, 3), dtype=np.uint8)
    ox1 = img1_x - x_min
    oy1 = img1_y - y_min
    placed1[oy1:oy1 + h1, ox1:ox1 + w1] = img1

    mask0 = (canvas0.sum(axis=2) > 0).astype(np.float64)
    mask1 = (placed1.sum(axis=2) > 0).astype(np.float64)
    overlap_mask = mask0 * mask1
    only1 = (mask1 > 0) & (mask0 == 0)

    # overlap NCC verification
    overlap_pixels = overlap_mask > 0
    num_overlap = int(overlap_pixels.sum())
    if num_overlap > 0:
        gray0 = cv2.cvtColor(canvas0, cv2.COLOR_BGR2GRAY).astype(np.float64)
        gray1 = cv2.cvtColor(placed1, cv2.COLOR_BGR2GRAY).astype(np.float64)
        a, b = gray0[overlap_pixels], gray1[overlap_pixels]
        ncc = float(np.corrcoef(a, b)[0, 1]) if np.std(a) > 0 and np.std(b) > 0 else 0.0
        stats['overlap_ncc'] = ncc
        stats['overlap_pixels'] = num_overlap
        print(f"  Overlap: {num_overlap}px, NCC={ncc:.3f}")
        debug_lines.append(f"Overlap: {num_overlap}px, NCC={ncc:.3f}")
        if MIN_NCC is not None and ncc < MIN_NCC:
            print(f"  NCC too low: {ncc:.3f} < {MIN_NCC:.2f} — skipping.")
            debug_lines.append(f"REJECTED: NCC {ncc:.3f} < {MIN_NCC:.2f}")
            if matches_path:
                draw_matches(pre0, pre1, pts0, pts1, inlier_mask, matches_path, debug_lines)
                print(f"  >> Saved debug image: {matches_path}")
            return None, stats
    else:
        print("  Warning: no pixel overlap after translation.")
        debug_lines.append("Warning: no pixel overlap")
        stats['overlap_ncc'] = 0.0
        stats['overlap_pixels'] = 0

    # compositing
    t0 = time.perf_counter()
    if harmonize:
        blend_alpha = np.zeros((out_h, out_w), dtype=np.float64)
        blend_alpha[mask0 > 0] = 1.0
        for y in range(out_h):
            row_overlap = np.where(overlap_mask[y] > 0)[0]
            if len(row_overlap) == 0:
                continue
            left, right = row_overlap[0], row_overlap[-1]
            if right > left:
                blend_alpha[y, left:right + 1] = np.linspace(1.0, 0.0, right - left + 1)
        blend_alpha_3 = blend_alpha[..., np.newaxis]
        canvas = (blend_alpha_3 * canvas0.astype(np.float64)
                  + (1.0 - blend_alpha_3) * placed1.astype(np.float64))
    else:
        canvas = canvas0.astype(np.float64)
        canvas[overlap_mask > 0] = placed1[overlap_mask > 0].astype(np.float64)

    canvas[only1] = placed1[only1].astype(np.float64)
    canvas = np.clip(canvas, 0, 255).astype(np.uint8)
    ms_composite = (time.perf_counter() - t0) * 1000
    timings['compositing'] = ms_composite
    print(f"  Compositing: {ms_composite:.0f}ms")

    # timing summary
    total_ms = sum(timings.values())
    timing_parts = [f"{k}={v:.0f}ms" for k, v in timings.items()]
    timing_summary = f"Timing: {' | '.join(timing_parts)} | total={total_ms:.0f}ms"
    print(f"  {timing_summary}")
    debug_lines.append(timing_summary)

    # success
    debug_lines.append("ACCEPTED")
    if matches_path:
        draw_matches(pre0, pre1, pts0, pts1, inlier_mask, matches_path, debug_lines)
        print(f"  >> Saved debug image: {matches_path}")

    stats['timings'] = timings
    return canvas, stats


# ── stitching orchestration ─────────────────────────────────────────────

def stitch_folder(folder, enabled_steps, min_match_pct=8.0, harmonize=False, n_downscale=0.5, debug=True):
    """Multi-group iterative stitching.

    Algorithm (as described in the process):
      1. Take first image as ref, iterate remaining images trying to stitch.
      2. If a stitch succeeds, the result becomes the new ref; continue.
      3. After a full pass, if some images could not be stitched:
         - Use the first unstitched image as a *new* ref group.
         - Try to stitch remaining unstitched images onto it.
      4. After all images belong to a group, try to merge the groups together.
      5. Repeat until no more merges are possible.
    """
    files = sorted([
        os.path.join(folder, f) for f in os.listdir(folder)
        if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS
    ])

    if len(files) < 2:
        print(f"Error: need at least 2 images, found {len(files)}.")
        sys.exit(1)

    print(f"{'=' * 60}")
    print(f"  Found {len(files)} images in {folder}")
    print(f"{'=' * 60}")
    for i, f in enumerate(files):
        print(f"  [{i}] {os.path.basename(f)}")
    print()

    debug_dir = make_debug_dir(folder) if debug else None
    if debug_dir:
        print(f">> Debug images will be saved to {debug_dir}/")
        print()

    # ── Phase 1: build groups ───────────────────────────────────────────
    # Each group is (composite_image, [list_of_source_names])
    images = {os.path.basename(f): cv2.imread(f) for f in files}
    ungrouped = list(images.keys())  # names not yet in any group
    groups = []  # list of (image, [names])

    stitch_counter = 0  # running counter for intermediate debug images
    group_idx = 0
    while ungrouped:
        ref_name = ungrouped.pop(0)
        ref_img = images[ref_name]
        group_names = [ref_name]
        print(f"{'=' * 60}")
        print(f"  GROUP {group_idx} — starting with {ref_name}")
        print(f"{'=' * 60}")

        changed = True
        pass_num = 0
        while changed:
            changed = False
            pass_num += 1
            still_ungrouped = []

            print(f"\n  Pass {pass_num} — {len(ungrouped)} candidate(s)")
            for name in ungrouped:
                print(f"\n{'-' * 40}")
                print(f"  ref=[{'+ '.join(group_names)}]  mov={name}")
                print(f"{'-' * 40}")

                base = os.path.splitext(name)[0]
                mp = os.path.join(debug_dir, f"g{group_idx}_p{pass_num}_{base}.jpg") if debug_dir else None

                result, stats = try_stitch(
                    ref_img, images[name], enabled_steps,
                    min_match_pct, harmonize, n_downscale, matches_path=mp,
                )

                if result is not None:
                    ref_img = result
                    group_names.append(name)
                    changed = True
                    stitch_counter += 1
                    print(f"  >> STITCHED {name} into group {group_idx}")
                    if debug_dir:
                        intermediate_path = os.path.join(
                            debug_dir,
                            f"stitch_{stitch_counter:03d}_g{group_idx}_{'+'.join(group_names)}.jpg",
                        )
                        cv2.imwrite(intermediate_path, ref_img)
                        print(f"  >> Saved intermediate result: {intermediate_path}")
                else:
                    still_ungrouped.append(name)
                    print(f"  >> SKIPPED {name}")

            ungrouped = still_ungrouped

        groups.append((ref_img, group_names))
        print(f"\n  Group {group_idx} complete: [{', '.join(group_names)}] "
              f"({ref_img.shape[1]}x{ref_img.shape[0]})")
        group_idx += 1

    # ── Phase 2: merge groups ───────────────────────────────────────────
    if len(groups) > 1:
        print(f"\n{'=' * 60}")
        print(f"  MERGING {len(groups)} groups")
        print(f"{'=' * 60}")

        merge_pass = 0
        changed = True
        while changed and len(groups) > 1:
            changed = False
            merge_pass += 1
            new_groups = [groups[0]]

            for i in range(1, len(groups)):
                g_img, g_names = groups[i]
                merged = False

                for j in range(len(new_groups)):
                    nj_img, nj_names = new_groups[j]
                    label_ref = '+'.join(nj_names)
                    label_mov = '+'.join(g_names)
                    print(f"\n{'-' * 40}")
                    print(f"  Merge attempt: [{label_ref}] + [{label_mov}]")
                    print(f"{'-' * 40}")

                    mp = os.path.join(debug_dir, f"merge{merge_pass}_g{j}_g{i}.jpg") if debug_dir else None
                    result, stats = try_stitch(
                        nj_img, g_img, enabled_steps,
                        min_match_pct, harmonize, n_downscale, matches_path=mp,
                    )

                    if result is not None:
                        new_groups[j] = (result, nj_names + g_names)
                        changed = True
                        merged = True
                        stitch_counter += 1
                        print(f"  >> MERGED groups into [{', '.join(nj_names + g_names)}]")
                        if debug_dir:
                            merge_path = os.path.join(
                                debug_dir,
                                f"stitch_{stitch_counter:03d}_merge_{'+'.join(nj_names + g_names)}.jpg",
                            )
                            cv2.imwrite(merge_path, result)
                            print(f"  >> Saved merge result: {merge_path}")
                        break

                if not merged:
                    new_groups.append(groups[i])

            groups = new_groups

    # ── Output ──────────────────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"  RESULT — {len(groups)} group(s)")
    print(f"{'=' * 60}")

    a_o_group_result = []
    for i, (img, names) in enumerate(groups):
        h, w = img.shape[:2]
        if len(groups) == 1:
            s_path__out = "stitched.png"
        else:
            s_path__out = f"stitched_group{i}.png"
        cv2.imwrite(s_path__out, img)
        print(f"  Group {i}: {len(names)} image(s) — [{', '.join(names)}]")
        print(f"    Saved ({w}x{h}) to {s_path__out}")
        a_o_group_result.append({
            "n_idx__group": i,
            "a_s_name__image": names,
            "n_scl_x": w,
            "n_scl_y": h,
            "s_path__output": s_path__out,
        })

    print(f"{'=' * 60}")

    return {
        "b_success": True,
        "n_group": len(groups),
        "a_o_group": a_o_group_result,
        "s_path__debug": debug_dir,
    }


def stitch_hamiltonian(folder, enabled_steps, min_match_pct=8.0, harmonize=True, n_downscale=0.5, debug=True):
    """Hamiltonian chain stitching.

    Build a directed chain of pairwise matches where each image is used exactly once.
      1. Start with the first image as anchor.
      2. For the current ref, find any matching unvisited image.
      3. Record the translation offset.
      4. The matched image becomes the new ref.  Repeat.
      5. Compute absolute positions by chaining offsets from the anchor.
      6. Compose all matched images onto a single canvas.
    Images with no match are skipped and reported.
    """
    files = sorted([
        os.path.join(folder, f) for f in os.listdir(folder)
        if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS
    ])

    if len(files) < 2:
        print(f"Error: need at least 2 images, found {len(files)}.")
        sys.exit(1)

    print(f"{'=' * 60}")
    print(f"  Found {len(files)} images in {folder}")
    print(f"{'=' * 60}")
    for i, f in enumerate(files):
        print(f"  [{i}] {os.path.basename(f)}")
    print()

    s_path__debug = make_debug_dir(folder) if debug else None
    if s_path__debug:
        print(f">> Debug images will be saved to {s_path__debug}/")
        print()

    # load all images
    o_image = {}
    for f in files:
        s_name = os.path.basename(f)
        o_image[s_name] = cv2.imread(f)

    a_s_name = list(o_image.keys())

    # ── Phase 1: build chain ───────────────────────────────────────────
    print(f"{'=' * 60}")
    print(f"  PHASE 1 — Building hamiltonian chain")
    print(f"{'=' * 60}")

    s_name__ref = a_s_name[0]
    set_s_name__visited = {s_name__ref}
    a_s_name__chain = [s_name__ref]
    a_o_edge = []

    n_step = 0
    while len(set_s_name__visited) < len(a_s_name):
        n_step += 1
        n_remaining = len(a_s_name) - len(set_s_name__visited)
        print(f"\n  Step {n_step} — ref={s_name__ref}, {n_remaining} candidate(s)")

        o_match__found = None
        s_name__found = None

        for s_name__candidate in a_s_name:
            if s_name__candidate in set_s_name__visited:
                continue

            print(f"\n{'-' * 40}")
            print(f"  {s_name__ref}  vs  {s_name__candidate}")
            print(f"{'-' * 40}")

            s_path__match = None
            if s_path__debug:
                s_base__ref = os.path.splitext(s_name__ref)[0]
                s_base__cand = os.path.splitext(s_name__candidate)[0]
                s_path__match = os.path.join(
                    s_path__debug,
                    f"step{n_step:02d}_{s_base__ref}_vs_{s_base__cand}.jpg",
                )

            o_match, o_stat = try_match(
                o_image[s_name__ref], o_image[s_name__candidate],
                enabled_steps, min_match_pct, n_downscale, matches_path=s_path__match,
            )

            if o_match is not None:
                o_match__found = o_match
                s_name__found = s_name__candidate
                break

        if o_match__found is None:
            print(f"\n  No valid match found for {s_name__ref} — chain ended.")
            break

        a_o_edge.append({
            's_name__ref': s_name__ref,
            's_name__mov': s_name__found,
            'n_dx': o_match__found['n_dx'],
            'n_dy': o_match__found['n_dy'],
            'n_pct__match': o_match__found['n_pct__match'],
            'n_pct__inlier': o_match__found['n_pct__inlier'],
        })
        set_s_name__visited.add(s_name__found)
        a_s_name__chain.append(s_name__found)
        print(f"\n  >> MATCH FOUND: {s_name__found} "
              f"(dx={o_match__found['n_dx']}, dy={o_match__found['n_dy']}, "
              f"inlier={o_match__found['n_pct__inlier']:.1f}%)")

        # save pairwise merged preview to debug folder
        if s_path__debug:
            img_ref = o_image[s_name__ref]
            img_mov = o_image[s_name__found]
            n_dx = o_match__found['n_dx']
            n_dy = o_match__found['n_dy']
            h_r, w_r = img_ref.shape[:2]
            h_m, w_m = img_mov.shape[:2]
            n_x__min = min(0, n_dx)
            n_y__min = min(0, n_dy)
            n_x__max = max(w_r, n_dx + w_m)
            n_y__max = max(h_r, n_dy + h_m)
            n_scl_x__canvas = n_x__max - n_x__min
            n_scl_y__canvas = n_y__max - n_y__min
            a_canvas = np.zeros((n_scl_y__canvas, n_scl_x__canvas, 3), dtype=np.uint8)
            n_off_x__ref = -n_x__min
            n_off_y__ref = -n_y__min
            a_canvas[n_off_y__ref:n_off_y__ref + h_r, n_off_x__ref:n_off_x__ref + w_r] = img_ref
            n_off_x__mov = n_dx - n_x__min
            n_off_y__mov = n_dy - n_y__min
            # blend overlap with 50/50 mix for preview
            a_region = a_canvas[n_off_y__mov:n_off_y__mov + h_m, n_off_x__mov:n_off_x__mov + w_m]
            a_mask__existing = (a_region.sum(axis=2) > 0)
            a_region[~a_mask__existing] = img_mov[~a_mask__existing]
            a_region[a_mask__existing] = (
                a_region[a_mask__existing].astype(np.float64) * 0.5
                + img_mov[a_mask__existing].astype(np.float64) * 0.5
            ).astype(np.uint8)
            s_base__ref = os.path.splitext(s_name__ref)[0]
            s_base__mov = os.path.splitext(s_name__found)[0]
            s_path__preview = os.path.join(
                s_path__debug,
                f"match_{n_step:02d}_{s_base__ref}+{s_base__mov}.jpg",
            )
            cv2.imwrite(s_path__preview, a_canvas)
            print(f"  >> Saved match preview: {s_path__preview}")

        s_name__ref = s_name__found

    # report skipped images
    a_s_name__skipped = [n for n in a_s_name if n not in set_s_name__visited]
    if a_s_name__skipped:
        print(f"\n  Skipped {len(a_s_name__skipped)} image(s) with no match:")
        for s in a_s_name__skipped:
            print(f"    - {s}")

    print(f"\n  Chain ({len(a_s_name__chain)} image(s)): {' -> '.join(a_s_name__chain)}")

    if len(a_s_name__chain) < 2:
        print("  Cannot stitch: chain has fewer than 2 images.")
        return {
            "b_success": False,
            "s_method": "hamiltonian",
            "a_s_name__skipped": a_s_name__skipped,
            "s_path__debug": s_path__debug,
        }

    # ── Phase 2: compute absolute positions ────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"  PHASE 2 — Computing absolute positions")
    print(f"{'=' * 60}")

    o_pos = {a_s_name__chain[0]: (0, 0)}
    for o_edge in a_o_edge:
        n_ref_x, n_ref_y = o_pos[o_edge['s_name__ref']]
        o_pos[o_edge['s_name__mov']] = (
            n_ref_x + o_edge['n_dx'],
            n_ref_y + o_edge['n_dy'],
        )

    for s_name in a_s_name__chain:
        n_x, n_y = o_pos[s_name]
        print(f"  {s_name}: x={n_x}, y={n_y}")

    # bounding box
    n_x__min = 0
    n_y__min = 0
    n_x__max = 0
    n_y__max = 0
    for s_name in a_s_name__chain:
        n_x, n_y = o_pos[s_name]
        img = o_image[s_name]
        h, w = img.shape[:2]
        n_x__min = min(n_x__min, n_x)
        n_y__min = min(n_y__min, n_y)
        n_x__max = max(n_x__max, n_x + w)
        n_y__max = max(n_y__max, n_y + h)

    n_scl_x__canvas = n_x__max - n_x__min
    n_scl_y__canvas = n_y__max - n_y__min
    print(f"  Canvas size: {n_scl_x__canvas}x{n_scl_y__canvas}")

    # ── Phase 3: compose ───────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"  PHASE 3 — Compositing")
    print(f"{'=' * 60}")

    t0 = time.perf_counter()
    canvas = np.zeros((n_scl_y__canvas, n_scl_x__canvas, 3), dtype=np.uint8)

    for n_idx, s_name in enumerate(a_s_name__chain):
        img = o_image[s_name].copy()

        # colour harmonization: transfer to predecessor in chain
        if harmonize and n_idx > 0:
            img = color_transfer(img, o_image[a_s_name__chain[n_idx - 1]])

        h, w = img.shape[:2]
        n_x, n_y = o_pos[s_name]
        n_ox = n_x - n_x__min
        n_oy = n_y - n_y__min

        placed = np.zeros_like(canvas)
        placed[n_oy:n_oy + h, n_ox:n_ox + w] = img

        mask_canvas = (canvas.sum(axis=2) > 0)
        mask_placed = (placed.sum(axis=2) > 0)
        overlap = mask_canvas & mask_placed
        only_new = mask_placed & ~mask_canvas

        if harmonize and overlap.any():
            # linear gradient blend in overlap region
            blend_alpha = np.zeros((n_scl_y__canvas, n_scl_x__canvas), dtype=np.float64)
            blend_alpha[mask_canvas] = 1.0
            for row in range(n_scl_y__canvas):
                a_n_col = np.where(overlap[row])[0]
                if len(a_n_col) == 0:
                    continue
                n_left = a_n_col[0]
                n_right = a_n_col[-1]
                if n_right > n_left:
                    blend_alpha[row, n_left:n_right + 1] = np.linspace(1.0, 0.0, n_right - n_left + 1)
            blend_alpha_3 = blend_alpha[..., np.newaxis]
            blended = (blend_alpha_3 * canvas.astype(np.float64)
                       + (1.0 - blend_alpha_3) * placed.astype(np.float64))
            canvas = np.clip(blended, 0, 255).astype(np.uint8)
            canvas[only_new] = placed[only_new]
        else:
            canvas[overlap] = placed[overlap]
            canvas[only_new] = placed[only_new]

        print(f"  Placed {s_name} ({w}x{h}) at ({n_ox},{n_oy})")

        # save intermediate debug composite
        if s_path__debug:
            s_path__step = os.path.join(
                s_path__debug,
                f"compose_{n_idx:03d}_{os.path.splitext(s_name)[0]}.jpg",
            )
            cv2.imwrite(s_path__step, canvas)
            print(f"  >> Saved step: {s_path__step}")

    n_ms__composite = (time.perf_counter() - t0) * 1000
    print(f"  Compositing: {n_ms__composite:.0f}ms")

    # ── Output ─────────────────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"  RESULT — hamiltonian chain")
    print(f"{'=' * 60}")

    s_path__out = "stitched.png"
    cv2.imwrite(s_path__out, canvas)
    n_scl_x = canvas.shape[1]
    n_scl_y = canvas.shape[0]
    print(f"  Chain: {' -> '.join(a_s_name__chain)}")
    print(f"  Saved ({n_scl_x}x{n_scl_y}) to {s_path__out}")
    if a_s_name__skipped:
        print(f"  Skipped: {', '.join(a_s_name__skipped)}")
    print(f"{'=' * 60}")

    return {
        "b_success": True,
        "s_method": "hamiltonian",
        "n_scl_x": n_scl_x,
        "n_scl_y": n_scl_y,
        "s_path__output": s_path__out,
        "a_s_name__chain": a_s_name__chain,
        "a_o_edge": a_o_edge,
        "a_s_name__skipped": a_s_name__skipped,
        "s_path__debug": s_path__debug,
    }


def stitch_pair(path0, path1, enabled_steps, min_match_pct=8.0, harmonize=False, n_downscale=0.5, debug=True):
    """Stitch exactly two images."""
    img0 = cv2.imread(path0)
    img1 = cv2.imread(path1)
    if img0 is None:
        print(f"Error: could not read {path0}")
        sys.exit(1)
    if img1 is None:
        print(f"Error: could not read {path1}")
        sys.exit(1)

    mp = None
    s_path__debug = None
    if debug:
        s_path__debug = make_debug_dir(".")
        base0 = os.path.splitext(os.path.basename(path0))[0]
        base1 = os.path.splitext(os.path.basename(path1))[0]
        mp = os.path.join(s_path__debug, f"{base0}_vs_{base1}.jpg")

    result, stats = try_stitch(img0, img1, enabled_steps, min_match_pct, harmonize, n_downscale, matches_path=mp)
    if result is None:
        print("Stitching failed.")
        return {
            "b_success": False,
            "s_path__debug": s_path__debug,
        }
    h, w = result.shape[:2]
    s_path__out = "stitched.png"
    cv2.imwrite(s_path__out, result)
    print(f"Saved stitched image ({w}x{h}) to {s_path__out}")

    return {
        "b_success": True,
        "n_scl_x": w,
        "n_scl_y": h,
        "s_path__output": s_path__out,
        "s_path__debug": s_path__debug,
    }


# ── logging ─────────────────────────────────────────────────────────────

def log_options(enabled_steps, min_match_pct, harmonize, debug, s_method="hamiltonian", n_downscale=0.5, n_keypoint=1024):
    """Print a clear summary of all available options and their current state."""
    print(f"{'=' * 60}")
    print(f"  IMAGE MERGING — LightGlue + SuperPoint")
    print(f"{'=' * 60}")
    print()
    print("  Preprocessing options:")
    s_downscale = f"{n_downscale:.0%}" if n_downscale < 1.0 else "OFF"
    print(f"    [{s_downscale:>3}]  --downscale                      Downscale images before feature extraction (default: 0.5)")
    print(f"    [{n_keypoint:>5}]  --keypoints                     Max keypoints for SuperPoint (default: 1024)")
    for name, entry in PREPROCESSING_REGISTRY.items():
        state = "ON" if name in enabled_steps else "OFF"
        flag = f"--{name} / --no-{name}"
        print(f"    [{state:>3}]  {flag:<30s}  {entry['description']}")
    print()
    print("  Stitching options:")
    print(f"    [{s_method:>12}]  --method                        Stitching method (hamiltonian | greedy)")
    print(f"    [{'ON' if harmonize else 'OFF':>3}]  --harmonize / --no-harmonize    Blend overlap with colour transfer + gradient crossfade")
    print(f"    [{'ON' if debug else 'OFF':>3}]  --debug / --no-debug            Save match visualisations and intermediate stitched results")
    print()
    print("  Thresholds:")
    print(f"    --min-match-pct  = {min_match_pct:.1f}%")
    print(f"    inlier_residual  = {INLIER_RESIDUAL_PX:.1f}px")
    print(f"    min_inlier_pct   = {MIN_INLIER_PCT:.1f}%")
    print(f"    min_ncc          = {f'{MIN_NCC:.2f}' if MIN_NCC is not None else 'disabled'}")
    print()


# ── CLI ─────────────────────────────────────────────────────────────────

def build_parser():
    parser = argparse.ArgumentParser(
        description="Image merging with configurable preprocessing (LightGlue + SuperPoint).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("inputs", nargs='+', help="Two image paths, or a single folder path")
    parser.add_argument("--method", choices=["hamiltonian", "greedy"], default="hamiltonian",
                        help="Stitching method: 'hamiltonian' chain (default) or 'greedy' iterative groups")
    parser.add_argument("--downscale", type=float, default=0.5,
                        help="Downscale factor for feature extraction (default: 0.5, use 1.0 to disable)")
    parser.add_argument("--keypoints", type=int, default=1024,
                        help="Max number of keypoints for SuperPoint extractor (default: 1024)")
    parser.add_argument("--min-match-pct", type=float, default=8.0,
                        help="Minimum match %% to accept a stitch (default: 8.0)")
    grp_harm = parser.add_mutually_exclusive_group()
    grp_harm.add_argument("--harmonize", action="store_true", default=True, dest="harmonize",
                          help="Enable colour-transfer + gradient blending in overlap regions (default: on)")
    grp_harm.add_argument("--no-harmonize", action="store_false", dest="harmonize",
                          help="Disable colour-transfer + gradient blending")
    grp_dbg = parser.add_mutually_exclusive_group()
    grp_dbg.add_argument("--debug", action="store_true", default=True, dest="debug",
                         help="Save debug match images and intermediate stitched results (default: on)")
    grp_dbg.add_argument("--no-debug", action="store_false", dest="debug",
                         help="Disable saving debug images")

    # dynamically add --<name> / --no-<name> for each preprocessing
    for name, entry in PREPROCESSING_REGISTRY.items():
        grp = parser.add_mutually_exclusive_group()
        grp.add_argument(f"--{name}", action="store_true", default=entry['default'],
                         dest=name, help=f"Enable {entry['description']}")
        grp.add_argument(f"--no-{name}", action="store_false", dest=name,
                         help=f"Disable {entry['description']}")

    return parser


if __name__ == '__main__':
    parser = build_parser()
    args = parser.parse_args()

    # load S_UUID from .env for machine-readable output
    o_env = load_env()
    s_uuid = o_env.get("S_UUID", "")

    # initialize models with configured keypoint count
    init_models(args.keypoints)

    # collect enabled preprocessing steps (preserve registration order)
    enabled_steps = [name for name in PREPROCESSING_REGISTRY if getattr(args, name)]

    log_options(enabled_steps, args.min_match_pct, args.harmonize, args.debug, args.method, args.downscale, args.keypoints)

    o_result = None
    if len(args.inputs) == 1 and os.path.isdir(args.inputs[0]):
        if args.method == "hamiltonian":
            o_result = stitch_hamiltonian(args.inputs[0], enabled_steps, args.min_match_pct, args.harmonize, args.downscale, args.debug)
        else:
            o_result = stitch_folder(args.inputs[0], enabled_steps, args.min_match_pct, args.harmonize, args.downscale, args.debug)
    elif len(args.inputs) == 2:
        o_result = stitch_pair(args.inputs[0], args.inputs[1], enabled_steps, args.min_match_pct, args.harmonize, args.downscale, args.debug)
    else:
        parser.error("Provide either two image paths or a single folder path.")

    if not o_result or not o_result.get("b_success"):
        if o_result:
            o_result["b_success"] = False
        else:
            o_result = {"b_success": False}
        if s_uuid:
            emit_tagged(s_uuid, "json", json.dumps(o_result))
        sys.exit(1)

    if s_uuid:
        emit_tagged(s_uuid, "json", json.dumps(o_result))
