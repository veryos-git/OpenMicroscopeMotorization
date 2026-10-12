#!/usr/bin/env python3
"""Persistent box/point-prompted SAM worker. JSON lines on stdin/stdout."""
import base64
import contextlib
import hashlib
import json
import sys
import time
from pathlib import Path


def prepare_image(predictor, frame):
    import cv2
    import numpy as np
    encoded = Path(frame).read_bytes()
    fingerprint = hashlib.sha256(encoded).digest()
    # Bound memory to one embedding. Content identity prevents stale reuse across
    # cameras, crops, clients, captures, and temporary file names.
    if getattr(predictor, '_frame_fingerprint', None) == fingerprint:
        return predictor._frame_shape, True
    image = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError('Cannot read SAM image')
    predictor._frame_fingerprint = None
    predictor.reset_image()
    predictor.set_image(image)
    predictor._frame_fingerprint = fingerprint
    predictor._frame_shape = image.shape[:2]
    return image.shape[:2], False


def encode_mask(tensor, width, height, box):
    import cv2
    import numpy as np
    mask = tensor.cpu().numpy().astype(np.uint8)
    mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
    # Both prompt types respect the selected box/crop.
    x0 = max(0, int(np.floor(box['n_x'] * width)))
    y0 = max(0, int(np.floor(box['n_y'] * height)))
    x1 = min(width, int(np.ceil((box['n_x'] + box['n_scl_x']) * width)))
    y1 = min(height, int(np.ceil((box['n_y'] + box['n_scl_y']) * height)))
    mask[:y0] = 0
    mask[y1:] = 0
    mask[:, :x0] = 0
    mask[:, x1:] = 0
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    polygons = []
    for contour in contours:
        contour = cv2.approxPolyDP(contour, 0.5, True).reshape(-1, 2)
        if len(contour) >= 3:
            polygons.append([[float(x) / width, float(y) / height] for x, y in contour])
    x, y, w, h = cv2.boundingRect(mask)
    bounds = {'n_x': x / width, 'n_y': y / height,
              'n_scl_x': w / width, 'n_scl_y': h / height} if w and h else None
    ok, png = cv2.imencode('.png', mask * 255)
    if not ok:
        raise ValueError('Cannot encode SAM mask')
    return {'s_id': box['s_id'], 'o_bounds': bounds, 'o_segmentation': {
        's_model': 'sam_b', 'n_scl_x': width, 'n_scl_y': height,
        's_mask_png': base64.b64encode(png).decode('ascii'),
        'a_a_n_polygon': polygons,
    }}


def segment(predictor, frame, boxes):
    started = time.monotonic()
    (height, width), cached = prepare_image(predictor, frame)
    results = []
    for box in boxes:
        if 'a_o_point' not in box:
            continue
        points = box['a_o_point']
        # The outer dimension is one object. Without it, SAM treats each click
        # as an independent object instead of refining one selection.
        prediction = predictor(
            points=[[[min(p['n_x'] * width, width - 1),
                      min(p['n_y'] * height, height - 1)] for p in points]],
            labels=[[p['n_label'] for p in points]],
            multimask_output=len(points) == 1,
        )[0]
        if prediction.masks is None or not len(prediction.masks):
            raise ValueError('SAM did not return a point mask')
        index = int(prediction.boxes.conf.argmax().item())
        results.append(encode_mask(prediction.masks.data[index], width, height, box))
    box_only = [b for b in boxes if 'a_o_point' not in b]
    # Bounded box batches keep GPU memory usage predictable.
    for start in range(0, len(box_only), 16):
        batch = box_only[start:start + 16]
        prompts = [[b['n_x'] * width, b['n_y'] * height,
                    (b['n_x'] + b['n_scl_x']) * width,
                    (b['n_y'] + b['n_scl_y']) * height] for b in batch]
        prediction = predictor(bboxes=prompts, multimask_output=False)[0]
        if prediction.masks is None or len(prediction.masks) != len(batch):
            raise ValueError('SAM did not return one mask per box')
        results.extend(encode_mask(tensor, width, height, box)
                       for box, tensor in zip(batch, prediction.masks.data))
    by_id = {r['s_id']: r for r in results}
    return {'n_scl_x': width, 'n_scl_y': height,
            'a_o_box': [by_id[b['s_id']] for b in boxes],
            'b_cached': cached, 'n_sec': time.monotonic() - started}


def main():
    predictor = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):
                if predictor is None:
                    import torch
                    from ultralytics.models.sam import Predictor
                    weights = Path(sys.argv[1])
                    weights.parent.mkdir(parents=True, exist_ok=True)
                    predictor = Predictor(overrides={
                        'model': str(weights), 'task': 'segment', 'mode': 'predict',
                        'device': 0 if torch.cuda.is_available() else 'cpu', 'verbose': False,
                        'imgsz': 1024, 'conf': 0.0, 'save': False,
                    })
                result = segment(predictor, request['s_frame'], request['a_o_box'])
            print(json.dumps(result, allow_nan=False), flush=True)
        except Exception as error:
            print(json.dumps({'s_error': str(error)}), flush=True)


if __name__ == '__main__':
    main()
