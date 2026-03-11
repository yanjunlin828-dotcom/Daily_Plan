# 日历功能设计与实现方案

## 一、功能概览

在现有每日规划页面的导航栏新增一个 **日历入口按钮**，点击后以模态弹窗形式展示当月日历。
日历具备月份切换、状态标注、日期跳转、双击开备忘录、快捷回今日等交互能力。

---

## 二、视觉设计（符合现有终端黑客风格）

### 2.1 日历按钮（入口）

位置：导航栏 `.nav-section`，夹在「← 昨天」和「// memo」之间，或置于 memo 按钮左侧。

```
← 昨天    [cal]    // memo    明天 →
```

- 样式与 `.memo-btn` 一致：透明背景、暗色边框、hover 变绿
- 文字：`// cal` 或 `▦` 日历图标文字
- 当前月内有「全部完成日」时按钮轻微脉冲提示

### 2.2 日历弹窗（模态）

复用现有 `.memo-overlay` 的遮罩 + 模态卡片模式，保持统一动画体系。

```
┌─────────────────────────────────────────┐
│ >  // calendar          [今日]           │
│ ─────────────────────────────────────── │
│  ← 2026-03 →                            │
│  日  一  二  三  四  五  六              │
│  ·   ·   ·   1   2   3   4             │
│  5   6   7   8   9  10  11             │
│ 12 [13] 14  15★  16  17  18·           │
│ 19  20  21  22  23  24  25             │
│ 26  27  28  29  30  31                 │
└─────────────────────────────────────────┘
```

- **绿色边框高亮**：当天日期（today）
- **浅绿背景/选中态**：当前正在查看的 dateKey 对应日期
- **★ 角标**：当天所有任务已完成（且至少有1个任务）
- **· 小圆点**：当天有备忘录内容（不影响日期数字的可读性，右下角极小圆点）
- **月份导航**：`←` `→` 切换上/下月，中间显示 `YYYY-MM`
- **今日按钮**：弹窗右上角快捷回到当前月 + 跳转到今日

---

## 三、交互设计

| 动作 | 效果 |
|------|------|
| 单击日期 | 关闭日历 → 导航到该日任务页 |
| 双击日期 | 关闭日历 → 导航到该日 → 打开当日备忘录 |
| 点击「今日」按钮 | 切换到今日所在月份 + 立即跳转到今日（不关闭日历，仅滚动到今日） |
| 点击 ← / → | 切换上/下月，实时刷新状态标注 |
| 点击遮罩 / 按 Esc | 关闭日历，不改变当前日期 |

### 动画规格

- **打开**：遮罩 `overlayIn`（0.22s）+ 卡片 `modalIn`（0.28s，弹簧 cubic-bezier）— 复用现有 keyframes
- **关闭**：`overlayOut` + `modalOut`（0.2s）— 复用现有 keyframes
- **月份切换**：日历网格区做一个轻微 `fadeSlide` 动画（旧月淡出，新月淡入，方向感知左/右）
- **日期 hover**：border 变绿色 + 轻微 scale(1.05)，0.15s
- **状态标注动画**：★ 标记有微弱 `glow`

---

## 四、数据读取策略

日历需要读取**当前显示月份**所有日期的任务和备忘录状态，要求高效无重复 IO。

### 每次渲染月份时，一次性加载：

```javascript
// 读取全量任务数据（已有函数，直接复用）
const allTasks = loadAllData();         // { 'YYYY-MM-DD': [tasks] }

// 读取全量备忘录数据（新增辅助函数）
const allMemos = loadAllMemos();        // { 'YYYY-MM-DD': text }

// 对月份内每天调用：
function getDateStats(dateKey, allTasks, allMemos) {
  const tasks = allTasks[dateKey] || [];
  const hasTasks = tasks.length > 0;
  const allDone = hasTasks && tasks.every(t => t.done);
  const hasMemo = !!(allMemos[dateKey] && allMemos[dateKey].trim());
  return { allDone, hasMemo };
}
```

新增 `loadAllMemos()` 函数（与现有 `loadAllData()` 模式一致）。

---

## 五、文件改动清单

### 5.1 `index.html`

**改动 1：** 导航栏新增日历按钮

```html
<nav class="nav-section">
  <button id="prev-btn" class="nav-btn">← 昨天</button>
  <div class="nav-center-btns">
    <button id="cal-btn" class="cal-btn" title="日历">▦ cal</button>
    <button id="memo-btn" class="memo-btn" title="当日备忘录">// memo</button>
  </div>
  <button id="next-btn" class="nav-btn">明天 →</button>
</nav>
```

