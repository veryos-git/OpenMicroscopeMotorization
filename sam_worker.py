#!/usr/bin/env python3
"""Persistent box-prompted SAM worker. JSON lines on stdin/stdout."""
import base64
import contextlib
import json
import sys
from pathlib import Path


def segment(predictor, frame, boxes):
    import cv2
    import numpy as np
    image = cv2.imread(frame)
    if image is None:
        raise ValueError("Cannot read SAM image")
    height, width = image.shape[:2]
    predictor.reset_image()
    predictor.set_image(image)
    results = []
    # Reuse the image embedding, with bounded prompt batches to limit GPU memory.
    for start in range(0, len(boxes), 16):
        batch = boxes[start:start + 16]
        prompts = [[b['n_x'] * width, b['n_y'] * height,
                    (b['n_x'] + b['n_scl_x']) * width,
                    (b['n_y'] + b['n_scl_y']) * height] for b in batch]
        prediction = predictor(bboxes=prompts, multimask_output=False)[0]
        if prediction.masks is None or len(prediction.masks) != len(batch):
            raise ValueError("SAM did not return one mask per box")
        for box, tensor, prompt in zip(batch, prediction.masks.data, prompts):
            mask = tensor.cpu().numpy().astype(np.uint8)
            mask = cv2.resize(mask, (width, height), interpolation=cv2.INTER_NEAREST)
            # Only annotate selected pixels; keep masks inside their box/crop.
            x0, y0 = np.floor(prompt[:2]).astype(int)
            x1, y1 = np.ceil(prompt[2:]).astype(int)
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
            ok, png = cv2.imencode('.png', mask * 255)
            if not ok:
                raise ValueError("Cannot encode SAM mask")
            results.append({'s_id': box['s_id'], 'o_segmentation': {
                's_model': 'sam_b', 'n_scl_x': width, 'n_scl_y': height,
                's_mask_png': base64.b64encode(png).decode('ascii'),
                'a_a_n_polygon': polygons,
            }})
    return {'n_scl_x': width, 'n_scl_y': height, 'a_o_box': results}


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
