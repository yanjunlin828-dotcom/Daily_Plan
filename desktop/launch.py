"""Silent personal desktop launcher. Uses only Python's standard library."""
import ctypes
import json
import logging
import msvcrt
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / '.tmp' / 'launcher'
HEALTH = 'http://127.0.0.1:8000/api/health'


def backend_ready():
    try:
        # Local service must not go through a user's configured HTTP proxy.
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(HEALTH, timeout=1) as response:
            value = json.load(response)
        return value.get('ok') is True and value.get('appId') == 'daily-plan' and value.get('apiVersion') == 2
    except (OSError, ValueError):
        return False


def ensure_backend():
    if backend_ready():
        logging.info('Reusing healthy backend')
        return
    with (STATE / 'backend.log').open('ab') as output:
        process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'main:app', '--app-dir', str(ROOT / 'backend'),
             '--host', '127.0.0.1', '--port', '8000'],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if backend_ready():
            logging.info('Backend ready, launched PID %s', process.pid)
            return
        if process.poll() is not None:
            raise RuntimeError('后端启动失败，请查看 .tmp/launcher/backend.log。')
        time.sleep(.4)
    raise RuntimeError('后端暂未就绪，请稍后重试。详情见 .tmp/launcher/backend.log。')


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=STATE / 'launcher.log', level=logging.INFO,
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
            ensure_backend()
            with (STATE / 'desktop.log').open('ab') as output:
                process = subprocess.Popen([str(electron), str(ROOT)], cwd=ROOT,
                                           stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                           creationflags=subprocess.CREATE_NO_WINDOW)
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
