# Carte du workspace `open3d_vision`

Dernière mise à jour : mai 2026.

Ce document sert de **table des matières** pour le dossier `C:\Users\mvm\open3d_vision`. Les chemins sont relatifs à cette racine sauf mention contraire.

### Changements récents (organisation)

- Dossier **`projet_api_navvis/`** (anciennement `projet API NavVis/`) : nom sans espaces pour les outils en ligne de commande.
- **`archives/`** : regroupe les ZIP lourds (`src.zip`, `map-anything-main.zip`) précédemment à la racine.
- **`data/etl_project_data/`** : *junction* Windows vers `data/ETL project data/` (mêmes fichiers, chemin alternatif sans espace).

---

## Démarrage rapide

| Besoin | Où aller |
|--------|----------|
| Environnement Python commun | [setup_venv.md](../setup_venv.md), [requirements.txt](../requirements.txt) |
| Démo nuage Open3D minimal | [README.md](../README.md) — `python -m src.main` |
| Scripts / notebooks expérimentaux | [src/DOCUMENTATION.md](../src/DOCUMENTATION.md) |
| Pipeline webcam → mesh | [CV_3D/README.md](../CV_3D/README.md) |
| API E57 → DXF (local) | [e57_dxf_web/README.md](../e57_dxf_web/README.md) |
| Viewer 360 + annotations | [projet_api_navvis/README.md](../projet_api_navvis/README.md) |

---

## Arborescence logique

### Applications et packages Python

| Dossier | Description |
|---------|-------------|
| **`src/`** | Package Python minimal (`main.py`, `io_utils.py`, `visualization.py`), notebooks Jupyter, outils E57/DWG, pipelines Geolux/SECO. Détail : [src/DOCUMENTATION.md](../src/DOCUMENTATION.md). |
| **`CV_3D/`** | Projet packagé (`pyproject.toml`) : webcam, segmentation, maillage Open3D. |
| **`e57_dxf_web/`** | Application FastAPI/uvicorn : conversion E57 → DXF avec prévisualisations. Lancer depuis la racine du workspace. |
| **`projet_api_navvis/`** | Application Flask : viewer panoramas 360, annotations XYZ, sans API NavVis. |
| **`examples/`** | Exemple `basic_usage.py` pour un nuage synthétique (importe `src` depuis la racine). |

### Données et sorties

| Dossier | Description |
|---------|-------------|
| **`data/`** | Jeux de données, exports ETL SECO, tests nuages, images. Le sous-dossier `ETL project data/` contient notamment SECO (poses, chunks, CSV). **Alias sans espace :** `data/etl_project_data/` → junction vers `ETL project data/` (navigation en ligne de commande). |
| **`data/cracks_dataset/`** | Données fissures / dommages structuraux (entraînement). |
| **`data/processed/`** | Artefacts intermédiaires (npz, figures, etc.). |
| **`models/`** | Poids et sorties d’entraînement (ex. segmentation dommages). |
| **`output/`** | Sorties diverses de pipelines. |

### Outils externes et forks (ne pas confondre avec le cœur `src/`)

| Dossier | Description |
|---------|-------------|
| **`external/`** | Dépôt cloné (ex. reconnaissance de texte). |
| **`ml-depth-pro/`** | Projet profondeur monoculaire (voir son README). |
| **`map-anything/`** | Clone / fork du dépôt MapAnything (reconstruction dense). |
| **`map-anything-main/`** | Archive extraite imbriquée (souvent une copie du dépôt officiel) ; préférer **`map-anything/`** pour le travail actif si les deux coexistent. |
| **`LibreCAD/`** | Ressources ou build LibreCAD liées au flux CAO. |
| **`VisFusion-main/`** (sous `data/`) | Démo ou sources fusion vision. |

### CAO / conversion

| Dossier | Description |
|---------|-------------|
| **`DDC_Converter_DWG/`** | Chaînes liées à la conversion DWG (workflows n8n, etc.). |
| **`src/e57-split-basic/`** | Découpe E57 en chunks + manifest pour viewer ETL 360 (voir `src/DOCUMENTATION.md`). |

### Archives volumineuses

| Dossier | Description |
|---------|-------------|
| **`archives/`** | Sauvegardes ZIP lourdes (`src.zip`, `map-anything-main.zip`, …) — **hors runtime** ; déplacer ou supprimer selon l’espace disque. |

### Configuration IDE

| Dossier | Description |
|---------|-------------|
| **`.vscode/`** | Paramètres workspace VS Code / Cursor. |

### Environnement virtuel

| Dossier | Description |
|---------|-------------|
| **`.venv/`** | Environnement Python local (non documenté fichier par fichier). Outil embarqué : `dxf_naming_tool` (lancé via [run_dxf_naming_tool.py](../run_dxf_naming_tool.py)). |

---

## Fichiers à la racine utiles

| Fichier | Rôle |
|---------|------|
| `requirements.txt` / `requirements-e57.txt` | Dépendances pip. |
| `check_env.py` | Vérification rapide CUDA / jeu de données fissures (chemins par défaut vers `data/cracks_dataset/`). |
| `run_dxf_naming_tool.py` | Lance l’outil de renommage de calques DXF (module sous `.venv/dxf_naming_tool/`). |

---

## Conventions et pièges

1. **Espaces dans les noms de dossiers** : `data/ETL project data/` et `data/photos sel/` existent déjà dans l’historique des notebooks. Utiliser `data/etl_project_data/` quand l’alias junction est présent, ou des guillemets en PowerShell.
2. **Chemins absolus** : plusieurs notebooks contiennent encore `C:\Users\mvm\open3d_vision\...`. Préférer progressivement `Path(__file__).resolve().parents[...]` pour la portabilité.
3. **Lancement des serveurs** : `e57_dxf_web` et les exemples uvicorn supposent souvent le **répertoire courant = racine** `open3d_vision` pour les imports.

---

## Liens vers la doc interne supplémentaire

- [src/layer_classification/README.md](../src/layer_classification/README.md) — ordre des notebooks classification de calques DWG.
- [src/input_images/README.md](../src/input_images/README.md)
- [data/cracks_dataset/README.md](../data/cracks_dataset/README.md)
- [ml-depth-pro/DEPTH_PRO_VENV_USAGE.md](../ml-depth-pro/DEPTH_PRO_VENV_USAGE.md)
