# coding: utf-8
"""
Pipeline Vidéo → Scène 3D (TSDF).
Usage dans le notebook :
    from video_to_3d import run_pipeline
    mesh = run_pipeline("video.mp4", "output/")
    o3d.visualization.draw_geometries([mesh])
"""

from .application.video_to_scene import run_pipeline
from .data.depth_pro_adapter import make_depth_pro_fn

__all__ = ["run_pipeline", "make_depth_pro_fn"]
