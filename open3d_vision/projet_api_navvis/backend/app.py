from __future__ import annotations

from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

try:
    from .annotations_store import AnnotationStore
    from .pano_loader import load_panos
except ImportError:
    from annotations_store import AnnotationStore
    from pano_loader import load_panos


PROJECT_DIR = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PASTILLES_JSON = PROJECT_DIR / "pastilles.json"
DEFAULT_DATA_DIR = WORKSPACE_ROOT / "data" / "ETL project data" / "Photos panos"
CSV_FILE = "pano-poses-registered.csv"


def create_app() -> Flask:
    app = Flask(
        __name__,
        static_folder=str(PROJECT_DIR / "frontend"),
        static_url_path="",
    )

    data_dir = Path(app.config.get("DATA_DIR", DEFAULT_DATA_DIR))
    csv_path = data_dir / CSV_FILE
    pastilles_path = Path(app.config.get("PASTILLES_JSON", PASTILLES_JSON))
    annotations_store = AnnotationStore(pastilles_path)

    def serialize_panos() -> list[dict[str, Any]]:
        panos = load_panos(csv_path=csv_path, images_dir=data_dir)
        return [item.to_dict(image_url=f"/images/{item.image_relpath}") for item in panos]

    def validate_annotation_payload(payload: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(payload, dict):
            raise ValueError("Le payload doit etre un objet JSON.")

        required = ["panoId", "label", "xyz", "yawPitch"]
        missing = [key for key in required if key not in payload]
        if missing:
            raise ValueError(f"Champs manquants: {', '.join(missing)}")

        label = str(payload["label"]).strip()
        if not label:
            raise ValueError("Le champ label est obligatoire.")

        try:
            pano_id = int(payload["panoId"])
        except (TypeError, ValueError) as exc:
            raise ValueError("panoId doit etre un entier.") from exc

        xyz = payload["xyz"]
        yaw_pitch = payload["yawPitch"]
        if not isinstance(xyz, dict) or not isinstance(yaw_pitch, dict):
            raise ValueError("xyz et yawPitch doivent etre des objets.")

        try:
            xyz_data = {
                "x": float(xyz["x"]),
                "y": float(xyz["y"]),
                "z": float(xyz["z"]),
            }
            yaw_pitch_data = {
                "yaw": float(yaw_pitch["yaw"]),
                "pitch": float(yaw_pitch["pitch"]),
            }
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("xyz/yawPitch contiennent des valeurs invalides.") from exc

        result: dict[str, Any] = {
            "panoId": pano_id,
            "label": label,
            "xyz": xyz_data,
            "yawPitch": yaw_pitch_data,
        }
        if "identifier" in payload:
            raw_id = payload["identifier"]
            result["identifier"] = str(raw_id).strip() if raw_id is not None else ""
        if "description" in payload:
            raw_desc = payload["description"]
            result["description"] = str(raw_desc).strip() if raw_desc is not None else ""
        return result

    @app.get("/api/health")
    def health() -> Any:
        return jsonify(
            {
                "status": "ok",
                "projectDir": str(PROJECT_DIR),
                "dataDir": str(data_dir),
                "csvPath": str(csv_path),
                "pastillesJson": str(pastilles_path),
            }
        )

    @app.get("/api/panos")
    def list_panos() -> Any:
        try:
            return jsonify(serialize_panos())
        except (FileNotFoundError, ValueError) as exc:
            return jsonify({"error": str(exc)}), 400

    @app.get("/api/annotations")
    def list_annotations() -> Any:
        pano_id_param = request.args.get("panoId")
        pano_id = None
        if pano_id_param is not None:
            try:
                pano_id = int(pano_id_param)
            except ValueError:
                return jsonify({"error": "Le parametre panoId doit etre un entier."}), 400
        return jsonify(annotations_store.list_annotations(pano_id=pano_id))

    @app.post("/api/annotations")
    def create_annotation() -> Any:
        try:
            payload = validate_annotation_payload(request.get_json(force=True))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        created = annotations_store.create_annotation(payload)
        return jsonify(created), 201

    @app.put("/api/annotations/<annotation_id>")
    def update_annotation(annotation_id: str) -> Any:
        try:
            payload = validate_annotation_payload(request.get_json(force=True))
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        updated = annotations_store.update_annotation(annotation_id, payload)
        if not updated:
            return jsonify({"error": "Annotation introuvable."}), 404
        return jsonify(updated)

    @app.delete("/api/annotations/<annotation_id>")
    def delete_annotation(annotation_id: str) -> Any:
        deleted = annotations_store.delete_annotation(annotation_id)
        if not deleted:
            return jsonify({"error": "Annotation introuvable."}), 404
        return "", 204

    @app.get("/images/<path:filename>")
    def serve_image(filename: str) -> Any:
        return send_from_directory(directory=str(data_dir), path=filename)

    @app.get("/")
    def root() -> Any:
        return app.send_static_file("index.html")

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="127.0.0.1", port=8000, debug=True)
