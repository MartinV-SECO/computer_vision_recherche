""" 
Serveur web pour l'outil de dessin vectoriel.
Reproduit le comportement du notebook vectorial_drawing_tool :
- Clic gauche : ajouter un point (relié par une droite).
- Clic droit : terminer la ligne en cours.
- Export DXF et SVG.

Lancement : python vectorial_drawing_web.py
Puis ouvrir http://localhost:8000
"""

from pathlib import Path
import io
import socket

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import HTMLResponse, Response
    from fastapi.staticfiles import StaticFiles
    import uvicorn
except ImportError:
    raise ImportError("Installer les dépendances web : pip install fastapi uvicorn")

try:
    import ezdxf
except ImportError:
    ezdxf = None

app = FastAPI(title="Outil de dessin vectoriel")

# Répertoire du script pour servir les fichiers statiques
SCRIPT_DIR = Path(__file__).resolve().parent
STATIC_DIR = SCRIPT_DIR / "vectorial_drawing_static"
STATIC_DIR.mkdir(exist_ok=True)


def export_dxf_from_polylines(polylines: list, height: float = 1000.0) -> bytes:
    """
    Génère un fichier DXF à partir des polylignes (Y inversé, origine en bas à gauche).
    """
    if ezdxf is None:
        raise ImportError("Installer ezdxf : pip install ezdxf")
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    for pts in polylines:
        if len(pts) < 2:
            continue
        pts_dxf = [(float(x), height - float(y)) for x, y in pts]
        msp.add_lwpolyline(pts_dxf, close=False)
    buffer = io.BytesIO()
    doc.write(buffer)
    return buffer.getvalue()


def export_svg_from_polylines(polylines: list) -> str:
    """
    Génère le contenu SVG à partir des polylignes (pour téléchargement côté serveur optionnel).
    """
    paths = []
    for pts in polylines:
        if len(pts) < 2:
            continue
        d = f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"
        for x, y in pts[1:]:
            d += f" L {x:.2f} {y:.2f}"
        paths.append(f'  <path d="{d}" fill="none" stroke="black" stroke-width="2"/>')
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">\n'
        + "\n".join(paths)
        + "\n</svg>"
    )


@app.get("/", response_class=HTMLResponse)
def index():
    """Sert la page principale du dessin."""
    html_path = STATIC_DIR / "index.html"
    if html_path.exists():
        return HTMLResponse(html_path.read_text(encoding="utf-8"))
    return HTMLResponse(_fallback_html())


@app.get("/favicon.ico")
def favicon():
    """Évite le 404 quand le navigateur demande l’icône."""
    return Response(status_code=204)


@app.get("/.well-known/appspecific/com.chrome.devtools.json")
def chrome_devtools():
    """Évite le 404 pour la requête DevTools de Chrome."""
    return Response(status_code=204)


@app.get("/fabricjs.js", response_class=Response)
def serve_fabricjs():
    """Sert fabricjs.js depuis SCRIPT_DIR (src/fabricjs.js) pour une seule source à jour."""
    js_path = SCRIPT_DIR / "fabricjs.js"
    if not js_path.exists():
        return Response(status_code=404, content=b"fabricjs.js not found")
    return Response(
        content=js_path.read_bytes(),
        media_type="application/javascript; charset=utf-8",
    )


@app.post("/api/export/dxf")
async def api_export_dxf(request: Request):
    """
    Reçoit { "polylines": [[[x,y], ...], ...] } et renvoie le fichier DXF.
    """
    data = await request.json()
    polylines = data.get("polylines", [])
    content = export_dxf_from_polylines(polylines)
    return Response(
        content=content,
        media_type="application/dxf",
        headers={"Content-Disposition": "attachment; filename=dessin.dxf"},
    )


# Fichiers statiques (fabricjs.js, etc.) : montage après les routes
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")


