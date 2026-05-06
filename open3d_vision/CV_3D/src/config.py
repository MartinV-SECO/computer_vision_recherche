"""Paramètres runtime du pipeline open3d_vision.

Tous les hyperparamètres sont regroupés ici pour permettre un réglage
centralisé sans toucher au code métier.
"""

from dataclasses import dataclass, field


@dataclass
class CaptureConfig:
    camera_index: int = 0
    width: int = 640
    height: int = 480
    # Rapport de downscale appliqué avant traitement (1.0 = pas de réduction)
    downscale: float = 1.0


@dataclass
class SegmentationConfig:
    # Taille du kernel gaussien (doit être impair)
    blur_kernel: int = 5
    # Inversion masque (utile si formes sombres sur fond clair)
    invert: bool = False
    # Kernel morphologique pour opening/closing
    morph_kernel: int = 5
    # Aire minimale d'un contour valide (pixels²)
    min_area: float = 1500.0
    # Nombre maximum de contours à traiter par frame
    max_contours: int = 8


@dataclass
class ShapeConfig:
    # Facteur epsilon pour approxPolyDP (fraction du périmètre)
    epsilon_factor: float = 0.02
    # Nombre minimum de sommets du polygone approché
    min_vertices: int = 3


@dataclass
class Mesh3DConfig:
    # Épaisseur d'extrusion en unités 3D normalisées
    extrusion_depth: float = 0.3
    # Facteur de normalisation : dimension image → espace 3D
    # La plus grande dimension de l'image sera mappée à 1.0
    normalize: bool = True


@dataclass
class PipelineConfig:
    capture: CaptureConfig = field(default_factory=CaptureConfig)
    segmentation: SegmentationConfig = field(default_factory=SegmentationConfig)
    shape: ShapeConfig = field(default_factory=ShapeConfig)
    mesh3d: Mesh3DConfig = field(default_factory=Mesh3DConfig)
    # Frame rate cible pour la boucle principale
    target_fps: float = 5.0
    # Afficher la fenêtre AR overlay sur le flux caméra
    show_debug_cv: bool = True
    # Opacité du remplissage AR (0=invisible, 1=opaque)
    ar_fill_alpha: float = 0.35
    # Décalage en pixels de la face haute dans la projection oblique
    ar_extrusion_px: int = 22
    # Répertoire d'export des meshes (None = pas d'export automatique)
    export_dir: str | None = None
