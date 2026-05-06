"""Tests unitaires pour segmentation.py et shapes.py.

Utilise des images synthétiques (formes blanches sur fond noir)
pour rendre le pipeline reproductible sans webcam.
"""

import sys
from pathlib import Path

import cv2
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.segmentation import segment
from src.shapes import extract_shapes
from src.config import SegmentationConfig, ShapeConfig


def _make_frame_with_rect(w: int = 640, h: int = 480) -> np.ndarray:
    """Crée une image BGR avec un grand rectangle blanc centré."""
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    cv2.rectangle(frame, (w // 4, h // 4), (3 * w // 4, 3 * h // 4), (255, 255, 255), -1)
    return frame


def _make_frame_with_circle(w: int = 640, h: int = 480) -> np.ndarray:
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    cv2.circle(frame, (w // 2, h // 2), min(w, h) // 4, (200, 200, 200), -1)
    return frame


def _make_frame_with_triangle(w: int = 640, h: int = 480) -> np.ndarray:
    frame = np.zeros((h, w, 3), dtype=np.uint8)
    pts = np.array(
        [[w // 2, h // 4], [w // 4, 3 * h // 4], [3 * w // 4, 3 * h // 4]],
        dtype=np.int32,
    )
    cv2.fillPoly(frame, [pts], (180, 180, 180))
    return frame


class TestSegment:
    def setup_method(self):
        self.cfg = SegmentationConfig(invert=True)  # formes claires sur fond noir

    def test_mask_is_binary(self):
        frame = _make_frame_with_rect()
        mask = segment(frame, self.cfg)
        unique_vals = np.unique(mask)
        assert set(unique_vals).issubset({0, 255}), "Le masque doit être binaire"

    def test_mask_shape_matches_frame(self):
        frame = _make_frame_with_rect()
        mask = segment(frame, self.cfg)
        assert mask.shape == frame.shape[:2]

    def test_mask_detects_white_region(self):
        frame = _make_frame_with_rect()
        mask = segment(frame, self.cfg)
        # Le rectangle occupe ~25% de l'image → zone blanche dans le masque
        white_ratio = np.sum(mask == 255) / mask.size
        assert white_ratio > 0.1, f"Rapport blanc trop faible : {white_ratio:.2%}"

    def test_invert_flag_flips_mask(self):
        frame = _make_frame_with_rect()
        cfg_norm = SegmentationConfig(invert=False)
        cfg_inv = SegmentationConfig(invert=True)
        mask_n = segment(frame, cfg_norm)
        mask_i = segment(frame, cfg_inv)
        # Les deux masques doivent différer
        assert not np.array_equal(mask_n, mask_i)


class TestExtractShapes:
    def setup_method(self):
        # invert=False : formes claires (>0) sur fond noir → mask blanc sur forme
        self.seg_cfg = SegmentationConfig(invert=False, min_area=500)
        self.shape_cfg = ShapeConfig(epsilon_factor=0.02)

    def test_detects_rectangle(self):
        frame = _make_frame_with_rect()
        mask = segment(frame, self.seg_cfg)
        shapes = extract_shapes(mask, self.seg_cfg, self.shape_cfg)
        assert len(shapes) >= 1, "Au moins une forme doit être détectée"
        labels = {s.label for s in shapes}
        assert "quad" in labels, f"Rectangle attendu comme 'quad', obtenu : {labels}"

    def test_detects_triangle(self):
        frame = _make_frame_with_triangle()
        mask = segment(frame, self.seg_cfg)
        shapes = extract_shapes(mask, self.seg_cfg, self.shape_cfg)
        assert len(shapes) >= 1
        labels = {s.label for s in shapes}
        assert "triangle" in labels, f"Triangle attendu, obtenu : {labels}"

    def test_detects_circle(self):
        frame = _make_frame_with_circle()
        mask = segment(frame, self.seg_cfg)
        shapes = extract_shapes(mask, self.seg_cfg, self.shape_cfg)
        assert len(shapes) >= 1
        labels = {s.label for s in shapes}
        assert "circle" in labels, f"Cercle attendu, obtenu : {labels}"

    def test_max_contours_respected(self):
        # Plusieurs petites formes, max_contours=2
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        for i in range(5):
            x = 60 + i * 110
            cv2.rectangle(frame, (x, 100), (x + 80, 200), (255, 255, 255), -1)
        seg_cfg = SegmentationConfig(invert=False, min_area=100, max_contours=2)
        mask = segment(frame, seg_cfg)
        shapes = extract_shapes(mask, seg_cfg, self.shape_cfg)
        assert len(shapes) <= 2

    def test_area_filter_works(self):
        """Des formes trop petites doivent être ignorées."""
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        cv2.rectangle(frame, (10, 10), (20, 20), (255, 255, 255), -1)  # ~100 px²
        # invert=False : seul le petit rectangle blanc est détecté, son aire (~100) < 5000
        seg_cfg = SegmentationConfig(invert=False, min_area=5000)
        mask = segment(frame, seg_cfg)
        shapes = extract_shapes(mask, seg_cfg, self.shape_cfg)
        assert len(shapes) == 0