def _fallback_html() -> str:
    """HTML minimal intégré si le fichier index.html est absent."""
    return """<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Dessin vectoriel</title>
  <style>
    body { font-family: sans-serif; margin: 16px; }
    .canvas-wrap { position: relative; display: inline-block; }
    #canvas { border: 1px solid #333; cursor: crosshair; display: block; }
    .toolbar { margin-bottom: 8px; }
    .toolbar button { margin-right: 8px; padding: 6px 12px; }
    #textZoneOverlay {
      position: absolute; display: none; border: 2px solid #06c;
      background: #fff; box-sizing: border-box; padding: 4px;
      z-index: 10; pointer-events: auto;
    }
    #textZoneOverlay textarea {
      width: 100%; height: 100%; border: none; resize: none;
      font-family: inherit; font-size: 14px; padding: 4px; box-sizing: border-box;
    }
  </style>
</head>
<body>
  <h1>Outil de dessin vectoriel</h1>
  <p>Dessin : clic gauche = point, clic droit = terminer la ligne. Zone de texte : « Ajouter zone de texte » puis tracer un rectangle (2 clics). Écriture : « Mode écriture » puis cliquer sur une zone pour y écrire.</p>
  <div class="toolbar">
    <button id="btnExportDxf">Exporter DXF</button>
    <button id="btnExportSvg">Exporter SVG</button>
    <button id="btnAddTextZone">Ajouter zone de texte</button>
    <button id="btnDrawMode">Mode dessin</button>
    <button id="btnWriteMode">Mode écriture</button>
  </div>
  <div class="canvas-wrap">
  <svg id="canvas" width="800" height="800" viewBox="0 0 1000 1000"></svg>
  <div id="textZoneOverlay"><textarea id="textZoneInput"></textarea></div>
  </div>
  <script>
    const SVG_NS = "http://www.w3.org/2000/svg";
    const W = 1000, H = 1000;
    const state = {
      polylines: [], current: [],
      textZones: [],
      mode: "draw",
      pendingZone: null,
      editingZoneIndex: -1
    };

    const svg = document.getElementById("canvas");
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("transform", "scale(1,-1) translate(0,-1000)");
    svg.appendChild(g);

    function addGrid() {
      for (let i = 0; i <= W; i += 100) {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", i); l.setAttribute("y1", 0); l.setAttribute("x2", i); l.setAttribute("y2", H);
        l.setAttribute("stroke", "#ddd"); l.setAttribute("stroke-width", "0.5");
        g.appendChild(l);
      }
      for (let j = 0; j <= H; j += 100) {
        const l = document.createElementNS(SVG_NS, "line");
        l.setAttribute("x1", 0); l.setAttribute("y1", j); l.setAttribute("x2", W); l.setAttribute("y2", j);
        l.setAttribute("stroke", "#ddd"); l.setAttribute("stroke-width", "0.5");
        g.appendChild(l);
      }
    }
    addGrid();

    const drawn = document.createElementNS(SVG_NS, "g");
    g.appendChild(drawn);
    const textZonesGroup = document.createElementNS(SVG_NS, "g");
    g.appendChild(textZonesGroup);

    function svgCoords(evt) {
      const rect = svg.getBoundingClientRect();
      const vx = ((evt.clientX - rect.left) / rect.width) * W;
      const vy = ((evt.clientY - rect.top) / rect.height) * W;
      const dataX = Math.max(0, Math.min(W, vx));
      const dataY = Math.max(0, Math.min(H, H - vy));
      return [dataX, dataY];
    }

    function hitTestZone(px, py) {
      for (let i = state.textZones.length - 1; i >= 0; i--) {
        const z = state.textZones[i];
        if (px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return i;
      }
      return -1;
    }

    function redrawTextZones() {
      textZonesGroup.innerHTML = "";
      state.textZones.forEach((z, i) => {
        const gZone = document.createElementNS(SVG_NS, "g");
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", z.x);
        rect.setAttribute("y", 1000 - z.y - z.h);
        rect.setAttribute("width", z.w);
        rect.setAttribute("height", z.h);
        rect.setAttribute("fill", "#fff");
        rect.setAttribute("stroke", "#333");
        rect.setAttribute("stroke-width", "1");
        gZone.appendChild(rect);
        const textG = document.createElementNS(SVG_NS, "g");
        textG.setAttribute("transform", "translate(" + z.x + ", " + (1000 - z.y - z.h) + ") scale(1,-1) translate(0,0)");
        const text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("font-size", "12");
        text.setAttribute("fill", "#000");
        const lines = (z.text || "").split(/\\n/);
        lines.forEach((line, i) => {
          const tspan = document.createElementNS(SVG_NS, "tspan");
          tspan.setAttribute("x", 6);
          tspan.setAttribute("y", 14 + i * 14);
          tspan.textContent = line;
          text.appendChild(tspan);
        });
        if (lines.length === 0) {
          const tspan = document.createElementNS(SVG_NS, "tspan");
          tspan.setAttribute("x", 6);
          tspan.setAttribute("y", 14);
          tspan.textContent = "";
          text.appendChild(tspan);
        }
        textG.appendChild(text);
        gZone.appendChild(textG);
        textZonesGroup.appendChild(gZone);
      });
      if (state.pendingZone && state.pendingZone.x1 != null && state.pendingZone.x2 == null) {
        const p = state.pendingZone;
        const dot = document.createElementNS(SVG_NS, "circle");
        dot.setAttribute("cx", p.x1);
        dot.setAttribute("cy", 1000 - p.y1);
        dot.setAttribute("r", "4");
        dot.setAttribute("fill", "none");
        dot.setAttribute("stroke", "#06c");
        dot.setAttribute("stroke-width", "2");
        textZonesGroup.appendChild(dot);
      }
    }

    function redraw() {
      drawn.innerHTML = "";
      state.polylines.forEach(pts => {
        if (pts.length < 2) return;
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", "M " + pts.map(p => p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" L "));
        path.setAttribute("fill", "none"); path.setAttribute("stroke", "blue"); path.setAttribute("stroke-width", "2");
        drawn.appendChild(path);
      });
      if (state.current.length >= 2) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", "M " + state.current.map(p => p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" L "));
        path.setAttribute("fill", "none"); path.setAttribute("stroke", "blue"); path.setAttribute("stroke-width", "2"); path.setAttribute("stroke-dasharray", "5,5");
        drawn.appendChild(path);
      } else if (state.current.length === 1) {
        const c = state.current[0];
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("cx", c[0]); circle.setAttribute("cy", c[1]); circle.setAttribute("r", "3"); circle.setAttribute("fill", "blue");
        drawn.appendChild(circle);
      }
      redrawTextZones();
    }

    const overlay = document.getElementById("textZoneOverlay");
    const textZoneInput = document.getElementById("textZoneInput");

    function zoneToScreen(z) {
      const rect = svg.getBoundingClientRect();
      const wrap = svg.parentElement.getBoundingClientRect();
      const scaleX = rect.width / W;
      const scaleY = rect.height / H;
      const left = (rect.left - wrap.left) + z.x * scaleX;
      const top = (rect.top - wrap.top) + (H - z.y - z.h) * scaleY;
      const width = z.w * scaleX;
      const height = z.h * scaleY;
      return {
        left: left,
        top: top,
        width: Math.max(40, width),
        height: Math.max(24, height)
      };
    }

    function openZoneEditor(index) {
      closeZoneEditor();
      state.editingZoneIndex = index;
      const z = state.textZones[index];
      const sc = zoneToScreen(z);
      overlay.style.left = sc.left + "px";
      overlay.style.top = sc.top + "px";
      overlay.style.width = sc.width + "px";
      overlay.style.height = sc.height + "px";
      overlay.style.display = "block";
      textZoneInput.value = z.text || "";
      textZoneInput.style.minHeight = "20px";
      requestAnimationFrame(function() { textZoneInput.focus(); });
    }

    function closeZoneEditor() {
      if (state.editingZoneIndex >= 0) {
        const z = state.textZones[state.editingZoneIndex];
        z.text = textZoneInput.value;
        const lineCount = Math.max(1, (z.text.match(/\\n/g) || []).length + 1);
        const minH = lineCount * 14 + 20;
        if (minH > z.h) z.h = minH;
        state.editingZoneIndex = -1;
        redrawTextZones();
      }
      overlay.style.display = "none";
    }

    function resizeOverlayTextarea() {
      textZoneInput.style.height = "auto";
      textZoneInput.style.height = Math.max(24, textZoneInput.scrollHeight) + "px";
    }
    textZoneInput.addEventListener("input", resizeOverlayTextarea);
    textZoneInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeZoneEditor(); e.preventDefault(); }
    });
    textZoneInput.addEventListener("blur", closeZoneEditor);

    svg.addEventListener("contextmenu", e => e.preventDefault());
    svg.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        if (state.mode === "draw" && state.current.length > 0) {
          state.polylines.push(state.current.slice());
          state.current = [];
          redraw();
        }
        return;
      }
      if (e.button !== 0) return;
      const [x, y] = svgCoords(e);
      if (state.mode === "write") {
        const hit = hitTestZone(x, y);
        if (hit >= 0) openZoneEditor(hit);
        return;
      }
      if (state.mode === "textZone") {
        if (state.pendingZone && state.pendingZone.x1 != null) {
          state.pendingZone.x2 = x;
          state.pendingZone.y2 = y;
          const p = state.pendingZone;
          const x1 = Math.min(p.x1, p.x2), x2 = Math.max(p.x1, p.x2);
          const y1 = Math.min(p.y1, p.y2), y2 = Math.max(p.y1, p.y2);
          if (x2 - x1 >= 10 && y2 - y1 >= 10) {
            state.textZones.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1, text: "" });
            openZoneEditor(state.textZones.length - 1);
          }
          state.pendingZone = null;
        } else {
          state.pendingZone = { x1: x, y1: y };
        }
        redrawTextZones();
        return;
      }
      state.current.push([x, y]);
      redraw();
    });

    document.getElementById("btnAddTextZone").onclick = () => {
      state.mode = "textZone";
      state.pendingZone = null;
      svg.style.cursor = "crosshair";
    };
    document.getElementById("btnDrawMode").onclick = () => {
      state.mode = "draw";
      state.pendingZone = null;
      svg.style.cursor = "crosshair";
    };
    document.getElementById("btnWriteMode").onclick = () => {
      state.mode = "write";
      state.pendingZone = null;
      svg.style.cursor = "text";
    };

    function downloadBlob(blob, name) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    document.getElementById("btnExportDxf").onclick = () => {
      const all = state.polylines.concat(state.current.length >= 2 ? [state.current] : []);
      fetch("/api/export/dxf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ polylines: all }) })
        .then(r => r.blob()).then(blob => downloadBlob(blob, "dessin.dxf"));
    };

    document.getElementById("btnExportSvg").onclick = () => {
      const all = state.polylines.concat(state.current.length >= 2 ? [state.current] : []);
      const paths = all.filter(pts => pts.length >= 2).map(pts =>
        "  <path d=\\"M " + pts.map(p => p[0].toFixed(2) + " " + p[1].toFixed(2)).join(" L ") + "\\" fill=\\"none\\" stroke=\\"black\\" stroke-width=\\"2\\"/>"
      );
      const svgContent = '<?xml version="1.0" encoding="UTF-8"?>\\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">\\n' + paths.join("\\n") + "\\n</svg>";
      downloadBlob(new Blob([svgContent], { type: "image/svg+xml" }), "dessin.svg");
    };
  </script>
</body>
</html>"""


if __name__ == "__main__":
    port = 8000
    try:
        _, _, ip_list = socket.gethostbyname_ex(socket.gethostname())
        local_ips = [ip for ip in ip_list if not ip.startswith("127.")]
    except Exception:
        local_ips = []
    if local_ips:
        print("Accès depuis la tablette : " + ", ".join("http://%s:%d" % (ip, port) for ip in local_ips) + " (PC et tablette sur le même réseau)")
    else:
        print("Accès depuis la tablette : http://<IP_CE_PC>:%d (PC et tablette sur le même réseau)" % port)
    print("")
    print("Si la tablette ne peut pas se connecter :")
    print("  1. Réexécuter ouvrir_parefeu_port_8000.bat en tant qu'administrateur (règle profils Privé + Public).")
    print("  2. Windows : Paramètres > Réseau > Propriétés de votre connexion > passer en 'Réseau privé'.")
    print("  3. Depuis la tablette, tester : ping <IP_du_PC> pour vérifier que les appareils se voient.")
    print("")
    uvicorn.run(app, host=local_ips[0], port=port)
