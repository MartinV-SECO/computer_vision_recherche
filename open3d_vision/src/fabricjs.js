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
  const DEFAULT_STROKE_WIDTH = 2;
  const DUPLICATE_OFFSET = 2;
  const ANGLE_SNAP_THRESHOLD_DEG = 4;
  /** Padding minimal du carré de sélection (lignes verticales/horizontales). */
  const MIN_SELECTION_PADDING = 10;
  /** Pas du magnétisme « ligne par points » : 0.25 (valeurs .0, .25, .5, .75). */
  const LINE_BY_POINTS_SNAP_STEP = 10;
  /** Distance minimale (px) entre deux points en dessin libre : réduit la sensibilité. */
  const FREEHAND_DECIMATE = 10;

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

  /**
   * Applique le magnétisme (grille) à tous les points d'un path.
   * Utilise canvas._freehandSnapStep (0 = pas de magnétisme).
   * @param {fabric.Canvas} canvas - Canvas (pour lire _freehandSnapStep)
   * @param {fabric.Path} path - Path produit par le dessin libre
   */
  function snapPathPointsToGrid(canvas, path) {
    if (!path || !path.path || !Array.isArray(path.path)) return;
    var step = canvas && canvas._freehandSnapStep != null ? canvas._freehandSnapStep : LINE_BY_POINTS_SNAP_STEP;
    if (step <= 0) return;
    var segs = path.path;
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i];
      if (!Array.isArray(seg)) continue;
      for (var j = 1; j < seg.length; j++) {
        if (typeof seg[j] === "number") seg[j] = snapToStep(seg[j], step);
      }
    }
    path.set("path", segs);
    path.setCoords();
  }
  /** Rayon du marqueur rouge du dernier point en mode ligne par points. */
  const LINE_BY_POINTS_MARKER_RADIUS = 6;

  /**
   * Crée le cercle rouge marquant le dernier point (mode ligne par points).
   * Déplaçable en mode sélection ; lié au segment dont il est l'extrémité.
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
      fill: "#e53935",
      originX: "center",
      originY: "center",
      selectable: true,
      evented: true,
      _isLineByPointsMarker: true,
      _lineByPointsMarkerLine: linkedLine || null,
    });
    return c;
  }

  /**
   * Met à jour le segment relié au marqueur rouge après déplacement (mode sélection).
   * Le point peut être déplacé librement ; la ligne se reconnecte à sa nouvelle position.
   * @param {fabric.Canvas} canvas
   * @param {fabric.Circle} marker - Cercle avec _isLineByPointsMarker et _lineByPointsMarkerLine
   */
  function updateLineFromMarker(canvas, marker) {
    if (!canvas || !marker || !marker._isLineByPointsMarker) return;
    var cx = marker.left;
    var cy = marker.top;
    var line = marker._lineByPointsMarkerLine;
    if (line && line.end_point) {
      line.end_point.x = cx;
      line.end_point.y = cy;
      rebuildLineGroup(line);
    } else {
      canvas._lineByPointsLast = { x: cx, y: cy };
    }
    canvas.requestRenderAll();
  }

  /**
   * Supprime tous les marqueurs rouges (ligne par points) du canvas.
   * Garantit au plus un marqueur affiché ; n'enregistre pas dans l'historique.
   * @param {fabric.Canvas} canvas
   */
  function removeAllLineByPointsMarkers(canvas) {
    if (!canvas) return;
    var objects = canvas.getObjects();
    var hadSkip = canvas._skipNextHistory;
    canvas._skipNextHistory = true;
    for (var i = objects.length - 1; i >= 0; i--) {
      if (objects[i]._isLineByPointsMarker) canvas.remove(objects[i]);
    }
    canvas._lineByPointsPreview = null;
    if (!hadSkip) canvas._skipNextHistory = false;
  }

  // ========== Grille (couche DOM statique, hors Fabric) ==========

  /**
   * Crée une grille en couche DOM statique (canvas 2D) derrière le canvas Fabric.
   * Intouchable, non sérialisée, pas un objet Fabric.
   */
  function addGridLayer(container, width, height, options) {
    if (!container || !width || !height) return null;
    var opts = options || {};
    var stroke = opts.stroke || "#e0e0e0";
    var strokeWidth = opts.strokeWidth != null ? opts.strokeWidth : 0.5;
    var backgroundColor = opts.backgroundColor || "#fafafa";

    var gridEl = document.createElement("canvas");
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

    var ctx = gridEl.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;

    var step = width / GRID_SCALE;
    for (var i = 0; i <= GRID_SCALE; i++) {
      var x = i * step;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (var j = 0; j <= Math.ceil(height / step); j++) {
      var y = j * step;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    container.style.position = "relative";
    container.insertBefore(gridEl, container.firstChild);
    return gridEl;
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
    const el = document.getElementById(containerId);
    if (!el) throw new Error("Container " + containerId + " introuvable.");
    const w = (opts && opts.width) || DEFAULT_WIDTH;
    const h = (opts && opts.height) || DEFAULT_HEIGHT;
    addGridLayer(el, w, h, { backgroundColor: "#fafafa" });
    const canvas = new fabric.Canvas(CANVAS_ID, {
      width: w,
      height: h,
      backgroundColor: "transparent",
      selection: true,
      preserveObjectStacking: true,
    });
    if (canvas.lowerCanvasEl && canvas.lowerCanvasEl.parentNode) {
      canvas.lowerCanvasEl.parentNode.style.position = "relative";
      canvas.lowerCanvasEl.parentNode.style.zIndex = "1";
    }
    wrapRequestRenderAll(canvas);
    initUndoHistory(canvas);
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
   * Log le dernier objet ajouté au canvas (après un input utilisateur), sauf pendant un undo.
   * @param {fabric.Canvas} canvas
   * @param {Object} [opt] - opt.target = objet ajouté
   */
  function logLastAddedObject(canvas, opt) {
    if (!canvas || canvas._skipNextHistory || !opt || !opt.target) return;
    var obj = opt.target;
    var type = obj.type || "unknown";
    var left = obj.left != null ? obj.left : "-";
    var top = obj.top != null ? obj.top : "-";
    var extra = "";
    if (obj._isLineByPointsMarker) extra = " [marqueur ligne par points]";
    else if (obj._isLineGroup) extra = " [ligne]";
    else if (obj._arrowX1 != null) extra = " [flèche]";
    console.log("Dernier objet ajouté après input:", type, "left=" + left, "top=" + top, extra);
  }

  /**
   * Initialise l'historique pour Annuler (backwards). Enregistre l'état initial et écoute les changements.
   * @param {fabric.Canvas} canvas
   */
  function initUndoHistory(canvas) {
    if (!canvas) return;
    canvas._history = [];
    canvas._historyLimit = 30;
    canvas._skipNextHistory = false;
    saveUndoState(canvas);
    canvas.on("object:added", function (opt) {
      logLastAddedObject(canvas, opt);
      saveUndoState(canvas);
    });
    canvas.on("object:modified", function (opt) {
      saveUndoState(canvas);
    });
    canvas.on("object:removed", function () { saveUndoState(canvas); });
    canvas.on("path:created", function (opt) {
      if (opt && opt.path) {
        snapPathPointsToGrid(canvas, opt.path);
        opt.path.set("strokeUniform", true);
        opt.path.set("padding", MIN_SELECTION_PADDING);
      }
      saveUndoState(canvas);
    });
  }

  /**
   * Enregistre l'état actuel du canvas dans l'historique (sauf si _skipNextHistory).
   * Inclut le dernier point du mode « ligne par points » pour que l'annuler remonte d'une étape.
   * @param {fabric.Canvas} canvas
   */
  function saveUndoState(canvas) {
    if (!canvas || !canvas._history || canvas._skipNextHistory) return;
    canvas._skipNextHistory = false;
    try {
      var marker = canvas._lineByPointsPreview;
      canvas._skipNextHistory = true;
      if (marker) canvas.remove(marker);
      var json = canvas.toJSON();
      if (marker) canvas.add(marker);
      canvas._skipNextHistory = false;
      var last = canvas._lineByPointsLast;
      var savedLast = last ? { x: last.x, y: last.y } : null;
      canvas._history.push({ json: json, _lineByPointsLast: savedLast });
      if (canvas._history.length > canvas._historyLimit) canvas._history.shift();
    } catch (e) {
      canvas._skipNextHistory = false;
    }
  }

  /**
   * Annule la dernière action : restaure l'état précédent du canvas.
   * Pour « ligne par points », le dernier point remonte d'une étape (marqueur restauré).
   * @param {fabric.Canvas} canvas
   */
  function undo(canvas) {
    if (!canvas || !canvas._history || canvas._history.length < 2) return;
    canvas._skipNextHistory = true;
    canvas._history.pop();
    var prev = canvas._history[canvas._history.length - 1];
    var json = prev && typeof prev === "object" && "json" in prev ? prev.json : prev;
    var savedLast = prev && typeof prev === "object" && prev._lineByPointsLast != null ? prev._lineByPointsLast : null;
    canvas.loadFromJSON(json, function () {
      reapplyCustomControls(canvas);
      canvas._lineByPointsPreview = null;
      canvas._lineByPointsLast = savedLast ? { x: savedLast.x, y: savedLast.y } : null;
      restoreLineByPointsMarker(canvas);
      canvas.requestRenderAll();
      setTimeout(function () { canvas._skipNextHistory = false; }, 0);
    });
  }

  /**
   * Recrée le marqueur rouge du dernier point (ligne par points) après un undo.
   * @param {fabric.Canvas} canvas
   */
  function restoreLineByPointsMarker(canvas) {
    if (!canvas || !canvas._lineByPointsLast) return;
    var objects = canvas.getObjects();
    var lastLine = null;
    for (var i = objects.length - 1; i >= 0; i--) {
      if (objects[i]._isLineGroup) {
        lastLine = objects[i];
        break;
      }
    }
    removeAllLineByPointsMarkers(canvas);
    canvas._lineByPointsPreview = createLineByPointsMarker(
      canvas._lineByPointsLast.x,
      canvas._lineByPointsLast.y,
      lastLine
    );
    canvas.add(canvas._lineByPointsPreview);
  }

  /**
   * Réapplique les contrôles personnalisés après loadFromJSON (undo). Supprime les marqueurs visuels (ex. dernier point ligne par points).
   * @param {fabric.Canvas} canvas
   */
  function reapplyCustomControls(canvas) {
    if (!canvas) return;
    var objects = canvas.getObjects();
    var toRemove = objects.filter(function (o) { return o._isLineByPointsMarker; });
    toRemove.forEach(function (o) { canvas.remove(o); });
    objects.forEach(function (o) {
      if ((o._isLineGroup || o._arrowX1 != null) && o.padding !== MIN_SELECTION_PADDING) {
        o.set("padding", MIN_SELECTION_PADDING);
      }
      if (o._isShapeGroup && o.padding !== MIN_SELECTION_PADDING) {
        o.set("padding", MIN_SELECTION_PADDING);
      }
      if (o.type === "path" && o.path && o.padding !== MIN_SELECTION_PADDING) {
        o.set("padding", MIN_SELECTION_PADDING);
      }
    });
  }

  // ========== Modes (dessin, sélection, deux points) ==========

  // ========== Modes (dessin, sélection, ligne, flèche) ==========

  /** Noms des modes utilisables avec setMode. */
  const MODE_DRAW = "draw";
  const MODE_SELECT = "select";
  const MODE_LINE = "line";
  const MODE_ARROW = "arrow";
  const MODE_LINE_BY_POINTS = "lineByPoints";
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
    var opts = options || {};
    clearTwoPointMode(canvas);

    switch (mode) {
      case MODE_DRAW:
        canvas.isDrawingMode = true;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        if (canvas.freeDrawingBrush) {
          canvas.freeDrawingBrush.color = opts.color || DEFAULT_STROKE;
          canvas.freeDrawingBrush.width = opts.strokeWidth != null ? opts.strokeWidth : DEFAULT_STROKE_WIDTH;
          canvas.freeDrawingBrush.decimate = FREEHAND_DECIMATE;
        }
        break;
      case MODE_SELECT:
        canvas.isDrawingMode = false;
        canvas.selection = true;
        canvas.skipTargetFind = false;
        break;
      case MODE_LINE:
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "line";
        canvas._twoPointOptions = opts;
        break;
      case MODE_ARROW:
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "arrow";
        canvas._twoPointOptions = opts;
        break;
      case MODE_LINE_BY_POINTS:
        canvas.isDrawingMode = false;
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.discardActiveObject();
        canvas._twoPointMode = "lineByPoints";
        canvas._twoPointOptions = opts;
        canvas._lineByPointsLast = null;
        break;
      case MODE_SHAPES:
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
   * Quitte le mode ligne/flèche et supprime la prévisualisation.
   * Fait disparaître le point rouge (marqueur ligne par points) à chaque changement de mode.
   * @param {fabric.Canvas} canvas
   */
  function clearTwoPointMode(canvas) {
    if (!canvas) return;
    canvas._twoPointMode = null;
    canvas._twoPointFirst = null;
    canvas._shapeType = null;
    canvas._lineByPointsLast = null;
    if (canvas._lineByPointsPreview) {
      canvas.remove(canvas._lineByPointsPreview);
      canvas._lineByPointsPreview = null;
    }
    var objects = canvas.getObjects();
    for (var i = objects.length - 1; i >= 0; i--) {
      if (objects[i]._isLineByPointsMarker) {
        canvas.remove(objects[i]);
      }
    }
    if (canvas._twoPointPreview) {
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
    }
    canvas.requestRenderAll();
  }

  // ========== Lignes (groupe avec start_point / end_point, même modèle que flèche) ==========

  /**
   * Reconstruit le segment de droite à l'intérieur du groupe à partir de start_point et end_point.
   * @param {fabric.Group} group - Groupe « ligne » (start_point, end_point, _lineOptions).
   */
  function rebuildLineGroup(group) {
    if (!group || !group.start_point || !group.end_point) return;
    const sx = group.start_point.x;
    const sy = group.start_point.y;
    const ex = group.end_point.x;
    const ey = group.end_point.y;
    const left = Math.min(sx, ex);
    const top = Math.min(sy, ey);
    const opts = group._lineOptions || {};
    const stroke = opts.stroke || DEFAULT_STROKE;
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
      group.removeWithUpdate(group.item(0));
    }
    group.addWithUpdate(newLine);
    group.set({ left: left, top: top });
    group.setCoords();
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
      stroke: opts.stroke || DEFAULT_STROKE,
      strokeWidth: opts.strokeWidth ?? DEFAULT_STROKE_WIDTH,
      selectable: false,
      evented: false,
      strokeUniform: true,
    });
    const group = new fabric.Group([line], {
      selectable: true,
      evented: true,
      padding: MIN_SELECTION_PADDING,
    });
    group.start_point = { x: x1, y: y1 };
    group.end_point = { x: x2, y: y2 };
    group._lineOptions = opts;
    group._isLineGroup = true;
    group.toObject = function (keysToInclude) {
      var obj = fabric.Group.prototype.toObject.call(this, keysToInclude);
      obj.start_point = this.start_point;
      obj.end_point = this.end_point;
      obj._lineOptions = this._lineOptions;
      obj._isLineGroup = this._isLineGroup;
      return obj;
    };
    rebuildLineGroup(group);
    return group;
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
      padding: MIN_SELECTION_PADDING,
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

    group.removeWithUpdate(group.item(0));
    group.removeWithUpdate(group.item(0));
    group.addWithUpdate(newLine);
    group.addWithUpdate(newTri);
    group.set({ left, top });
    group.setCoords();
  }

  // ========== Formes (carré, cercle, demi-cercle — plusieurs segments) ==========

  /** Nombre de segments pour l’approximation cercle / demi-cercle. */
  const SHAPE_CIRCLE_SEGMENTS = 24;

  /**
   * Crée un carré comme 4 lignes indépendantes (chaque côté manipulable séparément).
   * @param {number} x1 - Premier coin
   * @param {number} y1
   * @param {number} x2 - Coin opposé
   * @param {number} y2
   * @param {Object} [options] - { stroke, strokeWidth }
   * @returns {fabric.Group[]} - Tableau de 4 groupes ligne (côté haut, droit, bas, gauche)
   */
  function createSquareShape(x1, y1, x2, y2, options) {
    const opts = options || {};
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1) || 1;
    const h = Math.abs(y2 - y1) || 1;
    return [
      createLine(left, top, left + w, top, opts),
      createLine(left + w, top, left + w, top + h, opts),
      createLine(left + w, top + h, left, top + h, opts),
      createLine(left, top + h, left, top, opts),
    ];
  }

  /**
   * Crée une prévisualisation de carré (groupe unique, non manipulable).
   * @param {number} x1
   * @param {number} y1
   * @param {number} x2
   * @param {number} y2
   * @param {Object} [options]
   * @returns {fabric.Group}
   */
  function createSquarePreview(x1, y1, x2, y2, options) {
    const opts = options || {};
    const stroke = opts.stroke || DEFAULT_STROKE;
    const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1) || 1;
    const h = Math.abs(y2 - y1) || 1;
    const lineOpt = { stroke, strokeWidth, selectable: false, evented: false, strokeUniform: true };
    const lines = [
      new fabric.Line([0, 0, w, 0], lineOpt),
      new fabric.Line([w, 0, w, h], lineOpt),
      new fabric.Line([w, h, 0, h], lineOpt),
      new fabric.Line([0, h, 0, 0], lineOpt),
    ];
    return new fabric.Group(lines, { left: left, top: top, selectable: false, evented: false });
  }

  /**
   * Crée un cercle (groupe de segments de droite) centré en (cx, cy) avec rayon r.
   * @param {number} cx - Centre x
   * @param {number} cy - Centre y
   * @param {number} r - Rayon
   * @param {Object} [options] - { stroke, strokeWidth }
   * @returns {fabric.Group}
   */
  function createCircleShape(cx, cy, r, options) {
    const opts = options || {};
    const stroke = opts.stroke || DEFAULT_STROKE;
    const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
    if (r <= 0) r = 1;
    const n = SHAPE_CIRCLE_SEGMENTS;
    const lineOpt = { stroke, strokeWidth, selectable: false, evented: false, strokeUniform: true };
    const left = cx - r;
    const top = cy - r;
    const lines = [];
    for (var i = 0; i < n; i++) {
      var a1 = (i * 2 * Math.PI) / n;
      var a2 = ((i + 1) * 2 * Math.PI) / n;
      var x1 = r + r * Math.cos(a1);
      var y1 = r + r * Math.sin(a1);
      var x2 = r + r * Math.cos(a2);
      var y2 = r + r * Math.sin(a2);
      lines.push(new fabric.Line([x1, y1, x2, y2], lineOpt));
    }
    var group = new fabric.Group(lines, { left: left, top: top, selectable: true, evented: true, padding: MIN_SELECTION_PADDING });
    group._isShapeGroup = true;
    group.setCoords();
    return group;
  }

  /**
   * Crée un demi-cercle (groupe de segments) centré en (cx, cy), rayon r, moitié supérieure (0° à 180°).
   * @param {number} cx - Centre x
   * @param {number} cy - Centre y
   * @param {number} r - Rayon
   * @param {Object} [options] - { stroke, strokeWidth }
   * @returns {fabric.Group}
   */
  function createSemicircleShape(cx, cy, r, options) {
    const opts = options || {};
    const stroke = opts.stroke || DEFAULT_STROKE;
    const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
    if (r <= 0) r = 1;
    const n = Math.max(2, Math.floor(SHAPE_CIRCLE_SEGMENTS / 2));
    const lineOpt = { stroke, strokeWidth, selectable: false, evented: false, strokeUniform: true };
    const left = cx - r;
    const top = cy - r;
    const lines = [];
    for (var i = 0; i < n; i++) {
      var a1 = (i * Math.PI) / n;
      var a2 = ((i + 1) * Math.PI) / n;
      var x1 = r + r * Math.cos(a1);
      var y1 = r - r * Math.sin(a1);
      var x2 = r + r * Math.cos(a2);
      var y2 = r - r * Math.sin(a2);
      lines.push(new fabric.Line([x1, y1, x2, y2], lineOpt));
    }
    var group = new fabric.Group(lines, { left: left, top: top, selectable: true, evented: true, padding: MIN_SELECTION_PADDING });
    group._isShapeGroup = true;
    group.setCoords();
    return group;
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
  function bindTwoPointMode(canvas) {
    if (!canvas) return;
    canvas.on("object:modified", function (opt) {
      if (opt.target && opt.target._isLineByPointsMarker) updateLineFromMarker(canvas, opt.target);
    });
    canvas.on("mouse:down", function (opt) {
      const mode = canvas._twoPointMode;
      if (mode !== "line" && mode !== "arrow" && mode !== "lineByPoints" && mode !== "shape") return;
      canvas.discardActiveObject();
      const p = canvas.getPointer(opt.e);
      const x = p.x;
      const y = p.y;

      if (mode === "shape") {
        var shapeType = canvas._shapeType || "square";
        var opts = canvas._twoPointOptions || {};
        if (!canvas._twoPointFirst) {
          canvas._twoPointFirst = { x: x, y: y };
          if (shapeType === "square") {
            canvas._twoPointPreview = createSquarePreview(x, y, x, y, opts);
          } else if (shapeType === "circle") {
            canvas._twoPointPreview = createCircleShape(x, y, 1, opts);
          } else {
            canvas._twoPointPreview = createSemicircleShape(x, y, 1, opts);
          }
          canvas._twoPointPreview.selectable = false;
          canvas._twoPointPreview.evented = false;
          canvas.add(canvas._twoPointPreview);
        } else {
          var first = canvas._twoPointFirst;
          canvas.remove(canvas._twoPointPreview);
          canvas._twoPointPreview = null;
          var obj;
          if (shapeType === "square") {
            var objs = createSquareShape(first.x, first.y, x, y, opts);
            for (var i = 0; i < objs.length; i++) canvas.add(objs[i]);
            obj = null;
          } else if (shapeType === "circle") {
            var r = Math.sqrt((x - first.x) * (x - first.x) + (y - first.y) * (y - first.y));
            if (r < 2) r = 2;
            obj = createCircleShape(first.x, first.y, r, opts);
          } else {
            var r = Math.sqrt((x - first.x) * (x - first.x) + (y - first.y) * (y - first.y));
            if (r < 2) r = 2;
            obj = createSemicircleShape(first.x, first.y, r, opts);
          }
          if (obj) canvas.add(obj);
          canvas._twoPointFirst = null;
        }
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.requestRenderAll();
        return;
      }

      if (mode === "lineByPoints") {
        if (canvas._lineByPointsLast == null) {
          var sx = snapToQuarter(x);
          var sy = snapToQuarter(y);
          canvas._lineByPointsLast = { x: sx, y: sy };
          removeAllLineByPointsMarkers(canvas);
          canvas._lineByPointsPreview = createLineByPointsMarker(sx, sy, null);
          canvas.add(canvas._lineByPointsPreview);
          console.log("Ligne par points — position du point:", sx, sy);
        } else {
          const opts = canvas._twoPointOptions || {};
          var snapped = snapAngleToGrid(canvas._lineByPointsLast.x, canvas._lineByPointsLast.y, x, y, ANGLE_SNAP_THRESHOLD_DEG);
          snapped = { x: snapToQuarter(snapped.x), y: snapToQuarter(snapped.y) };
          const obj = createLine(canvas._lineByPointsLast.x, canvas._lineByPointsLast.y, snapped.x, snapped.y, opts);
          canvas.add(obj);
          canvas._lineByPointsLast = { x: snapped.x, y: snapped.y };
          removeAllLineByPointsMarkers(canvas);
          canvas._lineByPointsPreview = createLineByPointsMarker(snapped.x, snapped.y, obj);
          canvas.add(canvas._lineByPointsPreview);
          console.log("Ligne par points — position du point:", snapped.x, snapped.y);
        }
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.requestRenderAll();
        return;
      }

      if (!canvas._twoPointFirst) {
        canvas._twoPointFirst = { x, y };
        canvas._twoPointPreview = mode === "arrow"
          ? createArrow(x, y, x, y, canvas._twoPointOptions)
          : createLine(x, y, x, y, canvas._twoPointOptions);
        canvas._twoPointPreview.selectable = false;
        canvas._twoPointPreview.evented = false;
        canvas.add(canvas._twoPointPreview);
        opt.e.preventDefault();
        opt.e.stopPropagation();
        canvas.requestRenderAll();
        return;
      }

      if (mode === "line") {
        return;
      }

      const first_two_point = canvas._twoPointFirst;
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
      const snapped_point = snapAngleToGrid(first_two_point.x, first_two_point.y, x, y, ANGLE_SNAP_THRESHOLD_DEG);
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
      if (canvas._twoPointMode === "lineByPoints") return;
      if (!canvas._twoPointPreview || !canvas._twoPointFirst) return;
      const p = canvas.getPointer(opt.e);
      const first = canvas._twoPointFirst;
      const opts = canvas._twoPointOptions || {};

      if (canvas._twoPointMode === "shape") {
        var st = canvas._shapeType || "square";
        canvas.remove(canvas._twoPointPreview);
        if (st === "square") {
          canvas._twoPointPreview = createSquarePreview(first.x, first.y, p.x, p.y, opts);
        } else if (st === "circle") {
          var r = Math.sqrt((p.x - first.x) * (p.x - first.x) + (p.y - first.y) * (p.y - first.y));
          if (r < 2) r = 2;
          canvas._twoPointPreview = createCircleShape(first.x, first.y, r, opts);
        } else {
          var r = Math.sqrt((p.x - first.x) * (p.x - first.x) + (p.y - first.y) * (p.y - first.y));
          if (r < 2) r = 2;
          canvas._twoPointPreview = createSemicircleShape(first.x, first.y, r, opts);
        }
        canvas._twoPointPreview.selectable = false;
        canvas._twoPointPreview.evented = false;
        canvas.add(canvas._twoPointPreview);
        canvas.requestRenderAll();
        return;
      }

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
      if (canvas._twoPointMode !== "line" || !canvas._twoPointFirst || !canvas._twoPointPreview) return;
      const p = canvas.getPointer(opt.e);
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
   * Retourne le SVG du canvas (chaîne XML).
   * @param {fabric.Canvas} canvas
   * @param {Object} [options] - options passées à toSVG()
   * @returns {string}
   */
  function exportSVG(canvas, options) {
    if (!canvas) return "";
    return canvas.toSVG(options);
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

    function fallbackRasterPDF() {
      try {
        const dataUrl = canvas.toDataURL({ format: "png", quality: 1 });
        const imgW = canvas.width;
        const imgH = canvas.height;
        if (!JsPDFLib || !JsPDFLib.jsPDF) {
          if (done) done(new Error("jsPDF non chargé"));
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
      );
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

    // Simple sélection : ne jamais appeler .then sans vérifier que la valeur est une Promise
    if (!activeObj.type || activeObj.type !== "activeSelection") {
      var cloneResult = typeof activeObj.clone === "function" ? activeObj.clone() : undefined;
      if (cloneResult != null && typeof cloneResult.then === "function") {
        cloneResult.then(function (cloned) {
          applyOffsetAndSetup(cloned, activeObj, dx, dy);
          canvas.setActiveObject(cloned);
          canvas.requestRenderAll();
        });
      } else if (typeof activeObj.clone === "function") {
        activeObj.clone(function (cloned) {
          applyOffsetAndSetup(cloned, activeObj, dx, dy);
          canvas.setActiveObject(cloned);
          canvas.requestRenderAll();
        }, true);
      }
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
      if (clones.length === 1) canvas.setActiveObject(clones[0]);
      else if (clones.length > 1) canvas.setActiveObject(new fabric.ActiveSelection(clones, { canvas }));
      canvas.requestRenderAll();
    }
  }

  /**
   * Supprime l’objet sélectionné (ou tous les objets de la sélection multiple).
   * @param {fabric.Canvas} canvas
   */
  function groupSelection(canvas) {
    if (!canvas) return;
    var active = canvas.getActiveObject();
    if (!active || active.type !== "activeSelection") return;
    var group = active.toGroup();
    canvas.add(group);
    canvas.setActiveObject(group);
    canvas.requestRenderAll();
  }

  function deleteSelection(canvas) {
    if (!canvas) return;
    const active = canvas.getActiveObject();
    if (!active) return;
    if (active.type === "activeSelection") {
      active.getObjects().forEach(function (obj) {
        canvas.remove(obj);
      });
      canvas.discardActiveObject();
    } else {
      canvas.remove(active);
    }
    canvas.requestRenderAll();
  }

  /**
   * Branche la touche Delete/Backspace pour supprimer la sélection.
   * Ne fait rien si un IText est en cours d’édition.
   * @param {fabric.Canvas} canvas
   */
  function bindDeleteKey(canvas) {
    if (!canvas) return;
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = canvas.getActiveObject();
      if (!active) return;
      if (active.type === "i-text" && active.isEditing) return;
      e.preventDefault();
      deleteSelection(canvas);
    });
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
    const shapesId = id("shapes", "btnShapes");
    const shapeTypeId = id("shapeType", "shapeType");
    const textId = id("text", "btnText");
    const backwardsId = id("backwards", "btnBackwards");
    const deleteId = id("delete", "btnDelete");
    const groupId = id("group", "btnGroup");
    const duplicateId = id("duplicate", "btnDuplicate");
    const exportSvgId = id("exportSvg", "btnExportSvg");
    const exportPdfId = id("exportPdf", "btnExportPdf");
    const freehandSnapId = id("freehandSnap", "freehandSnap");

    canvas._modeButtons = {
      draw: document.getElementById(drawId),
      select: document.getElementById(selectId),
      line: document.getElementById(lineId),
      arrow: document.getElementById(arrowId),
      lineByPoints: document.getElementById(lineByPointsId),
      shapes: document.getElementById(shapesId),
    };
    setMode(canvas, MODE_DRAW);
    bindDeleteKey(canvas);

    const freehandSnapEl = document.getElementById(freehandSnapId);
    if (freehandSnapEl) {
      canvas._freehandSnapStep = parseInt(freehandSnapEl.value, 10) || 10;
      freehandSnapEl.addEventListener("change", function () {
        canvas._freehandSnapStep = parseInt(freehandSnapEl.value, 10) || 0;
      });
    } else {
      canvas._freehandSnapStep = 10;
    }

    const on = (elem, ev, fn) => elem && elem.addEventListener(ev, fn);
    on(document.getElementById(drawId), "click", () => {
      if (freehandSnapEl) canvas._freehandSnapStep = parseInt(freehandSnapEl.value, 10) || 0;
      setMode(canvas, MODE_DRAW);
      canvas.requestRenderAll();
    });
    on(document.getElementById(selectId), "click", () => setMode(canvas, MODE_SELECT));
    on(document.getElementById(lineId), "click", () => setMode(canvas, MODE_LINE));
    on(document.getElementById(arrowId), "click", () => setMode(canvas, MODE_ARROW));
    on(document.getElementById(lineByPointsId), "click", () => setMode(canvas, MODE_LINE_BY_POINTS));
    const shapeTypeEl = document.getElementById(shapeTypeId);
    on(document.getElementById(shapesId), "click", () => {
      var shapeType = shapeTypeEl && shapeTypeEl.value ? shapeTypeEl.value : "square";
      setMode(canvas, MODE_SHAPES, { shapeType: shapeType });
      canvas.requestRenderAll();
    });
    on(document.getElementById(textId), "click", () => {
      setMode(canvas, MODE_SELECT);
      addTextBox(canvas, { left: 80, top: 80 });
    });
    on(document.getElementById(backwardsId), "click", () => undo(canvas));
    on(document.getElementById(deleteId), "click", () => deleteSelection(canvas));
    on(document.getElementById(groupId), "click", () => groupSelection(canvas));
    on(document.getElementById(duplicateId), "click", () => duplicateSelection(canvas));
    on(document.getElementById(exportSvgId), "click", () => downloadSVG(canvas));
    on(document.getElementById(exportPdfId), "click", () => exportPDF(canvas));
  }

  // ========== API publique ==========
  global.FabricDrawing = {
    initCanvas: initCanvas,
    addGrid: addGrid,
    setMode: setMode,
    setDrawingMode: setDrawingMode,
    setSelectionMode: setSelectionMode,
    setLineMode: setLineMode,
    setArrowMode: setArrowMode,
    setLineByPointsMode: setLineByPointsMode,
    bindTwoPointMode: bindTwoPointMode,
    clearTwoPointMode: clearTwoPointMode,
    addTextBox: addTextBox,
    exportSVG: exportSVG,
    downloadSVG: downloadSVG,
    exportPDF: exportPDF,
    bindToolbar: bindToolbar,
    bindDeleteKey: bindDeleteKey,
    deleteSelection: deleteSelection,
    groupSelection: groupSelection,
    duplicateSelection: duplicateSelection,
    undo: undo,
    setActiveModeButton: setActiveModeButton,
    CANVAS_ID: CANVAS_ID,
    MODE_DRAW: MODE_DRAW,
    MODE_SELECT: MODE_SELECT,
    MODE_LINE: MODE_LINE,
    MODE_ARROW: MODE_ARROW,
    MODE_LINE_BY_POINTS: MODE_LINE_BY_POINTS,
    MODE_SHAPES: MODE_SHAPES,
  };
})(typeof window !== "undefined" ? window : this);
