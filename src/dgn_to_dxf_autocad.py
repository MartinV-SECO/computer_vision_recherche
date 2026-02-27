# -*- coding: utf-8 -*-
"""
Automatise la conversion DGN -> DWG via AutoCAD en mode console (accoreconsole.exe).
Pour chaque fichier DGN, on génère un script .scr qui lance DGNIMPORT, SAVEAS, puis QUIT,
puis on exécute accoreconsole.exe avec ce script et un template .dwt.

Réglages Import DGN : unités Master, mapping Standard (réponses dans le .scr).

Usage:
  python dgn_to_dxf_autocad.py [dossier_dgn] [dossier_sortie]
  Par défaut: dossier Geolux interne, sortie dans sous-dossier dwg.

Prérequis: AutoCAD installé avec accoreconsole.exe (pas de pywin32).
"""

import os
import subprocess
import sys
import tempfile
from pathlib import Path


def get_desktop_path() -> Path:
    """Retourne le chemin du Bureau Windows (y compris OneDrive si redirigé)."""
    if os.name != "nt":
        return Path.home() / "Desktop"
    try:
        import ctypes
        from ctypes import wintypes
        CSIDL_DESKTOP = 0x0010
        buf = wintypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(0, CSIDL_DESKTOP, 0, 0, buf) == 0:
            return Path(buf.value)
    except Exception:
        pass
    return Path.home() / "Desktop"

# =============================================================================
# CONSTANTES ET CONFIGURATION
# =============================================================================

# Chemin vers accoreconsole.exe (même répertoire que acad.exe en général)
# Modifier selon votre version (2024, 2026, etc.)
ACCORECONSOLE_EXE = Path(r"C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe")

# Template .dwt utilisé au démarrage de la console (dessin vierge)
# Si absent, vous pouvez créer un acad.dwt minimal ou pointer vers le template AutoCAD.
TEMPLATE_DWT = Path(r"C:\Users\mvm\Drawing5.dwg")

# Dossier contenant les fichiers DGN à convertir (si aucun argument en ligne de commande)
DEFAULT_FOLDER = Path(
    r"C:\Users\mvm\Geolux_CV_Clone\25-GO00000341  SWJ CV Rue d Itzig SANDWEILER (GLOBEZENIT)-25-444019\interne"
)

# Version DWG pour SAVEAS (ex. "2018", "2013" selon les formats supportés par votre AutoCAD)
SAVEAS_VERSION = "2018"

# Si True, ne pas supprimer le fichier .scr après conversion (pour débogage, vérifier le chemin écrit)
KEEP_SCR = True

# Test : si True, les DWG générés sont écrits sur le Bureau au lieu de dossier_dgn/dwg/
TEST_OUTPUT_DESKTOP = True


# =============================================================================
# GÉNÉRATION DU FICHIER .SCR
# =============================================================================

def build_scr_content(dgn_path: Path, dwg_path: Path) -> str:
    """
    Construit le contenu du script AutoCAD .scr pour convertir un DGN en DWG.

    Séquence :
      FILEDIA / 0     -> pas de dialogue fichier, pour que SAVEAS prenne le chemin en ligne de commande
      DGNIMPORT       -> invite le chemin du fichier DGN
      "chemin\\dgn"   -> chemin avec antislashs doublés pour le .scr
      (ligne vide)    -> modèle par défaut (premier)
      Master          -> unités
      Standard        -> mapping
      SAVEAS          -> commande d'enregistrement
      2018            -> version DWG (ou SAVEAS_VERSION)
      "chemin\\dwg"   -> chemin de sortie (absolu pour être sûr de l'emplacement)
      QUIT            -> quitter la console
    """
    dgn_path = dgn_path.resolve()
    dwg_path = dwg_path.resolve()
    # DGN : antislashs doublés pour le .scr
    dgn_str = str(dgn_path).replace("\\", "\\\\")
    # SAVEAS : avec cwd = dossier de sortie, on envoie le nom de fichier seul (pas de chemin)
    # pour éviter les soucis de chemin absolu dans accoreconsole
    dwg_name = dwg_path.name
    # Ordre SAVEAS selon doc : 1re invite = version (2018), 2e = nom fichier
    lines = [
        "FILEDIA",    # désactiver les dialogues fichier (SAVEAS utilisera nos réponses)
        "0",
        "DGNIMPORT",
        f'"{dgn_str}"',
        "",           # modèle (Entrée = premier)
        "Master",     # unités
        "Standard",   # mapping
        "SAVEAS",
        SAVEAS_VERSION,   # 1re invite : version (ex. 2018)
        f'"{dwg_name}"',  # 2e invite : nom du fichier (enregistré dans cwd = dossier de sortie)
        "QUIT",
    ]
    return "\n".join(lines) + "\n"


