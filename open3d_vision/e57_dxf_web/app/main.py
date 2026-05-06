"""API FastAPI : analyse Z, conversion E57 → DXF, progression et prévisualisations."""

from __future__ import annotations

import base64
import hashlib
import os
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response

from e57_dxf_web.core.e57_io import load_e57_points, sample_points_for_z_range, z_bounds
from e57_dxf_web.core.params import ConvertParams
from e57_dxf_web.core.pipeline import (
    ConvertResult,
    PrecomputedGrid,
    load_and_prepare_grid,
    run_convert,
)

_STATIC = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="E57 → DXF")

JOBS_LOCK = threading.Lock()
JOBS: dict[str, dict] = {}

# Cache grille (même fichier + même plan Z/voxel) pour accélérer les générations suivantes.
GRID_CACHE_LOCK = threading.Lock()
GRID_CACHE: dict[str, PrecomputedGrid] = {}
GRID_CACHE_KEYS: list[str] = []
GRID_CACHE_MAX_ENTRIES = 5


def _grid_cache_key(file_hash_hex: str, z_min: float, z_max: float, voxel_size: float) -> str:
    """Clé de cache unique pour un plan (fichier + tranche Z + voxel)."""
    return f"{file_hash_hex}_{z_min:.6g}_{z_max:.6g}_{voxel_size:.6g}"


def _grid_cache_get(key: str) -> PrecomputedGrid | None:
    """Retourne la grille en cache si présente."""
    with GRID_CACHE_LOCK:
        return GRID_CACHE.get(key)


def _grid_cache_put(key: str, grid: PrecomputedGrid) -> None:
    """Enregistre la grille en cache ; éviction FIFO si trop d'entrées."""
    with GRID_CACHE_LOCK:
        if key in GRID_CACHE:
            return
        while len(GRID_CACHE) >= GRID_CACHE_MAX_ENTRIES and GRID_CACHE_KEYS:
            old = GRID_CACHE_KEYS.pop(0)
            GRID_CACHE.pop(old, None)
        GRID_CACHE[key] = grid
        GRID_CACHE_KEYS.append(key)


def _b64_png(data: bytes | None) -> str | None:
    """Encode des octets PNG en data-URL pour le navigateur."""
    if not data:
        return None
    return "data:image/png;base64," + base64.standard_b64encode(data).decode("ascii")


@app.get("/", response_class=HTMLResponse)
def index():
    """Sert la page d'accueil."""
    html_path = _STATIC / "index.html"
    if not html_path.is_file():
        return HTMLResponse("<p>Fichier static/index.html manquant.</p>", status_code=500)
    return HTMLResponse(html_path.read_text(encoding="utf-8"))


@app.post("/api/z-range")
async def api_z_range(file: UploadFile = File(...)):
    """
    Estime z_min / z_max à partir d'un échantillon du fichier E57 (max 50k points).
    """
    if not file.filename or not file.filename.lower().endswith(".e57"):
        raise HTTPException(400, "Fichier .e57 attendu.")
    suffix = Path(file.filename).suffix or ".e57"
    path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await file.read())
            path = tmp.name
        pts = load_e57_points(path)
        sample = sample_points_for_z_range(pts, max_points=50_000)
        z0, z1 = z_bounds(sample)
        return {"z_min": z0, "z_max": z1, "n_points_total": len(pts)}
    except Exception as e:
        raise HTTPException(400, f"Lecture E57 impossible : {e}") from e
    finally:
        if path and os.path.isfile(path):
            try:
                os.unlink(path)
            except OSError:
                pass


