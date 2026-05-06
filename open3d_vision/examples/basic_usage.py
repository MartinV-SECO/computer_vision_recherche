"""
Exemple basique : créer un nuage de points synthétique et le visualiser.
"""
import sys
from pathlib import Path

# Ajouter le répertoire parent au path pour importer src
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import open3d as o3d
from src.io_utils import save_point_cloud
from src.visualization import draw_geometries


def main():
    """Génère un nuage de points (sphère) et l'affiche."""
    # Nuage de points à partir d'un maillage sphérique
    mesh = o3d.geometry.TriangleMesh.create_sphere(radius=1.0, resolution=20)
    pcd = mesh.sample_points_uniformly(number_of_points=2000)
    pcd.paint_uniform_color([0.3, 0.7, 0.5])

    # Optionnel : sauvegarder
    out_dir = Path(__file__).parent.parent / "data"
    out_dir.mkdir(exist_ok=True)
    save_point_cloud(pcd, str(out_dir / "sphere_sample.ply"))

    draw_geometries(pcd, window_name="Sphère échantillonnée")


if __name__ == "__main__":
    main()
