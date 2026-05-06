/**
 * Module Fabric.js pour le dessin vectoriel : canvas, outils, export SVG/PDF.
 * Dépendances : Fabric.js (global fabric), jsPDF + svg2pdf (optionnel pour PDF).
 */
(function (global) {
  "use strict";

  // --- Constantes
  const CANVAS_ID = "fabric-canvas";
  const DEFAULT_WIDTH = 1000;
  const DEFAULT_HEIGHT = 800;
  const GRID_SCALE = 100;
  const DEFAULT_STROKE = "#1a73e8";
  /** Couleur par défaut des segments « ligne » et « ligne par points » (_isLineGroup). */
  const DEFAULT_LINE_STROKE = "#000000";
  const DEFAULT_STROKE_WIDTH = 2;
  const DUPLICATE_OFFSET = 2;
  const ANGLE_SNAP_THRESHOLD_DEG = 4;
  /** Padding minimal du carré de sélection (lignes verticales/horizontales). */
  const MIN_SELECTION_PADDING = 10;
  /** Pas du magnétisme « ligne par points » et dessin libre (valeur par défaut). */
  const LINE_BY_POINTS_SNAP_STEP = 25;
  /** Pas du magnétisme traçage (lignes, ligne par points) — plus léger que le dessin, défaut 10. */
  const TRACE_SNAP_STEP_DEFAULT = 10;
  /** Distance minimale (px) entre deux points en dessin libre : réduit la sensibilité. */
  const FREEHAND_DECIMATE = 10;
  /** Bornes de zoom pour la navigation du plan. */
  const VIEWPORT_MIN_ZOOM = 0.2;
  const VIEWPORT_MAX_ZOOM = 8;
  /** Tolérance Douglas–Peucker (px) pour « dessin par points » : lignes droites → peu de sommets. */
  const DRAW_BY_POINTS_SIMPLIFY_EPSILON = 8;
  /** Taille minimale (px) de la boîte de sélection pour lignes horizontales/verticales. */
  const MIN_SELECTION_BOX_SIZE = 24;
  /** Padding de sélection pour lignes/flèches (boîte au moins MIN_SELECTION_BOX_SIZE dans la dimension fine). */
  const PADDING_LINE_SELECTION = Math.max(MIN_SELECTION_PADDING, MIN_SELECTION_BOX_SIZE / 2);
  /** Compteur d'instances canvas pour logs de debug. */
  var CANVAS_DEBUG_SEQ = 0;
  /** Si false : pas de console pour les flux normaux (position, undo snapshot, dessin par points). Les erreurs restent affichées. */
  var FABRIC_DRAWING_VERBOSE_LOGS = false;
  /** Debug ciblé sur l'historique et les points « ligne par points ». Désactivé par défaut (opt-in : setPointUndoDebug(true) ou window.__FD_POINT_UNDO_DEBUG__ = true). */
  var FABRIC_DRAWING_POINT_UNDO_DEBUG = global.__FD_POINT_UNDO_DEBUG__ === true;
  /** Dernier canvas initialisé, exposé pour faciliter le debug depuis la console. */
  var LAST_FABRIC_CANVAS = null;

  /**
   * Indique si le debug ciblé « undo points » est activé.
   * @returns {boolean}
   */
  function isPointUndoDebugEnabled() {
    return !!(FABRIC_DRAWING_VERBOSE_LOGS || FABRIC_DRAWING_POINT_UNDO_DEBUG);
  }

  /**
   * Retourne un résumé court de l'état d'historique utile pour diagnostiquer les points.
   * @param {fabric.Canvas} canvas
   * @returns {string}
   */
  function getPointUndoHistorySummary(canvas) {
    if (!canvas) return "canvas=<null>";
    var preview = canvas._lineByPointsPreview ? getUndoDebugObjectState(canvas._lineByPointsPreview) : "preview=null";
    var last = canvas._lineByPointsLast ? "(" + canvas._lineByPointsLast.x + "," + canvas._lineByPointsLast.y + ")" : "null";
    return "history=" + (canvas._history ? canvas._history.length : 0)
      + " dirty=" + !!canvas._historyDirty
      + " last=" + last
      + " " + preview;
  }

  /**
   * Logge les marqueurs et segments du canvas pour diagnostiquer une disparition après undo.
   * @param {fabric.Canvas} canvas
   * @param {string} label
   */
  function logLineByPointsStructure(canvas, label) {
    if (!isPointUndoDebugEnabled() || !canvas || !canvas.getObjects) return;
    var objects = canvas.getObjects();
    console.log("[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: " + label + " " + getPointUndoHistorySummary(canvas));
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!isLineByPointsMarkerObject(o) && !o._isLineGroup) continue;
      var extra = "";
      if (o._isLineGroup) {
        extra = " refs=("
          + (o._segmentStartMarker ? "start" : "no-start")
          + ","
          + (o._segmentEndMarker ? "end" : "no-end")
          + ")";
      }
      console.log(
        "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: "
        + label + " " + getUndoDebugObjectLabel(o, i) + " "
        + getUndoDebugObjectState(o) + extra
      );
    }
  }

  /**
   * Logge un évènement ciblé du flux « ligne par points ».
   * @param {fabric.Canvas} canvas
   * @param {string} label
   */
  function logPointUndoEvent(canvas, label) {
    if (!isPointUndoDebugEnabled() || !canvas || !label) return;
    console.log("[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: " + label + " " + getPointUndoHistorySummary(canvas));
  }

  /**
   * Ramène une valeur au plus proche multiple de 0.5 (ex. 1.3 → 1.5).
   * @param {number} v
   * @returns {number}
   */
  /**
   * Ramène une valeur au plus proche multiple de step (ex. step=10 : 12→10, 15→20).
   * @param {number} v - Valeur
   * @param {number} step - Pas de la grille (0 = pas de snap)
   * @returns {number}
   */
  function snapToStep(v, step) {
    if (!step || step <= 0) return v;
    return Math.round(v / step) * step;
  }

  function snapToQuarter(v) {
    return snapToStep(v, LINE_BY_POINTS_SNAP_STEP);
  }

  function normalizeStrokeWidth(v, fallback) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return fallback != null ? fallback : DEFAULT_STROKE_WIDTH;
    return n;
  }

  /**
   * Retourne le pas du magnétisme traçage (lignes, ligne par points). 0 = désactivé.
   * @param {fabric.Canvas} canvas
   * @returns {number}
   */
  function getTraceSnapStep(canvas) {
    if (!canvas) return TRACE_SNAP_STEP_DEFAULT;
    var step = canvas._traceSnapStep;
    return step != null ? step : TRACE_SNAP_STEP_DEFAULT;
  }

  /**
   * Ramène la valeur au pas du magnétisme traçage (plus léger qu’en dessin).
   * @param {fabric.Canvas} canvas
   * @param {number} v
   * @returns {number}
   */
  function snapToTraceStep(canvas, v) {
    return snapToStep(v, getTraceSnapStep(canvas));
  }

  /** Pas du magnétisme de rotation (degrés), appliqué en manipulation d'objet. */
  const ROTATION_SNAP_DEG = 15;

  /**
   * Ramène un angle (degrés) au plus proche multiple de stepDeg.
   * @param {number} angleDeg - Angle en degrés
   * @param {number} stepDeg - Pas (ex. 15)
   * @returns {number}
   */
  function snapAngleToStep(angleDeg, stepDeg) {
    if (!stepDeg || stepDeg <= 0) return angleDeg;
    return Math.round(angleDeg / stepDeg) * stepDeg;
  }

  /**
   * Applique le magnétisme traçage à un objet après déplacement/rotation.
   * Met à jour les coordonnées réelles (left, top, angle) avec les valeurs snapées pour que l’objet soit bien à la position magnétisée.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Object} obj - Objet modifié (ou null)
   */
  function applyTraceSnapToObject(canvas, obj) {
    if (!canvas || !obj) return;
    var step = getTraceSnapStep(canvas);
    if (step <= 0) return;
    var left = obj.left;
    var top = obj.top;
    var angle = obj.angle;
    var snappedLeft = typeof left === "number" ? snapToTraceStep(canvas, left) : left;
    var snappedTop = typeof top === "number" ? snapToTraceStep(canvas, top) : top;
    var snappedAngle = (typeof angle === "number" && !obj.lockRotation) ? snapAngleToStep(angle, ROTATION_SNAP_DEG) : angle;
    var changed = (snappedLeft !== left || snappedTop !== top || snappedAngle !== angle);
    if (!changed) return;
    logPositionAction(canvas, "magnétisme traçage (left/top/angle)");
    canvas._applyingTraceSnap = true;
    try {
      if (typeof left === "number") obj.set("left", snappedLeft);
      if (typeof top === "number") obj.set("top", snappedTop);
      if (typeof angle === "number" && !obj.lockRotation) obj.set("angle", snappedAngle);
      obj.setCoords();
    } finally {
      canvas._applyingTraceSnap = false;
    }
  }

  /**
   * Applique le magnétisme (grille) aux points du path sans modifier left/top (évite de casser le rendu Fabric).
   * Snap des valeurs numériques dans path.path ; nouvelle référence pour que la sérialisation enregistre le path magnétisé.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Path} path - Path produit par le dessin libre
   */
  /**
   * Pas effectif du magnétisme « dessin » (input Snap) : pour le dessin par points on rétablit
   * LINE_BY_POINTS_SNAP_STEP si l’utilisateur a 0 (désactivé pour le libre) afin que le tracé reste aligné.
   * @param {fabric.Canvas} canvas
   * @returns {number}
   */
  function getEffectiveDrawingSnapStep(canvas) {
    var s = canvas && canvas._freehandSnapStep != null ? canvas._freehandSnapStep : LINE_BY_POINTS_SNAP_STEP;
    if (s > 0) return s;
    if (canvas && canvas._fabricDrawingVariant === "byPoints") return LINE_BY_POINTS_SNAP_STEP;
    return 0;
  }

  /**
   * Magnétise chaque sommet canvas de la polyline (après extraction / simplification) sur la grille de dessin.
   * @param {fabric.Canvas} canvas
   * @param {Array<{x:number,y:number}>} points
   */
  function snapPolylineCanvasPointsToGrid(canvas, points) {
    if (!canvas || !points || points.length === 0) return;
    var step = getEffectiveDrawingSnapStep(canvas);
    if (step <= 0) return;
    var pi;
    for (pi = 0; pi < points.length; pi++) {
      points[pi].x = snapToStep(points[pi].x, step);
      points[pi].y = snapToStep(points[pi].y, step);
    }
  }

  /**
   * Magnétise chaque sommet au pas « traçage » (même règle que les lignes / ligne par points au clic : getTraceSnapStep).
   * Appliqué après le snap dessin pour fixer l’emplacement du tracé par points une fois converti en marqueurs.
   * @param {fabric.Canvas} canvas
   * @param {Array<{x:number,y:number}>} points
   */
  function snapPolylineCanvasPointsToTrace(canvas, points) {
    if (!canvas || !points || points.length === 0) return;
    var step = getTraceSnapStep(canvas);
    if (step <= 0) return;
    var pi;
    for (pi = 0; pi < points.length; pi++) {
      points[pi].x = snapToTraceStep(canvas, points[pi].x);
      points[pi].y = snapToTraceStep(canvas, points[pi].y);
    }
  }

  function snapPathPointsToGrid(canvas, path) {
    if (!path || !path.path || !Array.isArray(path.path)) return;
    var step = getEffectiveDrawingSnapStep(canvas);
    if (step <= 0) return;
    var beforeState = getUndoDebugObjectState(path);
    var segs = clonePathSegments(path.path);
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!Array.isArray(seg)) continue;
      for (var j = 1; j < seg.length; j++) {
        if (typeof seg[j] === "number") seg[j] = snapToStep(seg[j], step);
      }
    }
    syncPathGeometryAfterMutation(path, segs);
    logPositionAction(
      canvas,
      "path: geometry synced after snap before={" + beforeState + "} after={" + getUndoDebugObjectState(path) + "}"
    );
  }

  /**
   * Clone un tableau de segments Fabric Path pour éviter les mutations partielles.
   * @param {Array} pathData
   * @returns {Array}
   */
  function clonePathSegments(pathData) {
    return JSON.parse(JSON.stringify(pathData || []));
  }

  /**
   * Clone une valeur sérialisable pour éviter les références partagées dans l'historique undo.
   * @param {any} value
   * @returns {any}
   */
  function cloneSerializableValue(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  /**
   * Resynchronise la géométrie interne d'un Path après mutation de ses segments.
   * On préserve la position affichée (left/top) tout en recalculant width/height/pathOffset.
   * @param {fabric.Path} path
   * @param {Array} nextPath
   */
  function syncPathGeometryAfterMutation(path, nextPath) {
    if (!path) return;
    var clonedPath = clonePathSegments(nextPath);
    var left = path.left;
    var top = path.top;
    var angle = path.angle;
    var scaleX = path.scaleX;
    var scaleY = path.scaleY;
    var skewX = path.skewX;
    var skewY = path.skewY;
    var flipX = path.flipX;
    var flipY = path.flipY;
    if (typeof path._setPath === "function") {
      path._setPath(clonedPath);
      path.set({
        left: left,
        top: top,
        angle: angle,
        scaleX: scaleX,
        scaleY: scaleY,
        skewX: skewX,
        skewY: skewY,
        flipX: flipX,
        flipY: flipY,
        dirty: true,
      });
      path.setCoords();
      return;
    }
    if (typeof fabric !== "undefined" && fabric.Path) {
      var rebuilt = new fabric.Path(clonedPath, {
        fill: path.fill,
        stroke: path.stroke,
        strokeWidth: path.strokeWidth,
        strokeLineCap: path.strokeLineCap,
        strokeLineJoin: path.strokeLineJoin,
        strokeMiterLimit: path.strokeMiterLimit,
        strokeDashArray: path.strokeDashArray ? path.strokeDashArray.slice() : null,
        strokeDashOffset: path.strokeDashOffset,
        strokeUniform: path.strokeUniform,
      });
      path.set({
        path: clonePathSegments(rebuilt.path),
        width: rebuilt.width,
        height: rebuilt.height,
        pathOffset: rebuilt.pathOffset ? { x: rebuilt.pathOffset.x, y: rebuilt.pathOffset.y } : path.pathOffset,
        left: left,
        top: top,
        angle: angle,
        scaleX: scaleX,
        scaleY: scaleY,
        skewX: skewX,
        skewY: skewY,
        flipX: flipX,
        flipY: flipY,
        dirty: true,
      });
    } else {
      path.set("path", clonedPath);
      path.set("dirty", true);
    }
    path.setCoords();
  }

  /** Rayon du marqueur rouge du dernier point en mode ligne par points. */
  const LINE_BY_POINTS_MARKER_RADIUS = 6;
  /** Padding de sélection des points (zone de clic plus grande). */
  const LINE_BY_POINTS_MARKER_PADDING = 14;
  /** Couleur de mise en évidence des points quand une droite est sélectionnée. */
  const LINE_BY_POINTS_HIGHLIGHT_FILL = "#ff9800";
  const LINE_BY_POINTS_DEFAULT_FILL = "#e53935";
  /** Distance (px) sous laquelle un nouveau point est fusionné avec un point existant. */
  const LINE_BY_POINTS_MERGE_THRESHOLD = 15;

  /**
   * Crée le cercle rouge marquant un point (mode ligne par points).
   * Déplaçable en mode sélection ; doit rester selectable et evented (voir LINE_BY_POINTS_MARKER_SELECTION_CONTRACT dans src/lib/lineByPointsGeometry.ts).
   * @param {number} x - Centre du cercle (abscisse)
   * @param {number} y - Centre du cercle (ordonnée)
   * @param {fabric.Group|null} linkedLine - Segment relié (end_point) ou null si premier point
   * @returns {fabric.Circle}
   */
  function createLineByPointsMarker(x, y, linkedLine) {
    var c = new fabric.Circle({
      left: x,
      top: y,
      radius: LINE_BY_POINTS_MARKER_RADIUS,
      fill: LINE_BY_POINTS_DEFAULT_FILL,
      originX: "center",
      originY: "center",
      selectable: true,
      evented: true,
      padding: LINE_BY_POINTS_MARKER_PADDING,
      lockScalingX: true,
      lockScalingY: true,
      _isLineByPointsMarker: true,
      _lineByPointsMarkerLine: linkedLine || null,
    });
    applyLineByPointsMarkerInteractionContract(c);
    return c;
  }

  /**
   * Détecte un marqueur « ligne par points » même si le flag custom a été perdu au loadFromJSON.
   * @param {fabric.Object} obj
   * @returns {boolean}
   */
  function isLineByPointsMarkerObject(obj) {
    if (!obj) return false;
    if (obj._isLineByPointsMarker) return true;
    return obj.type === "circle"
      && obj.fill === LINE_BY_POINTS_DEFAULT_FILL
      && Math.abs((obj.radius || 0) - LINE_BY_POINTS_MARKER_RADIUS) < 1e-6;
  }

  /**
   * Indique si un marqueur est déjà un sommet du polygone (référencé par au moins un segment).
   * Ne pas le retirer du canvas avant toJSON (saveUndoState), sinon le snapshot omet ce point.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Object} marker
   * @returns {boolean}
   */
  function isLineByPointsMarkerAttachedToSegment(canvas, marker) {
    if (!canvas || !marker || !isLineByPointsMarkerObject(marker)) return false;
    var objects = canvas.getObjects();
    var i;
    for (i = 0; i < objects.length; i++) {
      var g = objects[i];
      if (!g || !g._isLineGroup) continue;
      if (g._segmentStartMarker === marker || g._segmentEndMarker === marker) return true;
    }
    return false;
  }

  /**
   * Réapplique verrouillage d’échelle et contraintes des marqueurs (Fabric peut les perdre après ActiveSelection / transform).
   * @param {fabric.Object} obj
   */
  function applyLineByPointsMarkerInteractionContract(obj) {
    if (!obj || !isLineByPointsMarkerObject(obj)) return;
    try {
      var next = {
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        lockSkewingX: true,
        lockSkewingY: true,
        lockScalingFlip: true,
        scaleX: 1,
        scaleY: 1,
        radius: LINE_BY_POINTS_MARKER_RADIUS,
        skewX: 0,
        skewY: 0,
        padding: LINE_BY_POINTS_MARKER_PADDING,
        originX: "center",
        originY: "center",
      };
      obj.set(next);
      /* Fabric 6 : masquer les poignées d’échelle / rotation (lockScaling seul ne suffit pas toujours après ActiveSelection). */
      if (typeof obj.setControlsVisibility === "function") {
        obj.setControlsVisibility({
          tl: false,
          tr: false,
          br: false,
          bl: false,
          ml: false,
          mt: false,
          mr: false,
          mb: false,
          mtr: false,
        });
      }
      if (typeof obj.setCoords === "function") obj.setCoords();
    } catch (e) { /* ignore */ }
  }

  /**
   * Réapplique le contrat sur tous les marqueurs du canvas (après sélection multiple ou fin de transformation).
   * @param {fabric.Canvas} canvas
   */
  function reapplyAllLineByPointsMarkerContracts(canvas) {
    if (!canvas) return;
    var objs = canvas.getObjects();
    var i;
    for (i = 0; i < objs.length; i++) {
      if (isLineByPointsMarkerObject(objs[i])) applyLineByPointsMarkerInteractionContract(objs[i]);
    }
  }

  /**
   * Réapplique les contrats sans déclencher une cascade d’object:modified (flag canvas).
   * @param {fabric.Canvas} canvas
   */
  function reapplyLineByPointsMarkerContractsQuiet(canvas) {
    if (!canvas) return;
    canvas._reapplyingLineByPointsMarkerContracts = true;
    try {
      reapplyAllLineByPointsMarkerContracts(canvas);
    } finally {
      canvas._reapplyingLineByPointsMarkerContracts = false;
    }
  }

  /**
   * Pendant object:scaling : la cible est souvent une ActiveSelection (pas le cercle).
   * On neutralise scale/rayon sur chaque marqueur enfant et sur un marqueur ciblé en sous-sélection.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Object|null|undefined} target - opt.target de object:scaling
   */
  function squashLineByPointsMarkerScaleOnTarget(canvas, target) {
    if (!canvas || !target) return;
    canvas._reapplyingLineByPointsMarkerContracts = true;
    try {
      var markerProps = {
        scaleX: 1,
        scaleY: 1,
        radius: LINE_BY_POINTS_MARKER_RADIUS,
      };
      if (isLineByPointsMarkerObject(target)) {
        target.set(markerProps);
        if (typeof target.setCoords === "function") target.setCoords();
        return;
      }
      if (isFabricMultiSelection(target) && typeof target.getObjects === "function") {
        var objs = target.getObjects();
        var i;
        for (i = 0; i < objs.length; i++) {
          var o = objs[i];
          if (isLineByPointsMarkerObject(o)) {
            o.set(markerProps);
            if (typeof o.setCoords === "function") o.setCoords();
          }
        }
      }
    } finally {
      canvas._reapplyingLineByPointsMarkerContracts = false;
    }
  }

  /**
   * Indique si la cible de transformation est un marqueur ou une sélection qui en contient au moins un.
   * @param {fabric.Object|null|undefined} target
   * @returns {boolean}
   */
  function selectionOrObjectContainsLineByPointsMarker(target) {
    if (!target) return false;
    if (isLineByPointsMarkerObject(target)) return true;
    if (isFabricMultiSelection(target) && typeof target.getObjects === "function") {
      var objs = target.getObjects();
      var i;
      for (i = 0; i < objs.length; i++) {
        if (isLineByPointsMarkerObject(objs[i])) return true;
      }
    }
    return false;
  }

  /**
   * Actions Fabric (noms de contrôle) qui modifient taille / skew / resize — à bloquer pour les points rouges.
   * @param {string|undefined} action
   * @returns {boolean}
   */
  function isScaleSkewResizeTransformAction(action) {
    if (!action || action === "drag") return false;
    var a = String(action);
    return (
      a === "scale" || a === "scaleX" || a === "scaleY" ||
      a === "resizing" ||
      a === "skewX" || a === "skewY" || a === "skewing"
    );
  }

  /**
   * Handler vide pour remplacer le gestionnaire de transform (aucune action).
   * @returns {boolean}
   */
  function noopBlockedLineByPointsTransform() {
    return false;
  }

  /**
   * Annule scale/skew/resize au début du geste (`before:transform`) — plus fiable que object:scaling seul.
   * @param {{ transform?: { target?: fabric.Object, action?: string, actionHandler?: Function } }} opt
   */
  function blockLineByPointsMarkerScaleInBeforeTransform(opt) {
    var tr = opt && opt.transform;
    if (!tr || !tr.target) return;
    if (!isScaleSkewResizeTransformAction(tr.action)) return;
    if (!selectionOrObjectContainsLineByPointsMarker(tr.target)) return;
    tr.actionHandler = noopBlockedLineByPointsTransform;
  }

  /**
   * Avant un drag de point(s), fige l'état courant s'il n'était présent qu'en `_historyDirty`.
   * Sans cela, le premier déplacement après création par clics fait perdre l'état final du tracé.
   * @param {fabric.Canvas} canvas
   * @param {{ transform?: { target?: fabric.Object, action?: string } }} opt
   */
  function commitDirtyLineByPointsStateBeforeTransform(canvas, opt) {
    if (!canvas || !canvas._history || !canvas._historyDirty) return;
    var tr = opt && opt.transform;
    if (!tr || !tr.target) return;
    if (isScaleSkewResizeTransformAction(tr.action)) return;
    if (!selectionOrObjectContainsLineByPointsMarker(tr.target)) return;
    saveUndoState(canvas, { reason: "lineByPoints:before-marker-transform" });
  }

  /**
   * Centre du marqueur en coordonnées canvas (repère du canvas, pas du groupe parent).
   * Dans une ActiveSelection, `left`/`top` du cercle sont relatifs au groupe ; `getCenterPoint()` reste en canvas.
   * @param {fabric.Object} marker
   * @returns {{ x: number, y: number }|null}
   */
  function getLineByPointsMarkerCanvasXY(marker) {
    if (!marker || !isLineByPointsMarkerObject(marker)) return null;
    try {
      if (typeof marker.setCoords === "function") marker.setCoords();
    } catch (e0) { /* ignore */ }
    /** Hors groupe parent : left/top = centre canvas (origin center) ; getCenterPoint peut être faux après load (tests jsdom). */
    if (!marker.group && typeof marker.left === "number" && typeof marker.top === "number") {
      return { x: marker.left, y: marker.top };
    }
    try {
      if (typeof marker.getCenterPoint === "function") {
        var p = marker.getCenterPoint();
        if (p && typeof p.x === "number" && typeof p.y === "number" && isFinite(p.x) && isFinite(p.y)) {
          return { x: p.x, y: p.y };
        }
      }
    } catch (e) { /* repli ci-dessous */ }
    if (typeof marker.left === "number" && typeof marker.top === "number") {
      return { x: marker.left, y: marker.top };
    }
    return null;
  }

  /**
   * Indique si l’objet actif est une sélection multiple Fabric (plusieurs objets déplacés ensemble).
   * @param {fabric.Object} obj
   * @returns {boolean}
   */
  function isFabricMultiSelection(obj) {
    if (!obj) return false;
    var t = (obj.type || "").toLowerCase();
    return t === "activeselection" || t === "activeSelection";
  }

  /**
   * Retourne tous les marqueurs « ligne par points » dans la cible (un marqueur ou une ActiveSelection).
   * @param {fabric.Object|null} target
   * @returns {fabric.Object[]}
   */
  function getLineByPointsMarkersFromTarget(target) {
    if (!target) return [];
    if (isLineByPointsMarkerObject(target)) return [target];
    if (isFabricMultiSelection(target) && typeof target.getObjects === "function") {
      var objs = target.getObjects();
      var out = [];
      for (var i = 0; i < objs.length; i++) {
        if (isLineByPointsMarkerObject(objs[i])) out.push(objs[i]);
      }
      return out;
    }
    return [];
  }

  /**
   * Met à jour tous les segments reliés au marqueur après déplacement.
   * Les lignes sont des distances entre deux points ; déplacer un point recalcule les segments.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Circle} marker - Cercle _isLineByPointsMarker
   */
  function updateLineFromMarker(canvas, marker) {
    if (!canvas || !marker || !isLineByPointsMarkerObject(marker)) return;
    var mpos = getLineByPointsMarkerCanvasXY(marker);
    if (!mpos) return;
    var cx = mpos.x;
    var cy = mpos.y;
    if (marker === canvas._lineByPointsPreview) canvas._lineByPointsLast = { x: cx, y: cy };
    var objects = canvas.getObjects();
    for (var i = 0; i < objects.length; i++) {
      var obj = objects[i];
      if (obj._isLineGroup && (obj._segmentStartMarker === marker || obj._segmentEndMarker === marker)) {
        if (obj._segmentStartMarker) {
          obj.start_point = obj.start_point || {};
          var sp = getLineByPointsMarkerCanvasXY(obj._segmentStartMarker);
          if (sp) {
            obj.start_point.x = sp.x;
            obj.start_point.y = sp.y;
          } else {
            obj.start_point.x = obj._segmentStartMarker.left;
            obj.start_point.y = obj._segmentStartMarker.top;
          }
        }
        if (obj._segmentEndMarker) {
          obj.end_point = obj.end_point || {};
          var ep = getLineByPointsMarkerCanvasXY(obj._segmentEndMarker);
          if (ep) {
            obj.end_point.x = ep.x;
            obj.end_point.y = ep.y;
          } else {
            obj.end_point.x = obj._segmentEndMarker.left;
            obj.end_point.y = obj._segmentEndMarker.top;
          }
        }
        logPositionAction(canvas, "segment mis à jour (marqueur déplacé)");
        rebuildLineGroup(obj);
      }
    }
    canvas.requestRenderAll();
  }

  /** Tolérance (px) pour rattacher un segment à un marqueur après chargement JSON (arrondis Fabric / sous-pixels). */
  const LINE_BY_POINTS_REATTACH_TOLERANCE = 30;

  /**
   * Marqueur dont le centre canvas est le plus proche d’un point (si distance ≤ tol).
   * @param {fabric.Object[]} markers
   * @param {number} x
   * @param {number} y
   * @param {number} tol
   * @returns {fabric.Object|null}
   */
  function findClosestLineByPointsMarkerTo(markers, x, y, tol) {
    if (!markers || !markers.length) return null;
    var best = null;
    var bestD2 = tol * tol + 1;
    var j;
    for (j = 0; j < markers.length; j++) {
      var m = markers[j];
      var mc = getLineByPointsMarkerCanvasXY(m);
      var mx = mc ? mc.x : m.left;
      var my = mc ? mc.y : m.top;
      var dx = mx - x;
      var dy = my - y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= tol * tol && d2 < bestD2) {
        bestD2 = d2;
        best = m;
      }
    }
    return best;
  }

  /**
   * Indique si un marqueur coïncide géométriquement avec au moins une extrémité de segment.
   * Sert de garde-fou si les références _segmentStartMarker/_segmentEndMarker ont été perdues.
   * @param {fabric.Object} marker
   * @param {fabric.Object[]} segments
   * @param {number} tol
   * @returns {boolean}
   */
  function isMarkerGeometricallyConnectedToAnySegment(marker, segments, tol) {
    if (!marker || !segments || !segments.length) return false;
    var mc = getLineByPointsMarkerCanvasXY(marker);
    var mx = mc ? mc.x : marker.left;
    var my = mc ? mc.y : marker.top;
    var i;
    for (i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (!seg || !seg.start_point || !seg.end_point) continue;
      if (Math.abs(mx - seg.start_point.x) <= tol && Math.abs(my - seg.start_point.y) <= tol) return true;
      if (Math.abs(mx - seg.end_point.x) <= tol && Math.abs(my - seg.end_point.y) <= tol) return true;
    }
    return false;
  }

  /**
   * Après loadFromJSON, rattache les segments (_isLineGroup) aux marqueurs par position.
   * @param {fabric.Canvas} canvas
   */
  function reattachLineByPointsSegments(canvas) {
    if (!canvas) return;
    logPointUndoEvent(canvas, "reattach:start");
    logUndoPositionSnapshot(canvas, "before reattachLineByPointsSegments");
    var objects = canvas.getObjects();
    var markers = objects.filter(function (o) { return isLineByPointsMarkerObject(o); });
    for (var mm = 0; mm < markers.length; mm++) {
      markers[mm]._isLineByPointsMarker = true;
      applyLineByPointsMarkerInteractionContract(markers[mm]);
    }
    var attachedCount = 0;
    for (var mi = 0; mi < markers.length; mi++) {
      if (typeof markers[mi].setCoords === "function") markers[mi].setCoords();
    }
    for (var i = 0; i < objects.length; i++) {
      var group = objects[i];
      if (!group._isLineGroup || !group.start_point || !group.end_point) continue;
      if (group._segmentStartMarker && group._segmentEndMarker) continue;
      var sx = group.start_point.x;
      var sy = group.start_point.y;
      var ex = group.end_point.x;
      var ey = group.end_point.y;
      var tol = LINE_BY_POINTS_REATTACH_TOLERANCE;
      var startM = findClosestLineByPointsMarkerTo(markers, sx, sy, tol);
      var endM = findClosestLineByPointsMarkerTo(markers, ex, ey, tol);
      if (startM && endM && startM === endM) {
        var others = markers.filter(function (mm) { return mm !== startM; });
        endM = findClosestLineByPointsMarkerTo(others, ex, ey, tol);
      }
      if (startM && endM && startM !== endM) {
        logPositionAction(
          canvas,
          "undo: reattachLineByPointsSegments — rattache "
          + getUndoDebugObjectLabel(group, i)
          + " start=(" + startM.left + "," + startM.top + ")"
          + " end=(" + endM.left + "," + endM.top + ")"
        );
        group._segmentStartMarker = startM;
        group._segmentEndMarker = endM;
        group.lockMovementX = true;
        group.lockMovementY = true;
        group.hasBorders = false;
        group.hasControls = false;
        rebuildLineGroup(group);
        attachedCount++;
      } else if (isPointUndoDebugEnabled()) {
        console.log(
          "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: reattach:missing "
          + getUndoDebugObjectLabel(group, i) + " "
          + getUndoDebugObjectState(group)
          + " startMatch=" + (startM ? getUndoDebugObjectState(startM) : "null")
          + " endMatch=" + (endM ? getUndoDebugObjectState(endM) : "null")
        );
      }
    }
    for (var k = 0; k < objects.length; k++) {
      var g = objects[k];
      if (g._isLineGroup && g.start_point && g.end_point) {
        g.selectable = false;
        g.evented = false;
      }
    }
    logPointUndoEvent(canvas, "reattach:end attached=" + attachedCount);
    logLineByPointsStructure(canvas, "after reattach");
    logUndoPositionSnapshot(canvas, "after reattachLineByPointsSegments");
  }

  /**
   * Supprime les segments « ligne par points » sans deux points valides et les points non connectés à aucune ligne.
   * À appeler après undo/restore pour respecter : point sans ligne → disparaît, ligne sans points → disparaît.
   * @param {fabric.Canvas} canvas
   */
  function removeOrphanLineByPointsObjects(canvas) {
    if (!canvas) return;
    logPointUndoEvent(canvas, "removeOrphans:start");
    var objects = canvas.getObjects();
    var segments = [];
    var segmentsToRemove = [];
    for (var i = 0; i < objects.length; i++) {
      var seg = objects[i];
      if (!seg._isLineGroup || !seg.start_point || !seg.end_point) continue;
      segments.push(seg);
      if (!seg._segmentStartMarker || !seg._segmentEndMarker) segmentsToRemove.push(seg);
    }
    var markerUsed = new Set();
    for (var s = 0; s < objects.length; s++) {
      var g = objects[s];
      if (!g._isLineGroup) continue;
      if (g._segmentStartMarker) markerUsed.add(g._segmentStartMarker);
      if (g._segmentEndMarker) markerUsed.add(g._segmentEndMarker);
    }
    var markersToRemove = [];
    var last = canvas._lineByPointsLast;
    var keepTol = LINE_BY_POINTS_REATTACH_TOLERANCE;
    for (var j = 0; j < objects.length; j++) {
      var o = objects[j];
      if (!isLineByPointsMarkerObject(o) || markerUsed.has(o)) continue;
      var oc = getLineByPointsMarkerCanvasXY(o);
      var ox = oc ? oc.x : o.left;
      var oy = oc ? oc.y : o.top;
      if (last && Math.abs((ox || 0) - last.x) <= keepTol && Math.abs((oy || 0) - last.y) <= keepTol) continue;
      if (isMarkerGeometricallyConnectedToAnySegment(o, segments, keepTol)) {
        if (isPointUndoDebugEnabled()) {
          console.log(
            "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: keep marker by geometry "
            + getUndoDebugObjectLabel(o, j) + " " + getUndoDebugObjectState(o)
          );
        }
        continue;
      }
      markersToRemove.push(o);
    }
    if (isPointUndoDebugEnabled()) {
      for (var sr = 0; sr < segmentsToRemove.length; sr++) {
        console.log(
          "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: removeOrphans segment "
          + getUndoDebugObjectLabel(segmentsToRemove[sr], sr) + " "
          + getUndoDebugObjectState(segmentsToRemove[sr])
        );
      }
      for (var mr = 0; mr < markersToRemove.length; mr++) {
        console.log(
          "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: removeOrphans marker "
          + getUndoDebugObjectLabel(markersToRemove[mr], mr) + " "
          + getUndoDebugObjectState(markersToRemove[mr])
        );
      }
    }
    canvas._removingOrphanLineByPoints = true;
    for (var r = 0; r < segmentsToRemove.length; r++) canvas.remove(segmentsToRemove[r]);
    for (var m = 0; m < markersToRemove.length; m++) canvas.remove(markersToRemove[m]);
    canvas._removingOrphanLineByPoints = false;
    logPointUndoEvent(canvas, "removeOrphans:end segRemoved=" + segmentsToRemove.length + " markerRemoved=" + markersToRemove.length);
    logLineByPointsStructure(canvas, "after removeOrphans");
  }

  /**
   * Supprime tous les marqueurs rouges (ligne par points) du canvas.
   * Utilisé au changement de mode ; en mode ligne par points on garde tous les marqueurs.
   * @param {fabric.Canvas} canvas
   */
  function removeAllLineByPointsMarkers(canvas) {
    if (!canvas) return;
    var objects = canvas.getObjects();
    var hadSkip = canvas._skipNextHistory;
    canvas._skipNextHistory = true;
    for (var i = objects.length - 1; i >= 0; i--) {
      if (isLineByPointsMarkerObject(objects[i])) canvas.remove(objects[i]);
    }
    canvas._lineByPointsPreview = null;
    if (!hadSkip) canvas._skipNextHistory = false;
  }

  // ========== Grille (couche DOM statique, hors Fabric) ==========

  /** Épaisseur des lignes de grille : fine (1 sur 4 = plus épaisse). */
  const GRID_LINE_WIDTH_THIN = 0.5;
  const GRID_LINE_WIDTH_THICK = 1.5;
  const GRID_THICK_EVERY = 4;
  /** Intensité par défaut des traits de grille (0–1). */
  const GRID_INTENSITY_DEFAULT = 0.5;
  /** Couleur des traits à intensité max (contraste élevé). */
  const GRID_STROKE_DARK = "#404040";

  /** Interpole entre deux couleurs hex (t = 0 → c1, t = 1 → c2). */
  function interpolateHex(c1, c2, t) {
    t = Math.max(0, Math.min(1, t));
    var r1 = parseInt(c1.slice(1, 3), 16), g1 = parseInt(c1.slice(3, 5), 16), b1 = parseInt(c1.slice(5, 7), 16);
    var r2 = parseInt(c2.slice(1, 3), 16), g2 = parseInt(c2.slice(3, 5), 16), b2 = parseInt(c2.slice(5, 7), 16);
    var r = Math.round(r1 + (r2 - r1) * t);
    var g = Math.round(g1 + (g2 - g1) * t);
    var b = Math.round(b1 + (b2 - b1) * t);
    return "#" + [r, g, b].map(function (x) { var s = x.toString(16); return s.length === 1 ? "0" + s : s; }).join("");
  }

  function drawGridLayer(gridEl, width, height, options) {
    if (!gridEl || !width || !height) return;
    gridEl.width = width;
    gridEl.height = height;
    var opts = options || {};
    var intensity = opts.gridIntensity != null ? opts.gridIntensity : GRID_INTENSITY_DEFAULT;
    intensity = Math.max(0, Math.min(1, Number(intensity)));
    var stroke;
    if (opts.stroke != null) stroke = opts.stroke;
    else if (intensity >= 1) stroke = GRID_STROKE_DARK;
    else if (intensity > 0) stroke = interpolateHex("#e8e8e8", GRID_STROKE_DARK, intensity);
    else stroke = "#e8e8e8";
    var strokeWidthThin = opts.strokeWidth != null ? opts.strokeWidth : GRID_LINE_WIDTH_THIN;
    var strokeWidthThick = opts.strokeWidthThick != null ? opts.strokeWidthThick : GRID_LINE_WIDTH_THICK;
    var ctx = gridEl.getContext("2d");
    if (!ctx) return;
    var backgroundColor = opts.backgroundColor || "#fafafa";
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = stroke;
    ctx.globalAlpha = intensity >= 1 ? 1 : intensity;

    var baseStep = width / GRID_SCALE;
    var zoom = Number(opts.zoom);
    if (!isFinite(zoom) || zoom <= 0) zoom = 1;
    var panX = Number(opts.panX);
    var panY = Number(opts.panY);
    if (!isFinite(panX)) panX = 0;
    if (!isFinite(panY)) panY = 0;
    var step = baseStep * zoom;
    if (!isFinite(step) || step <= 0) step = baseStep;

    var minCol = Math.floor((0 - panX) / step) - 1;
    var maxCol = Math.ceil((width - panX) / step) + 1;
    for (var i = minCol; i <= maxCol; i++) {
      ctx.lineWidth = (Math.abs(i) % GRID_THICK_EVERY === 0) ? strokeWidthThick : strokeWidthThin;
      var x = panX + i * step;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    var minRow = Math.floor((0 - panY) / step) - 1;
    var maxRow = Math.ceil((height - panY) / step) + 1;
    for (var j = minRow; j <= maxRow; j++) {
      ctx.lineWidth = (Math.abs(j) % GRID_THICK_EVERY === 0) ? strokeWidthThick : strokeWidthThin;
      var y = panY + j * step;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Crée une grille en couche DOM statique (canvas 2D) derrière le canvas Fabric.
   * Une ligne sur 4 est plus épaisse. gridIntensity (0–1) : opacité + interpolation vers GRID_STROKE_DARK pour max contraste.
   */
  function addGridLayer(container, width, height, options) {
    if (!container || !width || !height) return null;
    var gridEl = document.createElement("canvas");
    gridEl.setAttribute("data-fabric-grid", "true");
    gridEl.width = width;
    gridEl.height = height;
    gridEl.style.position = "absolute";
    gridEl.style.left = "0";
    gridEl.style.top = "0";
    gridEl.style.width = width + "px";
    gridEl.style.height = height + "px";
    gridEl.style.pointerEvents = "none";
    gridEl.style.zIndex = "0";
    gridEl.setAttribute("aria-hidden", "true");
    drawGridLayer(gridEl, width, height, options || {});
    container.style.position = "relative";
    container.insertBefore(gridEl, container.firstChild);
    return gridEl;
  }

  /**
   * Redessine la grille avec une nouvelle intensité (0–1). Supprime l'ancien canvas grille puis recrée.
   * @param {HTMLElement} wrapper - Élément wrapper (data-fabric="wrapper") qui porte _gridOpts, _gridWidth, _gridHeight
   */
  function redrawGridIntensity(wrapper, intensity) {
    if (!wrapper) return;
    var opts = wrapper._gridOpts || {};
    opts.gridIntensity = Math.max(0, Math.min(1, Number(intensity)));
    wrapper._gridOpts = opts;
    var w = wrapper._gridWidth;
    var h = wrapper._gridHeight;
    if (!w || !h) return;
    var gridEl = wrapper._gridEl;
    if (!gridEl || !gridEl.getContext) {
      var old = wrapper.querySelector ? wrapper.querySelector("[data-fabric-grid]") : null;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      gridEl = addGridLayer(wrapper, w, h, opts);
      wrapper._gridEl = gridEl;
      if (wrapper.firstChild !== gridEl && gridEl.parentNode) {
        wrapper.insertBefore(gridEl, wrapper.firstChild);
      }
      return;
    }
    drawGridLayer(gridEl, w, h, opts);
  }

  function getCanvasWrapper(canvas) {
    if (!canvas || !canvas.lowerCanvasEl || !canvas.lowerCanvasEl.parentNode) return null;
    var p = canvas.lowerCanvasEl.parentNode;
    var w = p.parentNode && p.parentNode.getAttribute && p.parentNode.getAttribute("data-fabric") === "wrapper" ? p.parentNode : p;
    if (!w || !w.getAttribute || w.getAttribute("data-fabric") !== "wrapper") return null;
    return w;
  }

  function syncGridToViewport(canvas) {
    if (!canvas) return;
    var wrapper = getCanvasWrapper(canvas);
    if (!wrapper || !wrapper._gridEl || !wrapper._gridWidth || !wrapper._gridHeight) return;
    var opts = wrapper._gridOpts || {};
    var vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
    opts.zoom = Number(vpt[0]) || 1;
    opts.panX = Number(vpt[4]) || 0;
    opts.panY = Number(vpt[5]) || 0;
    wrapper._gridOpts = opts;
    drawGridLayer(wrapper._gridEl, wrapper._gridWidth, wrapper._gridHeight, opts);
  }

  /**
   * Point de scène Fabric sous un couple clientX/clientY (milieu du pincement, etc.).
   * @param {fabric.Canvas} canvas
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }}
   */
  function getScenePointFromClient(canvas, clientX, clientY) {
    if (!canvas || !canvas.upperCanvasEl) return { x: 0, y: 0 };
    var fake = {
      clientX: clientX,
      clientY: clientY,
      target: canvas.upperCanvasEl,
      type: "pointermove",
    };
    if (typeof canvas.getScenePoint === "function") {
      var p = canvas.getScenePoint(fake);
      return { x: p.x, y: p.y };
    }
    var q = canvas.getPointer(fake);
    return { x: q.x, y: q.y };
  }

  function touchClientMidpoint(touches) {
    if (!touches || touches.length < 2) return null;
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  }

  function touchClientDistance(touches) {
    if (!touches || touches.length < 2) return 0;
    var dx = touches[0].clientX - touches[1].clientX;
    var dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Zoom / pan au tactile : 2 doigts (pincement + translation du milieu).
   * passive: false + touch-action: none pour éviter scroll navigateur.
   */
  function bindTouchViewportNavigation(canvas) {
    if (!canvas || !canvas.upperCanvasEl || canvas._touchViewportBound) return;
    canvas._touchViewportBound = true;
    canvas._touchNavActive = false;
    canvas._touchLastMid = null;
    canvas._touchLastDist = 0;

    var el = canvas.upperCanvasEl;
    if (canvas.lowerCanvasEl) {
      canvas.lowerCanvasEl.style.touchAction = "none";
    }
    el.style.touchAction = "none";

    function resetTouchNav() {
      canvas._touchNavActive = false;
      canvas._touchLastMid = null;
      canvas._touchLastDist = 0;
    }

    el.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches || e.touches.length !== 2) return;
        canvas._touchNavActive = true;
        canvas._touchLastMid = touchClientMidpoint(e.touches);
        canvas._touchLastDist = touchClientDistance(e.touches) || 1;
        e.preventDefault();
      },
      { capture: true, passive: false }
    );

    el.addEventListener(
      "touchmove",
      function (e) {
        if (!e.touches || e.touches.length < 2) {
          if (e.touches && e.touches.length < 2) resetTouchNav();
          return;
        }
        if (!canvas._touchNavActive) {
          canvas._touchNavActive = true;
          canvas._touchLastMid = touchClientMidpoint(e.touches);
          canvas._touchLastDist = touchClientDistance(e.touches) || 1;
        }
        e.preventDefault();
        var mid = touchClientMidpoint(e.touches);
        var dist = touchClientDistance(e.touches) || 1;
        var lastMid = canvas._touchLastMid;
        var lastDist = canvas._touchLastDist || dist;
        var scene = getScenePointFromClient(canvas, mid.x, mid.y);
        var cz = typeof canvas.getZoom === "function" ? canvas.getZoom() : (canvas.viewportTransform && canvas.viewportTransform[0]) || 1;
        var ratio = dist / lastDist;
        if (ratio < 0.5) ratio = 0.5;
        if (ratio > 2) ratio = 2;
        var nz = Math.max(VIEWPORT_MIN_ZOOM, Math.min(VIEWPORT_MAX_ZOOM, cz * ratio));
        if (fabric.Point) {
          canvas.zoomToPoint(new fabric.Point(scene.x, scene.y), nz);
        } else {
          canvas.zoomToPoint({ x: scene.x, y: scene.y }, nz);
        }
        if (lastMid) {
          var vpt = (canvas.viewportTransform || [1, 0, 0, 1, 0, 0]).slice();
          vpt[4] += mid.x - lastMid.x;
          vpt[5] += mid.y - lastMid.y;
          canvas.setViewportTransform(vpt);
        }
        canvas._touchLastMid = mid;
        canvas._touchLastDist = dist;
        syncGridToViewport(canvas);
        canvas.requestRenderAll();
      },
      { capture: true, passive: false }
    );

    function onTouchEndOrCancel(e) {
      if (!e.touches || e.touches.length < 2) resetTouchNav();
    }
    el.addEventListener("touchend", onTouchEndOrCancel, { capture: true, passive: true });
    el.addEventListener("touchcancel", onTouchEndOrCancel, { capture: true, passive: true });
  }

  function bindViewportNavigation(canvas) {
    if (!canvas || canvas._viewportNavigationBound) return;
    canvas._viewportNavigationBound = true;
    canvas._isPanningView = false;

    bindTouchViewportNavigation(canvas);

    canvas.on("mouse:wheel", function (opt) {
      var e = opt && opt.e;
      if (!e) return;
      var delta = e.deltaY || 0;
      var currentZoom = typeof canvas.getZoom === "function" ? canvas.getZoom() : ((canvas.viewportTransform && canvas.viewportTransform[0]) || 1);
      /* Pincement trackpad / Chrome (souvent ctrlKey + wheel) */
      var zoomFactor = e.ctrlKey ? Math.pow(0.998, delta) : Math.pow(0.999, delta);
      var zoom = currentZoom * zoomFactor;
      zoom = Math.max(VIEWPORT_MIN_ZOOM, Math.min(VIEWPORT_MAX_ZOOM, zoom));
      if (typeof canvas.zoomToPoint === "function") {
        var sp = getScenePointFromClient(canvas, e.clientX, e.clientY);
        if (fabric.Point) canvas.zoomToPoint(new fabric.Point(sp.x, sp.y), zoom);
        else canvas.zoomToPoint({ x: sp.x, y: sp.y }, zoom);
      } else if (typeof canvas.setZoom === "function") {
        canvas.setZoom(zoom);
      }
      syncGridToViewport(canvas);
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    });

    canvas.on("mouse:down", function (opt) {
      var e = opt && opt.e;
      if (!e || !e.shiftKey) return;
      canvas._isPanningView = true;
      canvas._panLastX = e.clientX;
      canvas._panLastY = e.clientY;
      canvas._panPrevSelection = canvas.selection;
      canvas._panPrevSkipTarget = canvas.skipTargetFind;
      canvas._panPrevDrawingMode = canvas.isDrawingMode;
      canvas.selection = false;
      canvas.skipTargetFind = true;
      canvas.isDrawingMode = false;
      canvas.defaultCursor = "grabbing";
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    });

    canvas.on("mouse:move", function (opt) {
      if (!canvas._isPanningView) return;
      var e = opt && opt.e;
      if (!e) return;
      var vpt = canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      var dx = e.clientX - (canvas._panLastX || e.clientX);
      var dy = e.clientY - (canvas._panLastY || e.clientY);
      vpt[4] += dx;
      vpt[5] += dy;
      canvas.setViewportTransform(vpt);
      canvas._panLastX = e.clientX;
      canvas._panLastY = e.clientY;
      syncGridToViewport(canvas);
      canvas.requestRenderAll();
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
    });

    canvas.on("mouse:up", function (opt) {
      if (!canvas._isPanningView) return;
      var e = opt && opt.e;
      canvas._isPanningView = false;
      canvas.selection = canvas._panPrevSelection != null ? canvas._panPrevSelection : true;
      canvas.skipTargetFind = canvas._panPrevSkipTarget != null ? canvas._panPrevSkipTarget : false;
      canvas.isDrawingMode = canvas._panPrevDrawingMode != null ? canvas._panPrevDrawingMode : false;
      canvas.defaultCursor = "default";
      syncGridToViewport(canvas);
      canvas.requestRenderAll();
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
    });
  }

  /**
   * Ajoute la grille statique au conteneur ou au conteneur du canvas Fabric.
   */
  function addGrid(containerOrCanvas, opts) {
    opts = opts || {};
    var container, w, h;
    if (containerOrCanvas && containerOrCanvas.lowerCanvasEl) {
      var c = containerOrCanvas;
      container = c.lowerCanvasEl.parentNode && c.lowerCanvasEl.parentNode.parentNode ? c.lowerCanvasEl.parentNode.parentNode : c.lowerCanvasEl.parentNode;
      w = c.width;
      h = c.height;
    } else if (containerOrCanvas && containerOrCanvas.appendChild) {
      container = containerOrCanvas;
      w = opts.width || DEFAULT_WIDTH;
      h = opts.height || DEFAULT_HEIGHT;
    } else {
      return null;
    }
    return addGridLayer(container, w, h, opts);
  }

  /**
   * Initialise le canvas Fabric dans le conteneur DOM donné.
   * @param {string} containerId - Id de l’élément conteneur
   * @param {Object} [opts] - { width, height }
   * @returns {fabric.Canvas}
   */
  function initCanvas(containerId, opts) {
    const el = typeof containerId === "string" ? document.getElementById(containerId) : containerId;
    // Vérifications explicites pour éviter "Container introuvable" quand l'élément n'est pas encore monté (ex. modal React sur tablette)
    if (!el) throw new Error("Container introuvable (élément absent).");
    if (typeof el.appendChild !== "function") throw new Error("Container introuvable (élément invalide).");
    if (el !== document.body && !el.isConnected) throw new Error("Container introuvable (élément non monté dans le DOM).");
    var existing = el.querySelector ? el.querySelector("[data-fabric=\"wrapper\"]") : null;
    if (existing && existing._fabricCanvas) return existing._fabricCanvas;
    const w = (opts && opts.width) || DEFAULT_WIDTH;
    const h = (opts && opts.height) || DEFAULT_HEIGHT;
    var wrapperDiv = document.createElement("div");
    wrapperDiv.setAttribute("data-fabric", "wrapper");
    wrapperDiv.style.position = "relative";
    wrapperDiv.style.width = w + "px";
    wrapperDiv.style.height = h + "px";
    wrapperDiv.style.flexShrink = "0";
    var gridOpts = { backgroundColor: "#fafafa", gridIntensity: GRID_INTENSITY_DEFAULT };
    wrapperDiv._gridOpts = gridOpts;
    wrapperDiv._gridWidth = w;
    wrapperDiv._gridHeight = h;
    wrapperDiv._gridEl = addGridLayer(wrapperDiv, w, h, gridOpts);
    var canvasEl = document.createElement("canvas");
    canvasEl.id = CANVAS_ID;
    wrapperDiv.appendChild(canvasEl);
    el.appendChild(wrapperDiv);
    const canvas = new fabric.Canvas(CANVAS_ID, {
      width: w,
      height: h,
      backgroundColor: "transparent",
      selection: true,
      preserveObjectStacking: true,
    });
    canvas._debugId = ++CANVAS_DEBUG_SEQ;
    LAST_FABRIC_CANVAS = canvas;
    if (isPointUndoDebugEnabled()) {
      console.info("[FD#" + canvas._debugId + "] pointUndo debug actif");
    }
    wrapperDiv._fabricCanvas = canvas;
    if (canvas.lowerCanvasEl && canvas.lowerCanvasEl.parentNode) {
      canvas.lowerCanvasEl.parentNode.style.position = "relative";
      canvas.lowerCanvasEl.parentNode.style.zIndex = "1";
    }
    wrapRequestRenderAll(canvas);
    initUndoHistory(canvas);
    canvas._strokeWidth = DEFAULT_STROKE_WIDTH;
    canvas._lineStroke = DEFAULT_LINE_STROKE;
    bindViewportNavigation(canvas);
    syncGridToViewport(canvas);
    return canvas;
  }

  /**
   * Recrée la référence canvas sur les objets d'une sélection/group si elle manque
   * (évite TypeError getRetinaScaling sur grandes sélections).
   * @param {fabric.Canvas} canvas
   * @param {fabric.Object} obj
   */
  function ensureObjectCanvasRef(obj, canvas) {
    if (!obj || !canvas) return;
    if (obj.canvas !== canvas) obj.canvas = canvas;
    var objects = obj._objects || (obj.getObjects && obj.getObjects());
    if (objects && Array.isArray(objects)) {
      for (var i = 0; i < objects.length; i++) ensureObjectCanvasRef(objects[i], canvas);
    }
  }

  /**
   * Enveloppe requestRenderAll pour recoller la ref canvas sur la sélection active
   * et rattraper l'erreur getRetinaScaling (grandes sélections).
   * @param {fabric.Canvas} canvas
   */
  function wrapRequestRenderAll(canvas) {
    if (!canvas) return;
    var orig = canvas.requestRenderAll.bind(canvas);
    canvas.requestRenderAll = function () {
      var active = canvas.getActiveObject();
      if (active) {
        active.canvas = canvas;
        ensureObjectCanvasRef(active, canvas);
      }
      try {
        orig();
      } catch (e) {
        if (e instanceof TypeError && e.message && String(e.message).indexOf("getRetinaScaling") !== -1) {
          canvas.discardActiveObject();
          orig();
        } else {
          throw e;
        }
      }
    };
  }

  /**
   * Log les positions (left, top) de tous les objets en coordonnées post-magnétisme (snap appliqué pour l’affichage).
   * Pour diagnostiquer le décalage après undo.
   * @param {fabric.Canvas} canvas
   * @param {string} label - Contexte (ex. "after add", "after undo")
   */
  /** Log simple pour une action modifiant la position d'un objet. */
  function logPositionAction(canvas, action) {
    if (!FABRIC_DRAWING_VERBOSE_LOGS || !canvas || !action) return;
    console.log("[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] " + action);
  }

  /**
   * Retourne un libellé court pour identifier un objet dans les logs undo.
   * @param {fabric.Object} obj
   * @param {number} index
   * @returns {string}
   */
  function getUndoDebugObjectLabel(obj, index) {
    if (!obj) return "#" + index + " <null>";
    var label = "#" + index + " " + (obj.type || "object");
    if (obj._isLineGroup) label += " lineGroup";
    if (isLineByPointsMarkerObject(obj)) label += " marker";
    return label;
  }

  /**
   * Indique si un objet est pertinent pour diagnostiquer le décalage des tracés à main levée.
   * @param {fabric.Object} obj
   * @returns {boolean}
   */
  function isUndoDebugRelevantObject(obj) {
    if (!obj) return false;
    if (isPointUndoDebugEnabled() && (isLineByPointsMarkerObject(obj) || obj._isLineGroup)) return true;
    return obj.type === "path";
  }

  /**
   * Retourne un instantané texte des coordonnées utiles d'un objet pour diagnostiquer un déplacement après undo.
   * @param {fabric.Object} obj
   * @returns {string}
   */
  function getUndoDebugObjectState(obj) {
    if (!obj) return "state=<null>";
    var parts = [];
    parts.push("left=" + (obj.left != null ? obj.left : "null"));
    parts.push("top=" + (obj.top != null ? obj.top : "null"));
    parts.push("angle=" + (obj.angle != null ? obj.angle : "null"));
    if (obj.pathOffset) parts.push("pathOffset=(" + obj.pathOffset.x + "," + obj.pathOffset.y + ")");
    if (obj.path && Array.isArray(obj.path)) parts.push("commands=" + obj.path.length);
    if (obj.start_point && obj.end_point) {
      parts.push("start=(" + obj.start_point.x + "," + obj.start_point.y + ")");
      parts.push("end=(" + obj.end_point.x + "," + obj.end_point.y + ")");
    }
    if (obj.width != null || obj.height != null) {
      parts.push("size=(" + (obj.width != null ? obj.width : "null") + "," + (obj.height != null ? obj.height : "null") + ")");
    }
    return parts.join(" ");
  }

  /**
   * Log l'état des objets du canvas à un instant donné du flux undo.
   * @param {fabric.Canvas} canvas
   * @param {string} label
   */
  /**
   * Formate une matrice 2D Fabric (6 nombres) pour les logs.
   * @param {Array<number>|null|undefined} m
   * @returns {string}
   */
  function formatDebugMatrix6(m) {
    if (m == null) return "null";
    if (typeof m.length === "number" && m.length >= 6) {
      return "[" + m[0] + "," + m[1] + "," + m[2] + "," + m[3] + "," + m[4] + "," + m[5] + "]";
    }
    return String(m);
  }

  /**
   * Logs détaillés pour analyser le décalage entre le Path dessiné et la polyline « dessin par points ».
   * Compare repères locaux, matrices, viewport et premiers points canvas calculés.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Path} path
   * @param {string} phase - Libellé d’étape (ex. extracted, afterSimplify)
   * @param {Array<{x:number,y:number}>|null} canvasPts - Points déjà projetés en canvas (si disponible)
   * @param {boolean} [fullDetail] - Si false, uniquement le résumé des canvasPts (défaut true)
   */
  function logDrawByPointsConversionDebug(canvas, path, phase, canvasPts, fullDetail) {
    if (!FABRIC_DRAWING_VERBOSE_LOGS) return;
    var id = canvas && canvas._debugId != null ? canvas._debugId : "?";
    var tag = "[FD#" + id + "] drawByPoints[" + phase + "]";
    if (fullDetail === false) {
      if (canvasPts && canvasPts.length > 0) {
        var la = canvasPts[canvasPts.length - 1];
        console.log(tag + " canvasPts n=" + canvasPts.length + " first=" + JSON.stringify(canvasPts[0]) + " last=" + JSON.stringify(la));
      } else {
        console.log(tag + " canvasPts vides");
      }
      return;
    }
    if (!path) {
      console.log(tag + " path=null");
      return;
    }
    console.log(tag + " ========== diagnostic décalage Path → polyline ==========");
    console.log(tag + " left=" + path.left + " top=" + path.top + " angle=" + path.angle + " scaleX=" + path.scaleX + " scaleY=" + path.scaleY);
    console.log(tag + " skewX=" + path.skewX + " skewY=" + path.skewY + " originX=" + path.originX + " originY=" + path.originY + " flipX=" + path.flipX + " flipY=" + path.flipY);
    if (path.pathOffset) console.log(tag + " pathOffset=(" + path.pathOffset.x + "," + path.pathOffset.y + ")");
    console.log(tag + " width=" + path.width + " height=" + path.height);
    if (canvas && canvas.viewportTransform) {
      console.log(tag + " viewportTransform=" + formatDebugMatrix6(canvas.viewportTransform));
    }
    if (typeof path.calcTransformMatrix === "function") {
      console.log(tag + " calcTransformMatrix=" + formatDebugMatrix6(path.calcTransformMatrix()));
    }
    var combined = getPathToCanvasTransformMatrix(path);
    console.log(tag + " matrix×translate(-pathOffset) [comme transformPath]=" + formatDebugMatrix6(combined));
    var locals = extractLocalPointsFromPathSegments(path.path);
    console.log(tag + " sommets locaux path.path n=" + locals.length + " [0]=" + (locals[0] ? "(" + locals[0].x + "," + locals[0].y + ")" : "—"));
    if (locals.length >= 1 && fabric.util && typeof fabric.util.transformPoint === "function") {
      var p0 = locals[0];
      var mRaw = path.calcTransformMatrix();
      var pOnlyObj = fabric.util.transformPoint({ x: p0.x, y: p0.y }, mRaw);
      var pWithOffset = combined ? fabric.util.transformPoint({ x: p0.x, y: p0.y }, combined) : null;
      console.log(tag + " 1er pt: transformPoint(sans corr pathOffset)=" + JSON.stringify(pOnlyObj));
      console.log(tag + " 1er pt: transformPoint(avec corr pathOffset)=" + (pWithOffset ? JSON.stringify(pWithOffset) : "null"));
    }
    if (fabric.util && typeof fabric.util.transformPath === "function") {
      try {
        var po = path.pathOffset || { x: 0, y: 0 };
        if (typeof po.x !== "number") po = { x: 0, y: 0 };
        var td = fabric.util.transformPath(clonePathSegments(path.path), path.calcTransformMatrix(), po);
        var fp = extractLocalPointsFromPathSegments(td);
        console.log(tag + " 1er pt: via fabric.util.transformPath=" + (fp[0] ? JSON.stringify(fp[0]) : "—") + " (à comparer avec canvasPts[0])");
      } catch (e) {
        console.log(tag + " transformPath exception: " + (e && e.message ? e.message : e));
      }
    } else {
      console.log(tag + " fabric.util.transformPath absent (repli manuel)");
    }
    if (typeof path.getBoundingRect === "function") {
      try {
        var brA = path.getBoundingRect(true);
        if (brA) console.log(tag + " getBoundingRect(absolute) left=" + brA.left + " top=" + brA.top + " w=" + brA.width + " h=" + brA.height);
      } catch (e1) { console.log(tag + " getBoundingRect(true) err: " + e1); }
      try {
        var brR = path.getBoundingRect();
        if (brR) console.log(tag + " getBoundingRect() left=" + brR.left + " top=" + brR.top + " w=" + brR.width + " h=" + brR.height);
      } catch (e2) { console.log(tag + " getBoundingRect() err: " + e2); }
    }
    if (typeof path.getCenterPoint === "function") {
      try {
        var c = path.getCenterPoint();
        if (c) console.log(tag + " getCenterPoint()=" + JSON.stringify(c));
      } catch (e3) { /* ignore */ }
    }
    if (canvasPts && canvasPts.length > 0) {
      var last = canvasPts[canvasPts.length - 1];
      console.log(tag + " canvasPts count=" + canvasPts.length + " [0]=" + JSON.stringify(canvasPts[0]) + " [last]=" + JSON.stringify(last));
      if (locals.length >= 1) {
        var dTr = fabric.util && fabric.util.transformPath ? "voir ligne transformPath" : "";
        console.log(tag + " Comparer: si 1er marqueur rouge ne coïncide pas avec le trait, écart entre getBoundingRect(absolute) et canvasPts[0] indique le bug de repère.");
      }
    } else {
      console.log(tag + " canvasPts vides ou absents");
    }
    console.log(tag + " ========================================================");
  }

  function logUndoPositionSnapshot(canvas, label) {
    if (!FABRIC_DRAWING_VERBOSE_LOGS || !canvas || !canvas.getObjects) return;
    var objects = canvas.getObjects();
    var relevantCount = 0;
    for (var i = 0; i < objects.length; i++) {
      if (!isUndoDebugRelevantObject(objects[i])) continue;
      relevantCount++;
    }
    console.log("[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] undo snapshot: " + label + " paths=" + relevantCount);
    for (var j = 0; j < objects.length; j++) {
      if (!isUndoDebugRelevantObject(objects[j])) continue;
      console.log(
        "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] undo snapshot: "
        + label + " " + getUndoDebugObjectLabel(objects[j], j) + " "
        + getUndoDebugObjectState(objects[j])
      );
    }
  }

  /**
   * Retourne un résumé de l'état canvas pour les logs de diagnostic.
   * @param {fabric.Canvas} canvas
   * @returns {{total:number,markers:number,segments:number,orphans:number,history:number}}
   */
  function getCanvasDebugState(canvas) {
    if (!canvas) return { total: 0, markers: 0, segments: 0, orphans: 0, history: 0 };
    var objs = canvas.getObjects ? canvas.getObjects() : [];
    var markers = 0;
    var segments = 0;
    var orphans = 0;
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      if (isLineByPointsMarkerObject(o)) markers++;
      if (o._isLineGroup && o.start_point && o.end_point) {
        segments++;
        if (!o._segmentStartMarker || !o._segmentEndMarker) orphans++;
      }
    }
    return {
      total: objs.length,
      markers: markers,
      segments: segments,
      orphans: orphans,
      history: canvas._history ? canvas._history.length : 0,
    };
  }

  /**
   * Formate un état canvas en chaîne courte pour logs.
   * @param {{total:number,markers:number,segments:number,orphans:number,history:number}} st
   * @returns {string}
   */
  function shortState(st) {
    return "h=" + st.history + " t=" + st.total + " m=" + st.markers + " s=" + st.segments + " o=" + st.orphans;
  }

  /**
   * Initialise l'historique pour Annuler (backwards). Enregistre l'état initial et écoute les changements.
   * @param {fabric.Canvas} canvas
   */
  function initUndoHistory(canvas) {
    if (!canvas) return;
    canvas._history = [];
    canvas._historyLimit = 100;
    canvas._skipNextHistory = false;
    canvas._historyDirty = false;
    saveUndoState(canvas, { reason: "init" });
    canvas.on("before:transform", function (opt) {
      var tr = opt && opt.transform;
      if (tr && selectionOrObjectContainsLineByPointsMarker(tr.target)) {
        logPointUndoEvent(
          canvas,
          "before:transform action=" + (tr.action || "null") + " target=" + getUndoDebugObjectState(tr.target)
        );
        logLineByPointsStructure(canvas, "before:transform structure");
      }
      blockLineByPointsMarkerScaleInBeforeTransform(opt);
      commitDirtyLineByPointsStateBeforeTransform(canvas, opt);
    });
    canvas.on("object:added", function (opt) {
      if (opt && opt.target) {
        var t = opt.target;
        if (isLineByPointsMarkerObject(t)) return;
        if (t._isLineGroup && t._segmentStartMarker && t._segmentEndMarker) return;
        /* Dessin à main levée : ne pas sauver ici ; path:created enregistre une seule étape (tracé + post-traitement). */
        if (t.type === "path") return;
      }
      saveUndoState(canvas, { reason: "object:added" });
    });
    canvas.on("object:modified", function (opt) {
      if (canvas._applyingTraceSnap) return;
      if (canvas._reapplyingLineByPointsMarkerContracts) return;
      /* Marqueur(s) ligne par points / dessin par points : un seul point ou ActiveSelection (plusieurs points). */
      var lineMarkers = opt && opt.target ? getLineByPointsMarkersFromTarget(opt.target) : [];
      if (lineMarkers.length > 0) {
        var mi;
        for (mi = 0; mi < lineMarkers.length; mi++) {
          applyTraceSnapToObject(canvas, lineMarkers[mi]);
        }
        for (mi = 0; mi < lineMarkers.length; mi++) {
          updateLineFromMarker(canvas, lineMarkers[mi]);
        }
      }
      if (opt && opt.target) {
        logPositionAction(canvas, "déplacement / modification objet");
        if (isLineByPointsMarkerObject(opt.target)) {
          /* déjà traité plus haut */
        } else if (isFabricMultiSelection(opt.target) && opt.target.getObjects) {
          var selObjs = opt.target.getObjects();
          for (var so = 0; so < selObjs.length; so++) {
            if (!isLineByPointsMarkerObject(selObjs[so])) {
              applyTraceSnapToObject(canvas, selObjs[so]);
            }
          }
        } else {
          applyTraceSnapToObject(canvas, opt.target);
        }
      }
      reapplyLineByPointsMarkerContractsQuiet(canvas);
      if (lineMarkers.length > 0) {
        logPointUndoEvent(canvas, "object:modified markers=" + lineMarkers.length);
        logLineByPointsStructure(canvas, "after object:modified");
      }
      saveUndoState(canvas, {
        reason: lineMarkers.length > 0 ? "lineByPoints:marker-moved" : "object:modified",
      });
    });
    /* Pendant la mise à l’échelle : marqueur seul OU ActiveSelection (tous les points du groupe). */
    canvas.on("object:scaling", function (opt) {
      if (canvas._reapplyingLineByPointsMarkerContracts || canvas._applyingTraceSnap) return;
      squashLineByPointsMarkerScaleOnTarget(canvas, opt && opt.target);
    });
    /* Après toute action souris : réinitialise scale / verrous (transform groupe parfois sans object:modified sur chaque enfant). */
    canvas.on("mouse:up", function () {
      if (canvas._reapplyingLineByPointsMarkerContracts || canvas._applyingTraceSnap) return;
      reapplyLineByPointsMarkerContractsQuiet(canvas);
    });
    canvas.on("object:removed", function () {
      if (canvas._removingLineByPointsMarkers || canvas._deletingSelection || canvas._removingOrphanLineByPoints) return;
      saveUndoState(canvas, { reason: "object:removed" });
    });
    canvas.on("path:created", function (opt) {
      if (opt && opt.path && canvas._fabricDrawingVariant === "byPoints") {
        canvas._applyingTraceSnap = true;
        try {
          snapPathPointsToGrid(canvas, opt.path);
        } finally {
          canvas._applyingTraceSnap = false;
        }
        var pathObj = opt.path;
        var strokeOpts = {
          stroke: pathObj.stroke || DEFAULT_LINE_STROKE,
          strokeWidth: pathObj.strokeWidth != null ? pathObj.strokeWidth : DEFAULT_STROKE_WIDTH,
        };
        var mergedOpts = Object.assign({}, canvas._twoPointOptions || {}, strokeOpts);
        var canvasPts = extractCanvasPointsFromFreehandPath(pathObj);
        logDrawByPointsConversionDebug(canvas, pathObj, "afterExtract", canvasPts);
        dedupeNearbyPolylinePoints(canvasPts, 0.5);
        if (canvasPts.length >= 3) {
          var simplified = simplifyPolylineDouglasPeucker(canvasPts, DRAW_BY_POINTS_SIMPLIFY_EPSILON);
          if (simplified && simplified.length >= 2) canvasPts = simplified;
        }
        logDrawByPointsConversionDebug(canvas, pathObj, "afterDedupeSimplify", canvasPts, false);
        snapPolylineCanvasPointsToGrid(canvas, canvasPts);
        snapPolylineCanvasPointsToTrace(canvas, canvasPts);
        if (canvasPts.length < 2) {
          canvas._applyingTraceSnap = true;
          try {
            pathObj.set("strokeUniform", true);
            pathObj.set("padding", MIN_SELECTION_PADDING);
          } finally {
            canvas._applyingTraceSnap = false;
          }
          saveUndoState(canvas, { reason: "path:created" });
          return;
        }
        canvas._skipNextHistory = true;
        try {
          canvas.remove(pathObj);
          buildPolylineFromCanvasPointsImpl(canvas, canvasPts, mergedOpts);
        } finally {
          canvas._skipNextHistory = false;
        }
        if (canvas._history) saveUndoState(canvas, { reason: "drawByPoints:converted" });
        canvas.requestRenderAll();
        return;
      }
      if (opt && opt.path) {
        canvas._applyingTraceSnap = true;
        try {
          logPositionAction(canvas, "path:created before snap {" + getUndoDebugObjectState(opt.path) + "}");
          snapPathPointsToGrid(canvas, opt.path);
          opt.path.set("strokeUniform", true);
          opt.path.set("padding", MIN_SELECTION_PADDING);
          logPositionAction(canvas, "path:created after snap {" + getUndoDebugObjectState(opt.path) + "}");
        } finally {
          canvas._applyingTraceSnap = false;
        }
      }
      saveUndoState(canvas, { reason: "path:created" });
    });
  }

  /**
   * Enregistre l'état actuel du canvas dans l'historique (sauf si _skipNextHistory).
   * @param {fabric.Canvas} canvas
   * @param {{ keepPreview?: boolean }} [options] - keepPreview: true pour sauver avant ajout segment+point (garder le preview dans le JSON)
   */
  function saveUndoState(canvas, options) {
    if (!canvas || !canvas._history) return;
    if (canvas._skipNextHistory) return;
    try {
      var keepPreview = options && options.keepPreview;
      var reason = options && options.reason ? options.reason : "unspecified";
      /**
       * Ne retirer le « preview » du canvas avant toJSON que pour le tout premier point (un seul marqueur, non relié).
       * Dès qu’il y a plusieurs sommets, le dernier point est aussi un sommet du polygone : le retirer casserait le snapshot.
       */
      var marker = keepPreview ? null : canvas._lineByPointsPreview;
      if (marker) {
        var mc = 0;
        var ox = canvas.getObjects();
        var ii;
        for (ii = 0; ii < ox.length; ii++) {
          if (isLineByPointsMarkerObject(ox[ii])) mc++;
        }
        if (mc > 1 || isLineByPointsMarkerAttachedToSegment(canvas, marker)) marker = null;
      }
      canvas._skipNextHistory = true;
      if (marker) canvas.remove(marker);
      var json = canvas.toJSON([
        "_isLineByPointsMarker",
        "_isLineGroup",
        "start_point",
        "end_point",
        "_lineOptions",
      ]);
      json = cloneSerializableValue(json);
      if (marker) canvas.add(marker);
      canvas._skipNextHistory = false;
      var last = canvas._lineByPointsLast;
      var savedLast = last ? { x: last.x, y: last.y } : null;
      canvas._history.push({ json: json, _lineByPointsLast: savedLast });
      if (isPointUndoDebugEnabled()) {
        var jsonObjects = json && json.objects ? json.objects : [];
        var jsonMarkers = 0;
        var jsonSegments = 0;
        var ji;
        for (ji = 0; ji < jsonObjects.length; ji++) {
          if (jsonObjects[ji] && jsonObjects[ji]._isLineByPointsMarker) jsonMarkers++;
          if (jsonObjects[ji] && jsonObjects[ji]._isLineGroup) jsonSegments++;
        }
        console.log(
          "[FD#" + (canvas._debugId != null ? canvas._debugId : "?") + "] pointUndo: saveUndoState"
          + " reason=" + reason
          + " keepPreview=" + !!keepPreview
          + " removedPreview=" + !!marker
          + " jsonMarkers=" + jsonMarkers
          + " jsonSegments=" + jsonSegments
          + " " + getPointUndoHistorySummary(canvas)
        );
      }
      if (reason === "path:created") {
        logPositionAction(canvas, "saveUndoState:path:created history=" + canvas._history.length);
        logUndoPositionSnapshot(canvas, "saveUndoState:path:created");
      }
      if (canvas._history.length > canvas._historyLimit) canvas._history.shift();
      canvas._historyDirty = false;
    } catch (e) {
      canvas._skipNextHistory = false;
    }
  }

  /**
   * Annule la dernière action : restaure l'état précédent du canvas.
   * Fabric v6 : loadFromJSON retourne une Promise — utiliser await sur la valeur de retour.
   * @param {fabric.Canvas} canvas
   * @returns {Promise<void>}
   */
  function undo(canvas) {
    if (!canvas || !canvas._history) {
      console.warn("[FabricDrawing] undo — pas d'historique (canvas ou _history absent)");
      return Promise.resolve();
    }
    if (canvas._history.length < 1) return Promise.resolve();
    canvas._skipNextHistory = true;
    var target = null;
    /** Si dirty, le canvas est en avance sur la pile : dernier push = état à restaurer sans le retirer (sinon l'undo suivant saute une étape). */
    if (canvas._historyDirty) {
      target = canvas._history[canvas._history.length - 1];
    } else {
      if (canvas._history.length < 2) {
        canvas._skipNextHistory = false;
        return Promise.resolve();
      }
      canvas._history.pop();
      target = canvas._history[canvas._history.length - 1];
    }
    var json = target && typeof target === "object" && "json" in target ? target.json : target;
    var savedLast = target && typeof target === "object" && target._lineByPointsLast != null ? target._lineByPointsLast : null;
    logPositionAction(
      canvas,
      "undo:start dirty=" + !!canvas._historyDirty
      + " history=" + canvas._history.length
      + " savedLast=" + (savedLast ? "(" + savedLast.x + "," + savedLast.y + ")" : "null")
    );
    logPointUndoEvent(canvas, "undo:start");
    logLineByPointsStructure(canvas, "before undo loadFromJSON");
    logUndoPositionSnapshot(canvas, "before loadFromJSON");

    function applyAfterLoad() {
      logUndoPositionSnapshot(canvas, "after loadFromJSON");
      canvas._lineByPointsPreview = null;
      canvas._lineByPointsLast = savedLast ? { x: savedLast.x, y: savedLast.y } : null;
      logPositionAction(canvas, "undo:applyAfterLoad — before reapplyCustomControls");
      reapplyCustomControls(canvas);
      logUndoPositionSnapshot(canvas, "after applyAfterLoad/reapplyCustomControls");
      logPositionAction(canvas, "undo:applyAfterLoad — before restoreLineByPointsMarker");
      restoreLineByPointsMarker(canvas);
      logUndoPositionSnapshot(canvas, "after applyAfterLoad/restoreLineByPointsMarker");
      canvas.requestRenderAll();
      canvas._skipNextHistory = false;
      canvas._historyDirty = false;
      logPointUndoEvent(canvas, "undo:applyAfterLoad:end");
      logLineByPointsStructure(canvas, "after undo applyAfterLoad");
      logPositionAction(canvas, "undo:applyAfterLoad — requestRenderAll");
    }

    var resetSkip = function () {
      canvas._skipNextHistory = false;
    };
    setTimeout(resetSkip, 300);

    function reviver(obj, fabricObj) {
      if (!obj || !fabricObj) return;
      if (obj._isLineByPointsMarker || (obj.type === "circle" && obj.fill === LINE_BY_POINTS_DEFAULT_FILL)) {
        fabricObj._isLineByPointsMarker = true;
        fabricObj._lineByPointsMarkerLine = null;
        applyLineByPointsMarkerInteractionContract(fabricObj);
      }
      if (obj._isLineGroup || (obj.start_point && obj.end_point)) {
        fabricObj.start_point = obj.start_point;
        fabricObj.end_point = obj.end_point;
        fabricObj._lineOptions = obj._lineOptions || fabricObj._lineOptions;
        fabricObj._isLineGroup = true;
      }
    }
    try {
      var result = canvas.loadFromJSON(json, reviver);
      if (result != null && typeof result.then === "function") {
        return result.then(applyAfterLoad).catch(function (err) {
          console.error("[FabricDrawing] undo — loadFromJSON rejeté:", err);
          canvas._skipNextHistory = false;
          throw err;
        });
      }
      canvas.loadFromJSON(json, reviver);
      applyAfterLoad();
      return Promise.resolve();
    } catch (e) {
      console.error("[FabricDrawing] undo — erreur loadFromJSON:", e);
      canvas._skipNextHistory = false;
      return Promise.reject(e);
    }
  }

  /**
   * Recrée le marqueur rouge du dernier point (ligne par points) après un undo.
   * @param {fabric.Canvas} canvas
   */
  function restoreLineByPointsMarker(canvas) {
    if (!canvas || !canvas._lineByPointsLast) return;
    logPointUndoEvent(canvas, "restoreMarker:start");
    logUndoPositionSnapshot(canvas, "before restoreLineByPointsMarker");
    var objects = canvas.getObjects();
    var tol = LINE_BY_POINTS_REATTACH_TOLERANCE;
    var existingMarker = null;
    for (var j = 0; j < objects.length; j++) {
      var om = objects[j];
      if (!isLineByPointsMarkerObject(om)) continue;
      var omc = getLineByPointsMarkerCanvasXY(om);
      var omlx = omc ? omc.x : om.left;
      var omly = omc ? omc.y : om.top;
      if (Math.abs((omlx || 0) - canvas._lineByPointsLast.x) <= tol && Math.abs((omly || 0) - canvas._lineByPointsLast.y) <= tol) {
        existingMarker = om;
        break;
      }
    }
    var lastLine = null;
    for (var i = objects.length - 1; i >= 0; i--) {
      if (objects[i]._isLineGroup) {
        lastLine = objects[i];
        break;
      }
    }
    if (existingMarker) {
      logPositionAction(
        canvas,
        "undo: restoreLineByPointsMarker — réutilise "
        + getUndoDebugObjectLabel(existingMarker, -1) + " "
        + getUndoDebugObjectState(existingMarker)
      );
      existingMarker._isLineByPointsMarker = true;
      existingMarker._lineByPointsMarkerLine = lastLine;
      applyLineByPointsMarkerInteractionContract(existingMarker);
      canvas._lineByPointsPreview = existingMarker;
    } else {
      canvas._lineByPointsPreview = createLineByPointsMarker(
        canvas._lineByPointsLast.x,
        canvas._lineByPointsLast.y,
        lastLine
      );
      logPositionAction(
        canvas,
        "undo: restoreLineByPointsMarker — crée preview "
        + getUndoDebugObjectState(canvas._lineByPointsPreview)
      );
      canvas.add(canvas._lineByPointsPreview);
    }
    reattachLineByPointsSegments(canvas);
    logLineByPointsStructure(canvas, "after restoreMarker");
    logUndoPositionSnapshot(canvas, "after restoreLineByPointsMarker");
  }

  /**
   * Réapplique les contrôles personnalisés après loadFromJSON (undo). Supprime les marqueurs visuels (ex. dernier point ligne par points).
   * @param {fabric.Canvas} canvas
   */
  function reapplyCustomControls(canvas) {
    if (!canvas) return;
    logUndoPositionSnapshot(canvas, "before reapplyCustomControls");
    reattachLineByPointsSegments(canvas);
    removeOrphanLineByPointsObjects(canvas);
    var objects = canvas.getObjects();
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if ((o._isLineGroup || o._arrowX1 != null) && o.padding !== PADDING_LINE_SELECTION) {
        logPositionAction(
          canvas,
          "undo: reapplyCustomControls — padding ligne/flèche "
          + getUndoDebugObjectLabel(o, i) + " " + getUndoDebugObjectState(o)
        );
        o.set("padding", PADDING_LINE_SELECTION);
      }
      if (o._isShapeGroup && o.padding !== MIN_SELECTION_PADDING) {
        logPositionAction(
          canvas,
          "undo: reapplyCustomControls — padding forme "
          + getUndoDebugObjectLabel(o, i) + " " + getUndoDebugObjectState(o)
        );
        o.set("padding", MIN_SELECTION_PADDING);
      }
      if (o.type === "path" && o.path && o.padding !== MIN_SELECTION_PADDING) {
        o.set("padding", MIN_SELECTION_PADDING);
      }
    }
    logUndoPositionSnapshot(canvas, "after reapplyCustomControls");
  }

  // ========== Modes (dessin, sélection, deux points) ==========

  // ========== Modes (dessin, sélection, ligne, flèche) ==========

  /** Noms des modes utilisables avec setMode. */
  const MODE_DRAW = "draw";
  const MODE_SELECT = "select";
  const MODE_LINE = "line";
  const MODE_ARROW = "arrow";
  const MODE_LINE_BY_POINTS = "lineByPoints";
  /** Dessin au crayon comme le mode dessin, puis conversion en polyline « ligne par points » (points rouges éditables). */
  const MODE_DRAW_BY_POINTS = "drawByPoints";
  const MODE_SHAPES = "shapes";

  /**
   * Active un seul mode et désactive toutes les autres possibilités (dessin libre, sélection, ligne, flèche).
   * Met à jour le bouton actif dans la barre d’outils.
   * @param {fabric.Canvas} canvas
   * @param {string} mode - 'draw' | 'select' | 'line' | 'arrow' | 'lineByPoints'
   * @param {Object} [options] - options du mode (ex. color, strokeWidth pour draw/line/arrow)
   */
  function setMode(canvas, mode, options) {
    if (!canvas) return;
    var opts = options ? Object.assign({}, options) : {};
    if (opts.strokeWidth == null && canvas._strokeWidth != null) opts.strokeWidth = canvas._strokeWidth;
    opts.strokeWidth = normalizeStrokeWidth(opts.strokeWidth, DEFAULT_STROKE_WIDTH);
    canvas._strokeWidth = opts.strokeWidth;
    if (opts.stroke != null) {
      canvas._lineStroke = opts.stroke;
    } else if (opts.color != null && mode !== MODE_DRAW && mode !== MODE_DRAW_BY_POINTS) {
      canvas._lineStroke = opts.color;
    }
    if (canvas._lineStroke == null) canvas._lineStroke = DEFAULT_LINE_STROKE;
    opts.stroke = canvas._lineStroke;
    clearTwoPointMode(canvas);

    switch (mode) {
      case MODE_DRAW:
        canvas._fabricDrawingVariant = "freehand";
        canvas.isDrawingMode = true;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        if (!canvas.freeDrawingBrush && fabric.PencilBrush) {
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        }
        if (canvas.freeDrawingBrush) {
          canvas.freeDrawingBrush.color = opts.stroke || opts.color || DEFAULT_STROKE;
          canvas.freeDrawingBrush.width = opts.strokeWidth != null ? opts.strokeWidth : DEFAULT_STROKE_WIDTH;
          canvas.freeDrawingBrush.decimate = FREEHAND_DECIMATE;
        }
        break;
      case MODE_DRAW_BY_POINTS:
        canvas._fabricDrawingVariant = "byPoints";
        canvas.isDrawingMode = true;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        /* Même magnétisme que le dessin libre : si pas défini ou 0, utiliser le pas par défaut grille. */
        if (canvas._freehandSnapStep == null || canvas._freehandSnapStep <= 0) {
          canvas._freehandSnapStep = LINE_BY_POINTS_SNAP_STEP;
        }
        if (!canvas.freeDrawingBrush && fabric.PencilBrush) {
          canvas.freeDrawingBrush = new fabric.PencilBrush(canvas);
        }
        if (canvas.freeDrawingBrush) {
          canvas.freeDrawingBrush.color = opts.stroke || opts.color || DEFAULT_STROKE;
          canvas.freeDrawingBrush.width = opts.strokeWidth != null ? opts.strokeWidth : DEFAULT_STROKE_WIDTH;
          canvas.freeDrawingBrush.decimate = FREEHAND_DECIMATE;
        }
        break;
      case MODE_SELECT:
        canvas._fabricDrawingVariant = null;
        canvas.isDrawingMode = false;
        canvas.selection = true;
        canvas.skipTargetFind = false;
        break;
      case MODE_LINE:
        canvas._fabricDrawingVariant = null;
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "line";
        canvas._twoPointOptions = opts;
        break;
      case MODE_ARROW:
        canvas._fabricDrawingVariant = null;
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "arrow";
        canvas._twoPointOptions = opts;
        break;
      case MODE_LINE_BY_POINTS:
        canvas._fabricDrawingVariant = null;
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "lineByPoints";
        canvas._twoPointOptions = opts;
        canvas._lineByPointsLast = null;
        break;
      case MODE_SHAPES:
        canvas._fabricDrawingVariant = null;
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "shape";
        canvas._shapeType = opts.shapeType || "square";
        canvas._twoPointOptions = opts;
        break;
      default:
        return;
    }

    setActiveModeButton(canvas, mode);
  }

  /**
   * Active le mode dessin libre (trait au doigt/souris).
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - { color, strokeWidth }
   */
  function setDrawingMode(canvas, options) {
    setMode(canvas, MODE_DRAW, options);
  }

  /**
   * Active le mode sélection (déplacement, rectangle de sélection au clic glissé).
   * @param {fabric.Canvas} canvas
   */
  function setSelectionMode(canvas) {
    setMode(canvas, MODE_SELECT);
  }

  /**
   * Quitte le mode ligne/flèche et supprime uniquement la prévisualisation (ligne/flèche/forme).
   * Ne supprime pas les marqueurs « ligne par points » : ils restent sur le canvas pour pouvoir
   * sélectionner et déplacer les points en mode sélection.
   * @param {fabric.Canvas} canvas
   */
  function clearTwoPointMode(canvas) {
    if (!canvas) return;
    canvas._twoPointMode = null;
    canvas._twoPointFirst = null;
    canvas._shapeDragActive = false;
    canvas._shapeType = null;
    canvas._lineByPointsLast = null;
    canvas._lineByPointsPreview = null;
    if (canvas._twoPointPreview) {
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
    }
    canvas.requestRenderAll();
  }

  // ========== Lignes (groupe avec start_point / end_point, même modèle que flèche) ==========

  /**
   * Reconstruit le segment de droite à l'intérieur du groupe à partir de start_point et end_point.
   * Si le groupe a _segmentStartMarker/_segmentEndMarker, synchronise d'abord les coordonnées depuis les marqueurs.
   * @param {fabric.Group} group - Groupe « ligne » (start_point, end_point, _lineOptions).
   */
  function rebuildLineGroup(group) {
    if (!group) return;
    if (group._segmentStartMarker) {
      group.start_point = group.start_point || {};
      var sPos = getLineByPointsMarkerCanvasXY(group._segmentStartMarker);
      if (sPos) {
        group.start_point.x = sPos.x;
        group.start_point.y = sPos.y;
      } else {
        group.start_point.x = group._segmentStartMarker.left;
        group.start_point.y = group._segmentStartMarker.top;
      }
    }
    if (group._segmentEndMarker) {
      group.end_point = group.end_point || {};
      var ePos = getLineByPointsMarkerCanvasXY(group._segmentEndMarker);
      if (ePos) {
        group.end_point.x = ePos.x;
        group.end_point.y = ePos.y;
      } else {
        group.end_point.x = group._segmentEndMarker.left;
        group.end_point.y = group._segmentEndMarker.top;
      }
    }
    if (!group.start_point || !group.end_point) return;
    const sx = group.start_point.x;
    const sy = group.start_point.y;
    const ex = group.end_point.x;
    const ey = group.end_point.y;
    const left = Math.min(sx, ex);
    const top = Math.min(sy, ey);
    const opts = group._lineOptions || {};
    const stroke = opts.stroke || DEFAULT_LINE_STROKE;
    const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
    const lx1 = sx - left;
    const ly1 = sy - top;
    const lx2 = ex - left;
    const ly2 = ey - top;
    const newLine = new fabric.Line([lx1, ly1, lx2, ly2], {
      stroke: stroke,
      strokeWidth: strokeWidth,
      selectable: false,
      evented: false,
      strokeUniform: true,
    });
    if (group.size() > 0) {
      group.remove(group.item(0));
    }
    group.add(newLine);
    group.set({ left: left, top: top, originX: "left", originY: "top" });
    group.setCoords();
    /* Fabric 6 peut recaler le groupe après l’évènement de layout : réaffirme le coin haut-gauche sur la frame suivante. */
    var gRef = group;
    var lSnap = left;
    var tSnap = top;
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(function () {
        if (!gRef || !gRef.canvas) return;
        gRef.set({ left: lSnap, top: tSnap, originX: "left", originY: "top" });
        gRef.setCoords();
        gRef.canvas.requestRenderAll();
      });
    }
  }

  /**
   * Crée un segment de droite défini par start_point et end_point (groupe + rebuild, comme la flèche).
   * @param {number} x1 - Abscisse départ
   * @param {number} y1 - Ordonnée départ
   * @param {number} x2 - Abscisse arrivée
   * @param {number} y2 - Ordonnée arrivée
   * @param {Object} [options] - { stroke, strokeWidth }
   * @returns {fabric.Group}
   */
  function createLine(x1, y1, x2, y2, options) {
    const opts = options || {};
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: opts.stroke || DEFAULT_LINE_STROKE,
      strokeWidth: opts.strokeWidth ?? DEFAULT_STROKE_WIDTH,
      selectable: false,
      evented: false,
      strokeUniform: true,
    });
    const group = new fabric.Group([line], {
      selectable: true,
      evented: true,
      padding: PADDING_LINE_SELECTION,
    });
    group.start_point = { x: x1, y: y1 };
    group.end_point = { x: x2, y: y2 };
    group._lineOptions = opts;
    group._isLineGroup = true;
    group.toObject = function (keysToInclude) {
      var obj = fabric.Group.prototype.toObject.call(this, keysToInclude);
      obj.start_point = cloneSerializableValue(this.start_point);
      obj.end_point = cloneSerializableValue(this.end_point);
      obj._lineOptions = cloneSerializableValue(this._lineOptions);
      obj._isLineGroup = this._isLineGroup;
      return obj;
    };
    rebuildLineGroup(group);
    return group;
  }

  /**
   * Crée un segment « ligne par points » : distance entre deux marqueurs.
   * Les coordonnées sont lues depuis les marqueurs ; déplacer un marqueur recalcule la ligne.
   * @param {fabric.Circle} markerStart - Marqueur point de départ
   * @param {fabric.Circle} markerEnd - Marqueur point d'arrivée
   * @param {Object} [options] - { stroke, strokeWidth }
   * @returns {fabric.Group}
   */
  function createLineSegmentBetweenMarkers(markerStart, markerEnd, options) {
    var p1 = getLineByPointsMarkerCanvasXY(markerStart);
    var p2 = getLineByPointsMarkerCanvasXY(markerEnd);
    var x1 = p1 ? p1.x : markerStart.left;
    var y1 = p1 ? p1.y : markerStart.top;
    var x2 = p2 ? p2.x : markerEnd.left;
    var y2 = p2 ? p2.y : markerEnd.top;
    var group = createLine(x1, y1, x2, y2, options);
    group._segmentStartMarker = markerStart;
    group._segmentEndMarker = markerEnd;
    group.lockMovementX = true;
    group.lockMovementY = true;
    group.hasBorders = false;
    group.hasControls = false;
    group.selectable = false;
    group.evented = false;
    var origToObject = group.toObject;
    group.toObject = function (keysToInclude) {
      var obj = origToObject.call(this, keysToInclude);
      obj._segmentStartMarker = undefined;
      obj._segmentEndMarker = undefined;
      return obj;
    };
    return group;
  }

  /**
   * Extrait les sommets locaux (repère du Path) depuis le tableau de segments Fabric/SVG.
   * @param {Array} segs
   * @returns {Array<{x:number,y:number}>}
   */
  function extractLocalPointsFromPathSegments(segs) {
    var out = [];
    if (!segs || !Array.isArray(segs)) return out;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!Array.isArray(seg) || seg.length < 2) continue;
      var cmd = seg[0];
      if (cmd === "M" || cmd === "L" || cmd === "Q" || cmd === "C" || cmd === "S" || cmd === "T") {
        for (var j = 1; j + 1 < seg.length; j += 2) {
          if (typeof seg[j] === "number" && typeof seg[j + 1] === "number") {
            out.push({ x: seg[j], y: seg[j + 1] });
          }
        }
      }
    }
    return out;
  }

  /**
   * Produit A×B de deux matrices 2×3 Fabric (identique à fabric.util.multiplyTransformMatrices).
   * @param {Array<number>} a
   * @param {Array<number>} b
   * @returns {Array<number>}
   */
  function multiplyTransformMatricesManual(a, b) {
    if (!a || !b || a.length < 6 || b.length < 6) return a && a.length >= 6 ? a.slice(0, 6) : b && b.length >= 6 ? b.slice(0, 6) : [1, 0, 0, 1, 0, 0];
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }

  /**
   * Applique une matrice 2×3 Fabric à un point (équivalent Point.transform / transformPoint).
   * @param {{x:number,y:number}} p
   * @param {Array<number>} m
   * @returns {{x:number,y:number}}
   */
  function transformPointWithMatrix6(p, m) {
    if (!p || !m || m.length < 6) return { x: p ? p.x : 0, y: p ? p.y : 0 };
    return {
      x: m[0] * p.x + m[2] * p.y + m[4],
      y: m[1] * p.x + m[3] * p.y + m[5],
    };
  }

  /**
   * Matrice Path → canvas : même logique que fabric.util.transformPath (translation −pathOffset puis objet).
   * Toujours composer manuellement si besoin : certaines builds n’exposent pas multiplyTransformMatrices sur fabric.util,
   * et sans composition le repli faisait left+lx (décalage majeur).
   * @param {fabric.Path} path
   * @returns {Array<number>|null}
   */
  function getPathToCanvasTransformMatrix(path) {
    if (!path || typeof path.calcTransformMatrix !== "function") return null;
    var m = path.calcTransformMatrix();
    var po = path.pathOffset;
    var ox = po && typeof po.x === "number" ? po.x : 0;
    var oy = po && typeof po.y === "number" ? po.y : 0;
    var translateNegOffset = [1, 0, 0, 1, -ox, -oy];
    if (fabric.util && typeof fabric.util.multiplyTransformMatrices === "function") {
      try {
        var combined = fabric.util.multiplyTransformMatrices(m, translateNegOffset);
        if (combined && combined.length >= 6) return combined;
      } catch (e) { /* repli manuel */ }
    }
    return multiplyTransformMatricesManual(m, translateNegOffset);
  }

  /**
   * Transforme un point du repère des commandes Path en coordonnées canvas.
   * N’utilise pas uniquement fabric.util.transformPoint (souvent absent / autre signature) : évite le repli left+lx.
   * @param {fabric.Path} path
   * @param {number} lx
   * @param {number} ly
   * @returns {{x:number,y:number}}
   */
  function transformPathLocalPointToCanvas(path, lx, ly) {
    var matrix = getPathToCanvasTransformMatrix(path);
    if (matrix) {
      return transformPointWithMatrix6({ x: lx, y: ly }, matrix);
    }
    if (typeof path.calcTransformMatrix === "function") {
      return transformPointWithMatrix6({ x: lx, y: ly }, path.calcTransformMatrix());
    }
    return { x: (path.left || 0) + lx, y: (path.top || 0) + ly };
  }

  /**
   * Extrait les sommets du tracé libre en coordonnées canvas (scène), alignés sur le rendu Fabric.
   * Utilise fabric.util.transformPath si disponible, sinon la même matrice que transformPath (pathOffset).
   * @param {fabric.Path} path
   * @returns {Array<{x:number,y:number}>}
   */
  function extractCanvasPointsFromFreehandPath(path) {
    if (!path || !path.path || !Array.isArray(path.path)) return [];
    if (typeof path.setCoords === "function") path.setCoords();
    var pathData = clonePathSegments(path.path);
    if (fabric.util && typeof fabric.util.transformPath === "function") {
      try {
        var po = path.pathOffset;
        if (!po || typeof po.x !== "number") po = { x: 0, y: 0 };
        var transformed = fabric.util.transformPath(pathData, path.calcTransformMatrix(), po);
        return extractLocalPointsFromPathSegments(transformed);
      } catch (e) {
        /* repli ci-dessous */
      }
    }
    var localPts = extractLocalPointsFromPathSegments(path.path);
    var canvasPts = [];
    for (var i = 0; i < localPts.length; i++) {
      canvasPts.push(transformPathLocalPointToCanvas(path, localPts[i].x, localPts[i].y));
    }
    return canvasPts;
  }

  /**
   * Distance d’un point au segment [a,b] (projection orthogonale bornée sur le segment).
   * @param {{x:number,y:number}} p
   * @param {{x:number,y:number}} a
   * @param {{x:number,y:number}} b
   * @returns {number}
   */
  function perpendicularDistanceToSegment(p, a, b) {
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-12) {
      var qx = p.x - a.x;
      var qy = p.y - a.y;
      return Math.sqrt(qx * qx + qy * qy);
    }
    var t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var px = a.x + t * dx;
    var py = a.y + t * dy;
    var vx = p.x - px;
    var vy = p.y - py;
    return Math.sqrt(vx * vx + vy * vy);
  }

  /**
   * Simplifie une polyline (Douglas–Peucker) pour réduire les points sur les alignements.
   * @param {Array<{x:number,y:number}>} points
   * @param {number} epsilon - Tolérance en pixels
   * @returns {Array<{x:number,y:number}>}
   */
  function simplifyPolylineDouglasPeucker(points, epsilon) {
    if (!points || points.length <= 2) return points ? points.slice() : [];
    var eps = epsilon > 0 ? epsilon : DRAW_BY_POINTS_SIMPLIFY_EPSILON;
    var first = points[0];
    var last = points[points.length - 1];
    var maxDist = 0;
    var maxIdx = 0;
    var i;
    for (i = 1; i < points.length - 1; i++) {
      var d = perpendicularDistanceToSegment(points[i], first, last);
      if (d > maxDist) {
        maxDist = d;
        maxIdx = i;
      }
    }
    if (maxDist > eps) {
      var left = simplifyPolylineDouglasPeucker(points.slice(0, maxIdx + 1), eps);
      var right = simplifyPolylineDouglasPeucker(points.slice(maxIdx), eps);
      return left.slice(0, -1).concat(right);
    }
    return [first, last];
  }

  /**
   * Supprime les points consécutifs trop proches (évite doublons après conversion).
   * @param {Array<{x:number,y:number}>} points
   * @param {number} eps
   */
  function dedupeNearbyPolylinePoints(points, eps) {
    if (!points || points.length === 0) return;
    var e = eps > 0 ? eps : 0.5;
    var out = [points[0]];
    for (var i = 1; i < points.length; i++) {
      var p = points[i];
      var prev = out[out.length - 1];
      var dx = p.x - prev.x;
      var dy = p.y - prev.y;
      if (dx * dx + dy * dy >= e * e) out.push(p);
    }
    points.length = 0;
    for (var j = 0; j < out.length; j++) points.push(out[j]);
  }

  /**
   * Construit un tracé « ligne par points » (marqueurs + segments) à partir de points canvas.
   * @param {fabric.Canvas} canvas
   * @param {Array<{x:number,y:number}>} points - Au moins 2 points
   * @param {Object} [options] - stroke, strokeWidth
   */
  function buildPolylineFromCanvasPointsImpl(canvas, points, options) {
    if (!canvas || !points || points.length < 2) return;
    var opts = options || {};
    var closeLoop = !!opts.closeLoop;
    var markers = [];
    var pi;
    for (pi = 0; pi < points.length; pi++) {
      markers.push(createLineByPointsMarker(points[pi].x, points[pi].y, null));
    }
    canvas.add(markers[0]);
    for (pi = 0; pi < points.length - 1; pi++) {
      canvas.add(createLineSegmentBetweenMarkers(markers[pi], markers[pi + 1], opts));
      canvas.add(markers[pi + 1]);
    }
    if (closeLoop && markers.length > 2) {
      canvas.add(createLineSegmentBetweenMarkers(markers[markers.length - 1], markers[0], opts));
    }
    var last = markers[markers.length - 1];
    canvas._lineByPointsLast = { x: last.left, y: last.top };
    canvas._lineByPointsPreview = last;
    canvas._historyDirty = true;
  }

  // ========== Flèches (groupe ligne + triangle) ==========

  /**
   * Crée une flèche (ligne + tête pleine) entre deux points.
   * @param {number} x1 - Abscisse départ
   * @param {number} y1 - Ordonnée départ
   * @param {number} x2 - Abscisse pointe
   * @param {number} y2 - Ordonnée pointe
   * @param {Object} [options] - { stroke, strokeWidth, headSize }
   * @returns {fabric.Group}
   */
  function createArrow(x1, y1, x2, y2, options) {
    const opts = options || {};
    const stroke = opts.stroke || DEFAULT_STROKE;
    const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
    const headSize = opts.headSize ?? 12;
    if (x1 === x2 && y1 === y2) x2 = x1 + 1;

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseX = x2 - cos * headSize * 2;
    const baseY = y2 - sin * headSize * 2;

    const line = new fabric.Line([x1, y1, baseX, baseY], {
      stroke, strokeWidth, selectable: false, evented: false, strokeUniform: true,
    });
    const wx = headSize * sin;
    const wy = headSize * cos;
    const triangle = new fabric.Polygon(
      [
        { x: x2, y: y2 },
        { x: baseX + wx, y: baseY - wy },
        { x: baseX - wx, y: baseY + wy },
      ],
      { fill: stroke, stroke, strokeWidth: 1, selectable: false, evented: false, strokeUniform: true }
    );

    const group = new fabric.Group([line, triangle], {
      selectable: true,
      evented: true,
      padding: PADDING_LINE_SELECTION,
    });
    group._arrowX1 = x1;
    group._arrowY1 = y1;
    group._arrowX2 = x2;
    group._arrowY2 = y2;
    group._arrowOptions = opts;
    group.toObject = function (keysToInclude) {
      var obj = fabric.Group.prototype.toObject.call(this, keysToInclude);
      obj._arrowX1 = this._arrowX1;
      obj._arrowY1 = this._arrowY1;
      obj._arrowX2 = this._arrowX2;
      obj._arrowY2 = this._arrowY2;
      obj._arrowOptions = this._arrowOptions;
      return obj;
    };
    return group;
  }

  /**
   * Reconstruit le contenu du groupe flèche à partir de _arrowX1/Y1/X2/Y2 et _arrowOptions.
   * @param {fabric.Group} group
   */
  function rebuildArrowGroup(group) {
    const x1 = group._arrowX1;
    const y1 = group._arrowY1;
    let x2 = group._arrowX2;
    let y2 = group._arrowY2;
    const opts = group._arrowOptions || {};
    const stroke = opts.stroke || DEFAULT_STROKE;
    const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
    const headSize = opts.headSize ?? 12;
    if (x1 === x2 && y1 === y2) x2 = x1 + 1;

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseX = x2 - cos * headSize * 2;
    const baseY = y2 - sin * headSize * 2;
    const left = Math.min(x1, x2, baseX);
    const top = Math.min(y1, y2, baseY);

    const lx1 = x1 - left;
    const ly1 = y1 - top;
    const lbaseX = baseX - left;
    const lbaseY = baseY - top;
    const lx2 = x2 - left;
    const ly2 = y2 - top;
    const wx = headSize * sin;
    const wy = headSize * cos;

    const newLine = new fabric.Line([lx1, ly1, lbaseX, lbaseY], {
      stroke, strokeWidth, selectable: false, evented: false, strokeUniform: true,
    });
    const newTri = new fabric.Polygon(
      [{ x: lx2, y: ly2 }, { x: lbaseX + wx, y: lbaseY - wy }, { x: lbaseX - wx, y: lbaseY + wy }],
      { fill: stroke, stroke, strokeWidth: 1, selectable: false, evented: false, strokeUniform: true }
    );

    group.remove(group.item(0));
    group.remove(group.item(0));
    group.add(newLine);
    group.add(newTri);
    group.set({ left, top, originX: "left", originY: "top" });
    group.setCoords();
    var gArrow = group;
    var lA = left;
    var tA = top;
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(function () {
        if (!gArrow || !gArrow.canvas) return;
        gArrow.set({ left: lA, top: tA, originX: "left", originY: "top" });
        gArrow.setCoords();
        gArrow.canvas.requestRenderAll();
      });
    }
  }

  // ========== Formes (carré, cercle, demi-cercle, porte — construites en points) ==========

  /** Nombre de segments pour l’approximation cercle / demi-cercle. */
  const SHAPE_CIRCLE_SEGMENTS = 24;

  function createPolylinePreviewFromPoints(points, options, closeLoop) {
    if (!points || points.length < 2) return null;
    var opts = options || {};
    var stroke = opts.stroke || DEFAULT_STROKE;
    var strokeWidth = opts.strokeWidth != null ? opts.strokeWidth : DEFAULT_STROKE_WIDTH;
    var minX = points[0].x;
    var minY = points[0].y;
    var maxX = points[0].x;
    var maxY = points[0].y;
    var i;
    for (i = 1; i < points.length; i++) {
      if (points[i].x < minX) minX = points[i].x;
      if (points[i].y < minY) minY = points[i].y;
      if (points[i].x > maxX) maxX = points[i].x;
      if (points[i].y > maxY) maxY = points[i].y;
    }
    var lineOpt = { stroke: stroke, strokeWidth: strokeWidth, selectable: false, evented: false, strokeUniform: true };
    var lines = [];
    for (i = 0; i < points.length - 1; i++) {
      lines.push(new fabric.Line(
        [points[i].x - minX, points[i].y - minY, points[i + 1].x - minX, points[i + 1].y - minY],
        lineOpt
      ));
    }
    if (closeLoop && points.length > 2) {
      lines.push(new fabric.Line(
        [points[points.length - 1].x - minX, points[points.length - 1].y - minY, points[0].x - minX, points[0].y - minY],
        lineOpt
      ));
    }
    return new fabric.Group(lines, {
      left: minX,
      top: minY,
      selectable: false,
      evented: false,
    });
  }

  function getSquarePointsFromDrag(x1, y1, x2, y2) {
    var left = Math.min(x1, x2);
    var top = Math.min(y1, y2);
    var right = Math.max(x1, x2);
    var bottom = Math.max(y1, y2);
    if (right - left < 2) right = left + 2;
    if (bottom - top < 2) bottom = top + 2;
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ];
  }

  function getCirclePoints(cx, cy, r) {
    var radius = Math.max(2, Number(r) || 0);
    var pts = [];
    for (var i = 0; i < SHAPE_CIRCLE_SEGMENTS; i++) {
      var a = (i * 2 * Math.PI) / SHAPE_CIRCLE_SEGMENTS;
      pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
    return pts;
  }

  function getSemicirclePoints(cx, cy, r) {
    var radius = Math.max(2, Number(r) || 0);
    var n = Math.max(2, Math.floor(SHAPE_CIRCLE_SEGMENTS / 2));
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var a = (i * Math.PI) / n;
      pts.push({ x: cx + radius * Math.cos(a), y: cy - radius * Math.sin(a) });
    }
    return pts;
  }

  function getDoorPoints(cx, cy, r) {
    var radius = Math.max(2, Number(r) || 0);
    var n = Math.max(2, Math.floor(SHAPE_CIRCLE_SEGMENTS / 4));
    var pts = [{ x: cx, y: cy }, { x: cx + radius, y: cy }];
    for (var i = 1; i <= n; i++) {
      var a = (i * Math.PI * 0.5) / n;
      pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
    pts.push({ x: cx, y: cy });
    return pts;
  }

  function computeShapePointsFromDrag(shapeType, first, current) {
    if (!first || !current) return null;
    if (shapeType === "square") {
      return { points: getSquarePointsFromDrag(first.x, first.y, current.x, current.y), closeLoop: true };
    }
    var r = Math.sqrt((current.x - first.x) * (current.x - first.x) + (current.y - first.y) * (current.y - first.y));
    if (shapeType === "circle") {
      return { points: getCirclePoints(first.x, first.y, r), closeLoop: true };
    }
    if (shapeType === "semicircle") {
      return { points: getSemicirclePoints(first.x, first.y, r), closeLoop: false };
    }
    var radius = Math.min(Math.max(2, r), Math.max(2, Math.abs(current.x - first.x)), Math.max(2, Math.abs(current.y - first.y)));
    return { points: getDoorPoints(first.x, first.y, radius), closeLoop: false };
  }

  function createShapePreview(shapeType, first, current, options) {
    var spec = computeShapePointsFromDrag(shapeType, first, current);
    if (!spec || !spec.points || spec.points.length < 2) return null;
    return createPolylinePreviewFromPoints(spec.points, options, spec.closeLoop);
  }

  function createShapeByPoints(canvas, shapeType, first, current, options) {
    if (!canvas || !first || !current) return;
    var spec = computeShapePointsFromDrag(shapeType, first, current);
    if (!spec || !spec.points || spec.points.length < 2) return;
    var pts = spec.points.slice();
    snapPolylineCanvasPointsToTrace(canvas, pts);
    buildPolylineFromCanvasPointsImpl(canvas, pts, Object.assign({}, options || {}, { closeLoop: spec.closeLoop }));
  }

  // ========== Modes ligne / flèche (deux clics) ==========

  /**
   * Active le mode traçage de ligne (premier clic = départ, second = arrivée).
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - { stroke, strokeWidth }
   */
  function setLineMode(canvas, options) {
    setMode(canvas, MODE_LINE, options);
  }

  /**
   * Active le mode traçage de flèche (premier clic = départ, second = pointe).
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - { stroke, strokeWidth, headSize }
   */
  function setArrowMode(canvas, options) {
    setMode(canvas, MODE_ARROW, options);
  }

  /**
   * Active le mode ligne par points : chaque clic place un point, une ligne relie les deux derniers points.
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - { stroke, strokeWidth }
   */
  function setLineByPointsMode(canvas, options) {
    setMode(canvas, MODE_LINE_BY_POINTS, options);
  }

  /**
   * Mode dessin au crayon identique au dessin libre, puis conversion en points rouges + segments (comme ligne par points).
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - color, strokeWidth
   */
  function setDrawByPointsMode(canvas, options) {
    setMode(canvas, MODE_DRAW_BY_POINTS, options);
  }

  /**
   * Ramène le point (x2, y2) sur un angle 0° ou 90° par rapport à (x1, y1)
   * si l’angle est dans la marge (ex. 86° → 90°).
   * @param {number} x1 - Abscisse départ
   * @param {number} y1 - Ordonnée départ
   * @param {number} x2 - Abscisse arrivée
   * @param {number} y2 - Ordonnée arrivée
   * @param {number} [thresholdDeg] - Marge en degrés
   * @returns {{ x: number, y: number }}
   */
  function snapAngleToGrid(x1, y1, x2, y2, thresholdDeg) {
    const th = thresholdDeg != null ? thresholdDeg : ANGLE_SNAP_THRESHOLD_DEG;
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return { x: x2, y: y2 };
    let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;
    if (angleDeg <= th || angleDeg >= 360 - th || (angleDeg >= 180 - th && angleDeg <= 180 + th)) {
      return { x: x2, y: y1 };
    }
    if ((angleDeg >= 90 - th && angleDeg <= 90 + th) || (angleDeg >= 270 - th && angleDeg <= 270 + th)) {
      return { x: x1, y: y2 };
    }
    return { x: x2, y: y2 };
  }

  /**
   * Branche les événements souris pour le mode ligne/flèche (deux clics).
   * À appeler après initCanvas.
   * @param {fabric.Canvas} canvas
   */
  /**
   * Remet tous les marqueurs ligne par points en apparence normale (désélection droite).
   * @param {fabric.Canvas} canvas
   */
  function clearLineByPointsMarkerHighlight(canvas) {
    if (!canvas) return;
    var objects = canvas.getObjects();
    for (var i = 0; i < objects.length; i++) {
      if (isLineByPointsMarkerObject(objects[i])) {
        objects[i].set("fill", LINE_BY_POINTS_DEFAULT_FILL);
        if (objects[i].set) objects[i].setCoords();
      }
    }
  }

  /**
   * Retourne les groupes « ligne par points » actuellement sélectionnés (un ou plusieurs).
   * Utilise getActiveObject() pour gérer sélection simple (une ligne) et multiple (ActiveSelection).
   * @param {fabric.Canvas} canvas
   * @returns {fabric.Group[]}
   */
  function getSelectedLineByPointsSegments(canvas) {
    if (!canvas) return [];
    var active = canvas.getActiveObject();
    if (!active) return [];
    var list = [];
    var type = (active.type || "").toLowerCase();
    if (type === "activeselection" && active.getObjects) {
      var objs = active.getObjects();
      for (var i = 0; i < objs.length; i++) {
        if (objs[i]._isLineGroup && (objs[i]._segmentStartMarker || objs[i]._segmentEndMarker)) list.push(objs[i]);
      }
    } else if (active._isLineGroup && (active._segmentStartMarker || active._segmentEndMarker)) {
      list.push(active);
    }
    return list;
  }

  /**
   * Tous les groupes « ligne » (_isLineGroup) dans la sélection (simple ou ActiveSelection).
   * @param {fabric.Canvas} canvas
   * @returns {fabric.Group[]}
   */
  function getSelectedLineGroups(canvas) {
    if (!canvas) return [];
    var active = canvas.getActiveObject();
    if (!active) return [];
    var list = [];
    var type = (active.type || "").toLowerCase();
    if (type === "activeselection" && active.getObjects) {
      var objs = active.getObjects();
      for (var i = 0; i < objs.length; i++) {
        if (objs[i]._isLineGroup) list.push(objs[i]);
      }
    } else if (active._isLineGroup) {
      list.push(active);
    }
    return list;
  }

  /**
   * Applique couleur et/ou épaisseur aux segments « ligne » sélectionnés ; met à jour _lineOptions et rebuildLineGroup.
   * @param {fabric.Canvas} canvas
   * @param {{ stroke?: string, strokeWidth?: number }} patch
   */
  function applyLineStrokeStyleToSelection(canvas, patch) {
    if (!canvas || !patch) return;
    var groups = getSelectedLineGroups(canvas);
    if (groups.length === 0) return;
    var any = false;
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g._lineOptions) g._lineOptions = {};
      var gChanged = false;
      if (patch.stroke != null) {
        g._lineOptions.stroke = patch.stroke;
        gChanged = true;
      }
      if (patch.strokeWidth != null) {
        g._lineOptions.strokeWidth = normalizeStrokeWidth(patch.strokeWidth, g._lineOptions.strokeWidth);
        gChanged = true;
      }
      if (gChanged) {
        rebuildLineGroup(g);
        any = true;
      }
    }
    if (any) {
      saveUndoState(canvas, { reason: "lineStrokeStyle:apply" });
      canvas.requestRenderAll();
    }
  }

  /**
   * Ramène une valeur saisie vers un hex #rrggbb (compatible input color HTML).
   * @param {string} v
   * @returns {string}
   */
  function normalizeLineColorHex(v) {
    if (v == null || typeof v !== "string") return DEFAULT_LINE_STROKE;
    var s = v.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
      return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return DEFAULT_LINE_STROKE;
  }

  /**
   * Convertit une couleur Fabric (hex, rgb/rgba) en #rrggbb pour input type="color", ou null si non reconnu.
   * @param {string|undefined|null} stroke
   * @returns {string|null}
   */
  function strokeToColorInputValue(stroke) {
    if (stroke == null) return null;
    var s = String(stroke).trim();
    if (/^#[0-9A-Fa-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9A-Fa-f]{3}$/i.test(s)) return normalizeLineColorHex(s);
    var rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgb) {
      var r = Math.min(255, Math.max(0, parseInt(rgb[1], 10)));
      var g = Math.min(255, Math.max(0, parseInt(rgb[2], 10)));
      var b = Math.min(255, Math.max(0, parseInt(rgb[3], 10)));
      return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }
    return null;
  }

  /**
   * Met à jour les contrôles barre d’outils (couleur / épaisseur trait) depuis une seule ligne sélectionnée.
   * @param {fabric.Canvas} canvas
   * @param {HTMLInputElement|null} lineColorEl
   * @param {HTMLInputElement|null} strokeWidthEl
   */
  function syncLineStrokeControlsFromSelection(canvas, lineColorEl, strokeWidthEl) {
    if (!canvas) return;
    var groups = getSelectedLineGroups(canvas);
    if (groups.length !== 1) return;
    var lo = groups[0]._lineOptions || {};
    if (lineColorEl && lo.stroke != null) {
      var hex = strokeToColorInputValue(lo.stroke);
      if (hex) lineColorEl.value = hex;
    }
    if (strokeWidthEl && lo.strokeWidth != null) {
      var w = normalizeStrokeWidth(lo.strokeWidth, canvas._strokeWidth);
      canvas._strokeWidth = w;
      strokeWidthEl.value = String(w);
    }
  }

  /**
   * Met en évidence les points reliés aux droites sélectionnées (une ou plusieurs).
   * @param {fabric.Canvas} canvas
   * @param {fabric.Group[]} lineGroups - Groupes _isLineGroup avec _segmentStartMarker, _segmentEndMarker
   */
  function highlightLineByPointsEndpoints(canvas, lineGroups) {
    clearLineByPointsMarkerHighlight(canvas);
    if (!lineGroups || lineGroups.length === 0) return;
    for (var g = 0; g < lineGroups.length; g++) {
      var lineGroup = lineGroups[g];
      if (!lineGroup._isLineGroup || !lineGroup._segmentStartMarker || !lineGroup._segmentEndMarker) continue;
      lineGroup._segmentStartMarker.set("fill", LINE_BY_POINTS_HIGHLIGHT_FILL);
      lineGroup._segmentEndMarker.set("fill", LINE_BY_POINTS_HIGHLIGHT_FILL);
      lineGroup._segmentStartMarker.setCoords();
      lineGroup._segmentEndMarker.setCoords();
    }
  }

  function bindTwoPointMode(canvas) {
    if (!canvas) return;
    /* object:modified marqueurs : traité dans initUndoHistory (ordre avant saveUndoState). */
    canvas.on("selection:created", function () {
      var segments = getSelectedLineByPointsSegments(canvas);
      highlightLineByPointsEndpoints(canvas, segments);
      reapplyLineByPointsMarkerContractsQuiet(canvas);
    });
    canvas.on("selection:updated", function () {
      var segments = getSelectedLineByPointsSegments(canvas);
      highlightLineByPointsEndpoints(canvas, segments);
      reapplyLineByPointsMarkerContractsQuiet(canvas);
    });
    canvas.on("selection:cleared", function () {
      clearLineByPointsMarkerHighlight(canvas);
      reapplyLineByPointsMarkerContractsQuiet(canvas);
    });
    canvas.on("mouse:down", function (opt) {
      const mode = canvas._twoPointMode;
      if (mode !== "line" && mode !== "arrow" && mode !== "lineByPoints" && mode !== "shape") return;
      canvas.discardActiveObject();
      const ev = opt && opt.e;
      if (!ev) return;
      if (ev.shiftKey || canvas._isPanningView) return;
      const p = (typeof canvas.getScenePoint === "function" ? canvas.getScenePoint(ev) : canvas.getPointer(ev)) || { x: 0, y: 0 };
      const x = p.x;
      const y = p.y;

      if (mode === "shape") {
        var shapeType = canvas._shapeType || "square";
        var opts = canvas._twoPointOptions || {};
        canvas._shapeDragActive = true;
        canvas._twoPointFirst = { x: snapToTraceStep(canvas, x), y: snapToTraceStep(canvas, y) };
        if (canvas._twoPointPreview) canvas.remove(canvas._twoPointPreview);
        canvas._twoPointPreview = createShapePreview(shapeType, canvas._twoPointFirst, canvas._twoPointFirst, opts);
        if (canvas._twoPointPreview) canvas.add(canvas._twoPointPreview);
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.requestRenderAll();
        return;
      }

      if (mode === "lineByPoints") {
        if (canvas._lineByPointsLast == null) {
          if (canvas._history) saveUndoState(canvas, { keepPreview: true, reason: "lineByPoints:first-point" });
          var sx = snapToTraceStep(canvas, x);
          var sy = snapToTraceStep(canvas, y);
          canvas._lineByPointsLast = { x: sx, y: sy };
          canvas._lineByPointsPreview = createLineByPointsMarker(sx, sy, null);
          canvas.add(canvas._lineByPointsPreview);
          canvas._historyDirty = true;
        } else {
          const opts = canvas._twoPointOptions || {};
          var snapped = snapAngleToGrid(canvas._lineByPointsLast.x, canvas._lineByPointsLast.y, x, y, ANGLE_SNAP_THRESHOLD_DEG);
          snapped = { x: snapToTraceStep(canvas, snapped.x), y: snapToTraceStep(canvas, snapped.y) };
          var existingPoints = [{ x: canvas._lineByPointsLast.x, y: canvas._lineByPointsLast.y }];
          var objects = canvas.getObjects();
          for (var oi = 0; oi < objects.length; oi++) {
            var o = objects[oi];
            if (o._isLineGroup && o.start_point && o.end_point) {
              existingPoints.push({ x: o.start_point.x, y: o.start_point.y });
              existingPoints.push({ x: o.end_point.x, y: o.end_point.y });
            }
          }
          var merged = { x: snapped.x, y: snapped.y };
          var th = LINE_BY_POINTS_MERGE_THRESHOLD;
          for (var pi = 0; pi < existingPoints.length; pi++) {
            var ep = existingPoints[pi];
            var d = Math.sqrt((snapped.x - ep.x) * (snapped.x - ep.x) + (snapped.y - ep.y) * (snapped.y - ep.y));
            if (d <= th) {
              merged = { x: ep.x, y: ep.y };
              break;
            }
          }
          var last = canvas._lineByPointsLast;
          var dx = merged.x - last.x;
          var dy = merged.y - last.y;
          var samePoint = Math.sqrt(dx * dx + dy * dy) < 1e-6;
          var prevMarker = canvas._lineByPointsPreview;
          var newMarker = createLineByPointsMarker(merged.x, merged.y, null);
          if (!samePoint && prevMarker) {
            if (canvas._history) saveUndoState(canvas, { keepPreview: true, reason: "lineByPoints:before-segment" });
            var segment = createLineSegmentBetweenMarkers(prevMarker, newMarker, opts);
            canvas.add(segment);
          }
          canvas._lineByPointsLast = { x: merged.x, y: merged.y };
          canvas.add(newMarker);
          canvas._lineByPointsPreview = newMarker;
          canvas._historyDirty = true;
        }
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.requestRenderAll();
        return;
      }

      if (!canvas._twoPointFirst) {
        var sx = snapToTraceStep(canvas, x);
        var sy = snapToTraceStep(canvas, y);
        // Flèche : même flux que la ligne (deux clics + prévisualisation au move), pas de création en un clic.
        canvas._twoPointFirst = { x: sx, y: sy };
        canvas._twoPointPreview = (mode === "arrow")
          ? createArrow(sx, sy, sx + 1, sy, canvas._twoPointOptions)
          : createLine(sx, sy, sx, sy, canvas._twoPointOptions);
        canvas._twoPointPreview.selectable = false;
        canvas._twoPointPreview.evented = false;
        canvas.add(canvas._twoPointPreview);
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.requestRenderAll();
        return;
      }

      const first_two_point = canvas._twoPointFirst;
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
      const raw_snapped = snapAngleToGrid(first_two_point.x, first_two_point.y, x, y, ANGLE_SNAP_THRESHOLD_DEG);
      const snapped_point = {
        x: snapToTraceStep(canvas, raw_snapped.x),
        y: snapToTraceStep(canvas, raw_snapped.y),
      };
      const obj_arrow = mode === "arrow"
        ? createArrow(first_two_point.x, first_two_point.y, snapped_point.x, snapped_point.y, canvas._twoPointOptions)
        : createLine(first_two_point.x, first_two_point.y, snapped_point.x, snapped_point.y, canvas._twoPointOptions);
      canvas.add(obj_arrow);
      canvas._twoPointFirst = null;
      opt.e.preventDefault();
      opt.e.stopPropagation();
      canvas.requestRenderAll();
    });

    canvas.on("mouse:move", function (opt) {
      if (canvas._isPanningView) return;
      if (canvas._twoPointMode === "lineByPoints") return;
      if (!canvas._twoPointFirst) return;
      const ev = opt && opt.e;
      if (!ev) return;
      const p = (typeof canvas.getScenePoint === "function" ? canvas.getScenePoint(ev) : canvas.getPointer(ev)) || { x: 0, y: 0 };
      const first = canvas._twoPointFirst;
      const opts = canvas._twoPointOptions || {};

      if (canvas._twoPointMode === "shape") {
        if (!canvas._shapeDragActive) return;
        var st = canvas._shapeType || "square";
        if (canvas._twoPointPreview) canvas.remove(canvas._twoPointPreview);
        var cur = { x: snapToTraceStep(canvas, p.x), y: snapToTraceStep(canvas, p.y) };
        canvas._twoPointPreview = createShapePreview(st, first, cur, opts);
        if (canvas._twoPointPreview) canvas.add(canvas._twoPointPreview);
        canvas.requestRenderAll();
        return;
      }

      if (!canvas._twoPointPreview) return;
      const snapped = snapAngleToGrid(first.x, first.y, p.x, p.y, ANGLE_SNAP_THRESHOLD_DEG);
      if (canvas._twoPointMode === "line") {
        canvas.remove(canvas._twoPointPreview);
        canvas._twoPointPreview = createLine(first.x, first.y, snapped.x, snapped.y, opts);
        canvas._twoPointPreview.selectable = false;
        canvas._twoPointPreview.evented = false;
        canvas.add(canvas._twoPointPreview);
      } else {
        canvas.remove(canvas._twoPointPreview);
        canvas._twoPointPreview = createArrow(first.x, first.y, snapped.x, snapped.y, opts);
        canvas._twoPointPreview.selectable = false;
        canvas._twoPointPreview.evented = false;
        canvas.add(canvas._twoPointPreview);
      }
      canvas.requestRenderAll();
    });

    canvas.on("mouse:up", function (opt) {
      if (canvas._isPanningView) return;
      if (canvas._twoPointMode === "shape" && canvas._shapeDragActive && canvas._twoPointFirst) {
        const evShape = opt && opt.e;
        if (!evShape) return;
        const pShape = (typeof canvas.getScenePoint === "function" ? canvas.getScenePoint(evShape) : canvas.getPointer(evShape)) || { x: 0, y: 0 };
        var firstShape = canvas._twoPointFirst;
        var shapeOpts = canvas._twoPointOptions || {};
        var curShape = { x: snapToTraceStep(canvas, pShape.x), y: snapToTraceStep(canvas, pShape.y) };
        if (canvas._twoPointPreview) {
          canvas.remove(canvas._twoPointPreview);
          canvas._twoPointPreview = null;
        }
        createShapeByPoints(canvas, canvas._shapeType || "square", firstShape, curShape, shapeOpts);
        canvas._shapeDragActive = false;
        canvas._twoPointFirst = null;
        evShape.preventDefault();
        evShape.stopPropagation();
        canvas.requestRenderAll();
        return;
      }
      if (canvas._twoPointMode !== "line" || !canvas._twoPointFirst || !canvas._twoPointPreview) return;
      const ev = opt && opt.e;
      if (!ev) return;
      const p = (typeof canvas.getScenePoint === "function" ? canvas.getScenePoint(ev) : canvas.getPointer(ev)) || { x: 0, y: 0 };
      const first = canvas._twoPointFirst;
      const snapped = snapAngleToGrid(first.x, first.y, p.x, p.y, ANGLE_SNAP_THRESHOLD_DEG);
      const opts = canvas._twoPointOptions || {};
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
      const obj = createLine(first.x, first.y, snapped.x, snapped.y, opts);
      canvas.add(obj);
      canvas._twoPointFirst = null;
      opt.e.preventDefault();
      opt.e.stopPropagation();
      canvas.requestRenderAll();
    });
  }

  // ========== Texte ==========

  /**
   * Ajoute une zone de texte éditable sur le canvas.
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - { left, top, text, fontSize, fontFamily, fill }
   * @returns {fabric.IText|null}
   */
  function addTextBox(canvas, options) {
    if (!canvas) return null;
    const opts = options || {};
    const text = new fabric.IText(opts.text || "Texte", {
      left: opts.left ?? 100,
      top: opts.top ?? 100,
      fontSize: opts.fontSize || 16,
      fontFamily: opts.fontFamily || "Arial",
      fill: opts.fill || "#000",
      editable: true,
    });
    canvas.add(text);
    canvas.setActiveObject(text);
    canvas.requestRenderAll();
    return text;
  }

  // ========== Export SVG / PDF ==========

  /**
   * Retire tous les marqueurs « ligne par points » du canvas pour un export (PDF/SVG).
   * Les points ne doivent pas apparaître dans le PDF ni dans l’envoi au système.
   * @param {fabric.Canvas} canvas
   * @returns {fabric.Object[]} Marqueurs retirés (pour restauration)
   */
  function removeLineByPointsMarkersForExport(canvas) {
    if (!canvas) return [];
    var objects = canvas.getObjects();
    var markers = [];
    for (var i = objects.length - 1; i >= 0; i--) {
      if (isLineByPointsMarkerObject(objects[i])) {
        markers.push(objects[i]);
        canvas.remove(objects[i]);
      }
    }
    return markers;
  }

  /**
   * Remet les marqueurs sur le canvas après export.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Object[]} markers
   */
  function restoreLineByPointsMarkersAfterExport(canvas, markers) {
    if (!canvas || !markers) return;
    for (var i = 0; i < markers.length; i++) canvas.add(markers[i]);
    canvas.requestRenderAll();
  }

  /**
   * Retourne le SVG du canvas (chaîne XML). Les points rouges sont exclus de l’export.
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - options passées à toSVG()
   * @returns {string}
   */
  function exportSVG(canvas, options) {
    if (!canvas) return "";
    var markers = removeLineByPointsMarkersForExport(canvas);
    try {
      return canvas.toSVG(options);
    } finally {
      restoreLineByPointsMarkersAfterExport(canvas, markers);
    }
  }

  /**
   * Télécharge le SVG du canvas.
   * @param {fabric.Canvas} canvas
   * @param {string} [filename]
   */
  function downloadSVG(canvas, filename) {
    const svg = exportSVG(canvas, { suppressPreamble: false });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, filename || "dessin.svg");
  }

  /**
   * Télécharge un Blob en fichier (nom donné).
   * @param {Blob} blob
   * @param {string} filename
   */
  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Retourne la librairie jsPDF (window.jspdf ou global). */
  function getJsPDF() {
    return (typeof window !== "undefined" && window.jspdf) || (typeof jspdf !== "undefined" ? jspdf : null);
  }

  /**
   * Exporte le canvas en PDF (vectoriel si svg2pdf disponible, sinon PNG).
   * Les points rouges sont exclus du PDF.
   * @param {fabric.Canvas} canvas
   * @param {string} [filename]
   * @param {Function} [done] - callback (err) en fin
   */
  function exportPDF(canvas, filename, done) {
    if (!canvas) {
      if (done) done(new Error("Canvas absent"));
      return;
    }
    const name = filename || "dessin.pdf";
    const JsPDFLib = getJsPDF();
    var markers = removeLineByPointsMarkersForExport(canvas);

    function restore() {
      restoreLineByPointsMarkersAfterExport(canvas, markers);
    }

    function fallbackRasterPDF() {
      try {
        const dataUrl = canvas.toDataURL({ format: "png", quality: 1 });
        const imgW = canvas.width;
        const imgH = canvas.height;
        if (!JsPDFLib || !JsPDFLib.jsPDF) {
          if (done) done(new Error("jsPDF non chargé"));
          restore();
          return;
        }
        const pdf = new JsPDFLib.jsPDF({
          orientation: imgW > imgH ? "landscape" : "portrait",
          unit: "px",
          format: [imgW, imgH],
        });
        pdf.addImage(dataUrl, "PNG", 0, 0, imgW, imgH);
        downloadBlob(new Blob([pdf.output("blob")], { type: "application/pdf" }), name);
        if (done) done(null);
      } catch (e) {
        if (done) done(e);
      } finally {
        restore();
      }
    }

    if (window.svg2pdf && JsPDFLib && JsPDFLib.jsPDF) {
      const svgStr = canvas.toSVG({ suppressPreamble: true });
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      if (!svgEl) {
        fallbackRasterPDF();
        return;
      }
      const pdf = new JsPDFLib.jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      window.svg2pdf(svgEl, pdf, {}).then(
        function () {
          downloadBlob(new Blob([pdf.output("blob")], { type: "application/pdf" }), name);
          if (done) done(null);
        },
        function (err) {
          fallbackRasterPDF();
          if (done) done(err);
        }
      ).finally(restore);
    } else {
      fallbackRasterPDF();
    }
  }

  /**
   * Exporte le canvas en PDF et passe le Blob au callback (sans téléchargement).
   * Même logique que exportPDF ; utilisé pour alimenter le flux plan (PDF → image) / envoi au système.
   * Les points rouges sont exclus du PDF.
   * @param {fabric.Canvas} canvas
   * @param {Function} done - callback (err, blob) avec blob PDF ou err
   */
  function exportPDFToBlob(canvas, done) {
    if (!canvas) {
      if (done) done(new Error("Canvas absent"), null);
      return;
    }
    const JsPDFLib = getJsPDF();
    var markers = removeLineByPointsMarkersForExport(canvas);

    function restore() {
      restoreLineByPointsMarkersAfterExport(canvas, markers);
    }

    function fallbackRasterPDF() {
      try {
        const dataUrl = canvas.toDataURL({ format: "png", quality: 1 });
        const imgW = canvas.width;
        const imgH = canvas.height;
        if (!JsPDFLib || !JsPDFLib.jsPDF) {
          if (done) done(new Error("jsPDF non chargé"), null);
          restore();
          return;
        }
        const pdf = new JsPDFLib.jsPDF({
          orientation: imgW > imgH ? "landscape" : "portrait",
          unit: "px",
          format: [imgW, imgH],
        });
        pdf.addImage(dataUrl, "PNG", 0, 0, imgW, imgH);
        const blob = new Blob([pdf.output("blob")], { type: "application/pdf" });
        if (done) done(null, blob);
      } catch (e) {
        if (done) done(e, null);
      } finally {
        restore();
      }
    }

    if (typeof window !== "undefined" && window.svg2pdf && JsPDFLib && JsPDFLib.jsPDF) {
      const svgStr = canvas.toSVG({ suppressPreamble: true });
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgStr, "image/svg+xml");
      const svgEl = doc.querySelector("svg");
      if (!svgEl) {
        fallbackRasterPDF();
        return;
      }
      const pdf = new JsPDFLib.jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [canvas.width, canvas.height],
      });
      window.svg2pdf(svgEl, pdf, {}).then(
        function () {
          const blob = new Blob([pdf.output("blob")], { type: "application/pdf" });
          if (done) done(null, blob);
        },
        function () {
          fallbackRasterPDF();
        }
      ).finally(restore);
    } else {
      fallbackRasterPDF();
    }
  }

  // ========== Sélection, duplication, suppression ==========

  /**
   * Duplique l’objet (ou la sélection) avec un décalage. Gère lignes et flèches.
   * @param {fabric.Canvas} canvas
   */
  /**
   * Duplique l’objet actuellement sélectionné sur le canvas Fabric, ou chaque objet lorsqu'une sélection multiple est active,
   * en créant un ou plusieurs nouveaux objets déplacés selon un petit décalage prédéfini.
   *
   * - Pour une sélection simple, l’objet courant est cloné, décalé, puis ajouté au canvas et activé.
   * - Pour une sélection multiple (type "activeSelection"), tous les objets de la sélection sont clonés, décalés, réajustés si nécessaire,
   *   puis ajoutés au canvas comme nouvelle sélection multiple.
   * - Les objets de type “line” voient également leurs points de départ et d’arrivée déplacés et leurs contrôles mis à jour.
   * - Les objets de type “group” utilisés pour représenter des flèches bénéficient d’un ajustement de leurs points terminaux (_arrowX1, etc.)
   *   et d’un rafraîchissement complet de la structure flèche/group.
   * - Si aucun objet n’est sélectionné, la fonction ne fait rien.
   * - En cas d’échec de la duplication, un message d’erreur est affiché en console.
   *
   * @param {fabric.Canvas} canvas - Instance Fabric sur laquelle opérer.
   */
  function duplicateSelection(canvas) {
    if (!canvas) return;
    const activeObj = canvas.getActiveObject();
    if (!activeObj) return; // rien à dupliquer

    const dx = DUPLICATE_OFFSET;
    const dy = DUPLICATE_OFFSET;

    // Helper pour décaler et ajuster objets
    function applyOffsetAndSetup(obj, orig, dX, dY) {
      obj.set({ left: (obj.left || 0) + dX, top: (obj.top || 0) + dY });
      if (obj.type === "group" && obj._isLineGroup) {
        obj.start_point.x += dX;
        obj.start_point.y += dY;
        obj.end_point.x += dX;
        obj.end_point.y += dY;
        rebuildLineGroup(obj);
      }
      if (obj.type === "group" && orig && orig._arrowX1 != null) {
        obj._arrowX1 = orig._arrowX1 + dX;
        obj._arrowY1 = orig._arrowY1 + dY;
        obj._arrowX2 = orig._arrowX2 + dX;
        obj._arrowY2 = orig._arrowY2 + dY;
        obj._arrowOptions = orig._arrowOptions;
        rebuildArrowGroup(obj);
      }
      obj.setCoords();
      canvas.add(obj);
    }

    // Fabric v6 : clone() retourne souvent une Promise
    function runDuplicateSingle(orig, done) {
      var cloneResult = typeof orig.clone === "function" ? orig.clone() : undefined;
      if (cloneResult != null && typeof cloneResult.then === "function") {
        cloneResult.then(function (cloned) {
          applyOffsetAndSetup(cloned, orig, dx, dy);
          ensureObjectCanvasRef(cloned, canvas);
          canvas.setActiveObject(cloned);
          canvas.requestRenderAll();
          requestAnimationFrame(function () { canvas.requestRenderAll(); });
          if (done) done();
        }).catch(function (err) {
          console.error("[FabricDrawing] Erreur duplication (Promise):", err);
          if (done) done();
        });
      } else if (typeof orig.clone === "function") {
        orig.clone(function (cloned) {
          applyOffsetAndSetup(cloned, orig, dx, dy);
          ensureObjectCanvasRef(cloned, canvas);
          canvas.setActiveObject(cloned);
          canvas.requestRenderAll();
          requestAnimationFrame(function () { canvas.requestRenderAll(); });
          if (done) done();
        }, true);
      } else {
        if (done) done();
      }
    }

    // Simple sélection (un seul objet ou groupe)
    if (!activeObj.type || (activeObj.type || "").toLowerCase() !== "activeselection") {
      runDuplicateSingle(activeObj);
      return;
    }

    // Sélection multiple : uniquement clone() pour chaque objet (pas d'enlivenObjects)
    var originals = activeObj.getObjects ? activeObj.getObjects() : activeObj._objects.slice();
    var clones = [];
    var pending = originals.length;
    if (pending === 0) return;

    originals.forEach(function (orig) {
      var result = typeof orig.clone === "function" ? orig.clone() : undefined;
      if (result != null && typeof result.then === "function") {
        result.then(function (cloned) {
          applyOffsetAndSetup(cloned, orig, dx, dy);
          clones.push(cloned);
          pending--;
          if (pending === 0) finishMultiple();
        }).catch(function (err) {
          console.error("[FabricDrawing] Erreur duplication multiple:", err);
          pending--;
          if (pending === 0) finishMultiple();
        });
      } else if (typeof orig.clone === "function") {
        orig.clone(function (cloned) {
          applyOffsetAndSetup(cloned, orig, dx, dy);
          clones.push(cloned);
          pending--;
          if (pending === 0) finishMultiple();
        }, true);
      } else {
        pending--;
        if (pending === 0) finishMultiple();
      }
    });

    function finishMultiple() {
      clones.forEach(function (c) { ensureObjectCanvasRef(c, canvas); });
      if (clones.length === 1) canvas.setActiveObject(clones[0]);
      else if (clones.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas }));
      canvas.requestRenderAll();
      requestAnimationFrame(function () {
        canvas.requestRenderAll();
      });
    }
  }

  /**
   * Supprime l’objet sélectionné (ou tous les objets de la sélection multiple).
   * @param {fabric.Canvas} canvas
   */
  function groupSelection(canvas) {
    if (!canvas) return;
    var active = canvas.getActiveObject();
    if (!active) return;
    var type = (active.type || "").toLowerCase();
    if (type !== "activeselection") return;

    try {
      var group;
      if (typeof active.toGroup === "function") {
        group = active.toGroup();
      } else {
        var objects = active.getObjects ? active.getObjects().slice() : [];
        if (objects.length === 0) return;
        canvas.discardActiveObject();
        objects.forEach(function (obj) { canvas.remove(obj); });
        group = new fabric.Group(objects);
      }
      canvas.add(group);
      canvas.setActiveObject(group);
      canvas.requestRenderAll();
    } catch (e) {
      console.error("[FabricDrawing] groupSelection — erreur:", e);
    }
  }

  /**
   * Retourne les segments « ligne par points » à supprimer car une de leurs extrémités est dans le set donné.
   * Une droite ligne-par-points n'existe que si ses 2 points existent.
   * @param {fabric.Canvas} canvas
   * @param {Set<fabric.Object>} objectSet - Objets sur le point d'être supprimés
   * @returns {fabric.Group[]}
   */
  function getSegmentsToRemoveWithObjects(canvas, objectSet) {
    if (!canvas || !objectSet || objectSet.size === 0) return [];
    var out = [];
    var objects = canvas.getObjects();
    for (var i = 0; i < objects.length; i++) {
      var seg = objects[i];
      if (!seg._isLineGroup || (!seg._segmentStartMarker && !seg._segmentEndMarker)) continue;
      if (objectSet.has(seg._segmentStartMarker) || objectSet.has(seg._segmentEndMarker)) out.push(seg);
    }
    return out;
  }

  function deleteSelection(canvas) {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    let toRemove = [];
    if (canvas.getActiveObjects && typeof canvas.getActiveObjects === "function") {
      const objs = canvas.getActiveObjects();
      if (objs && Array.isArray(objs) && objs.length > 0) toRemove = objs;
    }
    if (toRemove.length === 0 && active.getObjects && typeof active.getObjects === "function") {
      const t = (active.type || "").toLowerCase();
      if (t === "activeselection") toRemove = active.getObjects().slice();
    }
    canvas._deletingSelection = true;
    if (toRemove.length > 0) {
      var objectSet = new Set(toRemove);
      var segmentsToRemove = getSegmentsToRemoveWithObjects(canvas, objectSet);
      for (var s = 0; s < segmentsToRemove.length; s++) canvas.remove(segmentsToRemove[s]);
      toRemove.forEach(function (obj) {
        canvas.remove(obj);
      });
      canvas.discardActiveObject();
    } else {
      var singleSet = new Set([active]);
      var segs = getSegmentsToRemoveWithObjects(canvas, singleSet);
      for (var s = 0; s < segs.length; s++) canvas.remove(segs[s]);
      canvas.remove(active);
      canvas.discardActiveObject();
    }
    canvas._deletingSelection = false;
    if (canvas._history) saveUndoState(canvas);
    canvas.requestRenderAll();
  }

  /**
   * Branche la touche Delete/Backspace pour supprimer la sélection.
   * Ne fait rien si un IText est en cours d’édition.
   * @param {fabric.Canvas} canvas
   */
  /**
   * Retourne les marqueurs « ligne par points » impliqués dans la sélection (marqueurs sélectionnés + extrémités des segments sélectionnés).
   * @param {fabric.Canvas} canvas
   * @returns {fabric.Circle[]}
   */
  function getMarkersInvolvedInSelection(canvas) {
    if (!canvas) return [];
    var active = canvas.getActiveObject();
    if (!active) return [];
    var objects = [];
    var type = (active.type || "").toLowerCase();
    if (type === "activeselection" && active.getObjects) objects = active.getObjects().slice();
    else objects = [active];
    var seen = new Set();
    var markers = [];
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (isLineByPointsMarkerObject(o) && !seen.has(o)) { seen.add(o); markers.push(o); }
      if (o._isLineGroup) {
        if (o._segmentStartMarker && !seen.has(o._segmentStartMarker)) { seen.add(o._segmentStartMarker); markers.push(o._segmentStartMarker); }
        if (o._segmentEndMarker && !seen.has(o._segmentEndMarker)) { seen.add(o._segmentEndMarker); markers.push(o._segmentEndMarker); }
      }
    }
    return markers;
  }
  /**
   * Centre de la sélection : barycentre en coordonnées canvas (getCenterPoint pour ActiveSelection).
   * @param {fabric.Canvas} canvas
   * @returns {{ x: number, y: number } | null}
   */
  function getMergeCenterFromSelection(canvas) {
    if (!canvas) return null;
    var active = canvas.getActiveObject();
    if (!active) return null;
    var objects = [];
    var type = (active.type || "").toLowerCase();
    if (type === "activeselection" && active.getObjects) objects = active.getObjects().slice();
    else objects = [active];
    var sumX = 0, sumY = 0, n = 0;
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (isLineByPointsMarkerObject(o)) {
        var pt = (typeof o.getCenterPoint === "function") ? o.getCenterPoint() : { x: o.left, y: o.top };
        sumX += pt.x; sumY += pt.y; n++;
      } else if (o._isLineGroup && o.start_point && o.end_point) {
        var mid = (typeof o.getCenterPoint === "function") ? o.getCenterPoint() : null;
        if (mid) { sumX += mid.x; sumY += mid.y; }
        else { sumX += (o.start_point.x + o.end_point.x) / 2; sumY += (o.start_point.y + o.end_point.y) / 2; }
        n++;
      }
    }
    return n === 0 ? null : { x: sumX / n, y: sumY / n };
  }
  /**
   * True si la fusion est possible : sélection uniquement lignes/points « ligne par points » et au moins 2 marqueurs impliqués.
   * @param {fabric.Canvas} canvas
   * @returns {boolean}
   */
  function canMergePoints(canvas) {
    if (!canvas) return false;
    var active = canvas.getActiveObject();
    if (!active) return false;
    var objects = [];
    var type = (active.type || "").toLowerCase();
    if (type === "activeselection" && active.getObjects) objects = active.getObjects().slice();
    else objects = [active];
    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      if (!isLineByPointsMarkerObject(o) && !o._isLineGroup) return false;
    }
    return getMarkersInvolvedInSelection(canvas).length >= 2;
  }
  /**
   * Met à jour le bouton « Fusion pts » (disabled si sélection invalide).
   * @param {fabric.Canvas} canvas
   * @param {string} [mergePointsId]
   */
  function updateMergeButtonState(canvas, mergePointsId) {
    if (!canvas) return;
    var el = document.getElementById(mergePointsId || "btnMergePoints");
    if (el) el.disabled = !canMergePoints(canvas);
  }
  /**
   * Fusionne la sélection en un point au centre des objets ; reconnecte les segments aux points restants.
   * @param {fabric.Canvas} canvas
   */
  function mergeSelectedPoints(canvas) {
    if (!canvas || !canMergePoints(canvas)) return;
    var center = getMergeCenterFromSelection(canvas);
    if (!center) return;
    var markers = getMarkersInvolvedInSelection(canvas);
    var markerSet = new Set(markers);
    var newMarker = createLineByPointsMarker(center.x, center.y, null);
    var allObjects = canvas.getObjects();
    var segmentsToRemove = [], segmentsToRebuild = [];
    for (var s = 0; s < allObjects.length; s++) {
      var seg = allObjects[s];
      if (!seg._isLineGroup || (!seg._segmentStartMarker && !seg._segmentEndMarker)) continue;
      var startIn = seg._segmentStartMarker && markerSet.has(seg._segmentStartMarker);
      var endIn = seg._segmentEndMarker && markerSet.has(seg._segmentEndMarker);
      if (!startIn && !endIn) continue;
      if (startIn) seg._segmentStartMarker = newMarker;
      if (endIn) seg._segmentEndMarker = newMarker;
      if (seg._segmentStartMarker === newMarker && seg._segmentEndMarker === newMarker) segmentsToRemove.push(seg);
      else segmentsToRebuild.push(seg);
    }
    for (var r = 0; r < segmentsToRemove.length; r++) canvas.remove(segmentsToRemove[r]);
    for (var b = 0; b < segmentsToRebuild.length; b++) rebuildLineGroup(segmentsToRebuild[b]);
    canvas._removingLineByPointsMarkers = true;
    for (var m = 0; m < markers.length; m++) canvas.remove(markers[m]);
    canvas._removingLineByPointsMarkers = false;
    canvas.add(newMarker);
    if (markerSet.has(canvas._lineByPointsPreview)) canvas._lineByPointsPreview = newMarker;
    canvas._lineByPointsLast = { x: center.x, y: center.y };
    canvas.discardActiveObject();
    canvas.setActiveObject(newMarker);
    canvas.requestRenderAll();
    if (canvas._history) saveUndoState(canvas);
    updateMergeButtonState(canvas, canvas._mergePointsId);
  }
  function bindDeleteKey(canvas) {
    if (!canvas) return;
    function handler(e) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable)) return;
      const active = canvas.getActiveObject();
      if (!active) return;
      if (active.type === "i-text" && active.isEditing) return;
      e.preventDefault();
      deleteSelection(canvas);
    }
    document.addEventListener("keydown", handler);
    canvas._deleteKeyHandler = handler;
  }

  // ========== Barre d’outils ==========

  /**
   * Met à jour le bouton actif (classe .active) selon le mode.
   * @param {fabric.Canvas} canvas
   * @param {string} mode - 'draw' | 'select' | 'line' | 'arrow' | 'lineByPoints'
   */
  function setActiveModeButton(canvas, mode) {
    if (!canvas || !canvas._modeButtons) return;
    const btns = canvas._modeButtons;
    for (const k in btns) {
      if (btns[k]) btns[k].classList.remove("active");
    }
    if (btns[mode]) btns[mode].classList.add("active");
  }

  /**
   * Attache les boutons de la barre d’outils au canvas.
   * @param {fabric.Canvas} canvas
   * @param {Object} [ids] - ids des boutons (draw, select, line, arrow, text, delete, duplicate, exportSvg, exportPdf)
   */
  function bindToolbar(canvas, ids) {
    if (!canvas) return;
    ids = ids || {};
    const id = (key, def) => (ids[key] != null ? ids[key] : def);
    const drawId = id("draw", "btnDraw");
    const selectId = id("select", "btnSelect");
    const lineId = id("line", "btnLine");
    const arrowId = id("arrow", "btnArrow");
    const lineByPointsId = id("lineByPoints", "btnLineByPoints");
    const drawByPointsId = id("drawByPoints", "btnDrawByPoints");
    const shapesId = id("shapes", "btnShapes");
    const shapeTypeId = id("shapeType", "shapeType");
    const textId = id("text", "btnText");
    const backwardsId = id("backwards", "btnBackwards");
    const deleteId = id("delete", "btnDelete");
    const groupId = id("group", "btnGroup");
    const duplicateId = id("duplicate", "btnDuplicate");
    const exportSvgId = id("exportSvg", "btnExportSvg");
    const exportPdfId = id("exportPdf", "btnExportPdf");
    const mergePointsId = id("mergePoints", "btnMergePoints");
    canvas._mergePointsId = mergePointsId;
    const freehandSnapId = id("freehandSnap", "freehandSnap");
    const traceSnapId = id("traceSnap", "traceSnap");
    const strokeWidthId = id("strokeWidth", "strokeWidth");
    const lineStrokeColorId = id("lineStrokeColor", "lineStrokeColor");
    const gridIntensityId = id("gridIntensity", "gridIntensity");

    var gridWrapper = canvas.lowerCanvasEl && canvas.lowerCanvasEl.parentNode && canvas.lowerCanvasEl.parentNode.parentNode;
    if (gridWrapper && gridWrapper.getAttribute && gridWrapper.getAttribute("data-fabric") === "wrapper") {
      var gridIntensityEl = document.getElementById(gridIntensityId);
      if (gridIntensityEl) {
        var intensityFromEl = function () {
          var v = parseFloat(gridIntensityEl.value, 10);
          if (!isNaN(v)) {
            redrawGridIntensity(gridWrapper, Math.max(0, Math.min(1, v / 100)));
            syncGridToViewport(canvas);
          }
        };
        gridIntensityEl.addEventListener("input", intensityFromEl);
        gridIntensityEl.addEventListener("change", intensityFromEl);
        if (gridWrapper._gridOpts && gridWrapper._gridOpts.gridIntensity != null) {
          gridIntensityEl.value = Math.round(gridWrapper._gridOpts.gridIntensity * 100);
        }
      }
    }

    canvas._modeButtons = {
      draw: document.getElementById(drawId),
      drawByPoints: document.getElementById(drawByPointsId),
      select: document.getElementById(selectId),
      line: document.getElementById(lineId),
      arrow: document.getElementById(arrowId),
      lineByPoints: document.getElementById(lineByPointsId),
      shapes: document.getElementById(shapesId),
    };
    bindViewportNavigation(canvas);
    bindDeleteKey(canvas);

    const freehandSnapEl = document.getElementById(freehandSnapId);
    if (freehandSnapEl) {
      canvas._freehandSnapStep = parseInt(freehandSnapEl.value, 10) || 25;
      freehandSnapEl.addEventListener("change", function () {
        canvas._freehandSnapStep = parseInt(freehandSnapEl.value, 10) || 0;
      });
    } else {
      canvas._freehandSnapStep = 25;
    }

    const traceSnapEl = document.getElementById(traceSnapId);
    if (traceSnapEl) {
      canvas._traceSnapStep = parseInt(traceSnapEl.value, 10);
      if (isNaN(canvas._traceSnapStep)) canvas._traceSnapStep = TRACE_SNAP_STEP_DEFAULT;
      traceSnapEl.addEventListener("change", function () {
        var v = parseInt(traceSnapEl.value, 10);
        canvas._traceSnapStep = isNaN(v) ? TRACE_SNAP_STEP_DEFAULT : v;
      });
    } else {
      canvas._traceSnapStep = TRACE_SNAP_STEP_DEFAULT;
    }

    const strokeWidthEl = document.getElementById(strokeWidthId);
    const lineColorEl = document.getElementById(lineStrokeColorId);
    if (strokeWidthEl) {
      var startStroke = normalizeStrokeWidth(parseFloat(strokeWidthEl.value), DEFAULT_STROKE_WIDTH);
      canvas._strokeWidth = startStroke;
      strokeWidthEl.value = String(startStroke);
      var applyStrokeWidth = function () {
        var width = normalizeStrokeWidth(parseFloat(strokeWidthEl.value), canvas._strokeWidth);
        canvas._strokeWidth = width;
        strokeWidthEl.value = String(width);
        if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = width;
        if (canvas._twoPointOptions) canvas._twoPointOptions.strokeWidth = width;
        applyLineStrokeStyleToSelection(canvas, { strokeWidth: width });
      };
      strokeWidthEl.addEventListener("change", applyStrokeWidth);
      strokeWidthEl.addEventListener("input", applyStrokeWidth);
    } else if (canvas._strokeWidth == null) {
      canvas._strokeWidth = DEFAULT_STROKE_WIDTH;
    }

    if (lineColorEl) {
      if (canvas._lineStroke == null) canvas._lineStroke = DEFAULT_LINE_STROKE;
      lineColorEl.value = normalizeLineColorHex(canvas._lineStroke);
      var applyLineStrokeColor = function () {
        var c = normalizeLineColorHex(lineColorEl.value);
        canvas._lineStroke = c;
        lineColorEl.value = c;
        if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = c;
        if (canvas._twoPointOptions) canvas._twoPointOptions.stroke = c;
        applyLineStrokeStyleToSelection(canvas, { stroke: c });
        canvas.requestRenderAll();
      };
      lineColorEl.addEventListener("change", applyLineStrokeColor);
      lineColorEl.addEventListener("input", applyLineStrokeColor);
    }

    var syncLineControlsFromSel = function () {
      syncLineStrokeControlsFromSelection(canvas, lineColorEl, strokeWidthEl);
    };
    canvas.on("selection:created", syncLineControlsFromSel);
    canvas.on("selection:updated", syncLineControlsFromSel);

    setMode(canvas, MODE_DRAW, { strokeWidth: canvas._strokeWidth });
    syncGridToViewport(canvas);

    const on = (elem, ev, fn) => elem && elem.addEventListener(ev, fn);
    on(document.getElementById(drawId), "click", () => {
      if (freehandSnapEl) canvas._freehandSnapStep = parseInt(freehandSnapEl.value, 10) || 0;
      setMode(canvas, MODE_DRAW, { strokeWidth: canvas._strokeWidth });
      canvas.requestRenderAll();
    });
    on(document.getElementById(drawByPointsId), "click", () => {
      if (freehandSnapEl) {
        var snapV = parseInt(freehandSnapEl.value, 10);
        canvas._freehandSnapStep = isNaN(snapV) || snapV <= 0 ? LINE_BY_POINTS_SNAP_STEP : snapV;
      }
      if (traceSnapEl) {
        var vTp = parseInt(traceSnapEl.value, 10);
        canvas._traceSnapStep = isNaN(vTp) ? TRACE_SNAP_STEP_DEFAULT : vTp;
      }
      setMode(canvas, MODE_DRAW_BY_POINTS, { strokeWidth: canvas._strokeWidth });
      canvas.requestRenderAll();
    });
    on(document.getElementById(selectId), "click", () => setMode(canvas, MODE_SELECT));
    on(document.getElementById(lineId), "click", () => {
      if (traceSnapEl) { var v = parseInt(traceSnapEl.value, 10); canvas._traceSnapStep = isNaN(v) ? TRACE_SNAP_STEP_DEFAULT : v; }
      setMode(canvas, MODE_LINE, { strokeWidth: canvas._strokeWidth });
    });
    on(document.getElementById(arrowId), "click", () => {
      if (traceSnapEl) { var v = parseInt(traceSnapEl.value, 10); canvas._traceSnapStep = isNaN(v) ? TRACE_SNAP_STEP_DEFAULT : v; }
      setMode(canvas, MODE_ARROW, { strokeWidth: canvas._strokeWidth });
    });
    on(document.getElementById(lineByPointsId), "click", () => {
      if (traceSnapEl) { var v = parseInt(traceSnapEl.value, 10); canvas._traceSnapStep = isNaN(v) ? TRACE_SNAP_STEP_DEFAULT : v; }
      setMode(canvas, MODE_LINE_BY_POINTS, { strokeWidth: canvas._strokeWidth });
    });
    const shapeTypeEl = document.getElementById(shapeTypeId);
    on(document.getElementById(shapesId), "click", () => {
      var shapeType = shapeTypeEl && shapeTypeEl.value ? shapeTypeEl.value : "square";
      setMode(canvas, MODE_SHAPES, { shapeType: shapeType, strokeWidth: canvas._strokeWidth });
      canvas.requestRenderAll();
    });
    if (shapeTypeEl) {
      shapeTypeEl.addEventListener("change", function () {
        var newType = shapeTypeEl.value || "square";
        canvas._shapeType = newType;
        if (!canvas._twoPointOptions) canvas._twoPointOptions = {};
        canvas._twoPointOptions.strokeWidth = canvas._strokeWidth;
        if (canvas._twoPointMode === "shape") {
          if (canvas._twoPointPreview) {
            canvas.remove(canvas._twoPointPreview);
            canvas._twoPointPreview = null;
          }
          canvas._twoPointFirst = null;
          canvas.requestRenderAll();
        }
      });
    }
    on(document.getElementById(textId), "click", () => {
      setMode(canvas, MODE_SELECT);
      addTextBox(canvas, { left: 80, top: 80 });
    });
    var backwardsEl = document.getElementById(backwardsId);
    if (backwardsEl) {
      if (backwardsEl._fabricUndoHandler) backwardsEl.removeEventListener("click", backwardsEl._fabricUndoHandler);
      backwardsEl._fabricUndoHandler = function () { undo(canvas); };
      backwardsEl.addEventListener("click", backwardsEl._fabricUndoHandler);
    }
    on(document.getElementById(deleteId), "click", () => deleteSelection(canvas));
    var mergePointsEl = document.getElementById(mergePointsId);
    if (mergePointsEl) {
      mergePointsEl.disabled = true;
      on(mergePointsEl, "click", () => mergeSelectedPoints(canvas));
    }
    canvas.on("selection:created", function () { updateMergeButtonState(canvas, mergePointsId); });
    canvas.on("selection:updated", function () { updateMergeButtonState(canvas, mergePointsId); });
    canvas.on("selection:cleared", function () { updateMergeButtonState(canvas, mergePointsId); });
    var groupBtn = document.getElementById(groupId);
    on(groupBtn, "click", () => groupSelection(canvas));
    if (groupBtn) {
      function runGroup(e) {
        e.preventDefault();
        e.stopPropagation();
        groupSelection(canvas);
      }
      groupBtn.addEventListener("pointerdown", runGroup, { passive: false });
      groupBtn.addEventListener("touchend", runGroup, { passive: false });
    }
    var duplicateBtn = document.getElementById(duplicateId);
    var lastDuplicateTime = 0;
    on(duplicateBtn, "click", function () {
      if (Date.now() - lastDuplicateTime < 400) return;
      lastDuplicateTime = Date.now();
      duplicateSelection(canvas);
    });
    if (duplicateBtn) {
      duplicateBtn.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        e.stopPropagation();
        lastDuplicateTime = Date.now();
        duplicateSelection(canvas);
      }, { passive: false });
      duplicateBtn.addEventListener("touchend", function (e) {
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    }
    on(document.getElementById(exportSvgId), "click", () => downloadSVG(canvas));
    on(document.getElementById(exportPdfId), "click", () => exportPDF(canvas));
  }

  // ========== API publique ==========
  global.FabricDrawing = {
    initCanvas: initCanvas,
    /**
     * Active/désactive le debug ciblé des points « ligne par points ».
     * @param {boolean} enabled
     */
    setPointUndoDebug: function (enabled) {
      FABRIC_DRAWING_POINT_UNDO_DEBUG = !!enabled;
      global.__FD_POINT_UNDO_DEBUG__ = FABRIC_DRAWING_POINT_UNDO_DEBUG;
    },
    /**
     * Retourne le dernier canvas Fabric initialisé.
     * @returns {fabric.Canvas|null}
     */
    getLastCanvas: function () {
      return LAST_FABRIC_CANVAS || null;
    },
    /**
     * Dump manuel de la structure des points/segments du dernier canvas ou d’un canvas donné.
     * @param {fabric.Canvas} [canvas]
     */
    dumpPointUndoDebug: function (canvas) {
      logLineByPointsStructure(canvas || LAST_FABRIC_CANVAS, "manual dump");
    },
    addGrid: addGrid,
    redrawGridIntensity: redrawGridIntensity,
    setMode: setMode,
    setDrawingMode: setDrawingMode,
    setSelectionMode: setSelectionMode,
    setLineMode: setLineMode,
    setArrowMode: setArrowMode,
    setLineByPointsMode: setLineByPointsMode,
    setDrawByPointsMode: setDrawByPointsMode,
    bindTwoPointMode: bindTwoPointMode,
    clearTwoPointMode: clearTwoPointMode,
    addTextBox: addTextBox,
    exportSVG: exportSVG,
    downloadSVG: downloadSVG,
    exportPDF: exportPDF,
    exportPDFToBlob: exportPDFToBlob,
    /**
     * Répare les relations internes (ligne par points) après un loadFromJSON externe.
     * Utile quand un canvas est restauré hors du flux undo natif.
     * @param {fabric.Canvas} canvas
     * @param {{lineByPointsLast?: {x:number,y:number}|null}} [opts]
     */
    repairAfterExternalLoad: function (canvas, opts) {
      if (!canvas) return;
      if (opts && opts.lineByPointsLast && typeof opts.lineByPointsLast.x === "number" && typeof opts.lineByPointsLast.y === "number") {
        canvas._lineByPointsLast = { x: opts.lineByPointsLast.x, y: opts.lineByPointsLast.y };
      }
      reapplyCustomControls(canvas);
      restoreLineByPointsMarker(canvas);
      canvas.requestRenderAll();
    },
    bindToolbar: bindToolbar,
    bindDeleteKey: bindDeleteKey,
    deleteSelection: deleteSelection,
    mergeSelectedPoints: mergeSelectedPoints,
    canMergePoints: canMergePoints,
    updateMergeButtonState: updateMergeButtonState,
    groupSelection: groupSelection,
    duplicateSelection: duplicateSelection,
    undo: undo,
    /**
     * Construit un tracé « ligne par points » (marqueurs + segments) et pousse un état dans l’historique (comme après conversion dessin par points).
     * @param {fabric.Canvas} canvas
     * @param {Array<{x:number,y:number}>} points - Au moins 2 points
     * @param {Object} [options] - stroke, strokeWidth
     */
    buildPolylineFromCanvasPoints: function (canvas, points, options) {
      if (!canvas) return;
      /** Comme path:created : pas d’étapes intermédiaires à chaque add(segment/marker). */
      canvas._skipNextHistory = true;
      try {
        buildPolylineFromCanvasPointsImpl(canvas, points, options);
      } finally {
        canvas._skipNextHistory = false;
      }
      if (canvas._history) saveUndoState(canvas, { reason: "drawByPoints:converted" });
    },
    setActiveModeButton: setActiveModeButton,
    CANVAS_ID: CANVAS_ID,
    MODE_DRAW: MODE_DRAW,
    MODE_SELECT: MODE_SELECT,
    MODE_LINE: MODE_LINE,
    MODE_ARROW: MODE_ARROW,
    MODE_LINE_BY_POINTS: MODE_LINE_BY_POINTS,
    MODE_DRAW_BY_POINTS: MODE_DRAW_BY_POINTS,
    MODE_SHAPES: MODE_SHAPES,
  };
})(typeof window !== "undefined" ? window : this);
