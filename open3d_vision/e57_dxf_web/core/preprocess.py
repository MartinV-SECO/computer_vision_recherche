"""Filtre Z et downsampling voxel."""

from __future__ import annotations

import numpy as np
import open3d as o3d


def filter_z_band(pts: np.ndarray, z_min: float, z_max: float) -> np.ndarray:
    """Garde les points dont z ∈ [z_min, z_max]."""
    pts = np.asarray(pts, dtype=np.float64)
    m = (pts[:, 2] >= z_min) & (pts[:, 2] <= z_max)
    return pts[m]


def voxel_downsample(pts: np.ndarray, voxel_size: float) -> np.ndarray:
    """
    Downsampling voxel Open3D.
    voxel_size en mètres (même unité que le nuage).
    """
    if len(pts) == 0:
        return pts
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(pts)
    down = pcd.voxel_down_sample(voxel_size=voxel_size)
    return np.asarray(down.points, dtype=np.float64)
