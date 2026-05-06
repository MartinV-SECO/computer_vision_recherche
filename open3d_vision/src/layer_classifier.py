"""
Classifieur Keras : chaîne de caractères -> layer DXF.
Entrée : une chaîne (ex. nom de layer, description).
Sortie : un des layers prédéfinis (EXTERIEUR, MUR PORTEUR, PORTES, etc.).
"""

import numpy as np
from tensorflow import keras
from tensorflow.keras import layers


# Layers possibles (sorties du réseau), alignés avec le projet DXF
LAYER_LABELS = [
    "CLOISONS",
    "EXTERIEUR",
    "LIMITE PARCELLAIRE",
    "MUR PORTEUR",
    "PORTES",
    "ESCALIERS",
    "SURFACE-LOT",
    "TEXTE-LOT",
    "TEXTE-LOT-NUMERO",
    "OTHER",  # classe fourre-tout pour layers inconnus
]

# Paramètres du modèle
MAX_SEQ_LEN = 64
EMBED_DIM = 32
LSTM_UNITS = 64
DROPOUT = 0.3


def _build_char_vocab():
    """
    Construit le vocabulaire caractère : caractères imprimables + padding.
    Retourne (dict char->id, dict id->char).
    """
    # Caractères usuels (lettres, chiffres, espaces, tirets, etc.)
    chars = set(" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-.")
    # Ordre déterministe
    char_list = sorted(chars)
    # 0 = padding, 1 = inconnu (OOV)
    c2i = {"<PAD>": 0, "<OOV>": 1}
    for i, c in enumerate(char_list, start=2):
        c2i[c] = i
    i2c = {v: k for k, v in c2i.items()}
    return c2i, i2c


def encode_string(s, char2id, max_len=MAX_SEQ_LEN):
    """
    Encode une chaîne en séquence d'entiers (padding à max_len).
    Caractères inconnus -> id 1 (OOV).
    """
    if not isinstance(s, str):
        s = str(s)
    s = s.strip().upper()[:max_len]
    ids = [char2id.get(c, char2id["<OOV>"]) for c in s]
    # Padding à droite
    pad_len = max_len - len(ids)
    if pad_len > 0:
        ids += [char2id["<PAD>"]] * pad_len
    return np.array(ids, dtype=np.int32)


def decode_predictions(probs, labels=LAYER_LABELS):
    """
    Retourne la liste (label, proba) triée par proba décroissante.
    """
    idx = np.argsort(probs)[::-1]
    return [(labels[i], float(probs[i])) for i in idx]


