#!/usr/bin/env python
"""
Script standalone pour afficher la scène 3D DXF dans une fenêtre OpenGL native.

Usage:
    python run_visualization.py                    # charge le PLY le plus récent (2emeetage.ply, etc.)
    python run_visualization.py chemin/vers.ply    # charge le fichier indiqué

Prérequis : exécuter d'abord le notebook jusqu'à la cellule d'export PLY.
"""
import sys
from pathlib import Path

import open3d as o3d


def main():
    # Chemin du fichier : argument CLI, ou PLY le plus récent dans le répertoire courant
    if len(sys.argv) > 1:
        ply_path = Path(sys.argv[1])
    else:
        script_dir = Path(__file__).resolve().parent
        candidates = [
            script_dir / "2emeetage.ply",
            script_dir / "copy_of_knot.ply",
            script_dir.parent / "2emeetage.ply",
            script_dir.parent / "copy_of_knot.ply",
        ]
        ply_path = next((p for p in candidates if p.exists()), None)
        if ply_path is None:
            # PLY le plus récemment modifié dans le répertoire du script
            plies = sorted(script_dir.glob("*.ply"), key=lambda p: p.stat().st_mtime, reverse=True)
            ply_path = plies[0] if plies else None

    if ply_path is None or not ply_path.exists():
        print("Fichier PLY non trouvé.")
        print("Exécutez d'abord le notebook jusqu'à la cellule d'export PLY.")
        print("Ou : python run_visualization.py <fichier.ply>")
        sys.exit(1)

    scene = o3d.io.read_triangle_mesh(str(ply_path))
    if not scene.has_triangle_normals() or len(scene.triangle_normals) == 0:
        scene.compute_vertex_normals()

    print(f"Affichage de {ply_path} ({len(scene.vertices)} sommets, {len(scene.triangles)} triangles)")
    o3d.visualization.draw([scene], title="Scène DXF")


if __name__ == "__main__":
    main()
