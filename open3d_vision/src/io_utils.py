"""
Utilitaires d'entrée/sortie pour nuages de points et images.
"""
import open3d as o3d
from pathlib import Path


def load_point_cloud(path: str):
    """
    Charge un nuage de points depuis un fichier (ply, pcd, xyz, etc.).

    Args:
        path: Chemin vers le fichier.

    Returns:
        open3d.geometry.PointCloud ou None en cas d'erreur.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable: {path}")
    return o3d.io.read_point_cloud(str(path))


def save_point_cloud(pcd, path: str, write_ascii: bool = False):
    """
    Sauvegarde un nuage de points.

    Args:
        pcd: PointCloud Open3D.
        path: Chemin de destination.
        write_ascii: Si True, écrit en ASCII (plus lisible, plus volumineux).
    """
    o3d.io.write_point_cloud(str(path), pcd, write_ascii=write_ascii)


def load_image(path: str):
    """
    Charge une image avec Open3D (pour cohérence avec le pipeline 3D).

    Args:
        path: Chemin vers l'image.

    Returns:
        open3d.geometry.Image.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Fichier introuvable: {path}")
    return o3d.io.read_image(str(path))


def create_point_cloud_from_depth(depth, intrinsic, depth_scale=1000.0, depth_trunc=3.0):
    """
    Crée un nuage de points à partir d'une image de profondeur.

    Args:
        depth: Image de profondeur (Open3D Image ou numpy).
        intrinsic: Matrice intrinsèque de la caméra.
        depth_scale: Facteur d'échelle de la profondeur (ex: 1000 pour mm).
        depth_trunc: Profondeur max (mètres).

    Returns:
        open3d.geometry.PointCloud.
    """
    if not isinstance(depth, o3d.geometry.Image):
        depth = o3d.geometry.Image(depth)
    return o3d.geometry.PointCloud.create_from_depth_image(
        depth, intrinsic, depth_scale=depth_scale, depth_trunc=depth_trunc
    )
