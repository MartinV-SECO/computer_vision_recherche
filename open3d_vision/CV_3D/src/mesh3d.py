"""Extrusion 2D → 3D et construction du mesh Open3D.

Pour chaque polygone 2D :
- Les sommets sont normalisés dans [-0.5, 0.5] par rapport à la taille image.
- Deux couches (z=0 et z=depth) forment le volume extrudé.
- Triangulation en éventail sur les faces haut/bas.
- Triangulation par bande sur les faces latérales.
"""

from __future__ import annotations

import numpy as np
import open3d as o3d

from .shapes import Shape2D
from .config import Mesh3DConfig


def _normalize_polygon(
    polygon: np.ndarray,
    frame_size: tuple[int, int],
    normalize: bool,
) -> np.ndarray:
    """Convertit des coordonnées pixel (x,y) en coordonnées 3D normalisées.

    Parameters
    ----------
    polygon : (N, 2) float32
    frame_size : (width, height)
    normalize : bool
        Si True, mappe la plus grande dimension à [-0.5, 0.5].

    Returns
    -------
    np.ndarray shape (N, 3) float64, z=0 pour tous les sommets
    """
    pts = polygon.astype(np.float64)
    w, h = frame_size
    if normalize:
        scale = max(w, h)
        pts[:, 0] = (pts[:, 0] - w / 2.0) / scale
        pts[:, 1] = -(pts[:, 1] - h / 2.0) / scale  # axe Y inversé
    else:
        pts[:, 0] = pts[:, 0] - w / 2.0
        pts[:, 1] = -(pts[:, 1] - h / 2.0)

    z = np.zeros((len(pts), 1), dtype=np.float64)
    return np.hstack([pts, z])


def _fan_triangulate(indices: list[int]) -> list[tuple[int, int, int]]:
    """Triangulation en éventail depuis le premier sommet."""
    tris = []
    n = len(indices)
    for i in range(1, n - 1):
        tris.append((indices[0], indices[i], indices[i + 1]))
    return tris


def extrude_shape(
    shape: Shape2D,
    frame_size: tuple[int, int],
    cfg: Mesh3DConfig,
) -> o3d.geometry.TriangleMesh | None:
    """Construit un TriangleMesh extrudé pour une Shape2D.

    Returns None si la forme ne contient pas assez de sommets.
    """
    pts2d = _normalize_polygon(shape.polygon, frame_size, cfg.normalize)
    n = len(pts2d)
    if n < 3:
        return None

    depth = float(cfg.extrusion_depth)

    # Couche basse (z=0) et couche haute (z=depth)
    bottom = pts2d.copy()
    top = pts2d.copy()
    top[:, 2] = depth

    vertices = np.vstack([bottom, top])  # (2N, 3)

    triangles: list[tuple[int, int, int]] = []

    # Face basse (normale vers -z → ordre inversé pour face extérieure)
    bot_idx = list(range(n))
    for tri in _fan_triangulate(bot_idx):
        triangles.append((tri[0], tri[2], tri[1]))

    # Face haute (normale vers +z)
    top_idx = list(range(n, 2 * n))
    triangles.extend(_fan_triangulate(top_idx))

    # Faces latérales
    for i in range(n):
        i_next = (i + 1) % n
        b0, b1 = i, i_next
        t0, t1 = i + n, i_next + n
        triangles.append((b0, t0, b1))
        triangles.append((b1, t0, t1))

    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(vertices)
    mesh.triangles = o3d.utility.Vector3iVector(np.array(triangles, dtype=np.int32))
    mesh.compute_vertex_normals()

    # Couleur basée sur le label
    label_colors = {
        "triangle": [0.0, 1.0, 0.5],
        "quad": [1.0, 0.5, 0.0],
        "circle": [0.5, 0.0, 1.0],
        "polygon": [0.0, 0.8, 1.0],
    }
    color = label_colors.get(shape.label, [0.7, 0.7, 0.7])
    mesh.paint_uniform_color(color)

    return mesh


def build_scene(
    shapes: list[Shape2D],
    frame_size: tuple[int, int],
    cfg: Mesh3DConfig,
) -> o3d.geometry.TriangleMesh:
    """Fusionne les meshes de toutes les formes en une scène unique."""
    scene = o3d.geometry.TriangleMesh()
    for shape in shapes:
        m = extrude_shape(shape, frame_size, cfg)
        if m is not None:
            scene += m
    return scene
