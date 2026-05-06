"""
Wrapper pour exécuter VisFusion depuis un notebook ou un script Python.
Lance main.py du repo VisFusion via subprocess avec une configuration programmatique.
"""

import os
import subprocess
import sys
from pathlib import Path


def get_visfusion_root() -> Path:
    """Retourne le chemin racine du repo VisFusion."""
    return Path(__file__).resolve().parent.parent / "data" / "VisFusion-main"


def run_visfusion(
    scene: str = "scene0785_00",
    data_path: str | Path | None = None,
    checkpoint_path: str | Path | None = None,
    output_dir: str | Path | None = None,
    single_layer_mesh: bool = False,
    cfg_file: str = "config/test.yaml",
    **opts,
) -> subprocess.CompletedProcess:
    """
    Lance l'inférence VisFusion sur une scène ScanNet.

    Args:
        scene: Nom de la scène (ex: scene0785_00). None = toutes les scènes.
        data_path: Chemin vers les données ScanNet (contenant scans/, scans_test/, all_tsdf_9/).
        checkpoint_path: Chemin vers le checkpoint .ckpt.
        output_dir: Répertoire des checkpoints/logs (résultats dans results/).
        single_layer_mesh: Si True, sortie mesh single-layer (compatible TransformerFusion).
        cfg_file: Fichier de config YAML relatif à la racine VisFusion.
        **opts: Options additionnelles passées à main.py (ex: MODEL.PASS_LAYERS 1).

    Returns:
        subprocess.CompletedProcess: résultat de l'exécution.
    """
    root = get_visfusion_root()
    if not root.exists():
        raise FileNotFoundError(f"VisFusion non trouvé: {root}")

    # Chemins par défaut
    if data_path is None:
        data_path = root / "example_data" / "ScanNet"
    data_path = Path(data_path)

    if checkpoint_path is None:
        checkpoint_path = root / "pretrained" / "model_000049.ckpt"
    checkpoint_path = Path(checkpoint_path)

    if output_dir is None:
        output_dir = root / "checkpoints"
    output_dir = Path(output_dir)

    cfg_path = root / cfg_file
    if not cfg_path.exists():
        raise FileNotFoundError(f"Config non trouvée: {cfg_path}")

    cmd = [
        sys.executable,
        str(root / "main.py"),
        "--cfg", str(cfg_path),
        "TEST.PATH", str(data_path),
        "LOGDIR", str(output_dir),
        "LOADCKPT", str(checkpoint_path),
        "MODEL.SINGLE_LAYER_MESH", str(single_layer_mesh),
    ]
    if scene is not None:
        cmd.extend(["SCENE", str(scene)])

    for k, v in opts.items():
        cmd.extend([k, str(v)])

    return subprocess.run(
        cmd,
        cwd=str(root),
        capture_output=False,
        text=True,
    )


def run_visfusion_arkit(
    data_path: str | Path,
    checkpoint_path: str | Path | None = None,
    output_dir: str | Path | None = None,
    **opts,
) -> subprocess.CompletedProcess:
    """
    Lance VisFusion sur des données ARKit (via test_scene.py).

    Args:
        data_path: Chemin vers le dossier ARKit (format NeuralRecon).
        checkpoint_path: Chemin vers le checkpoint .ckpt.
        output_dir: Répertoire des checkpoints.
        **opts: Options additionnelles.

    Returns:
        subprocess.CompletedProcess.
    """
    root = get_visfusion_root()
    if not root.exists():
        raise FileNotFoundError(f"VisFusion non trouvé: {root}")

    data_path = Path(data_path)
    if checkpoint_path is None:
        checkpoint_path = root / "pretrained" / "model_000049.ckpt"
    checkpoint_path = Path(checkpoint_path)
    if output_dir is None:
        output_dir = root / "checkpoints"
    output_dir = Path(output_dir)

    cfg_path = root / "config" / "test_scene.yaml"
    cmd = [
        sys.executable,
        str(root / "test_scene.py"),
        "--cfg", str(cfg_path),
        "DATASET", "ARKit",
        "TEST.PATH", str(data_path),
        "LOGDIR", str(output_dir),
        "LOADCKPT", str(checkpoint_path),
    ]
    for k, v in opts.items():
        cmd.extend([k, str(v)])

    return subprocess.run(cmd, cwd=str(root), capture_output=False, text=True)
