"""
Validation du pipeline avec un nuage synthétique (mock de load_e57_points).
Exécuter depuis open3d_vision : python e57_dxf_web/scripts/validate_pipeline.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

# Racine du repo = parent de e57_dxf_web
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from unittest.mock import patch

from e57_dxf_web.core.params import ConvertParams
from e57_dxf_web.core.pipeline import run_convert


def synthetic_wall_points(n: int = 2000, z0: float = 1.0, z1: float = 1.2) -> np.ndarray:
    """Points sur 4 segments (rectangle) + bruit, Z dans [z0,z1]."""
    rng = np.random.default_rng(0)
    lines = [
        (np.array([0.0, 0.0]), np.array([10.0, 0.0])),
        (np.array([10.0, 0.0]), np.array([10.0, 5.0])),
        (np.array([10.0, 5.0]), np.array([0.0, 5.0])),
        (np.array([0.0, 5.0]), np.array([0.0, 0.0])),
    ]
    pts = []
    per = n // 4
    for a, b in lines:
        t = rng.random(per)
        for ti in t:
            xy = a + ti * (b - a)
            pts.append([xy[0] + rng.normal(0, 0.02), xy[1] + rng.normal(0, 0.02), rng.uniform(z0, z1)])
    while len(pts) < n:
        pts.append([rng.uniform(0, 10), rng.uniform(0, 5), rng.uniform(z0, z1)])
    return np.asarray(pts, dtype=np.float64)


def main() -> None:
    pts = synthetic_wall_points()
    params_a = ConvertParams(
        z_min=0.5,
        z_max=2.0,
        voxel_size=0.15,
        alpha=0.8,
        alpha_min_edge_length=0.0,
        alpha_simplify_tolerance=0.0,
        max_ransac_lines=6,
        ransac_dist_thresh=0.15,
        ransac_n_draws=500,
        ransac_min_inliers=20,
        method="alphashape",
    )
    params_r = ConvertParams(
        z_min=0.5,
        z_max=2.0,
        voxel_size=0.2,
        alpha=0.5,
        alpha_min_edge_length=0.0,
        alpha_simplify_tolerance=0.0,
        max_ransac_lines=8,
        ransac_dist_thresh=0.12,
        ransac_n_draws=800,
        ransac_min_inliers=15,
        method="ransac",
    )
    params_b = ConvertParams(
        z_min=0.5,
        z_max=2.0,
        voxel_size=0.2,
        alpha=0.9,
        alpha_min_edge_length=0.0,
        alpha_simplify_tolerance=0.0,
        max_ransac_lines=6,
        ransac_dist_thresh=0.15,
        ransac_n_draws=600,
        ransac_min_inliers=15,
        method="both",
    )
    with patch("e57_dxf_web.core.pipeline.load_e57_points", return_value=pts):
        ra = run_convert("fake.e57", params_a, file_stem="test")
        assert len(ra.dxf_bytes) > 100 and ra.n_alpha_edges > 0, "alphashape"
        rr = run_convert("fake.e57", params_r, file_stem="test")
        assert len(rr.dxf_bytes) > 100 and rr.n_ransac_lines > 0, "ransac"
        rb = run_convert("fake.e57", params_b, file_stem="test")
        assert len(rb.dxf_bytes) > 100, "both"
    print("validate_pipeline: OK (alphashape, ransac, both)")


if __name__ == "__main__":
    main()
