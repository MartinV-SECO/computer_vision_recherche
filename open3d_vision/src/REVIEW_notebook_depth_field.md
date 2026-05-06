# Review : `notebook_depth_field.ipynb` — Problèmes d’overlapping des polygones

## Résumé

Le notebook mélange plusieurs procédés (nuage plat → Poisson, BIM/lignes, plan RANSAC, extrusion de points). Les chevauchements dans le « modèle final » viennent surtout de la **reconstruction Poisson** sur un nuage quasi planaire et du **pipeline BIM** (variable manquante, polygones non fusionnés). Ci‑dessous : causes identifiées, ordre des cellules, et pistes de correction.

---

## 1. Reconstruction Poisson (source principale d’overlapping)

**Cellule concernée :** celle qui appelle `create_from_point_cloud_poisson` puis `select_by_index`.

### Problèmes

- **Nuage de points quasi plan (z constant)**  
  Poisson reconstruit une surface **fermée** : il tend à créer une « bulle » avec une face au‑dessus et une en‑dessous du plan. En vue de dessus ou en coupe, on voit deux surfaces qui se superposent → **overlapping**.

- **Filtrage par densité sur les *vertices***  
  On garde les sommets avec `densities > np.quantile(densities, 0.05)` puis `mesh.select_by_index(vertices_to_keep)`. Open3D réindexe et supprime les triangles qui référençaient des sommets supprimés. On obtient un mesh avec des trous et des bords déchirés, pas une vraie « découpe » propre de la surface ; les parties restantes peuvent encore se chevaucher visuellement (deux couches).

- **Pas de nettoyage du mesh**  
  Aucun appel du type `remove_degenerate_triangles()`, `remove_duplicated_triangles()`, `merge_close_vertices()`, ni de détection de double couche.

### Recommandations

1. **Pour un plan / sol uniquement**  
   Ne pas utiliser Poisson. Préférer :
   - une triangulation 2D des points (x, y) puis extrusion en z (une seule couche), ou  
   - le plan RANSAC déjà utilisé dans le notebook, converti en mesh (un seul rectangle).

2. **Si Poisson est gardé**  
   - Réduire la profondeur (ex. `depth=5` ou `6`) pour limiter les détails et la double couche.  
   - Après filtrage par densité, appeler par exemple :
     - `mesh.remove_degenerate_triangles()`
     - `mesh.remove_duplicated_triangles()`
     - `mesh.remove_non_manifold_edges()` (ou équivalent selon version Open3D)
   - En option : détecter les triangles dont la normale est opposée au plan dominant et ne garder qu’une des deux « couches » (ex. celle au‑dessus de z=moyenne).

3. **Alternative à Poisson pour du 2.5D**  
   Utiliser une triangulation 2D (Delaunay sur x,y) puis créer un mesh avec une seule couche de triangles à z constant (ou une légère extrusion), pour éviter toute double couche.

---

## 2. Pipeline BIM (lignes → polygones 2D) : incohérences et risques d’overlapping

### 2.1 Variable `points_2d` manquante

**Cellule :** celle qui fait `vectors = points_2d[1:] - points_2d[:-1]` et utilise DBSCAN sur les angles.

- **Erreur :** `NameError: name 'points_2d' is not defined`.
- **Conséquence :** toute la chaîne qui dépend de `points_2d` (DBSCAN → `lines` → `wall_polygons` → `unary_union`) ne peut pas tourner correctement. Si une ancienne exécution a laissé des `lines` / `walls_2d` en mémoire, ils peuvent ne pas correspondre aux cellules affichées → incohérence et risque de réutiliser des polygones non fusionnés.

**Correction :** définir `points_2d` avant utilisation, par exemple :

```python
# Extraire les coordonnées 2D (x, y) du nuage
np_points = np.asarray(points.points)
points_2d = np_points[:, :2]
```

À placer dans une cellule exécutée **avant** la cellule DBSCAN (et après la création de `points`).

### 2.2 Duplication des blocs wall_polygons / unary_union

Deux ensembles de cellules font presque la même chose :

- Un bloc : `wall_polygons` → `walls_2d = unary_union(wall_polygons)` puis `walls_2d = walls_2d.buffer(0)`.
- Un autre : à nouveau `wall_polygons = []`, buffer par ligne, puis `walls_2d = unary_union(wall_polygons)` sans `buffer(0)`.

**Problèmes :**

