# Daily Plan 桌面版后端交接

> 更新时间：2026-09-11
> 当前接口版本：`2`
> 状态：S2 后端已完成审计、修复与自动测试，可供 S3/S4 前端直接接入。

## 1. 先读结论

- 后端入口为 `backend/main.py`，使用 FastAPI + SQLite。
- 默认地址为 `http://127.0.0.1:8000`，API 前缀为 `/api`。
- 网站、悬浮球和紧凑面板共享 `backend/data.db`。
- 任务按日期桶保存，目标保存为一个桶；两类写入都使用 revision 防止多窗口静默覆盖。
- 计时器状态由后端持久化，页面刷新不会清零。服务异常重启后，运行中的计时恢复为暂停，并保留最近检查点。
- `finish` 结束并写入原有每日学习记录，`discard` 放弃本次且不写记录。
- 前端公共请求封装在 `shared/api.js`。Electron 浮窗直接使用该模块；网站在 `app.js` 中有对应接入。
- 后端只公开网站所需的白名单静态文件，不允许通过 HTTP 读取数据库、源码或 Markdown 文档。

## 2. 启动与健康检查

开发启动：

```powershell
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

桌面快捷方式指向 `backend/start_silent.vbs`。可见命令行版本是 `backend/start.bat`。两个脚本都会验证：

```json
{"ok":true,"appId":"daily-plan","apiVersion":2}
```

健康接口：

```http
GET /api/health
```

不能只根据“8000 端口已占用”判断服务已经启动；必须同时确认 `appId` 和需要的 `apiVersion`。

当前电脑还存在一个与本项目无关的 `0.0.0.0:8000` 监听进程，其 `/api/health` 返回 404。Daily Plan 使用更具体的 `127.0.0.1:8000`。启动脚本已经按 `appId` 区分，后续不要删除这项检查。

## 3. 全量数据结构

```http
GET /api/data
```

返回结构：

```json
{
  "tasks": {
    "2026-09-11": [
      {
        "id": "task-id",
        "text": "任务标题",
        "done": false,
        "createdAt": 1789000000000,
        "priority": "medium",
        "tags": [],
        "delay_days": 0,
        "original_date": "2026-09-11",
        "subtasks": [],
        "startTime": null,
        "endTime": null
      }
    ]
  },
  "goals": [],
  "workhard": {"2026-09-11": true},
  "memos": {"2026-09-11": "文本"},
  "goal_memos": {"goal-id": "文本"},
  "sessions": {"2026-09-11": []},
  "revisions": {
    "tasks": {"2026-09-11": 3},
    "goals": 5
  },
  "timer": {
    "sessionId": null,
    "status": "idle",
    "elapsedSeconds": 0,
    "serverNow": "2026-09-11T04:00:00.000+00:00",
    "startedAtUtc": null,
    "target": null
  }
}
```

`GET /api/data` 在计时运行期间还负责每隔至少 5 秒更新一次恢复检查点。前端可以保持目前约 2 秒一次的轮询，不需要额外调用检查点接口。

## 4. 任务与目标接口

### 4.1 保存某天任务

```http
PUT /api/tasks/{dateKey}
Content-Type: application/json

{
  "items": [...完整任务数组...],
  "expectedRevision": 3
}
```

成功：

```json
{"ok":true,"items":[],"revision":4}
```

前端必须保存返回的 `revision`。不能继续发送旧版的裸数组请求。

### 4.2 保存目标与 Todo

```http
PUT /api/goals

{
  "items": [...完整目标数组...],
  "expectedRevision": 5
}
```

成功返回新的 `revision`，规则与任务桶相同。Goal 和 Todo 仍在同一个数组内，通过条目的 `type` 区分。

### 4.3 延续任务

```http
POST /api/tasks/carry-over

