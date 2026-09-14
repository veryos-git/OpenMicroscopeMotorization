import cv2
import sys
import json
import os
import time
from pathlib import Path

# usage: python python_stitch.py <output_path> <input_path_1> <input_path_2> ...
# outputs JSON to stdout: { "b_success": true/false, "s_path_output": "...", "s_error": "..." }

def f_log(s_line):
    """Diagnostics/timings go to stderr so the JSON result stays clean on stdout."""
    print(f"  {s_line}", file=sys.stderr)

def f_stitch(s_path_output, a_s_path_input):
    n_ms__t0 = time.perf_counter()
    a_o_img = []
    for s_path in a_s_path_input:
        o_img = cv2.imread(s_path)
        if o_img is None:
            return {"b_success": False, "s_path_output": s_path_output, "s_error": f"failed to read image: {s_path}"}
        a_o_img.append(o_img)

    if len(a_o_img) < 2:
        return {"b_success": False, "s_path_output": s_path_output, "s_error": "need at least 2 images to stitch"}
    f_log(f"read {len(a_o_img)} image(s) in {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms")

    # Pre-check for detectable features to avoid OpenCV FLANN assertion failures
    n_ms__t1 = time.perf_counter()
    o_orb = cv2.ORB_create(nfeatures=1500)
    a_o_img_filtered = []
    a_s_path_filtered = []
    a_s_path_skipped = []
    for n_idx, o_img in enumerate(a_o_img):
        o_gray = cv2.cvtColor(o_img, cv2.COLOR_BGR2GRAY)
        a_kp, a_desc = o_orb.detectAndCompute(o_gray, None)
        if a_desc is None or len(a_kp) < 10:
            a_s_path_skipped.append(a_s_path_input[n_idx])
            continue
        a_o_img_filtered.append(o_img)
        a_s_path_filtered.append(a_s_path_input[n_idx])

    if len(a_o_img_filtered) < 2:
        return {
            "b_success": False,
            "s_path_output": s_path_output,
            "s_error": "need at least 2 images with enough features to stitch",
            "a_s_path_skipped": a_s_path_skipped
        }
    f_log(f"ORB feature pre-check in {(time.perf_counter() - n_ms__t1) * 1000:.0f}ms "
          f"({len(a_o_img_filtered)}/{len(a_o_img)} image(s) with features)")

    n_ms__t2 = time.perf_counter()
    o_stitcher = cv2.Stitcher.create(cv2.Stitcher_SCANS)
    try:
        n_status, o_result = o_stitcher.stitch(a_o_img_filtered)
    except cv2.error as o_err:
        s_err = str(o_err)
        if "runKnnSearch_" in s_err or "knn <= index_->size()" in s_err:
            return {"b_success": False, "s_path_output": s_path_output, "s_error": "not enough features detected"}
        return {"b_success": False, "s_path_output": s_path_output, "s_error": s_err}

    if n_status != cv2.STITCHER_OK:
        a_s_status_message = {
            1: "not enough features detected",
            2: "homography estimation failed",
            3: "camera parameters adjustment failed",
        }
        s_error = a_s_status_message.get(n_status, f"unknown error code {n_status}")
        return {"b_success": False, "s_path_output": s_path_output, "s_error": s_error}
    f_log(f"OpenCV stitcher in {(time.perf_counter() - n_ms__t2) * 1000:.0f}ms")

    n_ms__t3 = time.perf_counter()
    cv2.imwrite(s_path_output, o_result)
    # write a smaller version aswell
    # strongest lossless PNG compression
    cv2.imwrite(
        s_path_output.replace(".jpg", "_compressed.png").replace(".jpeg", "_compressed.png"),
        o_result,
        [
            cv2.IMWRITE_PNG_COMPRESSION, 9,   # 0–9 (9 = smallest, slower)
            cv2.IMWRITE_PNG_STRATEGY, cv2.IMWRITE_PNG_STRATEGY_FILTERED,
            cv2.IMWRITE_PNG_BILEVEL, 0
        ]
    )
    # or use sudo apt install pngquant
    # pngquant --quality=65-90 --ext .png --force image.png

    n_scl_y, n_scl_x = o_result.shape[:2]
    f_log(f"wrote {s_path_output} ({n_scl_x}x{n_scl_y}) in "
          f"{(time.perf_counter() - n_ms__t3) * 1000:.0f}ms, "
          f"TOTAL {(time.perf_counter() - n_ms__t0) * 1000:.0f}ms")
    return {"b_success": True, "s_path_output": s_path_output, "s_error": "", "n_scl_x": n_scl_x, "n_scl_y": n_scl_y}

