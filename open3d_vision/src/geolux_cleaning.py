import os

base_path = r'C:\Users\mvm\Geolux_CV_Clone'

# Ancienne logique: 
# Parcourait tous les dossiers, détectait les fichiers .dgn, gardait le plus récent et supprimait les autres.


# Liste pour stocker tous les dossiers internes vides
# Lister tous les dossiers dans base_path dont au moins un dossier "client" ou "interne" est complètement vide

# Supprimer tous les dossiers dans base_path dont les sous-dossiers "client" ou "interne" sont vides

# removed_dirs = []

# for root, dirs, files in os.walk(base_path, topdown=False):
#     for subdir in dirs:
#         if subdir.lower() in ["client", "interne"]:
#             subdir_path = os.path.join(root, subdir)
#             # Vérifie si "client" ou "interne" est vide
#             if os.path.isdir(subdir_path) and not os.listdir(subdir_path):
#                 print(f"Suppression du sous-dossier vide : {subdir_path}")
#                 os.rmdir(subdir_path)
#                 removed_dirs.append(subdir_path)
#     # Si, après la suppression, le dossier parent ne contient plus rien, on le supprime aussi
#     # (cela efface le dossier si les seuls sous-dossiers étaient "client"/"interne" maintenant supprimés)
#     if root != base_path and not os.listdir(root):
#         print(f"Suppression du dossier parent maintenant vide : {root}")
#         os.rmdir(root)
#         removed_dirs.append(root)

# print(f"Nombre de dossiers/sous-dossiers supprimés : {len(removed_dirs)}")
for entry in os.listdir(base_path):
    entry_path = os.path.join(base_path, entry)
    if os.path.isdir(entry_path):
        has_client = os.path.isdir(os.path.join(entry_path, "client"))
        has_interne = os.path.isdir(os.path.join(entry_path, "interne"))
        if not (has_client and has_interne):
            print(f"Suppression du dossier (ne contient pas 'client' et 'interne') : {entry_path}")
            # Supprime le dossier et tout son contenu
            for root, dirs, files in os.walk(entry_path, topdown=False):
                for name in files:
                    file_path = os.path.join(root, name)
                    try:
                        os.remove(file_path)
                    except Exception as e:
                        print(f"Erreur lors de la suppression du fichier {file_path} : {e}")
                for name in dirs:
                    dir_path = os.path.join(root, name)
                    try:
                        os.rmdir(dir_path)
                    except Exception as e:
                        print(f"Erreur lors de la suppression du dossier {dir_path} : {e}")
            try:
                os.rmdir(entry_path)
            except Exception as e:
                print(f"Erreur lors de la suppression du dossier principal {entry_path} : {e}")
