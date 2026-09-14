import cv2
import numpy as np
import sys
import json
import os
import time

# usage: python autostitch.py <base_image_path> <new_image_path> [--min-extension-pct 5.0] [--downscale 0.5] [--keypoints 1024] [--min-match-pct 8.0]
# outputs JSON to stdout:
# {
#   "b_success": bool,
#   "b_extended": bool,
#   "b_replaced": bool,
#   "s_path_output": str,
#   "n_x": int,
#   "n_y": int,
#   "n_scl_x__new": int,
#   "n_scl_y__new": int,
#   "n_scl_x__base": int,
#   "n_scl_y__base": int,
#   "n_pct__new_pixel": float,
#   "s_error": str,
#   "a_s_line": [ ... timing / diagnostic lines ... ]
# }

# import lgsp_imerge from the same directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lgsp_imerge import init_models, try_match


def f_log(s_line, a_s_line=None):
    """Timing/diagnostic line: always to stderr, optionally collected for the
    JSON result (a_s_line) so the web client can show it."""
    print(s_line, file=sys.stderr)
    if a_s_line is not None:
        a_s_line.append(s_line)

def f_o_result__replaced(s_path_base, n_scl_x__new, n_scl_y__new):
    """Helper: return result for 'base replaced with new image'."""
    return {
        "b_success": True, "b_extended": False, "b_replaced": True,
        "s_path_output": s_path_base, "s_error": "",
        "n_x": 0, "n_y": 0,
        "n_scl_x__new": n_scl_x__new, "n_scl_y__new": n_scl_y__new,
        "n_scl_x__base": n_scl_x__new, "n_scl_y__base": n_scl_y__new,
        "n_pct__new_pixel": 100.0,
    }

