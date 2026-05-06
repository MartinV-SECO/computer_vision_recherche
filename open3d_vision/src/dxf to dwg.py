"""
Conversion DWG → DXF via LibreDWG (dwg2dxf), sans ODA.

Prérequis : télécharger les binaires Windows LibreDWG, les extraire,
puis soit ajouter le dossier au PATH, soit définir LIBREDWG_DIR.
Téléchargement : https://github.com/LibreDWG/libredwg/releases
(asset : libredwg-<version>-win64.zip)
"""
import logging
import os
import shutil
import subprocess
from pathlib import Path

# Dossier LibreDWG (ex. après extraction du zip).
LIBREDWG_DIR = os.environ.get("LIBREDWG_DIR", r"C:\Users\mvm\libredwg")

# Configuration du logging (progression et erreurs).
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

# Timeout par fichier (secondes) ; augmenter pour très gros DWG.
CONVERT_TIMEOUT = 120


def _find_dwg2dxf() -> str | None:
    """
    Cherche l'exécutable dwg2dxf (PATH ou LIBREDWG_DIR).
    Returns:
        Chemin vers dwg2dxf.exe ou None si introuvable.
    """
    exe = "dwg2dxf.exe" if os.name == "nt" else "dwg2dxf"
    path = shutil.which(exe)
    if path:
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
    """
    Convertit un fichier DWG en DXF avec LibreDWG (dwg2dxf).

    Args:
        dwg_path: Chemin du fichier DWG source.
        dxf_path: Chemin du fichier DXF de sortie.
        dwg2dxf_path: Chemin explicite vers dwg2dxf.exe (optionnel).
        overwrite: Si True, écrase le fichier DXF existant.
        timeout: Timeout en secondes pour la conversion.
    """
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

    cmd = [exe, "-o", str(dest), str(src)]
    if overwrite:
        cmd.insert(1, "-y")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"Conversion annulée : timeout ({timeout}s) dépassé pour {src.name}")
    except OSError as e:
        raise RuntimeError(f"Impossible d'exécuter dwg2dxf : {e}") from e

    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"dwg2dxf a échoué (code {result.returncode}) : {err or 'aucune sortie'}")

    if not dest.is_file() or dest.stat().st_size == 0:
        raise RuntimeError(f"Fichier DXF non créé ou vide : {dest}")


def convert_all_dwg_in_folder(
    source_dir: str,
    dest_dir: str,
    *,
    dwg2dxf_path: str | None = None,
    overwrite: bool = True,
    timeout: int = CONVERT_TIMEOUT,
    continue_on_error: bool = True,
) -> tuple[int, int, list[str]]:
    """
    Convertit tous les fichiers .dwg du dossier source vers le dossier destination.

    Chaque fichier toto.dwg devient dest_dir/toto.dxf.

    Args:
        source_dir: Dossier contenant les fichiers DWG.
        dest_dir: Dossier de sortie pour les DXF (créé si besoin).
        dwg2dxf_path: Chemin vers dwg2dxf.exe (optionnel).
        overwrite: Si True, écrase les DXF existants.
        timeout: Timeout en secondes par fichier.
        continue_on_error: Si True, en cas d'échec on passe au fichier suivant.

    Returns:
        (nombre_réussis, nombre_échoués, liste des noms en échec).
    """
    src = Path(source_dir).resolve()
    dest = Path(dest_dir).resolve()

    if not src.is_dir():
        raise FileNotFoundError(f"Dossier source introuvable : {source_dir}")

    dest.mkdir(parents=True, exist_ok=True)
    dwg_files = sorted(src.glob("*.dwg"))

    if not dwg_files:
        logger.warning("Aucun fichier .dwg trouvé dans %s", source_dir)
        return 0, 0, []

    total = len(dwg_files)
    logger.info("Début de la conversion : %d fichier(s) DWG → %s", total, dest)

    ok, failed = 0, 0
    failed_names: list[str] = []

    for i, dwg in enumerate(dwg_files, start=1):
        dxf_path = dest / dwg.with_suffix(".dxf").name
        logger.info("[%d/%d] %s", i, total, dwg.name)

        try:
            convert_dwg_to_dxf(
                str(dwg),
                str(dxf_path),
                dwg2dxf_path=dwg2dxf_path,
                overwrite=overwrite,
                timeout=timeout,
            )
            ok += 1
            logger.info("  → OK : %s", dxf_path.name)
        except Exception as e:
            failed += 1
            failed_names.append(dwg.name)
            logger.error("  → Échec : %s", e)
            if not continue_on_error:
                raise

    logger.info(
        "Conversion terminée : %d réussi(s), %d échec(s)%s",
        ok,
        failed,
        f" ({', '.join(failed_names)})" if failed_names else "",
    )
    return ok, failed, failed_names


if __name__ == "__main__":
    SOURCE_DIR = r"C:\Users\mvm\Geolux_CV_Clone"
    DEST_DIR = r"C:\Users\mvm\Geolux_CV_Clone\dxf_test"
    convert_all_dwg_in_folder(SOURCE_DIR, DEST_DIR, overwrite=True)
