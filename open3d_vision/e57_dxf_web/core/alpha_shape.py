"""Contour 2D (XY) par alpha-shape (Delaunay) avec filtre longueur et simplification."""

from __future__ import annotations

import math
from collections import defaultdict

import numpy as np
from scipy.spatial import Delaunay

# Type des arêtes : ((x,y,z), (x,y,z))
Edge = tuple[tuple[float, float, float], tuple[float, float, float]]


def _circumradius_2d(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> float:
    """Rayon du cercle circonscrit au triangle (p0,p1,p2) en 2D."""
    a = np.linalg.norm(p1 - p0)
    b = np.linalg.norm(p2 - p0)
    c = np.linalg.norm(p2 - p1)
    if a * b * c < 1e-12:
        return np.inf
    area = 0.5 * abs(
        (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])
    )
    if area < 1e-12:
        return np.inf
    return (a * b * c) / (4 * area)


def _edge_length_xy(p1: tuple[float, float, float], p2: tuple[float, float, float]) -> float:
    """Longueur de l'arête en projection XY (mètres)."""
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    return math.hypot(dx, dy)


def _key_xy(p: tuple[float, float, float], ndigits: int = 6) -> tuple[float, float]:
    """Clé 2D pour regrouper les extrémités (chaînage)."""
    return (round(p[0], ndigits), round(p[1], ndigits))


def _douglas_peucker_indices(points_xy: np.ndarray, tolerance: float) -> list[int]:
    """
    Douglas-Peucker en 2D : retourne les indices des points à garder.
    points_xy : (N, 2). tolerance : distance max (m).
    """
    n = len(points_xy)
    if n <= 2:
        return list(range(n))
    if tolerance <= 0:
        return list(range(n))

    def dist_point_to_segment(i: int, i0: int, i1: int) -> float:
        p = points_xy[i]
        a = points_xy[i0]
        b = points_xy[i1]
        ab = b - a
        ab_len = np.linalg.norm(ab)
        if ab_len < 1e-12:
            return float(np.linalg.norm(p - a))
        t = np.clip(np.dot(p - a, ab) / (ab_len * ab_len), 0.0, 1.0)
        proj = a + t * ab
        return float(np.linalg.norm(p - proj))

    def recurse(i0: int, i1: int) -> list[int]:
        if i1 <= i0 + 1:
            return [i0] if i0 != i1 else [i0, i1]
        imax = i0
        dmax = 0.0
        for i in range(i0 + 1, i1):
            d = dist_point_to_segment(i, i0, i1)
            if d > dmax:
                dmax = d
                imax = i
        if dmax <= tolerance:
            return [i0, i1]
        return recurse(i0, imax)[:-1] + recurse(imax, i1)

    return recurse(0, n - 1)


