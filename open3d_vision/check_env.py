"""
Script utilitaire pour valider rapidement l'environnement ML autour du jeu
`data/cracks_dataset` (split validation).

À exécuter depuis la racine du workspace `open3d_vision`, avec un venv où
`pandas` et `torch` sont installés :

    python check_env.py

Le script lit `data/cracks_dataset/ready_for_training/val/val_labels.csv`,
affiche la taille du split, la disponibilité CUDA / nom GPU / VRAM, puis un
résumé des colonnes cibles (`has_damage`, `structure_class_id`). Utile avant
d'entraîner ou de reprendre les notebooks de dommages structuraux.
"""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

import pandas as pd
import torch

root = Path(__file__).resolve().parent / "data" / "cracks_dataset" / "ready_for_training" / "val"
df = pd.read_csv(root / "val_labels.csv")
print("Echantillons :", len(df))
print("CUDA          :", torch.cuda.is_available())
if torch.cuda.is_available():
    p = torch.cuda.get_device_properties(0)
    print("GPU           :", p.name)
    print("VRAM          :", p.total_memory // 1024**2, "MB")
print("has_damage    :", df["has_damage"].value_counts().to_dict())
print("Colonnes CSV  :", list(df.columns))
print("N par structure:", df["structure_class_id"].value_counts().sort_index().to_dict())
