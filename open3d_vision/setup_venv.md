# Créer l'environnement virtuel (Python 3.12)

Pour situer ce dépôt dans l’arborescence complète (données, serveurs web, autres packages), voir **[docs/NAVIGATION.md](docs/NAVIGATION.md)**.

## 1. Aller dans le projet

```powershell
cd C:\Users\mvm\open3d_vision
```

## 2. Créer le venv avec Python 3.12

```powershell
py -3.12 -m venv .venv
```

Si `py -3.12` n’est pas reconnu, utilisez le chemin complet de votre Python 3.12, par exemple :

```powershell
"C:\Python312\python.exe" -m venv .venv
```

## 3. Activer le venv

**PowerShell :**

```powershell
.\.venv\Scripts\Activate.ps1
```

**Cmd :**

```cmd
.\.venv\Scripts\activate.bat
```

## 4. Installer les dépendances

```powershell
pip install -r requirements.txt
```

## 5. Désactiver le venv

```powershell
deactivate
```

---

**Note :** Si l’exécution de scripts est désactivée sur votre système, exécutez une fois en admin :

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```
