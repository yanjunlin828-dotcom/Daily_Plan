"""Daily Plan 后端：FastAPI + SQLite，供网页和桌面浮窗共享。"""

import json
import os
import sqlite3
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

APP_ID = "daily-plan"
API_VERSION = 2
BASE_DIR = Path(__file__).parent
APP_DATA_FOLDER = "Daily Plan"


def resolve_data_dir(environment=None, frozen=None) -> Path:
    environment = os.environ if environment is None else environment
    configured = environment.get("DAILY_PLAN_DATA_DIR")
    if configured:
        return Path(configured).expanduser()
    frozen = bool(getattr(sys, "frozen", False)) if frozen is None else frozen
    if frozen:
        appdata = environment.get("APPDATA")
        return (Path(appdata) if appdata else Path.home() / "AppData" / "Roaming") / APP_DATA_FOLDER
    return BASE_DIR


def resolve_frontend_dir() -> Path:
    bundle_root = getattr(sys, "_MEIPASS", None)
    return Path(bundle_root) / "web" if bundle_root else BASE_DIR.parent


DATA_DIR = resolve_data_dir()
DB_PATH = Path(os.environ.get("DAILY_PLAN_DB_PATH", DATA_DIR / "data.db"))
FRONTEND_DIR = resolve_frontend_dir()


def read_app_version() -> str:
    try:
        package = json.loads((FRONTEND_DIR / "package.json").read_text(encoding="utf-8"))
        version = package.get("version")
        return version if isinstance(version, str) and version else "0.0.0"
    except (OSError, ValueError, TypeError):
        return "0.0.0"


APP_VERSION = read_app_version()

app = FastAPI(title="Daily Plan API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8000", "http://localhost:8000", "null"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


@contextmanager
def get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime | None = None) -> str:
    return (value or utc_now()).isoformat(timespec="milliseconds")