**改动 2：** 新增日历模态 HTML（置于 memo 模态之后）

```html
<div id="cal-overlay" class="memo-overlay hidden" aria-hidden="true">
  <div id="cal-modal" class="cal-modal" role="dialog" aria-modal="true">

    <!-- 头部 -->
    <div class="cal-modal-header">
      <span class="memo-modal-prompt">&gt;</span>
      <span class="cal-modal-title">// calendar</span>
      <button id="cal-today-btn" class="cal-today-btn">今日</button>
    </div>

    <div class="memo-modal-divider"></div>

    <!-- 月份导航 -->
    <div class="cal-month-nav">
      <button id="cal-prev-month" class="cal-nav-arrow">←</button>
      <span id="cal-month-label" class="cal-month-label">2026-03</span>
      <button id="cal-next-month" class="cal-nav-arrow">→</button>
    </div>

    <!-- 星期标题行 -->
    <div class="cal-weekday-row">
      <span>日</span><span>一</span><span>二</span>
      <span>三</span><span>四</span><span>五</span><span>六</span>
    </div>

    <!-- 日期网格（JS 动态生成） -->
    <div id="cal-grid" class="cal-grid"></div>

    <!-- 底部提示 -->
    <div class="memo-modal-divider"></div>
    <div class="cal-modal-footer">
      <span class="cal-legend">
        <span class="cal-legend-star">★</span> 全部完成
        <span class="cal-legend-dot"></span> 有备忘
      </span>
      <span class="cal-hint">单击跳转 · 双击开备忘录</span>
    </div>

  </div>
</div>
```

---

### 5.2 `style.css`

**新增样式模块：日历弹窗**

```css
/* ── 日历按钮 ───────────────────────────────────────────── */
.cal-btn { /* 与 .memo-btn 完全一致，可直接复用类或单独定义 */ }

/* 导航栏中间按钮组 */
.nav-center-btns {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* ── 日历模态卡片 ────────────────────────────────────────── */
.cal-modal {
  width: 100%;
  max-width: 480px;           /* 比备忘录窄，紧凑感 */
  background: #141414;
  border: 1px solid var(--accent-dim);
  border-radius: 12px;
  box-shadow: 0 0 0 1px #00ff8810, 0 24px 64px rgba(0,0,0,0.7);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalIn 0.28s cubic-bezier(0.34, 1.36, 0.64, 1) forwards;
}
.memo-overlay.closing .cal-modal {
  animation: modalOut 0.2s ease forwards;
}

/* 头部 */
.cal-modal-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 24px 16px;
}
.cal-modal-title {
  color: var(--accent);
  font-size: 16px;
  letter-spacing: 0.06em;
  flex: 1;
}
.cal-today-btn {
  background: transparent;
  border: 1px solid #333;
  color: #666;
  font-family: inherit;
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s;
}
.cal-today-btn:hover {
  color: var(--accent);
  border-color: var(--accent-dim);
}

/* 月份导航 */
.cal-month-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
}
.cal-nav-arrow {
  background: transparent;
  border: none;
  color: #555;
  font-size: 18px;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 4px;
  transition: color 0.15s;
  font-family: inherit;
}
.cal-nav-arrow:hover { color: var(--accent); }
.cal-month-label {
  font-size: 15px;
  color: #ccc;
  letter-spacing: 0.08em;
}

/* 星期标题 */
.cal-weekday-row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0 16px 6px;
  text-align: center;
}
.cal-weekday-row span {
  font-size: 12px;
  color: #444;
  letter-spacing: 0.05em;
}
.cal-weekday-row span:first-child,
.cal-weekday-row span:last-child {
  color: #3a3a3a;   /* 周末颜色更暗 */
}

/* 日期网格 */
.cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
  padding: 0 16px 16px;
}

/* 日期单元格 */
.cal-day {
  position: relative;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: #888;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s, transform 0.15s;
  user-select: none;
}

/* 空格（月初填充）*/
.cal-day.empty {
  cursor: default;
  pointer-events: none;
}

/* Hover */
.cal-day:not(.empty):hover {
  color: var(--accent);
  border-color: var(--accent-dim);
  background-color: var(--accent-bg);
  transform: scale(1.06);
}

/* 今日 */
.cal-day.today {
  color: var(--accent);
  border-color: var(--accent-dim);
  font-weight: bold;
}

/* 当前查看日期（selected） */
.cal-day.selected {
  background-color: var(--accent-bg);
  color: var(--accent);
  border-color: var(--accent-mid);
}

/* 今日 + selected 同时存在 */
.cal-day.today.selected {
  border-color: var(--accent);
  box-shadow: 0 0 8px var(--accent-dim);
}

/* 其他月份溢出日（灰显） */
.cal-day.other-month {
  color: #2a2a2a;
  pointer-events: none;
}

/* 全部完成标记 ★ */
.cal-day-star {
  position: absolute;
  top: 2px;
  right: 3px;
  font-size: 8px;
  color: var(--accent);
  line-height: 1;
  animation: calStarGlow 2s ease-in-out infinite;
  pointer-events: none;
}
@keyframes calStarGlow {
  0%, 100% { opacity: 0.7; }
  50%       { opacity: 1; text-shadow: 0 0 6px var(--accent); }
}

/* 有备忘录的小点 */
.cal-day-dot {
  position: absolute;
  bottom: 3px;
  right: 4px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #555;
  pointer-events: none;
}

/* 日历底部 */
.cal-modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px 18px;
  font-size: 12px;
}
.cal-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #444;
}
.cal-legend-star { color: var(--accent); font-size: 10px; }
.cal-legend-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #555;
  display: inline-block;
  margin-left: 4px;
}
.cal-hint { color: #333; font-size: 11px; letter-spacing: 0.03em; }

/* 月份切换滑动动画 */
@keyframes calGridSlideLeft {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes calGridSlideRight {
  from { opacity: 0; transform: translateX(-20px); }
  to   { opacity: 1; transform: translateX(0); }
}
.cal-grid.slide-left  { animation: calGridSlideLeft  0.2s ease; }
.cal-grid.slide-right { animation: calGridSlideRight 0.2s ease; }
```

