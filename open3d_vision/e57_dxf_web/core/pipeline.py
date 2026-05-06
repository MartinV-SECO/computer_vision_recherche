"""Orchestration : E57 + paramètres → DXF + prévisualisations."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from e57_dxf_web.core.alpha_shape import alpha_shape_edges_from_points
from e57_dxf_web.core.dxf_export import build_dxf_bytes
from e57_dxf_web.core.e57_io import load_e57_points
from e57_dxf_web.core.params import ConvertParams
from e57_dxf_web.core.preprocess import filter_z_band, voxel_downsample
from e57_dxf_web.core.preview import (
    preview_alphashape,
    preview_combined,
    preview_downsampled,
    preview_ransac,
    preview_tranche,
)
from e57_dxf_web.core.ransac_lines import iterative_ransac_lines, ransac_segments_for_dxf


@dataclass
class PrecomputedGrid:
    """Grille tranche Z + voxel déjà calculée (pour cache)."""

    sliced: np.ndarray
    down: np.ndarray
    z_level: float


def load_and_prepare_grid(
    e57_path: str,
    params: ConvertParams,
    progress: Callable[[int, str], None] | None = None,
) -> PrecomputedGrid:
    """
    Charge l'E57, filtre la tranche Z et downsampl en voxel.
    Utilisé pour remplir le cache ou fournir une grille à run_convert.
    """
    def p(percent: int, msg: str) -> None:
        if progress:
            progress(percent, msg)

    p(5, "Chargement du fichier E57…")
    pts = load_e57_points(e57_path)
    p(18, "Filtrage de la tranche Z…")
    sliced = filter_z_band(pts, params.z_min, params.z_max)
    if len(sliced) == 0:
        raise ValueError("Aucun point dans la tranche Z choisie (z_min, z_max).")
    z_level = float(sliced[:, 2].mean())
    p(32, "Downsampling voxel…")
    down = voxel_downsample(sliced, params.voxel_size)
    return PrecomputedGrid(sliced=sliced, down=down, z_level=z_level)


@dataclass
class ConvertResult:
    """Résultat d'une conversion."""

    dxf_bytes: bytes
    filename: str
    n_points_slice: int
    n_points_downsampled: int
    n_alpha_edges: int
    n_ransac_lines: int
    z_level: float
    preview_tranche_png: bytes | None = None
    preview_downsampled_png: bytes | None = None
    preview_alphashape_png: bytes | None = None
    preview_ransac_png: bytes | None = None
    preview_combined_png: bytes | None = None


