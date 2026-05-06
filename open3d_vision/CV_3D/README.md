# open3d_vision – CV_3D

Voir aussi la [carte du workspace](../docs/NAVIGATION.md).

Pipeline **Computer Vision + 3D** en Python :  
flux webcam → segmentation Otsu → formes géométriques → maillage 3D extrudé (Open3D).

---

## Structure

```
CV_3D/
├── pyproject.toml          # dépendances et script d'entrée
├── README.md
├── src/
│   ├── config.py           # tous les hyperparamètres
│   ├── capture.py          # acquisition webcam
│   ├── segmentation.py     # gris + Otsu + morphologie
│   ├── shapes.py           # contours + polygones + étiquettes
│   ├── mesh3d.py           # extrusion 2D→3D + Open3D
│   ├── pipeline.py         # boucle quasi temps réel
│   └── main.py             # CLI
└── tests/
    ├── test_segmentation.py
    └── test_mesh3d.py
```

---

## Installation

```bash
# Depuis le dossier CV_3D/
pip install -e ".[dev]"
```

Dépendances principales : `opencv-python`, `open3d`, `numpy`, `scipy`.

---

## Lancement

```bash
# Lancement avec paramètres par défaut (caméra 0, 640×480, 5 FPS)
python -m src.main

# Personnalisé
python -m src.main --camera 0 --fps 8 --depth 0.5 --min-area 2000

# Inversion masque (formes sombres sur fond clair)
python -m src.main --invert

# Avec export automatique des meshes .ply à chaque pression de 's'
python -m src.main --export-dir ./exports

# Sans fenêtre de debug OpenCV
python -m src.main --no-debug
```

### Options CLI complètes

| Option           | Défaut | Description                                     |
|------------------|--------|-------------------------------------------------|
| `--camera`       | 0      | Index caméra                                    |
| `--width`        | 640    | Largeur frame pixel                             |
| `--height`       | 480    | Hauteur frame pixel                             |
| `--downscale`    | 1.0    | Réduction résolution (0.5 = moitié)             |
| `--fps`          | 5.0    | Fréquence cible (3-10 recommandé)               |
| `--min-area`     | 1500   | Aire minimale d'un contour valide (px²)         |
| `--max-contours` | 8      | Nombre max de formes par frame                  |
| `--epsilon`      | 0.02   | Précision approxPolyDP (plus petit = plus fin)  |
| `--depth`        | 0.3    | Épaisseur d'extrusion 3D                        |
| `--invert`       | —      | Inverse le masque Otsu                          |
| `--no-debug`     | —      | Désactive la fenêtre AR overlay OpenCV          |
| `--ar-alpha`     | 0.35   | Opacité du remplissage AR (0.0 à 1.0)           |
| `--ar-extrusion` | 22     | Décalage px de la face haute (effet 3D oblique) |
| `--export-dir`   | None   | Répertoire pour export mesh .ply (touche 's')   |

---

## Deux fenêtres de visualisation

| Fenêtre                    | Contenu                                                                   |
|----------------------------|---------------------------------------------------------------------------|
| **AR overlay**             | Flux caméra live avec polygones remplis semi-transparents + arêtes d'extrusion oblique simulant la 3D |
| **Mesh 3D (persistant)**   | Visualiseur Open3D interactif — le mesh reste affiché même si aucune forme n'est détectée momentanément ; la caméra 3D ne se réinitialise jamais après le premier affichage |

## Contrôles en cours d'exécution

| Touche | Action                                  |
|--------|-----------------------------------------|
| `q`    | Quitter                                 |
| `s`    | Exporter le mesh courant en `.ply`      |

---

## Pipeline technique

```
WebcamFrame
  → GaussianBlur + Otsu + Morphologie
  → Contours externes + filtrage aire
  → approxPolyDP → Shape2D (triangle / quad / circle / polygon)
  → Extrusion 2D→3D (couche basse z=0, couche haute z=depth)
  → Triangulation (éventail face haut/bas, bande face latérale)
  → Open3D TriangleMesh fusionné
  → Visualiseur interactif Open3D
```

---

## Tests

```bash
pytest tests/ -v
```

Les tests utilisent des images synthétiques (formes blanches sur fond noir) :
aucune webcam n'est nécessaire.

---

## Limites connues

- **Pas de profondeur réelle** : la 3e dimension est une extrusion heuristique à hauteur fixe. La géométrie est une approximation.
- **Dépendance à l'éclairage** : Otsu fonctionne mieux avec un bon contraste fond/forme.
- **Flickering** : sans suivi temporel des formes, le mesh change à chaque frame.
- **Pas de GPU** : le pipeline tourne entièrement sur CPU.

---

## Réglage pour votre scène

| Situation                      | Réglage conseillé                             |
|--------------------------------|-----------------------------------------------|
| Formes sombres sur fond clair  | `--invert`                                    |
| Trop de bruit/faux contours    | augmenter `--min-area` (ex. 3000)             |
| Polygones trop grossiers       | diminuer `--epsilon` (ex. 0.01)               |
| Pipeline trop lent             | `--downscale 0.5` ou réduire `--max-contours` |
| Mesh trop plat                 | augmenter `--depth` (ex. 0.8)                 |
