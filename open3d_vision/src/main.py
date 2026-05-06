"""
Point d'entrée principal : charge et affiche un nuage de points ou une géométrie de démo.
"""
import open3d as o3d
from pathlib import Path

from .io_utils import load_point_cloud
from .visualization import draw_geometries


def run_demo():
    """
    Lance la démo Open3D : géométrie intégrée (cône + sphère) pour tester l'installation.
    """
    mesh = o3d.geometry.TriangleMesh.create_cone(radius=0.5, height=1.0)
    mesh.paint_uniform_color([0.8, 0.2, 0.2])
    sphere = o3d.geometry.TriangleMesh.create_sphere(radius=0.3)
    sphere.translate([0.6, 0, 0.5])
    sphere.paint_uniform_color([0.2, 0.6, 0.9])
    draw_geometries([mesh, sphere], window_name="Démo Open3D")


def run_from_file(point_cloud_path: str, show_normals: bool = False):
    """
    Charge un nuage de points depuis un fichier et l'affiche.

    Args:
        point_cloud_path: Chemin vers le fichier (ply, pcd, xyz, etc.).
        show_normals: Si True, estime et affiche les normales.
    """
    pcd = load_point_cloud(point_cloud_path)
    if show_normals:
        pcd.estimate_normals()
    draw_geometries(pcd, window_name=Path(point_cloud_path).name)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        run_from_file(sys.argv[1], show_normals="--normals" in sys.argv)
    else:
        run_demo()
