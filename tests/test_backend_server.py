import argparse
from contextlib import closing
from pathlib import Path
import sqlite3
from unittest.mock import patch

import pytest

from backend import server


def test_valid_port_rejects_out_of_range_values():
    assert server.valid_port("8000") == 8000
    with pytest.raises(argparse.ArgumentTypeError):
        server.valid_port("0")
    with pytest.raises(argparse.ArgumentTypeError):
        server.valid_port("65536")


def test_runtime_options_resolve_explicit_paths(tmp_path):
    environment = {}
    options = server.parse_args([
        "--data-dir", str(tmp_path / "data"),
        "--db-path", str(tmp_path / "custom.db"),
    ])
    server.apply_runtime_options(options, environment)
    assert environment["DAILY_PLAN_DATA_DIR"] == str((tmp_path / "data").resolve())
    assert environment["DAILY_PLAN_DB_PATH"] == str((tmp_path / "custom.db").resolve())


def test_server_binds_only_to_loopback(tmp_path):
    fake_app = object()
    with patch.object(server, "load_app", return_value=fake_app), patch.object(server.uvicorn, "run") as run:
        assert server.main(["--port", "8123", "--data-dir", str(tmp_path)]) == 0
    run.assert_called_once_with(
        fake_app,
        host="127.0.0.1",
        port=8123,
        log_level="info",
        access_log=False,
        workers=1,
    )


def test_frozen_backend_defaults_to_appdata(monkeypatch):
    monkeypatch.setenv("APPDATA", r"C:\Users\tester\AppData\Roaming")
    monkeypatch.delenv("DAILY_PLAN_DATA_DIR", raising=False)
    from backend import main

    assert main.resolve_data_dir(frozen=True) == Path(r"C:\Users\tester\AppData\Roaming") / "Daily Plan"


def test_server_migrates_legacy_database_before_loading_app(tmp_path, monkeypatch):
    source = tmp_path / "legacy.db"
    data_dir = tmp_path / "desktop-data"
    with closing(sqlite3.connect(source)) as connection:
        connection.execute("CREATE TABLE sample(value TEXT)")
        connection.execute("INSERT INTO sample VALUES ('legacy')")
        connection.commit()

    fake_app = object()
    monkeypatch.delenv("DAILY_PLAN_DB_PATH", raising=False)
    with patch.object(server, "load_app", return_value=fake_app), patch.object(server.uvicorn, "run"):
        server.main(["--data-dir", str(data_dir), "--migrate-from", str(source)])

    with closing(sqlite3.connect(data_dir / "data.db")) as connection:
        assert connection.execute("SELECT value FROM sample").fetchone()[0] == "legacy"
