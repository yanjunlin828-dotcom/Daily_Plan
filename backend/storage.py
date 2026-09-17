"""Safe SQLite storage migration helpers used before the API is imported."""

import os
from pathlib import Path
import sqlite3


def migrate_database(source, destination) -> bool:
    """Copy a SQLite database once, preserving the source and committed WAL data."""
    source = Path(source)
    destination = Path(destination)
    if destination.exists() or not source.is_file():
        return False
    if source.resolve() == destination.resolve():
        return False

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.migrating-{os.getpid()}")
    temporary.unlink(missing_ok=True)
    try:
        source_connection = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
        try:
            destination_connection = sqlite3.connect(temporary)
            try:
                source_connection.backup(destination_connection)
                result = destination_connection.execute("PRAGMA integrity_check").fetchone()
                if not result or result[0] != "ok":
                    raise RuntimeError("迁移后的数据库完整性检查失败。")
            finally:
                destination_connection.close()
        finally:
            source_connection.close()
        if destination.exists():
            temporary.unlink(missing_ok=True)
            return False
        temporary.replace(destination)
        return True
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