def _parse_params(
    z_min: float,
    z_max: float,
    voxel_size: float,
    alpha: float,
    alpha_min_edge_length: float,
    alpha_simplify_tolerance: float,
    max_ransac_lines: int,
    ransac_dist_thresh: float,
    ransac_n_draws: int,
    ransac_min_inliers: int,
    method: str,
    seed: int,
) -> ConvertParams:
    """Construit ConvertParams depuis le formulaire."""
    m = method.strip().lower()
    if m not in ("alphashape", "ransac", "both"):
        raise HTTPException(400, "method doit être alphashape, ransac ou both.")
    return ConvertParams(
        z_min=z_min,
        z_max=z_max,
        voxel_size=voxel_size,
        alpha=alpha,
        alpha_min_edge_length=max(0.0, float(alpha_min_edge_length)),
        alpha_simplify_tolerance=max(0.0, float(alpha_simplify_tolerance)),
        max_ransac_lines=max(1, min(max_ransac_lines, 50)),
        ransac_dist_thresh=ransac_dist_thresh,
        ransac_n_draws=max(10, min(ransac_n_draws, 50_000)),
        ransac_min_inliers=max(3, min(ransac_min_inliers, 10_000)),
        method=m,  # type: ignore[arg-type]
        seed=seed,
    )


@app.post("/api/convert")
async def api_convert(
    file: UploadFile = File(...),
    z_min: float = Form(...),
    z_max: float = Form(...),
    voxel_size: float = Form(0.05),
    alpha: float = Form(0.5),
    alpha_min_edge_length: float = Form(0.0),
    alpha_simplify_tolerance: float = Form(0.0),
    max_ransac_lines: int = Form(6),
    ransac_dist_thresh: float = Form(0.08),
    ransac_n_draws: int = Form(1000),
    ransac_min_inliers: int = Form(8),
    method: str = Form("alphashape"),
    seed: int = Form(42),
):
    """Génère un DXF (sans barre de progression — préférer /api/convert/start pour l'UI)."""
    if not file.filename or not file.filename.lower().endswith(".e57"):
        raise HTTPException(400, "Fichier .e57 attendu.")
    params = _parse_params(
        z_min,
        z_max,
        voxel_size,
        alpha,
        alpha_min_edge_length,
        alpha_simplify_tolerance,
        max_ransac_lines,
        ransac_dist_thresh,
        ransac_n_draws,
        ransac_min_inliers,
        method,
        seed,
    )
    stem = Path(file.filename).stem
    path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".e57") as tmp:
            tmp.write(await file.read())
            path = tmp.name
        result = run_convert(path, params, file_stem=stem)
        return Response(
            content=result.dxf_bytes,
            media_type="application/dxf",
            headers={
                "Content-Disposition": f'attachment; filename="{result.filename}"',
                "X-Points-Slice": str(result.n_points_slice),
                "X-Points-Downsampled": str(result.n_points_downsampled),
                "X-Alpha-Edges": str(result.n_alpha_edges),
                "X-Ransac-Lines": str(result.n_ransac_lines),
            },
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        raise HTTPException(500, f"Erreur conversion : {e}") from e
    finally:
        if path and os.path.isfile(path):
            try:
                os.unlink(path)
            except OSError:
                pass


@app.post("/api/convert/start")
async def api_convert_start(
    file: UploadFile = File(...),
    z_min: float = Form(...),
    z_max: float = Form(...),
    voxel_size: float = Form(0.05),
    alpha: float = Form(0.5),
    alpha_min_edge_length: float = Form(0.0),
    alpha_simplify_tolerance: float = Form(0.0),
    max_ransac_lines: int = Form(6),
    ransac_dist_thresh: float = Form(0.08),
    ransac_n_draws: int = Form(1000),
    ransac_min_inliers: int = Form(8),
    method: str = Form("alphashape"),
    seed: int = Form(42),
):
    """
    Lance la conversion en arrière-plan ; retourne un job_id pour /progress et /result.
    """
    if not file.filename or not file.filename.lower().endswith(".e57"):
        raise HTTPException(400, "Fichier .e57 attendu.")
    params = _parse_params(
        z_min,
        z_max,
        voxel_size,
        alpha,
        alpha_min_edge_length,
        alpha_simplify_tolerance,
        max_ransac_lines,
        ransac_dist_thresh,
        ransac_n_draws,
        ransac_min_inliers,
        method,
        seed,
    )
    stem = Path(file.filename).stem
    content = await file.read()
    with tempfile.NamedTemporaryFile(delete=False, suffix=".e57") as tmp:
        tmp.write(content)
        path = tmp.name

    job_id = str(uuid.uuid4())
    file_hash_hex = hashlib.sha256(content).hexdigest()
    cache_key = _grid_cache_key(
        file_hash_hex, params.z_min, params.z_max, params.voxel_size
    )

    with JOBS_LOCK:
        JOBS[job_id] = {
            "status": "running",
            "progress": 0,
            "message": "Démarrage…",
            "result": None,
            "error": None,
            "method": params.method,
        }

    def worker() -> None:
        def prog(pct: int, msg: str) -> None:
            with JOBS_LOCK:
                if job_id in JOBS:
                    JOBS[job_id]["progress"] = pct
                    JOBS[job_id]["message"] = msg

        try:
            precomputed = _grid_cache_get(cache_key)
            if precomputed is None:
                precomputed = load_and_prepare_grid(path, params, progress=prog)
                _grid_cache_put(cache_key, precomputed)
            res = run_convert(
                path, params, file_stem=stem, progress=prog, precomputed=precomputed
            )
            with JOBS_LOCK:
                if job_id in JOBS:
                    JOBS[job_id]["result"] = res
                    JOBS[job_id]["status"] = "done"
                    JOBS[job_id]["progress"] = 100
                    JOBS[job_id]["message"] = "Terminé."
        except Exception as e:
            with JOBS_LOCK:
                if job_id in JOBS:
                    JOBS[job_id]["status"] = "error"
                    JOBS[job_id]["error"] = str(e)
                    JOBS[job_id]["message"] = str(e)
        finally:
            if os.path.isfile(path):
                try:
                    os.unlink(path)
                except OSError:
                    pass

    threading.Thread(target=worker, daemon=True).start()
    return {"job_id": job_id}


@app.get("/api/convert/progress/{job_id}")
def api_convert_progress(job_id: str):
    """État d'avancement (0–100) et message pour la barre de progression."""
    with JOBS_LOCK:
        j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "Job inconnu.")
    return {
        "status": j["status"],
        "progress": j["progress"],
        "message": j["message"],
        "error": j.get("error"),
    }