{
  "sourceDate": "2026-09-11",
  "targetDate": "2026-09-12",
  "sourceItems": [...来源日最终数组...],
  "targetItems": [...目标日最终数组...],
  "expectedSourceRevision": 3,
  "expectedTargetRevision": 1
}
```

成功：

```json
{"ok":true,"sourceRevision":4,"targetRevision":2}
```

两个日期在同一个 SQLite 事务内更新。任一 revision 不匹配时两边都不写入。来源日和目标日相同、缺字段或 revision 类型错误均返回 422。

### 4.4 Revision 冲突规则

- `409`：其他窗口已经写过同一个桶。响应 `detail.currentRevision` 可用于诊断。
- `428`：客户端仍发送旧版裸数组或缺少 `items`。
- `422`：revision 不是非负整数，或请求格式错误。
- 收到 409 后应重新获取 `/api/data`，保留用户正在输入的草稿，并让用户重新执行有歧义的修改。
- 不要对删除、改名、完成切换等操作盲目自动重放，否则可能覆盖另一窗口的变化。
- 同一窗口内对同一桶的写入应串行。网站现有 `bucketSaveQueues` 已实现该规则。

## 5. 计时器接口

计时状态只有一份，网站与浮窗不能各自维护独立会话。

### 5.1 获取状态

```http
GET /api/timer
```

`status` 只有 `idle`、`running`、`paused`。

### 5.2 开始

自由计时：

```http
POST /api/timer/start
{}
```

关联任务：

```http
POST /api/timer/start

{
  "target": {
    "kind": "task",
    "dateKey": "2026-09-11",
    "id": "task-id",
    "title": "任务标题"
  }
}
```

Todo 使用 `kind: "todo"`，`dateKey` 可为 `null`。`target` 是显示和记录元数据；后端不会自动修改任务完成状态。

已有运行或暂停会话时再次开始返回 409。

### 5.3 暂停与继续

```http
POST /api/timer/pause
{"sessionId":"当前会话 ID"}
```

```http
POST /api/timer/resume
{"sessionId":"当前会话 ID"}
```

必须使用当前 `sessionId`。过期 ID、重复暂停、重复继续或状态已由另一窗口改变时返回 409，前端随后重新读取 `/api/timer`。

### 5.4 结束并记录

```http
POST /api/timer/finish
{"sessionId":"当前会话 ID"}
```

返回：

```json
{
  "ok": true,
  "dateKey": "2026-09-11",
  "session": {
    "id": "会话 ID",
    "start": "12:10",
    "end": "12:42",
    "duration": 1920,
    "startedAtUtc": "...",
    "endedAtUtc": "...",
    "targetKind": "task",
    "targetDate": "2026-09-11",
    "targetId": "task-id",
    "targetTitle": "任务标题"
  },
  "timer": {
    "sessionId": null,
    "status": "idle",
    "elapsedSeconds": 0,
    "serverNow": "...",
    "startedAtUtc": null,
    "target": null
  }
}
```

同一个 `sessionId` 重复提交 `finish` 会返回第一次的结果并增加 `duplicate: true`，不会重复写学习记录。零秒会话不会写 `study_sessions`，此时 `session` 为 `null`。

记录沿用原网站需要的 `start`、`end`、`duration` 字段，因此原有日志、累计时间和热力图可以直接读取。跨午夜会话整体归入开始日期，目前不做跨日拆分。

### 5.5 放弃本次

```http
POST /api/timer/discard
{"sessionId":"当前会话 ID"}
```

计时回到 idle，不写每日记录。S3 前端应明确提供两个动作：

- “结束并记录” → `finish`
- “放弃本次” → `discard`

### 5.6 删除历史记录

```http
DELETE /api/sessions/{dateKey}/{sessionId}
```

删除成功返回 `{"ok":true}`；记录不存在返回 404。

### 5.7 显示计时的规则

- 后端的 `elapsedSeconds` 是权威校准值，但 UI 不应依赖轮询逐秒跳动。
- 收到 running 状态后，以本地单调时钟平滑显示；轮询同一 `sessionId` 时只允许向前校准，不能每两秒重置计时锚点。
- status 或 sessionId 改变时，立即采用后端状态。
- 网站 `applyTimerSnapshot` 和浮窗 `reconcileTimerAnchor` 已按此规则修复，不要在视觉重构时删掉。

## 6. 其他数据接口

| 方法 | 路径 | 请求体 | 行为 |
| --- | --- | --- | --- |
| PUT | `/api/workhard/{dateKey}` | `{"value":true}` | 设置或取消当日努力标记 |
| PUT | `/api/memo/{dateKey}` | `{"content":"文本"}` | 保存每日备忘；空文本删除 |
| PUT | `/api/goal-memo/{goalId}` | `{"content":"文本"}` | 保存目标备忘；空文本删除 |
| DELETE | `/api/goal-memo/{goalId}` | 无 | 删除目标备忘；重复删除仍成功 |
| POST | `/api/migrate` | 旧 localStorage 五类数据 | 仅数据库完全无用户数据时允许一次性迁移 |

迁移接口接受 `tasks`、`goals`、`workhard`、`memos`、`goal_memos`。数据库已有任务、目标、标记、备忘、学习记录或活动计时时返回 409，防止旧缓存覆盖现有数据。

## 7. 前端可直接使用的封装

`shared/api.js` 暴露只读对象 `window.DailyPlanApi`：

```text
getData()
getTimer()
saveTasks(dateKey, items, expectedRevision)
saveGoals(items, expectedRevision)
startTimer(target?)
pauseTimer(sessionId)
resumeTimer(sessionId)
finishTimer(sessionId)
discardTimer(sessionId)
```

从 `file://` 加载时基址为 `http://127.0.0.1:8000/api`；从网站加载时为同源 `/api`。

