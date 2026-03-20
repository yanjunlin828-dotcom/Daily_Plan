"""Daily Plan 后端 - FastAPI + SQLite 数据持久化服务"""

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Daily Plan API")

# 允许本地开发时跨域访问（前端直接用文件打开时）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).parent / "data.db"
FRONTEND_DIR = Path(__file__).parent.parent  # E:\Acoding\daily_plan


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        # WAL 模式：读写并发更安全，不会因读操作锁住写入
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS tasks (
                date_key TEXT PRIMARY KEY,
                data     TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS goals (
                id   INTEGER PRIMARY KEY CHECK (id = 1),
                data TEXT NOT NULL DEFAULT '[]'
            );
            INSERT OR IGNORE INTO goals (id, data) VALUES (1, '[]');
            CREATE TABLE IF NOT EXISTS workhard (
                date_key TEXT PRIMARY KEY
            );
            CREATE TABLE IF NOT EXISTS memos (
                date_key TEXT PRIMARY KEY,
                content  TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS goal_memos (
                goal_id TEXT PRIMARY KEY,
                content TEXT NOT NULL DEFAULT ''
            );
        """)


init_db()


# ── 全量读取（前端启动时一次性加载所有数据）─────────────────────

@app.get("/api/data")
def get_all_data():
    with get_db() as conn:
        tasks = {
            row["date_key"]: json.loads(row["data"])
            for row in conn.execute("SELECT date_key, data FROM tasks")
        }
        goals_row = conn.execute("SELECT data FROM goals WHERE id=1").fetchone()
        goals = json.loads(goals_row["data"]) if goals_row else []
        workhard = {
            row["date_key"]: True
            for row in conn.execute("SELECT date_key FROM workhard")
        }
        memos = {
            row["date_key"]: row["content"]
            for row in conn.execute("SELECT date_key, content FROM memos")
        }
        goal_memos = {
            row["goal_id"]: row["content"]
            for row in conn.execute("SELECT goal_id, content FROM goal_memos")
        }
    return {
        "tasks": tasks,
        "goals": goals,
        "workhard": workhard,
        "memos": memos,
        "goal_memos": goal_memos,
    }


# ── 任务 ────────────────────────────────────────────────────────

@app.put("/api/tasks/{date_key}")
def save_tasks(date_key: str, tasks: list[Any] = Body(...)):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO tasks (date_key, data) VALUES (?, ?)",
            (date_key, json.dumps(tasks, ensure_ascii=False)),
        )
    return {"ok": True}


# ── 长期目标 ────────────────────────────────────────────────────

@app.put("/api/goals")
def save_goals(goals: list[Any] = Body(...)):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO goals (id, data) VALUES (1, ?)",
            (json.dumps(goals, ensure_ascii=False),),
        )
    return {"ok": True}


# ── 努力标记 ────────────────────────────────────────────────────

@app.put("/api/workhard/{date_key}")
def set_workhard(date_key: str, body: dict = Body(...)):
    value = bool(body.get("value", False))
    with get_db() as conn:
        if value:
            conn.execute(
                "INSERT OR IGNORE INTO workhard (date_key) VALUES (?)", (date_key,)
            )
        else:
            conn.execute("DELETE FROM workhard WHERE date_key=?", (date_key,))
    return {"ok": True}


# ── 每日备忘录 ──────────────────────────────────────────────────

@app.put("/api/memo/{date_key}")
def save_memo(date_key: str, body: dict = Body(...)):
    content = str(body.get("content", "")).strip()
    with get_db() as conn:
        if content:
            conn.execute(
                "INSERT OR REPLACE INTO memos (date_key, content) VALUES (?, ?)",
                (date_key, content),
            )
        else:
            conn.execute("DELETE FROM memos WHERE date_key=?", (date_key,))
    return {"ok": True}


# ── 目标备忘录 ──────────────────────────────────────────────────

@app.put("/api/goal-memo/{goal_id}")
def save_goal_memo(goal_id: str, body: dict = Body(...)):
    content = str(body.get("content", "")).strip()
    with get_db() as conn:
        if content:
            conn.execute(
                "INSERT OR REPLACE INTO goal_memos (goal_id, content) VALUES (?, ?)",
                (goal_id, content),
            )
        else:
            conn.execute("DELETE FROM goal_memos WHERE goal_id=?", (goal_id,))
    return {"ok": True}


@app.delete("/api/goal-memo/{goal_id}")
def delete_goal_memo(goal_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM goal_memos WHERE goal_id=?", (goal_id,))
    return {"ok": True}


# ── localStorage 全量迁移接口 ────────────────────────────────────

@app.post("/api/migrate")
def migrate_from_localstorage(body: dict = Body(...)):
    """接受前端传来的 localStorage 全量数据，一次性导入数据库。"""
    tasks     = body.get("tasks")      if isinstance(body.get("tasks"),      dict) else {}
    goals     = body.get("goals")      if isinstance(body.get("goals"),      list) else []
    workhard  = body.get("workhard")   if isinstance(body.get("workhard"),   dict) else {}
    memos     = body.get("memos")      if isinstance(body.get("memos"),      dict) else {}
    goal_memos = body.get("goal_memos") if isinstance(body.get("goal_memos"), dict) else {}

    with get_db() as conn:
        for date_key, task_list in tasks.items():
            if isinstance(task_list, list):
                conn.execute(
                    "INSERT OR REPLACE INTO tasks (date_key, data) VALUES (?, ?)",
                    (date_key, json.dumps(task_list, ensure_ascii=False)),
                )
        if goals:
            conn.execute(
                "INSERT OR REPLACE INTO goals (id, data) VALUES (1, ?)",
                (json.dumps(goals, ensure_ascii=False),),
            )
        for date_key, val in workhard.items():
            if val:
                conn.execute(
                    "INSERT OR IGNORE INTO workhard (date_key) VALUES (?)", (date_key,)
                )
        for date_key, content in memos.items():
            if str(content).strip():
                conn.execute(
                    "INSERT OR REPLACE INTO memos (date_key, content) VALUES (?, ?)",
                    (date_key, str(content)),
                )
        for goal_id, content in goal_memos.items():
            if str(content).strip():
                conn.execute(
                    "INSERT OR REPLACE INTO goal_memos (goal_id, content) VALUES (?, ?)",
                    (goal_id, str(content)),
                )
    return {"ok": True}


# ── 静态文件托管（必须放在所有 API 路由之后）────────────────────
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")
