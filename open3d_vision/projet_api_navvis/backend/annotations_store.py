from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AnnotationStore:
    """Persistance des annotations (pastilles) dans un fichier JSON (liste d'objets)."""

    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path.resolve()
        self._legacy_path = self.storage_path.parent / "annotations.json"
        self._lock = threading.Lock()
        self._ensure_file()

    def _ensure_file(self) -> None:
        if self.storage_path.exists():
            return
        if self._legacy_path.exists():
            try:
                legacy = self._legacy_path.read_text(encoding="utf-8")
                if not legacy.strip():
                    self.storage_path.write_text("[]\n", encoding="utf-8")
                else:
                    data = json.loads(legacy)
                    if isinstance(data, list):
                        self.storage_path.write_text(
                            json.dumps(data, indent=2, ensure_ascii=False) + "\n",
                            encoding="utf-8",
                        )
                    else:
                        self.storage_path.write_text("[]\n", encoding="utf-8")
            except (OSError, json.JSONDecodeError, TypeError):
                self.storage_path.write_text("[]\n", encoding="utf-8")
            return
        self.storage_path.write_text("[]\n", encoding="utf-8")

    def _read_all(self) -> list[dict[str, Any]]:
        raw = self.storage_path.read_text(encoding="utf-8").strip()
        if not raw:
            return []
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("Le fichier d'annotations doit contenir une liste JSON.")
        return data

    def _write_all(self, annotations: list[dict[str, Any]]) -> None:
        temp_path = self.storage_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(annotations, indent=2), encoding="utf-8")
        temp_path.replace(self.storage_path)

    def list_annotations(self, pano_id: int | None = None) -> list[dict[str, Any]]:
        with self._lock:
            annotations = self._read_all()
            if pano_id is None:
                return annotations
            return [item for item in annotations if item.get("panoId") == pano_id]

    def create_annotation(self, payload: dict[str, Any]) -> dict[str, Any]:
        now = _utc_now()
        annotation = {
            "id": str(uuid4()),
            "panoId": payload["panoId"],
            "label": payload["label"],
            "xyz": payload["xyz"],
            "yawPitch": payload["yawPitch"],
            "createdAt": now,
            "updatedAt": now,
        }
        identifier = payload.get("identifier")
        if isinstance(identifier, str) and identifier.strip():
            annotation["identifier"] = identifier.strip()
        description = payload.get("description")
        if isinstance(description, str) and description.strip():
            annotation["description"] = description.strip()
        with self._lock:
            annotations = self._read_all()
            annotations.append(annotation)
            self._write_all(annotations)
        return annotation

    def update_annotation(self, annotation_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            annotations = self._read_all()
            for idx, item in enumerate(annotations):
                if item.get("id") != annotation_id:
                    continue
                updated = {
                    **item,
                    "label": payload["label"],
                    "xyz": payload["xyz"],
                    "yawPitch": payload["yawPitch"],
                    "updatedAt": _utc_now(),
                }
                ident = payload.get("identifier")
                if isinstance(ident, str):
                    if ident.strip():
                        updated["identifier"] = ident.strip()
                    else:
                        updated.pop("identifier", None)
                desc = payload.get("description")
                if isinstance(desc, str):
                    if desc.strip():
                        updated["description"] = desc.strip()
                    else:
                        updated.pop("description", None)
                annotations[idx] = updated
                self._write_all(annotations)
                return updated
        return None

    def delete_annotation(self, annotation_id: str) -> bool:
        with self._lock:
            annotations = self._read_all()
            kept = [item for item in annotations if item.get("id") != annotation_id]
            if len(kept) == len(annotations):
                return False
            self._write_all(kept)
        return True
