# computer_vision_recherche

Dépôt de recherche et prototypes autour de la **vision par ordinateur**, du **nuage de points**, des formats **E57 / DXF / DWG** et d’interfaces **360 / ETL**.

## Organisation

| Dossier | Contenu |
|---------|---------|
| **`src/`** | Travaux historiques (TypeScript, React, notebooks, utilitaires) — présent depuis l’origine du dépôt. |
| **`open3d_vision/`** | Copie allégée du workspace local `open3d_vision` : applications Python (`e57_dxf_web`, `projet_api_navvis`, `CV_3D`), package `src` Open3D, `docs/`, etc. **Sans** jeux de données volumineux ni dépendances lourdes (voir ci-dessous). |

La carte détaillée du sous-arbre `open3d_vision/` se trouve dans [open3d_vision/README.md](open3d_vision/README.md) et [open3d_vision/docs/NAVIGATION.md](open3d_vision/docs/NAVIGATION.md).

## Dépôt distant

[github.com/MartinV-SECO/computer_vision_recherche](https://github.com/MartinV-SECO/computer_vision_recherche)

## Ce qui n’est pas versionné (volontairement)

Les répertoires et fichiers lourds sont listés dans `.gitignore` à la racine (données `data/`, modèles, sorties, clones `ml-depth-pro` / `map-anything`, etc.). Pour retrouver un workspace complet en local, copier depuis votre machine les dossiers exclus ou les régénérer selon les README de chaque sous-projet.