def build_model(num_classes=None, max_len=MAX_SEQ_LEN, vocab_size=128, embed_dim=EMBED_DIM, lstm_units=LSTM_UNITS, dropout=DROPOUT):
    """
    Construit le réseau : Embedding -> LSTM -> Dense -> Softmax.
    num_classes : nombre de layers (défaut = len(LAYER_LABELS)).
    """
    if num_classes is None:
        num_classes = len(LAYER_LABELS)

    inputs = keras.Input(shape=(max_len,), dtype="int32")
    x = layers.Embedding(input_dim=vocab_size, output_dim=embed_dim, input_length=max_len)(inputs)
    x = layers.LSTM(lstm_units, dropout=dropout, recurrent_dropout=0.1)(x)
    x = layers.Dense(64, activation="relu")(x)
    x = layers.Dropout(dropout)(x)
    outputs = layers.Dense(num_classes, activation="softmax")(x)

    model = keras.Model(inputs=inputs, outputs=outputs)
    model.compile(
        optimizer="adam",
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    return model


def prepare_dataset(texts, labels, layer_list=None, char2id=None, max_len=MAX_SEQ_LEN):
    """
    Prépare X (séquences) et y (indices de classe) à partir de listes de chaînes et de noms de layer.
    labels : liste de noms de layer (doivent appartenir à layer_list).
    Retourne (X, y, char2id, layer_list).
    """
    if layer_list is None:
        layer_list = LAYER_LABELS
    if char2id is None:
        char2id, _ = _build_char_vocab()

    layer_to_id = {name: i for i, name in enumerate(layer_list)}
    # Classe "OTHER" pour tout label non présent dans layer_list
    other_id = layer_to_id.get("OTHER", len(layer_list))

    X = np.array([encode_string(t, char2id, max_len) for t in texts])
    y = np.array([layer_to_id.get(str(l).strip(), other_id) for l in labels], dtype=np.int32)
    return X, y, char2id, layer_list


def train_model(X, y, epochs=20, batch_size=32, validation_split=0.2, verbose=1):
    """
    Entraîne le modèle sur (X, y) et retourne l'historique et le modèle.
    """
    vocab_size = int(X.max()) + 1
    num_classes = len(np.unique(y))
    model = build_model(num_classes=num_classes, vocab_size=vocab_size)
    hist = model.fit(X, y, epochs=epochs, batch_size=batch_size, validation_split=validation_split, verbose=verbose)
    return model, hist


# Labels prédits « structure / à modéliser » pour le pipeline to_draw (aligné NOT_TO_DRAW / heuristique DXF)
NN_TO_DRAW_LABELS = frozenset(
    {
        "MUR PORTEUR",
        "CLOISONS",
        "PORTES",
        "EXTERIEUR",
        "ESCALIERS",
    }
)


def layer_pred_to_draw_group(pred_label: str) -> str:
    """Convertit un label softmax du réseau en to_draw / not_to_draw."""
    lab = str(pred_label).strip()
    return "to_draw" if lab in NN_TO_DRAW_LABELS else "not_to_draw"


def load_keras_layer_classifier(model_path):
    """
    Charge un .keras entraîné avec build_model / encode_string / _build_char_vocab.
    Retourne (model, char2id, layer_list) ou (None, None, None) si fichier absent ou erreur.
    """
    from pathlib import Path

    p = Path(model_path)
    if not p.is_file():
        return None, None, None
    try:
        model = keras.models.load_model(str(p), compile=False)
        char2id, _ = _build_char_vocab()
        return model, char2id, LAYER_LABELS
    except Exception as exc:
        print(f"[layer_classifier] Chargement impossible ({exc!r})")
        return None, None, None


def predict_layer(model, string, char2id, layer_list=None):
    """
    Prédit le layer pour une chaîne.
    Retourne (label_prédit, proba, liste_triée (label, proba)).
    """
    if layer_list is None:
        layer_list = LAYER_LABELS
    seq = encode_string(string, char2id)
    seq_batch = np.expand_dims(seq, axis=0)
    probs = model.predict(seq_batch, verbose=0)[0]
    idx = int(np.argmax(probs))
    return layer_list[idx], float(probs[idx]), decode_predictions(probs, layer_list)


# --- Exemple d'utilisation avec données synthétiques ---
if __name__ == "__main__":
    # Données d'exemple : chaînes (variantes / bruit) -> layer
    texts = [
        "CLOISONS", "cloison", "Cloisons", "CLOISON",
        "MUR PORTEUR", "mur porteur", "MUR PORTEUR ",
        "PORTES", "porte", "PORTE", "Portes",
        "EXTERIEUR", "exterieur", "EXTERIEUR ",
        "LIMITE PARCELLAIRE", "limite parcellaire",
        "ESCALIERS", "escalier", "ESCALIER",
        "SURFACE-LOT", "TEXTE-LOT", "TEXTE-LOT-NUMERO",
    ]
    labels = [
        "CLOISONS", "CLOISONS", "CLOISONS", "CLOISONS",
        "MUR PORTEUR", "MUR PORTEUR", "MUR PORTEUR",
        "PORTES", "PORTES", "PORTES", "PORTES",
        "EXTERIEUR", "EXTERIEUR", "EXTERIEUR",
        "LIMITE PARCELLAIRE", "LIMITE PARCELLAIRE",
        "ESCALIERS", "ESCALIERS", "ESCALIERS",
        "SURFACE-LOT", "TEXTE-LOT", "TEXTE-LOT-NUMERO",
    ]

    X, y, char2id, layer_list = prepare_dataset(texts, labels)
    vocab_size = max(int(X.max()) + 1, len(char2id))
    model = build_model(num_classes=len(layer_list), vocab_size=vocab_size)
    model.fit(X, y, epochs=30, batch_size=8, verbose=1)

    # Test
    for s in ["CLOISONS", "mur porteur", "inconnu_layer"]:
        label, prob, ranked = predict_layer(model, s, char2id, layer_list)
        print(f"  '{s}' -> {label} ({prob:.2f})")
