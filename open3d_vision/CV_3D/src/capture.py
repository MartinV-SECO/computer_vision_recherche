"""Acquisition de frames depuis la webcam."""

import cv2
import numpy as np
from .config import CaptureConfig


class WebcamCapture:
    """Wrappeur autour de VideoCapture avec contrôle résolution et downscale."""

    def __init__(self, cfg: CaptureConfig) -> None:
        self._cfg = cfg
        self._cap = cv2.VideoCapture(cfg.camera_index)
        if not self._cap.isOpened():
            raise RuntimeError(
                f"Impossible d'ouvrir la caméra (index={cfg.camera_index})"
            )
        self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg.width)
        self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg.height)

    @property
    def frame_size(self) -> tuple[int, int]:
        """(largeur, hauteur) après downscale."""
        w = int(self._cfg.width * self._cfg.downscale)
        h = int(self._cfg.height * self._cfg.downscale)
        return w, h

    def read(self) -> np.ndarray | None:
        """Lit une frame BGR; retourne None si la lecture échoue."""
        ok, frame = self._cap.read()
        if not ok:
            return None
        if self._cfg.downscale != 1.0:
            w, h = self.frame_size
            frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
        return frame

    def release(self) -> None:
        self._cap.release()

    def __enter__(self) -> "WebcamCapture":
        return self

    def __exit__(self, *_) -> None:
        self.release()
