#!/usr/bin/env python3
"""Cellpose inference worker for the OMM microscope app.

This is a long-running process that keeps one Cellpose model in memory and
segments the camera frames the server hands it.  It is spawned by
``cellpose_functions.module.js`` and talks a line-delimited JSON protocol over
stdin/stdout so the model is loaded once instead of once per frame (loading is
a few seconds, inference on a CPU is much longer).

    python cellpose_worker.py --model cpsam --dim 512 --out <folder>

stdin  <- {"s_type": "init", "v_data": {...}}
stdout -> {"s_type": "ready", "v_data": {...}}
stdin  <- {"s_type": "frame", "s_seq": 1, "s_path_frame": "/abs/frame.png"}
stdout -> {"s_type": "result", "s_seq": 1, "v_data": {...}}
stdin  <- {"s_type": "stop"}
stdout -> {"s_type": "stopped", "v_data": {...}}

Every frame is written back into the output folder as

    cellpose_<seq>_mask.jpg    the frame with the masks coloured on top
    cellpose_<seq>.json        cell count, areas and timings

stdout carries *only* JSON; all human readable progress goes to stderr, so the
server can parse stdout line by line.

Models
------
``cpsam``  Cellpose-SAM (cellpose >= 4), the current generalist model.  It is a
           ViT-L based network.  On a CPU it needs ~50 s per frame at 384 px and
           ~155 s at 512 px, so without a GPU it is a "segment one picture"
           tool; on a mid-range NVIDIA card the same frame takes ~1-2 s.
``cyto3``  the Cellpose-3 cytoplasm model (cellpose 3).  Much smaller, at the
           cost of generalisation.  In the cellpose 4 venv this project installs
           it goes through the same pipeline, so it is not the faster option.

The weights are downloaded on first use into ``--weights`` (default
``<root>/weights/cellpose``): ~1.2 GB for ``cpsam``, ~25 MB for ``cyto3``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

# cellpose imports torch (and reads CELLPOSE_LOCAL_MODELS_PATH) at import time,
# so the model cache directory has to be set before anything else is imported.
for s_name_arg in list(sys.argv):
    if s_name_arg.startswith("--weights="):
        os.environ.setdefault("CELLPOSE_LOCAL_MODELS_PATH", s_name_arg.split("=", 1)[1])

import cv2
import numpy as np

S_PATH__DIR = os.path.dirname(os.path.abspath(__file__))

# ─── Logging (stderr only: stdout is the JSON channel) ──────────────


def f_log(s_line):
    print(s_line, file=sys.stderr, flush=True)


def f_s_version__cellpose():
    """The installed cellpose version, whichever module exposes it."""
    try:
        import cellpose

        for s_name in ("version", "__version__"):
            s_version = getattr(cellpose, s_name, "")
            if s_version:
                return str(s_version)
    except Exception:
        pass
    try:
        from importlib.metadata import version as f_s_version__pkg

        return f_s_version__pkg("cellpose")
    except Exception:
        return "0"


def f_o_status(o_state):
    return {
        "b_ready": bool(o_state.get("b_ready")),
        "s_model": o_state.get("s_model", ""),
        "s_version": o_state.get("s_version", ""),
        "s_device": o_state.get("s_device", ""),
        "s_device_name": o_state.get("s_device_name", ""),
        "n_dim": o_state.get("n_dim", 0),
        "n_cnt__frame": o_state.get("n_cnt__frame", 0),
        "n_cell__last": o_state.get("n_cell__last", 0),
        "n_sec__last": o_state.get("n_sec__last", 0.0),
        "n_sec__load": o_state.get("n_sec__load", 0.0),
    }


# ─── Images ─────────────────────────────────────────────────────────


def f_o_resize(o_img, n_dim__max):
    """Downscale so the long side is at most ``n_dim__max`` pixels."""
    n_h, n_w = o_img.shape[:2]
    n_dim__long = max(n_h, n_w)
    if n_dim__max <= 0 or n_dim__long <= n_dim__max:
        return o_img, 1.0
    n_scl = n_dim__max / float(n_dim__long)
    o_small = cv2.resize(
        o_img,
        (max(1, int(round(n_w * n_scl))), max(1, int(round(n_h * n_scl)))),
        interpolation=cv2.INTER_AREA,
    )
    return o_small, n_scl


def f_a_n_uint8__tab_color(n_cnt):
    """A fixed pseudo random BGR colour table with ``n_cnt`` + 1 entries."""
    o_rng = np.random.default_rng(12345)
    a_n_color = o_rng.integers(60, 256, size=(max(1, n_cnt) + 1, 3), dtype=np.uint8)
    a_n_color[0] = (0, 0, 0)
    return a_n_color


def f_o_overlay(o_img, o_mask, n_dim__out):
    """The frame with the masks coloured on top (and their outlines drawn)."""
    a_n_color = f_a_n_uint8__tab_color(int(o_mask.max()))
    o_color = a_n_color[o_mask]
    o_overlay = cv2.addWeighted(o_img, 0.55, o_color, 0.45, 0)
    o_contour, _ = cv2.findContours(
        o_mask.astype(np.int32), cv2.RETR_FLOODFILL, cv2.CHAIN_APPROX_SIMPLE
    )
    cv2.drawContours(o_overlay, o_contour, -1, (255, 255, 255), 1, cv2.LINE_AA)
    o_out, _ = f_o_resize(o_overlay, n_dim__out)
    return o_out


def f_write_image_atomic(s_path, o_img, a_o_param=None):
    s_root, s_ext = os.path.splitext(s_path)
    s_path_tmp = s_root + ".part" + s_ext
    b_ok = cv2.imwrite(s_path_tmp, o_img, a_o_param or [])
    if b_ok:
        os.replace(s_path_tmp, s_path)
    return b_ok


def f_write_json_atomic(s_path, o_data):
    s_path_tmp = s_path + ".tmp"
    with open(s_path_tmp, "w", encoding="utf-8") as o_fh:
        json.dump(o_data, o_fh)
    os.replace(s_path_tmp, s_path)


def f_a_n_area__from_mask(o_mask):
    """Pixel area of every mask (index 0 = background is dropped)."""
    a_n_cnt = np.bincount(o_mask.ravel())
    if a_n_cnt.size <= 1:
        return []
    return [int(n) for n in a_n_cnt[1:]]


# ─── Model ──────────────────────────────────────────────────────────


def f_o_model__load(s_model, b_gpu, s_path_weights):
    """Load one cellpose model; returns a small state object."""
    import torch
    from cellpose import models

    s_version = f_s_version__cellpose()
    b_v4 = s_version.split(".")[0].isdigit() and int(s_version.split(".")[0]) >= 4
    torch.set_num_threads(max(1, int(os.environ.get("CELLPOSE_THREAD", "0")) or os.cpu_count() or 1))

    # a CUDA build of torch still has to *open* the device: the driver can be
    # present while /dev/nvidia* is not usable, so believe torch, not the driver
    b_cuda = False
    s_device_name = ""
    if b_gpu:
        try:
            b_cuda = bool(torch.cuda.is_available())
            if b_cuda:
                s_device_name = torch.cuda.get_device_name(0)
        except Exception as o_err:
            f_log(f"[cellpose] cuda check failed: {o_err}")

    if s_model in ("cpsam", "cpsam_v2", "cellpose-sam", "default"):
        if not b_v4:
            raise RuntimeError(
                f"model '{s_model}' needs cellpose >= 4 (this venv has {s_version})"
            )
        o_model = models.CellposeModel(gpu=b_cuda)
    elif s_model == "cyto3":
        if b_v4:
            o_model = models.CellposeModel(gpu=b_cuda, pretrained_model="cyto3")
        else:
            o_model = models.Cellpose(model_type="cyto3", gpu=b_cuda)
    else:
        # anything else is treated as a path or a model name cellpose knows
        if b_v4:
            o_model = models.CellposeModel(gpu=b_cuda, pretrained_model=s_model)
        else:
            o_model = models.Cellpose(gpu=b_cuda, pretrained_model=s_model)

    return {
        "s_model": s_model,
        "s_version": str(s_version),
        "b_v4": b_v4,
        "b_cuda": b_cuda,
        "s_device": "cuda" if b_cuda else "cpu",
        "s_device_name": s_device_name,
        "o_model": o_model,
        "s_path_weights": s_path_weights,
    }


def f_o_mask__from_model(o_state, o_img, o_option):
    """Run one segmentation; returns (mask, seconds)."""
    import torch

    n_ts_ms__start = time.time()
    with torch.inference_mode():
        if o_state["b_v4"]:
            o_out = o_state["o_model"].eval(
                o_img,
                diameter=o_option.get("n_diameter") or None,
                flow_threshold=o_option.get("n_flow_threshold", 0.4),
                cellprob_threshold=o_option.get("n_cellprob_threshold", 0.0),
                min_size=o_option.get("n_min_size", 15),
            )
            o_mask = o_out[0]
        else:
            o_out = o_state["o_model"].eval(
                o_img,
                diameter=o_option.get("n_diameter") or None,
                channels=o_option.get("a_n_channel", [0, 0]),
                flow_threshold=o_option.get("n_flow_threshold", 0.4),
                cellprob_threshold=o_option.get("n_cellprob_threshold", 0.0),
                min_size=o_option.get("n_min_size", 15),
            )
            o_mask = o_out[0][0]

    o_mask = np.asarray(o_mask)
    if o_mask.ndim > 2:
        o_mask = o_mask[0]
    return o_mask.astype(np.int32), time.time() - n_ts_ms__start


# ─── Frame handling ─────────────────────────────────────────────────


def f_o_result__frame(o_state, o_msg):
    n_seq = int(o_msg.get("s_seq") or 0)
    s_path_frame = o_msg.get("s_path_frame") or ""
    o_option = o_msg.get("v_option") or {}

    o_img = cv2.imread(s_path_frame, cv2.IMREAD_COLOR)
    if o_img is None:
        return {"s_type": "error", "s_seq": n_seq, "s_error": f"cannot read {s_path_frame}"}

    n_h__full, n_w__full = o_img.shape[:2]
    o_small, _ = f_o_resize(o_img, int(o_option.get("n_dim") or o_state["n_dim"]))

    o_mask, n_sec = f_o_mask__from_model(o_state, o_small, o_option)

    # masks come back at the inference resolution; put them back on the frame
    # the camera actually produced so the overlay lines up with the live image
    if o_mask.shape[:2] != (n_h__full, n_w__full):
        o_mask = cv2.resize(
            o_mask,
            (n_w__full, n_h__full),
            interpolation=cv2.INTER_NEAREST,
        )

    s_name = f"cellpose_{n_seq:05d}"
    s_path_mask = os.path.join(o_state["s_path_out"], s_name + "_mask.jpg")
    s_path_meta = os.path.join(o_state["s_path_out"], s_name + ".json")

    o_overlay = f_o_overlay(o_img, o_mask, o_state["n_dim__out"])
    f_write_image_atomic(s_path_mask, o_overlay, [cv2.IMWRITE_JPEG_QUALITY, 88])

    a_n_area = f_a_n_area__from_mask(o_mask)
    o_meta = {
        "s_seq": n_seq,
        "s_path_frame": s_path_frame,
        "s_path_mask": s_path_mask,
        "s_model": o_state["s_model"],
        "s_version": o_state["s_version"],
        "s_device": o_state["s_device"],
        "s_device_name": o_state["s_device_name"],
        "n_scl_x": n_w__full,
        "n_scl_y": n_h__full,
        "n_dim__inference": max(o_small.shape[:2]),
        "n_cell": len(a_n_area),
        "n_area__mean": int(round(sum(a_n_area) / len(a_n_area))) if a_n_area else 0,
        "n_area__max": max(a_n_area) if a_n_area else 0,
        "n_sec__inference": round(n_sec, 2),
        "n_ts_ms": int(time.time() * 1000),
    }
    f_write_json_atomic(s_path_meta, o_meta)

    # the worker holds the bookkeeping; the server only forwards the numbers
    o_state["n_cnt__frame"] += 1
    o_state["n_cell__last"] = o_meta["n_cell"]
    o_state["n_sec__last"] = o_meta["n_sec__inference"]
    f_log(
        f"[cellpose] frame {n_seq}: {o_meta['n_cell']} cell in {o_meta['n_sec__inference']} s "
        f"({o_meta['n_dim__inference']} px, {o_state['s_model']}, {o_state['s_device']})"
    )
    return {"s_type": "result", "s_seq": n_seq, "v_data": o_meta}


# ─── Main loop ──────────────────────────────────────────────────────


def f_o_state__init(o_msg):
    o_option = o_msg.get("v_option") or {}
    s_model = o_option.get("s_model") or "cpsam"
    s_path_out = o_option.get("s_path_out") or S_PATH__DIR
    s_path_weights = o_option.get("s_path_weights") or ""
    os.makedirs(s_path_out, exist_ok=True)
    if s_path_weights:
        os.environ["CELLPOSE_LOCAL_MODELS_PATH"] = s_path_weights

    n_ts_ms__start = time.time()
    o_state = f_o_model__load(s_model, bool(o_option.get("b_gpu")), s_path_weights)
    o_state.update(
        {
            "s_path_out": s_path_out,
            "n_dim": int(o_option.get("n_dim") or 384),
            "n_dim__out": int(o_option.get("n_dim__out") or 900),
            "n_cnt__frame": 0,
            "n_cell__last": 0,
            "n_sec__last": 0.0,
            "n_sec__load": round(time.time() - n_ts_ms__start, 2),
        }
    )
    f_log(
        f"[cellpose] loaded {s_model} (cellpose {o_state['s_version']}) on "
        f"{o_state['s_device'].upper()}"
        f"{' - ' + o_state['s_device_name'] if o_state['s_device_name'] else ''} "
        f"in {o_state['n_sec__load']} s, cache {os.environ.get('CELLPOSE_LOCAL_MODELS_PATH')}"
    )
    return o_state


def main():
    o_ap = argparse.ArgumentParser(description="Cellpose inference worker (JSON over stdio)")
    o_ap.add_argument("--model", default="cpsam", help="cpsam (default) or cyto3")
    o_ap.add_argument("--dim", type=int, default=384, help="long side fed to the network")
    o_ap.add_argument("--out", default="", help="folder for the mask / metrics output")
    o_ap.add_argument("--weights", default="", help="model cache folder (CELLPOSE_LOCAL_MODELS_PATH)")
    o_ap.add_argument("--gpu", action="store_true", default=True,
                      help="use CUDA when torch reports a device (default)")
    o_ap.add_argument("--no-gpu", dest="gpu", action="store_false",
                      help="force the CPU even when CUDA is available")
    o_arg = o_ap.parse_args()

    os.environ.setdefault("CELLPOSE_LOCAL_MODELS_PATH", o_arg.weights)

    o_state = {"b_ready": False}
    f_log(f"[cellpose] worker started (model {o_arg.model}, dim {o_arg.dim}, out {o_arg.out})")

    for s_line in sys.stdin:
        s_line = s_line.strip()
        if not s_line:
            continue
        try:
            o_msg = json.loads(s_line)
        except ValueError as o_err:
            f_log(f"[cellpose] bad json: {o_err}")
            continue

        s_type = o_msg.get("s_type")
        try:
            if s_type == "init":
                # the CLI flag wins unless the message is explicit
                o_option = o_msg.get("v_option") or {}
                if "b_gpu" not in o_option:
                    o_option["b_gpu"] = o_arg.gpu
                    o_msg["v_option"] = o_option
                o_state = f_o_state__init(o_msg)
                o_state["b_ready"] = True
                o_resp = {
                    "s_type": "ready",
                    "v_data": {
                        "s_model": o_state["s_model"],
                        "s_version": o_state["s_version"],
                        "s_device": o_state["s_device"],
                        "s_device_name": o_state["s_device_name"],
                        "n_sec__load": o_state["n_sec__load"],
                        "n_dim": o_state["n_dim"],
                    },
                }
            elif s_type == "frame":
                if not o_state.get("b_ready"):
                    o_resp = {"s_type": "error", "s_seq": o_msg.get("s_seq"), "s_error": "model not loaded"}
                else:
                    o_resp = f_o_result__frame(o_state, o_msg)
            elif s_type == "status":
                o_resp = {"s_type": "status", "v_data": f_o_status(o_state)}
            elif s_type == "stop":
                o_resp = {"s_type": "stopped", "v_data": f_o_status(o_state)}
                print(json.dumps(o_resp), flush=True)
                f_log("[cellpose] worker stopped")
                return 0
            else:
                o_resp = {"s_type": "error", "s_error": f"unknown s_type '{s_type}'"}
        except Exception as o_err:  # keep the worker alive, report and continue
            import traceback

            f_log(f"[cellpose] {s_type} failed: {o_err}\n{traceback.format_exc()}")
            o_resp = {
                "s_type": "error",
                "s_seq": o_msg.get("s_seq"),
                "s_error": f"{type(o_err).__name__}: {o_err}",
            }

        print(json.dumps(o_resp), flush=True)

    f_log("[cellpose] stdin closed, worker exits")
    return 0


if __name__ == "__main__":
    sys.exit(main())
