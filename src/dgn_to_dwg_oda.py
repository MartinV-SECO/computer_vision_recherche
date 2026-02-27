import os
import shutil
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from datetime import datetime

# Phrase détectée dans la sortie accoreconsole = DGN refusé (format non supporté par AutoCAD)
DGN_REJECTED_MARKER = "Invalid or unsupported DGN file"

# ===== CONFIGURATION =====
AUTOCAD_CORE = r"C:\Program Files\Autodesk\AutoCAD 2026\accoreconsole.exe"
TEMPLATE_DWG = r"C:\Users\mvm\Drawing5.dwg"  # DWG vierge minimal
ACAD_VERSION = "2018"  # format de sortie
TIMEOUT_SECONDS = 60
# Délai (s) après lequel on considère la conversion terminée si le DWG existe (accoreconsole peut ne pas quitter)
STABILITY_CHECK_SECONDS = 5
# Intervalle (s) entre deux logs de temporisation dans la boucle d'attente
POLL_LOG_INTERVAL = 10

# Sous Windows, masquer la fenêtre console pour éviter blocages
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

# ==========================


def log(message, log_file):
    """Écrit un message avec horodatage (console + fichier)."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {message}"
    print(formatted)
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(formatted + "\n")


def log_elapsed(start_time, message, log_file):
    """Log avec temps écoulé depuis start_time (en secondes)."""
    elapsed = round(time.time() - start_time, 1)
    log(f"  ⏱ {elapsed}s — {message}", log_file)


def create_script(dgn_path, dwg_path):
    dgn_abs = str(Path(dgn_path).resolve()).replace("\\", "/")
    dwg_abs = str(Path(dwg_path).resolve()).replace("\\", "/")

    script_content = f"""FILEDIA 0
