# -*- coding: utf-8 -*-
"""Génère depth_field_V3_2d.ipynb et depth_field_V3_3d.ipynb à partir de depth_field_V3_test.ipynb."""
import copy
import json
import uuid
from pathlib import Path

SRC = Path(__file__).resolve().parent / "depth_field_V3_test.ipynb"
OUT_2D = Path(__file__).resolve().parent / "depth_field_V3_2d.ipynb"
OUT_3D = Path(__file__).resolve().parent / "depth_field_V3_3d.ipynb"


def new_id():
    return uuid.uuid4().hex[:12]


def nb_source_lines(text: str) -> list:
    """Format Jupyter : liste de chaînes se terminant par \\n."""
    if not text.endswith("\n"):
        text += "\n"
    return [line + "\n" for line in text.splitlines()]


def strip_outputs(cell):
    c = copy.deepcopy(cell)
    c["execution_count"] = None
    if c.get("cell_type") == "code":
        c["outputs"] = []
    return c


def main():
    nb = json.loads(SRC.read_text(encoding="utf-8"))
    cells = nb["cells"]

    # Si une cellule « note découpée » a été ajoutée en tête du monolithe, décaler les indices
    head = "".join(cells[0].get("source", [])) if cells else ""
    off = 1 if "depth_field_V3_2d.ipynb" in head and "découp" in head else 0

    # --- 2D: sans la cellule note (off=1 → indices 1..27 puis 32,33) ; figures 31,32 → +off
    idx_2d = list(range(off, 27 + off)) + [31 + off, 32 + off]
    cells_2d = [strip_outputs(cells[i]) for i in idx_2d]

    # Structure markdown (cell 1 -> index 1 dans la liste)
    cells_2d[1]["source"] = [
        "## Pipeline 2D — masques, textures, profondeur\n",
        "\n",
        "1. **Masques** — Segmentation SLIC / variance, rognage `pad`, alignement sur la grille profondeur, `mask_combined`.\n",
        "2. **Profondeur** — Depth Pro, normalisation, inversion, `depth_1` / `depth_2`, recalage `depth_2_aligned`.\n",
        "3. **Analyse 2D** — Similarité RGB (ΔE), statistiques sur zone commune, visualisations matplotlib.\n",
        "4. **Export** — Dernière cellule : écrit `data/processed/depth_field_v3_bundle.npz` pour le notebook **3D**.\n",
        "\n",
        "La suite Open3D (nuages, mesh, volume) est dans `depth_field_V3_3d.ipynb`.\n",
    ]

    # Retirer open3d de la cellule imports (index 2)
    cells_2d[2]["source"] = [
        ln for ln in cells_2d[2]["source"] if ln.strip() != "import open3d as o3d"
    ]

    export_source = """# Export pour depth_field_V3_3d.ipynb (nuages, mesh, volume)
from pathlib import Path
import numpy as np
from PIL import Image

EXPORT_DIR = Path("C:/Users/mvm/open3d_vision/data/processed")
EXPORT_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_PATH = EXPORT_DIR / "depth_field_v3_bundle.npz"

h_d, w_d = depth_1.shape
rgb1 = np.asarray(image_cropped_1)
if rgb1.dtype != np.uint8:
    rgb1 = (np.clip(rgb1, 0, 1) * 255).astype(np.uint8)
if rgb1.shape[0] != h_d or rgb1.shape[1] != w_d:
    rgb1 = np.asarray(
        Image.fromarray(rgb1).resize((w_d, h_d), Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )
rgb2 = np.asarray(image_cropped_2)
if rgb2.dtype != np.uint8:
    rgb2 = (np.clip(rgb2, 0, 1) * 255).astype(np.uint8)
if rgb2.shape[0] != h_d or rgb2.shape[1] != w_d:
    rgb2 = np.asarray(
        Image.fromarray(rgb2).resize((w_d, h_d), Image.Resampling.LANCZOS),
        dtype=np.uint8,
    )

depth_2_a = np.asarray(depth_2_aligned, dtype=np.float64)
if depth_2_a.shape != (h_d, w_d):
    import cv2
    depth_2_a = cv2.resize(
        depth_2_a.astype(np.float32), (w_d, h_d), interpolation=cv2.INTER_LINEAR
    ).astype(np.float64)

np.savez_compressed(
    EXPORT_PATH,
    depth_1=np.asarray(depth_1, dtype=np.float64),
    depth_2_aligned=depth_2_a,
    mask_combined=np.asarray(mask_combined, dtype=np.uint8),
    rgb1=rgb1,
    rgb2=rgb2,
    pad=np.int32(pad),
)
print(f"Export OK : {EXPORT_PATH}")
print(f"  depth {h_d}x{w_d}, pad={pad}")
"""

    cells_2d.append(
        {
            "cell_type": "code",
            "id": new_id(),
            "metadata": {},
            "outputs": [],
            "source": nb_source_lines(export_source),
        }
    )

    nb_2d = copy.deepcopy(nb)
    nb_2d["cells"] = cells_2d
    nb_2d["metadata"]["kernelspec"] = nb.get("metadata", {}).get("kernelspec", {})
    OUT_2D.write_text(json.dumps(nb_2d, ensure_ascii=False, indent=1), encoding="utf-8")

    # --- 3D: chargement + cellules 27-30, 33-45 (décalées si note en tête)
    idx_3d = list(range(27 + off, 31 + off)) + list(range(33 + off, 46 + off))
    cells_3d_body = [strip_outputs(cells[i]) for i in idx_3d]

    intro_md = {
        "cell_type": "markdown",
        "id": new_id(),
        "metadata": {},
        "source": [
            "# Pipeline 3D — nuages de points, mesh, volume\n",
            "\n",
            "**Prérequis :** exécuter `depth_field_V3_2d.ipynb` jusqu’à la fin pour générer le fichier :\n",
            "\n",
            "`data/processed/depth_field_v3_bundle.npz`\n",
            "\n",
            "Ce notebook charge ce bundle (profondeurs + masque + RGB rognés) puis enchaîne les visualisations Open3D et le calcul de volume approché.\n",
        ],
    }

    load_code = """# Chargement du bundle produit par depth_field_V3_2d.ipynb
from pathlib import Path
import numpy as np
from PIL import Image
import open3d as o3d

EXPORT_PATH = Path("C:/Users/mvm/open3d_vision/data/processed") / "depth_field_v3_bundle.npz"
if not EXPORT_PATH.is_file():
    raise FileNotFoundError(
        "Fichier introuvable : exécuter d'abord depth_field_V3_2d.ipynb (cellule d'export).\\n"
        f"Attendu : {EXPORT_PATH}"
    )

z = np.load(EXPORT_PATH)
depth_1 = z["depth_1"].astype(np.float64)
depth_2_aligned = z["depth_2_aligned"].astype(np.float64)
mask_combined = z["mask_combined"].astype(np.uint8)
rgb1 = z["rgb1"].astype(np.uint8)
rgb2 = z["rgb2"].astype(np.uint8)
pad = int(z["pad"])

image_cropped_1 = Image.fromarray(rgb1)
image_cropped_2 = Image.fromarray(rgb2)

h_d1, w_d1 = depth_1.shape
depth_2_aligned = np.asarray(depth_2_aligned, dtype=np.float64)
if depth_2_aligned.shape != (h_d1, w_d1):
    import cv2
    depth_2_aligned = cv2.resize(
        depth_2_aligned.astype(np.float32), (w_d1, h_d1), interpolation=cv2.INTER_LINEAR
    ).astype(np.float64)

depth_1_masked = np.where(mask_combined == 255, depth_1, np.nan)
depth_2_masked = np.where(mask_combined == 255, depth_2_aligned, np.nan)

print(f"Chargé : {EXPORT_PATH} — depth {h_d1}x{w_d1}, pad={pad}")
"""

    load_cell = {
        "cell_type": "code",
        "id": new_id(),
        "metadata": {},
        "outputs": [],
        "source": nb_source_lines(load_code),
    }

    # Adapter le premier markdown du bloc 3D (ancien "Etape 4 preparation")
    if cells_3d_body and cells_3d_body[0].get("cell_type") == "markdown":
        cells_3d_body[0]["source"] = [
            "### Étapes 3D (Open3D)\n",
            "\n",
            "Les variables `depth_1_masked`, `depth_2_masked`, `image_cropped_1/2`, `mask_combined` viennent du chargement ci-dessus.\n",
            "\n",
            "Pour l’image 2, la profondeur utilisée est **`depth_2_aligned`** (déjà dans le bundle), masquée par `mask_combined`.\n",
        ]

    nb_3d = copy.deepcopy(nb)
    nb_3d["cells"] = [intro_md, load_cell] + cells_3d_body
    nb_3d["metadata"]["kernelspec"] = nb.get("metadata", {}).get("kernelspec", {})
    OUT_3D.write_text(json.dumps(nb_3d, ensure_ascii=False, indent=1), encoding="utf-8")

    print("Écrit :", OUT_2D)
    print("Écrit :", OUT_3D)


if __name__ == "__main__":
    main()
