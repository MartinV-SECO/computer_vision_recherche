"""Paramètres typés pour la conversion E57 → DXF."""

from dataclasses import dataclass
from typing import Literal

Method = Literal["alphashape", "ransac", "both"]


@dataclass
class ConvertParams:
    """Paramètres utilisateur pour une conversion."""

    z_min: float
    z_max: float
    voxel_size: float
    alpha: float
    alpha_min_edge_length: float
    alpha_simplify_tolerance: float
    max_ransac_lines: int
    ransac_dist_thresh: float
    ransac_n_draws: int
    ransac_min_inliers: int
    method: Method
    seed: int = 42