def f_stitch_row_by_row(s_path_output, o_input_dir):
    """Stitch images row by row: first stitch each row, then stitch all row images together."""
    import re

    a_extensions = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}

    # group files by row number
    # supports tile_rXX_cXX.ext (from scan) and row_XXXX_img_XXXX.ext (from manual stitch)
    o_row_map = {}  # n_idx_row -> sorted list of paths
    for o_path in o_input_dir.iterdir():
        if o_path.suffix.lower() not in a_extensions:
            continue
        o_match = re.match(r'^tile_r(\d+)_c\d+', o_path.stem)
        if not o_match:
            o_match = re.match(r'^row_(\d+)_img_\d+', o_path.stem)
        if not o_match:
            continue
        n_idx_row = int(o_match.group(1))
        if n_idx_row not in o_row_map:
            o_row_map[n_idx_row] = []
        o_row_map[n_idx_row].append(str(o_path))

    if len(o_row_map) < 1:
        return {"b_success": False, "s_path_output": s_path_output, "s_error": "no row images found"}

    a_n_idx_row = sorted(o_row_map.keys())

    # stitch each row
    a_o_img_row = []
    s_path_dir_output = str(Path(s_path_output).parent)
    for n_idx_row in a_n_idx_row:
        a_s_path_in_row = sorted(o_row_map[n_idx_row])
        if len(a_s_path_in_row) < 2:
            # single image in row, just use it directly
            o_img = cv2.imread(a_s_path_in_row[0])
            if o_img is None:
                return {"b_success": False, "s_path_output": s_path_output, "s_error": f"failed to read image: {a_s_path_in_row[0]}"}
            a_o_img_row.append(o_img)
            continue

        s_path_row_output = os.path.join(s_path_dir_output, f"stitched_row_{n_idx_row:04d}.jpg")
        o_result_row = f_stitch(s_path_row_output, a_s_path_in_row)
        if not o_result_row["b_success"]:
            o_result_row["s_error"] = f"row {n_idx_row} failed: {o_result_row['s_error']}"
            return o_result_row

        o_img_row = cv2.imread(s_path_row_output)
        if o_img_row is None:
            return {"b_success": False, "s_path_output": s_path_output, "s_error": f"failed to read stitched row {n_idx_row}"}
        a_o_img_row.append(o_img_row)

    if len(a_o_img_row) < 2:
        # only one row, just copy its result as the final output
        cv2.imwrite(s_path_output, a_o_img_row[0])
        cv2.imwrite(
            s_path_output.replace(".jpg", "_compressed.png").replace(".jpeg", "_compressed.png"),
            a_o_img_row[0],
            [cv2.IMWRITE_PNG_COMPRESSION, 9, cv2.IMWRITE_PNG_STRATEGY, cv2.IMWRITE_PNG_STRATEGY_FILTERED, cv2.IMWRITE_PNG_BILEVEL, 0]
        )
        n_scl_y, n_scl_x = a_o_img_row[0].shape[:2]
        return {"b_success": True, "s_path_output": s_path_output, "s_error": "", "n_scl_x": n_scl_x, "n_scl_y": n_scl_y}

    # stitch all row images together
    # save row images as temp files and use f_stitch
    a_s_path_row_temp = []
    for n_idx, o_img in enumerate(a_o_img_row):
        s_path_temp = os.path.join(s_path_dir_output, f"stitched_row_{a_n_idx_row[n_idx]:04d}.jpg")
        if not os.path.exists(s_path_temp):
            cv2.imwrite(s_path_temp, o_img)
        a_s_path_row_temp.append(s_path_temp)

    o_result_final = f_stitch(s_path_output, a_s_path_row_temp)
    if not o_result_final["b_success"]:
        o_result_final["s_error"] = f"final row stitch failed: {o_result_final['s_error']}"
    return o_result_final


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({
            "b_success": False,
            "s_path_output": "",
            "s_error": "usage: python stich_image_in_folder.py <output_path> [input_folder] [--row-by-row]"
        }))
        sys.exit(1)

    b_row_by_row = '--row-by-row' in sys.argv
    a_s_arg = [s for s in sys.argv[1:] if s != '--row-by-row']

    s_path_output = a_s_arg[0]

    # use input folder from arg or fall back to script directory
    if len(a_s_arg) >= 2:
        o_input_dir = Path(a_s_arg[1]).resolve()
    else:
        o_input_dir = Path(__file__).resolve().parent

    if b_row_by_row:
        o_result = f_stitch_row_by_row(s_path_output, o_input_dir)
    else:
        a_extensions = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}
        a_s_path_input = sorted([
            str(p) for p in o_input_dir.iterdir()
            if p.suffix.lower() in a_extensions
        ])
        o_result = f_stitch(s_path_output, a_s_path_input)

    print(json.dumps(o_result))
    sys.exit(0 if o_result["b_success"] else 1)