# Fichiers et dossiers locaux absents du dépôt GitHub

Référence : synchronisation vers [computer_vision_recherche](https://github.com/MartinV-SECO/computer_vision_recherche) (`open3d_vision/` dans le dépôt).

**Règles appliquées :** exclusion **entière** de certains dossiers racine ; pour le reste du workspace, **aucun fichier de plus de 10 Mo** n’a été copié (`robocopy /MAX:10485760`).

Les tailles des **dossiers** sont des **totaux approximatifs** (récursion sur les fichiers). Les tailles des **fichiers** listés en section 2 sont arrondies en **Mo**.

---

## 1. Dossiers à la racine (`open3d_vision/`) non versionnés en entier

| Dossier | Taille approx. | Utilité dans les pipelines / le workspace |
|---------|----------------|-------------------------------------------|
| **`data/`** | ~95,5 Go | **Données métier et d’expérimentation** : ETL SECO (nuages chunkés, CSV de poses, panos), `cracks_dataset` (fissures / dommages structuraux), tests E57 / ZIP, images, exports `processed/`, etc. Alimente notebooks et apps (NavVis, inférence pano, entraînement). |
| **`.venv/`** | ~4,4 Go | **Environnement Python local** (paquets pip, wheels). Indispensable en local, inutile dans Git ; contient aussi des outils embarqués (ex. `dxf_naming_tool`). |
| **`archives/`** | ~0,8 Go | **Sauvegardes ZIP** (`src.zip`, `map-anything-main.zip`, …). Historique / backup, pas le runtime du code. |
| **`models/`** | ~87 Mo | **Poids et checkpoints** (ex. segmentation dommages, DenseNet). Produits par l’entraînement ; rechargeables depuis les notebooks qui sauvegardent ici. |
| **`output/`** | ~35 Mo | **Sorties génériques** de scripts ou notebooks (exports intermédiaires, rendus). Variable selon les runs. |
| **`ml-depth-pro/`** | ~2,3 Go | **Projet tiers** (profondeur monoculaire, démos lourdes). Chaîne de recherche autonome, non dupliquée dans le dépôt ; à recloner ou recopier en local si besoin. |
| **`map-anything/`** | ~10 Mo | **Dépôt / fork** reconstruction dense (code + petits assets). Développement et tests `test_map_anything.ipynb` ; dépendance lourde si entraînement complet. |
| **`map-anything-main/`** | ~10 Mo | **Copie extraite** (souvent redondante avec `map-anything/`). Même famille de pipeline recherche. |
| **`LibreCAD/`** | ~120 Mo | **Outil / ressources CAO** liées aux flux DXF/DWG. Binaire ou sources locales, pas le cœur des scripts Python versionnés. |
| **`DDC_Converter_DWG/`** | ~300 Mo | **Conversion DWG et workflows** (ex. n8n). Données et binaires lourds pour l’intégration documentaire, hors périmètre « code léger » du dépôt. |

---

## 2. Fichiers locaux > 10 Mo (hors dossiers ci-dessus) non copiés dans le dépôt

Ces chemins sont relatifs à `open3d_vision/`.

| Fichier | Taille approx. | Utilité dans le pipeline |
|---------|----------------|---------------------------|
| `src/layer_classification/outputs/raw_csv.npy` | ~9 625 Mo | **Matrice de features** exportée pour la classification de calques DWG (pipeline notebooks `layer_classification/`). Donnée intermédiaire volumineuse, régénérable depuis les CSV sources. |
| `src/layer_raw_and_target_full.csv` | ~3 550 Mo | **Export tabulaire complet** (entrées + cibles) pour l’apprentissage des calques Geolux / DWG. Fichier source « data lake » pour les notebooks de classification. |
| `src/geolux_client_raw.csv` | ~2 875 Mo | **Données brutes client Geolux** utilisées pour exploration, nettoyage et entraînement (chaîne DWG / métadonnées calques). |
| `src/dirt_pile.ply` | ~70 Mo | **Nuage de points** de test ou scène réelle pour Open3D (visualisation, mesh, tests d’algo). |
| `src/dirt_pile_points.pcd` | ~46 Mo | Même logique que le PLY : **jeu de points** pour prototypage nuage / ICP / segmentation. |
| `src/layer_classification/outputs/col_encoded_multihot.npy` | ~41 Mo | **Encodage multi-hot** des colonnes / labels pour le modèle Keras ; sortie intermédiaire du pipeline `layer_classification`. |
| `src/pcd_work.ply` | ~26 Mo | **Nuage de travail** (profondeur, scan, etc.) pour expérimentations ponctuelles Open3D. |
| `src/inference_outputs/det_00001-pano.png` | ~26 Mo | **Image de sortie d’inférence** (détection sur panorama 360, ex. notebook `coco_inference_360`). |
| `src/test_naVvis.ipynb` | ~26 Mo | **Notebook** avec sorties embarquées volumineuses (tests viewer / données pano). Le code utile peut être nettoyé ; la taille vient surtout des outputs. |
| `src/layer_classification/outputs/train_values.npy` | ~16 Mo | **Tenseurs / valeurs d’entraînement** matérialisées pour accélérer les runs ; dérivé du pipeline classification de calques. |
| `src/depth_bgra_pointcloud.ply` | ~15 Mo | **Nuage issu du pipeline profondeur** (BGRA → points 3D). Artefact de `depth_field_*` / vision 3D. |
| `src/67_grouped.dxf` | ~13 Mo | **Fichier CAO volumineux** pour tests de conversion, vectorisation ou outils DXF/DWG. |
| `src/poisson_mesh.ply` | ~12 Mo | **Maillage Poisson** (reconstruction surface à partir d’un nuage). Sortie typique des notebooks maillage Open3D. |
| `src/Structural_damage.ipynb` | ~11 Mo | **Notebook dommages structuraux** ; taille due aux graphes / sorties d’entraînement intégrées. Pipeline fissures / segmentation. |
| `src/rapportoa-pyinstaller-build/decoupe/decoupe.exe` | ~10 Mo | **Exécutable PyInstaller** pour la découpe E57 (outil autonome type clé USB, voir `e57-split-basic` / RAPPORTOA). |
| `src/rapportoa-pyinstaller-build/split_e57_chunks/split_e57_chunks.exe` | ~10 Mo | Idem : **binaire** de découpe E57 en chunks pour le viewer ETL 360. |

---

## 3. Fichier local volumineux hors logique « absent du dépôt »

| Fichier | Taille approx. | Remarque |
|---------|----------------|----------|
| `docs/LISTE_FICHIERS_NON_VERSIONNES.csv` | ~42 Mo | **Export tabulaire massif** (listing récursif type inventaire). Utile pour audit disque ; **pas** un artefact de pipeline vision. À ne pas versionner tel quel ; préférer ce document Markdown ou régénérer un export filtré si besoin. |

---

## 4. Synthèse pratique

- Tout ce qui est sous **`data/`** est la **colonne vertébrale des données** (SECO, fissures, panos, tests E57) : à garder en local ou sur stockage partagé, pas dans Git.
- Les **gros CSV/NPY** sous `src/` sont surtout liés au **pipeline classification de calques DWG / Geolux** et aux **exports intermédiaires ML**.
- Les **PLY/PCD** volumineux sont des **jeux de nuages** ou **résultats 3D** (profondeur, Poisson, scènes test).
- Les **`.exe`** sont des **livrables PyInstaller** pour la chaîne E57 / viewer, reproductibles depuis les scripts de build.

Pour une **liste exhaustive fichier par fichier** (centaines de milliers d’entrées sous `data/` et `.venv/`), il faut un script d’inventaire dédié ; ce document se concentre sur les **exclusions structurantes** et les **gros fichiers hors dossiers exclus**.
