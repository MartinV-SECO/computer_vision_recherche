from __future__ import annotations

import csv
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any


@dataclass
class PanoRecord:
    pano_id: int
    filename: str
    timestamp: float
    position: dict[str, float]
    orientation: dict[str, float]
    image_exists: bool
    """Chemin relatif au dossier donnees, pour /images/... (slashes POSIX)."""
    image_relpath: str

    def to_dict(self, image_url: str) -> dict[str, Any]:
        data = asdict(self)
        data["id"] = data.pop("pano_id")
        data["imageUrl"] = image_url
        del data["image_relpath"]
        return data


def _parse_float(value: str) -> float:
    return float(value.strip())


def _normalize_csv_filename(filename: str) -> str:
    return filename.strip().replace("\\", "/")


def _resolve_image_file(images_dir: Path, filename: str) -> tuple[bool, str]:
    """Retourne (fichier_present, chemin_relatif_pour_URL)."""
    norm = _normalize_csv_filename(filename)
    if not norm:
        return False, ""

    direct = images_dir / norm
    if direct.is_file():
        return True, norm

    base = Path(norm).name
    if base != norm:
        root_only = images_dir / base
        if root_only.is_file():
            return True, base

    root_file = images_dir / base
    if root_file.is_file():
        return True, base

    try:
        lower_to_name = {p.name.lower(): p.name for p in images_dir.iterdir() if p.is_file()}
    except OSError:
        lower_to_name = {}
    real_name = lower_to_name.get(base.lower())
    if real_name:
        return True, real_name

    try:
        for found in images_dir.rglob(base):
            if found.is_file():
                return True, found.relative_to(images_dir).as_posix()
    except OSError:
        pass

    return False, base if base else norm


def load_panos(csv_path: Path, images_dir: Path) -> list[PanoRecord]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV introuvable: {csv_path}")

    images_dir = images_dir.resolve()

    records: list[PanoRecord] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as csv_file:
        reader = csv.reader(csv_file, delimiter=";")
        for row in reader:
            if not row:
                continue
            first_cell = row[0].strip()
            if first_cell.startswith("#"):
                continue

            if len(row) < 10:
                raise ValueError(f"Ligne CSV invalide (10 colonnes attendues): {row}")

            pano_id = int(first_cell)
            filename = row[1].strip()
            timestamp = _parse_float(row[2])
            pos_x = _parse_float(row[3])
            pos_y = _parse_float(row[4])
            pos_z = _parse_float(row[5])
            ori_w = _parse_float(row[6])
            ori_x = _parse_float(row[7])
            ori_y = _parse_float(row[8])
            ori_z = _parse_float(row[9])

            image_exists, image_relpath = _resolve_image_file(images_dir, filename)
            records.append(
                PanoRecord(
                    pano_id=pano_id,
                    filename=filename,
                    timestamp=timestamp,
                    position={"x": pos_x, "y": pos_y, "z": pos_z},
                    orientation={"w": ori_w, "x": ori_x, "y": ori_y, "z": ori_z},
                    image_exists=image_exists,
                    image_relpath=image_relpath,
                )
            )

    records.sort(key=lambda item: item.pano_id)
    return records
