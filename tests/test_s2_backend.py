import importlib
import sqlite3
import sys
import time

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def api(tmp_path, monkeypatch):
    database = tmp_path / "daily-plan-test.db"
    monkeypatch.setenv("DAILY_PLAN_DB_PATH", str(database))
    sys.modules.pop("backend.main", None)
    module = importlib.import_module("backend.main")
    with TestClient(module.app) as client:
        yield client, module, database
    sys.modules.pop("backend.main", None)


def test_data_directory_controls_default_database(tmp_path, monkeypatch):
    data_dir = tmp_path / "desktop-data"
    monkeypatch.setenv("DAILY_PLAN_DATA_DIR", str(data_dir))
    monkeypatch.delenv("DAILY_PLAN_DB_PATH", raising=False)
    sys.modules.pop("backend.main", None)
    module = importlib.import_module("backend.main")
    try:
        assert module.DATA_DIR == data_dir
        assert module.DB_PATH == data_dir / "data.db"
        assert module.DB_PATH.is_file()
    finally:
        sys.modules.pop("backend.main", None)


def test_bucket_revision_rejects_stale_writer(api):
    client, _, _ = api
    initial = client.get("/api/data").json()
    revision = initial["revisions"]["tasks"].get("2026-09-10", 0)

    first = client.put(
        "/api/tasks/2026-09-10",
        json={"items": [{"id": "a", "text": "first"}], "expectedRevision": revision},
    )
    assert first.status_code == 200
    assert first.json()["revision"] == revision + 1

    stale = client.put(
        "/api/tasks/2026-09-10",
        json={"items": [{"id": "b", "text": "stale"}], "expectedRevision": revision},
    )
    assert stale.status_code == 409
    assert client.get("/api/data").json()["tasks"]["2026-09-10"][0]["id"] == "a"


def test_goals_revision_and_legacy_payload_validation(api):
    client, _, _ = api
    assert client.put("/api/tasks/2026-09-10", json=[]).status_code == 428
    assert client.put("/api/goals", json={"items": [], "expectedRevision": True}).status_code == 422

    saved = client.put(
        "/api/goals",
        json={"items": [{"id": "goal-a", "type": "todo", "text": "目标"}], "expectedRevision": 0},
    )
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1
    assert client.put("/api/goals", json={"items": [], "expectedRevision": 0}).status_code == 409


def test_carry_over_updates_both_days_in_one_transaction(api):
    client, _, _ = api
    source = [{"id": "done", "done": True}]
    target = [{"id": "carried", "done": False}]
    result = client.post(
        "/api/tasks/carry-over",
        json={
            "sourceDate": "2026-09-10",
            "targetDate": "2026-09-11",
            "sourceItems": source,
            "targetItems": target,
            "expectedSourceRevision": 0,
            "expectedTargetRevision": 0,
        },
    )
    assert result.status_code == 200
    data = client.get("/api/data").json()
    assert data["tasks"]["2026-09-10"] == source
    assert data["tasks"]["2026-09-11"] == target

    stale = client.post(
        "/api/tasks/carry-over",
        json={
            "sourceDate": "2026-09-10",
            "targetDate": "2026-09-11",
            "sourceItems": [],
            "targetItems": [],
            "expectedSourceRevision": 0,
            "expectedTargetRevision": 0,
        },
    )
    assert stale.status_code == 409
    unchanged = client.get("/api/data").json()
    assert unchanged["tasks"]["2026-09-10"] == source
    assert unchanged["tasks"]["2026-09-11"] == target


def test_carry_over_rejects_same_day_and_invalid_revisions(api):
    client, _, _ = api
    base = {
        "sourceDate": "2026-09-10",
        "targetDate": "2026-09-10",
        "sourceItems": [],
        "targetItems": [],
        "expectedSourceRevision": 0,
        "expectedTargetRevision": 0,
    }
    assert client.post("/api/tasks/carry-over", json=base).status_code == 422
    invalid = {**base, "targetDate": "2026-09-11", "expectedSourceRevision": True}
    assert client.post("/api/tasks/carry-over", json=invalid).status_code == 422
    assert client.get("/api/data").json()["tasks"] == {}


def test_timer_pause_resume_finish_and_duplicate_finish(api):
    client, _, _ = api
    started = client.post("/api/timer/start", json={}).json()
    session_id = started["sessionId"]
    time.sleep(1.05)

    paused = client.post("/api/timer/pause", json={"sessionId": session_id})
    assert paused.status_code == 200
    paused_seconds = paused.json()["elapsedSeconds"]
    assert paused_seconds >= 1
    time.sleep(0.15)
    assert client.get("/api/timer").json()["elapsedSeconds"] == paused_seconds

    resumed = client.post("/api/timer/resume", json={"sessionId": session_id})
    assert resumed.status_code == 200
    finished = client.post("/api/timer/finish", json={"sessionId": session_id})
    assert finished.status_code == 200
    finished_payload = finished.json()
    assert finished_payload["session"]["id"] == session_id
    assert finished_payload["session"]["duration"] >= 1
    assert finished_payload["session"]["start"]
    assert finished_payload["session"]["end"]
    assert finished_payload["timer"]["status"] == "idle"
    assert finished_payload["timer"]["serverNow"]

    duplicate = client.post("/api/timer/finish", json={"sessionId": session_id})
    assert duplicate.status_code == 200
    assert duplicate.json()["duplicate"] is True
    sessions = client.get("/api/data").json()["sessions"]
    matching = [item for day in sessions.values() for item in day if item["id"] == session_id]
    assert len(matching) == 1
    assert sessions[finished_payload["dateKey"]][-1]["id"] == session_id


