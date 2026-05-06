# E57 → DXF (web)

Ce module fait partie du workspace décrit dans [docs/NAVIGATION.md](../docs/NAVIGATION.md).

Conversion locale **E57 → DXF** avec tranche Z, downsampling voxel, **alpha-shape** et/ou **RANSAC** (droites). L’interface affiche une **barre de progression** pendant la conversion et des **aperçus PNG** (vue XY) des méthodes utilisées.

## Installation

```bash
cd open3d_vision
python -m venv .venv_e57
.venv_e57\Scripts\activate   # Windows
pip install -r e57_dxf_web/requirements.txt
```

## Lancer le serveur

Depuis le dossier **`open3d_vision`** (pour que le package `e57_dxf_web` soit importable) :

```bash
uvicorn e57_dxf_web.app.main:app --reload --host 127.0.0.1 --port 8000
```

Ouvrir <http://127.0.0.1:8000>.

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Interface HTML |
| POST | `/api/z-range` | Fichier `.e57` → `{ z_min, z_max }` (échantillon max 50k pts) |
| POST | `/api/convert` | Fichier + paramètres → téléchargement DXF (synchrone, sans progression) |
| POST | `/api/convert/start` | Même formulaire → `{ job_id }` (traitement en arrière-plan) |
| GET | `/api/convert/progress/{job_id}` | `{ status, progress, message, error }` |
| GET | `/api/convert/previews/{job_id}` | JSON : `tranche` (nuage XY après filtre Z), puis `alphashape` / `ransac` / `combined` |
| GET | `/api/convert/result/{job_id}` | Fichier DXF une fois `status === done` |

## Limites

- Fichiers E57 très volumineux : chargement complet en mémoire pour la conversion complète.
- `/api/z-range` utilise un sous-échantillon pour estimer l’étendue en Z.

## Test automatique (sans fichier E57)

```bash
python e57_dxf_web/scripts/validate_pipeline.py
```
