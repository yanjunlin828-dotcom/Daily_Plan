# 拖拽复制功能实现计划

## 需求概述

在左侧面板（长期目标/Todo）中，按住某个事项并拖动，可将其**复制**到右侧当日计划框内，无需重新打字。要求良好的可视化效果和动画。

---

## 技术方案

### 核心思路

使用原生 JavaScript 的 **Pointer Events API**（mousedown/mousemove/mouseup）而非 HTML5 原生 drag API，原因：
- 原生 drag API 不支持自定义拖拽影子元素样式
- Pointer Events 可完全控制拖拽视觉效果、动画、放置逻辑

### 触发方式：长按启动拖拽

| 操作 | 结果 |
|------|------|
| 单击 | 正常点击（不触发拖拽） |
| 长按 150ms 后移动鼠标 | 进入拖拽模式 |
| 拖拽到右侧计划框松手 | 复制该事项到当日计划 |
| 拖拽到其他区域松手 | 取消，无效果 |

---

## 实现步骤

### Step 1：为左侧事项添加拖拽监听（app.js）

在 `renderGoals()` 函数的事项渲染处，为每个 `<li>` 绑定 `pointerdown` 事件。

```javascript
li.addEventListener('pointerdown', (e) => initDrag(e, goal));
```

### Step 2：实现 `initDrag` 函数

```javascript
function initDrag(e, goal) {
  // 忽略右键、已在编辑状态
  if (e.button !== 0) return;

  let dragStarted = false;
  let ghost = null;
  const THRESHOLD = 150; // 长按阈值（ms）
  const MOVE_THRESHOLD = 5; // 移动距离阈值（px）

  const startX = e.clientX;
  const startY = e.clientY;

  // 长按定时器
  const timer = setTimeout(() => {
    dragStarted = true;
    ghost = createGhost(goal, startX, startY);
    document.body.appendChild(ghost);
    e.currentTarget.classList.add('drag-source'); // 来源高亮
  }, THRESHOLD);

  function onMove(e) {
    if (!dragStarted) {
      // 移动距离超出阈值，取消长按定时器
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > MOVE_THRESHOLD) clearTimeout(timer);
      return;
    }
    // 移动幽灵元素
    moveGhost(ghost, e.clientX, e.clientY);
    // 检测是否在放置区上方
    updateDropZone(e.clientX, e.clientY);
  }

  function onUp(e) {
    clearTimeout(timer);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);

    if (!dragStarted) return;

    dragStarted = false;
    removeGhost(ghost);
    document.querySelector('.goal-item.drag-source')
            ?.classList.remove('drag-source');

    // 判断是否放置在计划区
    if (isOverDropZone(e.clientX, e.clientY)) {
      dropToDaily(goal);
    } else {
      cancelDragAnimation();
    }
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}
```

### Step 3：实现幽灵元素（Ghost Element）

幽灵元素是拖拽时跟随鼠标的浮动卡片，视觉上是原事项的精简副本。

```javascript
function createGhost(goal, x, y) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = goal.text;
  ghost.dataset.priority = goal.priority;
  // 设置初始位置
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
  // 入场动画
  requestAnimationFrame(() => ghost.classList.add('drag-ghost--visible'));
  return ghost;
}

function moveGhost(ghost, x, y) {
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
}

function removeGhost(ghost) {
  ghost.classList.add('drag-ghost--exit');
  ghost.addEventListener('transitionend', () => ghost.remove(), { once: true });
}
```

### Step 4：放置区检测与高亮

```javascript
// 获取右侧任务列表容器的边界
function getDropZoneRect() {
  return document.querySelector('#task-list').getBoundingClientRect();
}

function isOverDropZone(x, y) {
  const rect = getDropZoneRect();
  return x >= rect.left && x <= rect.right &&
         y >= rect.top && y <= rect.bottom;
}

function updateDropZone(x, y) {
  const dropZone = document.querySelector('#task-list');
  if (isOverDropZone(x, y)) {
    dropZone.classList.add('drop-zone--active');
  } else {
    dropZone.classList.remove('drop-zone--active');
  }
}
```

### Step 5：复制事项到当日计划

