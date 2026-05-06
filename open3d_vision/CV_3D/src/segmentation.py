"""Segmentation des formes géométriques dans une frame BGR.

Étapes :
1. Conversion en niveaux de gris
2. Flou gaussien pour stabiliser Otsu
3. Seuillage Otsu
4. Nettoyage morphologique (opening puis closing)
"""

import cv2
import numpy as np
from .config import SegmentationConfig


def segment(frame_bgr: np.ndarray, cfg: SegmentationConfig) -> np.ndarray:
    """Retourne un masque binaire (0/255) où les formes sont blanches.

    Parameters
    ----------
    frame_bgr:
        Image BGR lue depuis la webcam.
    cfg:
        Paramètres de segmentation.

    Returns
    -------
    np.ndarray
        Masque uint8 de même taille spatiale que l'entrée.
    """
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)

    k = cfg.blur_kernel | 1  # s'assure qu'il est impair
    blurred = cv2.GaussianBlur(gray, (k, k), 0)

    thresh_type = cv2.THRESH_BINARY_INV if cfg.invert else cv2.THRESH_BINARY
    _, mask = cv2.threshold(
        blurred, 0, 255, thresh_type + cv2.THRESH_OTSU
    )

    morph_k = cfg.morph_kernel | 1
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (morph_k, morph_k)
    )
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

    return mask
