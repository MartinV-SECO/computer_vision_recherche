# Liste des fichiers locaux non versionnés sur GitHub

Généré le **2026-05-06 07:12 UTC**. Workspace : `C:\Users\mvm\open3d_vision`.

Ces éléments correspondent au contenu **absent** du dépôt [computer_vision_recherche](https://github.com/MartinV-SECO/computer_vision_recherche) (dossiers exclus + fichiers > 10 Mo hors ces dossiers). La junction `data/etl_project_data` n'est pas parcourue pour éviter les doublons avec `data/ETL project data`.

## Synthèse par racine logique
| Racine (1er segment) | Fichiers | Taille totale (Go) |
|------------------------|----------|---------------------|
| `data` | 134562 | 95.45 |
| `src` | 16 | 15.99 |
| `.venv` | 84134 | 4.35 |
| `ml-depth-pro` | 70 | 2.31 |
| `archives` | 3 | 0.81 |
| `DDC_Converter_DWG` | 273 | 0.30 |
| `LibreCAD` | 1461 | 0.12 |
| `models` | 1 | 0.09 |
| `output` | 106 | 0.03 |
| `map-anything` | 591 | 0.01 |
| `map-anything-main` | 570 | 0.01 |

**Total :** 221787 fichiers, **119.45 Go**.

## Liste exhaustive machine (CSV)
Toutes les lignes (chemin, taille, utilité) : fichier **`LISTE_FICHIERS_NON_VERSIONNES.csv`** dans ce même dossier (`docs/`). Séparateur `;`, encodage UTF-8.


## Regénérer ce rapport
Exécuter : `python docs/generate_liste_non_versionnes.py` (voir `generate_liste_non_versionnes.py`).

## Méthode
- Dossiers racine exclus en bloc : `data/`, `.venv/`, `archives/`, `models/`, `output/`, `map-anything/`, `map-anything-main/`, `ml-depth-pro/`, `LibreCAD/`, `DDC_Converter_DWG/`.
- Fichiers > 10 Mo ailleurs (ex. gros CSV/NPY sous `src/`) : inclus dans cette liste.
- Colonne *utilité* : **indicative** (déduite du chemin et des usages connus du workspace).
