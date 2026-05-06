# coding: utf-8
"""
Use-case : vidéo -> scène 3D (mesh Open3D).
Orchestre extraction, poses, depth et fusion TSDF.
"""

import pickle
from pathlib import Path
from typing import Callable, List, Optional

import numpy as np
import open3d as o3d

from ..data.pose_estimator import colmap_to_fragments, create_dummy_fragments, run_colmap
from ..data.tsdf_fusion import estimate_depth_batch, fuse_tsdf
from ..data.video_extractor import extract_frames


def run_pipeline(
    video_path: str | Path,
    output_dir: str | Path,
    *,
    frame_stride: int = 5,
    max_frames: Optional[int] = 200,
    image_size: tuple[int, int] = (640, 480),
    use_colmap: bool = True,
    depth_model_fn: Optional[Callable] = None,
    voxel_size: float = 0.04,
) -> o3d.geometry.TriangleMesh:
    """
    Pipeline complet : vidéo -> mesh Open3D.

    Args:
        video_path: Chemin vers la vidéo
        output_dir: Dossier de sortie (images/, poses/, depth/, mesh.ply)
        frame_stride: 1 frame toutes les N
        max_frames: Max de frames
        image_size: (W, H)
        use_colmap: Si True, lance COLMAP
        depth_model_fn: (image_path, K) -> depth array. Si None, depth placeholder
        voxel_size: Taille voxel TSDF (m)

    Returns:
        Mesh Open3D (TriangleMesh)
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    image_dir = output_dir / "images"
    colmap_dir = output_dir / "colmap"

    # 1. Extraction
    paths = extract_frames(
        video_path, image_dir, size=image_size, stride=frame_stride, max_frames=max_frames
    )
    if len(paths) < 3:
        raise ValueError(f"Pas assez de frames ({len(paths)}). Réduisez stride.")

    # 2. Poses
    if use_colmap:
        ok = run_colmap(image_dir, colmap_dir)
        if ok:
            sparse_path = colmap_dir / "sparse" / "0"
            if not sparse_path.exists():
                for d in colmap_dir.glob("sparse/*"):
                    if (d / "cameras.txt").exists():
                        sparse_path = d
                        break
            colmap_to_fragments(sparse_path, image_dir, output_dir)
        else:
            print("COLMAP échoué. Poses simulées (qualité 3D limitée).")
            create_dummy_fragments(output_dir, paths, image_size)
    else:
        print("Poses simulées (use_colmap=False). Pour une vraie reconstruction 3D, installez COLMAP.")
        create_dummy_fragments(output_dir, paths, image_size)

    # 3. Charger fragments
    with open(output_dir / "fragments.pkl", "rb") as f:
        metas = pickle.load(f)

    # 4. Pour chaque fragment : depth + TSDF
    meshes: List[o3d.geometry.TriangleMesh] = []
    for meta in metas:
        image_ids = meta["image_ids"]
        extrinsics = meta["extrinsics"]
        intrinsics = meta["intrinsics"]
        image_paths = [image_dir / f"{i:06d}.jpg" for i in image_ids]
        # Fallback si format 0.jpg
        for i, pid in enumerate(image_ids):
            p = image_dir / f"{pid:06d}.jpg"
            if not p.exists():
                p = image_dir / f"{pid}.jpg"
            image_paths[i] = p

        # 5. Depth
        depth_dir = output_dir / "depth"
        depth_paths = estimate_depth_batch(image_paths, intrinsics, depth_dir, depth_model_fn)

        # 6. TSDF
        mesh = fuse_tsdf(
            image_paths, depth_paths, intrinsics, extrinsics,
            voxel_size=voxel_size, depth_max=3.0,
        )
        meshes.append(mesh)

    # 7. Fusion des meshes (concatenation)
    if len(meshes) == 1:
        result = meshes[0]
    else:
        result = meshes[0]
        for m in meshes[1:]:
            result += m

    mesh_path = output_dir / "mesh.ply"
    o3d.io.write_triangle_mesh(str(mesh_path), result)
    return result