def write_scr_file(scr_path: Path, dgn_path: Path, dwg_path: Path) -> None:
    """Écrit le fichier .scr avec la séquence DGNIMPORT / SAVEAS / QUIT."""
    content = build_scr_content(dgn_path, dwg_path)
    scr_path.write_text(content, encoding="utf-8")


# =============================================================================
# LANCEMENT D'ACCORECONSOLE
# =============================================================================

def run_accoreconsole(
    scr_path: Path,
    template_dwt: Path = None,
    timeout_sec: int = 120,
    cwd: Path = None,
) -> bool:
    """
    Lance accoreconsole.exe avec le script .scr et le template .dwt.

    Syntaxe : accoreconsole.exe /i "template.dwt" /s "script.scr"
    cwd : répertoire de travail du processus (dossier de sortie DWG recommandé pour éviter
          que les fichiers soient créés ailleurs).
    Retourne True si le processus se termine avec le code 0.
    """
    exe = ACCORECONSOLE_EXE
    if not exe.exists():
        print(f"  accoreconsole introuvable: {exe}")
        return False
    template = template_dwt or TEMPLATE_DWT
    if not template.exists():
        print(f"  Template introuvable: {template}")
        return False
    args = [
        str(exe),
        "/i", str(template.resolve()),
        "/s", str(scr_path.resolve()),
    ]
    try:
        r = subprocess.run(
            args,
            capture_output=True,
            timeout=timeout_sec,
            encoding="utf-8",
            errors="replace",
            cwd=str(cwd) if cwd and cwd.is_dir() else None,
        )
        return (r.returncode == 0, (r.stdout or ""), (r.stderr or ""))
    except subprocess.TimeoutExpired:
        print("  (timeout)")
        return (False, "", "")
    except Exception as e:
        print(f"  {e}")
        return (False, "", "")


# =============================================================================
# CONVERSION D'UN FICHIER DGN EN DWG
# =============================================================================

def convert_dgn_to_dwg_scr(
    dgn_path: Path,
    dwg_path: Path,
    template_dwt: Path = None,
    scr_dir: Path = None,
    timeout_sec: int = 120,
) -> bool:
    """
    Convertit un DGN en DWG en générant un .scr temporaire et en lançant accoreconsole.

    scr_dir : dossier où écrire le .scr (défaut : dossier temporaire).
    """
    dgn_path = Path(dgn_path).resolve()
    dwg_path = Path(dwg_path).resolve()
    if not dgn_path.exists():
        print(f"  Fichier introuvable: {dgn_path}")
        return False
    dwg_path.parent.mkdir(parents=True, exist_ok=True)
    # Quand KEEP_SCR : écrire le .scr dans le dossier de sortie pour débogage
    scr_dir = Path(scr_dir) if scr_dir else (dwg_path.parent if KEEP_SCR else Path(tempfile.gettempdir()))
    scr_dir.mkdir(parents=True, exist_ok=True)
    scr_path = scr_dir / f"convert_{dgn_path.stem}.scr"
    try:
        write_scr_file(scr_path, dgn_path, dwg_path)
        # cwd = dossier de sortie pour que accoreconsole enregistre bien dans ce dossier
        ok, out, err = run_accoreconsole(
            scr_path,
            template_dwt=template_dwt,
            timeout_sec=timeout_sec,
            cwd=dwg_path.parent,
        )
        # Ne considérer succès que si le fichier DWG a bien été créé
        if ok and not dwg_path.exists():
            print(f"  (accoreconsole a réussi mais fichier absent: {dwg_path})")
            # DGNIMPORT n'existe que dans Map 3D / Civil 3D (sortie peut être en UTF-16 → espaces entre caractères)
            out_compact = out.replace(" ", "")
            if "DGNIMPORT" in out_compact and ("Unknowncommand" in out_compact or "inconnu" in out.lower()):
                print("  >>> Commande DGNIMPORT inconnue : utiliser AutoCAD Map 3D ou Civil 3D (pas AutoCAD seul).")
            if out:
                for line in (out.strip().split("\n")[-12:]):
                    if line.strip():
                        print(f"  | {line[:80]}")
            if err:
                print(f"  stderr: {err[:200]}")
            return False
        return ok
    finally:
        if not KEEP_SCR and scr_path.exists():
            try:
                scr_path.unlink()
            except Exception:
                pass


