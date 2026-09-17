"""Production entry point for the bundled Daily Plan backend."""

import argparse
import os
from pathlib import Path

import uvicorn


def valid_port(value: str) -> int:
    port = int(value)
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("端口必须在 1 到 65535 之间")
    return port


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Daily Plan 本地后端")
    parser.add_argument("--port", type=valid_port, default=8000, help="本地监听端口")
    parser.add_argument("--data-dir", type=Path, help="用户数据目录")
    parser.add_argument("--db-path", type=Path, help="SQLite 数据库路径")
    parser.add_argument("--migrate-from", type=Path, help="仅当目标不存在时复制旧数据库")
    parser.add_argument(
        "--log-level",
        choices=("critical", "error", "warning", "info", "debug"),
        default="info",
    )
    return parser.parse_args(argv)


def apply_runtime_options(options, environment=None):
    environment = os.environ if environment is None else environment
    if options.data_dir is not None:
        environment["DAILY_PLAN_DATA_DIR"] = str(options.data_dir.expanduser().resolve())
    if options.db_path is not None:
        environment["DAILY_PLAN_DB_PATH"] = str(options.db_path.expanduser().resolve())


def load_app():
    # The package import is used by PyInstaller; the fallback keeps direct
    # `python backend/server.py` development runs convenient.
    try:
        from backend.main import app
    except ModuleNotFoundError:
        from main import app
    return app


def main(argv=None):
    options = parse_args(argv)
    apply_runtime_options(options)
    if options.migrate_from is not None:
        try:
            from backend.storage import migrate_database
        except ModuleNotFoundError:
            from storage import migrate_database

        configured_data_dir = Path(os.environ.get("DAILY_PLAN_DATA_DIR", Path.cwd()))
        destination = Path(os.environ.get("DAILY_PLAN_DB_PATH", configured_data_dir / "data.db"))
        migrate_database(options.migrate_from, destination)
    app = load_app()
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=options.port,
        log_level=options.log_level,
        access_log=False,
        workers=1,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