---

### 5.3 `app.js`

**新增常量与状态：**

```javascript
// state 对象增加：
calYear: new Date().getFullYear(),
calMonth: new Date().getMonth(),  // 0-indexed
```

**新增核心函数：**

```javascript
// 读取全量备忘录（用于日历渲染，避免反复读取 localStorage）
function loadAllMemos() {
  try { return JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

// 获取某日期的统计状态
function getDateStats(dateKey, allTasks, allMemos) {
  const tasks = allTasks[dateKey] || [];
  return {
    allDone: tasks.length > 0 && tasks.every(t => t.done),
    hasMemo: !!(allMemos[dateKey]?.trim()),
  };
}

// 渲染日历网格
function renderCalendarGrid(direction = null) {
  const grid = document.getElementById('cal-grid');
  const label = document.getElementById('cal-month-label');
  const { calYear: y, calMonth: m } = state;

  // 更新月份标签
  label.textContent = `${y}-${String(m + 1).padStart(2, '0')}`;

  // 一次性读取全量数据
  const allTasks = loadAllData();
  const allMemos = loadAllMemos();
  const todayKey = getTodayKey();

  // 计算本月第一天是周几
  const firstDay = new Date(y, m, 1).getDay();   // 0=周日
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // 清除旧内容
  grid.innerHTML = '';
  if (direction) {
    grid.classList.remove('slide-left', 'slide-right');
    void grid.offsetWidth; // reflow
    grid.classList.add(direction === 1 ? 'slide-left' : 'slide-right');
  }

  // 填充空格
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  // 填充日期
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const stats = getDateStats(dateKey, allTasks, allMemos);

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.dataset.dateKey = dateKey;

    const num = document.createElement('span');
    num.textContent = d;
    cell.appendChild(num);

    if (dateKey === todayKey) cell.classList.add('today');
    if (dateKey === state.dateKey) cell.classList.add('selected');

    if (stats.allDone) {
      const star = document.createElement('span');
      star.className = 'cal-day-star';
      star.textContent = '★';
      cell.appendChild(star);
    }

    if (stats.hasMemo) {
      const dot = document.createElement('div');
      dot.className = 'cal-day-dot';
      cell.appendChild(dot);
    }

    let click_timer = null;

    // 单击：跳转到该日期并关闭日历
    cell.addEventListener('click', () => {
      clearTimeout(click_timer);
      click_timer = setTimeout(() => {
        jumpToDate(dateKey);
        closeCalendar();
      }, 180);
    });

    // 双击：跳转到该日期并打开备忘录
    cell.addEventListener('dblclick', () => {
      clearTimeout(click_timer);
      jumpToDate(dateKey);
      closeCalendar();
      // 延迟确保 closeCalendar 动画结束后再开备忘录
      setTimeout(() => openMemo({ type: 'daily' }), 250);
    });

    grid.appendChild(cell);
  }
}

// 跳转到指定日期（更新 state 但不重新打开日历）
function jumpToDate(dateKey) {
  state.dateKey = dateKey;
  state.tasks = loadTasks(dateKey);
  state.activeTag = null;
  document.getElementById('date-display').textContent = formatDateDisplay(dateKey);
  renderTasks();
  updateMemoBtnState();
}

// 打开日历
function openCalendar() {
  // 同步日历状态到当前查看日期所在月
  const [y, m] = state.dateKey.split('-').map(Number);
  state.calYear = y;
  state.calMonth = m - 1;

  const overlay = document.getElementById('cal-overlay');
  overlay.classList.remove('hidden', 'closing');
  overlay.setAttribute('aria-hidden', 'false');
  renderCalendarGrid();
}

// 关闭日历
function closeCalendar() {
  const overlay = document.getElementById('cal-overlay');
  overlay.classList.add('closing');
  overlay.addEventListener('animationend', e => {
    if (e.target !== overlay) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    overlay.setAttribute('aria-hidden', 'true');
  }, { once: true });
}

// 月份切换
function changeCalMonth(direction) {  // +1 下月, -1 上月
  state.calMonth += direction;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0)  { state.calMonth = 11; state.calYear--; }
  renderCalendarGrid(direction);
}

// 初始化日历
function initCalendar() {
  const overlay = document.getElementById('cal-overlay');

  document.getElementById('cal-btn').addEventListener('click', openCalendar);

  document.getElementById('cal-prev-month').addEventListener('click', () => changeCalMonth(-1));
  document.getElementById('cal-next-month').addEventListener('click', () => changeCalMonth(1));

  // 今日按钮：切换到今日所在月 + 跳转
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    const today = getTodayKey();
    const [y, m] = today.split('-').map(Number);
    state.calYear = y;
    state.calMonth = m - 1;
    jumpToDate(today);
    renderCalendarGrid();
  });

  // 点击遮罩关闭
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeCalendar();
  });

  // Esc 关闭（与 memo 共用，需判断哪个弹窗在前台）
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeCalendar();
  });
}
```

