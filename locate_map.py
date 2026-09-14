#!/usr/bin/env python3
"""Live "where am I" localizer for the stitched slide map.

This is a long-running background process that keeps a heavily downscaled copy
of a stitched map (a grow ``map.jpg`` or a scan ``stitched.png``) in memory and
finds the location of each incoming live camera frame inside it with
``cv2.matchTemplate``.  Because both the map and the frame are downscaled very
heavily, a match takes only a few milliseconds, so it can run continuously in
parallel with a scan or on its own.

The Deno server (`locate_map.module.js`) spawns this process and watches the
files it writes:

    python locate_map.py <frames_folder> --map <map_path> [options]

For every incoming frame it writes:

    <frames_folder>/location.json      located rect (full map px) + confidence
    <frames_folder>/locate_map.jpg     downscaled map with the rect drawn on it

Frames are expected to be named ``locate_<seq>_<W>x<H>.{jpg,jpeg,png}`` where
``W x H`` are the *original* camera-frame dimensions (before the client
downscaled the frame for upload).  That lets the drawn rectangle keep its true
size in map pixels.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sys
import time

import cv2

S_RE__FRAME = re.compile(
    r"^locate_(\d+)_(\d+)x(\d+)\.(jpg|jpeg|png)$", re.IGNORECASE)

A_S_EXT__FRAME = (".jpg", ".jpeg", ".png")


def f_a_s_path__frame(s_path_folder):
    """Sorted list of ``locate_*.{jpg,jpeg,png}`` paths (numeric by seq)."""
    a_s_path = []
    try:
        for s_name in os.listdir(s_path_folder):
            if S_RE__FRAME.match(s_name):
                a_s_path.append(os.path.join(s_path_folder, s_name))
    except OSError:
        pass
    a_s_path.sort(key=lambda p: int(S_RE__FRAME.match(os.path.basename(p)).group(1)))
    return a_s_path


def f_write_json_atomic(s_path, o_data):
    s_path_tmp = s_path + ".tmp"
    with open(s_path_tmp, "w", encoding="utf-8") as o_fh:
        json.dump(o_data, o_fh)
    os.replace(s_path_tmp, s_path)


def f_write_image_atomic(s_path, o_img, a_o_param=None):
    s_root, s_ext = os.path.splitext(s_path)
    s_path_tmp = s_root + ".part" + s_ext
    a_o_param = a_o_param or []
    b_ok = cv2.imwrite(s_path_tmp, o_img, a_o_param)
    if b_ok:
        os.replace(s_path_tmp, s_path)
    return b_ok


def f_o_resize(o_img, n_dim__max):
    """Resize so the long side is ``n_dim__max``; returns (image, scale_x, scale_y)."""
    n_h, n_w = o_img.shape[:2]
    n_scl = n_dim__max / float(max(n_h, n_w))
    if n_scl >= 1.0:
        return o_img, 1.0, 1.0
    n_w_new = max(1, int(round(n_w * n_scl)))
    n_h_new = max(1, int(round(n_h * n_scl)))
    return cv2.resize(o_img, (n_w_new, n_h_new), interpolation=cv2.INTER_AREA), \
        n_w_new / float(n_w), n_h_new / float(n_h)


def main():
    ap = argparse.ArgumentParser(description="Live slide-map localizer (template matching)")
    ap.add_argument("frames_folder", help="folder to watch for locate_*.jpg frames")
    ap.add_argument("--map", required=True, help="path of the reference stitched map")
    ap.add_argument("--state", help="path of location.json (default: <frames_folder>/location.json)")
    ap.add_argument("--preview", help="path of the marked map (default: <frames_folder>/locate_map.jpg)")
    ap.add_argument("--map-dim", type=int, default=512,
                    help="downscale the map so its long side is this many px")
    ap.add_argument("--preview-dim", type=int, default=900,
                    help="long side of the written locate_map.jpg preview")
    ap.add_argument("--min-score", type=float, default=0.35,
                    help="matches below this NCC score are reported as not found")
    ap.add_argument("--poll", type=float, default=0.3, help="seconds between folder polls")
    ap.add_argument("--jpeg-quality", type=int, default=88)
    args = ap.parse_args()

    s_path_folder = os.path.abspath(args.frames_folder)
    s_path_map = os.path.abspath(args.map)
    s_path_state = args.state or os.path.join(s_path_folder, "location.json")
    s_path_preview = args.preview or os.path.join(s_path_folder, "locate_map.jpg")

    a_s_line = []
    n_cnt__frame = 0
    b_stop = {"v": False}

    def f_log(s_line):
        a_s_line.append(s_line)
        if len(a_s_line) > 200:
            del a_s_line[:len(a_s_line) - 200]
        print(s_line, flush=True)

    def f_stop(signum, frame):
        b_stop["v"] = True
    signal.signal(signal.SIGTERM, f_stop)
    signal.signal(signal.SIGINT, f_stop)

    if not os.path.isfile(s_path_map):
        f_log(f"fatal: map not found: {s_path_map}")
        f_write_json_atomic(s_path_state, {
            "b_running": False, "s_status": "error",
            "s_error": f"map not found: {s_path_map}",
            "s_path_map": s_path_map,
            "n_scl_x__map": 0, "n_scl_y__map": 0,
            "n_scl_x__preview": 0, "n_scl_y__preview": 0,
            "n_x": 0, "n_y": 0, "n_scl_x": 0, "n_scl_y": 0,
            "n_score": 0, "b_found": False, "n_cnt__frame": 0,
            "n_ts_ms": 0, "a_s_line": a_s_line[-40:],
        })
        return 1

    # precomputed downscaled map state; rebuilt when the map file changes on disk
    o_map = {"n_ts_mtime": 0.0, "small_gray": None, "preview": None,
             "scl_x": 1.0, "scl_y": 1.0, "n_w": 0, "n_h": 0}

    def f_build_map():
        o_img = cv2.imread(s_path_map, cv2.IMREAD_COLOR)
        if o_img is None:
            return False
        n_h, n_w = o_img.shape[:2]
        o_map["n_w"], o_map["n_h"] = n_w, n_h
        o_small, o_map["scl_x"], o_map["scl_y"] = f_o_resize(o_img, args.map_dim)
        o_map["small_gray"] = cv2.cvtColor(o_small, cv2.COLOR_BGR2GRAY)
        o_preview, _, _ = f_o_resize(o_img, args.preview_dim)
        o_map["preview"] = o_preview
        o_map["n_ts_mtime"] = os.path.getmtime(s_path_map)
        return True

    if not f_build_map():
        f_log(f"fatal: could not read map: {s_path_map}")
        f_write_json_atomic(s_path_state, {
            "b_running": False, "s_status": "error",
            "s_error": f"could not read map: {s_path_map}",
            "s_path_map": s_path_map,
            "n_scl_x__map": 0, "n_scl_y__map": 0,
            "n_scl_x__preview": 0, "n_scl_y__preview": 0,
            "n_x": 0, "n_y": 0, "n_scl_x": 0, "n_scl_y": 0,
            "n_score": 0, "b_found": False, "n_cnt__frame": 0,
            "n_ts_ms": 0, "a_s_line": a_s_line[-40:],
        })
        return 1

    o_loc = {
        "n_x": 0, "n_y": 0, "n_scl_x": 0, "n_scl_y": 0,
        "n_score": 0.0, "b_found": False,
    }

    def f_o_state():
        return {
            "b_running": True,
            "s_status": "locating" if o_loc["b_found"] else "idle",
            "s_error": "",
            "s_path_map": s_path_map,
            "n_scl_x__map": o_map["n_w"], "n_scl_y__map": o_map["n_h"],
            "n_scl_x__preview": (o_map["preview"].shape[1]
                                 if o_map["preview"] is not None else 0),
            "n_scl_y__preview": (o_map["preview"].shape[0]
                                 if o_map["preview"] is not None else 0),
            "n_x": o_loc["n_x"], "n_y": o_loc["n_y"],
            "n_scl_x": o_loc["n_scl_x"], "n_scl_y": o_loc["n_scl_y"],
            "n_score": round(o_loc["n_score"], 4),
            "b_found": o_loc["b_found"],
            "n_cnt__frame": n_cnt__frame,
            "n_ts_ms": int(time.time() * 1000),
            "a_s_line": a_s_line[-40:],
        }

    def f_write_state():
        f_write_json_atomic(s_path_state, f_o_state())

    def f_write_preview():
        o_preview = o_map["preview"]
        if o_preview is None:
            return
        o_out = o_preview.copy()
        if o_loc["b_found"]:
            # rect in full-map px -> preview px
            n_sx = o_preview.shape[1] / float(o_map["n_w"])
            n_sy = o_preview.shape[0] / float(o_map["n_h"])
            n_x0 = int(round(o_loc["n_x"] * n_sx))
            n_y0 = int(round(o_loc["n_y"] * n_sy))
            n_x1 = int(round((o_loc["n_x"] + o_loc["n_scl_x"]) * n_sx))
            n_y1 = int(round((o_loc["n_y"] + o_loc["n_scl_y"]) * n_sy))
            o_pt0 = (n_x0, n_y0)
            o_pt1 = (n_x1, n_y1)
            # layered halo: dark ring -> light ring -> bright line, so the
            # marker stays visible on any background (incl. red-heavy images)
            cv2.rectangle(o_out, o_pt0, o_pt1, (0, 0, 0), 7)
            cv2.rectangle(o_out, o_pt0, o_pt1, (255, 255, 255), 4)
            cv2.rectangle(o_out, o_pt0, o_pt1, (0, 0, 255), 2)
            s_label = f"{o_loc['n_score']:.2f}"
            o_pt_text = (max(0, n_x0), max(22, n_y0 - 8))
            cv2.putText(o_out, s_label, o_pt_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (0, 0, 0), 4, cv2.LINE_AA)
            cv2.putText(o_out, s_label, o_pt_text, cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                        (0, 0, 255), 1, cv2.LINE_AA)
        f_write_image_atomic(s_path_preview, o_out,
                             [cv2.IMWRITE_JPEG_QUALITY, args.jpeg_quality])

    f_log(f"watching {s_path_folder} (map {s_path_map}, {o_map['n_w']}x{o_map['n_h']})…")
    f_write_state()
    f_write_preview()
    n_seq__last = -1

    while not b_stop["v"]:
        # rebuild the map template if the map file changed (grow keeps growing it)
        try:
            if os.path.getmtime(s_path_map) != o_map["n_ts_mtime"]:
                if f_build_map():
                    f_log(f"map reloaded ({o_map['n_w']}x{o_map['n_h']})")
                    f_write_preview()
        except OSError:
            pass

        b_changed = False
        for s_path_frame in f_a_s_path__frame(s_path_folder):
            m_frame = S_RE__FRAME.match(os.path.basename(s_path_frame))
            n_seq = int(m_frame.group(1))
            if n_seq <= n_seq__last:
                continue
            n_seq__last = n_seq
            n_w__frame, n_h__frame = int(m_frame.group(2)), int(m_frame.group(3))

            # a frame may still be uploading; imread returning None means "wait"
            o_img = cv2.imread(s_path_frame, cv2.IMREAD_COLOR)
            if o_img is None:
                n_seq__last = n_seq - 1  # retry it next poll
                continue
            n_cnt__frame += 1

            # resize the frame to its footprint *at the map's downscale factor*
            # so template and map share the same pixel scale
            n_w__small = max(1, int(round(n_w__frame * o_map["scl_x"])))
            n_h__small = max(1, int(round(n_h__frame * o_map["scl_y"])))
            o_frame = cv2.resize(o_img, (n_w__small, n_h__small),
                                 interpolation=cv2.INTER_AREA)
            o_gray = cv2.cvtColor(o_frame, cv2.COLOR_BGR2GRAY)
            o_map_gray = o_map["small_gray"]
            n_h_map, n_w_map = o_map_gray.shape[:2]
            n_h_f, n_w_f = o_gray.shape[:2]
            if n_w_f > n_w_map or n_h_f > n_h_map:
                f_log(f"frame {n_seq}: larger than map, skipped")
                o_loc["b_found"] = False
                f_write_state()
                b_changed = True
                continue

            o_res = cv2.matchTemplate(o_map_gray, o_gray, cv2.TM_CCOEFF_NORMED)
            _, n_score, _, o_top = cv2.minMaxLoc(o_res)
            n_x__small, n_y__small = int(o_top[0]), int(o_top[1])

            # map-small -> full-map coordinates
            n_x__full = n_x__small / o_map["scl_x"]
            n_y__full = n_y__small / o_map["scl_y"]
            o_loc["n_x"] = int(round(n_x__full))
            o_loc["n_y"] = int(round(n_y__full))
            o_loc["n_scl_x"] = n_w__frame
            o_loc["n_scl_y"] = n_h__frame
            o_loc["n_score"] = float(n_score)
            o_loc["b_found"] = o_loc["n_score"] >= args.min_score

            f_log(f"locate_{n_seq}: score {n_score:.3f} at "
                  f"({o_loc['n_x']}, {o_loc['n_y']}) "
                  f"{o_loc['n_scl_x']}x{o_loc['n_scl_y']}"
                  f"{'' if o_loc['b_found'] else ' (below min-score)'}")
            f_write_preview()
            f_write_state()
            b_changed = True

        if b_changed:
            continue  # drain any backlog before sleeping
        time.sleep(args.poll)

    f_write_state()
    f_log("stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
