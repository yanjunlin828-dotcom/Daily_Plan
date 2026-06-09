# 任务时间功能改造计划

> 目标：去除今日计划事项的优先级显示，替换为可选的时间段功能，支持按时间排序和当前任务自动高光。

---

## 一、功能概述

| 项目 | 内容 |
|------|------|
| 移除 | 今日任务列表中的优先级按钮（`●` 色点）和优先级排序 |
| 新增 | 每个任务可选开启时间段（开始时间必填，结束时间可选） |
| 排序 | 有时间的任务按开始时间升序，无时间的任务排在末尾 |
| 高光 | 自动检测当前时间所在任务，每分钟刷新一次 |
| 高光样式 | 左侧绿色边框 + 背景微亮 |

---

## 二、数据模型变更

### 任务对象新增字段

```js
{
  // 原有字段保留不变...
  id, text, done, createdAt, tags, delay_days, original_date, subtasks,

  // priority 字段仍保留在数据中（goals 面板还在用），但不在任务列表渲染
  priority: 'medium',   // 不再在今日列表展示，保留数据兼容性

  // 新增字段
  startTime: '09:00',   // string | null，格式 'HH:MM'，null 表示未设置
  endTime:   '10:30',   // string | null，可选，null 表示开放结束
}
```

**无需修改后端**：`startTime` / `endTime` 作为任务 JSON 数组的属性字段，随现有的 `tasks` 表一起存储，后端透传，不需要新增 SQLite 列。

---

## 三、UI 交互设计

### 3.1 时间开关图标

- 位置：取代原优先级按钮（任务行右侧，`×` 删除按钮左边）
- 形态：
  - 未开启：`🕐` 灰色时钟图标（半透明，`opacity: 0.4`）
  - 已开启：显示时间字符串 `09:00–10:30`，或 `09:00–` （无结束时间时）
- 点击图标：展开/收起时间输入区（toggles `.time-panel`）

### 3.2 时间输入区（内联展开）

点击时钟图标后，在任务卡片内部展开一行：

```
[09] : [00]   ─   [10] : [30]   [清除]
  ↑ 小时  ↑ 分钟     ↑ 可留空
```

- 四个独立的数字输入框：小时（0–23）、分钟（0–59），开始和结束各一组
- 结束时间整组可留空（点"清除"或不填）
- **滚轮输入**：鼠标悬停在任意数字框上，滚轮向上 +1，向下 -1，循环进位
- **直接输入**：点击数字框直接键入数字，输入满2位自动跳到下一格
- **确认**：失焦或按 Enter 保存，立即更新任务数据并重排序

### 3.3 时间显示（已设置状态）

任务行中，时钟图标位置替换为时间文本 chip：

```
[ 09:00 – 10:30 ]   或   [ 09:00 – ]
```

样式：小字号，灰色背景 pill，点击展开编辑。

---

## 四、排序逻辑（替换原优先级排序）

```js
function taskSortKey(task) {
  if (!task.startTime) return Infinity;          // 无时间排末尾
  const [h, m] = task.startTime.split(':').map(Number);
  return h * 60 + m;                             // 转为分钟数比较
}

// renderTasks() 中替换原 PRIORITY_ORDER 排序：
const visibleTasks = [...getVisibleTasks()].sort((a, b) => {
  if (a.done !== b.done) return a.done ? 1 : -1; // 完成的沉底
  return taskSortKey(a) - taskSortKey(b);         // 按时间升序
});
```

---

## 五、当前任务高光

### 5.1 判断逻辑

```js
function getCurrentTaskId(tasks, now) {
  const nowMins = now.getHours() * 60 + now.getMinutes();

  for (const task of tasks) {
    if (!task.startTime || task.done) continue;

    const start = timeToMins(task.startTime);
    const end   = task.endTime ? timeToMins(task.endTime) : null;

    if (end !== null) {
      if (nowMins >= start && nowMins < end) return task.id;
    } else {
      // 无结束时间：高光持续到下一个有 startTime 任务开始
      const nextStart = getNextTaskStart(tasks, start);
      const effectiveEnd = nextStart ?? start + 60;  // fallback +60分钟
      if (nowMins >= start && nowMins < effectiveEnd) return task.id;
    }
  }
  return null;
}
```

### 5.2 刷新机制