CMDDIA 0
EXPERT 5
SECURELOAD 0
_.-DGNIMPORT
"{dgn_abs}"
Both
0,0
1
0
_.ZOOM
E
_.SAVEAS
2018
"{dwg_abs}"
Y
_.QUIT
Y
"""

    temp_script = tempfile.NamedTemporaryFile(delete=False, suffix=".scr", mode="w", encoding="cp1252")
    temp_script.write(script_content)
    temp_script.close()
    return temp_script.name



def verify_output(dwg_path):
    if not dwg_path.exists():
        return False, "DWG non généré"

    if dwg_path.stat().st_size == 0:
        return False, "DWG vide (0 bytes)"

    return True, "OK"


def _dwg_stable(dwg_path, min_size=1):
    """Vérifie que le fichier DWG existe et a une taille stable (écriture terminée)."""
    if not dwg_path.exists() or dwg_path.stat().st_size < min_size:
        return False
    size = dwg_path.stat().st_size
    time.sleep(min(2, STABILITY_CHECK_SECONDS))
    return dwg_path.exists() and dwg_path.stat().st_size == size


def check_accoreconsole_connection(log_file=None):
    """
    Vérifie que accoreconsole est joignable : exe présent, script minimal exécuté, process se termine.
    Retourne (ok: bool, message: str). Si log_file fourni, écrit les sorties stdout/stderr.
    """
    def _log(msg):
        print(msg)
        if log_file:
            with open(log_file, "a", encoding="utf-8") as f:
                f.write(msg + "\n")

    if not Path(AUTOCAD_CORE).exists():
        return False, "accoreconsole introuvable: %s" % AUTOCAD_CORE

    # Script minimal : ouvrir le dessin (ou rien), quitter
    drawing_to_open = None
    if Path(TEMPLATE_DWG).exists():
        fd, template_copy = tempfile.mkstemp(suffix=".dwg")
        os.close(fd)
        try:
            shutil.copy2(TEMPLATE_DWG, template_copy)
            drawing_to_open = template_copy
        except Exception as e:
            return False, "Impossible de copier le modèle: %s" % e
    else:
        _log("Attention: TEMPLATE_DWG absent, test sans /i")
    script_content = "_.QUIT\nY\n"
    script_fd, script_path = tempfile.mkstemp(suffix=".scr")
    os.close(script_fd)
    try:
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(script_content)
    except Exception as e:
        if drawing_to_open and os.path.exists(drawing_to_open):
            os.remove(drawing_to_open)
        return False, "Impossible d'écrire le script: %s" % e

    cwd = str(Path(TEMPLATE_DWG).parent) if Path(TEMPLATE_DWG).exists() else os.getcwd()
    creation_flags = CREATE_NO_WINDOW if os.name == "nt" else 0
    args = [AUTOCAD_CORE]
    if drawing_to_open:
        args.extend(["/i", drawing_to_open])
    args.extend(["/s", script_path])

    try:
        _log("Vérification accoreconsole: lancement (timeout 30s)...")
        t0 = time.time()
        proc = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=cwd,
            creationflags=creation_flags,
        )
        try:
            out, err = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            proc.kill()
            out, err = proc.communicate()
            if drawing_to_open and os.path.exists(drawing_to_open):
                os.remove(drawing_to_open)
            if os.path.exists(script_path):
                os.remove(script_path)
            return False, "Timeout 30s: accoreconsole ne s'est pas terminé"
        duration = round(time.time() - t0, 1)
        if log_file:
            _log("--- stdout accoreconsole ---")
            _log(out or "(vide)")
            _log("--- stderr accoreconsole ---")
            _log(err or "(vide)")
        if proc.returncode != 0:
            if drawing_to_open and os.path.exists(drawing_to_open):
                os.remove(drawing_to_open)
            if os.path.exists(script_path):
                os.remove(script_path)
            return False, "accoreconsole a quitté avec le code %s (%.1fs). Vérifier stdout/stderr ci-dessus." % (proc.returncode, duration)
        _log("Connexion accoreconsole OK (%.1fs, code 0)." % duration)
        return True, "OK (%.1fs)" % duration
    except Exception as e:
        if drawing_to_open and os.path.exists(drawing_to_open):
            try:
                os.remove(drawing_to_open)
            except OSError:
                pass
        if os.path.exists(script_path):
            try:
                os.remove(script_path)
            except OSError:
                pass
        return False, "Exception: %s" % e
    finally:
        if os.path.exists(script_path):
            try:
                os.remove(script_path)
            except OSError:
                pass
        if drawing_to_open and os.path.exists(drawing_to_open):
            try:
                os.remove(drawing_to_open)
            except OSError:
                pass


def convert_dgn_to_dwg(dgn_file, log_file):
    """
    Lance accoreconsole pour convertir un DGN en DWG via DGNIMPORT (accoreconsole ne gère pas DGNATTACH).
    Gère le bug connu où accoreconsole ne quitte pas : si le DWG est créé,
    on considère la conversion réussie et on termine le processus si besoin.
    """
    dgn_path = Path(dgn_file).resolve()
    dwg_path = dgn_path.with_suffix(".dwg")
    work_dir = str(dgn_path.parent)

    t0 = time.time()
    log(f"🔄 Conversion démarrée : {dgn_path.name}", log_file)

    # Utilisation du chemin DGN tel quel (le rejet "Invalid or unsupported" vient du format fichier, pas du chemin)
    dgn_copy_path = None
    dgn_for_script = dgn_path

    script_path = create_script(dgn_for_script, dwg_path)
    log_elapsed(t0, "Script .scr créé", log_file)
    timeout_sec = TIMEOUT_SECONDS  # ref explicite pour éviter NameError si import partiel
    template_copy = None  # copie temporaire du modèle (évite "in use or read-only")

    try:
        if Path(TEMPLATE_DWG).exists():
            fd, template_copy = tempfile.mkstemp(suffix=".dwg")
            os.close(fd)
            shutil.copy2(TEMPLATE_DWG, template_copy)
            drawing_to_open = template_copy
            log_elapsed(t0, "Copie du modèle DWG prête", log_file)
        else:
            drawing_to_open = TEMPLATE_DWG

        start_time = time.time()
        creation_flags = CREATE_NO_WINDOW if os.name == "nt" else 0

        proc = subprocess.Popen(
            [
                AUTOCAD_CORE,
                "/i", drawing_to_open,
                "/s", script_path
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=work_dir,
            creationflags=creation_flags,
            bufsize=1,
        )
        log_elapsed(t0, "Processus accoreconsole lancé (timeout=%ds)" % timeout_sec, log_file)

        # Lecture stdout en arrière-plan pour détecter "Invalid or unsupported DGN file" et arrêter vite
        dgn_rejected = threading.Event()
        out_lines = []
        def read_pipe(pipe, lines_list):
            try:
                for line in iter(pipe.readline, ""):
                    lines_list.append(line)
                    if DGN_REJECTED_MARKER in line:
                        dgn_rejected.set()
            except Exception:
                pass
        t_out = threading.Thread(target=read_pipe, args=(proc.stdout, out_lines), daemon=True)
        t_out.start()

        last_log_at = 0
        try:
            poll_interval = 3
            elapsed = 0
            while elapsed < timeout_sec:
                if dgn_rejected.is_set():
                    log_elapsed(t0, "DGN refusé par AutoCAD (format non supporté) → arrêt immédiat", log_file)
                    proc.terminate()
                    try:
                        proc.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    break
                ret = proc.poll()
                if ret is not None:
                    log_elapsed(t0, "Processus terminé (code=%s)" % ret, log_file)
                    break
                if _dwg_stable(dwg_path):
                    log_elapsed(t0, "DWG détecté et stable → arrêt du processus", log_file)
                    proc.terminate()
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                    break
                if elapsed - last_log_at >= POLL_LOG_INTERVAL:
                    dwg_exists = dwg_path.exists()
                    size = dwg_path.stat().st_size if dwg_exists else 0
                    log_elapsed(t0, "Attente… %d/%ds — DWG: %s (taille %d)" % (elapsed, timeout_sec, "oui" if dwg_exists else "non", size), log_file)
                    last_log_at = elapsed
                time.sleep(poll_interval)
                elapsed += poll_interval
            else:
                if not dgn_rejected.is_set():
                    log_elapsed(t0, "Timeout %ds atteint → arrêt forcé du processus" % timeout_sec, log_file)
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        except Exception:
            proc.kill()
            raise
        t_out.join(timeout=2)
        try:
            rest_out, err = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            rest_out, err = proc.communicate()
        out = "".join(out_lines) + (rest_out or "")

        duration = round(time.time() - start_time, 2)
        log_elapsed(t0, "Boucle d'attente terminée (durée totale: %ss)" % duration, log_file)

        # Si DGN refusé (format non supporté), message clair et sortie sans attendre 60s
        if dgn_rejected.is_set():
            log("❌ Le fichier DGN est refusé par AutoCAD : format non supporté (pas V7/V8 ou fichier invalide).", log_file)
            log("   Ce n'est pas un problème de chemin. Pistes : ouvrir dans MicroStation et exporter en DGN V8 ou en DWG.", log_file)
            return False

        if out:
            print(out)
        if err:
            print(err)

        # Secours si le refus DGN n'a pas été détecté en temps réel
        combined = (out or "") + (err or "")
        if DGN_REJECTED_MARKER in combined or "unsupported DGN file" in combined:
            log("❌ Le fichier DGN est refusé par AutoCAD : format non supporté (V7/V8 uniquement).", log_file)
            log("   Piste : ouvrir dans MicroStation et exporter en DGN V8 ou en DWG.", log_file)
            if out:
                for line in out.splitlines():
                    if "DGN" in line or "Invalid" in line or "unsupported" in line:
                        log("   >> %s" % line.strip(), log_file)
            return False

        if proc.returncode is not None and proc.returncode != 0:
            log(f"❌ Erreur Core Console ({duration}s)", log_file)
            if err:
                log(err, log_file)
            return False

        success, message = verify_output(dwg_path)
        if success:
            log(f"✅ Succès ({duration}s) → {dwg_path.name}", log_file)
            return True
        log(f"❌ Échec validation : {message}", log_file)
        return False

    except subprocess.TimeoutExpired:
        log_elapsed(t0, "⏳ Timeout atteint", log_file)
        return False
    except Exception as e:
        log(f"💥 Exception : {str(e)}", log_file)
        return False
    finally:
        if os.path.exists(script_path):
            try:
                os.remove(script_path)
            except OSError:
                pass
        if template_copy and os.path.exists(template_copy):
            try:
                os.remove(template_copy)
            except OSError:
                pass


def process_directory(directory):
    directory = Path(directory)
    log_file = directory / "conversion_log.txt"

    log("===== DÉMARRAGE CONVERSION =====", log_file)

    ok, msg = check_accoreconsole_connection(log_file)
    if not ok:
        log("❌ Vérification accoreconsole échouée: %s" % msg, log_file)
        return
    log("✓ Connexion accoreconsole vérifiée.", log_file)

    if not directory.exists():
        log("❌ Dossier introuvable", log_file)
        return

    dgn_files = list(directory.glob("*.dgn"))

    if not dgn_files:
        log("⚠️ Aucun fichier DGN trouvé", log_file)
        return

    total = len(dgn_files)
    success_count = 0

    for index, dgn in enumerate(dgn_files, start=1):
        log(f"📁 [{index}/{total}] Traitement : {dgn.name}", log_file)
        success = convert_dgn_to_dwg(dgn, log_file)
        if success:
            success_count += 1

    log("===== FIN CONVERSION =====", log_file)
    log(f"✔ Réussis : {success_count}/{total}", log_file)
    log(f"✖ Échecs : {total - success_count}/{total}", log_file)





if __name__ == "__main__":
    import sys
    if "--check" in sys.argv:
        ok, msg = check_accoreconsole_connection()
        print("Connexion accoreconsole: OK" if ok else ("ÉCHEC: " + msg))
        sys.exit(0 if ok else 1)
    folder_path = r"C:\Users\mvm\Geolux_CV_Clone\25-GO00000018 YGR CV Route du Vin GREVENMACHER (SOLUDEC)-25-409003\interne"  # <-- à modifier
    process_directory(folder_path)
