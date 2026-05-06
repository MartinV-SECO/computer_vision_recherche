import os
import shutil

source_dir = r'K:\Geolux G.O'
dest_dir = r'C:\Users\mvm\Geolux_CV_Clone'

# Vérifie si le dossier destination existe, sinon le crée
os.makedirs(dest_dir, exist_ok=True)

# Parcours récursivement le répertoire source pour trouver tous les fichiers .dwg dans les sous-répertoires
for dirpath, dirnames, files in os.walk(source_dir):
    for file in files:
        if os.path.splitext(file)[1].lower() == '.dwg':
            src_file = os.path.join(dirpath, file)
            dest_file = os.path.join(dest_dir, file)
            try:
                shutil.copy2(src_file, dest_file)
                print(f"Fichier copié : {file}")
            except Exception as copy_err:
                print(f"Erreur en copiant {file} : {copy_err}")