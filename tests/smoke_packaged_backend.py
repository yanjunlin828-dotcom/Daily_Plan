"""End-to-end smoke test for the PyInstaller backend bundle."""

import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
EXECUTABLE = ROOT / "output" / "backend-dist" / "daily-plan-backend" / "daily-plan-backend.exe"
BLOCKED_NAMES = {"data.db", "data.db-wal", "data.db-shm", "backend.log", "launcher.log"}


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(port: int, path: str, method="GET", body=None):
    payload = None if body is None else json.dumps(body).encode("utf-8")
    headers = {} if body is None else {"Content-Type": "application/json"}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(
        urllib.request.Request(
            f"http://127.0.0.1:{port}{path}", data=payload, headers=headers, method=method
        ),
        timeout=3,
    ) as response:
        content = response.read()
        content_type = response.headers.get("Content-Type", "")
        return json.loads(content) if "json" in content_type else content.decode("utf-8")


def start_backend(data_dir: Path, port: int):
    process = subprocess.Popen(
        [
            str(EXECUTABLE),
            "--data-dir",
            str(data_dir),
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        if process.poll() is not None:
            output = process.stdout.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Packaged backend exited during startup:\n{output}")
        try:
            health = request(port, "/api/health")
            if health.get("ok") is True:
                return process
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(0.2)
    stop_backend(process)
    raise RuntimeError("Packaged backend did not become healthy within 20 seconds")


def stop_backend(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def main():
    if not EXECUTABLE.is_file():
        raise FileNotFoundError(f"Build the backend first: {EXECUTABLE}")
    bundled_personal_files = [path for path in EXECUTABLE.parent.rglob("*") if path.is_file() and path.name in BLOCKED_NAMES]
    if bundled_personal_files:
        raise AssertionError(f"Personal data found in bundle: {bundled_personal_files}")

    (ROOT / ".tmp").mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="packaged-backend-", dir=ROOT / ".tmp") as temporary:
        data_dir = Path(temporary) / "data"
        port = free_port()
        process = start_backend(data_dir, port)
        try:
            health = request(port, "/api/health")
            assert health == {
                "ok": True,
                "appId": "daily-plan",
                "appVersion": "0.1.0",
                "apiVersion": 2,
            }
            assert "每日规划" in request(port, "/")
            assert "--accent:" in request(port, "/style/variables.css")
            saved = request(
                port,
                "/api/tasks/2099-12-31",
                method="PUT",
                body={
                    "items": [{"id": "packaged-smoke", "text": "persisted", "done": False}],
                    "expectedRevision": 0,
                },
            )
            assert saved["revision"] == 1
            assert (data_dir / "data.db").is_file()
        finally:
            stop_backend(process)

        process = start_backend(data_dir, port)
        try:
            data = request(port, "/api/data")
            assert data["tasks"]["2099-12-31"][0]["text"] == "persisted"
            assert data["revisions"]["tasks"]["2099-12-31"] == 1
        finally:
            stop_backend(process)

    print("PASS: packaged backend cold start, assets, writes, and restart persistence")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