def _chain_edges_to_polylines(edges: list[Edge]) -> list[list[tuple[float, float, float]]]:
    """
    Chaîne les arêtes en polylignes ordonnées (graphe d'adjacence par clé XY).
    Retourne une liste de listes de points (x,y,z).
    """
    if not edges:
        return []
    # Adjacence : key_xy -> [(point_voisin, key_voisin), ...]
    adj: dict[tuple[float, float], list[tuple[tuple[float, float, float], tuple[float, float]]]] = defaultdict(list)
    for (a, b) in edges:
        ka, kb = _key_xy(a), _key_xy(b)
        if ka != kb:
            adj[ka].append((b, kb))
            adj[kb].append((a, ka))

    used_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    polylines: list[list[tuple[float, float, float]]] = []

    def edge_key(e: Edge) -> tuple[tuple[float, float], tuple[float, float]]:
        return tuple(sorted((_key_xy(e[0]), _key_xy(e[1]))))  # type: ignore[return-value]

    for (a, b) in edges:
        ek = edge_key((a, b))
        if ek in used_edges:
            continue
        # Démarrer une polyline à partir de cette arête
        start_pt = a
        start_k = _key_xy(a)
        chain: list[tuple[float, float, float]] = [a]
        cur_pt = b
        cur_k = _key_xy(b)
        used_edges.add(ek)
        chain.append(b)
        # Prolonger dans un sens (fermeture si boucle)
        while True:
            neighbors = [n for n in adj[cur_k] if edge_key((cur_pt, n[0])) not in used_edges]
            if not neighbors:
                break
            next_pt, next_k = neighbors[0]
            used_edges.add(edge_key((cur_pt, next_pt)))
            if next_k == start_k:
                chain.append(start_pt)
                break
            chain.append(next_pt)
            cur_pt, cur_k = next_pt, next_k
        # Prolonger dans l'autre sens (depuis start_pt)
        cur_pt, cur_k = start_pt, start_k
        while True:
            neighbors = [n for n in adj[cur_k] if edge_key((cur_pt, n[0])) not in used_edges]
            if not neighbors:
                break
            next_pt, next_k = neighbors[0]
            used_edges.add(edge_key((cur_pt, next_pt)))
            chain.insert(0, next_pt)
            cur_pt, cur_k = next_pt, next_k
        if len(chain) >= 2:
            polylines.append(chain)
    return polylines


def _simplify_edges(edges: list[Edge], tolerance: float) -> list[Edge]:
    """
    Simplifie les arêtes par Douglas-Peucker (en XY).
    Chaîne les segments en polylignes, simplifie chaque polyline, puis reconstitue les arêtes.
    """
    if tolerance <= 0 or not edges:
        return edges
    polylines = _chain_edges_to_polylines(edges)
    out: list[Edge] = []
    for poly in polylines:
        if len(poly) < 2:
            continue
        pts_xy = np.array([[p[0], p[1]] for p in poly], dtype=np.float64)
        indices = _douglas_peucker_indices(pts_xy, tolerance)
        for k in range(len(indices) - 1):
            i, j = indices[k], indices[k + 1]
            out.append((poly[i], poly[j]))
    return out


def alpha_shape_edges_from_points(
    pts: np.ndarray,
    alpha: float,
    min_edge_length: float = 0.0,
    simplify_tolerance: float = 0.0,
) -> list[Edge]:
    """
    Arêtes du contour alpha-shape projetées en XY.
    pts : (N, 3) — utilise pts[:, :2] pour la triangulation, Z conservé aux extrémités.
    min_edge_length : longueur minimale en m (arêtes plus courtes ignorées).
    simplify_tolerance : tolérance Douglas-Peucker en m (0 = pas de simplification).
    Retourne une liste de ((x1,y1,z1), (x2,y2,z2)).
    """
    pts = np.asarray(pts, dtype=np.float64)
    if len(pts) < 3:
        return []
    pts_2d = pts[:, :2]
    tri = Delaunay(pts_2d)

    edge_count: dict[tuple[int, int], int] = {}
    for s in tri.simplices:
        p0, p1, p2 = pts_2d[s[0]], pts_2d[s[1]], pts_2d[s[2]]
        r = _circumradius_2d(p0, p1, p2)
        if r <= alpha:
            for i, j in [(0, 1), (1, 2), (2, 0)]:
                ei, ej = int(s[i]), int(s[j])
                edge = tuple(sorted((ei, ej)))
                edge_count[edge] = edge_count.get(edge, 0) + 1

    lines: list[Edge] = []
    for (i, j), count in edge_count.items():
        if count == 1:
            pi = (float(pts[i, 0]), float(pts[i, 1]), float(pts[i, 2]))
            pj = (float(pts[j, 0]), float(pts[j, 1]), float(pts[j, 2]))
            if min_edge_length > 0 and _edge_length_xy(pi, pj) < min_edge_length:
                continue
            lines.append((pi, pj))

    if simplify_tolerance > 0:
        lines = _simplify_edges(lines, simplify_tolerance)
    return lines
