#!/usr/bin/env python3
"""recording_worker.py — export a recording to OME-TIFF.

Writes a time-lapse (or z-stack) frame sequence into one OME-TIFF so it opens
directly in Fiji / napari with the pixel size and time increment attached.

Frames are streamed one at a time through TiffWriter, so a session with
thousands of images does not have to fit in memory.

usage:
    python recording_worker.py --tiff --folder <session> --pos pos_00 \
        --out <file.ome.tif> [--interval 600] [--um-per-px 0.5] [--pattern t_*.png]

prints one JSON object on stdout.
"""

import argparse
import glob
import json
import os
import sys


def f_o_result(**kwargs):
    return kwargs


def f_a_s_file(s_path_folder, s_pos, s_pattern):
    s_dir = os.path.join(s_path_folder, s_pos) if s_pos else s_path_folder
    if not os.path.isdir(s_dir):
        raise RuntimeError("folder not found: " + s_dir)
    a_s_file = sorted(glob.glob(os.path.join(s_dir, s_pattern)))
    if not a_s_file:
        raise RuntimeError("no frames match " + s_pattern + " in " + s_dir)
    return a_s_file


def f_tiff(o_args):
    import tifffile
    import numpy as np
    from PIL import Image

    def f_a_frame(s_path):
        # PNG frames are read with Pillow: tifffile only reads TIFF itself.
        # an alpha channel from the canvas capture is always opaque -> drop it.
        a_frame = np.asarray(Image.open(s_path))
        if a_frame.ndim == 3 and a_frame.shape[2] == 4:
            a_frame = a_frame[:, :, :3]
        return a_frame

    a_s_file = f_a_s_file(o_args.folder, o_args.pos, o_args.pattern)
    # a first read tells us the shape and whether the frames are rgb
    o_first = f_a_frame(a_s_file[0])
    b_rgb = (o_first.ndim == 3 and o_first.shape[2] == 3)
    s_axes = "TYXS" if b_rgb else "TYX"
    t_shape = (len(a_s_file),) + tuple(o_first.shape)

    o_metadata = {"axes": s_axes}
    if o_args.um_per_px and o_args.um_per_px > 0:
        o_metadata["PhysicalSizeX"] = float(o_args.um_per_px)
        o_metadata["PhysicalSizeXUnit"] = "µm"
        o_metadata["PhysicalSizeY"] = float(o_args.um_per_px)
        o_metadata["PhysicalSizeYUnit"] = "µm"
    if o_args.interval and o_args.interval > 0:
        o_metadata["TimeIncrement"] = float(o_args.interval)
        o_metadata["TimeIncrementUnit"] = "s"

    o_compression = None if o_args.compression == "none" else o_args.compression

    # one series, frames streamed through a generator so the whole stack never
    # has to sit in memory
    with tifffile.TiffWriter(o_args.out, ome=True, bigtiff=bool(o_args.bigtiff)) as o_writer:
        o_writer.write(
            (f_a_frame(s_path) for s_path in a_s_file),
            shape=t_shape,
            dtype=o_first.dtype,
            photometric="rgb" if b_rgb else "minisblack",
            compression=o_compression,
            metadata=o_metadata,
            contiguous=False,
        )

    return f_o_result(
        b_success=True,
        s_path=os.path.abspath(o_args.out),
        n_cnt__frame=len(a_s_file),
        n_scl_y=int(o_first.shape[0]),
        n_scl_x=int(o_first.shape[1]),
        b_rgb=b_rgb,
        n_sz__byte=os.path.getsize(o_args.out),
    )


def f_main():
    o_parser = argparse.ArgumentParser(description="recording export worker")
    o_parser.add_argument("--tiff", action="store_true", help="export an OME-TIFF stack")
    o_parser.add_argument("--folder", required=True, help="session folder")
    o_parser.add_argument("--pos", default="pos_00", help="position subfolder ('' for the session root)")
    o_parser.add_argument("--out", required=True, help="output .tif")
    o_parser.add_argument("--pattern", default="t_*.png", help="frame glob")
    o_parser.add_argument("--interval", type=float, default=0, help="seconds between frames")
    o_parser.add_argument("--um-per-px", type=float, default=0, dest="um_per_px")
    o_parser.add_argument("--compression", default="zlib", help="zlib | lzw | none")
    o_parser.add_argument("--bigtiff", action="store_true", help="force BigTIFF")
    o_args = o_parser.parse_args()

    try:
        if o_args.tiff:
            o_result = f_tiff(o_args)
        else:
            o_result = f_o_result(b_success=False, s_error="nothing to do: pass --tiff")
    except Exception as o_error:  # noqa: BLE001 - the caller reads the json
        o_result = f_o_result(b_success=False, s_error=str(o_error))

    print(json.dumps(o_result))
    return 0 if o_result.get("b_success") else 1


if __name__ == "__main__":
    sys.exit(f_main())