```javascript
function dropToDaily(goal) {
  // 复用现有的 addTask 逻辑，直接插入一条新任务
  const newTask = {
    id: Date.now().toString(),
    text: goal.text,
    done: false,
    createdAt: Date.now(),
    priority: goal.priority,
    tags: [...goal.tags]
  };

  const dateKey = state.currentDate; // 当前日期
  if (!state.tasks[dateKey]) state.tasks[dateKey] = [];
  state.tasks[dateKey].unshift(newTask); // 插到顶部

  saveData();
  renderTasks();

  // 触发新任务入场动画（对第一个 li 添加 drop-in class）
  const firstItem = document.querySelector('#task-list li:first-child');
  firstItem?.classList.add('task-drop-in');
}
```

---

## 动画效果设计（style.css 新增）

### 1. 幽灵元素样式

```css
/* 跟随鼠标的浮动卡片 */
.drag-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0.9) rotate(-2deg);
  opacity: 0;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--accent);
  color: #000;
  font-size: 0.85rem;
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 255, 136, 0.4);
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

/* 幽灵入场 */
.drag-ghost--visible {
  opacity: 0.95;
  transform: translate(-50%, -50%) scale(1.05) rotate(-2deg);
}

/* 幽灵退出 */
.drag-ghost--exit {
  opacity: 0;
  transform: translate(-50%, -50%) scale(0.8);
  transition: opacity 0.2s ease, transform 0.2s ease;
}
```

### 2. 来源事项高亮（拖拽中的原事项）

```css
.goal-item.drag-source {
  opacity: 0.4;
  transform: scale(0.97);
  border-color: var(--accent) !important;
  transition: opacity 0.2s ease, transform 0.2s ease;
}
```

### 3. 放置区高亮（拖到右侧时）

```css
#task-list.drop-zone--active {
  outline: 2px dashed var(--accent);
  outline-offset: 4px;
  background: rgba(0, 255, 136, 0.04);
  border-radius: 8px;
  transition: outline 0.15s ease, background 0.15s ease;
}
```

### 4. 新任务入场动画

```css
@keyframes taskDropIn {
  0% {
    opacity: 0;
    transform: translateY(-16px) scale(0.95);
    background: rgba(0, 255, 136, 0.15);
  }
  60% {
    transform: translateY(3px) scale(1.01);
    background: rgba(0, 255, 136, 0.08);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
    background: transparent;
  }
}

.task-drop-in {
  animation: taskDropIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
```

### 5. 拖拽光标提示

```css
/* 提示用户可拖拽 */
.goal-item {
  cursor: grab;
}

.goal-item:active {
  cursor: grabbing;
}
```

---

## 文件修改清单

| 文件 | 修改类型 | 内容 |
|------|----------|------|
| `style.css` | 新增 ~60行 | 幽灵元素、放置区、入场动画、光标样式 |
| `app.js` | 新增 ~80行 | `initDrag`、`createGhost`、`moveGhost`、`removeGhost`、`updateDropZone`、`isOverDropZone`、`dropToDaily` 函数；在 `renderGoals` 中绑定事件 |
| `index.html` | 不修改 | 无需改动 |

**总新增代码量约 140 行，不改动现有功能。**

---

## 边界情况处理

| 情况 | 处理方式 |
|------|----------|
| 移动端触摸 | Pointer Events 天然支持 touch，无需额外处理 |
| 双击编辑冲突 | 长按阈值 150ms，普通点击/双击不触发拖拽 |
| 拖拽到日期非今天 | 复制到 `state.currentDate`（当前显示日期），符合预期 |
| 同一事项重复拖入 | 允许，生成新 id，视为独立任务副本 |
| 已完成事项拖拽 | 允许，复制后默认 done: false（全新任务） |
| 快速移动鼠标 | `pointermove` 实时跟踪，不会丢失 |

---

## 实现优先级

1. **P0**（核心）：幽灵元素跟随鼠标 + 放置到计划区 + 新任务出现
2. **P1**（体验）：放置区高亮 + 来源事项淡出 + 入场弹簧动画
3. **P2**（细节）：光标 grab/grabbing + 长按震动反馈（移动端）

---

## 预期用户体验流程

```
按住左侧事项
    ↓ (150ms后)
事项变半透明 + 幽灵卡片出现在鼠标处
    ↓
拖动到右侧计划区
    ↓
计划区出现绿色虚线高亮框
    ↓
松手
    ↓
幽灵消失 + 新任务从顶部弹入列表（弹簧动画）
```