S3/S4 前端可修改：

- `floating/orb.html`
- `floating/orb.css`
- `floating/orb.js`
- `floating/panel.html`
- `floating/panel.css`
- `floating/panel.js`

需要新增后端动作时先扩展 `shared/api.js` 的明确方法，不要暴露通用 IPC、任意 URL 请求或 Node 能力。

## 8. 错误与同步状态

FastAPI 错误通常为：

```json
{"detail":"错误说明"}
```

Revision 冲突为：

```json
{
  "detail": {
    "message": "数据已在其他窗口更新，请刷新后重试",
    "currentRevision": 4
  }
}
```

前端建议只保留三种同步提示：保存中、已同步、保存失败/数据已变化。浮窗当前使用乐观更新：先立即更新 UI，后台成功后只保存新 revision，失败时才重新加载回滚。

## 9. 数据库与恢复语义

新增表：

- `entity_revisions`：任务日期桶和 goals 桶的版本号。
- `timer_state`：单例活动计时状态。
- `finished_timer_sessions`：按 sessionId 保存首次结束结果，实现结束去重。

沿用表：

- `tasks`
- `goals`
- `workhard`
- `memos`
- `goal_memos`
- `study_sessions`

正式数据库修改前的备份保存在 `backend/backups/`，该目录已加入 `.gitignore`。

恢复规则：运行时每隔至少 5 秒写检查点。服务重启发现 running 状态时恢复为 paused，累计时间取最近检查点，不计算服务停止期间的时间。用户手动继续后再恢复 running。

## 10. 静态文件与本地边界

后端只允许网页访问：

- `/`
- `/app.js`
- `/style.css`
- `/favicon.ico`
- `/style/*`
- FastAPI 自带 `/docs`、`/openapi.json`

例如 `/backend/data.db` 和 `/DESKTOP_IMPLEMENTATION_STAGES.md` 均返回 404。

CORS 仅允许 `http://127.0.0.1:8000`、`http://localhost:8000` 和 Electron `file://` 对应的 `null` origin。后端必须继续只绑定 `127.0.0.1`。

## 11. 验证结果

自动测试：

```powershell
python -m pytest tests\test_s2_backend.py -q
```

当前结果：`11 passed`。

覆盖范围：

- 任务和目标 revision 成功写入与陈旧写入拒绝。
- 旧版裸数组和非法 revision 拒绝。
- 两日期延续事务、陈旧事务回滚、同日延续拒绝。
- 计时开始、暂停、继续、结束、重复结束去重。
- 关联任务元数据、错误 sessionId 和并发开始拒绝。
- 放弃不产生每日记录，历史记录单条删除。
- 后端重启按检查点恢复为暂停。
- WorkHard、每日备忘、目标备忘的保存与删除。
- 首次迁移成功及数据库非空时拒绝重复迁移。
- 网站静态资源可访问，数据库和项目文档不可访问。
- Electron `null` origin 的 CORS 预检。

真实服务复验结果：

```text
health=true
apiVersion=2
timerStatus=paused
timerSeconds=52
root=200
style=200
privateFile=404
```

同时通过：`python -m py_compile backend/main.py`、网站/浮窗/Electron JavaScript 语法检查和 `git diff --check`。

## 12. 当前刻意保留的限制

- 个人本机应用，不提供账号、远程访问和多用户权限。
- 任务仍按整日数组保存，依靠 revision 防冲突；未拆成逐条数据库记录。
- 使用轮询，不使用 SSE、WebSocket、离线队列或 change log。
- 计时跨午夜不拆分到两天。
- 活动计时关联信息不会自动改变任务完成状态。
- `finished_timer_sessions` 暂不自动清理；个人使用数据量下无需增加维护任务。
- 自动启动后端、休眠暂停和退出清理属于 S5，不应由 S3/S4 前端重写。

以上限制符合当前个人轻量产品范围，不是前端优化的阻塞项。
