"""
Helpers pour la visualisation de nuages de points et géométries 3D.
"""
import open3d as o3d


def draw_geometries(geometries, window_name="Open3D", width=1024, height=768):
    """
    Affiche une ou plusieurs géométries (nuage de points, maillage, etc.).

    Args:
        geometries: Liste de géométries Open3D ou une seule géométrie.
        window_name: Titre de la fenêtre.
        width: Largeur de la fenêtre.
        height: Hauteur de la fenêtre.
    """
    if not isinstance(geometries, list):
        geometries = [geometries]
    o3d.visualization.draw_geometries(
        geometries, window_name=window_name, width=width, height=height
    )


def draw_point_cloud_with_normals(pcd, point_size=2.0):
    """
    Affiche un nuage de points avec ses normales (les calcule si absentes).

    Args:
        pcd: PointCloud Open3D.
        point_size: Taille des points à l'écran.
    """
    if not pcd.has_normals():
        pcd.estimate_normals()
    vis = o3d.visualization.Visualizer()
    vis.create_window(window_name="Nuage de points + normales")
    vis.add_geometry(pcd)
    opt = vis.get_render_option()
    opt.point_size = point_size
    vis.run()
    vis.destroy_window()