**修改 `init()` 函数，追加调用 `initCalendar()`：**

```javascript
function init() {
  // ...现有代码...
  initGoalPanelToggle();
  initMemo();
  initCalendar();   // 新增
}
```

---

## 六、实现细节补充

### 6.1 Esc 键冲突处理

当前 memo 模态也用 Esc 关闭。日历增加后需要保证两者不互相干扰——直接检查各自的 overlay 是否 hidden 即可（各自独立判断）。

### 6.2 日历自动刷新时机

以下场景需要刷新日历中的状态标注：
- 任务增删改时（`renderTasks()` 内部不会刷新日历）
- 任务完成状态切换时
- 备忘录内容改变时

由于日历弹窗是按需打开时重新渲染的（`openCalendar()` 调用 `renderCalendarGrid()`），**不需要实时刷新**——用户每次打开都能看到最新状态。

### 6.3 「今日」按钮的精确行为

- 仅切换日历视图到当月，**并在主页也跳转到今日**（避免用户困惑）
- 不关闭日历弹窗，让用户在日历中确认今日位置

### 6.4 双击与单击防冲突

日期单元格上使用 180ms 延时 + `clearTimeout` 的标准双击检测方案（与现有任务/目标项的方案一致）。

---

## 七、实现顺序（建议）

1. **HTML** - 添加日历按钮 + 日历模态骨架（约 5 分钟）
2. **CSS** - 日历弹窗全部样式（约 15 分钟）
3. **JS** - 数据层函数：`loadAllMemos`、`getDateStats`（约 5 分钟）
4. **JS** - 核心：`renderCalendarGrid`、`openCalendar`、`closeCalendar`（约 15 分钟）
5. **JS** - 交互层：`changeCalMonth`、`jumpToDate`、`initCalendar`，并挂入 `init()`（约 10 分钟）
6. **调试** - 验证：单击跳转、双击开备忘录、今日标注、★ 和 · 标记、月切换动画

---

## 八、预期效果

- 零外部依赖，纯原生 JS + CSS
- 复用现有 overlay/modal 动画体系，风格高度统一
- 单月渲染仅读取 localStorage 2次（全量任务 + 全量备忘录），性能良好
- 所有交互有明确动效反馈，操作逻辑与现有习惯一致
