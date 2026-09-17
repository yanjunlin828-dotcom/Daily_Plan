$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$specFile = Join-Path $projectDir 'backend\daily-plan-backend.spec'
$requirementsFile = Join-Path $projectDir 'backend\requirements-build.txt'
$distDir = Join-Path $projectDir 'output\backend-dist'
$workDir = Join-Path $projectDir 'output\backend-build'
$venvDir = Join-Path $projectDir '.tmp\backend-build-venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$requirementsStamp = Join-Path $venvDir '.requirements-sha256'

Push-Location $projectDir
try {
    if (-not (Test-Path -LiteralPath $venvPython)) {
        python -m venv $venvDir
        if ($LASTEXITCODE -ne 0) { throw "Could not create backend build environment" }
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $requirementsHash = [System.BitConverter]::ToString(
            $sha256.ComputeHash([System.IO.File]::ReadAllBytes($requirementsFile))
        ).Replace('-', '')
    } finally {
        $sha256.Dispose()
    }
    $installedHash = if (Test-Path -LiteralPath $requirementsStamp) {
        (Get-Content -LiteralPath $requirementsStamp -Raw).Trim()
    } else { '' }
    if ($requirementsHash -ne $installedHash) {
        & $venvPython -m pip install --disable-pip-version-check -r $requirementsFile
        if ($LASTEXITCODE -ne 0) { throw "Could not install backend build dependencies" }
        Set-Content -LiteralPath $requirementsStamp -Value $requirementsHash -Encoding ascii
    }

    & $venvPython -m PyInstaller `
        --noconfirm `
        --clean `
        --distpath $distDir `
        --workpath $workDir `
        $specFile
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }

    $executable = Join-Path $distDir 'daily-plan-backend\daily-plan-backend.exe'
    if (-not (Test-Path -LiteralPath $executable)) {
        throw "Backend executable was not created: $executable"
    }
    Write-Output "Built: $executable"
} finally {
    Pop-Location
}
