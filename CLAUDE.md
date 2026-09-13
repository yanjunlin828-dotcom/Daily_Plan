# Daily Plan — AI 开发指南

## 项目背景

本地化的每日规划 + 长期目标管理 Web 应用。无云依赖，数据存储于本地 SQLite。
设计风格：极简主义 + 终端美学（JetBrains Mono 字体，深色主题，呼吸动效）。

**运行方式**：后端 FastAPI 服务 `backend/` 启动后，通过浏览器访问 `http://localhost:8000`。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vanilla JS (ES6+)，无框架，无构建工具 |
| 样式 | 纯 CSS，CSS 自定义属性（变量），无预处理器 |
| 后端 | FastAPI + Uvicorn，Python 3.10+ |
| 数据库 | SQLite3（WAL 模式），通过 REST API 访问 |
| 部署 | Windows 本地，`.bat` / `.vbs` 启动脚本 |

---

## 文件结构

```
daily_plan/
├── index.html           # HTML 入口，约 230 行；定义双栏布局、所有 modal、输入区
├── app.js               # 全部前端逻辑，约 3000+ 行；状态管理、DOM操作、API通信
├── style.css            # CSS 入口（仅含 @import），不直接写样式
├── style/               # 样式子目录，按功能模块拆分
│   ├── variables.css    # :root 变量、全局 reset、body、.container
│   ├── header.css       # 日期行、进度条
│   ├── input.css        # 任务输入框、添加按钮、滚动区域
│   ├── tasks.css        # 任务列表、条目、编辑、优先级、时间、标签
│   ├── layout.css       # 双栏布局、备忘录按钮、导航、目标面板、响应式
│   ├── goals.css        # 目标类型样式、截止日期 badge、拖拽动效
│   ├── modals.css       # 备忘录弹窗（overlay/modal/textarea）
│   ├── calendar.css     # 日历弹窗、网格、月份导航
│   ├── timer.css        # 计时器浮动面板、SVG 环形、数字显示
│   ├── carry.css        # 任务延续按钮、飞走动画、delay badge
│   ├── workhard.css     # WorkHard 按钮、粒子、涟漪、日历格子
│   ├── notifications.css# Toast 通知（error / info）
│   ├── subtasks.css     # 子任务面板、条目、进度条、长按动效
│   ├── sync.css         # 同步状态呼吸灯
│   ├── date-picker.css  # 日期 chip、日期选择弹层
│   └── time-picker.css  # 时间拨盘浮层
├── favicon.ico          # 应用图标
├── README.md            # 中文文档（功能演示）
├── TIME_FEATURE_PLAN.md # 任务时间段功能的当前实现说明
└── backend/
    ├── main.py          # FastAPI 路由 + SQLite 操作
    ├── requirements.txt
    ├── data.db          # SQLite 数据库（自动创建）
    ├── start.bat        # Windows 启动脚本
    └── start_silent.vbs # 静默启动（桌面快捷方式用）
```

> **新增样式时**：在 `style/` 下创建新文件，在 `style.css` 末尾追加一行 `@import` 即可。不要直接在 `style.css` 里写样式。

### 关键模块（app.js 内部结构）

| 区域 | 职责 |
|------|------|
| `cache` 对象 | 全量内存数据：`tasks / workhard / memos / goalMemos / goals / sessions` |
| `state` 对象 | 当前 UI 状态：日期、当日任务、目标视图、标签、日历和备忘录上下文等 |
| `loadFromBackend()` | 启动时从 `/api/data` 批量加载，填充 `cache`；符合现有触发条件时迁移 localStorage |
| `saveXxx()` 系列 | 每次变更后调用对应 `/api/xxx` PUT 接口 |
| 渲染函数 | `renderTasks()` / `renderGoals()` / `renderCalendarGrid()` / `renderTimerLog()` |
| 初始化与事件绑定 | `init()` 调用各功能的 `initXxx()`；部分动态元素在渲染时绑定事件 |

---

## 数据模型

### Task（每日任务）
```javascript
{
  id:            string,   // generateId() 生成的时间戳 + 随机字符
  text:          string,
  done:          boolean,
  createdAt:     number,   // Date.now() 毫秒时间戳
  tags:          string[],
  priority:      'high' | 'medium' | 'low',
  delay_days:    number,   // 拖延天数（carry-over）
  original_date: string | null,
  subtasks:      [{ id, text, done }],
  startTime:     'HH:MM' | null,
  endTime:       'HH:MM' | null,
}
```

### StudySession（学习计时会话）
```javascript
{
  id:       string,   // crypto.randomUUID()
  start:    'HH:MM',
  end:      'HH:MM',
  duration: number,   // 实际累计秒数
}
```

计时器重置时，累计时间达到 60 秒才会生成会话；会话按开始日期归档。

### Goal（长期目标）
```javascript
{
  id:       string,   // generateId() 生成的时间戳 + 随机字符
  type:     'goal' | 'todo',
  text:     string,
  done:     boolean,
  createdAt: number,          // Date.now() 毫秒时间戳
  dueDate:  string | null,   // YYYY-MM-DD
  priority: 'high' | 'medium' | 'low',
  pinned:   boolean,
  tags:     string[],
}
```

目标数据没有独立的 `archived` 字段。Todo 完成后通过 `done: true` 进入“已完成”折叠分组；`goal` 类型当前不能通过点击切换完成状态。

