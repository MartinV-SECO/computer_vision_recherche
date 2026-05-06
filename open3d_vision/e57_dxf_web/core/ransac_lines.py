"""Détection de droites 2D par RANSAC itératif."""

from __future__ import annotations

import numpy as np


def ransac_line_from_points(
    xy: np.ndarray, dist_thresh: float, n_draws: int, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray] | None:
    """
    Une passe RANSAC : retourne (p_a, p_b, d_unit, inlier_mask) ou None.
    xy : (N, 2).
    """
    n = len(xy)
    if n < 2:
        return None
    best_count, best_mask = 0, None
    best_p0, best_d = None, None
    for _ in range(n_draws):
        i, j = rng.integers(0, n, size=2)
        if i == j:
            continue
        p0, p1 = xy[i], xy[j]
        d = p1 - p0
        L = np.linalg.norm(d)
        if L < 1e-12:
            continue
        d = d / L
        v = xy - p0
        dist = np.abs(v[:, 0] * d[1] - v[:, 1] * d[0])
        mask = dist < dist_thresh
        c = int(mask.sum())
        if c > best_count:
            best_count, best_mask = c, mask
            best_p0, best_d = p0.copy(), d.copy()
    if best_mask is None or best_count < 3:
        return None
    inc = xy[best_mask]
    c = inc.mean(axis=0)
    _, _, vt = np.linalg.svd(inc - c, full_matrices=False)
    d_ref = vt[0]
    d_ref = d_ref / (np.linalg.norm(d_ref) + 1e-12)
    t = (inc - c) @ d_ref
    p_a = c + d_ref * t.min()
    p_b = c + d_ref * t.max()
    v2 = xy - c
    dist2 = np.abs(v2[:, 0] * d_ref[1] - v2[:, 1] * d_ref[0])
    mask2 = dist2 < dist_thresh
    return p_a, p_b, d_ref, mask2


def iterative_ransac_lines(
    xy: np.ndarray,
    dist_thresh: float = 0.12,
    n_draws: int = 800,
    max_lines: int = 6,
    min_inliers: int = 8,
    seed: int = 42,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """
    Jusqu'à max_lines droites ; retire les inliers à chaque étape.
    Retourne une liste de (p_a, p_b, indices_inliers) dans le nuage courant (réindexé à chaque étape).
    """
    rng = np.random.default_rng(seed)
    work = np.asarray(xy, dtype=np.float64).copy()
    idx_work = np.arange(len(work), dtype=np.int64)
    lines_seg: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    while len(work) >= min_inliers and len(lines_seg) < max_lines:
        out = ransac_line_from_points(work, dist_thresh, n_draws, rng)
        if out is None:
            break
        p_a, p_b, _d_ref, mask = out
        if mask.sum() < min_inliers:
            break
        inlier_idx = idx_work[mask]
        lines_seg.append((p_a.copy(), p_b.copy(), inlier_idx.copy()))
        idx_work = idx_work[~mask]
        work = work[~mask]
    return lines_seg


def clip_segment_to_xy_bbox(
    p_a: np.ndarray,
    p_b: np.ndarray,
    xmin: float,
    xmax: float,
    ymin: float,
    ymax: float,
    pad_frac: float = 0.05,
) -> tuple[np.ndarray, np.ndarray] | None:
    """
    Prolonge la droite (p_a, p_b) jusqu'aux bords d'une bbox XY agrandie.
    """
    c = 0.5 * (p_a + p_b)
    d = p_b - p_a
    dn = np.linalg.norm(d)
    if dn < 1e-12:
        return None
    d = d / dn
    span = max(xmax - xmin, ymax - ymin, 1e-9)
    pad = pad_frac * span
    xmin, xmax = xmin - pad, xmax + pad
    ymin, ymax = ymin - pad, ymax + pad

    t0, t1 = -1e9, 1e9
    for dim, lo, hi in ((0, xmin, xmax), (1, ymin, ymax)):
        if abs(d[dim]) < 1e-14:
            if not (lo <= c[dim] <= hi):
                return None
        else:
            ta = (lo - c[dim]) / d[dim]
            tb = (hi - c[dim]) / d[dim]
            t_lo, t_hi = min(ta, tb), max(ta, tb)
            t0 = max(t0, t_lo)
            t1 = min(t1, t_hi)
    if t0 > t1:
        return None
    return c + t0 * d, c + t1 * d


def ransac_segments_for_dxf(
    lines_seg: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    xy_all: np.ndarray,
    z_level: float,
) -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    """
    Convertit les droites RANSAC en segments 3D pour DXF (Z constant = z_level).
    Étend chaque segment à la bbox XY de xy_all.
    """
    if len(xy_all) == 0:
        return []
    xmin, ymin = float(xy_all[:, 0].min()), float(xy_all[:, 1].min())
    xmax, ymax = float(xy_all[:, 0].max()), float(xy_all[:, 1].max())
    out: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
    for p_a, p_b, _ig in lines_seg:
        clipped = clip_segment_to_xy_bbox(p_a, p_b, xmin, xmax, ymin, ymax)
        if clipped is None:
            pa, pb = p_a, p_b
        else:
            pa, pb = clipped
        p1 = (float(pa[0]), float(pa[1]), float(z_level))
        p2 = (float(pb[0]), float(pb[1]), float(z_level))
        out.append((p1, p2))
    return out
