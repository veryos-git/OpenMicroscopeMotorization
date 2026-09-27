#!/usr/bin/env python3
"""One isolated YOLO train/infer job. JSON progress on stdout; diagnostics on stderr."""
import contextlib
import json
import math
import shutil
from pathlib import Path
import sys


def f_emit(o_message):
    print(json.dumps(o_message), file=sys.__stdout__, flush=True)


def f_run(o_config):
    from ultralytics import YOLO
    import torch
    s_device = 0 if torch.cuda.is_available() else "cpu"
    o_run = Path(o_config["s_run"])
    if o_config["s_kind"] == "train":
        o_model = YOLO(o_config["s_base"])
        o_model.add_callback("on_train_epoch_end", lambda o_trainer: f_emit({
            "s_type": "progress", "n_epoch": o_trainer.epoch + 1,
            "n_epoch_total": o_trainer.epochs,
        }))
        o_metric = o_model.train(
            data=str(o_run / "dataset/data.yaml"), epochs=o_config["n_epoch"],
            imgsz=o_config["n_size"], batch=4, device=s_device, workers=0,
            project=str(o_run), name="fit", exist_ok=True, seed=0,
            pretrained=True, plots=False, amp=False, cache=False,
        )
        # Use the trainer's actual checkpoint path; Ultralytics may rewrite run names.
        o_checkpoint = Path(o_model.trainer.best)
        if not o_checkpoint.is_file():
            raise RuntimeError("Training completed without a best checkpoint")
        o_published = o_run / "model/weights/best.pt"
        o_published.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(o_checkpoint, o_published)
        o_result = {"s_device": str(s_device), "o_metric": {
            str(s_key): float(n_value) for s_key, n_value in o_metric.results_dict.items()
            if isinstance(n_value, (int, float)) and math.isfinite(float(n_value))
        }}
    else:
        from PIL import Image
        with Image.open(o_run / "frame.png") as o_image:
            o_image.verify()
        o_model = YOLO(o_config["s_model"])
        o_prediction = o_model.predict(str(o_run / "frame.png"), conf=o_config["n_confidence"],
                                       imgsz=o_config["n_size"], device=s_device, verbose=False)[0]
        a_o_box = []
        for a_n_xyxy, n_class, n_conf in zip(o_prediction.boxes.xyxyn.cpu().tolist(),
                                           o_prediction.boxes.cls.cpu().tolist(),
                                           o_prediction.boxes.conf.cpu().tolist()):
            n_x0, n_y0, n_x1, n_y1 = [min(1., max(0., n)) for n in a_n_xyxy]
            if n_x1 <= n_x0 or n_y1 <= n_y0:
                continue
            a_o_box.append({"s_label": o_prediction.names[int(n_class)], "n_confidence": n_conf,
                            "n_x": n_x0, "n_y": n_y0, "n_scl_x": n_x1-n_x0, "n_scl_y": n_y1-n_y0})
        o_result = {"s_model_id": o_config["s_model_id"], "s_device": str(s_device),
                    "n_scl_x": o_prediction.orig_shape[1], "n_scl_y": o_prediction.orig_shape[0],
                    "a_o_box": a_o_box}
    o_temporary = o_run / "result.pending.json"
    o_temporary.write_text(json.dumps(o_result, allow_nan=False))
    o_temporary.replace(o_run / "result.json")


if __name__ == "__main__":
    o_config = json.loads(Path(sys.argv[1]).read_text())
    with contextlib.redirect_stdout(sys.stderr):
        f_run(o_config)
