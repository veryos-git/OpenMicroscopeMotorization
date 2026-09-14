# focus stacking: combine a series of images captured at different focus depths
# into one all-in-focus image.
#
# The browser sweeps the focus motor and saves one frame per depth as
# z_0001.png, z_0002.png, ...  This script reads them in filename order,
# aligns each to a reference frame (translation only, phase correlation —
# the focus motor is the Z axis, so XY drift is small), measures the local
# sharpness with a Laplacian and blends the stack with a Laplacian pyramid
# so the sharpest region of every depth wins without visible seams.
#
# usage: focus_stack.py <folder> [-o output.png] [--preview N] [--max-dim N]
#                   [--no-align] [--pattern z_] [--quality N]
# progress goes to stderr, the JSON result goes to stdout (one line).

import sys
import json
import time
import numpy as np
import cv2

A_S_EXT__IMAGE = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp")
N_KERNEL__SHARP = 15
N_LEVEL__MAX = 9
N_QUALITY__JPEG = 88


def f_log(s_line):
    """Diagnostics/timings go to stderr so the JSON result stays clean on stdout."""
    print(f"  {s_line}", file=sys.stderr)


def f_a_s_path__image(s_path_folder, s_pattern):
    a_s_path = []
    for o_entry in sorted(s_path_folder.iterdir()):
        if not o_entry.is_file():
            continue
        if o_entry.suffix.lower() not in A_S_EXT__IMAGE:
            continue
        if not o_entry.name.lower().startswith(s_pattern):
            continue
        a_s_path.append(str(o_entry))
    a_s_path.sort()
    return a_s_path


def f_a_o_img__read(a_s_path):
    a_o_img = []
    for s_path in a_s_path:
        o_img = cv2.imread(s_path, cv2.IMREAD_COLOR)
        if o_img is None:
            raise RuntimeError(f"failed to read image: {s_path}")
        a_o_img.append(o_img)
    return a_o_img


def f_a_o_img__max_dim(a_o_img, n_dim__max):
    if not n_dim__max:
        return a_o_img
    n_scl_y, n_scl_x = a_o_img[0].shape[:2]
    n_max = max(n_scl_x, n_scl_y)
    if n_max <= n_dim__max:
        return a_o_img
    n_scale = n_dim__max / float(n_max)
    n_scl_x__new = max(1, int(round(n_scl_x * n_scale)))
    n_scl_y__new = max(1, int(round(n_scl_y * n_scale)))
    f_log(f"downscaling {n_scl_x}x{n_scl_y} -> {n_scl_x__new}x{n_scl_y__new}")
    return [
        cv2.resize(o_img, (n_scl_x__new, n_scl_y__new), interpolation=cv2.INTER_AREA)
        for o_img in a_o_img
    ]


def f_o_win__hann(n_scl_x, n_scl_y):
    # sqrt of a Hann window keeps the phase-correlation spectrum well behaved
    o_hann_x = np.hanning(n_scl_x).astype(np.float32)
    o_hann_y = np.hanning(n_scl_y).astype(np.float32)
    return np.sqrt(np.outer(o_hann_y, o_hann_x))


