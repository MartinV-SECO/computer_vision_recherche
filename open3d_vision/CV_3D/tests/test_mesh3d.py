"""Tests unitaires pour mesh3d.py.

Vérifie que l'extrusion produit des meshes valides et non vides
à partir de polygones synthétiques simples.
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.mesh3d import extrude_shape, build_scene
from src.shapes import Shape2D
from src.config import Mesh3DConfig


FRAME_SIZE = (640, 480)


def _make_square_shape() -> Shape2D:
    poly = np.array([[100, 100], [300, 100], [300, 300], [100, 300]], dtype=np.float32)
    return Shape2D(
        contour=poly.reshape(-1, 1, 2).astype(np.int32),
        polygon=poly,
        area=40000.0,
        label="quad",
        centroid=(200.0, 200.0),
    )


def _make_triangle_shape() -> Shape2D:
    poly = np.array([[320, 60], [160, 360], [480, 360]], dtype=np.float32)
    return Shape2D(
        contour=poly.reshape(-1, 1, 2).astype(np.int32),
        polygon=poly,
        area=57600.0,
        label="triangle",
        centroid=(320.0, 260.0),
    )


def _make_pentagon_shape() -> Shape2D:
    angles = np.linspace(0, 2 * np.pi, 6)[:-1]
    cx, cy, r = 320, 240, 100
    poly = np.stack(
        [cx + r * np.cos(angles), cy + r * np.sin(angles)], axis=1
    ).astype(np.float32)
    return Shape2D(
        contour=poly.reshape(-1, 1, 2).astype(np.int32),
        polygon=poly,
        area=float(np.pi * r * r),
        label="polygon",
        centroid=(cx, cy),
    )


class TestExtrudeShape:
    def setup_method(self):
        self.cfg = Mesh3DConfig(extrusion_depth=0.3, normalize=True)

    def _assert_valid_mesh(self, mesh):
        import open3d as o3d
        assert mesh is not None
        verts = np.asarray(mesh.vertices)
        tris = np.asarray(mesh.triangles)
        assert len(verts) > 0, "Mesh sans sommets"
        assert len(tris) > 0, "Mesh sans triangles"
        assert tris.max() < len(verts), "Index triangle hors limites"

    def test_square_extrusion(self):
        shape = _make_square_shape()
        mesh = extrude_shape(shape, FRAME_SIZE, self.cfg)
        self._assert_valid_mesh(mesh)

    def test_triangle_extrusion(self):
        shape = _make_triangle_shape()
        mesh = extrude_shape(shape, FRAME_SIZE, self.cfg)
        self._assert_valid_mesh(mesh)

    def test_pentagon_extrusion(self):
        shape = _make_pentagon_shape()
        mesh = extrude_shape(shape, FRAME_SIZE, self.cfg)
        self._assert_valid_mesh(mesh)

    def test_depth_affects_z_range(self):
        shape = _make_square_shape()
        cfg_thin = Mesh3DConfig(extrusion_depth=0.1, normalize=True)
        cfg_thick = Mesh3DConfig(extrusion_depth=1.0, normalize=True)
        mesh_thin = extrude_shape(shape, FRAME_SIZE, cfg_thin)
        mesh_thick = extrude_shape(shape, FRAME_SIZE, cfg_thick)

        z_thin = np.asarray(mesh_thin.vertices)[:, 2].max()
        z_thick = np.asarray(mesh_thick.vertices)[:, 2].max()
        assert z_thick > z_thin, "Épaisseur plus grande → z max plus grand"

    def test_normalize_reduces_scale(self):
        shape = _make_square_shape()
        cfg_norm = Mesh3DConfig(extrusion_depth=0.3, normalize=True)
        cfg_raw = Mesh3DConfig(extrusion_depth=0.3, normalize=False)
        mesh_n = extrude_shape(shape, FRAME_SIZE, cfg_norm)
        mesh_r = extrude_shape(shape, FRAME_SIZE, cfg_raw)
        range_n = np.ptp(np.asarray(mesh_n.vertices)[:, :2])
        range_r = np.ptp(np.asarray(mesh_r.vertices)[:, :2])
        assert range_n < range_r, "Normalisation doit réduire l'étendue des coordonnées"


class TestBuildScene:
    def setup_method(self):
        self.cfg = Mesh3DConfig(extrusion_depth=0.3, normalize=True)

    def test_empty_shapes_returns_empty_mesh(self):
        mesh = build_scene([], FRAME_SIZE, self.cfg)
        assert len(np.asarray(mesh.triangles)) == 0

    def test_multiple_shapes_merge(self):
        shapes = [_make_square_shape(), _make_triangle_shape()]
        mesh = build_scene(shapes, FRAME_SIZE, self.cfg)
        n_tri = len(np.asarray(mesh.triangles))
        assert n_tri > 0

    def test_scene_triangle_count_sums(self):
        sq = _make_square_shape()
        tri = _make_triangle_shape()
        import open3d as o3d
        from src.config import Mesh3DConfig
        m_sq = extrude_shape(sq, FRAME_SIZE, self.cfg)
        m_tri = extrude_shape(tri, FRAME_SIZE, self.cfg)
        expected = len(np.asarray(m_sq.triangles)) + len(np.asarray(m_tri.triangles))
        scene = build_scene([sq, tri], FRAME_SIZE, self.cfg)
        assert len(np.asarray(scene.triangles)) == expected
