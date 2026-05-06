# Documentation — `open3d_vision/src`

Ce répertoire regroupe des **expérimentations**, **notebooks**, **scripts Python** et des **outils autonomes** autour de la vision 3D, des nuages de points (Open3D), des formats CAO (DWG/DXF/DGN), de la stéréo / profondeur et de chaînes liées aux projets **Geolux / SECO**.

**Vue d’ensemble du workspace entier** (autres apps : `CV_3D`, `e57_dxf_web`, données SECO, dépôts tiers) : [docs/NAVIGATION.md](../docs/NAVIGATION.md).

Le package Python à la racine du workspace (`src/main.py`, `io_utils.py`, `visualization.py`, `__init__.py`) sert de **point d’entrée minimal** pour charger un nuage et l’afficher avec Open3D.

---

## Contenu migré depuis RAPPORTOA (avril 2026)

Ces éléments ont été **retirés du dépôt RAPPORTOA** et placés ici pour les isoler du code applicatif web.

### `e57-split-basic/`

Kit **hors navigateur** pour transformer un fichier **E57** en paquet consommable par le **ETL Viewer 360** (RAPPORTOA) :

- `split_e57_chunks.py` : lecture E57, sous-échantillonnage, export **chunks binaires** (`float32` XYZ), `manifest.json`, **ZIP** autonome.
- `run_split.ps1`, `Lancer_decoupe.bat`, `setup_venv.ps1`, `requirements.txt` : exécution sous Windows / venv Python.
- Dossiers `input/` et `output/` : consignes d’usage (dépôt du `.e57`, sorties générées).
- `PORTABLE.txt` : mode **clé USB** avec `decoupe.exe` + dossier `internal` (build PyInstaller sur poste de dev).

### `docs/etl_viewer360_core_guide_utilisation.synctex.gz`

Fichier auxiliaire **SyncTeX** (synchronisation source LaTeX ↔ PDF). Il accompagne une compilation PDF de documentation ; **il ne fait pas partie du runtime** de l’application. Conserver ce fichier uniquement si vous regénérez le PDF depuis les sources LaTeX correspondantes.

### `rapportoa-pyinstaller-build/`

Artefacts **PyInstaller** (fichiers `.toc`, `xref-*.html`, `warn-*.txt`) pour les cibles **`decoupe`** et **`split_e57_chunks`**. Utiles pour **diagnostiquer** ou **reproduire** un build d’exécutable ; **régénérables** depuis les scripts de build du projet d’origine. Ne pas confondre avec `node scripts/build-etl-viewer360-core.mjs` dans RAPPORTOA (autre chaîne de build).

---

## Sous-répertoires « métier » existants

| Dossier | Rôle (résumé) |
|--------|----------------|
| `layer_classification/` | Pipeline notebooks pour la **classification binaire des calques DWG** (données tabulaires, Keras). Voir le `README.md` interne pour l’ordre d’exécution des notebooks. |
| `vectorial_drawing_static/` | Ressources / statiques liées au **dessin vectoriel** (outils web ou exports). |
| `video_to_3d/` | Expérimentations **vidéo → 3D** (reconstruction, géométrie). |
| `input_images/` | Images d’entrée pour des pipelines (inférence, tests). |
| `inference_outputs/` | Sorties d’inférence (modèles, résultats intermédiaires). |
| `__pycache__/` | Cache bytecode Python (généré automatiquement, ignorable). |

---

## Fichiers à la racine de `src` (aperçu thématique)

Les nombreux fichiers à la racine relèvent surtout de **prototypes** et **notebooks Jupyter** ; la liste ci-dessous est **non exhaustive** mais indique les grands thèmes.

- **Open3D / nuages** : `e57_to_mesh.py`, nuages `.ply` / `.pcd`, notebooks d’exploration E57, maillages (Poisson, alpha shape), TSDF, etc.
- **DWG / DXF / DGN** : conversion (`dgn_to_dwg_oda.py`, `dxf to dwg.py`, …), notebooks « tool Geolux », classification de calques, vectorisation.
- **Profondeur / stéréo** : familles `depth_field_V*.ipynb`, `notebook_depth_field.ipynb`, images masquées, nuages issus de profondeur.
- **Détection / CNN** : `coco_inference_360.ipynb`, `Structural_damage*.ipynb`, tests segmentation / dommages.
- **Web / Fabric** : `fabricjs.js`, `vectorial_drawing_web.py` (outils de dessin côté client ou démo).
- **Données lourdes** : plusieurs `.csv`, `.ply`, `.obj`, modèles `.keras` — à traiter comme **jeux de données locaux** (ne pas versionner sur Git si trop volumineux).

---

## Démarrage rapide (package Open3D)

```bash
cd C:\Users\mvm\open3d_vision
python -m src.main                    # démo cône + sphère
python -m src.main chemin\fichier.ply # visualisation d’un nuage
```

Adapter l’environnement Python (dépendances Open3D, Jupyter, etc.) selon les notebooks utilisés.

---

## Liens avec RAPPORTOA

- Le **viewer web** ETL 360 charge soit un **ZIP** produit par `e57-split-basic/`, soit un **E57** direct dans le navigateur selon le flux choisi.
- Les chemins **absolus** vers ce dossier (`open3d_vision\src`) sont indépendants du clone Git RAPPORTOA ; mettre à jour toute documentation interne qui pointait encore vers `RAPPORTOA\e57-split-basic` ou `RAPPORTOA\scripts\build`.

---

*Document généré lors du déplacement des artefacts RAPPORTOA vers ce dépôt de travail. Mettre à jour ce fichier lorsque de nouveaux modules majeurs sont ajoutés sous `src`.* Carte du workspace : [docs/NAVIGATION.md](../docs/NAVIGATION.md).
