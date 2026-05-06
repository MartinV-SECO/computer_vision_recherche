# Référence des colonnes du dataframe DXF (df_origin)

Document de synthèse basé sur le **DXF Reference** AutoCAD 2012 (Autodesk).  
Le dataframe est construit à partir des entités du modelspace de fichiers DXF, via ezdxf (`e.dxfattribs()`).

---

## 1. Colonnes ajoutées par le script

| Colonne       | Signification |
|---------------|----------------|
| **file_name** | Nom du fichier DXF source. |
| **entity_type** | Type d'entité (group code 0) : LINE, CIRCLE, LWPOLYLINE, TEXT, INSERT, HATCH, ARC, DIMENSION, MTEXT, etc. |
| **handle**    | Identifiant unique de l'entité dans le dessin (group code 5), chaîne hexadécimale. |

---

## 2. Codes communs à (quasi) toutes les entités

*Source : DXF Reference, Chapter 6 – Common Group Codes for Entities.*

| Colonne (ex.)   | Group code | Signification |
|-----------------|------------|----------------|
| **owner**       | 330        | Référence au bloc propriétaire (model space / paper space). |
| **layer**       | 8          | **Nom du calque** sur lequel est l'entité. |
| **linetype**    | 6          | Nom du type de ligne (ou BYLAYER / BYBLOCK). |
| **invisible**   | 60         | Visibilité : 0 = visible, 1 = invisible. |
| **color**       | 62         | Couleur ACI (0 = BYBLOCK, 256 = BYLAYER). |
| **true_color**  | 420        | Couleur 24 bits (RGB). |
| **lineweight**  | 370        | Épaisseur de ligne (enum). |
| **ltscale**     | 48         | Échelle du type de ligne (défaut 1.0). |
| **elevation**   | 38         | Élévation de l'entité si non nulle. |
| **extrusion**   | 210, 220, 230 | Direction d'extrusion (vecteur 3D). |

---

## 3. Points et géométrie

| Colonne (ex.)   | Group code      | Signification |
|-----------------|-----------------|----------------|
| **insert**      | 10, 20, 30      | Point d'insertion (bloc, texte, etc.). |
| **start** / **end** | 10–11, 20–21, 30–31 | Points début/fin (ligne, arc, etc.). |
| **center**      | 10, 20, 30      | Centre (cercle, arc). |
| **location**     | 10, 20, 30      | Position (point, texte, etc.). |
| **defpoint**, **defpoint2**, **defpoint3** | 10, 13, 14, 15… | Points de définition (cotes). |

---

## 4. Texte et cotes

| Colonne (ex.)              | Group code | Signification |
|----------------------------|------------|----------------|
| **style**                  | 7          | Nom du style de texte. |
| **char_height**            | 40         | Hauteur du texte. |
| **width** / **defined_height** | 41, 46 | Largeur / hauteur (mtext, etc.). |
| **rotation**               | 50         | Angle de rotation. |
| **text**                   | 1          | Contenu du texte. |
| **attachment_point**       | 71         | Point d'accroche du texte (1–9). |
| **flow_direction** / **text_direction** | 72, etc. | Direction du texte. |
| **line_spacing_style** / **line_spacing_factor** | 73, 44 | Interligne (mtext). |
| **dimtype**                | 70         | Type de cote (alignée, angulaire, etc.). |
| **dimstyle**               | 3          | Nom du style de cote. |
| **actual_measurement**     | 42         | Valeur mesurée de la cote. |

---

## 5. Hachures (HATCH)

| Colonne (ex.)   | Signification |
|-----------------|----------------|
| **pattern_name** | Nom du motif de hachure. |
| **solid_fill**   | Remplissage uni (1) ou motif (0). |
| **associative**  | Hachure associative (1) ou non (0). |
| **hatch_style**  | Style (normal, outer, ignore). |
| **pattern_type** | Type de motif (user, predefined, custom). |

---

## 6. Arcs et cercles

| Colonne (ex.)       | Signification |
|---------------------|----------------|
| **radius**          | Rayon (cercle, arc). |
| **start_angle** / **end_angle** | Angles début / fin (arc). |

---

## 7. Rappels

- **entity_type** = type d'entité (group code 0).
- **handle** = identifiant unique (5).
- **layer** = calque (8).
- **owner** = bloc propriétaire (330).
- Les autres colonnes correspondent aux **attributs DXF** (group codes) selon le type d'entité ; une colonne peut être vide (NaN) pour les entités qui n'utilisent pas ce code.

Référence complète : *AutoCAD 2012 DXF Reference* (Autodesk), chapitres 5 (BLOCKS), 6 (ENTITIES) et 9 (Drawing Interchange File Formats).
