# Workspace `open3d_vision`

Espace de travail local regroupant **vision 3D**, **nuages de points (Open3D)**, **fichiers E57/DXF/DWG**, **profondeur / stéréo**, **panoramas 360** et expérimentations ML (dommages structuraux, depth, MapAnything).

**Navigation détaillée :** voir [docs/NAVIGATION.md](docs/NAVIGATION.md) (carte des dossiers, pièges de chemins, liens vers chaque sous-projet).

---
## Pistes de développement:
Pour les calculs de volume (src/depth_field_V4_voxel_volume.ipynb), essayer d'obtenir de vraies cartes de profondeur à la place d'images générées par IA (remplacer depth_pro par un lidar/résultat de photogrammétrie). Garder le pipeline Voxel, la géométrie provoquera des erreurs régulièrement. 

automatisation dessin/modélisation:
- Réseau de neurones pour classifier les points des fichiers dwg/dxf (src/layer_classification/). Le target est actuellement de distinguer les points "réels" et les points "fictifs". Pour une modélisation 3D simple de l'objet ou un tracé plus propre du fichier.
- Création d'objet 3D à partir d'un fichier DXF (src/dxf_to_3d_from_layers.ipynb). Export PLY possible, il faut que le fichier DXF soit propre (aucun point "fictif").
- outil web pour passer d'une tranche de points (limites détectables automatiquement), downsampler le nuage de point et l'afficher en 2D (plan d'étage). Avec la tranche de point dessinée, possibilité de tracer les premières lignes pour un début de DXF. 2 algos disponibles, alpha shape/Delaunay, pour les grosse densité de points. Et RANSAC, avec le choix du nombre de ligne à placer à l'avancer dans le cadre d'un plus petit nuage de points.

Projet AR: premières briques sur CV_3D. Il faut maintenant superposer une maquette (géométrie) avec une position réelle. 



## Structure (résumé)

```
open3d_vision/
├── docs/                      # Index : NAVIGATION.md, README.md du dossier docs
├── src/                       # Package Open3D minimal + notebooks + outils (src/DOCUMENTATION.md)
├── CV_3D/                     # Pipeline webcam → segmentation → mesh Open3D (pyproject.toml)
├── e57_dxf_web/               # API / UI E57 → DXF (uvicorn depuis la racine)
├── projet_api_navvis/         # Viewer 360 Flask + annotations XYZ
├── examples/                  # basic_usage.py (nuage synthétique)
├── DDC_Converter_DWG/         # Conversion DWG, workflows n8n associés
├── data/                      # Données locales (volumineux ; voir détail ci-dessous)
├── models/                    # Poids / checkpoints (ex. segmentation dommages)
├── output/                    # Sorties diverses de pipelines
├── external/                  # Dépôts clonés (ex. reconnaissance de texte)
├── LibreCAD/                  # Ressources / binaire LibreCAD liés au flux CAO
├── ml-depth-pro/              # Profondeur monoculaire (projet autonome + README)
├── map-anything/              # Fork / clone MapAnything (reconstruction dense)
├── map-anything-main/         # Arborescence extraite (souvent doublon ; préférer map-anything/ si actif)
├── archives/                  # ZIP lourds de sauvegarde (src.zip, map-anything-main.zip, …)
├── .vscode/                   # Paramètres workspace VS Code / Cursor
├── .venv/                     # Environnement Python local (inclut p.ex. dxf_naming_tool)
├── check_env.py               # Smoke test CUDA / CSV cracks_dataset
├── run_dxf_naming_tool.py     # Lance l’outil DXF de renommage de calques (.venv/dxf_naming_tool)
├── requirements.txt           # Dépendances racine
├── requirements-e57.txt       # Dépendances dédiées chaîne E57
├── setup_venv.md              # Création / activation du venv
└── README.md                  # Ce fichier
```

**Détail `data/` (non exhaustif) :**

```
data/
├── etl_project_data/          # junction → « ETL project data » (même contenu, chemin sans espace)
├── ETL project data/          # SECO : poses, chunks nuages, CSV, panos…
├── cracks_dataset/            # Jeu fissures / dommages structuraux
├── processed/                 # NPZ, figures, exports intermédiaires
├── archive/                   # Archives données (distinct du dossier archives/ à la racine)
├── VisFusion-main/            # Sources / démo fusion vision
├── photos sel/                # Jeux d’images (nom historique avec espace)
├── e57decoupe/, e57_*_test/, zipped E57/   # Tests et paquets E57
└── …                          # rendus_state_of_the_art, autres exports
```

---

## Installation (racine)

```powershell
cd C:\Users\mvm\open3d_vision
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Détails : [setup_venv.md](setup_venv.md).

---

## Utilisation — package Open3D minimal (`src/`)

```powershell
python -m src.main                    # démo cône + sphère
python -m src.main data\mon_fichier.ply
python examples\basic_usage.py
```

Documentation étendue des scripts et notebooks : [src/DOCUMENTATION.md](src/DOCUMENTATION.md).

---

## Autres entrées courantes

| Projet | Commande / doc |
|--------|------------------|
| **CV_3D** | `cd CV_3D` puis `pip install -e ".[dev]"` et `python -m src.main` — [CV_3D/README.md](CV_3D/README.md) |
| **E57 → DXF web** | `uvicorn e57_dxf_web.app.main:app --reload` depuis la racine — [e57_dxf_web/README.md](e57_dxf_web/README.md) |
| **Viewer 360** | Depuis `projet_api_navvis/` — [projet_api_navvis/README.md](projet_api_navvis/README.md) |
| **Renommage calques DXF** | `python run_dxf_naming_tool.py` (racine) |

---

## Données ETL / SECO

Les exports volumineux sont sous `data/ETL project data/`. Un **répertoire junction** `data/etl_project_data/` peut pointer vers ce dossier pour éviter les espaces dans les chemins (voir [docs/NAVIGATION.md](docs/NAVIGATION.md)).

---

## Archives

Les fichiers `*.zip` très volumineux sont rangés sous **`archives/`** lorsqu’ils ne sont pas nécessaires à l’exécution quotidienne.
