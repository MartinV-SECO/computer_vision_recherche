# Viewer Web 360 avec annotations XYZ

Ce projet remplace totalement l'ancien client API NavVis par une application locale de visualisation 360.

## Objectif

- Input: dossier local des panoramas (par défaut : `data/ETL project data/Photos panos/` sous la racine `open3d_vision`, ou `data/etl_project_data/Photos panos/` via le lien logique sans espace)
- Source metadata: `pano-poses-registered.csv`
- Images: `*.jpg` references par la colonne `filename`
- Output: viewer web type Street View avec creation d'annotations XYZ

## Architecture

- `backend/app.py`: API Flask + service des images + service du frontend
- `backend/pano_loader.py`: parsing CSV des panoramas/poses
- `backend/annotations_store.py`: CRUD annotations + persistance `pastilles.json` (migration auto depuis `annotations.json` si besoin)
- `frontend/index.html`: UI principale
- `frontend/main.js`: moteur viewer 360 (Three.js) + appels API
- `frontend/styles.css`: styles

## Librairies utilisees et fonctionnement

### Backend (Python)

- `Flask`
  - Role: expose les endpoints HTTP (`/api/panos`, `/api/annotations`, `/images/...`) et sert le frontend.
  - Fonctionnement: routes synchrones simples, retour JSON via `jsonify`, envoi des fichiers image via `send_from_directory`.
  - Pourquoi: leger, rapide a mettre en place pour une API locale.

- `csv` (stdlib)
  - Role: parser le fichier `pano-poses-registered.csv` delimite par `;`.
  - Fonctionnement: lecture ligne par ligne, ignore la ligne commentaire `#`, conversion typage numerique.
  - Pourquoi: robuste et sans dependance externe.

- `json` (stdlib)
  - Role: stocker les pastilles (annotations) dans `pastilles.json` a la racine du projet.
  - Fonctionnement: lecture complete, modification, ecriture atomique via fichier temporaire puis remplacement.
  - Pourquoi: format lisible, compatible front/backend.

- `pathlib` (stdlib)
  - Role: gerer les chemins Windows de facon fiable.
  - Fonctionnement: composition des chemins de donnees, projet et stockage annotations.
  - Pourquoi: API claire, portable.

- `threading` (stdlib)
  - Role: eviter les collisions d'ecriture du fichier d'annotations.
  - Fonctionnement: verrou autour des operations de lecture/ecriture.
  - Pourquoi: securise la persistance en usage local multi-requetes.

### Frontend (Web)

- `Three.js` (CDN)
  - Role: rendu 3D du panorama equirectangulaire.
  - Fonctionnement:
    - creation d'une sphere 3D retournee (camera placee a l'interieur),
    - application de la texture panorama JPG,
    - navigation souris (drag), zoom molette, projection yaw/pitch.
  - Pourquoi: controle fin de l'interaction 360 et des points d'annotation sans lock-in a un viewer opaque.

- DOM + Fetch API (natif navigateur)
  - Role: interface formulaire/listes et communication HTTP avec le backend.
  - Fonctionnement: appels REST (`GET/POST/PUT/DELETE`) et rafraichissement dynamique des marqueurs.
  - Pourquoi: aucune dependance build, execution immediate.

## API exposee

- `GET /api/health`: verification de configuration
- `GET /api/panos`: liste des panoramas parses depuis CSV
- `GET /api/annotations?panoId=<id>`: annotations d'un pano
- `POST /api/annotations`: creation d'une annotation
- `PUT /api/annotations/<id>`: modification
- `DELETE /api/annotations/<id>`: suppression
- `GET /images/<filename>`: fichier image panorama

## Format annotation

```json
{
  "id": "uuid",
  "panoId": 12,
  "label": "porte technique",
  "xyz": { "x": 77501.2, "y": 74349.1, "z": 305.4 },
  "yawPitch": { "yaw": 0.82, "pitch": -0.06 },
  "createdAt": "2026-03-30T08:00:00+00:00",
  "updatedAt": "2026-03-30T08:00:00+00:00"
}
```

## Installation

Depuis `C:\Users\mvm\open3d_vision\projet_api_navvis` :

```bash
python -m pip install -r requirements.txt
```

## Lancement

```bash
python auth.py
```

Puis ouvrir:

- [http://127.0.0.1:8000](http://127.0.0.1:8000)

## Utilisation

1. Selectionner un panorama dans la liste.
2. Cliquer dans le viewer pour pre-remplir `yaw/pitch` (ou utiliser "Capturer orientation courante").
3. Entrer `label` et coordonnees `X/Y/Z`.
4. Enregistrer l'annotation.
5. Reviser, viser, editer ou supprimer depuis la liste.

## Notes importantes

- Si aucune image n'apparait, verifier que les JPG references par `filename` existent bien dans le dossier panoramas (voir `DEFAULT_DATA_DIR` dans `backend/app.py`, résolu depuis la racine du workspace).
- Le projet n'utilise plus l'API NavVis IVION ni token JWT.
