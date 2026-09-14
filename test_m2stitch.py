import sys
import re
import numpy as np
import cv2
from pathlib import Path

# usage: python test_m2stitch.py <scan_folder> [ncc_threshold]
# example: python test_m2stitch.py scans/scan_2026-02-22_130103
# example: python test_m2stitch.py scans/scan_2026-02-21_125821 0.05

def f_stitch_with_m2stitch(s_path_dir, n_ncc_threshold=-1.0):
    import m2stitch

    o_path_dir = Path(s_path_dir).resolve()
    if not o_path_dir.is_dir():
        print(f"error: {o_path_dir} is not a directory")
        sys.exit(1)

    # collect tile images matching tile_rXX_cXX pattern
    a_o_tile = []
    for o_path in sorted(o_path_dir.iterdir()):
        if o_path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}:
            continue
        o_match = re.match(r'^tile_r(\d+)_c(\d+)', o_path.stem)
        if not o_match:
            continue
        a_o_tile.append({
            "n_row": int(o_match.group(1)),
            "n_col": int(o_match.group(2)),
            "s_path": str(o_path),
        })

    if len(a_o_tile) == 0:
        print("error: no tile_rXX_cXX images found")
        sys.exit(1)

    print(f"found {len(a_o_tile)} tiles")

    # load images as grayscale (m2stitch works with 2D arrays)
    a_o_img = []
    a_n_row = []
    a_n_col = []
    for o_tile in a_o_tile:
        o_img = cv2.imread(o_tile["s_path"], cv2.IMREAD_GRAYSCALE)
        if o_img is None:
            print(f"error: could not read {o_tile['s_path']}")
            sys.exit(1)
        a_o_img.append(o_img)
        a_n_row.append(o_tile["n_row"])
        a_n_col.append(o_tile["n_col"])

    n_scl_y_img, n_scl_x_img = a_o_img[0].shape[:2]
    print(f"image shape: {n_scl_x_img}x{n_scl_y_img}")

    # estimate initial positions assuming ~50% overlap (typical for this microscope setup)
    n_step_x = int(n_scl_x_img * 0.45)
    n_step_y = int(n_scl_y_img * 0.45)
    a_n_pos_init = np.array([
        [r * n_step_y, c * n_step_x]
        for r, c in zip(a_n_row, a_n_col)
    ], dtype=float)

    print(f"initial position step: x={n_step_x}, y={n_step_y}")
    print(f"ncc_threshold: {n_ncc_threshold}")
    print("running m2stitch.stitch_images ...")

    o_grid, o_prop = m2stitch.stitch_images(
        a_o_img,
        rows=a_n_row,
        cols=a_n_col,
        row_col_transpose=False,
        position_initial_guess=a_n_pos_init,
        overlap_diff_threshold=30,
        pou=10,
        ncc_threshold=n_ncc_threshold,
    )

    print("stitch_images done!")
    print(o_grid[["x_pos", "y_pos"]].to_string())

    # compose the final image using the computed positions
    a_n_x_pos = o_grid["x_pos"].values.astype(int)
    a_n_y_pos = o_grid["y_pos"].values.astype(int)

    # shift so minimum position is 0
    a_n_x_pos = a_n_x_pos - a_n_x_pos.min()
    a_n_y_pos = a_n_y_pos - a_n_y_pos.min()

    n_scl_x_canvas = int(a_n_x_pos.max() + n_scl_x_img)
    n_scl_y_canvas = int(a_n_y_pos.max() + n_scl_y_img)

    print(f"canvas size: {n_scl_x_canvas} x {n_scl_y_canvas}")

    o_canvas = np.zeros((n_scl_y_canvas, n_scl_x_canvas, 3), dtype=np.uint8)

    for n_idx in range(len(a_o_tile)):
        o_img_color = cv2.imread(a_o_tile[n_idx]["s_path"])
        n_x = a_n_x_pos[n_idx]
        n_y = a_n_y_pos[n_idx]
        o_canvas[n_y:n_y + n_scl_y_img, n_x:n_x + n_scl_x_img] = o_img_color

    s_path_output = str(o_path_dir / "stitched_m2stitch.jpg")
    cv2.imwrite(s_path_output, o_canvas)
    print(f"saved: {s_path_output}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python test_m2stitch.py <scan_folder> [ncc_threshold]")
        print("example: python test_m2stitch.py scans/scan_2026-02-22_130103")
        sys.exit(1)

    n_ncc = float(sys.argv[2]) if len(sys.argv) >= 3 else -1.0
    f_stitch_with_m2stitch(sys.argv[1], n_ncc)
