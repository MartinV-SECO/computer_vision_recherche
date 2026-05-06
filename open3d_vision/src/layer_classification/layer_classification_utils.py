"""
Fonctions utilitaires pour la classification des calques DWG.
Réutilisées par les notebooks layer_classification.
"""
import ast
import numpy as np
import pandas as pd


def unifier_types_colonnes(arr, priorite=('float', 'int', 'tuple', 'list', 'str')):
    """
    Unifie le type de chaque colonne en priorisant numériques (float, int),
    puis tuple/liste, puis str. Retourne une copie du tableau.
    """
    arr = np.asarray(arr, dtype=object)
    n_rows, n_cols = arr.shape
    out = np.empty_like(arr)

    def _is_na(x):
        if x is None:
            return True
        if isinstance(x, float) and np.isnan(x):
            return True
        try:
            if pd.isna(x):
                return True
        except (TypeError, ValueError):
            pass
        return False

    def _parse_literal(s):
        """Si s est une str représentant un tuple/liste, retourne le type Python ; sinon None."""
        if not isinstance(s, str) or not s.strip():
            return None
        s = s.strip()
        try:
            v = ast.literal_eval(s)
            if isinstance(v, tuple):
                return 'tuple', v
            if isinstance(v, list):
                return 'list', v
        except (ValueError, SyntaxError):
            pass
        return None

    def _type_priorite(x):
        if _is_na(x):
            return None
        if isinstance(x, (int, float)) and not isinstance(x, bool):
            return 'float' if isinstance(x, float) else 'int'
        if isinstance(x, tuple):
            return 'tuple'
        if isinstance(x, list):
            return 'list'
        if isinstance(x, str):
            parsed = _parse_literal(x)
            if parsed is not None:
                return parsed[0]
            return 'str'
        return type(x).__name__

    for j in range(n_cols):
        col = arr[:, j]
        types_presents = {}
        for x in col:
            t = _type_priorite(x)
            if t is not None:
                types_presents[t] = types_presents.get(t, 0) + 1
        if not types_presents:
            out[:, j] = np.nan
            continue
        choix = None
        for p in priorite:
            if p in types_presents:
                choix = p
                break
        if choix is None:
            choix = next(iter(types_presents.keys()))
        for i in range(n_rows):
            x = col[i]
            if _is_na(x):
                out[i, j] = np.nan if choix in ('float', 'int') else '' if choix == 'str' else x
                continue
            if choix in ('float', 'int'):
                try:
                    out[i, j] = float(x)
                except (TypeError, ValueError):
                    out[i, j] = np.nan
            elif choix == 'str':
                out[i, j] = str(x)
            elif choix == 'tuple':
                parsed = _parse_literal(x) if isinstance(x, str) else None
                if parsed is not None:
                    out[i, j] = tuple(parsed[1]) if isinstance(parsed[1], list) else parsed[1]
                elif isinstance(x, list):
                    out[i, j] = tuple(x)
                else:
                    out[i, j] = x
            elif choix == 'list':
                parsed = _parse_literal(x) if isinstance(x, str) else None
                if parsed is not None:
                    out[i, j] = list(parsed[1]) if isinstance(parsed[1], tuple) else parsed[1]
                elif isinstance(x, tuple):
                    out[i, j] = list(x)
                else:
                    out[i, j] = x
            else:
                out[i, j] = x
    return out


def afficher_types_par_colonne(arr, col_index=None):
    """Debug : affiche le nombre de types présents par colonne (ou pour la colonne col_index)."""
    arr = np.asarray(arr, dtype=object)
    n_cols = arr.shape[1]

    def _parse_literal(s):
        if not isinstance(s, str) or not s.strip():
            return None
        try:
            v = ast.literal_eval(s.strip())
            return type(v).__name__ if isinstance(v, (tuple, list)) else None
        except (ValueError, SyntaxError):
            return None

    def _type_name(x):
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return 'NA'
        try:
            if pd.isna(x):
                return 'NA'
        except (TypeError, ValueError):
            pass
        if isinstance(x, bool):
            return 'bool'
        if isinstance(x, (int, float)):
            return type(x).__name__
        if isinstance(x, str):
            t = _parse_literal(x)
            return t if t is not None else 'str'
        if isinstance(x, (tuple, list)):
            return type(x).__name__
        return type(x).__name__

    indices = [col_index] if col_index is not None else range(n_cols)
    for j in indices:
        col = arr[:, j]
        counts = {}
        for x in col:
            t = _type_name(x)
            counts[t] = counts.get(t, 0) + 1
        nb_types = len(counts)
        print(f"Colonne {j} : {nb_types} type(s) → {dict(sorted(counts.items(), key=lambda e: -e[1]))}")