- Ordre d’exécution ambigu : selon l’ordre des runs, `walls_2d` peut être issu de l’un ou l’autre bloc. Si le bloc sans `buffer(0)` est exécuté en dernier, on peut garder une géométrie Shapely invalide ou auto‑intersectée.
- `buffer(0)` est utile pour « réparer » les unions (trous, auto‑intersections, polygones invalides). Si on oublie de l’appliquer systématiquement, les polygones 2D peuvent se croiser ou se chevaucher, et une future extrusion produirait des overlaps 3D.

**Recommandations :**

- Ne garder qu’**un seul** flux clair :  
  `lines` → `wall_polygons` (buffer par ligne) → `walls_2d = unary_union(wall_polygons)` → `walls_2d = walls_2d.buffer(0)`.
- S’assurer que toute construction de mesh 3D à partir des murs utilise ce `walls_2d` **déjà fusionné**, et non une liste de polygones séparés (sinon les murs extrudés se chevaucheront aux intersections).

### 2.3 Définition de `wall_thickness` et `LineString`

Dans une cellule on utilise `wall_thickness` et `LineString(pts)` sans que `wall_thickness` soit défini dans la même cellule (il est défini plus bas avec `wall_thickness = 1`). Dépendance fragile à l’ordre d’exécution.

**Recommandation :** définir `wall_thickness` (et importer `LineString` / `unary_union`) dans la même cellule ou dans une cellule « config » exécutée en premier, pour que le flux BIM soit reproductible de bout en bout.

---

## 3. Affichage cumulé (plan + nuage / mesh)

**Cellules :** segmentation du plan (RANSAC) + `create_plane_mesh` + affichage avec `inlier_cloud`, `outlier_cloud`, `plane_mesh`.

- On affiche **plusieurs géométries en même temps** (nuage inliers, outliers, grand rectangle du plan). Ce n’est pas un mesh unique : les primitives se superposent par construction (ex. le plan vert sous les points rouges). Ce n’est pas un bug, mais si tu appelles « modèle final » cette vue, les « overlaps » sont normaux.

**Recommandation :** clarifier dans le notebook quel objet est considéré comme « modèle final » (mesh Poisson, mesh issu de `walls_2d`, ou seulement visualisation debug). Si le modèle final est un mesh, ne pas le mélanger avec le plan RANSAC sans raison.

---

## 4. Extrusion du nuage de points (procédé 1)

**Cellules :** `extrude_point_cloud`, `add_edges_between_layers`.

- On ne crée que des **points** (deux couches) et un **LineSet** (arêtes verticales). Il n’y a **pas de triangles** entre les points, donc pas de polygones qui se chevauchent à ce stade. Les overlaps dont tu parles ne viennent donc pas de cette partie, sauf si tu construis plus tard un mesh à partir de ces points (auquel cas il faudrait une stratégie de triangulation/maillage sans recouvrement).

---

## 5. Synthèse des corrections prioritaires

| Priorité | Problème | Action |
|----------|----------|--------|
| Haute | Poisson sur nuage plan → double couche | Changer d’algo (triangulation 2D + extrusion) ou filtrer une des deux couches + nettoyage mesh (remove_degenerate_triangles, etc.). |
| Haute | `points_2d` non défini | Définir `points_2d = np.asarray(points.points)[:, :2]` avant la cellule DBSCAN. |
| Moyenne | Deux blocs wall_polygons / unary_union | Un seul flux, avec `unary_union` + `buffer(0)` systématique. |
| Moyenne | `wall_thickness` / imports | Centraliser config et imports (wall_thickness, LineString, unary_union) en début de section BIM. |
| Basse | « Modèle final » flou | Documenter dans le notebook quel est le modèle final (quel mesh) et ne pas mélanger plan RANSAC et mesh final sans le dire. |

---

## 6. Ordre d’exécution recommandé (section BIM)

Pour éviter états incohérents et overlapping 2D/3D :

1. Charger l’image et créer le nuage `points` (comme aujourd’hui).
2. Définir `np_points = np.asarray(points.points)` et `points_2d = np_points[:, :2]`.
3. (Optionnel) Extraire des lignes avec RANSAC : `lines = extract_lines(np_points)`.
4. Définir `wall_thickness`, importer `LineString`, `unary_union`.
5. Construire **une seule fois** :  
   `wall_polygons` (buffer par ligne) → `walls_2d = unary_union(wall_polygons)` → `walls_2d = walls_2d.buffer(0)`.
6. Si tu passes en 3D : extruder **uniquement** `walls_2d` (géométrie déjà fusionnée), pas une liste de polygones séparés.

En suivant ces points, les overlaps devraient être fortement réduits, surtout côté Poisson et côté BIM.
