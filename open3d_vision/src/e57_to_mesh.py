"""
Script standalone : ingestion E57 → nuage de points Open3D → maillage Poisson avec couleurs.

Basé sur exploration e57.ipynb. Prêt pour intégration dans une application (CLI ou import).
Dépendances : e57, open3d, numpy, scipy
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import open3d as o3d

# Optionnel : e57 peut ne pas être installé partout
try:
    import e57
except ImportError:
    e57 = None

try:
    from scipy.spatial import cKDTree
except ImportError:
    cKDTree = None


# ---------------------------------------------------------------------------
# Ingestion E57 → Open3D
# ---------------------------------------------------------------------------


def load_e57_points(path_e57: str | Path) -> "e57.PointCloud":
    """
    Charge les points (et couleurs si présentes) depuis un fichier E57.

    :param path_e57: Chemin vers le fichier .e57
    :return: Objet point cloud e57 (attributs .points et éventuellement .color)
    :raises ImportError: si le module e57 n'est pas installé
    :raises FileNotFoundError: si le fichier n'existe pas
    """
    if e57 is None:
        raise ImportError("Le module 'e57' est requis. Installer avec: pip install e57")
    path = Path(path_e57)
    if not path.is_file():
        raise FileNotFoundError(f"Fichier E57 introuvable: {path}")
    return e57.read_points(str(path.resolve()))


def e57_to_open3d_point_cloud(path_e57: str | Path) -> o3d.geometry.PointCloud:
    """
    Convertit un fichier E57 en nuage de points Open3D avec gestion des couleurs.

    :param path_e57: Chemin vers le fichier .e57
    :return: PointCloud Open3D (points + couleurs si disponibles)
    """
    pc = load_e57_points(path_e57)
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(np.asarray(pc.points, dtype=np.float64))
    if hasattr(pc, "color") and pc.color is not None:
        colors = np.asarray(pc.color, dtype=np.float64)
        if colors.ndim == 2 and colors.shape[1] == 3:
            pcd.colors = o3d.utility.Vector3dVector(colors)
    return pcd


# ---------------------------------------------------------------------------
# Reconstruction de surface (Poisson) avec transfert des couleurs
# ---------------------------------------------------------------------------


def transfer_colors_to_mesh(mesh: o3d.geometry.TriangleMesh, pcd: o3d.geometry.PointCloud) -> None:
    """
    Affecte aux sommets du mesh la couleur du point du nuage le plus proche (modifie mesh sur place).

    :param mesh: Maillage Open3D (sans vertex_colors ou à écraser)
    :param pcd: Nuage de points avec couleurs
    """
    if cKDTree is None:
        raise ImportError("scipy est requis pour le transfert de couleurs. Installer avec: pip install scipy")
    if not pcd.has_colors():
        return
    tree = cKDTree(np.asarray(pcd.points))
    _, idx = tree.query(np.asarray(mesh.vertices), k=1, workers=-1)
    mesh.vertex_colors = o3d.utility.Vector3dVector(np.asarray(pcd.colors)[idx])


def reconstruct_mesh_from_point_cloud(
    pcd: o3d.geometry.PointCloud,
    *,
    voxel_size: float = 0.01,
    down_sample_threshold: int = 500_000,
    poisson_depth: int = 9,
    density_quantile: float = 0.01,
    orient_normals_k: int = 100,
) -> o3d.geometry.TriangleMesh:
    """
    Reconstruit un maillage par algorithme de Poisson à partir du nuage de points.
    Sous-échantillonne si trop de points, estime les normales, retire les artefacts de faible densité,
    puis transfère les couleurs du nuage vers les sommets du mesh.

    :param pcd: Nuage de points Open3D (avec ou sans couleurs)
    :param voxel_size: Taille de voxel pour le sous-échantillonnage (m)
    :param down_sample_threshold: Seuil au-delà duquel on sous-échantillonne
    :param poisson_depth: Profondeur de l’octree Poisson (qualité vs vitesse)
    :param density_quantile: Quantile de densité en dessous duquel on supprime les sommets
    :param orient_normals_k: Nombre de voisins pour l’orientation des normales
    :return: TriangleMesh avec vertex_colors si pcd avait des couleurs
    """
    n_points = len(pcd.points)
    if n_points > down_sample_threshold:
        pcd_work = pcd.voxel_down_sample(voxel_size)
        print(f"Sous-échantillonné: {n_points} -> {len(pcd_work.points)} points")
    else:
        pcd_work = pcd

    pcd_work.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamKNN())
    pcd_work.orient_normals_consistent_tangent_plane(orient_normals_k)
    normals = np.asarray(pcd_work.normals)
    pcd_work.normals = o3d.utility.Vector3dVector(-normals)

    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd_work, depth=poisson_depth
    )
    densities = np.asarray(densities)
    q = np.quantile(densities, density_quantile)
    mesh.remove_vertices_by_mask(densities < q)

    transfer_colors_to_mesh(mesh, pcd_work)
    print(f"Mesh: {len(mesh.vertices)} vertices, {len(mesh.triangles)} triangles")
    return mesh


# ---------------------------------------------------------------------------
# Export et visualisation
# ---------------------------------------------------------------------------


def save_mesh(mesh: o3d.geometry.TriangleMesh, path_out: str | Path) -> bool:
    """
    Enregistre le maillage au format PLY (conserve les couleurs vertex).

    :param mesh: Maillage Open3D
    :param path_out: Fichier de sortie (.ply)
    :return: True si l’écriture a réussi
    """
    return o3d.io.write_triangle_mesh(str(Path(path_out).resolve()), mesh)


def run_pipeline(
    path_e57: str | Path,
    path_out: str | Path | None = None,
    *,
    voxel_size: float = 0.01,
    poisson_depth: int = 9,
    density_quantile: float = 0.01,
    visualize: bool = True,
) -> o3d.geometry.TriangleMesh:
    """
    Chaîne complète : E57 → PointCloud → Mesh Poisson coloré → export optionnel → visu optionnelle.

    :param path_e57: Fichier E57 en entrée
    :param path_out: Fichier PLY de sortie (optionnel)
    :param voxel_size: Taille de voxel pour sous-échantillonnage
    :param poisson_depth: Profondeur Poisson
    :param density_quantile: Quantile pour suppression des artefacts
    :param visualize: Afficher le maillage dans une fenêtre Open3D
    :return: Le maillage construit
    """
    pcd = e57_to_open3d_point_cloud(path_e57)
    mesh = reconstruct_mesh_from_point_cloud(
        pcd,
        voxel_size=voxel_size,
        poisson_depth=poisson_depth,
        density_quantile=density_quantile,
    )
    if path_out:
        save_mesh(mesh, path_out)
        print(f"Maillage enregistré: {path_out}")
    if visualize:
        o3d.visualization.draw_geometries([mesh], window_name="Surface Poisson colorée")
    return mesh


# ---------------------------------------------------------------------------
# CLI standalone
# ---------------------------------------------------------------------------


def parse_args() -> argparse.Namespace:
    """Parse les arguments en ligne de commande pour une exécution standalone."""
    parser = argparse.ArgumentParser(
        description="E57 → maillage Poisson coloré (Open3D)",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("input", type=Path, help="Fichier E57 en entrée")
    parser.add_argument("-o", "--output", type=Path, default=None, help="Fichier PLY en sortie")
    parser.add_argument(
        "--no-visualize",
        action="store_true",
        help="Ne pas ouvrir la fenêtre de visualisation",
    )
    parser.add_argument("--voxel-size", type=float, default=0.01, help="Taille de voxel (m)")
    parser.add_argument("--poisson-depth", type=int, default=9, help="Profondeur octree Poisson")
    parser.add_argument(
        "--density-quantile",
        type=float,
        default=0.01,
        help="Quantile de densité pour retrait des artefacts",
    )
    return parser.parse_args()


def main() -> int:
    """Point d’entrée CLI : exécute le pipeline et retourne le code de sortie."""
    args = parse_args()
    if not args.input.is_file():
        print(f"Erreur: fichier introuvable {args.input}", file=sys.stderr)
        return 1
    out = args.output
    if out is None:
        out = args.input.with_suffix(".ply")
    try:
        run_pipeline(
            args.input,
            path_out=out,
            voxel_size=args.voxel_size,
            poisson_depth=args.poisson_depth,
            density_quantile=args.density_quantile,
            visualize=not args.no_visualize,
        )
    except ImportError as e:
        print(f"Erreur dépendance: {e}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"Erreur: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
