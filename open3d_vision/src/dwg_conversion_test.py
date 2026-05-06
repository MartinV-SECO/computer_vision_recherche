# --- Imports et configuration ---
import logging
import os
import shutil
import subprocess
from pathlib import Path

LIBREDWG_DIR = os.environ.get("LIBREDWG_DIR", r"C:\Users\mvm\libredwg")
CONVERT_TIMEOUT = 120  # secondes (augmenter pour très gros DWG)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# --- Fonctions ---

def _find_dwg2dxf() -> str | None:
    """Cherche dwg2dxf dans PATH ou LIBREDWG_DIR. Retourne le chemin ou None."""
    exe = "dwg2dxf.exe" if os.name == "nt" else "dwg2dxf"
    if path := shutil.which(exe):
        return path
    for sub in ("", "bin"):
        candidate = Path(LIBREDWG_DIR) / sub / exe
        if candidate.is_file():
            return str(candidate)
    return None


def convert_dwg_to_dxf(
    dwg_path: str,
    dxf_path: str,
    *,
    dwg2dxf_path: str | None = None,
    overwrite: bool = True,
    timeout: int = CONVERT_TIMEOUT,
) -> None:
    """Convertit un fichier DWG en DXF via LibreDWG (dwg2dxf)."""
    src = Path(dwg_path).resolve()
    dest = Path(dxf_path).resolve()

    if not src.is_file():
        raise FileNotFoundError(f"Fichier source introuvable : {src}")
    if src.stat().st_size == 0:
        raise ValueError(f"Fichier source vide : {src}")

    exe = dwg2dxf_path or _find_dwg2dxf()
    if not exe or not Path(exe).is_file():
        raise FileNotFoundError(
            "dwg2dxf introuvable. Installez LibreDWG : "
            "https://github.com/LibreDWG/libredwg/releases"
        )

    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [exe, "-y" if overwrite else None, "-o", str(dest), str(src)]
    cmd = [c for c in cmd if c is not None]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Timeout ({timeout}s) dépassé pour {src.name}")
    except OSError as e:
        raise RuntimeError(f"Impossible d'exécuter dwg2dxf : {e}") from e

    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"dwg2dxf a échoué (code {result.returncode}) : {err or 'aucune sortie'}")

    if not dest.is_file() or dest.stat().st_size == 0:
        raise RuntimeError(f"Fichier DXF non créé ou vide : {dest}")

if __name__ == "__main__":
    dwg_file = Path(r"C:\Users\mvm\Geolux_CV_Clone\01 Plans rez + sous-sol.dwg")
    dxf_file = Path(r"C:\Users\mvm\OneDrive - Group Seco\Desktop\01 Plans rez + sous-sol.dxf")
    convert_dwg_to_dxf(str(dwg_file), str(dxf_file), overwrite=True)
    logger.info("Conversion terminée : %s → %s", dwg_file.name, dxf_file.name)