def colonnes_nan_only(arr, supprimer=False):
    """
    Affiche les colonnes ne contenant que des NaN.
    Si supprimer=True, retourne (arr sans ces colonnes, indices_supprimés). Sinon retourne (arr, indices).
    """
    arr = np.asarray(arr, dtype=object)
    n_cols = arr.shape[1]

    def _est_nan_like(x):
        if x is None:
            return True
        if isinstance(x, float) and np.isnan(x):
            return True
        try:
            if pd.isna(x):
                return True
        except (TypeError, ValueError):
            pass
        if isinstance(x, str) and x.strip().lower() == 'nan':
            return True
        return False

    indices_nan_only = [j for j in range(n_cols) if all(_est_nan_like(x) for x in arr[:, j])]
    print(f"Colonnes ne contenant que des NaN : {len(indices_nan_only)} → {indices_nan_only}")

    if supprimer and indices_nan_only:
        mask = np.ones(n_cols, dtype=bool)
        mask[indices_nan_only] = False
        out = arr[:, mask]
        print(f"Colonnes supprimées. Nouvelle forme : {out.shape}")
        return out, indices_nan_only
    return arr, indices_nan_only


def _is_na(x):
    if x is None:
        return True
    if isinstance(x, float) and np.isnan(x):
        return True
    try:
        if pd.isna(x):
            return True
    except (TypeError, ValueError):
        pass
    return False


def _norm_key(x):
    if _is_na(x):
        return (type(None).__name__, "<NA>")
    return (type(x).__name__, repr(x))


def afficher_valeurs_uniques(arr):
    """Affiche toutes les valeurs uniques d'un array numpy (1D ou 2D)."""
    arr = np.asarray(arr)
    flat = arr.ravel()
    seen = {}
    for x in flat:
        key = _norm_key(x)
        if key not in seen:
            seen[key] = x
    uniques = sorted(seen.values(), key=_norm_key)
    print(f"Nombre de valeurs uniques : {len(uniques)}")
    for i, v in enumerate(uniques[:50]):
        na = " (NA)" if _is_na(v) else ""
        print(f"  [{i}] {repr(v)}{na}")
    if len(uniques) > 50:
        print(f"  ... et {len(uniques) - 50} autres (total {len(uniques)})")
    return uniques


def compter_uniques(col):
    """Retourne (nombre de valeurs uniques, liste des valeurs)."""
    seen = {}
    for x in col:
        key = _norm_key(x)
        if key not in seen:
            seen[key] = x
    return len(seen), list(seen.values())


def _to_float_oh(val):
    """Convertit la valeur en float, 0.0 si impossible."""
    if val is None or (isinstance(val, float) and np.isnan(val)) or (isinstance(val, str) and str(val).strip() == ''):
        return 0.0
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def one_hot_encode_echantillon(data, categorical_col_indices=None, dtype=np.float32):
    """
    Encode les colonnes catégorielles en one-hot. Les autres colonnes sont converties en float32.
    Prêt pour Keras. Retourne (tableau encodé, mappings).
    """
    data = np.asarray(data)
    n_rows, n_cols = data.shape

    if categorical_col_indices is None:
        categorical_col_indices = []
        for j in range(n_cols):
            col = data[:, j]
            non_null = col[~pd.isna(col)]
            if len(non_null) > 0:
                n_str = sum(1 for x in non_null if isinstance(x, str))
                if n_str > len(non_null) / 2:
                    categorical_col_indices.append(j)

    mappings = {}
    parts = []
    for j in range(n_cols):
        col = data[:, j]
        if j in categorical_col_indices:
            uniques = sorted(set(str(x) for x in col if pd.notna(x) and str(x).strip() != ''))
            if not uniques:
                uniques = ['__nan__']
            mappings[j] = {v: i for i, v in enumerate(uniques)}
            n_cats = len(uniques)
            oh = np.zeros((n_rows, n_cats), dtype=dtype)
            for i in range(n_rows):
                v = col[i]
                key = '__nan__' if (pd.isna(v) or str(v).strip() == '') else str(v)
                idx = mappings[j].get(key, 0)
                oh[i, idx] = 1.0
            parts.append(oh)
        else:
            col_f = np.array([_to_float_oh(col[i]) for i in range(n_rows)], dtype=dtype)
            parts.append(col_f.reshape(-1, 1))

    return np.hstack(parts).astype(dtype), mappings
