"""Lecture des nuages E57."""

from __future__ import annotations

import numpy as np


def load_e57_points(path: str) -> np.ndarray:
    """
    Charge tous les points d'un fichier E57.
    Retourne un tableau (N, 3) float64.
    """
    import e57

    pc = e57.read_points(path)
    pts = np.asarray(pc.points, dtype=np.float64)
    return pts


def sample_points_for_z_range(pts: np.ndarray, max_points: int = 50_000) -> np.ndarray:
    """
    Sous-échantillon aléatoire pour estimer min/max Z sans tout charger deux fois
    (si l'appelant a déjà chargé tout le nuage, passer pts directement).
    """
    n = len(pts)
    if n <= max_points:
        return pts
    idx = np.random.choice(n, size=max_points, replace=False)
    return pts[idx]


def z_bounds(pts: np.ndarray) -> tuple[float, float]:
    """Retourne (z_min, z_max) sur le tableau de points."""
    z = pts[:, 2]
    return float(z.min()), float(z.max())
