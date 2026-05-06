#!/usr/bin/env python3
"""
Pretraite un fichier E57 pour le viewer 360.

Le script lit le nuage via Python, applique un sous-echantillonnage adapte au
rendu navigateur, puis exporte des triplets float32 little-endian (X,Y,Z monde).

Si les points semblent decales ou avec axes permutes par rapport au CSV pano /
au E57 d origine (lecteur Python vs autre outil), utilisez --chunk-axes-order
et eventuellement --chunk-translate. Pour un ZIP deja genere sans re-exporter
les .bin, vous pouvez ajouter dans manifest.json les champs chunkAxesOrder et
chunkTranslation : le viewer web les applique au chargement.

Sorties :
- un manifest JSON
- plusieurs chunks binaires `.bin` contenant des triplets XYZ en Float32
- un ZIP autonome directement lisible par le viewer navigateur

Les sorties sont directement lisibles par le viewer
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import numpy as np


IO_BUFFER_SIZE = 8 * 1024 * 1024  # 8 MiB
AUTO_TARGET_MIN_POINTS = 150_000
AUTO_TARGET_MAX_POINTS = 600_000
AUTO_TARGET_SOURCE_DIVISOR = 250
VOXEL_ESTIMATION_SAMPLE_POINTS = 300_000
VOXEL_SEARCH_ITERATIONS = 14


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("doit etre un entier") from exc
    if parsed <= 0:
        raise argparse.ArgumentTypeError("doit etre > 0")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Pretraite un fichier E57 en chunks binaires de points pour le viewer 360."
    )
    parser.add_argument(
        "input_file",
        type=Path,
        nargs="?",
        help="Chemin du fichier .e57 source (optionnel si mode dossier in/out)",
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=Path("in"),
        help="Dossier d'entree batch contenant les .e57 (defaut: ./in)",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=Path("out"),
        help="Dossier racine de sortie batch (defaut: ./out)",
    )
    parser.add_argument(
        "--chunks",
        type=_positive_int,
        default=None,
        help="Nombre de chunks a produire (prioritaire sur --max-points-per-chunk)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Dossier de sortie (defaut: <fichier>_chunks a cote du source)",
    )
    parser.add_argument(
        "--prefix",
        type=str,
        default=None,
        help="Prefixe des chunks (defaut: nom du fichier sans extension)",
    )
    parser.add_argument(
        "--max-output-points",
        type=_positive_int,
        default=None,
        help="Plafond explicite de points exportes pour le viewer",
    )
    parser.add_argument(
        "--max-points-per-chunk",
        type=_positive_int,
        default=30_000,
        help="Nombre maximal de points par chunk si --chunks n'est pas fourni",
    )
    parser.add_argument(
        "--zip-output",
        type=Path,
        default=None,
        help="Chemin du ZIP viewer genere (defaut: <output-dir>.zip)",
    )
    parser.add_argument(
        "--spatial-reference",
        type=str,
        default=None,
        help=(
            "SCR des coordonnees XYZ dans le manifeste (ex. EPSG:2169), affiche dans le viewer web. "
            "Si omis, le script tente de le deduire du XML embarque dans le fichier E57 (heuristique EPSG)."
        ),
    )
    parser.add_argument(
        "--chunk-axes-order",
        type=str,
        choices=["xyz", "yxz", "xzy", "zyx", "zxy", "yzx"],
        default="xyz",
        help=(
            "Permutation des 3 colonnes lues depuis le lecteur E57 avant voxelisation et ecriture des .bin "
            "(monde X,Y,Z attendu par le viewer : aligner avec vos poses pano / Est-Nord-Haut)."
        ),
    )
    parser.add_argument(
        "--chunk-translate",
        type=str,
        default=None,
        help="Translation dx,dy,dz ajoutee apres permutation (virgules, ex. 0,0,0). Meme unite que les points.",
    )
    return parser


def compute_target_display_point_count(source_point_count: int) -> int:
    n = max(0, int(source_point_count))
    if n == 0:
        return 0
    if n <= 200_000:
        return n

    # Ancienne heuristique: les tres gros nuages pouvaient tomber a 8k points,
    # ce qui donnait parfois un seul chunk et une perte visuelle trop importante.
    # On garde maintenant un plancher eleve, puis on augmente progressivement
    # le budget d'affichage avec la taille source, tout en bornant le total pour
    # rester lisible dans le viewer navigateur.
    proportional_target = math.ceil(n / AUTO_TARGET_SOURCE_DIVISOR)
    return min(
        n,
        max(AUTO_TARGET_MIN_POINTS, proportional_target),
        AUTO_TARGET_MAX_POINTS,
    )


def _collect_epsg_codes_from_text(text: str) -> List[int]:
    """Meme heuristique que src/lib/e57SpatialRef.ts (URN OGC, EPSG:, etc.)."""
    patterns = [
        r"urn:ogc:def:crs:EPSG::(\d{4,5})\b",
        r"urn:ogc:def:crs:EPSG::(\d{3,5})\b",
        r"EPSG[:\/_-]+(\d{4,5})\b",
        r"epsg\.org/def/crs/EPSG/\d+/(\d{4,5})\b",
        r"\bcode\s*=\s*[\"']?(\d{4,5})[\"']?",
    ]
    found: set[int] = set()
    for pat in patterns:
        for m in re.finditer(pat, text, flags=re.IGNORECASE):
            v = int(m.group(1))
            if 1024 <= v <= 99999:
                found.add(v)
    return sorted(found)


def spatial_reference_from_e57_file(input_file: Path) -> str | None:
    """Extrait un libelle SCR depuis le XML brut du E57 (prioritaire: plusieurs codes joints par ' · ')."""
    import e57

    try:
        xml_text = e57.raw_xml(str(input_file))
    except Exception:
        return None
    if not xml_text or not isinstance(xml_text, str):
        return None
    codes = _collect_epsg_codes_from_text(xml_text)
    if not codes:
        return None
    return " · ".join(f"EPSG:{c}" for c in codes)


def load_e57_points(input_file: Path) -> np.ndarray:
    import e57

    pc = e57.read_points(str(input_file))
    points = np.asarray(pc.points, dtype=np.float32)
    if points.ndim != 2 or points.shape[1] < 3:
        raise ValueError("Le fichier E57 ne contient pas un nuage XYZ exploitable")
    points = points[:, :3]
    finite_mask = np.isfinite(points).all(axis=1)
    if not finite_mask.all():
        points = points[finite_mask]
    if len(points) == 0:
        raise ValueError("Aucun point XYZ exploitable dans le fichier E57")
    return points


_AXES_PERMUTE: Dict[str, tuple[int, int, int]] = {
    "xyz": (0, 1, 2),
    "yxz": (1, 0, 2),
    "xzy": (0, 2, 1),
    "zyx": (2, 1, 0),
    "zxy": (2, 0, 1),
    "yzx": (1, 2, 0),
}


def permute_xyz_columns(points: np.ndarray, order: str) -> np.ndarray:
    """Reordonne les colonnes (N,3) pour obtenir monde X,Y,Z dans col 0,1,2."""
    if order == "xyz":
        return points
    ix, iy, iz = _AXES_PERMUTE[order]
    return np.stack((points[:, ix], points[:, iy], points[:, iz]), axis=1).astype(np.float32, copy=False)


def parse_chunk_translate_arg(raw: str | None) -> np.ndarray | None:
    if raw is None or not str(raw).strip():
        return None
    parts = [p.strip() for p in str(raw).split(",")]
    if len(parts) != 3:
        raise ValueError("--chunk-translate attend trois nombres separes par des virgules (dx,dy,dz)")
    try:
        dx, dy, dz = (float(parts[0]), float(parts[1]), float(parts[2]))
    except ValueError as exc:
        raise ValueError("--chunk-translate : nombres invalides") from exc
    return np.array([dx, dy, dz], dtype=np.float32)


def pick_estimation_sample(points: np.ndarray, sample_size: int) -> np.ndarray:
    if len(points) <= sample_size:
        return points
    indices = np.linspace(0, len(points) - 1, num=sample_size, dtype=np.int64)
    return points[indices]


def count_unique_voxels(points: np.ndarray, voxel_size: float, origin: np.ndarray) -> int:
    voxel_indices = np.floor((points - origin) / voxel_size).astype(np.int32, copy=False)
    voxel_keys = np.ascontiguousarray(voxel_indices).view(
        np.dtype((np.void, voxel_indices.dtype.itemsize * voxel_indices.shape[1]))
    )
    return int(np.unique(voxel_keys).shape[0])


def voxel_downsample_first_point(
    points: np.ndarray, voxel_size: float, origin: np.ndarray
) -> np.ndarray:
    voxel_indices = np.floor((points - origin) / voxel_size).astype(np.int32, copy=False)
    voxel_keys = np.ascontiguousarray(voxel_indices).view(
        np.dtype((np.void, voxel_indices.dtype.itemsize * voxel_indices.shape[1]))
    )
    _, unique_indices = np.unique(voxel_keys, return_index=True)
    unique_indices.sort()
    return np.asarray(points[unique_indices], dtype=np.float32)


def estimate_voxel_size(
    points: np.ndarray,
    target_point_count: int,
    origin: np.ndarray,
    extents: np.ndarray,
) -> float:
    max_extent = float(np.max(extents))
    if max_extent <= 0:
        return 1.0

    sample = pick_estimation_sample(points, min(len(points), VOXEL_ESTIMATION_SAMPLE_POINTS))
    sample_target = max(1, min(len(sample), int(round(target_point_count * (len(sample) / len(points))))))

    low = max(max_extent / 1_000_000.0, 1e-6)
    high = max(max_extent, low * 2.0)
    best_size = high
    best_distance = float("inf")

    for _ in range(VOXEL_SEARCH_ITERATIONS):
        mid = math.sqrt(low * high)
        count = count_unique_voxels(sample, mid, origin)
        distance = abs(count - sample_target)
        if distance < best_distance:
            best_distance = distance
            best_size = mid
        if count > sample_target:
            low = mid
        else:
            high = mid

    return best_size


def sample_points(points: np.ndarray, max_output_points: int | None) -> tuple[np.ndarray, Dict[str, object]]:
    source_count = len(points)
    target = min(
        source_count,
        int(max_output_points) if max_output_points is not None else compute_target_display_point_count(source_count),
    )
    if target <= 0:
        raise ValueError("Sous-echantillonnage impossible: cible a 0 point")
    if target >= source_count:
        return np.asarray(points, dtype=np.float32), {
            "strategy": "identity",
            "targetPointCount": source_count,
            "actualPointCount": source_count,
            "voxelSize": 0.0,
        }

    origin = points.min(axis=0)
    extents = points.max(axis=0) - origin
    voxel_size = estimate_voxel_size(points, target, origin, extents)
    reduced = voxel_downsample_first_point(points, voxel_size, origin)

    attempts = 0
    while len(reduced) > target and attempts < 4:
        factor = max(1.05, (len(reduced) / target) ** (1.0 / 3.0))
        voxel_size *= factor
        reduced = voxel_downsample_first_point(points, voxel_size, origin)
        attempts += 1

    while len(reduced) < max(1, int(target * 0.55)) and attempts < 7:
        factor = max(1.05, (target / max(len(reduced), 1)) ** (1.0 / 3.0))
        voxel_size /= factor
        reduced = voxel_downsample_first_point(points, voxel_size, origin)
        attempts += 1

    if len(reduced) > target:
        reduced = reduced[:target]

    return np.asarray(reduced, dtype=np.float32), {
        "strategy": "voxel-grid-first-point",
        "targetPointCount": int(target),
        "actualPointCount": int(len(reduced)),
        "voxelSize": float(voxel_size),
    }


def chunk_count_for_points(
    displayed_points: int,
    requested_chunks: int | None,
    max_points_per_chunk: int,
) -> int:
    if displayed_points <= 0:
        return 1
    if requested_chunks is not None:
        return max(1, min(int(requested_chunks), displayed_points))
    return max(1, math.ceil(displayed_points / max(1, int(max_points_per_chunk))))


def split_file(
    input_file: Path,
    requested_chunks: int | None,
    output_dir: Path,
    prefix: str,
    max_output_points: int | None,
    max_points_per_chunk: int,
    spatial_reference: str | None = None,
    chunk_axes_order: str = "xyz",
    chunk_translate: np.ndarray | None = None,
) -> Dict[str, object]:
    if not input_file.exists():
        raise FileNotFoundError(f"Fichier introuvable: {input_file}")
    if not input_file.is_file():
        raise ValueError(f"Ce n'est pas un fichier: {input_file}")
    if input_file.suffix.lower() != ".e57":
        raise ValueError("Le fichier source doit avoir l'extension .e57")

    output_dir.mkdir(parents=True, exist_ok=True)

    print("Chargement du fichier E57...")
    all_points = load_e57_points(input_file)
    all_points = permute_xyz_columns(all_points, chunk_axes_order)
    if chunk_translate is not None:
        all_points = all_points + chunk_translate.astype(np.float32, copy=False)
    source_point_count = int(len(all_points))
    bounds = {
        "minX": float(all_points[:, 0].min()),
        "minY": float(all_points[:, 1].min()),
        "minZ": float(all_points[:, 2].min()),
        "maxX": float(all_points[:, 0].max()),
        "maxY": float(all_points[:, 1].max()),
        "maxZ": float(all_points[:, 2].max()),
    }

    print("Sous-echantillonnage pour le rendu navigateur...")
    sampled_points, downsample_meta = sample_points(all_points, max_output_points=max_output_points)
    displayed_point_count = int(len(sampled_points))
    chunks_count = chunk_count_for_points(
        displayed_points=displayed_point_count,
        requested_chunks=requested_chunks,
        max_points_per_chunk=max_points_per_chunk,
    )

    chunk_entries: List[Dict[str, object]] = []
    base_size, remainder = divmod(displayed_point_count, chunks_count)
    offset = 0
    for chunk_index in range(chunks_count):
        point_count = base_size + (1 if chunk_index < remainder else 0)
        if point_count <= 0:
            continue
        chunk_id = f"chunk-{chunk_index + 1:04d}"
        chunk_file = f"{chunk_id}.bin"
        chunk_path = output_dir / chunk_file
        chunk_points = np.ascontiguousarray(sampled_points[offset : offset + point_count], dtype=np.float32)
        with chunk_path.open("wb") as fh:
            remaining = memoryview(chunk_points).cast("B")
            cursor = 0
            while cursor < len(remaining):
                end = min(cursor + IO_BUFFER_SIZE, len(remaining))
                fh.write(remaining[cursor:end])
                cursor = end
        byte_length = point_count * 3 * 4
        chunk_entries.append(
            {
                "id": chunk_id,
                "file": chunk_file,
                "pointCount": point_count,
                "byteLength": byte_length,
            }
        )
        offset += point_count

    manifest = {
        "version": 2,
        "format": "point-chunks-v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "inputFile": str(input_file.resolve()),
        "inputSizeBytes": int(input_file.stat().st_size),
        "prefix": prefix,
        "sourcePointCount": source_point_count,
        "displayedPointCount": displayed_point_count,
        "bounds": bounds,
        "pointStrideFloats": 3,
        "componentType": "float32",
        "downsample": {
            "strategy": downsample_meta["strategy"],
            "targetPointCount": int(downsample_meta["targetPointCount"]),
            "actualPointCount": int(downsample_meta["actualPointCount"]),
            "voxelSize": float(downsample_meta["voxelSize"]),
            "requestedMaxOutputPoints": int(max_output_points) if max_output_points is not None else None,
        },
        "chunks": chunk_entries,
    }
    sr = (spatial_reference or "").strip()
    if not sr:
        sr = spatial_reference_from_e57_file(input_file) or ""
    if sr:
        manifest["spatialReference"] = sr
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return {"manifest_path": manifest_path, "manifest": manifest}


def build_viewer_zip_package(
    output_dir: Path,
    manifest: Dict[str, object],
    manifest_path: Path,
    zip_output: Path,
) -> Path:
    zip_output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_output, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        zf.write(manifest_path, arcname="manifest.json")
        for chunk in manifest.get("chunks", []):
            chunk_file = str(chunk.get("file", "")).strip()
            if not chunk_file:
                continue
            chunk_path = output_dir / chunk_file
            if not chunk_path.exists():
                raise FileNotFoundError(f"Chunk introuvable pour le ZIP: {chunk_path}")
            zf.write(chunk_path, arcname=chunk_file)
    return zip_output


def process_one_file(
    input_file: Path,
    args: argparse.Namespace,
    output_dir: Path,
    prefix: str,
    zip_output: Path,
) -> Dict[str, object]:
    result = split_file(
        input_file=input_file,
        requested_chunks=args.chunks,
        output_dir=output_dir,
        prefix=prefix,
        max_output_points=args.max_output_points,
        max_points_per_chunk=args.max_points_per_chunk,
        spatial_reference=args.spatial_reference,
        chunk_axes_order=args.chunk_axes_order,
        chunk_translate=parse_chunk_translate_arg(args.chunk_translate),
    )
    manifest_path = result["manifest_path"]
    manifest = result["manifest"]
    zip_path = build_viewer_zip_package(
        output_dir=output_dir,
        manifest=manifest,
        manifest_path=manifest_path,
        zip_output=zip_output,
    )
    return {
        "manifest": manifest,
        "manifest_path": manifest_path,
        "zip_path": zip_path,
        "output_dir": output_dir,
    }


def list_e57_files(input_dir: Path) -> List[Path]:
    return sorted(
        [p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() == ".e57"],
        key=lambda p: p.name.lower(),
    )


def _bundle_base_dir() -> Path:
    """Dossier contenant decoupe.exe (PyInstaller) ou le .py (developpement)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    _script_dir = _bundle_base_dir()

    if args.input_file is not None:
        input_file: Path = args.input_file
        output_dir: Path = args.output_dir or (input_file.parent / f"{input_file.stem}_chunks")
        prefix: str = args.prefix or input_file.stem
        zip_output: Path = args.zip_output or output_dir.with_suffix(".zip")

        one = process_one_file(
            input_file=input_file,
            args=args,
            output_dir=output_dir,
            prefix=prefix,
            zip_output=zip_output,
        )
        manifest = one["manifest"]
        print(f"Pretraitement termine: {len(manifest['chunks'])} chunks")
        print(
            f"Points viewer: {manifest['displayedPointCount']} / {manifest['sourcePointCount']}"
        )
        print(f"Dossier de sortie: {one['output_dir']}")
        print(f"Manifest: {one['manifest_path']}")
        print(f"ZIP viewer: {one['zip_path']}")
        return 0

    # Chemins relatifs (in/, out/) : ancrés sur le dossier du script pour permettre
    # double-clic / « Ouvrir avec Python » sans dépendre du répertoire courant.
    input_dir: Path = (
        args.input_dir if args.input_dir.is_absolute() else (_script_dir / args.input_dir).resolve()
    )
    output_root: Path = (
        args.output_root
        if args.output_root.is_absolute()
        else (_script_dir / args.output_root).resolve()
    )
    if not input_dir.exists():
        raise FileNotFoundError(f"Dossier d'entree introuvable: {input_dir}")
    if not input_dir.is_dir():
        raise ValueError(f"Le chemin d'entree n'est pas un dossier: {input_dir}")
    output_root.mkdir(parents=True, exist_ok=True)

    files = list_e57_files(input_dir)
    if not files:
        raise ValueError(f"Aucun fichier .e57 trouve dans le dossier: {input_dir}")

    successes: List[Dict[str, object]] = []
    failures: List[Dict[str, str]] = []

    print(f"Mode batch in/out: {len(files)} fichier(s) detecte(s) dans {input_dir}")
    for index, input_file in enumerate(files, start=1):
        print(f"\n[{index}/{len(files)}] Traitement: {input_file.name}")
        output_dir = output_root / f"{input_file.stem}_chunks"
        zip_output = output_dir.with_suffix(".zip")
        try:
            one = process_one_file(
                input_file=input_file,
                args=args,
                output_dir=output_dir,
                prefix=input_file.stem,
                zip_output=zip_output,
            )
            successes.append(
                {
                    "input_file": str(input_file),
                    "output_dir": str(one["output_dir"]),
                    "manifest_path": str(one["manifest_path"]),
                    "zip_path": str(one["zip_path"]),
                }
            )
            print(f"OK: {input_file.name} -> {output_dir}")
        except Exception as exc:
            failures.append({"input_file": str(input_file), "error": str(exc)})
            print(f"ERREUR: {input_file.name} -> {exc}")

    print("\n=== Resume batch ===")
    print(f"Succes: {len(successes)}")
    print(f"Echecs: {len(failures)}")
    for row in successes:
        print(f"- OK {Path(row['input_file']).name}: {row['output_dir']}")
    for row in failures:
        print(f"- KO {Path(row['input_file']).name}: {row['error']}")

    return 0 if not failures else 1


if __name__ == "__main__":
    exit_code = 0
    try:
        exit_code = int(main())
    except SystemExit as exc:
        code = exc.code
        if code is None:
            exit_code = 0
        elif isinstance(code, int):
            exit_code = code
        else:
            exit_code = 1
    except Exception:
        import traceback

        traceback.print_exc()
        exit_code = 1
    finally:
        # Double-clic sur decoupe.exe : garder la console ouverte pour lire messages / erreurs.
        if getattr(sys, "frozen", False) and sys.stdout and sys.stdout.isatty():
            try:
                input("\nAppuyez sur Entree pour fermer... ")
            except EOFError:
                pass
    raise SystemExit(exit_code)
