"""Silent personal desktop launcher. Uses only Python's standard library."""
import ctypes
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
import msvcrt
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
APP_DATA_FOLDER = 'Daily Plan'
LEGACY_DATABASE = ROOT / 'backend' / 'data.db'
HEALTH = 'http://127.0.0.1:8000/api/health'


@dataclass(frozen=True)
class RuntimePaths:
    """Writable paths owned by the current Windows user."""

    data_dir: Path
    database: Path
    logs: Path
    state: Path


def resolve_runtime_paths(environment=None):
    """Resolve desktop paths without depending on the install directory."""
    environment = os.environ if environment is None else environment
    configured_dir = environment.get('DAILY_PLAN_DATA_DIR')
    if configured_dir:
        data_dir = Path(configured_dir).expanduser()
    else:
        appdata = environment.get('APPDATA')
        if appdata:
            data_dir = Path(appdata) / APP_DATA_FOLDER
        else:
            data_dir = Path.home() / 'AppData' / 'Roaming' / APP_DATA_FOLDER
    configured_database = environment.get('DAILY_PLAN_DB_PATH')
    database = Path(configured_database).expanduser() if configured_database else data_dir / 'data.db'
    return RuntimePaths(
        data_dir=data_dir,
        database=database,
        logs=data_dir / 'logs',
        state=data_dir / 'runtime',
    )


RUNTIME = resolve_runtime_paths()
STATE = RUNTIME.state
LOGS = RUNTIME.logs
DATABASE = RUNTIME.database


def ensure_runtime_directories(paths=RUNTIME):
    paths.database.parent.mkdir(parents=True, exist_ok=True)
    paths.logs.mkdir(parents=True, exist_ok=True)
    paths.state.mkdir(parents=True, exist_ok=True)


def migrate_legacy_database(source=LEGACY_DATABASE, destination=DATABASE):
    """Copy a legacy database safely without changing or replacing the source."""
    source = Path(source)
    destination = Path(destination)
    if destination.exists() or not source.is_file():
        return False
    if source.resolve() == destination.resolve():
        return False

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f'.{destination.name}.migrating-{os.getpid()}')
    if temporary.exists():
        temporary.unlink()
    try:
        # SQLite backup includes committed WAL content and produces a consistent
        # destination even if the legacy database was not cleanly shut down.
        source_uri = source.resolve().as_uri() + '?mode=ro'
        source_connection = sqlite3.connect(source_uri, uri=True)
        try:
            destination_connection = sqlite3.connect(temporary)
            try:
                source_connection.backup(destination_connection)
                result = destination_connection.execute('PRAGMA integrity_check').fetchone()
                if not result or result[0] != 'ok':
                    raise RuntimeError('迁移后的数据库完整性检查失败。')
            finally:
                destination_connection.close()
        finally:
            # A sqlite connection context commits or rolls back but does not
            # close. Windows requires both handles closed before rename/delete.
            source_connection.close()
        if destination.exists():
            temporary.unlink(missing_ok=True)
            return False
        temporary.replace(destination)
        return True
    except Exception:
        temporary.unlink(missing_ok=True)
        raise


def desktop_environment(reuse_backend=False):
    environment = os.environ.copy()
    if reuse_backend:
        environment['DAILY_PLAN_EXISTING_BACKEND_PORT'] = '8000'
    else:
        environment.pop('DAILY_PLAN_EXISTING_BACKEND_PORT', None)
    return environment


def backend_ready():
    try:
        # Local service must not go through a user's configured HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(HEALTH, timeout=1) as response:
            value = json.load(response)
        return value.get('ok') is True and value.get('appId') == 'daily-plan' and value.get('apiVersion') == 2
    except (OSError, ValueError):
        return False


def main():
    ensure_runtime_directories()
    logging.basicConfig(filename=LOGS / 'launcher.log', level=logging.INFO,
                        format='%(asctime)s %(message)s', encoding='utf-8')
    # Concurrent desktop/login launches share one startup sequence.
    with (STATE / 'launch.lock').open('a+b') as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b'0')
            lock.flush()
        lock.seek(0)
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            logging.info('Another launcher is already starting Daily Plan')
            return 0
        try:
            electron = ROOT / 'node_modules' / 'electron' / 'dist' / 'electron.exe'
            if not electron.is_file():
                raise RuntimeError('找不到桌面程序，请在项目目录运行 npm install。')
            # If an older backend is already running it may still be writing the
            # legacy database. Wait for the next cold start before migrating it.
            reuse_backend = backend_ready()
            if not reuse_backend and migrate_legacy_database():
                logging.info('Migrated legacy database from %s to %s at %s',
                             LEGACY_DATABASE, DATABASE, datetime.now(timezone.utc).isoformat())
            with (STATE / 'desktop.log').open('ab') as output:
                process = subprocess.Popen([str(electron), str(ROOT)], cwd=ROOT,
                                           stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                           creationflags=subprocess.CREATE_NO_WINDOW,
                                           env=desktop_environment(reuse_backend))
            logging.info('Desktop launch requested, PID %s', process.pid)
            return 0
        except Exception as error:
            logging.exception('Launch failed')
            if '--autostart' not in sys.argv:
                ctypes.windll.user32.MessageBoxW(None, str(error), 'Daily Plan 启动失败', 0x10)
            return 1
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    sys.exit(main())