def f_stitch_incremental(s_path_base, s_path_new, n_pct__min_extension=5.0, n_downscale=0.5, n_min_match_pct=8.0):
    """Incrementally stitch s_path_new onto the base image at s_path_base.

    Uses SuperPoint + LightGlue (via lgsp_imerge) for robust feature matching.
    Every stage duration is logged (stderr + a_s_line in the JSON result) so a
    slow session can be traced to the exact step.
    """
    a_s_line = []
    n_ms__t0 = time.perf_counter()

    n_ms__t = time.perf_counter()
    o_img_new = cv2.imread(s_path_new)
    n_ms__read__new = (time.perf_counter() - n_ms__t) * 1000
    f_log(f"autostitch: read new ({n_ms__read__new:.0f}ms)", a_s_line)
    if o_img_new is None:
        return {
            "b_success": False, "b_extended": False, "b_replaced": False,
            "s_path_output": s_path_base, "s_error": f"failed to read new image: {s_path_new}",
            "n_x": 0, "n_y": 0,
            "n_scl_x__new": 0, "n_scl_y__new": 0,
            "n_scl_x__base": 0, "n_scl_y__base": 0,
            "n_pct__new_pixel": 0.0,
            "a_s_line": a_s_line,
        }

    n_scl_y__new, n_scl_x__new = o_img_new.shape[:2]

    # if base does not exist, the new image becomes the base
    if not os.path.exists(s_path_base):
        n_ms__t = time.perf_counter()
        cv2.imwrite(s_path_base, o_img_new)
        f_log(f"autostitch: no base yet -> wrote first image "
              f"({(time.perf_counter() - n_ms__t) * 1000:.0f}ms, "
              f"total {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms)", a_s_line)
        return f_o_result__replaced(s_path_base, n_scl_x__new, n_scl_y__new)

    n_ms__t = time.perf_counter()
    o_img_base = cv2.imread(s_path_base)
    n_ms__read__base = (time.perf_counter() - n_ms__t) * 1000
    f_log(f"autostitch: read base ({n_ms__read__base:.0f}ms)", a_s_line)
    if o_img_base is None:
        # base file corrupted or unreadable, replace it
        cv2.imwrite(s_path_base, o_img_new)
        return f_o_result__replaced(s_path_base, n_scl_x__new, n_scl_y__new)

    n_scl_y__base, n_scl_x__base = o_img_base.shape[:2]

    # use lgsp_imerge try_match: base is ref (img0), new is mov (img1)
    # try_match returns (o_match, o_stat) or (None, o_stat)
    # o_match = {'n_dx': int, 'n_dy': int, 'n_pct__match': float, 'n_pct__inlier': float}
    # n_dx/n_dy = translation of mov relative to ref (mov placed at ref_origin + dx,dy)
    a_s_enabled_step = ['clahe']
    n_ms__t = time.perf_counter()
    o_match, o_stat = try_match(
        o_img_base, o_img_new,
        a_s_enabled_step,
        min_match_pct=n_min_match_pct,
        n_downscale=n_downscale,
        matches_path=None,
    )
    n_ms__match = (time.perf_counter() - n_ms__t) * 1000
    f_log(f"autostitch: feature match {n_ms__match:.0f}ms", a_s_line)

    if o_match is None:
        # no overlap found, replace base with new image
        n_ms__t = time.perf_counter()
        cv2.imwrite(s_path_base, o_img_new)
        f_log(f"autostitch: no overlap -> replaced base "
              f"(write {(time.perf_counter() - n_ms__t) * 1000:.0f}ms, "
              f"total {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms)", a_s_line)
        return f_o_result__replaced(s_path_base, n_scl_x__new, n_scl_y__new)

    n_dx = o_match['n_dx']
    n_dy = o_match['n_dy']

    # new image position in base coordinates
    n_x__new_in_base = n_dx
    n_y__new_in_base = n_dy

    # compute the bounding box of the combined image
    n_x__min = min(0, n_x__new_in_base)
    n_y__min = min(0, n_y__new_in_base)
    n_x__max = max(n_scl_x__base, n_x__new_in_base + n_scl_x__new)
    n_y__max = max(n_scl_y__base, n_y__new_in_base + n_scl_y__new)

    n_scl_x__result = n_x__max - n_x__min
    n_scl_y__result = n_y__max - n_y__min

    # compute how many new pixels are added (pixels of new image outside current base)
    n_x__overlap_start = max(0, n_x__new_in_base)
    n_y__overlap_start = max(0, n_y__new_in_base)
    n_x__overlap_end = min(n_scl_x__base, n_x__new_in_base + n_scl_x__new)
    n_y__overlap_end = min(n_scl_y__base, n_y__new_in_base + n_scl_y__new)

    n_pixel__overlap = max(0, n_x__overlap_end - n_x__overlap_start) * max(0, n_y__overlap_end - n_y__overlap_start)
    n_pixel__new_total = n_scl_x__new * n_scl_y__new
    n_pixel__new_area = n_pixel__new_total - n_pixel__overlap
    n_pct__new_pixel = (n_pixel__new_area / n_pixel__new_total) * 100.0 if n_pixel__new_total > 0 else 0.0

    # position of new image in the result coordinate system
    n_x__new_in_result = n_x__new_in_base - n_x__min
    n_y__new_in_result = n_y__new_in_base - n_y__min

    # if below threshold, skip extension but return position info
    if n_pct__new_pixel < n_pct__min_extension:
        f_log(f"autostitch: skip ({n_pct__new_pixel:.1f}% new < "
              f"{n_pct__min_extension:.1f}%, total "
              f"{(time.perf_counter() - n_ms__t0) * 1000:.0f}ms)", a_s_line)
        return {
            "b_success": True, "b_extended": False, "b_replaced": False,
            "s_path_output": s_path_base, "s_error": "",
            "n_x": n_x__new_in_base, "n_y": n_y__new_in_base,
            "n_scl_x__new": n_scl_x__new, "n_scl_y__new": n_scl_y__new,
            "n_scl_x__base": n_scl_x__base, "n_scl_y__base": n_scl_y__base,
            "n_pct__new_pixel": round(n_pct__new_pixel, 2),
            "a_s_line": a_s_line,
        }

    # create the expanded canvas and composite
    n_ms__t = time.perf_counter()
    o_img_result = np.zeros((n_scl_y__result, n_scl_x__result, 3), dtype=np.uint8)

    # place base image
    n_x__base_in_result = 0 - n_x__min
    n_y__base_in_result = 0 - n_y__min
    o_img_result[
        n_y__base_in_result : n_y__base_in_result + n_scl_y__base,
        n_x__base_in_result : n_x__base_in_result + n_scl_x__base
    ] = o_img_base

    # place new image (overwrites overlap region)
    o_img_result[
        n_y__new_in_result : n_y__new_in_result + n_scl_y__new,
        n_x__new_in_result : n_x__new_in_result + n_scl_x__new
    ] = o_img_new
    n_ms__composite = (time.perf_counter() - n_ms__t) * 1000

    # save result as base
    n_ms__t = time.perf_counter()
    cv2.imwrite(s_path_base, o_img_result, [cv2.IMWRITE_JPEG_QUALITY, 90])
    n_ms__write = (time.perf_counter() - n_ms__t) * 1000
    n_ms__total = (time.perf_counter() - n_ms__t0) * 1000
    f_log(f"autostitch: composite {n_ms__composite:.0f}ms, write "
          f"{n_ms__write:.0f}ms, TOTAL {n_ms__total:.0f}ms", a_s_line)

    return {
        "b_success": True, "b_extended": True, "b_replaced": False,
        "s_path_output": s_path_base, "s_error": "",
        "n_x": n_x__new_in_result, "n_y": n_y__new_in_result,
        "n_scl_x__new": n_scl_x__new, "n_scl_y__new": n_scl_y__new,
        "n_scl_x__base": n_scl_x__result, "n_scl_y__base": n_scl_y__result,
        "n_pct__new_pixel": round(n_pct__new_pixel, 2),
        "a_s_line": a_s_line,
    }


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({
            "b_success": False, "b_extended": False, "b_replaced": False,
            "s_path_output": "", "s_error": "usage: python autostitch.py <base_path> <new_image_path> [--min-extension-pct 5.0] [--downscale 0.5] [--keypoints 1024] [--min-match-pct 8.0]",
            "n_x": 0, "n_y": 0,
            "n_scl_x__new": 0, "n_scl_y__new": 0,
            "n_scl_x__base": 0, "n_scl_y__base": 0,
            "n_pct__new_pixel": 0.0,
        }))
        sys.exit(1)

    n_pct__min_extension = 5.0
    n_downscale = 0.5
    n_keypoint = 1024
    n_min_match_pct = 8.0
    a_s_arg = []
    n_idx = 1
    while n_idx < len(sys.argv):
        if sys.argv[n_idx] == '--min-extension-pct' and n_idx + 1 < len(sys.argv):
            n_pct__min_extension = float(sys.argv[n_idx + 1])
            n_idx += 2
        elif sys.argv[n_idx] == '--downscale' and n_idx + 1 < len(sys.argv):
            n_downscale = float(sys.argv[n_idx + 1])
            n_idx += 2
        elif sys.argv[n_idx] == '--keypoints' and n_idx + 1 < len(sys.argv):
            n_keypoint = int(sys.argv[n_idx + 1])
            n_idx += 2
        elif sys.argv[n_idx] == '--min-match-pct' and n_idx + 1 < len(sys.argv):
            n_min_match_pct = float(sys.argv[n_idx + 1])
            n_idx += 2
        else:
            a_s_arg.append(sys.argv[n_idx])
            n_idx += 1

    s_path_base = a_s_arg[0]
    s_path_new = a_s_arg[1]

    # lgsp_imerge prints its diagnostics (incl. per-stage timings) to stdout;
    # redirect them to stderr so the JSON result stays the only thing on stdout
    sys.stdout = sys.stderr

    # initialize SuperPoint + LightGlue models
    n_ms__t0 = time.perf_counter()
    init_models(n_keypoint)
    print(f"autostitch: model init {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms")

    o_result = f_stitch_incremental(s_path_base, s_path_new, n_pct__min_extension, n_downscale, n_min_match_pct)
    sys.stdout = sys.__stdout__
    print(json.dumps(o_result))
    sys.exit(0 if o_result["b_success"] else 1)