def test_timer_discard_stops_without_daily_record(api):
    client, _, _ = api
    started = client.post("/api/timer/start", json={}).json()
    session_id = started["sessionId"]
    discarded = client.post("/api/timer/discard", json={"sessionId": session_id})

    assert discarded.status_code == 200
    assert discarded.json()["status"] == "idle"
    sessions = client.get("/api/data").json()["sessions"]
    assert all(item["id"] != session_id for day in sessions.values() for item in day)


def test_restart_recovers_running_timer_at_checkpoint(api):
    _, module, database = api
    with sqlite3.connect(database) as conn:
        conn.execute(
            "UPDATE timer_state SET session_id='recover-me', status='running', "
            "accumulated_seconds=2, checkpoint_elapsed=7, running_since_utc='2026-09-10T00:00:00+00:00' WHERE id=1"
        )
    module.init_db()
    with sqlite3.connect(database) as conn:
        status, accumulated = conn.execute(
            "SELECT status, accumulated_seconds FROM timer_state WHERE id=1"
        ).fetchone()
    assert status == "paused"
    assert accumulated == 7


def test_timer_target_conflicts_and_session_delete(api):
    client, _, _ = api
    target = {"kind": "task", "dateKey": "2026-09-10", "id": "task-a", "title": "专注任务"}
    started = client.post("/api/timer/start", json={"target": target})
    assert started.status_code == 200
    assert started.json()["target"] == target
    session_id = started.json()["sessionId"]
    assert client.post("/api/timer/start", json={}).status_code == 409
    assert client.post("/api/timer/pause", json={"sessionId": "wrong"}).status_code == 409

    time.sleep(1.05)
    finished = client.post("/api/timer/finish", json={"sessionId": session_id}).json()
    date_key = finished["dateKey"]
    assert client.delete(f"/api/sessions/{date_key}/{session_id}").status_code == 200
    assert client.delete(f"/api/sessions/{date_key}/{session_id}").status_code == 404


def test_auxiliary_data_endpoints(api):
    client, _, _ = api
    assert client.put("/api/workhard/2026-09-10", json={"value": True}).status_code == 200
    assert client.put("/api/memo/2026-09-10", json={"content": "  今日备忘  "}).status_code == 200
    assert client.put("/api/goal-memo/goal-a", json={"content": "目标备忘"}).status_code == 200
    data = client.get("/api/data").json()
    assert data["workhard"]["2026-09-10"] is True
    assert data["memos"]["2026-09-10"] == "今日备忘"
    assert data["goal_memos"]["goal-a"] == "目标备忘"

    assert client.put("/api/workhard/2026-09-10", json={"value": False}).status_code == 200
    assert client.put("/api/memo/2026-09-10", json={"content": ""}).status_code == 200
    assert client.delete("/api/goal-memo/goal-a").status_code == 200
    cleared = client.get("/api/data").json()
    assert cleared["workhard"] == {}
    assert cleared["memos"] == {}
    assert cleared["goal_memos"] == {}


def test_migration_only_runs_against_empty_database(api):
    client, _, _ = api
    payload = {
        "tasks": {"2026-09-10": [{"id": "migrated-task"}]},
        "goals": [{"id": "migrated-goal"}],
        "workhard": {"2026-09-10": True},
        "memos": {"2026-09-10": "memo"},
        "goal_memos": {"migrated-goal": "goal memo"},
    }
    assert client.post("/api/migrate", json=payload).status_code == 200
    data = client.get("/api/data").json()
    assert data["tasks"]["2026-09-10"][0]["id"] == "migrated-task"
    assert data["revisions"]["tasks"]["2026-09-10"] == 1
    assert data["revisions"]["goals"] == 1

    retry = client.post("/api/migrate", json={"tasks": {"2026-09-10": []}})
    assert retry.status_code == 409
    assert client.get("/api/data").json()["tasks"]["2026-09-10"][0]["id"] == "migrated-task"


def test_frontend_whitelist_and_cors(api):
    client, module, _ = api
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {
        "ok": True,
        "appId": "daily-plan",
        "appVersion": module.APP_VERSION,
        "apiVersion": 2,
    }
    assert client.get("/").status_code == 200
    assert client.get("/app.js").status_code == 200
    assert client.get("/style.css").status_code == 200
    assert client.get("/style/variables.css").status_code == 200
    assert client.get("/backend/data.db").status_code == 404
    assert client.get("/DESKTOP_IMPLEMENTATION_STAGES.md").status_code == 404

    preflight = client.options(
        "/api/data",
        headers={"Origin": "null", "Access-Control-Request-Method": "GET"},
    )
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "null"
