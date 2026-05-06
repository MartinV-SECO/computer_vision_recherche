/**
 * Module Fabric.js pour le dessin vectoriel : canvas, outils, zones de texte, export SVG/PDF.
 * Dépend de : Fabric.js (global fabric), et pour le PDF : jsPDF + svg2pdf (optionnel).
 */

(function (global) {
  "use strict";

  const CANVAS_ID = "fabric-canvas";
  const DEFAULT_WIDTH = 1000;
  const DEFAULT_HEIGHT = 800;
  const GRID_SCALE = 100;

  /**
   * Ajoute un quadrillage en échelle 1 à 100 (100 divisions sur la largeur).
   * Le groupe est envoyé à l'arrière-plan et n'est pas sélectionnable.
   * @param {fabric.Canvas} canvas
   * @param {Object} options - { stroke, strokeWidth }
   * @returns {fabric.Group}
   */
  function addGrid(canvas, options) {
    if (!canvas) return null;
    const opts = options || {};
    const stroke = opts.stroke || "#e0e0e0";
    const strokeWidth = opts.strokeWidth ?? 0.5;
    const w = canvas.width;
    const h = canvas.height;
    const step = w / GRID_SCALE;
    const lines = [];
    for (var i = 0; i <= GRID_SCALE; i++) {
      const x = i * step;
      lines.push(
        new fabric.Line([x, 0, x, h], {
          stroke: stroke,
          strokeWidth: strokeWidth,
          selectable: false,
          evented: false,
        })
      );
    }
    const numHorizontal = Math.ceil(h / step);
    for (var j = 0; j <= numHorizontal; j++) {
      const y = j * step;
      lines.push(
        new fabric.Line([0, y, w, y], {
          stroke: stroke,
          strokeWidth: strokeWidth,
          selectable: false,
          evented: false,
        })
      );
    }
    const group = new fabric.Group(lines, {
      selectable: false,
      evented: false,
      lockMovementX: true,
      lockMovementY: true,
    });
    canvas.add(group);
    group.sendToBack();
    canvas.requestRenderAll();
    return group;
  }

  /**
   * Initialise le canvas Fabric.js dans l'élément cible.
   * @param {string} containerId - Id du conteneur DOM
   * @param {Object} opts - { width, height }
   * @returns {fabric.Canvas}
   */
  function initCanvas(containerId, opts) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error("Container " + containerId + " introuvable.");
    const w = (opts && opts.width) || DEFAULT_WIDTH;
    const h = (opts && opts.height) || DEFAULT_HEIGHT;
    const canvas = new fabric.Canvas(CANVAS_ID, {
      width: w,
      height: h,
      backgroundColor: "#fafafa",
      selection: true,
      preserveObjectStacking: true,
    });
    addGrid(canvas);
    return canvas;
  }

  /**
   * Active le mode dessin libre (trait au doigt/souris).
   * @param {fabric.Canvas} canvas
   * @param {Object} options - { color, strokeWidth }
   */
  function setDrawingMode(canvas, options) {
    if (!canvas) return;
    canvas.isDrawingMode = true;
    canvas.selection = true;
    canvas.skipTargetFind = true;
    canvas.discardActiveObject();
    clearTwoPointMode(canvas);
    const brush = canvas.freeDrawingBrush;
    brush.color = (options && options.color) || "#1a73e8";
    brush.width = (options && options.strokeWidth) || 2;
  }

  /**
   * Désactive le mode dessin libre (sélection/déplacement des objets).
   * @param {fabric.Canvas} canvas
   */
  function setSelectionMode(canvas) {
    if (!canvas) return;
    canvas.isDrawingMode = false;
    canvas.skipTargetFind = false;
    clearTwoPointMode(canvas);
  }

  /**
   * Arrête le mode ligne/flèche et supprime la prévisualisation.
   * @param {fabric.Canvas} canvas
   */
  function clearTwoPointMode(canvas) {
    if (!canvas) return;
    canvas._twoPointMode = null;
    canvas._twoPointFirst = null;
    if (canvas._twoPointPreview) {
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
    }
    canvas.requestRenderAll();
  }

  /**
   * Crée un segment de droite entre deux points.
   * @param {number} x1 - Abscisse départ
   * @param {number} y1 - Ordonnée départ
   * @param {number} x2 - Abscisse arrivée
   * @param {number} y2 - Ordonnée arrivée
   * @param {Object} options - { stroke, strokeWidth }
   * @returns {fabric.Line}
   */
  function createLine(x1, y1, x2, y2, options) {
    const opts = options || {};
    const line = new fabric.Line([x1, y1, x2, y2], {
      stroke: opts.stroke || "#1a73e8",
      strokeWidth: opts.strokeWidth ?? 2,
      selectable: true,
      evented: true,
    });
    setupLineEndpointControls(line);
    return line;
  }

  /**
   * Configure les contrôles de type "poignées d'extrémité" pour une ligne (déplacer chaque point).
   * @param {fabric.Line} line
   */
  function setupLineEndpointControls(line) {
    if (!line || line.type !== "line") return;
    line.setControlsVisibility({
      mt: false, mb: false, ml: false, mr: false,
      tl: false, tr: false, bl: false, br: false, mtr: false,
    });
    var makePositionHandler = function (isFirst) {
      return function (dim, finalMatrix, fabricObject) {
        var l = fabricObject;
        var x = isFirst ? l.x1 : l.x2;
        var y = isFirst ? l.y1 : l.y2;
        var left = l.left != null ? l.left : Math.min(l.x1, l.x2);
        var top = l.top != null ? l.top : Math.min(l.y1, l.y2);
        return new fabric.Point(x - left, y - top);
      };
    };
    var makeActionHandler = function (isFirst) {
      return function (eventData, transform, x, y) {
        var l = transform.target;
        if (!l || l.type !== "line") return false;
        var matrix = l.calcTransformMatrix();
        var inv = fabric.util.invertTransform(matrix);
        var local = fabric.util.transformPoint({ x: x, y: y }, inv);
        var left = l.left != null ? l.left : Math.min(l.x1, l.x2);
        var top = l.top != null ? l.top : Math.min(l.y1, l.y2);
        if (isFirst) {
          l.set({ x1: left + local.x, y1: top + local.y });
        } else {
          l.set({ x2: left + local.x, y2: top + local.y });
        }
        l.setCoords();
        return true;
      };
    };
    line.controls = line.controls || {};
    line.controls.p1 = new fabric.Control({
      x: 0, y: 0,
      offsetX: 0, offsetY: 0,
      cursorStyle: "crosshair",
      positionHandler: makePositionHandler(true),
      actionHandler: makeActionHandler(true),
    });
    line.controls.p2 = new fabric.Control({
      x: 0, y: 0,
      offsetX: 0, offsetY: 0,
      cursorStyle: "crosshair",
      positionHandler: makePositionHandler(false),
      actionHandler: makeActionHandler(false),
    });
  }

  /**
   * Crée une flèche (ligne + tête pleine) entre deux points.
   * @param {number} x1 - Abscisse départ
   * @param {number} y1 - Ordonnée départ
   * @param {number} x2 - Abscisse arrivée (pointe)
   * @param {number} y2 - Ordonnée arrivée (pointe)
   * @param {Object} options - { stroke, strokeWidth, headSize }
   * @returns {fabric.Group}
   */
  function createArrow(x1, y1, x2, y2, options) {
    const opts = options || {};
    const stroke = opts.stroke || "#1a73e8";
    const strokeWidth = opts.strokeWidth ?? 2;
    const headSize = opts.headSize ?? 12;
    if (x1 === x2 && y1 === y2) {
      x2 = x1 + 1;
    }
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseX = x2 - cos * headSize * 2;
    const baseY = y2 - sin * headSize * 2;
    const line = new fabric.Line([x1, y1, baseX, baseY], {
      stroke: stroke,
      strokeWidth: strokeWidth,
      selectable: false,
      evented: false,
    });
    const wx = headSize * sin;
    const wy = headSize * cos;
    const triangle = new fabric.Polygon(
      [
        { x: x2, y: y2 },
        { x: baseX + wx, y: baseY - wy },
        { x: baseX - wx, y: baseY + wy },
      ],
      {
        fill: stroke,
        stroke: stroke,
        strokeWidth: 1,
        selectable: false,
        evented: false,
      }
    );
    const group = new fabric.Group([line, triangle], {
      selectable: true,
      evented: true,
    });
    group._arrowX1 = x1;
    group._arrowY1 = y1;
    group._arrowX2 = x2;
    group._arrowY2 = y2;
    group._arrowOptions = opts;
    setupArrowEndpointControls(group);
    return group;
  }

  /**
   * Reconstruit le contenu d'un groupe flèche à partir de _arrowX1/Y1/X2/Y2 et _arrowOptions.
   * @param {fabric.Group} group
   */
  function rebuildArrowGroup(group) {
    var x1 = group._arrowX1;
    var y1 = group._arrowY1;
    var x2 = group._arrowX2;
    var y2 = group._arrowY2;
    var opts = group._arrowOptions || {};
    var stroke = opts.stroke || "#1a73e8";
    var strokeWidth = opts.strokeWidth ?? 2;
    var headSize = opts.headSize ?? 12;
    if (x1 === x2 && y1 === y2) x2 = x1 + 1;
    var angle = Math.atan2(y2 - y1, x2 - x1);
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    var baseX = x2 - cos * headSize * 2;
    var baseY = y2 - sin * headSize * 2;
    var left = Math.min(x1, x2, baseX);
    var top = Math.min(y1, y2, baseY);
    var lx1 = x1 - left;
    var ly1 = y1 - top;
    var lbaseX = baseX - left;
    var lbaseY = baseY - top;
    var lx2 = x2 - left;
    var ly2 = y2 - top;
    var newLine = new fabric.Line([lx1, ly1, lbaseX, lbaseY], {
      stroke: stroke, strokeWidth: strokeWidth, selectable: false, evented: false,
    });
    var wx = headSize * sin;
    var wy = headSize * cos;
    var newTri = new fabric.Polygon(
      [{ x: lx2, y: ly2 }, { x: lbaseX + wx, y: lbaseY - wy }, { x: lbaseX - wx, y: lbaseY + wy }],
      { fill: stroke, stroke: stroke, strokeWidth: 1, selectable: false, evented: false }
    );
    group.removeWithUpdate(group.item(0));
    group.removeWithUpdate(group.item(0));
    group.addWithUpdate(newLine);
    group.addWithUpdate(newTri);
    group.set({ left: left, top: top });
    group.setCoords();
  }

  /**
   * Configure les contrôles d'extrémité pour un groupe flèche (déplacer départ et pointe).
   * @param {fabric.Group} group
   */
  function setupArrowEndpointControls(group) {
    if (!group || group.type !== "group" || group._arrowX1 == null) return;
    group.setControlsVisibility({
      mt: false, mb: false, ml: false, mr: false,
      tl: false, tr: false, bl: false, br: false, mtr: false,
    });
    var makePositionHandler = function (isFirst) {
      return function (dim, finalMatrix, fabricObject) {
        var g = fabricObject;
        var x = isFirst ? g._arrowX1 : g._arrowX2;
        var y = isFirst ? g._arrowY1 : g._arrowY2;
        var left = g.left != null ? g.left : 0;
        var top = g.top != null ? g.top : 0;
        return new fabric.Point(x - left, y - top);
      };
    };
    var makeActionHandler = function (isFirst) {
      return function (eventData, transform, x, y) {
        var g = transform.target;
        if (!g || g._arrowX1 == null) return false;
        var matrix = g.calcTransformMatrix();
        var inv = fabric.util.invertTransform(matrix);
        var local = fabric.util.transformPoint({ x: x, y: y }, inv);
        var left = g.left != null ? g.left : 0;
        var top = g.top != null ? g.top : 0;
        if (isFirst) {
          g._arrowX1 = left + local.x;
          g._arrowY1 = top + local.y;
        } else {
          g._arrowX2 = left + local.x;
          g._arrowY2 = top + local.y;
        }
        rebuildArrowGroup(g);
        return true;
      };
    };
    group.controls = group.controls || {};
    group.controls.p1 = new fabric.Control({
      x: 0, y: 0, offsetX: 0, offsetY: 0, cursorStyle: "crosshair",
      positionHandler: makePositionHandler(true),
      actionHandler: makeActionHandler(true),
    });
    group.controls.p2 = new fabric.Control({
      x: 0, y: 0, offsetX: 0, offsetY: 0, cursorStyle: "crosshair",
      positionHandler: makePositionHandler(false),
      actionHandler: makeActionHandler(false),
    });
  }

  /**
   * Active le mode traçage de ligne : premier clic = départ, second clic = arrivée.
   * @param {fabric.Canvas} canvas
   * @param {Object} options - { stroke, strokeWidth }
   */
  function setLineMode(canvas, options) {
    if (!canvas) return;
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.skipTargetFind = true;
    canvas.discardActiveObject();
    clearTwoPointMode(canvas);
    canvas._twoPointMode = "line";
    canvas._twoPointOptions = options || {};
  }

  /**
   * Active le mode traçage de flèche (tête pleine) : premier clic = départ, second clic = pointe.
   * @param {fabric.Canvas} canvas
   * @param {Object} options - { stroke, strokeWidth, headSize }
   */
  function setArrowMode(canvas, options) {
    if (!canvas) return;
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.skipTargetFind = true;
    canvas.discardActiveObject();
    clearTwoPointMode(canvas);
    canvas._twoPointMode = "arrow";
    canvas._twoPointOptions = options || {};
  }

  /**
   * Ramène le point (x2, y2) sur un angle 0° ou 90° par rapport à (x1, y1)
   * si l'inclinaison est dans la marge (ex. 86° → 90° avec seuil 4°).
   * @param {number} x1 - Abscisse départ
   * @param {number} y1 - Ordonnée départ
   * @param {number} x2 - Abscisse arrivée
   * @param {number} y2 - Ordonnée arrivée
   * @param {number} thresholdDeg - Marge en degrés (défaut 4)
   * @returns {{ x: number, y: number }}
   */
  function snapAngleToGrid(x1, y1, x2, y2, thresholdDeg) {
    var th = thresholdDeg != null ? thresholdDeg : 4;
    var dx = x2 - x1;
    var dy = y2 - y1;
    if (dx === 0 && dy === 0) return { x: x2, y: y2 };
    var angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDeg < 0) angleDeg += 360;
    var a = angleDeg;
    if (a <= th || a >= 360 - th || (a >= 180 - th && a <= 180 + th)) {
      return { x: x2, y: y1 };
    }
    if ((a >= 90 - th && a <= 90 + th) || (a >= 270 - th && a <= 270 + th)) {
      return { x: x1, y: y2 };
    }
    return { x: x2, y: y2 };
  }

  /**
   * Branche les événements souris pour le mode ligne/flèche (deux clics).
   * À appeler après initCanvas pour que le mode ligne/flèche réagisse aux clics.
   * @param {fabric.Canvas} canvas
   */
  function bindTwoPointMode(canvas) {
    if (!canvas) return;
    canvas.on("mouse:down", function (opt) {
      const mode = canvas._twoPointMode;
      if (mode !== "line" && mode !== "arrow") return;
      canvas.discardActiveObject();
      const p = canvas.getPointer(opt.e);
      const x = p.x;
      const y = p.y;
      if (!canvas._twoPointFirst) {
        canvas._twoPointFirst = { x: x, y: y };
        canvas._twoPointPreview =
          mode === "arrow"
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
      const first = canvas._twoPointFirst;
      canvas.remove(canvas._twoPointPreview);
      canvas._twoPointPreview = null;
      var snapped = snapAngleToGrid(first.x, first.y, x, y, 4);
      const obj =
        mode === "arrow"
          ? createArrow(first.x, first.y, snapped.x, snapped.y, canvas._twoPointOptions)
          : createLine(first.x, first.y, snapped.x, snapped.y, canvas._twoPointOptions);
      canvas.add(obj);
      canvas._twoPointFirst = null;
      opt.e.preventDefault();
      opt.e.stopPropagation();
      canvas.requestRenderAll();
    });
    canvas.on("mouse:move", function (opt) {
      if (!canvas._twoPointPreview || !canvas._twoPointFirst) return;
      const p = canvas.getPointer(opt.e);
      const first = canvas._twoPointFirst;
      var snapped = snapAngleToGrid(first.x, first.y, p.x, p.y, 4);
      const opts = canvas._twoPointOptions || {};
      if (canvas._twoPointMode === "line") {
        canvas._twoPointPreview.set({
          x2: snapped.x,
          y2: snapped.y,
        });
        canvas._twoPointPreview.setCoords();
      } else {
        canvas.remove(canvas._twoPointPreview);
        canvas._twoPointPreview = createArrow(
          first.x,
          first.y,
          snapped.x,
          snapped.y,
          opts
        );
        canvas._twoPointPreview.selectable = false;
        canvas._twoPointPreview.evented = false;
        canvas.add(canvas._twoPointPreview);
      }
      canvas.requestRenderAll();
    });
  }

  /**
   * Ajoute une zone de texte éditable sur le canvas.
   * @param {fabric.Canvas} canvas
   * @param {Object} options - { left, top, text, fontSize, fontFamily }
   * @returns {fabric.IText}
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

  /**
   * Récupère le SVG du canvas (chaîne XML).
   * @param {fabric.Canvas} canvas
   * @param {Object} options - options passées à toSVG()
   * @returns {string}
   */
  function exportSVG(canvas, options) {
    if (!canvas) return "";
    return canvas.toSVG(options);
  }

  /**
   * Déclenche le téléchargement du SVG.
   * @param {fabric.Canvas} canvas
   * @param {string} filename
   */
  function downloadSVG(canvas, filename) {
    const svg = exportSVG(canvas, { suppressPreamble: false });
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, filename || "dessin.svg");
  }

  /**
   * Télécharge un Blob sous forme de fichier.
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

  /**
   * Retourne la librairie jsPDF (window.jspdf ou global jspdf).
   */
  function getJsPDF() {
    return (typeof window !== "undefined" && window.jspdf) || (typeof jspdf !== "undefined" ? jspdf : null);
  }

  /**
   * Exporte le canvas en PDF (vectoriel si svg2pdf disponible, sinon image PNG).
   * @param {fabric.Canvas} canvas
   * @param {string} filename
   * @param {Function} done - callback (err) appelé à la fin
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
        downloadBlob(
          new Blob([pdf.output("blob")], { type: "application/pdf" }),
          name
        );
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
          downloadBlob(
            new Blob([pdf.output("blob")], { type: "application/pdf" }),
            name
          );
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

  /**
   * Duplique l'objet (ou la sélection) actuellement sélectionné par sérialisation JSON.
   * Fonctionne avec lignes, flèches, texte et dessin libre.
   * @param {fabric.Canvas} canvas
   */
  function duplicateSelection(canvas) {
    if (!canvas) return;
    var active = canvas.getActiveObject();
    if (!active) return;
    var offset = 20;
    var jsons = [];
    var originals = [];
    if (active.type === "activeSelection") {
      active.getObjects().forEach(function (obj) {
        jsons.push(obj.toObject());
        originals.push(obj);
      });
    } else {
      jsons.push(active.toObject());
      originals.push(active);
    }
    fabric.util.enlivenObjects(jsons).then(function (objects) {
      function applyOffsetAndSetup(obj, orig, dx, dy) {
        obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
        if (obj.type === "line") {
          setupLineEndpointControls(obj);
        }
        if (obj.type === "group" && orig && orig._arrowX1 != null) {
          obj._arrowX1 = orig._arrowX1 + dx;
          obj._arrowY1 = orig._arrowY1 + dy;
          obj._arrowX2 = orig._arrowX2 + dx;
          obj._arrowY2 = orig._arrowY2 + dy;
          obj._arrowOptions = orig._arrowOptions;
          rebuildArrowGroup(obj);
          setupArrowEndpointControls(obj);
        }
        obj.setCoords();
        canvas.add(obj);
      }
      objects.forEach(function (obj, i) {
        var orig = originals[i] || null;
        applyOffsetAndSetup(obj, orig, offset, offset);
      });
      if (objects.length === 1) {
        canvas.setActiveObject(objects[0]);
      } else if (objects.length > 1) {
        var sel = new fabric.ActiveSelection(objects, { canvas: canvas });
        canvas.setActiveObject(sel);
      }
      canvas.requestRenderAll();
    }).catch(function (err) {
      console.error("Duplication échouée:", err);
    });
  }

  /**
   * Supprime l'objet (ou la sélection multiple) actuellement sélectionné.
   * Utilisable depuis le bouton Supprimer (tablette) ou la touche Delete.
   * @param {fabric.Canvas} canvas
   */
  function deleteSelection(canvas) {
    if (!canvas) return;
    var active = canvas.getActiveObject();
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
   * Branche la touche Delete (et Backspace) pour supprimer l'objet sélectionné.
   * En mode sélection multiple, supprime tous les objets de la sélection.
   * @param {fabric.Canvas} canvas
   */
  function bindDeleteKey(canvas) {
    if (!canvas) return;
    function onKeyDown(e) {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      var active = canvas.getActiveObject();
      if (!active) return;
      if (active.type === "i-text" && active.isEditing) return;
      e.preventDefault();
      deleteSelection(canvas);
    }
    document.addEventListener("keydown", onKeyDown);
  }

  /**
   * Met à jour l'indication visuelle du mode actif (bouton souligné).
   * @param {fabric.Canvas} canvas
   * @param {string} mode - 'draw' | 'select' | 'line' | 'arrow'
   */
  function setActiveModeButton(canvas, mode) {
    if (!canvas || !canvas._modeButtons) return;
    var btns = canvas._modeButtons;
    for (var k in btns) {
      if (btns[k]) btns[k].classList.remove("active");
    }
    if (btns[mode]) btns[mode].classList.add("active");
  }

  /**
   * Attache les boutons de la barre d'outils au canvas (ids attendus dans le DOM).
   * @param {fabric.Canvas} canvas
   * @param {Object} ids - { draw, select, line, arrow, text, delete, duplicate, exportSvg, exportPdf }
   */
  function bindToolbar(canvas, ids) {
    if (!canvas || !ids) return;
    const drawId = ids.draw || "btnDraw";
    const selectId = ids.select || "btnSelect";
    const lineId = ids.line || "btnLine";
    const arrowId = ids.arrow || "btnArrow";
    const textId = ids.text || "btnText";
    const deleteId = ids.delete || "btnDelete";
    const duplicateId = ids.duplicate || "btnDuplicate";
    const exportSvgId = ids.exportSvg || "btnExportSvg";
    const exportPdfId = ids.exportPdf || "btnExportPdf";

    const drawBtn = document.getElementById(drawId);
    const selectBtn = document.getElementById(selectId);
    const lineBtn = document.getElementById(lineId);
    const arrowBtn = document.getElementById(arrowId);
    const textBtn = document.getElementById(textId);
    const deleteBtn = document.getElementById(deleteId);
    const duplicateBtn = document.getElementById(duplicateId);
    const svgBtn = document.getElementById(exportSvgId);
    const pdfBtn = document.getElementById(exportPdfId);

    canvas._modeButtons = {
      draw: drawBtn,
      select: selectBtn,
      line: lineBtn,
      arrow: arrowBtn,
    };
    setActiveModeButton(canvas, "draw");

    bindDeleteKey(canvas);

    if (drawBtn) {
      drawBtn.addEventListener("click", function () {
        setDrawingMode(canvas);
        canvas.discardActiveObject();
        setActiveModeButton(canvas, "draw");
        canvas.requestRenderAll();
      });
    }
    if (selectBtn) {
      selectBtn.addEventListener("click", function () {
        setSelectionMode(canvas);
        setActiveModeButton(canvas, "select");
      });
    }
    if (lineBtn) {
      lineBtn.addEventListener("click", function () {
        setLineMode(canvas);
        setActiveModeButton(canvas, "line");
      });
    }
    if (arrowBtn) {
      arrowBtn.addEventListener("click", function () {
        setArrowMode(canvas);
        setActiveModeButton(canvas, "arrow");
      });
    }
    if (textBtn) {
      textBtn.addEventListener("click", function () {
        setSelectionMode(canvas);
        setActiveModeButton(canvas, "select");
        addTextBox(canvas, { left: 80, top: 80 });
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", function () {
        deleteSelection(canvas);
      });
    }
    if (duplicateBtn) {
      duplicateBtn.addEventListener("click", function () {
        duplicateSelection(canvas);
      });
    }
    if (svgBtn) {
      svgBtn.addEventListener("click", function () {
        downloadSVG(canvas);
      });
    }
    if (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        exportPDF(canvas);
      });
    }
  }

  // API publique
  global.FabricDrawing = {
    initCanvas: initCanvas,
    addGrid: addGrid,
    setDrawingMode: setDrawingMode,
    setSelectionMode: setSelectionMode,
    setLineMode: setLineMode,
    setArrowMode: setArrowMode,
    bindTwoPointMode: bindTwoPointMode,
    clearTwoPointMode: clearTwoPointMode,
    addTextBox: addTextBox,
    exportSVG: exportSVG,
    downloadSVG: downloadSVG,
    exportPDF: exportPDF,
    bindToolbar: bindToolbar,
    bindDeleteKey: bindDeleteKey,
    deleteSelection: deleteSelection,
    duplicateSelection: duplicateSelection,
    setActiveModeButton: setActiveModeButton,
    CANVAS_ID: CANVAS_ID,
  };
})(typeof window !== "undefined" ? window : this);
