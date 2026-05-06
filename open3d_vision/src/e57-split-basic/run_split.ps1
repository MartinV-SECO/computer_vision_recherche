# Exemple : découpe d'un E57 déjà présent sur le disque.
# Modifiez les deux chemins ci-dessous, ou appelez ce script avec des arguments.
param(
    [Parameter(Mandatory = $false)]
    [string] $InputE57 = "",
    [Parameter(Mandatory = $false)]
    [string] $OutputDir = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$python = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    Write-Error "Environnement manquant. Lancez d'abord : .\setup_venv.ps1"
}

# Défauts : E57 dans input\, sortie dans output\<nom>_chunks
if (-not $InputE57) {
    $candidates = Get-ChildItem -Path (Join-Path $Root "input") -Filter "*.e57" -File -ErrorAction SilentlyContinue
    if ($candidates.Count -eq 1) {
        $InputE57 = $candidates[0].FullName
    } else {
        Write-Error "Indiquez le chemin du .e57 : .\run_split.ps1 -InputE57 'D:\data\nuage.e57' -OutputDir 'D:\data\nuage_chunks'"
    }
}
if (-not $OutputDir) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($InputE57)
    $OutputDir = Join-Path $Root "output" ($base + "_chunks")
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

& $python "$Root\split_e57_chunks.py" --output-dir "$OutputDir" "$InputE57"
Write-Host "Terminé. Sortie : $OutputDir" -ForegroundColor Green
