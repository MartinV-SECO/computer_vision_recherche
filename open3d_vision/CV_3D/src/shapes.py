"""Extraction et filtrage des contours depuis un masque binaire.

Chaque contour validé est approximé en polygone simple et annoté
d'une étiquette de forme (triangle, quadrilatère, cercle, polygone).
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from .config import SegmentationConfig, ShapeConfig


@dataclass
class Shape2D:
    """Représentation d'une forme 2D détectée."""

    contour: np.ndarray          # (N, 1, 2) int32 — contour brut OpenCV
    polygon: np.ndarray          # (M, 2) float32 — polygone simplifié
    area: float
    label: str                   # "triangle" | "quad" | "circle" | "polygon"
    centroid: tuple[float, float]


def _classify(n_vertices: int) -> str:
    if n_vertices == 3:
        return "triangle"
    if n_vertices == 4:
        return "quad"
    if n_vertices > 6:
        # Au-delà de 6 sommets, l'approximation polygonale ressemble à un cercle
        return "circle"
    return "polygon"


def extract_shapes(
    mask: np.ndarray,
    seg_cfg: SegmentationConfig,
    shape_cfg: ShapeConfig,
) -> list[Shape2D]:
    """Retourne la liste des formes valides extraites du masque.

    Parameters
    ----------
    mask:
        Masque binaire (uint8, 0/255).
    seg_cfg:
        Paramètres de filtrage (min_area, max_contours).
    shape_cfg:
        Paramètres d'approximation polygonale.
    """
    contours, _ = cv2.findContours(
        mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    # Filtrage par aire et tri décroissant pour garder les plus grandes
    valid = [c for c in contours if cv2.contourArea(c) >= seg_cfg.min_area]
    valid = sorted(valid, key=cv2.contourArea, reverse=True)[: seg_cfg.max_contours]

    shapes: list[Shape2D] = []
    for cnt in valid:
        perimeter = cv2.arcLength(cnt, closed=True)
        epsilon = shape_cfg.epsilon_factor * perimeter
        approx = cv2.approxPolyDP(cnt, epsilon, closed=True)

        n = len(approx)
        if n < shape_cfg.min_vertices:
            continue

        polygon = approx.reshape(-1, 2).astype(np.float32)
        area = float(cv2.contourArea(cnt))
        M = cv2.moments(cnt)
        if M["m00"] == 0:
            continue
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]

        shapes.append(
            Shape2D(
                contour=cnt,
                polygon=polygon,
                area=area,
                label=_classify(n),
                centroid=(cx, cy),
            )
        )

    return shapes


LABEL_COLORS: dict[str, tuple[int, int, int]] = {
    "triangle": (0, 255, 128),
    "quad": (255, 128, 0),
    "circle": (128, 0, 255),
    "polygon": (0, 200, 255),
}


def draw_shapes(frame_bgr: np.ndarray, shapes: list[Shape2D]) -> np.ndarray:
    """Dessine les contours et étiquettes sur une copie de la frame."""
    out = frame_bgr.copy()
    for s in shapes:
        color = LABEL_COLORS.get(s.label, (200, 200, 200))
        cv2.drawContours(out, [s.contour], -1, color, 2)
        cx, cy = int(s.centroid[0]), int(s.centroid[1])
        cv2.putText(
            out,
            s.label,
            (cx - 30, cy),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )
    return out


def draw_ar_overlay(
    frame_bgr: np.ndarray,
    shapes: list[Shape2D],
    fill_alpha: float = 0.5,
    extrusion_px: int = 22,
) -> np.ndarray:
    """Superpose les meshes 3D extrudés sur le flux caméra à l'opacité donnée.

    Rendu en projection oblique :
    - Faces latérales (légèrement plus sombres)
    - Face basse (couleur pleine)
    - Face haute décalée (plus claire, simule l'éclairage du dessus)
    Tout le remplissage est fusionné avec le flux caméra via fill_alpha.
    Les contours et étiquettes sont dessinés nets par-dessus.

    Parameters
    ----------
    frame_bgr:
        Frame BGR de la webcam — fond de la visualisation.
    shapes:
        Formes 2D détectées à extruder visuellement.
    fill_alpha:
        Opacité du remplissage (0.0 = invisible, 1.0 = opaque plein).
    extrusion_px:
        Amplitude en pixels du décalage oblique (face haute).
    """
    # Calque de remplissage : toute la géométrie colorée dessinée ici
    fill_layer = frame_bgr.copy()

    ox, oy = -extrusion_px, -extrusion_px  # vecteur oblique haut-gauche

    for s in shapes:
        color = LABEL_COLORS.get(s.label, (200, 200, 200))
        pts_bot = s.polygon.astype(np.int32)
        pts_top = (pts_bot + np.array([ox, oy], dtype=np.int32))

        bright = tuple(min(255, int(c * 1.45)) for c in color)
        dark   = tuple(max(0,   int(c * 0.55)) for c in color)

        n = len(pts_bot)

        # Faces latérales (quad par quad, couleur sombre)
        for i in range(n):
            j = (i + 1) % n
            quad = np.array(
                [pts_bot[i], pts_bot[j], pts_top[j], pts_top[i]], dtype=np.int32
            )
            cv2.fillPoly(fill_layer, [quad], dark)

        # Face basse (couleur principale)
        cv2.fillPoly(fill_layer, [pts_bot], color)

        # Face haute (plus claire)
        cv2.fillPoly(fill_layer, [pts_top], bright)

    # Fusion : webcam * (1-alpha) + calque_rempli * alpha
    result = cv2.addWeighted(frame_bgr, 1.0 - fill_alpha, fill_layer, fill_alpha, 0)

    # Contours nets + arêtes latérales + étiquettes (par-dessus la fusion)
    for s in shapes:
        color = LABEL_COLORS.get(s.label, (200, 200, 200))
        pts_bot = s.polygon.astype(np.int32)
        pts_top = (pts_bot + np.array([ox, oy], dtype=np.int32))
        bright  = tuple(min(255, int(c * 1.45)) for c in color)

        n = len(pts_bot)
        for i in range(n):
            cv2.line(result, tuple(pts_bot[i]), tuple(pts_top[i]), color, 1)

        cv2.polylines(result, [pts_bot], isClosed=True, color=color,  thickness=2)
        cv2.polylines(result, [pts_top], isClosed=True, color=bright, thickness=1)

        cx, cy = int(s.centroid[0]), int(s.centroid[1])
        txt = s.label
        (tw, th), _ = cv2.getTextSize(txt, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)
        lx, ly = cx - tw // 2, cy + th // 2
        cv2.rectangle(result, (lx - 3, ly - th - 4), (lx + tw + 3, ly + 4), (20, 20, 20), -1)
        cv2.putText(result, txt, (lx, ly), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

    return result
