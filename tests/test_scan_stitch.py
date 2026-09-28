"""Run with: venv/bin/python -m unittest discover -s tests -p test_scan_stitch.py"""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
import stitch


class ScanStitchTest(unittest.TestCase):
    def test_live_partial_grid_cache_and_finalization(self):
        rng = np.random.default_rng(28)
        scene = cv2.GaussianBlur(rng.integers(0, 256, (400, 600, 3), dtype=np.uint8), (0, 0), 2)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            files = []
            # Arrival order changes natural-sort indices: exercise stable cache keys.
            for row, col in [(0, 1), (0, 0), (1, 1)]:
                path = root / f'tile_r{row:02}_c{col:02}.png'
                cv2.imwrite(str(path), scene[row*120:row*120+240, col*160:col*160+340])
                files.append(str(path))
            common = ['--scan-live-cache', str(root / 'live_alignment.json'),
                      '--registration-max-width', '256', '--jobs', '1']
            preview = root / 'live_preview.jpg'
            with patch.object(stitch, 'register_pair', wraps=stitch.register_pair) as register:
                for count in (1, 2, 3):
                    self.assertEqual(stitch.main(files[:count] + common + [
                        '--live-preview', '--passes', '1', '-o', str(preview)]), 0)
                    self.assertTrue(preview.exists())
                self.assertEqual(register.call_count, 2)
                self.assertEqual(stitch.main([folder] + common + [
                    '--pattern', r'^tile_r\d+_c\d+\.png$', '--no-flatfield', '--no-gain-comp',
                    '-o', str(root / 'stitched.png')]), 0)
                self.assertEqual(register.call_count, 2, 'final build should reuse live registrations')
                self.assertGreater(cv2.imread(str(root / 'stitched.png')).shape[1], 490)
                # Replacing an original invalidates only incident edges.
                image = cv2.imread(files[1])
                cv2.imwrite(files[1], image)
                self.assertEqual(stitch.main(files + common + [
                    '--live-preview', '--passes', '1', '-o', str(preview)]), 0)
                self.assertEqual(register.call_count, 3)
                self.assertEqual(stitch.main(files + common + [
                    '--live-preview', '--passes', '1', '--highpass', '10', '-o', str(preview)]), 0)
                self.assertEqual(register.call_count, 5, 'registration setting changes must invalidate cache')

    def test_reduced_alignment_and_original_composite(self):
        rng = np.random.default_rng(17)
        # Odd dimensions exercise the separate rounded X/Y scale factors.
        scene = rng.integers(0, 256, (901, 1701, 3), dtype=np.uint8)
        scene = cv2.GaussianBlur(scene, (0, 0), 3)
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for col, x in enumerate((0, 600)):
                cv2.imwrite(str(root / f'tile_r00_c{col:02}.png'), scene[:777, x:x+1101])
            tiles = stitch.discover_tiles([folder], None, False)
            paths, scales = stitch.prepare_registration_images(tiles, (777, 1101), 256)
            self.assertEqual(cv2.imread(paths[0]).shape[:2], (181, 256))
            with patch.object(stitch, 'imread', side_effect=AssertionError('decoded original')):
                self.assertEqual(stitch.prepare_registration_images(tiles, (777, 1101), 256), (paths, scales))
            stitch._worker_init(paths, 1, 8, .02, 12, 8, registration_scale=scales)
            # Registration must never read the original tiles, including retries.
            original_read = stitch.imread
            def read_small(path, *args):
                self.assertIn('dowscaled', Path(path).parts)
                return original_read(path, *args)
            with patch.object(stitch, 'imread', side_effect=read_small):
                for prior in (None, (600, 0)):
                    edge = stitch.register_pair((0, 1, prior, 90))
                    self.assertGreater(edge.score, .3)
                    self.assertAlmostEqual(edge.dx, 600, delta=3)
                    self.assertAlmostEqual(edge.dy, 0, delta=3)
                    self.assertGreater(edge.area, 300000)
            self.assertEqual(len(stitch.discover_tiles([folder], None, True)), 2)
            output = root / 'stitched.png'
            positions = root / 'positions.json'
            self.assertEqual(stitch.main([
                folder, '--registration-max-width', '256', '--jobs', '2',
                '--no-flatfield', '--no-gain-comp', '--no-subpixel',
                '--blend', 'none', '--preview', '0', '-o', str(output),
                '--positions', str(positions),
            ]), 0)
            result = json.loads(positions.read_text())
            self.assertEqual(result['tile_size'], [1101, 777])
            self.assertTrue(all('/dowscaled/' not in t['path'] for t in result['tiles']))
            mosaic = cv2.imread(str(output))
            self.assertAlmostEqual(mosaic.shape[1], 1701, delta=4)
            self.assertAlmostEqual(mosaic.shape[0], 777, delta=4)
            np.testing.assert_array_equal(mosaic[30:100, 30:100], scene[30:100, 30:100])

    def test_small_images_are_not_enlarged(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'tile_r00_c00.png')
            cv2.imwrite(path, np.zeros((51, 99, 3), np.uint8))
            paths, scales = stitch.prepare_registration_images([stitch.Tile(0, path)], (51, 99), 256)
            self.assertEqual(scales, (1, 1))
            self.assertEqual(cv2.imread(paths[0]).shape[:2], (51, 99))


if __name__ == '__main__':
    unittest.main()