def parse_utc(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def json_load(raw: str | None, fallback: Any):
    try:
        return json.loads(raw) if raw is not None else fallback
    except (TypeError, json.JSONDecodeError):
        return fallback


def get_revision(conn: sqlite3.Connection, bucket_key: str) -> int:
    row = conn.execute(
        "SELECT revision FROM entity_revisions WHERE bucket_key=?", (bucket_key,)
    ).fetchone()
    return int(row["revision"]) if row else 0


def set_revision(conn: sqlite3.Connection, bucket_key: str, revision: int):
    conn.execute(
        "INSERT INTO entity_revisions (bucket_key, revision) VALUES (?, ?) "
        "ON CONFLICT(bucket_key) DO UPDATE SET revision=excluded.revision",
        (bucket_key, revision),
    )


def require_versioned_items(body: Any) -> tuple[list[Any], int]:
    if not isinstance(body, dict) or not isinstance(body.get("items"), list):
        raise HTTPException(428, "客户端版本过旧，请刷新页面后重试")
    expected = body.get("expectedRevision")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0:
        raise HTTPException(422, "expectedRevision 必须是非负整数")
    return body["items"], expected


def require_revision_value(value: Any, field_name: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise HTTPException(422, f"{field_name} 必须是非负整数")
    return value


def assert_revision(current: int, expected: int):
    if current != expected:
        raise HTTPException(
            409,
            detail={"message": "数据已在其他窗口更新，请刷新后重试", "currentRevision": current},
        )


def database_has_user_data(conn: sqlite3.Connection) -> bool:
    table_names = ("tasks", "workhard", "memos", "goal_memos", "study_sessions")
    if any(conn.execute(f"SELECT 1 FROM {table_name} LIMIT 1").fetchone() for table_name in table_names):
        return True
    goals_row = conn.execute("SELECT data FROM goals WHERE id=1").fetchone()
    goals = json_load(goals_row["data"], []) if goals_row else []
    if goals:
        return True
    timer_row = conn.execute("SELECT status FROM timer_state WHERE id=1").fetchone()
    return bool(timer_row and timer_row["status"] != "idle")


def init_db():
    with get_db() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS goals (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );
            INSERT OR IGNORE INTO goals (id, data) VALUES (1, '[]');
            CREATE TABLE IF NOT EXISTS workhard (date_key TEXT PRIMARY KEY);
            CREATE TABLE IF NOT EXISTS memos (
                date_key TEXT PRIMARY KEY,
                content TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS goal_memos (
                goal_id TEXT PRIMARY KEY,
                content TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS study_sessions (
                date_key TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS entity_revisions (
                bucket_key TEXT PRIMARY KEY,
                revision INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS timer_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                session_id TEXT,
                status TEXT NOT NULL DEFAULT 'idle',
                accumulated_seconds INTEGER NOT NULL DEFAULT 0,
                running_since_utc TEXT,
                checkpoint_elapsed INTEGER NOT NULL DEFAULT 0,
                checkpoint_at_utc TEXT,
                started_at_utc TEXT,
                target_kind TEXT,
                target_date TEXT,
                target_id TEXT,
                target_title TEXT
            );
            INSERT OR IGNORE INTO timer_state (id) VALUES (1);
            CREATE TABLE IF NOT EXISTS finished_timer_sessions (
                session_id TEXT PRIMARY KEY,
                response TEXT NOT NULL
            );
            """
        )
        conn.execute(
            "INSERT OR IGNORE INTO entity_revisions(bucket_key, revision) VALUES ('goals', 0)"
        )
        for row in conn.execute("SELECT date_key FROM tasks"):
            conn.execute(
                "INSERT OR IGNORE INTO entity_revisions(bucket_key, revision) VALUES (?, 0)",
                (f"tasks:{row['date_key']}",),
            )
        timer = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
        if timer and timer["status"] == "running":
            conn.execute(
                "UPDATE timer_state SET status='paused', accumulated_seconds=?, "
                "running_since_utc=NULL WHERE id=1",
                (int(timer["checkpoint_elapsed"] or timer["accumulated_seconds"] or 0),),
            )


init_db()


def timer_elapsed(row: sqlite3.Row, now: datetime | None = None) -> int:
    elapsed = int(row["accumulated_seconds"] or 0)
    if row["status"] == "running":
        running_since = parse_utc(row["running_since_utc"])
        if running_since:
            elapsed += max(0, int(((now or utc_now()) - running_since).total_seconds()))
    return elapsed


def timer_response(conn: sqlite3.Connection, checkpoint: bool = False) -> dict[str, Any]:
    now = utc_now()
    row = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
    elapsed = timer_elapsed(row, now)
    if checkpoint and row["status"] == "running" and elapsed - int(row["checkpoint_elapsed"] or 0) >= 5:
        conn.execute(
            "UPDATE timer_state SET checkpoint_elapsed=?, checkpoint_at_utc=? WHERE id=1",
            (elapsed, iso_utc(now)),
        )
    return {
        "sessionId": row["session_id"],
        "status": row["status"],
        "elapsedSeconds": elapsed,
        "serverNow": iso_utc(now),
        "startedAtUtc": row["started_at_utc"],
        "target": None if not row["target_kind"] else {
            "kind": row["target_kind"],
            "dateKey": row["target_date"],
            "id": row["target_id"],
            "title": row["target_title"],
        },
    }


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "appId": APP_ID,
        "appVersion": APP_VERSION,
        "apiVersion": API_VERSION,
    }


@app.get("/api/data")
def get_all_data():
    with get_db() as conn:
        task_rows = list(conn.execute("SELECT date_key, data FROM tasks"))
        tasks = {row["date_key"]: json_load(row["data"], []) for row in task_rows}
        goals_row = conn.execute("SELECT data FROM goals WHERE id=1").fetchone()
        workhard = {row["date_key"]: True for row in conn.execute("SELECT date_key FROM workhard")}
        memos = {row["date_key"]: row["content"] for row in conn.execute("SELECT date_key, content FROM memos")}
        goal_memos = {row["goal_id"]: row["content"] for row in conn.execute("SELECT goal_id, content FROM goal_memos")}
        sessions = {row["date_key"]: json_load(row["data"], []) for row in conn.execute("SELECT date_key, data FROM study_sessions")}
        task_revisions = {row["date_key"]: get_revision(conn, f"tasks:{row['date_key']}") for row in task_rows}
        return {
            "tasks": tasks,
            "goals": json_load(goals_row["data"], []) if goals_row else [],
            "workhard": workhard,
            "memos": memos,
            "goal_memos": goal_memos,
            "sessions": sessions,
            "revisions": {"tasks": task_revisions, "goals": get_revision(conn, "goals")},
            "timer": timer_response(conn, checkpoint=True),
        }


@app.put("/api/tasks/{date_key}")
def save_tasks(date_key: str, body: Any = Body(...)):
    items, expected = require_versioned_items(body)
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        key = f"tasks:{date_key}"
        current = get_revision(conn, key)
        assert_revision(current, expected)
        revision = current + 1
        conn.execute(
            "INSERT INTO tasks(date_key, data) VALUES (?, ?) "
            "ON CONFLICT(date_key) DO UPDATE SET data=excluded.data",
            (date_key, json.dumps(items, ensure_ascii=False)),
        )
        set_revision(conn, key, revision)
        return {"ok": True, "items": items, "revision": revision}


@app.put("/api/goals")
def save_goals(body: Any = Body(...)):
    items, expected = require_versioned_items(body)
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = get_revision(conn, "goals")
        assert_revision(current, expected)
        revision = current + 1
        conn.execute("UPDATE goals SET data=? WHERE id=1", (json.dumps(items, ensure_ascii=False),))
        set_revision(conn, "goals", revision)
        return {"ok": True, "items": items, "revision": revision}


@app.post("/api/tasks/carry-over")
def carry_over(body: dict = Body(...)):
    required = ("sourceDate", "targetDate", "sourceItems", "targetItems", "expectedSourceRevision", "expectedTargetRevision")
    if any(key not in body for key in required) or not isinstance(body["sourceItems"], list) or not isinstance(body["targetItems"], list):
        raise HTTPException(422, "延续请求格式不正确")
    if not body["sourceDate"] or not body["targetDate"] or body["sourceDate"] == body["targetDate"]:
        raise HTTPException(422, "延续的来源日期和目标日期必须不同")
    expected_source = require_revision_value(body["expectedSourceRevision"], "expectedSourceRevision")
    expected_target = require_revision_value(body["expectedTargetRevision"], "expectedTargetRevision")
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        source_key = f"tasks:{body['sourceDate']}"
        target_key = f"tasks:{body['targetDate']}"
        source_revision = get_revision(conn, source_key)
        target_revision = get_revision(conn, target_key)
        assert_revision(source_revision, expected_source)
        assert_revision(target_revision, expected_target)
        conn.execute(
            "INSERT INTO tasks(date_key, data) VALUES (?, ?) ON CONFLICT(date_key) DO UPDATE SET data=excluded.data",
            (body["sourceDate"], json.dumps(body["sourceItems"], ensure_ascii=False)),
        )
        conn.execute(
            "INSERT INTO tasks(date_key, data) VALUES (?, ?) ON CONFLICT(date_key) DO UPDATE SET data=excluded.data",
            (body["targetDate"], json.dumps(body["targetItems"], ensure_ascii=False)),
        )
        set_revision(conn, source_key, source_revision + 1)
        set_revision(conn, target_key, target_revision + 1)
        return {"ok": True, "sourceRevision": source_revision + 1, "targetRevision": target_revision + 1}


@app.put("/api/workhard/{date_key}")
def set_workhard(date_key: str, body: dict = Body(...)):
    with get_db() as conn:
        if bool(body.get("value", False)):
            conn.execute("INSERT OR IGNORE INTO workhard(date_key) VALUES (?)", (date_key,))
        else:
            conn.execute("DELETE FROM workhard WHERE date_key=?", (date_key,))
    return {"ok": True}


@app.put("/api/memo/{date_key}")
def save_memo(date_key: str, body: dict = Body(...)):
    content = str(body.get("content", "")).strip()
    with get_db() as conn:
        if content:
            conn.execute("INSERT INTO memos(date_key, content) VALUES (?, ?) ON CONFLICT(date_key) DO UPDATE SET content=excluded.content", (date_key, content))
        else:
            conn.execute("DELETE FROM memos WHERE date_key=?", (date_key,))
    return {"ok": True}


@app.put("/api/goal-memo/{goal_id}")
def save_goal_memo(goal_id: str, body: dict = Body(...)):
    content = str(body.get("content", "")).strip()
    with get_db() as conn:
        if content:
            conn.execute("INSERT INTO goal_memos(goal_id, content) VALUES (?, ?) ON CONFLICT(goal_id) DO UPDATE SET content=excluded.content", (goal_id, content))
        else:
            conn.execute("DELETE FROM goal_memos WHERE goal_id=?", (goal_id,))
    return {"ok": True}


@app.delete("/api/goal-memo/{goal_id}")
def delete_goal_memo(goal_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM goal_memos WHERE goal_id=?", (goal_id,))
    return {"ok": True}


@app.get("/api/timer")
def get_timer():
    with get_db() as conn:
        return timer_response(conn, checkpoint=True)


@app.post("/api/timer/start")
def start_timer(body: dict = Body(default={})):
    target = body.get("target") if isinstance(body.get("target"), dict) else None
    now = utc_now()
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        current = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
        if current["status"] != "idle":
            raise HTTPException(409, "已有正在进行或暂停的计时")
        session_id = str(uuid.uuid4())
        conn.execute(
            "UPDATE timer_state SET session_id=?, status='running', accumulated_seconds=0, running_since_utc=?, "
            "checkpoint_elapsed=0, checkpoint_at_utc=?, started_at_utc=?, target_kind=?, target_date=?, target_id=?, target_title=? WHERE id=1",
            (session_id, iso_utc(now), iso_utc(now), iso_utc(now),
             target.get("kind") if target else None, target.get("dateKey") if target else None,
             str(target.get("id")) if target and target.get("id") is not None else None,
             str(target.get("title", "")) if target else None),
        )
        return timer_response(conn)


def require_timer_session(row: sqlite3.Row, body: dict):
    session_id = body.get("sessionId")
    if not session_id or session_id != row["session_id"]:
        raise HTTPException(409, "计时状态已经变化，请刷新后重试")


@app.post("/api/timer/pause")
def pause_timer(body: dict = Body(...)):
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
        require_timer_session(row, body)
        if row["status"] != "running":
            raise HTTPException(409, "当前计时不是运行状态")
        elapsed = timer_elapsed(row)
        conn.execute(
            "UPDATE timer_state SET status='paused', accumulated_seconds=?, running_since_utc=NULL, checkpoint_elapsed=?, checkpoint_at_utc=? WHERE id=1",
            (elapsed, elapsed, iso_utc()),
        )
        return timer_response(conn)


@app.post("/api/timer/resume")
def resume_timer(body: dict = Body(...)):
    now = utc_now()
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
        require_timer_session(row, body)
        if row["status"] != "paused":
            raise HTTPException(409, "当前计时不是暂停状态")
        conn.execute("UPDATE timer_state SET status='running', running_since_utc=?, checkpoint_at_utc=? WHERE id=1", (iso_utc(now), iso_utc(now)))
        return timer_response(conn)


@app.post("/api/timer/finish")
def finish_timer(body: dict = Body(...)):
    session_id = body.get("sessionId")
    if not session_id:
        raise HTTPException(422, "缺少 sessionId")
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        finished = conn.execute("SELECT response FROM finished_timer_sessions WHERE session_id=?", (session_id,)).fetchone()
        if finished:
            response = json_load(finished["response"], {"ok": True})
            response["duplicate"] = True
            return response
        row = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
        require_timer_session(row, body)
        if row["status"] not in ("running", "paused"):
            raise HTTPException(409, "没有可结束的计时")
        elapsed = timer_elapsed(row)
        now = utc_now()
        started = parse_utc(row["started_at_utc"]) or now
        local_start, local_end = started.astimezone(), now.astimezone()
        date_key = local_start.strftime("%Y-%m-%d")
        session = {
            "id": session_id, "start": local_start.strftime("%H:%M"), "end": local_end.strftime("%H:%M"),
            "duration": elapsed, "startedAtUtc": iso_utc(started), "endedAtUtc": iso_utc(now),
            "targetKind": row["target_kind"], "targetDate": row["target_date"],
            "targetId": row["target_id"], "targetTitle": row["target_title"],
        }
        existing_row = conn.execute("SELECT data FROM study_sessions WHERE date_key=?", (date_key,)).fetchone()
        sessions = json_load(existing_row["data"], []) if existing_row else []
        if elapsed > 0:
            sessions.append(session)
            conn.execute("INSERT INTO study_sessions(date_key, data) VALUES (?, ?) ON CONFLICT(date_key) DO UPDATE SET data=excluded.data", (date_key, json.dumps(sessions, ensure_ascii=False)))
        reset_timer_state(conn)
        response = {"ok": True, "dateKey": date_key, "session": session if elapsed > 0 else None, "timer": timer_response(conn)}
        conn.execute("INSERT INTO finished_timer_sessions(session_id, response) VALUES (?, ?)", (session_id, json.dumps(response, ensure_ascii=False)))
        return response


def reset_timer_state(conn: sqlite3.Connection):
    conn.execute(
        "UPDATE timer_state SET session_id=NULL, status='idle', accumulated_seconds=0, running_since_utc=NULL, "
        "checkpoint_elapsed=0, checkpoint_at_utc=NULL, started_at_utc=NULL, target_kind=NULL, "
        "target_date=NULL, target_id=NULL, target_title=NULL WHERE id=1"
    )


@app.post("/api/timer/discard")
def discard_timer(body: dict = Body(...)):
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM timer_state WHERE id=1").fetchone()
        require_timer_session(row, body)
        reset_timer_state(conn)
        return timer_response(conn)


@app.delete("/api/sessions/{date_key}/{session_id}")
def delete_session(date_key: str, session_id: str):
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT data FROM study_sessions WHERE date_key=?", (date_key,)).fetchone()
        sessions = json_load(row["data"], []) if row else []
        updated = [item for item in sessions if str(item.get("id")) != session_id]
        if len(updated) == len(sessions):
            raise HTTPException(404, "计时记录不存在")
        if updated:
            conn.execute("UPDATE study_sessions SET data=? WHERE date_key=?", (json.dumps(updated, ensure_ascii=False), date_key))
        else:
            conn.execute("DELETE FROM study_sessions WHERE date_key=?", (date_key,))
        return {"ok": True}


@app.post("/api/migrate")
def migrate_from_localstorage(body: dict = Body(...)):
    tasks = body.get("tasks") if isinstance(body.get("tasks"), dict) else {}
    goals = body.get("goals") if isinstance(body.get("goals"), list) else []
    workhard = body.get("workhard") if isinstance(body.get("workhard"), dict) else {}
    memos = body.get("memos") if isinstance(body.get("memos"), dict) else {}
    goal_memos = body.get("goal_memos") if isinstance(body.get("goal_memos"), dict) else {}
    with get_db() as conn:
        conn.execute("BEGIN IMMEDIATE")
        if database_has_user_data(conn):
            raise HTTPException(409, "数据库已有数据，已取消本地缓存迁移")
        for date_key, task_list in tasks.items():
            if isinstance(task_list, list):
                conn.execute("INSERT OR REPLACE INTO tasks(date_key, data) VALUES (?, ?)", (date_key, json.dumps(task_list, ensure_ascii=False)))
                set_revision(conn, f"tasks:{date_key}", get_revision(conn, f"tasks:{date_key}") + 1)
        if goals:
            conn.execute("UPDATE goals SET data=? WHERE id=1", (json.dumps(goals, ensure_ascii=False),))
            set_revision(conn, "goals", get_revision(conn, "goals") + 1)
        for date_key, value in workhard.items():
            if value:
                conn.execute("INSERT OR IGNORE INTO workhard(date_key) VALUES (?)", (date_key,))
        for date_key, content in memos.items():
            if str(content).strip():
                conn.execute("INSERT OR REPLACE INTO memos(date_key, content) VALUES (?, ?)", (date_key, str(content)))
        for goal_id, content in goal_memos.items():
            if str(content).strip():
                conn.execute("INSERT OR REPLACE INTO goal_memos(goal_id, content) VALUES (?, ?)", (goal_id, str(content)))
    return {"ok": True}


@app.get("/", include_in_schema=False)
def frontend_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/app.js", include_in_schema=False)
def frontend_script():
    return FileResponse(FRONTEND_DIR / "app.js", media_type="text/javascript")


@app.get("/style.css", include_in_schema=False)
def frontend_stylesheet():
    return FileResponse(FRONTEND_DIR / "style.css", media_type="text/css")


@app.get("/favicon.ico", include_in_schema=False)
def frontend_icon():
    return FileResponse(FRONTEND_DIR / "favicon.ico", media_type="image/x-icon")


app.mount("/style", StaticFiles(directory=str(FRONTEND_DIR / "style")), name="styles")