# =============================================================================
# CONVERSION EN LOT
# =============================================================================

def batch_convert(
    folder_in: Path,
    folder_out: Path = None,
    template_dwt: Path = None,
    timeout_per_file: int = 120,
) -> list:
    """
    Convertit tous les .dgn du dossier folder_in en .dwg dans folder_out.
    Pour chaque DGN : génération d'un .scr, lancement accoreconsole, suppression du .scr.
    Retourne la liste des chemins des fichiers DWG créés avec succès.
    """
    folder_in = Path(folder_in)
    folder_out = Path(folder_out) if folder_out else folder_in / "dwg"
    folder_out.mkdir(parents=True, exist_ok=True)
    dgn_files = list(folder_in.glob("*.dgn")) + list(folder_in.glob("*.DGN"))
    dgn_files = sorted(set(dgn_files))
    if not dgn_files:
        print("Aucun fichier DGN trouvé.")
        return []
    template = template_dwt or TEMPLATE_DWT
    if not template.exists():
        print(f"Template .dwt introuvable: {template}")
        print("Modifiez TEMPLATE_DWT en tête du script ou passez un chemin valide.")
        return []
    if not ACCORECONSOLE_EXE.exists():
        print(f"accoreconsole.exe introuvable: {ACCORECONSOLE_EXE}")
        print("Modifiez ACCORECONSOLE_EXE en tête du script.")
        return []
    converted = []
    for i, dgn in enumerate(dgn_files):
        out_path = folder_out / (dgn.stem + ".dwg")
        print(f"[{i+1}/{len(dgn_files)}] {dgn.name} -> {out_path.name} ...", end=" ", flush=True)
        if convert_dgn_to_dwg_scr(
            dgn, out_path,
            template_dwt=template,
            timeout_sec=timeout_per_file,
        ):
            print("OK")
            converted.append(out_path)
        else:
            print("Échec")
    print(f"\n{len(converted)}/{len(dgn_files)} fichier(s) converti(s) dans: {folder_out}")
    return converted


# =============================================================================
# POINT D'ENTRÉE
# =============================================================================

def main():
    """
    Lit les arguments et lance la conversion en lot.

    Arguments :
      [1] dossier_dgn : dossier contenant les .dgn (défaut : DEFAULT_FOLDER, ex. .../interne)
      [2] dossier_sortie : optionnel ; si absent, sortie dans dossier_dgn/dwg/ (ex. .../interne/dwg/)

    Exemples :
      python dgn_to_dxf_autocad.py
        -> DGN dans DEFAULT_FOLDER, DWG dans DEFAULT_FOLDER/dwg/
      python dgn_to_dxf_autocad.py "C:\\...\\interne"
        -> DGN dans C:\\...\\interne, DWG dans C:\\...\\interne\\dwg\\
      python dgn_to_dxf_autocad.py "C:\\...\\interne" "C:\\...\\interne\\dwg"
        -> sortie explicite dans le 2e dossier
    """
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FOLDER
    # Si pas de 2e argument : sortie dans dossier_dgn/dwg/ (ex. interne/dwg/)
    if len(sys.argv) > 2:
        out_folder = Path(sys.argv[2])
    elif TEST_OUTPUT_DESKTOP:
        out_folder = get_desktop_path()
        print("(Mode test : sortie DWG sur le Bureau)", out_folder)
    else:
        out_folder = folder / "dwg"
    if not folder.is_dir():
        print("Dossier invalide:", folder)
        sys.exit(1)
    print("Dossier DGN :", folder)
    print("Dossier DWG :", out_folder)
    batch_convert(folder, folder_out=out_folder)


if __name__ == "__main__":
    main()
