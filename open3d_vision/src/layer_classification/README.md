# Classification des calques DWG

Notebooks modulaires pour la classification binaire des calques (tracer / ne pas tracer).

## Ordre d'exécution

1. **01_load_and_explore.ipynb** — Chargement du CSV, exploration, sauvegarde `raw_csv`
2. **02_utils_functions.ipynb** — Import des utilitaires, filtrage, échantillonnage, nettoyage, sauvegarde `echantillon_csv`
3. **03_filter_sample_clean.ipynb** — Charge `echantillon_csv`, extraction et binarisation de la cible
4. **04_augmentation_vectorization.ipynb** — Data augmentation (GloVe), TextVectorization multi-hot
5. **05_split_and_train.ipynb** — Assemblage features, encodage one-hot, split, entraînement Keras

## Fichiers

- `layer_classification_utils.py` — Fonctions utilitaires (types, colonnes, encodage)
- `outputs/` — Fichiers intermédiaires (.npy, .keras)

## Prérequis

- GloVe : `data/glove.6B.300d.txt`
- CSV source : `layer_raw_and_target_full.csv`
