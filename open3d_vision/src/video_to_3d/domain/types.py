# coding: utf-8
"""Types du domaine reconstruction 3D."""

from dataclasses import dataclass
from typing import List
import numpy as np


@dataclass
class CameraIntrinsics:
    """Matrice intrinsèque 3x3 (K)."""
    fx: float
    fy: float
    cx: float
    cy: float

    def to_matrix(self) -> np.ndarray:
        return np.array([
            [self.fx, 0, self.cx], [0, self.fy, self.cy], [0, 0, 1]
        ], dtype=np.float64)


@dataclass
class Fragment:
    """Fragment : fenêtre de keyframes."""
    scene: str
    fragment_id: int
    image_ids: List[int]
    extrinsics: List[np.ndarray]  # c2w 4x4
    intrinsics: List[np.ndarray]  # 3x3
