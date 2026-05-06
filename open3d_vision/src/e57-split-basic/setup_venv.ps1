# Crée un environnement virtuel local et installe les dépendances.
# À exécuter une fois par machine (depuis ce dossier).
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

if (-not (Get-Command py -ErrorAction SilentlyContinue) -and -not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Error "Python 3 n'est pas dans le PATH. Installez Python 3.11+ depuis python.org ou le Microsoft Store."
}

$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py -3 -m venv "$Root\.venv"
& "$Root\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$Root\.venv\Scripts\pip.exe" install -r "$Root\requirements.txt"
Write-Host "OK — activez l'environnement avec : .\.venv\Scripts\Activate.ps1" -ForegroundColor Green
