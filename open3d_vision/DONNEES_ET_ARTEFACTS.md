# Données et artefacts non poussés sur Git

Le dossier `open3d_vision/` dans ce dépôt est une **copie allégée** du workspace local. La synchronisation a exclu :

- **Répertoires entiers** : `data/`, `.venv/`, `archives/`, `models/`, `output/`, `ml-depth-pro/`, `map-anything/`, `map-anything-main/`, `LibreCAD/`, `DDC_Converter_DWG/`.
- **Fichiers de plus de 10 Mo** (ex. gros CSV, NPY, nuages PLY/PCD, notebooks avec sorties volumineuses) restés sur la machine source.

Le fichier `.gitignore` à la racine du dépôt interdit en outre certains types d’artefacts sous `open3d_vision/src/` (`.npy`, `.ply`, `.pcd`, `inference_outputs/`) pour limiter les commits accidentels.

Pour retrouver un environnement complet : recopier `data/` et les dossiers optionnels depuis votre poste, ou suivre les instructions des README dans chaque sous-projet (`docs/NAVIGATION.md`).