```js
// 每分钟刷新一次高光状态（不重渲染整个列表，只更新 CSS 类）
function refreshTimeHighlight() {
  const activeId = getCurrentTaskId(getTodayTasks(), new Date());
  document.querySelectorAll('.task-item').forEach(el => {
    const isActive = el.dataset.taskId === activeId;
    el.classList.toggle('task-time-active', isActive);
  });
}

// 在 init() 中启动：
refreshTimeHighlight();
setInterval(refreshTimeHighlight, 60 * 1000);
// 同时在整点时对齐（可选，避免误差累积）
```

### 5.3 高光样式

```css
.task-item.task-time-active {
  border-left: 3px solid var(--accent);        /* 绿色左边框 */
  background-color: #1f2a1f;                   /* 背景微绿亮 */
  box-shadow: inset 3px 0 8px rgba(0, 255, 136, 0.06);
}
```

---

## 六、涉及修改的文件与代码位置

| 文件 | 修改位置 | 内容 |
|------|----------|------|
| `app.js` | L4–8 | 删除 `PRIORITY_LABELS` / `PRIORITY_COLORS` / `PRIORITY_ORDER`（goals 部分仍需保留） |
| `app.js` | L211–221 `buildPriorityBtn()` | 替换为 `buildTimeBtn(task, onChange)` |
| `app.js` | L275 任务创建 | 新增 `startTime: null, endTime: null` 默认字段 |
| `app.js` | L348–454 `renderTasks()` | 排序逻辑替换；任务 HTML 中移除优先级按钮，加入时间 btn |
| `app.js` | L1856–1887 子任务进度条 | 进度条颜色从 `PRIORITY_COLORS[task.priority]` 改为 `var(--accent)` 固定颜色 |
| `app.js` | `init()` 末尾 | 添加 `refreshTimeHighlight()` + `setInterval` |
| `app.js` | 新增函数 | `buildTimeBtn()` / `timeToMins()` / `getCurrentTaskId()` / `getNextTaskStart()` / `refreshTimeHighlight()` |
| `style.css` | L330–347 `.priority-btn` | 替换为 `.time-toggle-btn` 样式 |
| `style.css` | 新增 | `.time-panel`（展开区）/ `.time-input-group`（数字框组）/ `.task-time-active`（高光） |
| `index.html` | 无需修改 | 任务 HTML 由 JS 动态生成 |

---

## 七、Goals 面板（左栏）的处理

左栏「长期目标 / Todo」依然保留优先级显示和排序，**无需修改**。

唯一需注意：`PRIORITY_COLORS` 常量在子任务进度条中也被用到（`app.js L1856`），移除后改为固定颜色 `var(--accent)`。Goals 面板的 `PRIORITY_COLORS` 使用可保留该常量，或在 Goals 渲染函数中单独内联颜色。

---

## 八、实施步骤顺序

```
Step 1  数据模型：任务创建时加入 startTime/endTime 默认字段
Step 2  移除优先级：renderTasks() 中删除 priority btn 和 PRIORITY_ORDER 排序
Step 3  子任务进度条颜色：改为固定 var(--accent)
Step 4  新增时间排序：taskSortKey() + 替换 renderTasks 排序逻辑
Step 5  buildTimeBtn()：时钟图标 + 时间 chip 显示
Step 6  时间输入面板：.time-panel 展开 UI，数字框 + 滚轮事件
Step 7  数据保存：输入确认后更新 cache，apiPut()，触发 renderTasks()
Step 8  高光机制：refreshTimeHighlight() + setInterval
Step 9  CSS：.time-toggle-btn / .time-panel / .time-input-group / .task-time-active
Step 10 测试：边界情况（跨零点、无时间任务、全天无时间等）
```

---

## 九、边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 所有任务均无时间 | 维持原始创建顺序（按 createdAt 排序） |
| 多个任务时间重叠 | 高光第一个匹配的任务（按数组顺序） |
| 时间跨零点（如 23:00–01:00） | 暂不支持，结束时间须大于开始时间，输入时校验 |
| 已完成的任务 | 不参与高光判断，排序沉底 |
| 任务被拖拽（如未来有拖拽功能）| 手动调整时间后，时间字段以手动为准，不自动覆盖 |

---

## 十、不涉及的范围（本次不动）

- 后端 `main.py`：无需修改
- Goals 面板（左栏）：优先级功能保持不变
- 子任务面板（subtask overlay）：不新增时间字段
- 备忘录 / 日历 / 工作模式等其他功能