### SQLite 表结构
```sql
tasks      (date_key TEXT PRIMARY KEY, data TEXT)   -- JSON数组
goals      (id INT PRIMARY KEY, data TEXT)           -- JSON数组
workhard   (date_key TEXT PRIMARY KEY)
memos      (date_key TEXT PRIMARY KEY, content TEXT)
goal_memos (goal_id TEXT PRIMARY KEY, content TEXT)
study_sessions (date_key TEXT PRIMARY KEY, data TEXT) -- JSON数组
```

---

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/data` | 启动时批量加载全量数据 |
| PUT  | `/api/tasks/{date_key}` | 保存某天任务列表 |
| PUT  | `/api/goals` | 保存所有目标 |
| PUT  | `/api/workhard/{date_key}` | 标记/取消 workhard |
| PUT  | `/api/memo/{date_key}` | 保存每日备忘 |
| PUT  | `/api/goal-memo/{goal_id}` | 保存目标备忘 |
| PUT  | `/api/sessions/{date_key}` | 保存或清空某天的学习计时会话 |
| DELETE | `/api/goal-memo/{goal_id}` | 删除目标备忘 |
| POST | `/api/migrate` | localStorage 数据迁移到 SQLite |

`/api/migrate` 当前只迁移任务、目标、WorkHard、每日备忘录和目标备忘录，不包含学习计时会话。前端仅在数据库为空且 localStorage 中至少存在任务、目标或 WorkHard 数据时触发迁移；仅有备忘录的数据不会触发迁移。

---

## 后续开发规范

以下条目是新增和修改代码时应遵循的目标，不表示现有代码已经全部满足。

### 视觉原则
- **极简主义**：克制用色，留白充足，无多余装饰
- **终端美学**：等宽字体（JetBrains Mono），边框用细线，圆角保守（≤6px）
- **深色主题**：背景 `#0d0d0d` / `#111`，主文字 `#e0e0e0`，强调色 `#4ade80`（绿）
- **动效节制**：transition ≤ 200ms，只在有意义的状态变化上加动效，禁止华丽但无用的动画

### 交互原则
- **即时反馈**：操作后立刻有视觉响应（不要等待 API 返回才更新 UI）
- **乐观更新**：先更新 UI，再异步保存；当前实现失败时提示并尝试写入 localStorage，不会自动回滚 UI
- **键盘友好**：所有核心操作支持键盘（Enter 确认，Escape 取消）
- **无障碍提示**：操作失败用 toast 提示，不用 alert

### 组件一致性
- 目标优先级当前色彩：`high → #e74c3c`（红）/ `medium → #f1c40f`（黄）/ `low → #2ecc71`（绿）
- 标签 chip 样式：`border-radius: 4px`，背景半透明，前缀 `#`
- 同步状态点：呼吸动效表示保存中，绿点表示已保存，红点表示失败

---

## 代码质量要求

### JavaScript
- **单一职责**：渲染函数不含业务逻辑，业务函数不直接操作 DOM
- **纯函数优先**：数据转换（排序/过滤/格式化）写成纯函数，便于测试
- **避免魔法值**：时间常量、颜色等提取为模块顶部 `const`
- **错误处理**：所有 `fetch` 调用必须有 `.catch`，API 错误展示 toast，不能静默失败
- **防抖**：输入类操作（search、memo 自动保存）加 debounce，建议 300ms

### CSS
- 使用 CSS 变量（`var(--color-xxx)`），颜色/间距不硬编码
- 媒体查询断点统一，移动端优先
- 动画使用 `transform` / `opacity`，避免触发重排

### Python（后端）
- FastAPI 路由尽量保持薄层；当前小型后端仍将路由与 SQLite 操作放在同一文件，尚未拆出 service 层
- SQLite 操作统一用参数化查询，防注入

---

## 开发注意事项

1. **app.js 已超 3000 行**：新功能优先拆分为独立函数并集中放到相关区域，不要随意追加到文件末尾
2. **style/ 目录**：每个功能对应一个 CSS 文件，修改某模块样式只需打开对应文件；`style.css` 仅作 @import 入口，不要在其中直接写任何样式规则
3. **无构建工具**：不能使用 `import/export`（除非整体迁移 ES modules），所有变量均为全局或闭包
4. **localStorage 作为降级**：任务、目标、WorkHard 和备忘录已支持降级；`sessions` 当前不支持。新增持久化数据时必须明确是否及如何兼容降级与迁移
5. **日期键格式**：统一使用 `YYYY-MM-DD` 字符串，不使用 Date 对象作为键
6. **ID 生成**：任务、目标和子任务沿用 `generateId()`；学习会话使用 `crypto.randomUUID()`。若要统一方案，需要同时考虑旧数据兼容

---

## 任务时间段功能状态

该功能已经实现，当前行为详见 `TIME_FEATURE_PLAN.md`：
- 未完成任务优先；同一完成状态内按 `startTime` 排序，无时间任务置底，再按 `createdAt` 排序
- 仅在浏览今天时自动高亮当前时间段内的未完成任务，每分钟刷新
- 每日任务不显示或使用优先级排序；目标面板继续保留优先级
- 时间编辑使用小时/分钟滚轮拨盘浮层，不是内联数字输入框
