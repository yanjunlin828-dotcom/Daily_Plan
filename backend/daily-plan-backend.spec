from pathlib import Path

PROJECT_ROOT = Path(SPECPATH).resolve().parent
BACKEND_DIR = PROJECT_ROOT / "backend"

datas = [
    (str(PROJECT_ROOT / "index.html"), "web"),
    (str(PROJECT_ROOT / "app.js"), "web"),
    (str(PROJECT_ROOT / "style.css"), "web"),
    (str(PROJECT_ROOT / "favicon.ico"), "web"),
    (str(PROJECT_ROOT / "package.json"), "web"),
    (str(PROJECT_ROOT / "style"), "web/style"),
]

a = Analysis(
    [str(BACKEND_DIR / "server.py")],
    pathex=[str(PROJECT_ROOT), str(BACKEND_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # This service uses Uvicorn's asyncio single-worker HTTP path. Excluding
    # optional reload/worker and Trio testing chains prevents packages from a
    # developer's global Python environment leaking into the release bundle.
    excludes=[
        "anyio._backends._trio",
        "trio",
        "pytest",
        "_pytest",
        "pydantic.mypy",
        "pydantic.v1.mypy",
        "uvicorn.workers",
        "gunicorn",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="daily-plan-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    icon=str(PROJECT_ROOT / "favicon.ico"),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="daily-plan-backend",
)
