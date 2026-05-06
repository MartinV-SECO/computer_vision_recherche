"""Boucle principale du pipeline open3d_vision.

Fenêtre principale : OpenCV — webcam en fond + meshes extrudés à 50 % d'opacité.
Fenêtre secondaire : Open3D 3D (optionnelle ; sa fermeture n'arrête pas le pipeline).
"""

from __future__ import annotations

import time
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d

from .capture import WebcamCapture
from .segmentation import segment
from .shapes import extract_shapes, draw_ar_overlay
from .mesh3d import build_scene
from .config import PipelineConfig

_WIN_AR  = "open3d_vision – Webcam + Mesh AR"
_WIN_3D  = "open3d_vision – Mesh 3D"


class Pipeline:
    def __init__(self, cfg: PipelineConfig) -> None:
        self._cfg = cfg
        self._vis: o3d.visualization.Visualizer | None = None
        self._current_mesh: o3d.geometry.TriangleMesh | None = None
        self._camera_set = False
        self._frame_count = 0
        self._export_index = 0
        self._vis_alive = False  # Open3D disponible et fonctionnel

    # ------------------------------------------------------------------
    # Visualiseur Open3D (optionnel)
    # ------------------------------------------------------------------

    def _init_visualizer(self) -> None:
        """Tente de créer la fenêtre Open3D ; silencieux si indisponible."""
        try:
            self._vis = o3d.visualization.Visualizer()
            self._vis.create_window(window_name=_WIN_3D, width=800, height=600)
            opt = self._vis.get_render_option()
            opt.mesh_show_wireframe = True
            opt.mesh_show_back_face = True
            opt.background_color = [0.08, 0.08, 0.12]
            self._vis_alive = True
            print(f"[3D] Fenêtre Open3D ouverte : '{_WIN_3D}'")
        except Exception as exc:
            print(f"[3D] Fenêtre Open3D indisponible ({exc}). Mode OpenCV uniquement.")
            self._vis = None
            self._vis_alive = False

    def _update_visualizer(self, mesh: o3d.geometry.TriangleMesh, has_shapes: bool) -> None:
        """Met à jour le mesh 3D. Sans effet si la fenêtre n'est plus vivante."""
        if not self._vis_alive or self._vis is None:
            return
        try:
            if has_shapes and len(mesh.triangles) > 0:
                if self._current_mesh is not None:
                    self._vis.remove_geometry(self._current_mesh, reset_bounding_box=False)
                self._vis.add_geometry(mesh, reset_bounding_box=not self._camera_set)
                self._camera_set = True
                self._current_mesh = mesh

            self._vis.poll_events()
            alive = self._vis.update_renderer()
            if not alive:
                print("[3D] Fenêtre Open3D fermée.")
                self._vis_alive = False
        except Exception:
            self._vis_alive = False

    def _destroy_visualizer(self) -> None:
        if self._vis is not None:
            try:
                self._vis.destroy_window()
            except Exception:
                pass
            self._vis = None

    # ------------------------------------------------------------------
    # Export mesh
    # ------------------------------------------------------------------

    def _maybe_export(self) -> None:
        mesh = self._current_mesh
        if self._cfg.export_dir is None or mesh is None:
            return
        if len(mesh.triangles) == 0:
            return
        out_dir = Path(self._cfg.export_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        path = out_dir / f"scene_{self._export_index:04d}.ply"
        o3d.io.write_triangle_mesh(str(path), mesh)
        print(f"[export] {path}")
        self._export_index += 1

    # ------------------------------------------------------------------
    # Fenêtre OpenCV — rendu AR principal
    # ------------------------------------------------------------------

    def _render_ar_window(
        self,
        frame: np.ndarray,
        shapes,
        mesh: o3d.geometry.TriangleMesh,
        fps: float,
    ) -> None:
        ar = draw_ar_overlay(
            frame,
            shapes,
            fill_alpha=self._cfg.ar_fill_alpha,
            extrusion_px=self._cfg.ar_extrusion_px,
        )

        # Bandeau d'info
        h, w = ar.shape[:2]
        info = (
            f"FPS {fps:.1f}  |  formes {len(shapes)}"
            f"  |  triangles {len(mesh.triangles)}"
            f"  |  [q] quitter  [s] exporter"
        )
        cv2.rectangle(ar, (0, h - 24), (w, h), (10, 10, 10), -1)
        cv2.putText(ar, info, (8, h - 7),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, (210, 210, 160), 1)

        cv2.imshow(_WIN_AR, ar)

    # ------------------------------------------------------------------
    # Boucle principale
    # ------------------------------------------------------------------

    def run(self) -> None:
        interval = 1.0 / max(self._cfg.target_fps, 1.0)

        cv2.namedWindow(_WIN_AR, cv2.WINDOW_NORMAL)
        self._init_visualizer()

        print(f"[pipeline] Fenêtre AR : '{_WIN_AR}'")
        print("[pipeline] Touches : [q] quitter  [s] exporter mesh .ply")

        with WebcamCapture(self._cfg.capture) as cam:
            w, h = cam.frame_size
            t_prev = time.perf_counter()

            while True:
                t0 = time.perf_counter()

                # --- Lecture webcam ---
                frame = cam.read()
                if frame is None:
                    print("[pipeline] Lecture webcam échouée, arrêt.")
                    break

                # Vérification fenêtre OpenCV toujours ouverte
                if cv2.getWindowProperty(_WIN_AR, cv2.WND_PROP_VISIBLE) < 1:
                    print("[pipeline] Fenêtre AR fermée, arrêt.")
                    break

                # --- Pipeline CV ---
                mask = segment(frame, self._cfg.segmentation)
                shapes = extract_shapes(
                    mask, self._cfg.segmentation, self._cfg.shape
                )
                mesh = build_scene(shapes, (w, h), self._cfg.mesh3d)

                # --- Affichage AR (principal) ---
                self._frame_count += 1
                dt = t0 - t_prev
                fps = 1.0 / dt if dt > 0 else 0.0
                t_prev = t0
                self._render_ar_window(frame, shapes, mesh, fps)

                # --- Open3D (optionnel, persistant) ---
                self._update_visualizer(mesh, has_shapes=len(shapes) > 0)

                # --- Clavier ---
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    print("[pipeline] Touche 'q', arrêt.")
                    break
                if key == ord("s"):
                    self._maybe_export()

                # --- Cadence ---
                elapsed = time.perf_counter() - t0
                wait = interval - elapsed
                if wait > 0:
                    time.sleep(wait)

        cv2.destroyAllWindows()
        self._destroy_visualizer()
        print("[pipeline] Terminé.")