def run_convert(
    e57_path: str,
    params: ConvertParams,
    file_stem: str = "export",
    progress: Callable[[int, str], None] | None = None,
    precomputed: PrecomputedGrid | None = None,
) -> ConvertResult:
    """
    Charge l'E57, tranche Z, voxel, alpha-shape et/ou RANSAC, DXF + PNG de prévisualisation.
    Si precomputed est fourni, charge/filtre/voxel sont ignorés (cache).
    progress(0-100, message) est appelé aux étapes lourdes.
    """
    previews: dict[str, bytes | None] = {
        "tranche": None,
        "downsampled": None,
        "alphashape": None,
        "ransac": None,
        "combined": None,
    }

    def p(percent: int, msg: str) -> None:
        if progress:
            progress(percent, msg)

    if precomputed is not None:
        sliced = precomputed.sliced
        down = precomputed.down
        z_level = precomputed.z_level
        n_slice = len(sliced)
        n_down = len(down)
        p(35, "Grille en cache — algorithme…")
    else:
        p(5, "Chargement du fichier E57…")
        pts = load_e57_points(e57_path)
        p(18, "Filtrage de la tranche Z…")
        sliced = filter_z_band(pts, params.z_min, params.z_max)
        n_slice = len(sliced)
        if n_slice == 0:
            raise ValueError("Aucun point dans la tranche Z choisie (z_min, z_max).")
        z_level = float(sliced[:, 2].mean())
        p(32, "Downsampling voxel…")
        down = voxel_downsample(sliced, params.voxel_size)
        n_down = len(down)

    alpha_segments: list | None = None
    ransac_segments: list | None = None
    n_alpha = 0
    n_ransac = 0
    edges_list: list | None = None
    ransac_line_pairs: list[tuple[np.ndarray, np.ndarray]] = []

    if params.method in ("alphashape", "both"):
        if n_down < 3:
            raise ValueError("Pas assez de points après downsampling pour l'alpha-shape (minimum 3).")
        p(48, "Calcul du contour alpha-shape (Delaunay)…")
        edges = alpha_shape_edges_from_points(
            down,
            params.alpha,
            min_edge_length=params.alpha_min_edge_length,
            simplify_tolerance=params.alpha_simplify_tolerance,
        )
        n_alpha = len(edges)
        edges_list = edges
        if params.method == "alphashape":
            if n_alpha == 0:
                raise ValueError(
                    "Alpha-shape : aucune arête (augmenter alpha ou la densité après voxel)."
                )
            alpha_segments = edges
        elif n_alpha > 0:
            alpha_segments = edges

    if params.method in ("ransac", "both"):
        if n_down < params.ransac_min_inliers:
            raise ValueError(
                f"Pas assez de points après downsampling pour RANSAC (minimum {params.ransac_min_inliers})."
            )
        p(62 if params.method == "ransac" else 58, "RANSAC (droites)…")
        xy = down[:, :2]
        lines = iterative_ransac_lines(
            xy,
            dist_thresh=params.ransac_dist_thresh,
            n_draws=params.ransac_n_draws,
            max_lines=params.max_ransac_lines,
            min_inliers=params.ransac_min_inliers,
            seed=params.seed,
        )
        ransac_line_pairs = [(pa, pb) for pa, pb, _ in lines]
        segs = ransac_segments_for_dxf(lines, xy, z_level)
        n_ransac = len(segs)
        if params.method == "ransac":
            if n_ransac == 0:
                raise ValueError("RANSAC : aucune droite (dist_thresh / min_inliers / max_lines).")
            ransac_segments = segs
        elif n_ransac > 0:
            ransac_segments = segs

    if params.method == "both" and not alpha_segments and not ransac_segments:
        raise ValueError("Mode combiné : ni alpha-shape ni RANSAC n'a produit de géométrie.")

    p(82, "Écriture DXF…")
    dxf_bytes = build_dxf_bytes(alpha_segments, ransac_segments)
    safe_stem = "".join(c if c.isalnum() or c in "._-" else "_" for c in file_stem)[:80]
    fname = f"{safe_stem}_{params.method}.dxf"

    p(88, "Aperçu tranche Z…")
    previews["tranche"] = preview_tranche(sliced, params.z_min, params.z_max)
    p(89, "Aperçu grille downsamplée…")
    previews["downsampled"] = preview_downsampled(down, params.voxel_size)
    p(92, "Génération des aperçus méthodes…")
    if params.method == "alphashape" and alpha_segments:
        previews["alphashape"] = preview_alphashape(
            down, alpha_segments, params.alpha,
            min_edge_length=params.alpha_min_edge_length,
            simplify_tolerance=params.alpha_simplify_tolerance,
        )
    elif params.method == "ransac" and ransac_line_pairs:
        previews["ransac"] = preview_ransac(
            down, ransac_line_pairs,
            dist_thresh=params.ransac_dist_thresh,
            max_lines=params.max_ransac_lines,
            min_inliers=params.ransac_min_inliers,
            n_draws=params.ransac_n_draws,
        )
    elif params.method == "both":
        if alpha_segments:
            previews["alphashape"] = preview_alphashape(
                down, alpha_segments, params.alpha,
                min_edge_length=params.alpha_min_edge_length,
                simplify_tolerance=params.alpha_simplify_tolerance,
            )
        if ransac_line_pairs:
            previews["ransac"] = preview_ransac(
                down, ransac_line_pairs,
                dist_thresh=params.ransac_dist_thresh,
                max_lines=params.max_ransac_lines,
                min_inliers=params.ransac_min_inliers,
                n_draws=params.ransac_n_draws,
            )
        if alpha_segments and ransac_line_pairs:
            previews["combined"] = preview_combined(
                down, alpha_segments, ransac_line_pairs, params.alpha,
                alpha_min_edge=params.alpha_min_edge_length,
                alpha_simplify=params.alpha_simplify_tolerance,
                ransac_dist_thresh=params.ransac_dist_thresh,
                ransac_max_lines=params.max_ransac_lines,
                ransac_min_inliers=params.ransac_min_inliers,
            )
        elif alpha_segments:
            previews["combined"] = preview_alphashape(
                down, alpha_segments, params.alpha,
                min_edge_length=params.alpha_min_edge_length,
                simplify_tolerance=params.alpha_simplify_tolerance,
            )
        elif ransac_line_pairs:
            previews["combined"] = preview_ransac(
                down, ransac_line_pairs,
                dist_thresh=params.ransac_dist_thresh,
                max_lines=params.max_ransac_lines,
                min_inliers=params.ransac_min_inliers,
                n_draws=params.ransac_n_draws,
            )

    p(100, "Terminé.")
    return ConvertResult(
        dxf_bytes=dxf_bytes,
        filename=fname,
        n_points_slice=n_slice,
        n_points_downsampled=n_down,
        n_alpha_edges=n_alpha,
        n_ransac_lines=n_ransac,
        z_level=z_level,
        preview_tranche_png=previews["tranche"],
        preview_downsampled_png=previews["downsampled"],
        preview_alphashape_png=previews["alphashape"],
        preview_ransac_png=previews["ransac"],
        preview_combined_png=previews["combined"],
    )