def f_a_o_img__align(a_o_img):
    """Translation-align every image to the middle one via phase correlation."""
    n_cnt = len(a_o_img)
    if n_cnt < 2:
        return a_o_img

    n_idx__ref = n_cnt // 2
    o_ref = a_o_img[n_idx__ref]
    n_scl_y, n_scl_x = o_ref.shape[:2]
    o_gray__ref = cv2.cvtColor(o_ref, cv2.COLOR_BGR2GRAY).astype(np.float32)
    o_win = f_o_win__hann(n_scl_x, n_scl_y)

    a_o_aligned = [None] * n_cnt
    a_o_aligned[n_idx__ref] = o_ref
    for n_idx, o_img in enumerate(a_o_img):
        if n_idx == n_idx__ref:
            continue
        o_gray = cv2.cvtColor(o_img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        (n_dx, n_dy), n_response = cv2.phaseCorrelate(o_gray__ref, o_gray, o_win)
        if abs(n_dx) < 0.5 and abs(n_dy) < 0.5:
            a_o_aligned[n_idx] = o_img
            continue
        o_m = np.float32([[1.0, 0.0, n_dx], [0.0, 1.0, n_dy]])
        a_o_aligned[n_idx] = cv2.warpAffine(
            o_img, o_m, (n_scl_x, n_scl_y),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT,
        )
    f_log(f"aligned {n_cnt} image(s) to the middle frame (phase correlation)")
    return a_o_aligned


def f_a_o_pyr__gaussian(o_img, n_level):
    a_o_pyr = [o_img.astype(np.float64)]
    for n_lvl in range(n_level - 1):
        o_img = cv2.pyrDown(o_img)
        a_o_pyr.append(o_img.astype(np.float64))
    return a_o_pyr


def f_a_o_pyr__laplacian(o_img, n_level):
    a_o_pyr__gaussian = f_a_o_pyr__gaussian(o_img, n_level)
    a_o_pyr__laplacian = []
    for n_lvl in range(n_level - 1):
        n_scl_y, n_scl_x = a_o_pyr__gaussian[n_lvl].shape[:2]
        o_expanded = cv2.pyrUp(a_o_pyr__gaussian[n_lvl + 1], dstsize=(n_scl_x, n_scl_y))
        a_o_pyr__laplacian.append(a_o_pyr__gaussian[n_lvl] - o_expanded)
    a_o_pyr__laplacian.append(a_o_pyr__gaussian[-1])
    return a_o_pyr__laplacian


def f_o_img__collapse(a_o_pyr__laplacian):
    o_img = a_o_pyr__laplacian[-1]
    for n_lvl in range(len(a_o_pyr__laplacian) - 2, -1, -1):
        n_scl_y, n_scl_x = a_o_pyr__laplacian[n_lvl].shape[:2]
        o_img = cv2.pyrUp(o_img, dstsize=(n_scl_x, n_scl_y))
        o_img = o_img + a_o_pyr__laplacian[n_lvl]
    return o_img


def f_o_img__stack(a_o_img):
    """Blend the stack: Laplacian sharpness -> gaussian weight -> pyramid blend."""
    n_cnt = len(a_o_img)
    n_scl_y, n_scl_x = a_o_img[0].shape[:2]
    n_level = int(np.floor(np.log2(min(n_scl_x, n_scl_y)))) - 3
    n_level = max(2, min(N_LEVEL__MAX, n_level))

    a_o_pyr__lap = []
    a_o_weight = []
    for o_img in a_o_img:
        o_gray = cv2.cvtColor(o_img, cv2.COLOR_BGR2GRAY).astype(np.float64)
        o_lap = np.abs(cv2.Laplacian(o_gray, cv2.CV_64F))
        o_weight = cv2.GaussianBlur(o_lap, (N_KERNEL__SHARP, N_KERNEL__SHARP), 0)
        a_o_weight.append(o_weight)
        a_o_pyr__lap.append(f_a_o_pyr__laplacian(o_img, n_level))

    a_o_pyr__weight = [f_a_o_pyr__gaussian(o_weight, n_level) for o_weight in a_o_weight]

    a_o_pyr__combined = []
    for n_lvl in range(n_level):
        o_num = None
        o_den = None
        for n_idx in range(n_cnt):
            o_w = a_o_pyr__weight[n_idx][n_lvl]
            o_l = a_o_pyr__lap[n_idx][n_lvl]
            if o_num is None:
                o_num = o_w[..., None] * o_l
                o_den = o_w
            else:
                o_num = o_num + o_w[..., None] * o_l
                o_den = o_den + o_w
        a_o_pyr__combined.append(o_num / (o_den[..., None] + 1e-6))

    o_result = f_o_img__collapse(a_o_pyr__combined)
    return np.clip(o_result, 0.0, 255.0).astype(np.uint8)


def f_s_path__preview(o_img, s_path_folder, n_px__preview):
    s_path_preview = str(s_path_folder / "focus_stack_preview.jpg")
    n_scl_y, n_scl_x = o_img.shape[:2]
    n_max = max(n_scl_x, n_scl_y)
    if n_px__preview and n_max > n_px__preview:
        n_scale = n_px__preview / float(n_max)
        o_preview = cv2.resize(
            o_img,
            (max(1, int(round(n_scl_x * n_scale))), max(1, int(round(n_scl_y * n_scale)))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        o_preview = o_img
    cv2.imwrite(
        s_path_preview, o_preview,
        [cv2.IMWRITE_JPEG_QUALITY, N_QUALITY__JPEG],
    )
    return s_path_preview


def f_o_run(o_option):
    from pathlib import Path
    n_ms__t0 = time.perf_counter()
    s_path_folder = Path(o_option["s_path_folder"])
    s_path_output = str(Path(o_option["s_path_output"]).resolve())
    s_pattern = o_option.get("s_pattern", "z_")
    n_dim__max = int(o_option.get("n_dim__max", 0) or 0)
    n_px__preview = int(o_option.get("n_px__preview", 0) or 0)
    b_no_align = bool(o_option.get("b_no_align", False))

    a_s_path = f_a_s_path__image(s_path_folder, s_pattern)
    if len(a_s_path) < 2:
        return {
            "b_success": False,
            "s_path_output": "",
            "s_path_preview": "",
            "n_cnt__image": len(a_s_path),
            "s_error": f"need at least 2 images with pattern '{s_pattern}', found {len(a_s_path)}",
        }
    f_log(f"reading {len(a_s_path)} image(s)")

    a_o_img = f_a_o_img__read(a_s_path)
    a_o_img = f_a_o_img__max_dim(a_o_img, n_dim__max)
    if not b_no_align:
        a_o_img = f_a_o_img__align(a_o_img)

    n_ms__t1 = time.perf_counter()
    o_result = f_o_img__stack(a_o_img)
    f_log(f"stacked {len(a_o_img)} image(s) in {(time.perf_counter() - n_ms__t1) * 1000:.0f}ms")

    n_ms__t2 = time.perf_counter()
    cv2.imwrite(
        s_path_output, o_result,
        [cv2.IMWRITE_PNG_COMPRESSION, 3],
    )
    s_path_preview = f_s_path__preview(o_result, s_path_folder, n_px__preview)
    n_scl_y, n_scl_x = o_result.shape[:2]
    f_log(f"wrote {s_path_output} ({n_scl_x}x{n_scl_y}) in "
          f"{(time.perf_counter() - n_ms__t2) * 1000:.0f}ms, "
          f"TOTAL {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms")

    return {
        "b_success": True,
        "s_path_output": s_path_output,
        "s_path_preview": s_path_preview,
        "n_cnt__image": len(a_o_img),
        "n_scl_x": n_scl_x,
        "n_scl_y": n_scl_y,
        "s_error": "",
    }


if __name__ == "__main__":
    from pathlib import Path

    a_s_arg = sys.argv[1:]
    s_pattern = "z_"
    s_path_output = None
    n_px__preview = 1600
    n_dim__max = 0
    b_no_align = False
    a_s_pos = []

    n_idx = 0
    while n_idx < len(a_s_arg):
        s_arg = a_s_arg[n_idx]
        if s_arg == "--no-align":
            b_no_align = True
            n_idx += 1
        elif s_arg == "-o" and n_idx + 1 < len(a_s_arg):
            s_path_output = a_s_arg[n_idx + 1]
            n_idx += 2
        elif s_arg == "--preview" and n_idx + 1 < len(a_s_arg):
            n_px__preview = int(a_s_arg[n_idx + 1])
            n_idx += 2
        elif s_arg == "--max-dim" and n_idx + 1 < len(a_s_arg):
            n_dim__max = int(a_s_arg[n_idx + 1])
            n_idx += 2
        elif s_arg == "--pattern" and n_idx + 1 < len(a_s_arg):
            s_pattern = a_s_arg[n_idx + 1]
            n_idx += 2
        else:
            a_s_pos.append(s_arg)
            n_idx += 1

    if not a_s_pos:
        print(json.dumps({
            "b_success": False,
            "s_path_output": "",
            "s_path_preview": "",
            "n_cnt__image": 0,
            "s_error": "usage: focus_stack.py <folder> [-o out.png] [--preview N] [--max-dim N] [--no-align] [--pattern z_]",
        }))
        sys.exit(1)

    s_path_folder = str(Path(a_s_pos[0]).resolve())
    if s_path_output is None:
        s_path_output = str(Path(s_path_folder) / "focus_stack.png")

    o_option = {
        "s_path_folder": s_path_folder,
        "s_path_output": s_path_output,
        "s_pattern": s_pattern,
        "n_dim__max": n_dim__max,
        "n_px__preview": n_px__preview,
        "b_no_align": b_no_align,
    }
    try:
        o_result = f_o_run(o_option)
    except Exception as o_error:
        o_result = {
            "b_success": False,
            "s_path_output": "",
            "s_path_preview": "",
            "n_cnt__image": 0,
            "s_error": str(o_error),
        }
    print(json.dumps(o_result))
    sys.exit(0 if o_result["b_success"] else 1)
