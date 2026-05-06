"""Point d'entrée CLI du pipeline open3d_vision.

Usage :
    python -m src.main [OPTIONS]

Options :
    --camera INT          Index caméra (défaut: 0)
    --width INT           Largeur frame (défaut: 640)
    --height INT          Hauteur frame (défaut: 480)
    --downscale FLOAT     Facteur de réduction (défaut: 1.0)
    --fps FLOAT           FPS cible (défaut: 5.0)
    --min-area FLOAT      Aire minimale contour px² (défaut: 1500)
    --max-contours INT    Max contours par frame (défaut: 8)
    --epsilon FLOAT       Facteur epsilon approxPolyDP (défaut: 0.02)
    --depth FLOAT         Épaisseur extrusion 3D (défaut: 0.3)
    --invert              Inverser masque Otsu
    --no-debug            Désactiver fenêtre debug OpenCV
    --export-dir PATH     Répertoire d'export mesh .ply
"""

import argparse

from .config import (
    CaptureConfig,
    Mesh3DConfig,
    PipelineConfig,
    SegmentationConfig,
    ShapeConfig,
)
from .pipeline import Pipeline


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="open3d-vision",
        description="Pipeline webcam → Otsu → Extrusion → Mesh 3D Open3D",
    )
    p.add_argument("--camera", type=int, default=0)
    p.add_argument("--width", type=int, default=640)
    p.add_argument("--height", type=int, default=480)
    p.add_argument("--downscale", type=float, default=1.0)
    p.add_argument("--fps", type=float, default=5.0)
    p.add_argument("--min-area", type=float, default=1500.0)
    p.add_argument("--max-contours", type=int, default=8)
    p.add_argument("--epsilon", type=float, default=0.02)
    p.add_argument("--depth", type=float, default=0.3)
    p.add_argument("--invert", action="store_true")
    p.add_argument("--no-debug", action="store_true")
    p.add_argument("--ar-alpha", type=float, default=0.35,
                   help="Opacité du remplissage AR (0.0-1.0, défaut: 0.35)")
    p.add_argument("--ar-extrusion", type=int, default=22,
                   help="Décalage en pixels pour l'effet d'extrusion AR (défaut: 22)")
    p.add_argument("--export-dir", type=str, default=None)
    return p


def main() -> None:
    args = _build_parser().parse_args()

    cfg = PipelineConfig(
        capture=CaptureConfig(
            camera_index=args.camera,
            width=args.width,
            height=args.height,
            downscale=args.downscale,
        ),
        segmentation=SegmentationConfig(
            invert=args.invert,
            min_area=args.min_area,
            max_contours=args.max_contours,
        ),
        shape=ShapeConfig(epsilon_factor=args.epsilon),
        mesh3d=Mesh3DConfig(extrusion_depth=args.depth),
        target_fps=args.fps,
        show_debug_cv=not args.no_debug,
        ar_fill_alpha=args.ar_alpha,
        ar_extrusion_px=args.ar_extrusion,
        export_dir=args.export_dir,
    )

    Pipeline(cfg).run()


if __name__ == "__main__":
    main()
