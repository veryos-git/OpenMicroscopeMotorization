"""Run: venv_yolo/bin/python -m unittest discover -s tests -p test_sam_worker.py"""
import base64
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import cv2
import numpy as np
from sam_worker import segment


def f_predictor():
    predictor = Mock()
    predictor._frame_fingerprint = None
    calls = []

    def predict(**prompt):
        calls.append(prompt)
        count = 3 if prompt.get('multimask_output') else len(prompt.get('bboxes', [0]))
        data = []
        for index in range(count):
            mask = np.zeros((12, 16), dtype=np.uint8)
            mask[2:10, 3:13] = 1
            if index == 0 and count == 3:
                mask[:] = 1  # Highest-confidence candidate must win, not first.
            tensor = Mock()
            tensor.cpu.return_value.numpy.return_value = mask
            data.append(tensor)
        masks = MagicMock()
        masks.data = data
        masks.__len__.return_value = count
        return [SimpleNamespace(masks=masks, boxes=SimpleNamespace(conf=np.array([.2, .9, .5][:count])))]

    predictor.side_effect = predict
    return predictor, calls


def test_cache_and_grouped_signed_prompts():
    predictor, calls = f_predictor()
    with tempfile.TemporaryDirectory() as folder:
        frame = Path(folder) / 'frame.png'
        other = Path(folder) / 'other.png'
        image = np.zeros((12, 16, 3), dtype=np.uint8)
        cv2.imwrite(str(frame), image)
        other.write_bytes(frame.read_bytes())
        box = {'s_id': 'point', 'n_x': .125, 'n_y': .125, 'n_scl_x': .75, 'n_scl_y': .75,
               'a_o_point': [{'n_x': .5, 'n_y': .5, 'n_label': 1}]}
        first = segment(predictor, frame, [box])
        assert not first['b_cached']
        assert first['a_o_box'][0]['o_bounds']['n_x'] == 3 / 16
        box['a_o_point'].append({'n_x': 1, 'n_y': 1, 'n_label': 0})
        second = segment(predictor, other, [box])
        assert second['b_cached'], 'identical bytes in different temporary files reuse the embedding'
        assert calls[1]['points'] == [[[8, 6], [15, 11]]]
        assert calls[1]['labels'] == [[1, 0]], 'signed prompts form one object, not two masks'
        assert not calls[1]['multimask_output']
        assert predictor.set_image.call_count == 1
        image[0, 0] = 100
        cv2.imwrite(str(other), image)
        third = segment(predictor, other, [box])
        assert not third['b_cached'], 'changing bytes in the same file invalidates the embedding'
        assert predictor.set_image.call_count == 2
        assert predictor.reset_image.call_count == 2
        mask = cv2.imdecode(np.frombuffer(base64.b64decode(third['a_o_box'][0]['o_segmentation']['s_mask_png']), np.uint8), 0)
        assert mask.shape == (12, 16)
        assert set(np.unique(mask)) == {0, 255}
        assert not mask[:, :2].any() and not mask[:, 14:].any()


def test_mixed_prompts_preserve_order_and_box_batches():
    predictor, calls = f_predictor()
    with tempfile.TemporaryDirectory() as folder:
        frame = Path(folder) / 'frame.png'
        cv2.imwrite(str(frame), np.zeros((12, 16, 3), dtype=np.uint8))
        boxes = [{'s_id': str(i), 'n_x': 0, 'n_y': 0, 'n_scl_x': 1, 'n_scl_y': 1} for i in range(18)]
        boxes[4]['a_o_point'] = [{'n_x': .5, 'n_y': .5, 'n_label': 1}]
        result = segment(predictor, frame, boxes)
        assert [b['s_id'] for b in result['a_o_box']] == [b['s_id'] for b in boxes]
        assert [len(c['bboxes']) for c in calls if 'bboxes' in c] == [16, 1]
        assert predictor.set_image.call_count == 1


def load_tests(_loader, _tests, _pattern):
    return unittest.TestSuite(unittest.FunctionTestCase(f) for f in (
        test_cache_and_grouped_signed_prompts, test_mixed_prompts_preserve_order_and_box_batches,
    ))
