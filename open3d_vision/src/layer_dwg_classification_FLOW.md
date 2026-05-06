# Flow global — `layer_dwg_classification.ipynb`

Document décrit le déroulement du notebook de classification des calques DWG (entités CAD) en deux classes : **à tracer** (mur, cloisons, portes, etc.) vs **ne pas tracer** (cotation, texte, hachures, etc.).

---

## 1. Chargement et exploration

- **Entrée** : fichier CSV `layer_raw_and_target_full.csv` (entités CAD avec colonnes brutes + `target` / `target_nom`).
- Lecture avec `pandas`, conversion en tableau NumPy `raw_csv` (shape ~8M lignes × 123 colonnes).
- Exploration : `df.head()`, colonnes supprimées (ex. `file_name`, `pattern_type`, …).

---

## 2. Filtrage des lignes utiles

- **Filtre** : ne garder que les lignes dont la cible n’est pas `"autre"` :
  - `target_csv = raw_csv[raw_csv[:, -1] != "autre"]`.

---

## 3. Échantillonnage et prétraitement de la structure

- **Échantillon** : `echantillon_csv = target_csv[:2000]` après `np.random.shuffle(target_csv)`.
- Suppression de la colonne 1 (trop de modalités, peu exploitable) : `np.delete(echantillon_csv, 1, 1)`.
- **Unification des types** par colonne (`unifier_types_colonnes`) : priorité float → int → tuple → str pour homogénéiser (ex. tuples en string, NaN).
- **Suppression des colonnes 100 % NaN** : `colonnes_nan_only(..., supprimer=True)` → `echantillon_csv` passe à 93 colonnes.

---

## 4. Augmentation de données (texte)

- Extraction des textes de la colonne 2 (layer / nom) : `texts = echantillon_csv[:, 2]`.
- **Augmentation** avec nlpaug (WordEmbsAug, GloVe) : synonymes / substitutions.
- Lignes augmentées différentes de l’originale sont ajoutées à `echantillon_csv` → **taille finale ~3271 lignes**.

---

## 5. Encodage multi-hot des valeurs non numériques

- **Features seules** : `features_raw = echantillon_csv[:, :-2]` (les 2 dernières colonnes restent la cible).
- **Colonne texte (COL_IDX = 2)** : encodage **multi-hot** avec Keras `TextVectorization` (max_tokens=20_000, split whitespace).
- **Autres colonnes string** : encodage **one-hot** (modalités triées, `__nan__` pour les vides).
- **Colonnes tuple** : aplatissement en 3 floats par ligne.
- **Colonnes numériques** : conversion en float (NaN → 0).
- Réassemblage : `echantillon_csv = [features_encoded | deux dernières colonnes]` pour garder la cible en fin de tableau.

---

## 6. Séparation features / cible

- **Deux dernières colonnes** extraites dans `deux_dernieres_colonnes` (target numérique + `target_nom`).
- **Features** : `echantillon_csv = echantillon_csv[:, :-2]` (autant de colonnes qu’après encodage).

---

## 7. Binarisation de la cible

- Selon `target_nom`, remplissage de la 1ère colonne de `deux_dernieres_colonnes` :
  - `0` = ne pas tracer (coupe, terrasses, cotation, surface, texte, parking, limite parcellaire, hachures),
  - `1` = tracer comme un mur (cloisons, mur porteur, escaliers, portes).

---

## 8. Encodage des features (multi-hot sur le texte) — copie / debug

- **Copie** : `copie_echantillon = np.copy(echantillon_csv)`.
- **TextVectorization** Keras (multi-hot, max_tokens=20_000) adaptée sur la colonne `COL_IDX` (index 2).
- La colonne 2 de `copie_echantillon` est remplacée par le vecteur multi-hot (shape 1639 par ligne).
- Identification des **colonnes catégorielles** (string) : 8 colonnes (ex. 0, 3, 6, 10, 17, 37, 43, 61).

---

## 9. Découpage train / validation / test (cellule actuelle)

- `np.random.shuffle(echantillon_csv)`.
- **Features** : `n_features = echantillon_csv.shape[1]` (après séparation, uniquement les colonnes numériques).
- Découpage en indices :
  - **Train** : `[:2000]`
  - **Validation** : `[2001:3000]`
  - **Test** : `[3001:]`
- Avec l’encodage multi-hot/one-hot en amont, la conversion en `np.float32` est valide.

---

## 10. Modèle et entraînement (prévu)

- Modèle Keras : `Input(n_features)` → `Dense(50, relu)` → `Dropout(0.5)` → `Dense(1, sigmoid)`.
- Loss : `binary_crossentropy`, métrique `accuracy`.
- `model.fit(train_values, train_target, validation_data=(validation_values, validation_target))`.
- **Prérequis** : `train_values` / `validation_values` / `test_values` sont désormais numériques grâce à l’étape d’encodage (section 5).

---

## Schéma récapitulatif

```
CSV brut
    → Filtrage (target != "autre")
    → Échantillon 2000 lignes + shuffle
    → Nettoyage (col. supprimée, types unifiés, colonnes 100 % NaN supprimées)
    → Augmentation texte (nlpaug) → ~3271 lignes
    → Encodage multi-hot (colonne texte) + one-hot (autres catégorielles) + tuple→floats
    → Séparation : echantillon_csv (features numériques) | deux_dernieres_colonnes (target binaire 0/1)
    → Split train / validation / test
    → Modèle Dense → fit / evaluate
```

---

## Variables clés

| Variable | Rôle |
|----------|------|
| `df` | DataFrame CSV brut |
| `raw_csv` | Tableau NumPy du CSV (avant filtre) |
| `target_csv` | Lignes avec target ≠ "autre" |
| `echantillon_csv` | Après encodage : **features numériques** (multi-hot + one-hot + floats) + 2 colonnes cible en fin ; après séparation = features seules (float32). |
| `deux_dernieres_colonnes` | Cible (col. 0 = 0/1, col. 1 = target_nom) |
| `copie_echantillon` | Copie avec colonne 2 remplacée par encodage multi-hot (pour analyse / debug) |
| `n_features` | Nombre de colonnes de features (après encodage) |

---

## Point d’attention

Pour que la cellule de split (train/validation/test) et le `model.fit` fonctionnent, les features doivent être **entièrement numériques** : l’étape « Encodage multi-hot des valeurs non numériques » (entre augmentation et séparation) produit ce tableau. Ensuite le découpage et la conversion en `np.float32` sont valides.