@app.get("/api/convert/result/{job_id}")
def api_convert_result(job_id: str):
    """Téléchargement du DXF une fois le job terminé."""
    with JOBS_LOCK:
        j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "Job inconnu.")
    if j["status"] == "error":
        raise HTTPException(400, j.get("error", "Erreur"))
    if j["status"] != "done" or not j["result"]:
        raise HTTPException(409, "Conversion non terminée.")
    res: ConvertResult = j["result"]
    return Response(
        content=res.dxf_bytes,
        media_type="application/dxf",
        headers={
            "Content-Disposition": f'attachment; filename="{res.filename}"',
            "X-Points-Slice": str(res.n_points_slice),
            "X-Points-Downsampled": str(res.n_points_downsampled),
            "X-Alpha-Edges": str(res.n_alpha_edges),
            "X-Ransac-Lines": str(res.n_ransac_lines),
        },
    )


@app.get("/api/convert/previews/{job_id}")
def api_convert_previews(job_id: str):
    """Aperçus PNG (data URL base64) des méthodes utilisées."""
    with JOBS_LOCK:
        j = JOBS.get(job_id)
    if not j:
        raise HTTPException(404, "Job inconnu.")
    if j["status"] != "done" or not j["result"]:
        raise HTTPException(409, "Conversion non terminée.")
    res: ConvertResult = j["result"]
    return JSONResponse(
        {
            "tranche": _b64_png(res.preview_tranche_png),
            "downsampled": _b64_png(res.preview_downsampled_png),
            "alphashape": _b64_png(res.preview_alphashape_png),
            "ransac": _b64_png(res.preview_ransac_png),
            "combined": _b64_png(res.preview_combined_png),
            "method": j.get("method", ""),
        }
    )
