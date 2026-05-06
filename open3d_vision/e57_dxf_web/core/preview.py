"""Figures PNG (matplotlib Agg) pour prévisualiser tranche Z, alpha-shape et RANSAC."""

from __future__ import annotations

import io
from typing import Sequence

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# Résolution élevée pour les exports PNG (figsize × dpi ≈ pixels).
PREVIEW_DPI = 160
PREVIEW_FIGSIZE_MAIN = (16.0, 12.5)
PREVIEW_FIGSIZE_COMBINED = (17.0, 13.0)


def _add_param_box(ax, lines: list[str], corner: str = "upper left") -> None:
    """Affiche une boîte de paramètres dans un coin du graphe."""
    if not lines:
        return
    va = "top" if "upper" in corner else "bottom"
    ha = "left" if "left" in corner else "right"
    x = 0.02 if "left" in corner else 0.98
    y = 0.98 if "upper" in corner else 0.02
    text = "\n".join(lines)
    ax.text(
        x, y, text,
        transform=ax.transAxes,
        fontsize=9,
        verticalalignment=va,
        horizontalalignment=ha,
        bbox=dict(boxstyle="round,pad=0.4", facecolor="wheat", alpha=0.9, edgecolor="gray"),
        family="monospace",
    )


def _fig_to_png(fig, dpi: int = PREVIEW_DPI) -> bytes:
    """Encode une figure matplotlib en PNG avec la résolution demandée."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    return buf.getvalue()


def preview_tranche(
    sliced_xyz: np.ndarray,
    z_min: float,
    z_max: float,
    max_scatter: int = 120_000,
) -> bytes:
    """
    Vue XY des points après filtrage Z uniquement (avant downsampling voxel).
    Couleur = cote Z dans la tranche pour visualiser l'épaisseur verticale.
    """
    pts = np.asarray(sliced_xyz, dtype=np.float64)
    n = len(pts)
    if n == 0:
        raise ValueError("Aucun point pour l'aperçu tranche.")
    if n > max_scatter:
        idx = np.random.default_rng(42).choice(n, size=max_scatter, replace=False)
        plot_pts = pts[idx]
        n_plot = max_scatter
    else:
        plot_pts = pts
        n_plot = n
    z = plot_pts[:, 2]
    fig, ax = plt.subplots(figsize=PREVIEW_FIGSIZE_MAIN)
    sc = ax.scatter(
        plot_pts[:, 0],
        plot_pts[:, 1],
        c=z,
        s=4,
        cmap="viridis",
        alpha=0.55,
        rasterized=True,
    )
    plt.colorbar(sc, ax=ax, label="Z (m)")
    ax.set_aspect("equal", adjustable="box")
    sub = f" — aperçu {n_plot} / {n} pts" if n_plot < n else f" — {n} pts"
    ax.set_title(
        f"Tranche Z ∈ [{z_min:.4g}, {z_max:.4g}]{sub}\n(avant voxel / alpha-shape / RANSAC)",
        fontsize=13,
    )
    _add_param_box(ax, [f"z_min = {z_min:.4g} m", f"z_max = {z_max:.4g} m"])
    ax.set_xlabel("x (m)", fontsize=12)
    ax.set_ylabel("y (m)", fontsize=12)
    return _fig_to_png(fig)


def preview_downsampled(
    down_xyz: np.ndarray,
    voxel_size: float,
    max_scatter: int = 150_000,
) -> bytes:
    """
    Grille XY des points après downsampling voxel, avant alpha-shape / RANSAC.
    Aucun tracé de contour — uniquement le nuage utilisé en entrée des algorithmes.
    """
    pts = np.asarray(down_xyz, dtype=np.float64)
    n = len(pts)
    if n == 0:
        raise ValueError("Aucun point pour l'aperçu downsampled.")
    if n > max_scatter:
        idx = np.random.default_rng(43).choice(n, size=max_scatter, replace=False)
        plot_pts = pts[idx]
        n_plot = max_scatter
    else:
        plot_pts = pts
        n_plot = n
    xy = plot_pts[:, :2]
    fig, ax = plt.subplots(figsize=PREVIEW_FIGSIZE_MAIN)
    ax.scatter(xy[:, 0], xy[:, 1], s=5, c="#2d6a9a", alpha=0.5, rasterized=True)
    ax.set_aspect("equal", adjustable="box")
    sub = f" — aperçu {n_plot} / {n} pts" if n_plot < n else f" — {n} pts"
    ax.set_title(
        f"Grille downsamplée (voxel {voxel_size:.4g} m){sub}\n(avant alpha-shape / RANSAC)",
        fontsize=13,
    )
    _add_param_box(ax, [f"voxel_size = {voxel_size:.4g} m"])
    ax.set_xlabel("x (m)", fontsize=12)
    ax.set_ylabel("y (m)", fontsize=12)
    return _fig_to_png(fig)


def preview_alphashape(
    down_xy: np.ndarray,
    edges: Sequence[tuple[tuple[float, float, float], tuple[float, float, float]]],
    alpha: float,
    min_edge_length: float = 0.0,
    simplify_tolerance: float = 0.0,
    max_scatter: int = 80_000,
) -> bytes:
    """
    Nuage XY + arêtes du contour alpha-shape.
    Sous-échantillonne l'affichage des points si trop nombreux.
    """
    xy = np.asarray(down_xy[:, :2], dtype=np.float64)
    n = len(xy)
    if n > max_scatter:
        idx = np.random.default_rng(0).choice(n, size=max_scatter, replace=False)
        xy_plot = xy[idx]
    else:
        xy_plot = xy
    fig, ax = plt.subplots(figsize=PREVIEW_FIGSIZE_MAIN)
    ax.scatter(xy_plot[:, 0], xy_plot[:, 1], s=4, c="#888", alpha=0.45, rasterized=True)
    for p1, p2 in edges:
        ax.plot([p1[0], p2[0]], [p1[1], p2[1]], "-", color="#1f77b4", lw=1.6, alpha=0.9)
    ax.set_aspect("equal", adjustable="box")
    ax.set_title(f"Alpha-shape (α={alpha}) — {len(edges)} arêtes, {n} pts (voxel)", fontsize=13)
    params_lines = [f"α = {alpha:.4g}", f"long. min arête = {min_edge_length:.4g} m", f"simplif. = {simplify_tolerance:.4g} m"]
    _add_param_box(ax, params_lines)
    ax.set_xlabel("x (m)", fontsize=12)
    ax.set_ylabel("y (m)", fontsize=12)
    return _fig_to_png(fig)


def preview_ransac(
    down_xy: np.ndarray,
    line_segments: list[tuple[np.ndarray, np.ndarray]],
    dist_thresh: float = 0.08,
    max_lines: int = 6,
    min_inliers: int = 8,
    n_draws: int = 1000,
    max_scatter: int = 80_000,
) -> bytes:
    """
    Nuage XY + droites RANSAC (segments pa–pb affinés).
    line_segments : liste de (p_a, p_b) en 2D.
    """
    xy = np.asarray(down_xy[:, :2], dtype=np.float64)
    n = len(xy)
    if n > max_scatter:
        idx = np.random.default_rng(1).choice(n, size=max_scatter, replace=False)
        xy_plot = xy[idx]
    else:
        xy_plot = xy
    fig, ax = plt.subplots(figsize=PREVIEW_FIGSIZE_MAIN)
    ax.scatter(xy_plot[:, 0], xy_plot[:, 1], s=4, c="#555", alpha=0.4, rasterized=True)
    cmap = plt.cm.tab10(np.linspace(0, 1, max(len(line_segments), 1)))
    for k, (pa, pb) in enumerate(line_segments):
        ax.plot(
            [float(pa[0]), float(pb[0])],
            [float(pa[1]), float(pb[1])],
            "-",
            color=cmap[k % 10],
            lw=2.8,
            alpha=0.9,
            label=f"Droite {k + 1}",
        )
    ax.set_aspect("equal", adjustable="box")
    ax.set_title(f"RANSAC — {len(line_segments)} droite(s)", fontsize=13)
    params_lines = [
        f"dist_thresh = {dist_thresh:.4g} m",
        f"max_lines = {max_lines}",
        f"min_inliers = {min_inliers}",
        f"n_draws = {n_draws}",
    ]
    _add_param_box(ax, params_lines)
    ax.set_xlabel("x (m)", fontsize=12)
    ax.set_ylabel("y (m)", fontsize=12)
    if len(line_segments) <= 10:
        ax.legend(loc="best", fontsize=10)
    return _fig_to_png(fig)


def preview_combined(
    down_xy: np.ndarray,
    edges: Sequence[tuple[tuple[float, float, float], tuple[float, float, float]]] | None,
    line_segments: list[tuple[np.ndarray, np.ndarray]] | None,
    alpha: float,
    alpha_min_edge: float = 0.0,
    alpha_simplify: float = 0.0,
    ransac_dist_thresh: float = 0.08,
    ransac_max_lines: int = 6,
    ransac_min_inliers: int = 8,
    max_scatter: int = 70_000,
) -> bytes:
    """Vue combinée (alpha en traits fins, RANSAC en couleur) avec paramètres affichés."""
    xy = np.asarray(down_xy[:, :2], dtype=np.float64)
    n = len(xy)
    if n > max_scatter:
        idx = np.random.default_rng(2).choice(n, size=max_scatter, replace=False)
        xy_plot = xy[idx]
    else:
        xy_plot = xy
    fig, ax = plt.subplots(figsize=PREVIEW_FIGSIZE_COMBINED)
    ax.scatter(xy_plot[:, 0], xy_plot[:, 1], s=3, c="#ccc", alpha=0.35, rasterized=True)
    if edges:
        for p1, p2 in edges:
            ax.plot([p1[0], p2[0]], [p1[1], p2[1]], "-", color="#6baed6", lw=1.2, alpha=0.85)
    if line_segments:
        cmap = plt.cm.tab10(np.linspace(0, 1, max(len(line_segments), 1)))
        for k, (pa, pb) in enumerate(line_segments):
            ax.plot(
                [float(pa[0]), float(pb[0])],
                [float(pa[1]), float(pb[1])],
                "-",
                color=cmap[k % 10],
                lw=2.4,
                alpha=0.95,
            )
    ax.set_aspect("equal", adjustable="box")
    ax.set_title("Alpha-shape (bleu) + RANSAC (couleurs)", fontsize=13)
    params_lines = [
        "Alpha: α=%g, long.min=%g m, simplif.=%g m" % (alpha, alpha_min_edge, alpha_simplify),
        "RANSAC: dist=%g m, max %d droites, min %d inliers" % (ransac_dist_thresh, ransac_max_lines, ransac_min_inliers),
    ]
    _add_param_box(ax, params_lines)
    ax.set_xlabel("x (m)", fontsize=12)
    ax.set_ylabel("y (m)", fontsize=12)
    return _fig_to_png(fig)
