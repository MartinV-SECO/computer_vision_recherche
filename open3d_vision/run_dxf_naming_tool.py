"""
Lance l’outil web de renommage de layers DXF sur http://localhost:8000.

À exécuter depuis la racine du projet :
  python run_dxf_naming_tool.py

Cela charge le bon module (celui dans .venv/dxf_naming_tool/) pour éviter 404 sur /api/layers_raw.
"""
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
tool_dir = root / ".venv" / "dxf_naming_tool"
if not tool_dir.is_dir():
    print("Dossier introuvable:", tool_dir)
    sys.exit(1)
sys.path.insert(0, str(tool_dir))

import uvicorn
# Charger l'app depuis le module du dossier outil
from main import app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
