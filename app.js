const STORAGE_KEY = 'daily_plan_data';
const GOALS_STORAGE_KEY = 'daily_plan_goals';
const WEEK_DAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLORS = { high: '#e74c3c', medium: '#f1c40f', low: '#2ecc71' };
const DRAG_HOLD_MS = 150;
const DRAG_MOVE_THRESHOLD = 5;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const LONG_PRESS_MS             = 350;
const LONG_PRESS_MOVE_THRESHOLD = 5;

const API_BASE = 'http://localhost:8000/api';

// 内存缓存：启动时从后端加载，之后所有读操作均从此处读取，写操作同步更新缓存并异步持久化到后端
const cache = {
  tasks:     {},  // { dateKey: Task[] }
  workhard:  {},  // { dateKey: true }
  memos:     {},  // { dateKey: string }
  goalMemos: {},  // { goalId: string }
  goals:     [],  // GoalItem[]
};

// ── 日期工具 ──────────────────────────────────────────────

function dateToKey(d) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function getTodayKey() {
  return dateToKey(new Date());
}

function formatDateDisplay(dateKey) {
  const [yyyy, mm, dd] = dateKey.split('-');
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return `${dateKey}  ${WEEK_DAYS[d.getDay()]}`;
}

// ── API 辅助函数 ───────────────────────────────────────────

async function apiPut(path, body) {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`[daily_plan] 保存失败 (${path}):`, e);
    showStorageError();
    // API 写入失败时，将当前缓存全量写入 localStorage 兜底
    try {
      localStorage.setItem(STORAGE_KEY,           JSON.stringify(cache.tasks));
      localStorage.setItem(GOALS_STORAGE_KEY,     JSON.stringify(cache.goals));
      localStorage.setItem(WORKHARD_STORAGE_KEY,  JSON.stringify(cache.workhard));
      localStorage.setItem(MEMO_STORAGE_KEY,      JSON.stringify(cache.memos));
      localStorage.setItem(GOAL_MEMO_STORAGE_KEY, JSON.stringify(cache.goalMemos));
    } catch { /* ignore */ }
  }
}

async function apiDelete(path) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`[daily_plan] 删除失败 (${path}):`, e);
  }
}

// 错误提示 toast
function showStorageError(msg = '⚠ 数据保存失败！请确认后端服务正在运行。') {
  if (document.getElementById('storage-error-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'storage-error-toast';
  toast.className = 'storage-error-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 6000);
}

// 成功/信息提示 toast（绿色）
function showInfoToast(msg) {
  if (document.getElementById('storage-info-toast')) return;
  const toast = document.createElement('div');
  toast.id = 'storage-info-toast';
  toast.className = 'storage-error-toast';
  toast.style.cssText = 'background:#1a4731;border-color:#00ff88;color:#00ff88;';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.isConnected) toast.remove(); }, 5000);
}

// ── 数据持久化（读：内存缓存 / 写：后端 API）─────────────────

function loadAllData() {
  return cache.tasks;
}

// 向下兼容：为旧任务补充新字段
function migrateTask(task) {
  return { priority: 'medium', tags: [], delay_days: 0, original_date: null, subtasks: [], ...task };
}

function loadTasks(dateKey) {
  return (cache.tasks[dateKey] || []).map(migrateTask);
}

function saveTasks(dateKey, tasks) {
  cache.tasks[dateKey] = tasks;
  apiPut(`/tasks/${dateKey}`, tasks);
}

// ── WorkHard 持久化 ───────────────────────────────────────

const WORKHARD_STORAGE_KEY = 'daily_plan_workhard';

function loadWorkhardData() {
  return cache.workhard;
}

function isWorkhard(dateKey) {
  return !!cache.workhard[dateKey];
}

function setWorkhard(dateKey, value) {
  if (value) {
    cache.workhard[dateKey] = true;
  } else {
    delete cache.workhard[dateKey];
  }
  apiPut(`/workhard/${dateKey}`, { value });
}

// ── 标签解析 ──────────────────────────────────────────────

function parseTagsFromText(rawText) {
  const tags = [];
  const cleanText = rawText
    .replace(/#([\u4e00-\u9fa5\w]+)/g, (_, tag) => { tags.push(tag); return ''; })
    .replace(/\s+/g, ' ')
    .trim();
  return { cleanText, tags: [...new Set(tags)] };
}

// ── 优先级 ────────────────────────────────────────────────

function cyclePriority(current) {
  const order = ['high', 'medium', 'low'];
  return order[(order.indexOf(current) + 1) % order.length];
}

function setPriority(id, priority) {
  state.tasks = state.tasks.map(t =>
    t.id === id ? { ...t, priority } : t
  );
  saveTasks(state.dateKey, state.tasks);
  renderTasks();
}

function buildPriorityBtn(item, onChange) {
  const btn = document.createElement('button');
  btn.className = `priority-btn priority-${item.priority}`;
  btn.innerHTML = '&#9679;';
  btn.style.color = PRIORITY_COLORS[item.priority];
  btn.title = `优先级：${PRIORITY_LABELS[item.priority]}（点击切换）`;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    onChange(cyclePriority(item.priority));
  });
  return btn;
}

// ── 标签过滤 ──────────────────────────────────────────────

function setActiveTag(tag) {
  state.activeTag = state.activeTag === tag ? null : tag;
  renderTasks();
}

function getVisibleTasks() {
  if (!state.activeTag) return state.tasks;
  return state.tasks.filter(t => t.tags.includes(state.activeTag));
}

function buildTagChips(task) {
  const container = document.createElement('span');
  container.className = 'tag-list';
  task.tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = `tag-chip${tag === state.activeTag ? ' active' : ''}`;
    chip.textContent = `#${tag}`;
    chip.addEventListener('click', e => { e.stopPropagation(); setActiveTag(tag); });
    container.appendChild(chip);
  });
  return container;
}

function renderTagFilter() {
  const bar = document.getElementById('tag-filter-bar');
  if (!state.activeTag) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = '';
  const label = document.createElement('span');
  label.textContent = `筛选：#${state.activeTag}`;
  const clearBtn = document.createElement('button');
  clearBtn.className = 'tag-filter-clear';
  clearBtn.textContent = '× 清除';
  clearBtn.addEventListener('click', () => setActiveTag(state.activeTag));
  bar.appendChild(label);
  bar.appendChild(clearBtn);
}

// ── 任务操作 ──────────────────────────────────────────────

function generateId() {
  // 9 位随机字符（vs 原来 3 位），极大降低同毫秒碰撞概率
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11);
}

function addTask(rawText) {
  const { cleanText, tags } = parseTagsFromText(rawText);
  if (!cleanText) return;

  state.tasks = [...state.tasks, { id: generateId(), text: cleanText, done: false, createdAt: Date.now(), priority: 'medium', tags, delay_days: 0, original_date: state.dateKey }];
  saveTasks(state.dateKey, state.tasks);
  renderTasks();
}

function toggleTask(id) {
  const task = state.tasks.find(t => t.id === id);
  const becomingDone = task && !task.done;
  state.tasks = state.tasks.map(t =>
    t.id === id ? { ...t, done: !t.done } : t
  );
  saveTasks(state.dateKey, state.tasks);
  state.completingId = becomingDone ? id : null;
  renderTasks();
  state.completingId = null;
}

function deleteTask(id) {
  // 若删除的任务正好有子任务面板打开，先关闭面板
  if (subtask_panel_task_id === id) closeSubtaskPanel();
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveTasks(state.dateKey, state.tasks);
  renderTasks();
}

// ── 内联编辑 ──────────────────────────────────────────────

function startEditing(li, task, textEl) {
  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'task-edit-input';
  // 初始值含标签（方便用户修改）
  const tagSuffix = task.tags.length ? ' ' + task.tags.map(t => '#' + t).join(' ') : '';
  editInput.value = task.text + tagSuffix;

  editInput.addEventListener('click', e => e.stopPropagation());

  textEl.parentNode.replaceChild(editInput, textEl);
  editInput.focus();
  editInput.select();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const { cleanText, tags } = parseTagsFromText(editInput.value);
    if (cleanText && (cleanText !== task.text || tags.join(',') !== task.tags.join(','))) {
      state.tasks = state.tasks.map(t =>
        t.id === task.id ? { ...t, text: cleanText, tags } : t
      );
      saveTasks(state.dateKey, state.tasks);
    }
    renderTasks();
  }

  function cancel() {
    if (committed) return;
    committed = true;
    renderTasks();
  }

  editInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  });

  editInput.addEventListener('blur', commit);
}

// ── 渲染 ─────────────────────────────────────────────────

function renderTasks() {
  const list = document.getElementById('task-list');
  const emptyState = document.getElementById('empty-state');
  const allDoneBanner = document.getElementById('all-done-banner');
  const progressText = document.getElementById('progress-text');
  const progressFill = document.getElementById('progress-fill');

  // 进度统计用全量
  const total = state.tasks.length;
  const doneCount = state.tasks.filter(t => t.done).length;
  progressText.textContent = `${doneCount} / ${total} 已完成`;
  progressFill.style.width = total === 0 ? '0%' : `${Math.round((doneCount / total) * 100)}%`;
  progressFill.style.boxShadow = (total === 0 || doneCount === 0) ? 'none' : '';

  emptyState.classList.toggle('hidden', total > 0);

  const allDone = total > 0 && doneCount === total;
  allDoneBanner.classList.toggle('hidden', !allDone);

  // 列表渲染用过滤后的任务，按优先级排序（完成项置底）
  const visibleTasks = [...getVisibleTasks()].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });
  list.innerHTML = '';
  visibleTasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item${task.done ? ' done' : ''}`;
    li.dataset.taskId = task.id;

    if (task.id === state.completingId) {
      li.classList.add('completing');
    }

    // 延续任务特殊样式（仅未完成时显示）
    if (!task.done && task.delay_days > 0) {
      li.classList.add(task.delay_days >= 4 ? 'task-carried-danger' : 'task-carried');
    }

    const checkbox = document.createElement('div');
    checkbox.className = 'task-checkbox';
    checkbox.textContent = task.done ? '[x]' : '[ ]';

    const text_block = document.createElement('div');
    text_block.className = 'task-text-block';

    const textEl = document.createElement('span');
    textEl.className = 'task-text';
    textEl.textContent = task.text;
    text_block.appendChild(textEl);

    if (task.subtasks && task.subtasks.length > 0) {
      text_block.appendChild(buildSubtaskInlineProgress(task));
    }

    const tagChips = buildTagChips(task);
    const delayBadge = (!task.done && task.delay_days > 0) ? buildDelayBadge(task) : null;
    const priorityBtn = buildPriorityBtn(task, p => setPriority(task.id, p));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = '删除任务';

    let click_timer = null;

    textEl.addEventListener('dblclick', e => {
      e.stopPropagation();
      clearTimeout(click_timer);
      startEditing(li, task, textEl);
    });

    li.addEventListener('click', e => {
      if (e.target.closest('.delete-btn')) return;
      if (e.target.closest('.priority-btn')) return;
      if (e.target.closest('.tag-chip')) return;
      if (e.target.closest('.delay-badge')) return;
      if (e.target.closest('.subtask-inline-progress')) return;
      if (e.target.tagName === 'INPUT') return;
      clearTimeout(click_timer);
      click_timer = setTimeout(() => toggleTask(task.id), 180);
    });

    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    li.appendChild(checkbox);
    li.appendChild(text_block);
    li.appendChild(tagChips);
    if (delayBadge) li.appendChild(delayBadge);
    li.appendChild(priorityBtn);
    li.appendChild(deleteBtn);
    initLongPress(li, task.id);
    list.appendChild(li);
  });

  // 若子任务面板已打开，同步刷新其内容
  if (subtask_panel_task_id) {
    const panel_task = state.tasks.find(t => t.id === subtask_panel_task_id);
    if (panel_task) renderSubtaskPanel(panel_task);
  }

  renderTagFilter();
  updateCarryBtnState();
}

// ── 日期导航 ──────────────────────────────────────────────

function navigateDate(offset) {
  const [yyyy, mm, dd] = state.dateKey.split('-').map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  d.setDate(d.getDate() + offset);
  jumpToDate(dateToKey(d));
}

// ── 备忘录持久化 ──────────────────────────────────────────

const MEMO_STORAGE_KEY = 'daily_plan_memo';

function loadMemo(dateKey) {
  return cache.memos[dateKey] || '';
}

function saveMemo(dateKey, text) {
  if (text.trim()) {
    cache.memos[dateKey] = text;
  } else {
    delete cache.memos[dateKey];
  }
  apiPut(`/memo/${dateKey}`, { content: text });
}

// ── 目标备忘录持久化 ──────────────────────────────────────

const GOAL_MEMO_STORAGE_KEY = 'daily_plan_goal_memo';

function loadGoalMemo(goalId) {
  return cache.goalMemos[goalId] || '';
}

function saveGoalMemo(goalId, text) {
  if (text.trim()) {
    cache.goalMemos[goalId] = text;
  } else {
    delete cache.goalMemos[goalId];
  }
  apiPut(`/goal-memo/${goalId}`, { content: text });
}

// 目标删除时清理其备忘录，防止存储泄漏
function deleteGoalMemo(goalId) {
  delete cache.goalMemos[goalId];
  apiDelete(`/goal-memo/${goalId}`);
}

// 一次性读取全量备忘录（供日历渲染使用，避免逐日读取）
function loadAllMemos() {
  return cache.memos;
}

// 获取某日期的任务/备忘录统计状态
function getDateStats(dateKey, allTasks, allMemos) {
  const tasks = allTasks[dateKey] || [];
  return {
    allDone: tasks.length > 0 && tasks.every(t => t.done),
    hasMemo: !!(allMemos[dateKey] && allMemos[dateKey].trim()),
  };
}

// ── 延续未完成任务 ─────────────────────────────────────────

function getNextDateKey(dateKey) {
  const [yyyy, mm, dd] = dateKey.split('-').map(Number);
  const d = new Date(yyyy, mm - 1, dd);
  d.setDate(d.getDate() + 1);
  return dateToKey(d);
}

function buildDelayBadge(task) {
  const days = task.delay_days || 0;
  if (days === 0) return null;

  const badge = document.createElement('span');
  const is_danger = days >= 4;
  badge.className = `delay-badge${is_danger ? ' delay-badge--danger' : ''}`;

  // 火焰强度随延迟天数增加
  const flames = days >= 5 ? '🔥🔥🔥' : days >= 3 ? '🔥🔥' : '🔥';
  badge.textContent = `↩${days}天 ${flames}`;

  const origin = task.original_date ? `原定 ${task.original_date}` : '';
  badge.title = `已延续 ${days} 天${origin ? '（' + origin + '）' : ''}`;
  return badge;
}

function updateCarryBtnState() {
  const btn = document.getElementById('carry-btn');
  if (!btn) return;
  const has_pending = state.tasks.some(t => !t.done);
  btn.classList.toggle('has-pending', has_pending);
  btn.disabled = !has_pending;
}

function showCarryDoneBanner(count) {
  const banner = document.getElementById('carry-done-banner');
  if (!banner) return;
  const count_el = document.getElementById('carry-done-count');
  if (count_el) count_el.textContent = count;
  banner.classList.remove('hidden');
  // 4秒后自动消隐
  setTimeout(() => banner.classList.add('hidden'), 4000);
}

// 执行实际数据迁移：将未完成任务移至下一天（delay_days + 1）
// Bug修复1：接收 source_date_key 参数而非依赖 state.dateKey，
// 防止用户在动画期间切换日期导致写入错误
function doCarryOver(pending_tasks, source_date_key, next_date_key) {
  const carried = pending_tasks.map(t => ({
    ...t,
    id: generateId(),
    done: false,
    delay_days: (t.delay_days || 0) + 1,
    original_date: t.original_date || source_date_key,
    carryShown: false,
    createdAt: Date.now(),
  }));

  // 直接操作内存缓存，再分别保存两天的数据到后端
  const next_day_tasks = (cache.tasks[next_date_key] || []).map(migrateTask);
  cache.tasks[next_date_key] = [...carried, ...next_day_tasks];
  cache.tasks[source_date_key] = (cache.tasks[source_date_key] || []).filter(t => t.done);
  apiPut(`/tasks/${next_date_key}`, cache.tasks[next_date_key]);
  apiPut(`/tasks/${source_date_key}`, cache.tasks[source_date_key]);

  // 仅在用户仍在查看源日期时才更新当前 state 和视图
  if (state.dateKey === source_date_key) {
    state.tasks = state.tasks.filter(t => t.done);
    renderTasks();
    showCarryDoneBanner(pending_tasks.length);
  }
}

// 动画序列：高亮 → 浮出 "+N天" → 飞走 → 数据迁移
function animateCarryOver(pending_tasks) {
  // Bug修复1：在动画开始时捕获当前日期，防止用户在 ~1s 动画窗口内切换日期
  // 导致 doCarryOver 操作错误的 dateKey
  const source_date_key = state.dateKey;
  const next_date_key   = getNextDateKey(source_date_key);
  const carry_btn = document.getElementById('carry-btn');

  // 按钮爆发效果
  carry_btn.disabled = true;
  carry_btn.classList.remove('has-pending');
  carry_btn.classList.add('firing');
  carry_btn.addEventListener('animationend', () => carry_btn.classList.remove('firing'), { once: true });

  // Bug修复2：保持 task-element 的配对关系，避免 filter(Boolean) 破坏索引对应
  const task_el_pairs = pending_tasks
    .map(t => ({ task: t, el: document.querySelector(`[data-task-id="${t.id}"]`) }))
    .filter(p => p.el !== null);

  const HIGHLIGHT_STAGGER = 50;  // 高亮扫描间隔 ms
  const FLYOUT_STAGGER    = 65;  // 飞走间隔 ms
  const FLYOUT_ANIM       = 520; // 飞走动画时长 ms

  // 阶段1：依次高亮 + 浮出 "+N天" 标签
  task_el_pairs.forEach(({ task, el }, i) => {
    setTimeout(() => {
      el.classList.add('carry-highlight');

      const new_days = (task.delay_days || 0) + 1;
      const label = document.createElement('span');
      label.className = 'carry-day-label';
      label.textContent = `+${new_days}天`;
      el.appendChild(label);
      label.addEventListener('animationend', () => label.remove(), { once: true });
      // 兜底：动画未正常触发时（中途导航、浏览器节流）仍保证元素被清除
      setTimeout(() => { if (label.isConnected) label.remove(); }, 1500);
    }, i * HIGHLIGHT_STAGGER);
  });

  // 阶段2：高亮结束后依次飞走
  const flyout_start = task_el_pairs.length * HIGHLIGHT_STAGGER + 220;
  task_el_pairs.forEach(({ el }, i) => {
    setTimeout(() => {
      el.classList.remove('carry-highlight');
      el.classList.add('flying-out');
    }, flyout_start + i * FLYOUT_STAGGER);
  });

  // 阶段3：全部飞走后执行数据迁移，并自动跳转到明天（传入捕获的 source_date_key）
  const data_update_at = flyout_start + task_el_pairs.length * FLYOUT_STAGGER + FLYOUT_ANIM;
  setTimeout(() => {
    doCarryOver(pending_tasks, source_date_key, next_date_key);
    jumpToDate(next_date_key);
  }, data_update_at);
}

function carryOverTasks() {
  const pending_tasks = state.tasks.filter(t => !t.done);
  if (pending_tasks.length === 0) return;
  animateCarryOver(pending_tasks);
}

// ── 备忘录弹窗 ────────────────────────────────────────────

function updateMemoBtnState() {
  const btn = document.getElementById('memo-btn');
  btn.classList.toggle('has-content', loadMemo(state.dateKey).trim().length > 0);
}

function updateGoalMemoBtnState(goalId) {
  const btn = document.querySelector(`[data-goal-id="${goalId}"] .goal-memo-btn`);
  if (btn) btn.classList.toggle('has-memo', loadGoalMemo(goalId).trim().length > 0);
}

function updateMemoCharCount() {
  const textarea = document.getElementById('memo-textarea');
  const countEl  = document.getElementById('memo-char-count');
  const len = textarea.value.length;
  countEl.textContent = len > 0 ? `${len} 字` : '0 字';
  countEl.classList.toggle('has-content', len > 0);
}

// ctx: { type: 'daily' } | { type: 'goal', id, text }
function syncMemoModal() {
  const ctx      = state.memoContext;
  const textarea = document.getElementById('memo-textarea');
  const dateEl   = document.getElementById('memo-modal-date');

  if (ctx.type === 'daily') {
    dateEl.textContent = formatDateDisplay(state.dateKey);
    textarea.value = loadMemo(state.dateKey);
  } else {
    const MAX_LEN = 28;
    dateEl.textContent = ctx.text.length > MAX_LEN ? ctx.text.slice(0, MAX_LEN) + '…' : ctx.text;
    textarea.value = loadGoalMemo(ctx.id);
  }
  updateMemoCharCount();
}

function openMemo(ctx = { type: 'daily' }) {
  state.memoContext = ctx;
  const overlay = document.getElementById('memo-overlay');
  syncMemoModal();
  overlay.classList.remove('hidden', 'closing');
  overlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => document.getElementById('memo-textarea').focus(), 50);
}

function closeMemo() {
  const overlay = document.getElementById('memo-overlay');
  overlay.classList.add('closing');

  function onEnd(e) {
    if (e.target !== overlay) return;
    if (!overlay.classList.contains('closing')) return; // 已被 openMemo 取消关闭
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.removeEventListener('animationend', onEnd);
  }
  overlay.addEventListener('animationend', onEnd);
}

function initMemo() {
  const overlay  = document.getElementById('memo-overlay');
  const textarea = document.getElementById('memo-textarea');

  document.getElementById('memo-btn').addEventListener('click', () => openMemo({ type: 'daily' }));

  // 监听器只注册一次，根据当前上下文决定存入哪个存储
  textarea.addEventListener('input', () => {
    updateMemoCharCount();
    const ctx = state.memoContext;
    if (ctx.type === 'daily') {
      saveMemo(state.dateKey, textarea.value);
      updateMemoBtnState();
    } else {
      saveGoalMemo(ctx.id, textarea.value);
      updateGoalMemoBtnState(ctx.id);
    }
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeMemo();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeMemo();
  });

  updateMemoBtnState();
}

// ── 截止日期工具函数 ──────────────────────────────────────

function calcDaysDiff(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [yyyy, mm, dd] = dateStr.split('-').map(Number);
  const target = new Date(yyyy, mm - 1, dd);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function buildDueBadge(dueDate) {
  if (!dueDate) return null;

  const days = calcDaysDiff(dueDate);
  const badge = document.createElement('span');
  badge.className = 'due-badge';

  if (days < 0) {
    badge.classList.add('overdue');
    badge.textContent = '✕ 已过期';
  } else if (days === 0) {
    badge.classList.add('due-today');
    badge.textContent = '⚡ 今天截止';
  } else if (days <= 7) {
    badge.classList.add('due-soon');
    badge.textContent = `⚠ ${days}天后`;
  } else {
    badge.classList.add('due-normal');
    badge.textContent = `◷ ${days}天后`;
  }

  return badge;
}

// ── 长期目标持久化 ────────────────────────────────────────

function migrateGoalItem(item) {
  return {
    priority: 'medium',
    tags: [],
    done: false,
    dueDate: null,
    pinned: false,
    ...item,
  };
}

function loadGoals() {
  return (Array.isArray(cache.goals) ? cache.goals : []).map(migrateGoalItem);
}

function saveGoals() {
  cache.goals = [...state.goals];
  apiPut('/goals', state.goals);
}

// ── 长期目标输入解析 ──────────────────────────────────────

function parseGoalInput(rawText) {
  let dueDate = null;
  const withoutDate = rawText.replace(/@(\d{4}-\d{2}-\d{2})/g, (_, date) => {
    dueDate = date;
    return '';
  });
  const { cleanText, tags } = parseTagsFromText(withoutDate);
  return { cleanText, tags, dueDate };
}

// ── 长期目标 CRUD ─────────────────────────────────────────

function addGoalItem(rawText) {
  const { cleanText, tags, dueDate } = parseGoalInput(rawText);
  if (!cleanText) return;

  const new_item = {
    id: generateId(),
    type: state.newItemType,
    text: cleanText,
    priority: 'medium',
    tags,
    done: false,
    dueDate,
    pinned: false,
    createdAt: Date.now(),
  };

  state.goals = [new_item, ...state.goals];
  saveGoals();
  renderGoals();

  const li = document.querySelector(`[data-goal-id="${new_item.id}"]`);
  if (li) {
    li.classList.add('entering');
    li.addEventListener('animationend', () => li.classList.remove('entering'), { once: true });
  }
}

function toggleGoalItem(id) {
  const item = state.goals.find(g => g.id === id);
  const becoming_done = item && item.type === 'todo' && !item.done;
  state.goals = state.goals.map(g =>
    g.id === id && g.type === 'todo' ? { ...g, done: !g.done } : g
  );
  saveGoals();

  if (becoming_done) {
    const li = document.querySelector(`[data-goal-id="${id}"]`);
    if (li) {
      li.classList.add('just-toggled');
      setTimeout(() => renderGoals(), 400);
      return;
    }
  }

  renderGoals();
}

function deleteGoalItem(id) {
  state.goals = state.goals.filter(g => g.id !== id);
  saveGoals();
  deleteGoalMemo(id);
  renderGoals();
}

function setGoalPriority(id, priority) {
  state.goals = state.goals.map(g =>
    g.id === id ? { ...g, priority } : g
  );
  saveGoals();
  renderGoals();
}

function setNewItemType(type) {
  state.newItemType = type;
  state.activeGoalView = type;
  state.is_archive_collapsed = false;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.remove('active-goal', 'active-todo');
  });
  const active_btn = document.getElementById(`type-btn-${type}`);
  if (active_btn) active_btn.classList.add(`active-${type}`);
  renderGoals();
}


// ── 长期目标渲染 ──────────────────────────────────────────

// Goal 与 Todo 共用同一构建函数，通过 item.type 区分差异
function buildGoalListItem(item) {
  const is_todo = item.type === 'todo';

  const li = document.createElement('li');
  li.className = is_todo
    ? `goal-item type-todo${item.done ? ' todo-done' : ''}`
    : 'goal-item type-goal';
  li.dataset.goalId = item.id;

  const row = document.createElement('div');
  row.className = 'goal-item-row';

  const prefix = document.createElement('span');
  prefix.className = 'goal-prefix';
  prefix.textContent = is_todo ? (item.done ? '[x]' : '[ ]') : '●';

  const text_el = document.createElement('span');
  text_el.className = 'goal-text';
  text_el.textContent = item.text;

  const priority_btn = buildPriorityBtn(item, p => setGoalPriority(item.id, p));

  const delete_btn = document.createElement('button');
  delete_btn.className = 'goal-delete-btn';
  delete_btn.textContent = '×';
  delete_btn.title = '删除';

  const memo_btn = document.createElement('button');
  memo_btn.className = 'goal-memo-btn';
  memo_btn.textContent = '//';
  memo_btn.title = '目标备忘录';
  if (loadGoalMemo(item.id).trim()) memo_btn.classList.add('has-memo');
  memo_btn.addEventListener('click', e => {
    e.stopPropagation();
    openMemo({ type: 'goal', id: item.id, text: item.text });
  });

  row.appendChild(prefix);
  row.appendChild(text_el);
  row.appendChild(priority_btn);
  row.appendChild(memo_btn);
  row.appendChild(delete_btn);
  li.appendChild(row);

  if (item.dueDate) {
    const badge = buildDueBadge(item.dueDate);
    if (badge) {
      badge.style.marginLeft = '22px';
      li.appendChild(badge);
    }
  }

  let click_timer = null;

  text_el.addEventListener('dblclick', e => {
    e.stopPropagation();
    clearTimeout(click_timer);
    startGoalEditing(li, item, text_el);
  });

  delete_btn.addEventListener('click', e => {
    e.stopPropagation();
    deleteGoalItem(item.id);
  });

  // 只有 Todo 类型支持单击切换完成状态
  if (is_todo) {
    li.addEventListener('click', e => {
      if (e.target.closest('.goal-delete-btn')) return;
      if (e.target.closest('.priority-btn')) return;
      if (e.target.closest('.goal-memo-btn')) return;
      clearTimeout(click_timer);
      click_timer = setTimeout(() => toggleGoalItem(item.id), 180);
    });
  }

  return li;
}

function startGoalEditing(li, item, text_el) {
  const edit_input = document.createElement('input');
  edit_input.type = 'text';
  edit_input.className = 'task-edit-input';
  const tag_suffix = item.tags.length ? ' ' + item.tags.map(t => '#' + t).join(' ') : '';
  const due_suffix = item.dueDate ? ` @${item.dueDate}` : '';
  edit_input.value = item.text + tag_suffix + due_suffix;

  edit_input.addEventListener('click', e => e.stopPropagation());
  text_el.parentNode.replaceChild(edit_input, text_el);
  edit_input.focus();
  edit_input.select();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    const { cleanText, tags, dueDate } = parseGoalInput(edit_input.value);
    if (cleanText) {
      state.goals = state.goals.map(g =>
        g.id === item.id ? { ...g, text: cleanText, tags, dueDate } : g
      );
      saveGoals();
    }
    renderGoals();
  }

  function cancel() {
    if (committed) return;
    committed = true;
    renderGoals();
  }

  edit_input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  });
  edit_input.addEventListener('blur', commit);
}

function toggleGoalPin(id) {
  state.goals = state.goals.map(g =>
    g.id === id ? { ...g, pinned: !g.pinned } : g
  );
  saveGoals();
  renderGoals();
}

function getSortedGoals() {
  const filtered = state.goals.filter(g => g.type === state.activeGoalView);
  return filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.priority !== b.priority) return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return b.createdAt - a.createdAt;
  });
}

function toggleArchiveCollapse() {
  state.is_archive_collapsed = !state.is_archive_collapsed;
  renderGoals();
}

function renderGoals() {
  const list = document.getElementById('goals-list');
  const empty = document.getElementById('goals-empty');
  list.innerHTML = '';

  const sorted = getSortedGoals();
  const pinned_items = sorted.filter(g => g.pinned && !g.done);
  const active_items = sorted.filter(g => !g.pinned && !g.done);
  const done_items   = sorted.filter(g => g.done);

  empty.classList.toggle('hidden', sorted.length > 0);

  function buildLiWithPin(item) {
    const li = buildGoalListItem(item);
    const pin_btn = document.createElement('button');
    pin_btn.className = 'goal-pin-btn';
    pin_btn.textContent = '★';
    pin_btn.title = item.pinned ? '取消置顶' : '置顶';
    pin_btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleGoalPin(item.id);
    });
    const row = li.querySelector('.goal-item-row');
    if (row) row.insertBefore(pin_btn, row.firstChild);
    if (item.pinned) li.classList.add('pinned');
    li.addEventListener('pointerdown', e => initDrag(e, item));
    return li;
  }

  function appendGroup(header_text, items, is_archive = false) {
    if (items.length === 0) return;

    if (header_text) {
      const header = document.createElement('div');
      header.className = 'goals-group-header';
      if (is_archive) {
        header.classList.add('archive-header');
        header.style.cursor = 'pointer';
        header.textContent = `${state.is_archive_collapsed ? '▸' : '▾'} ${header_text}`;
        header.addEventListener('click', toggleArchiveCollapse);
      } else {
        header.textContent = `── ${header_text} ──`;
      }
      list.appendChild(header);
    }

    if (is_archive && state.is_archive_collapsed) return;

    items.forEach(item => list.appendChild(buildLiWithPin(item)));
  }

  appendGroup('置顶', pinned_items);
  appendGroup(null, active_items);
  appendGroup('已完成', done_items, true);
}

// ── 拖拽复制 ──────────────────────────────────────────────

function createDragGhost(goal, x, y) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  const prefix = goal.type === 'goal' ? '● ' : '□ ';
  ghost.textContent = prefix + goal.text;
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
  document.body.appendChild(ghost);
  ghost.getBoundingClientRect(); // 强制 reflow，确保 transition 生效
  ghost.classList.add('drag-ghost--visible');
  return ghost;
}

function moveDragGhost(ghost, x, y) {
  ghost.style.left = x + 'px';
  ghost.style.top = y + 'px';
}

function removeDragGhost(ghost) {
  ghost.classList.remove('drag-ghost--visible');
  ghost.classList.add('drag-ghost--exit');
  const remove = () => { if (ghost.parentNode) ghost.remove(); };
  ghost.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 400); // 兜底：transition 未触发时强制移除
}

function isOverDailyPanel(x, y) {
  const rect = document.querySelector('.panel-daily').getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function setTaskListDropActive(active) {
  document.getElementById('task-list').classList.toggle('drop-zone--active', active);
}

function dropToDaily(goal) {
  const new_task = {
    id: generateId(),
    text: goal.text,
    done: false,
    createdAt: Date.now(),
    priority: goal.priority,
    tags: [...(goal.tags || [])],
    delay_days: 0,
    original_date: state.dateKey,
  };
  state.tasks = [new_task, ...state.tasks];
  saveTasks(state.dateKey, state.tasks);
  renderTasks();
  // 触发新任务弹入动画
  const new_li = document.querySelector(`[data-task-id="${new_task.id}"]`);
  if (new_li) {
    new_li.classList.add('task-drop-in');
    new_li.addEventListener('animationend', () => new_li.classList.remove('task-drop-in'), { once: true });
  }
}

function initDrag(e, goal) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('.goal-delete-btn, .priority-btn, .goal-pin-btn, .goal-memo-btn, .task-edit-input')) return;

  const start_x = e.clientX;
  const start_y = e.clientY;
  const source_el = e.currentTarget;
  let ghost = null;
  let is_dragging = false;

  const drag_timer = setTimeout(() => {
    is_dragging = true;
    source_el.classList.add('drag-source');
    document.body.classList.add('dragging-active');
    ghost = createDragGhost(goal, start_x, start_y);
    if (navigator.vibrate) navigator.vibrate(30); // 移动端震动反馈
  }, DRAG_HOLD_MS);

  function on_move(e) {
    if (!is_dragging) {
      // 未进入拖拽模式前若移动超出阈值，取消（用户意图为滚动）
      if (Math.hypot(e.clientX - start_x, e.clientY - start_y) > DRAG_MOVE_THRESHOLD) {
        clearTimeout(drag_timer);
        cleanup();
      }
      return;
    }
    e.preventDefault();
    moveDragGhost(ghost, e.clientX, e.clientY);
    setTaskListDropActive(isOverDailyPanel(e.clientX, e.clientY));
  }

  function on_up(e) {
    clearTimeout(drag_timer);
    cleanup();
    if (!is_dragging) return;

    // 拖拽结束后浏览器会补发 click，用捕获阶段吸收它，防止误触发完成逻辑。
    // 用具名引用替代 once:true：每次拖拽先移除上一个吸收器再注册新的，
    // 避免快速多次拖拽时吸收器累积导致合法 click 被误拦截。
    if (source_el._drag_absorber) {
      source_el.removeEventListener('click', source_el._drag_absorber, { capture: true });
    }
    const absorber = e => e.stopPropagation();
    source_el._drag_absorber = absorber;
    source_el.addEventListener('click', absorber, { capture: true });
    setTimeout(() => {
      source_el.removeEventListener('click', absorber, { capture: true });
      if (source_el._drag_absorber === absorber) source_el._drag_absorber = null;
    }, 500);

    setTaskListDropActive(false);
    document.body.classList.remove('dragging-active');
    source_el.classList.remove('drag-source');
    removeDragGhost(ghost);

    if (isOverDailyPanel(e.clientX, e.clientY)) {
      dropToDaily(goal);
    }
  }

  function cleanup() {
    document.removeEventListener('pointermove', on_move);
    document.removeEventListener('pointerup', on_up);
  }

  document.addEventListener('pointermove', on_move);
  document.addEventListener('pointerup', on_up);
}

// ── 日历 ─────────────────────────────────────────────────

function renderCalendarGrid(direction = null) {
  const grid  = document.getElementById('cal-grid');
  const label = document.getElementById('cal-month-label');
  const { calYear: y, calMonth: m } = state;
  const todayKey    = getTodayKey();
  const selectedKey = state.dateKey;

  // 更新月份标签
  label.textContent = `${y}-${String(m + 1).padStart(2, '0')}`;

  // 触发方向感知滑动动画
  if (direction) {
    grid.classList.remove('slide-left', 'slide-right');
    void grid.offsetWidth; // 强制 reflow，确保动画重新触发
    grid.classList.add(direction === 1 ? 'slide-left' : 'slide-right');
  }

  // 一次性读取全量数据，避免循环内重复 IO
  const allTasks    = loadAllData();
  const allMemos    = loadAllMemos();
  const allWorkhard = loadWorkhardData();

  const first_day_of_week = new Date(y, m, 1).getDay(); // 0=周日
  const days_in_month = new Date(y, m + 1, 0).getDate();

  grid.innerHTML = '';

  // 空格填充（月初对齐周日起始）
  for (let i = 0; i < first_day_of_week; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-day empty';
    grid.appendChild(empty);
  }

  // 日期格
  for (let d = 1; d <= days_in_month; d++) {
    const dateKey = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const { allDone, hasMemo } = getDateStats(dateKey, allTasks, allMemos);
    const is_workhard_day = !!allWorkhard[dateKey];

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.dataset.dateKey = dateKey;

    const num = document.createElement('span');
    num.textContent = d;
    cell.appendChild(num);

    if (dateKey === todayKey)    cell.classList.add('today');
    if (dateKey === selectedKey) cell.classList.add('selected');

    // 全部完成或努力工作：统一使用金色 workhard 效果
    if (allDone || is_workhard_day) {
      cell.classList.add('workhard');
    }

    // 有备忘录：// 标记（★ 存在时 CSS 自动左移避免重叠）
    if (hasMemo) {
      const mark = document.createElement('span');
      mark.className = 'cal-day-mark';
      mark.textContent = '//';
      cell.appendChild(mark);
    }

    // 单击/双击防冲突（与任务项相同的 180ms 延时方案）
    let click_timer = null;

    cell.addEventListener('click', () => {
      clearTimeout(click_timer);
      click_timer = setTimeout(() => {
        jumpToDate(dateKey);
        closeCalendar();
      }, 180);
    });

    cell.addEventListener('dblclick', () => {
      clearTimeout(click_timer);
      jumpToDate(dateKey);
      closeCalendar();
      // 等待关闭动画（200ms）结束后再打开备忘录
      setTimeout(() => openMemo({ type: 'daily' }), 250);
    });

    grid.appendChild(cell);
  }
}

// 跳转到指定日期（更新主页任务视图，不操作日历弹窗）
function jumpToDate(dateKey) {
  // 切换日期时关闭子任务面板，避免面板残留显示其他日期的任务数据
  closeSubtaskPanel();

  state.dateKey   = dateKey;
  state.tasks     = loadTasks(dateKey);
  state.activeTag = null;

  // 隐藏延续完成横幅（切换日期时清除）
  const carry_banner = document.getElementById('carry-done-banner');
  if (carry_banner) carry_banner.classList.add('hidden');

  document.getElementById('date-display').textContent = formatDateDisplay(dateKey);
  renderTasks();
  updateMemoBtnState();
  updateWorkhardBtn();

  // 延续进场动画：仅对首次出现的延续任务（carryShown === false）播放一次
  const tasks_to_animate = state.tasks.filter(t => !t.done && (t.delay_days || 0) > 0 && !t.carryShown);
  if (tasks_to_animate.length > 0) {
    // 立即标记为已展示并持久化，确保后续导航不再重复播放
    state.tasks = state.tasks.map(t =>
      tasks_to_animate.some(at => at.id === t.id) ? { ...t, carryShown: true } : t
    );
    saveTasks(dateKey, state.tasks);
    // 捕获当前 dateKey，防止用户在 stagger 动画窗口内切换日期导致旧 setTimeout
    // 操作新日期的 DOM 元素（即使 querySelector 找到同 ID 元素也可能误加样式）
    const anim_date_key = dateKey;
    tasks_to_animate.forEach(({ id }, i) => {
      setTimeout(() => {
        if (state.dateKey !== anim_date_key) return; // 用户已切换日期，丢弃旧动画
        const el = document.querySelector(`[data-task-id="${id}"]`);
        if (!el) return;
        el.classList.add('carry-fly-in');
        el.addEventListener('animationend', () => el.classList.remove('carry-fly-in'), { once: true });
        // 兜底：animationend 若被吞则超时清除
        setTimeout(() => el.classList.remove('carry-fly-in'), 700);
      }, i * 60);
    });
  }

  // 若日常备忘录弹窗已打开，同步更新日期和内容
  const memoOverlay = document.getElementById('memo-overlay');
  if (!memoOverlay.classList.contains('hidden') && state.memoContext?.type === 'daily') {
    syncMemoModal();
  }
}

// 月份切换：direction +1 下月，-1 上月
function changeCalMonth(direction) {
  state.calMonth += direction;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  if (state.calMonth < 0)  { state.calMonth = 11; state.calYear--; }
  renderCalendarGrid(direction);
}

function openCalendar() {
  // 日历视图对齐到当前查看日期所在月
  const [y, m] = state.dateKey.split('-').map(Number);
  state.calYear  = y;
  state.calMonth = m - 1;

  const overlay = document.getElementById('cal-overlay');
  overlay.classList.remove('hidden', 'closing');
  overlay.setAttribute('aria-hidden', 'false');
  renderCalendarGrid();
}

function closeCalendar() {
  const overlay = document.getElementById('cal-overlay');
  overlay.classList.add('closing');

  function onEnd(e) {
    if (e.target !== overlay) return;
    if (!overlay.classList.contains('closing')) return; // 已被 openCalendar 取消关闭
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.removeEventListener('animationend', onEnd);
  }
  overlay.addEventListener('animationend', onEnd);
}

function initCalendar() {
  const overlay = document.getElementById('cal-overlay');

  document.getElementById('cal-btn').addEventListener('click', openCalendar);

  // 月份切换
  document.getElementById('cal-prev-month').addEventListener('click', () => changeCalMonth(-1));
  document.getElementById('cal-next-month').addEventListener('click', () => changeCalMonth(1));

  // 今日按钮：直接跳转到今日并关闭日历
  document.getElementById('cal-today-btn').addEventListener('click', () => {
    jumpToDate(getTodayKey());
    closeCalendar();
  });

  // 点击遮罩关闭
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeCalendar();
  });

  // Esc 关闭（与 memo 独立判断，互不干扰）
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeCalendar();
  });
}

// ── 计时器模块 ────────────────────────────────────────────

const TIMER_CIRCUMFERENCE = 2 * Math.PI * 90; // ≈ 565.49

const timerState = {
  seconds: 0,            // 已累计秒数（暂停时为权威值）
  running: false,
  intervalId: null,
  startTimestamp: null,  // 运行中：Date.now() - seconds*1000（用于从挂钟还原真实时长）
  prevSecondsInMinute: -1,
};

// 缓存刻度 DOM 节点，避免每秒重复查询
let timerTickEls = null;

// 从挂钟时间同步经过秒数，规避后台 setInterval 降频问题
function timerSyncFromClock() {
  if (!timerState.running || timerState.startTimestamp === null) return;
  timerState.seconds = Math.floor((Date.now() - timerState.startTimestamp) / 1000);
  timerUpdateDisplay();
}

function timerFormatDigits(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return {
    h: String(h).padStart(2, '0'),
    m: String(m).padStart(2, '0'),
    s: String(s).padStart(2, '0'),
  };
}

function timerFlipDigit(el, newVal) {
  if (el.textContent === newVal) return;
  el.classList.remove('flipping');
  void el.offsetWidth; // force reflow to restart animation
  el.textContent = newVal;
  el.classList.add('flipping');
  el.addEventListener('animationend', () => el.classList.remove('flipping'), { once: true });
}

function timerUpdateRing(secondsInMinute) {
  const progressRing = document.getElementById('timer-ring-progress');
  if (!progressRing) return;

  const prev = timerState.prevSecondsInMinute;
  // 用 < 比较检测分钟跨越：无论 interval 是否跳过了第 0 秒都能正确触发
  // 例如从第 59 秒直接跳到第 61 秒（interval 被节流），1 < 59 = true，环形正确重置
  const isRollover = secondsInMinute < prev && prev > 0;
  const isReset    = timerState.seconds === 0;

  // 分钟跨越或重置时：无动画瞬间跳回空
  if (isRollover || isReset) {
    progressRing.classList.add('no-transition');
    progressRing.style.strokeDashoffset = TIMER_CIRCUMFERENCE;
    progressRing.getBoundingClientRect(); // force reflow
    progressRing.classList.remove('no-transition');
  }

  if (!isReset) {
    const progress = secondsInMinute / 60;
    const offset   = TIMER_CIRCUMFERENCE * (1 - progress);
    progressRing.style.strokeDashoffset = offset;
  }

  timerState.prevSecondsInMinute = secondsInMinute;
}

function timerUpdateTicks(secondsInMinute) {
  if (!timerTickEls) return;
  timerTickEls.forEach((tick, i) => {
    tick.classList.toggle('tick-active', i === secondsInMinute);
  });
}

function timerUpdateDisplay() {
  const { h, m, s } = timerFormatDigits(timerState.seconds);

  timerFlipDigit(document.getElementById('timer-hours'),      h);
  timerFlipDigit(document.getElementById('timer-minutes'),    m);
  timerFlipDigit(document.getElementById('timer-seconds-el'), s);

  // 最小化时 header 里的紧凑时间显示
  const headerTime = document.getElementById('timer-header-time');
  if (headerTime) headerTime.textContent = `${h}:${m}:${s}`;

  const secondsInMinute = timerState.seconds % 60;
  timerUpdateRing(secondsInMinute);
  timerUpdateTicks(secondsInMinute);
}

function timerUpdateButtonUI() {
  const startBtn    = document.getElementById('timer-start-btn');
  const progressRing = document.getElementById('timer-ring-progress');
  const digitsEl    = document.getElementById('timer-digits');
  const timerNavBtn = document.getElementById('timer-btn');

  if (timerState.running) {
    startBtn.textContent = '⏸ PAUSE';
    startBtn.classList.add('running');
    progressRing?.classList.add('running');
    progressRing?.classList.remove('paused');
    digitsEl?.classList.add('running');
    digitsEl?.classList.remove('paused');
    timerNavBtn?.classList.add('running');
  } else {
    startBtn.textContent = '▶ START';
    startBtn.classList.remove('running');
    progressRing?.classList.remove('running');
    digitsEl?.classList.remove('running');
    timerNavBtn?.classList.remove('running');

    if (timerState.seconds > 0) {
      progressRing?.classList.add('paused');
      digitsEl?.classList.add('paused');
    } else {
      progressRing?.classList.remove('paused');
      digitsEl?.classList.remove('paused');
    }
  }
}

function timerStart() {
  if (timerState.running) return;
  // 记录偏移后的起始时间，保留已暂停的累计秒数
  timerState.startTimestamp = Date.now() - timerState.seconds * 1000;
  timerState.running = true;
  timerState.intervalId = setInterval(timerSyncFromClock, 1000);
  timerUpdateButtonUI();
}

function timerPause() {
  if (!timerState.running) return;
  timerSyncFromClock(); // 暂停前最后同步一次，确保精度
  timerState.running = false;
  timerState.startTimestamp = null;
  clearInterval(timerState.intervalId);
  timerState.intervalId = null;
  timerUpdateButtonUI();
}

function timerReset() {
  timerPause();
  timerState.seconds = 0;
  timerState.prevSecondsInMinute = -1;

  // 红色闪烁反馈
  const progressRing = document.getElementById('timer-ring-progress');
  if (progressRing) {
    progressRing.classList.add('resetting');
    setTimeout(() => {
      progressRing.classList.remove('resetting');
      timerUpdateDisplay();
      timerUpdateButtonUI();
    }, 380);
  } else {
    timerUpdateDisplay();
    timerUpdateButtonUI();
  }
}

function timerBuildTicks() {
  const group = document.getElementById('timer-ticks');
  if (!group) return;

  const CX = 120, CY = 120, RADIUS = 108;

  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const x = CX + RADIUS * Math.cos(angle);
    const y = CY + RADIUS * Math.sin(angle);
    const isMajor = i % 5 === 0;

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', x.toFixed(3));
    dot.setAttribute('cy', y.toFixed(3));
    dot.setAttribute('r',  isMajor ? '3.5' : '2');
    dot.classList.add('timer-tick');
    if (isMajor) dot.classList.add('major');
    group.appendChild(dot);
  }
  // 初始化后缓存刻度节点，避免每秒 querySelectorAll
  timerTickEls = group.querySelectorAll('.timer-tick');
}

function openTimerPanel() {
  const panel = document.getElementById('timer-panel');

  // 首次显示（尚未 fixed 定位）：移至 body 并计算默认位置
  if (panel.style.position !== 'fixed') {
    const slot    = document.querySelector('.timer-slot');
    const hardBtn = document.getElementById('workhard-btn');
    const slotRect = slot ? slot.getBoundingClientRect() : { left: 100 };
    const hardRect = hardBtn.getBoundingClientRect();

    // 面板尺寸常量
    const PANEL_WIDTH       = 320;
    const PANEL_HEIGHT      = 380; // 展开态估算（用于防止展开后超出屏幕底部）
    const MINIMIZED_HEIGHT  =  46; // 最小化态高度（padding 13+12 + 内容≈21，无 border-bottom）

    // 垂直：最小化时 header 中线与 hard 按钮中线平齐
    const hardCenterY = hardRect.top + hardRect.height / 2;
    const panelTop    = Math.max(0, Math.min(
      hardCenterY - MINIMIZED_HEIGHT / 2,
      window.innerHeight - PANEL_HEIGHT
    ));
    // 水平：与 slot 左边对齐
    const panelLeft = Math.max(0, Math.min(
      slotRect.left,
      window.innerWidth - PANEL_WIDTH
    ));

    document.body.appendChild(panel);
    panel.style.position = 'fixed';
    panel.style.top      = panelTop  + 'px';
    panel.style.left     = panelLeft + 'px';
    panel.style.right    = 'auto';
    panel.style.bottom   = 'auto';
    panel.style.width    = PANEL_WIDTH + 'px';
  }

  panel.classList.remove('hidden', 'closing', 'minimized');
  document.getElementById('timer-minimize-btn').textContent = '_';
}

function closeTimerPanel() {
  const panel = document.getElementById('timer-panel');
  panel.classList.add('closing');
  // 必须检查 e.target：环形/冒号/数字的动画结束事件会冒泡到 panel，
  // 若用 { once: true } 不加 target 检查，子元素事件会提前触发导致面板瞬间消失
  function onEnd(e) {
    if (e.target !== panel) return;
    panel.removeEventListener('animationend', onEnd);
    panel.classList.add('hidden');
    panel.classList.remove('closing');
  }
  panel.addEventListener('animationend', onEnd);
}

function toggleMinimizeTimer() {
  const panel = document.getElementById('timer-panel');
  const isMinimized = panel.classList.toggle('minimized');
  document.getElementById('timer-minimize-btn').textContent = isMinimized ? '□' : '_';
}

function initTimerDrag() {
  const panel  = document.getElementById('timer-panel');
  const handle = document.getElementById('timer-drag-handle');

  let dragging   = false;
  let start_x    = 0, start_y = 0;
  let panel_left = 0, panel_top = 0;

  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('.timer-window-btn')) return;

    // panel 始终已是 fixed 定位（由 openTimerPanel 保证），直接开始拖拽
    dragging   = true;
    start_x    = e.clientX;
    start_y    = e.clientY;
    panel_left = parseFloat(panel.style.left)  || 0;
    panel_top  = parseFloat(panel.style.top)   || 0;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!dragging) return;
    const new_left = panel_left + (e.clientX - start_x);
    const new_top  = panel_top  + (e.clientY - start_y);
    const maxLeft  = window.innerWidth  - panel.offsetWidth;
    const maxTop   = window.innerHeight - panel.offsetHeight;
    panel.style.left = Math.max(0, Math.min(new_left, maxLeft)) + 'px';
    panel.style.top  = Math.max(0, Math.min(new_top,  maxTop))  + 'px';
  });

  handle.addEventListener('pointerup', e => {
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
  });
}

function initTimer() {
  timerBuildTicks();
  timerUpdateDisplay();
  timerUpdateButtonUI();

  // 导航栏触发按钮
  document.getElementById('timer-btn').addEventListener('click', () => {
    const panel = document.getElementById('timer-panel');
    if (panel.classList.contains('hidden')) {
      openTimerPanel();
    } else {
      closeTimerPanel();
    }
  });

  document.getElementById('timer-close-btn').addEventListener('click', closeTimerPanel);
  document.getElementById('timer-minimize-btn').addEventListener('click', toggleMinimizeTimer);

  document.getElementById('timer-start-btn').addEventListener('click', () => {
    if (timerState.running) timerPause();
    else timerStart();
  });

  document.getElementById('timer-reset-btn').addEventListener('click', timerReset);

  // 切回前台时立即从挂钟同步，修正后台期间 setInterval 被冻结的误差
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) timerSyncFromClock();
  });

  // 页面卸载时清理 interval，防止后台泄漏
  window.addEventListener('pagehide', () => {
    if (timerState.intervalId) {
      clearInterval(timerState.intervalId);
      timerState.intervalId = null;
    }
  });

  initTimerDrag();
}

// ── WorkHard 按钮 ─────────────────────────────────────────

function updateWorkhardBtn() {
  const btn = document.getElementById('workhard-btn');
  if (!btn) return;
  const active = isWorkhard(state.dateKey);
  if (active) {
    btn.classList.add('is-active');
    btn.textContent = 'HARD!';
    btn.title = '今天已标记努力！点击取消';
  } else {
    btn.classList.remove('is-active');
    btn.textContent = 'hard?';
    btn.title = '今天努力了吗？点击标记';
  }
}

function animateWorkhardActivate(btn) {
  const rect = btn.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // 粒子爆发
  const CHARS = ['✦', '★', '◆', '✸', '+', '*', '·', '⚡', '✺', '◈'];
  const COUNT = 16;
  for (let i = 0; i < COUNT; i++) {
    const angle = (360 / COUNT) * i + (Math.random() - 0.5) * 15;
    const dist  = 55 + Math.random() * 85;
    const tx    = Math.cos(angle * Math.PI / 180) * dist;
    const ty    = Math.sin(angle * Math.PI / 180) * dist;
    const dur   = 550 + Math.random() * 500;
    const delay = Math.random() * 100;
    const char  = CHARS[Math.floor(Math.random() * CHARS.length)];
    const size  = 9 + Math.random() * 9;

    const p = document.createElement('span');
    p.className = 'workhard-particle';
    p.textContent = char;
    p.style.cssText = `left:${cx}px;top:${cy}px;font-size:${size}px;--tx:${tx}px;--ty:${ty}px;--dur:${dur}ms;--delay:${delay}ms;`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), dur + delay + 80);
  }

  // 三道涟漪环
  for (let i = 0; i < 3; i++) {
    const ring = document.createElement('div');
    ring.className = 'workhard-ripple';
    ring.style.cssText = `left:${cx}px;top:${cy}px;--dur:${680 + i * 160}ms;--delay:${i * 120}ms;`;
    document.body.appendChild(ring);
    setTimeout(() => ring.remove(), 1200);
  }

  // 弹出文字
  const popup = document.createElement('div');
  popup.className = 'workhard-popup-text';
  popup.textContent = 'WORK HARD!';
  popup.style.cssText = `left:${cx}px;top:${cy}px;`;
  document.body.appendChild(popup);
  setTimeout(() => popup.remove(), 1150);

  // 屏幕边缘闪光
  const flash = document.createElement('div');
  flash.className = 'workhard-flash';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 700);

  // 按钮自身爆炸
  btn.classList.add('workhard-bursting');
  setTimeout(() => btn.classList.remove('workhard-bursting'), 520);
}

function animateWorkhardDeactivate(btn) {
  btn.classList.add('workhard-deactivating');
  setTimeout(() => btn.classList.remove('workhard-deactivating'), 420);
}

function toggleWorkhard() {
  const btn = document.getElementById('workhard-btn');
  const currently_active = isWorkhard(state.dateKey);
  setWorkhard(state.dateKey, !currently_active);

  if (!currently_active) {
    btn.classList.add('is-active');
    btn.textContent = 'HARD!';
    btn.title = '今天已标记努力！点击取消';
    animateWorkhardActivate(btn);
  } else {
    btn.classList.remove('is-active');
    btn.textContent = 'hard?';
    btn.title = '今天努力了吗？点击标记';
    animateWorkhardDeactivate(btn);
  }

  // 若日历已打开则刷新格子
  const calOverlay = document.getElementById('cal-overlay');
  if (calOverlay && !calOverlay.classList.contains('hidden')) {
    renderCalendarGrid();
  }
}

// ── 子任务功能 ────────────────────────────────────────────

let subtask_panel_task_id = null; // 当前打开的子任务面板对应的任务 ID

// 获取子任务完成进度
function getSubtaskProgress(task) {
  const subtasks = task.subtasks || [];
  return { done: subtasks.filter(s => s.done).length, total: subtasks.length };
}

// 构建主任务条目内嵌进度条元素
function buildSubtaskInlineProgress(task) {
  const { done, total } = getSubtaskProgress(task);
  const pct       = Math.round((done / total) * 100);
  const all_done  = done === total;
  const fill_color = all_done ? 'var(--accent)' : PRIORITY_COLORS[task.priority];

  const container = document.createElement('div');
  container.className = 'subtask-inline-progress';

  const bar_wrap = document.createElement('div');
  bar_wrap.className = 'subtask-inline-bar';

  const fill = document.createElement('div');
  fill.className = `subtask-inline-fill${all_done ? ' all-done' : ''}`;
  fill.style.width = `${pct}%`;
  fill.style.background = fill_color;
  bar_wrap.appendChild(fill);

  const count = document.createElement('span');
  count.className = `subtask-inline-count${all_done ? ' all-done' : ''}`;
  count.textContent = `${done}/${total}${all_done ? ' ✓' : ''}`;

  container.appendChild(bar_wrap);
  container.appendChild(count);

  // 点击内嵌进度条直接打开子任务面板
  container.addEventListener('click', e => {
    e.stopPropagation();
    openSubtaskPanel(task.id);
  });

  return container;
}

// 更新主任务条目内的进度条（不触发整体 renderTasks）
function updateSubtaskInline(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const task_el = document.querySelector(`[data-task-id="${taskId}"]`);
  if (!task_el) return;

  const text_block = task_el.querySelector('.task-text-block');
  if (!text_block) return;

  const existing = text_block.querySelector('.subtask-inline-progress');
  if (existing) existing.remove();

  const subtasks = task.subtasks || [];
  if (subtasks.length === 0) return;

  const new_progress = buildSubtaskInlineProgress(task);
  text_block.appendChild(new_progress);

  // 全部完成时触发迷你庆祝粒子
  const { done, total } = getSubtaskProgress(task);
  if (done === total && total > 0) {
    spawnSubtaskParticles(task_el);
  }
}

// 全部子任务完成时的迷你粒子爆发
function spawnSubtaskParticles(el) {
  const rect  = el.getBoundingClientRect();
  const cx    = rect.left + 60;
  const cy    = rect.top + rect.height / 2;
  const CHARS = ['✦', '+', '·', '★', '◆'];

  for (let i = 0; i < 8; i++) {
    const angle = (360 / 8) * i;
    const dist  = 20 + Math.random() * 28;
    const tx    = Math.cos(angle * Math.PI / 180) * dist;
    const ty    = Math.sin(angle * Math.PI / 180) * dist;
    const char  = CHARS[Math.floor(Math.random() * CHARS.length)];

    const p = document.createElement('span');
    p.className  = 'subtask-complete-particle';
    p.textContent = char;
    p.style.cssText = `left:${cx}px;top:${cy}px;--tx:${tx}px;--ty:${ty}px;`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 720);
  }
}

// ── 子任务 CRUD ───────────────────────────────────────────

function addSubtask(taskId, text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  state.tasks = state.tasks.map(t => {
    if (t.id !== taskId) return t;
    const new_sub = { id: generateId(), text: trimmed, done: false, createdAt: Date.now() };
    return { ...t, subtasks: [...(t.subtasks || []), new_sub] };
  });

  saveTasks(state.dateKey, state.tasks);

  const task = state.tasks.find(t => t.id === taskId);
  renderSubtaskPanel(task);
  updateSubtaskInline(taskId);
}

function toggleSubtask(taskId, subtaskId) {
  let main_task_reopened = false;

  state.tasks = state.tasks.map(t => {
    if (t.id !== taskId) return t;
    const subtasks = (t.subtasks || []).map(s =>
      s.id === subtaskId ? { ...s, done: !s.done } : s
    );
    // 若主任务已完成而子任务被反选，联动恢复主任务
    const any_undone = subtasks.some(s => !s.done);
    const should_reopen = t.done && any_undone;
    if (should_reopen) main_task_reopened = true;
    return { ...t, subtasks, done: should_reopen ? false : t.done };
  });

  saveTasks(state.dateKey, state.tasks);

  const task = state.tasks.find(t => t.id === taskId);
  renderSubtaskPanel(task);
  updateSubtaskInline(taskId);

  // 主任务状态变化时刷新整体视图（完成/未完成排序会改变）
  if (main_task_reopened) {
    renderTasks();
  }

  checkAutoComplete(taskId);
}

function deleteSubtask(taskId, subtaskId) {
  state.tasks = state.tasks.map(t => {
    if (t.id !== taskId) return t;
    return { ...t, subtasks: (t.subtasks || []).filter(s => s.id !== subtaskId) };
  });

  saveTasks(state.dateKey, state.tasks);

  const task = state.tasks.find(t => t.id === taskId);
  renderSubtaskPanel(task);
  updateSubtaskInline(taskId);
}

function editSubtask(taskId, subtaskId, newText) {
  const trimmed = newText.trim();
  if (!trimmed) return;

  state.tasks = state.tasks.map(t => {
    if (t.id !== taskId) return t;
    return {
      ...t,
      subtasks: (t.subtasks || []).map(s =>
        s.id === subtaskId ? { ...s, text: trimmed } : s
      ),
    };
  });

  saveTasks(state.dateKey, state.tasks);

  const task = state.tasks.find(t => t.id === taskId);
  renderSubtaskPanel(task);
}

// ── 子任务全完成自动提示 ──────────────────────────────────

function checkAutoComplete(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task || task.done) return;

  const { done, total } = getSubtaskProgress(task);
  if (total > 0 && done === total) {
    showSubtaskCompleteToast(taskId);
  }
}

function showSubtaskCompleteToast(taskId) {
  if (document.getElementById('subtask-autocomplete-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'subtask-autocomplete-toast';
  toast.className = 'subtask-toast';

  const msg = document.createElement('span');
  msg.className = 'subtask-toast-text';
  msg.textContent = '所有子任务已完成，标记主任务为完成？';

  const actions = document.createElement('div');
  actions.className = 'subtask-toast-actions';

  const yes_btn = document.createElement('button');
  yes_btn.className = 'subtask-toast-yes';
  yes_btn.textContent = '是';

  const no_btn = document.createElement('button');
  no_btn.className = 'subtask-toast-no';
  no_btn.textContent = '否';

  actions.appendChild(yes_btn);
  actions.appendChild(no_btn);
  toast.appendChild(msg);
  toast.appendChild(actions);
  document.body.appendChild(toast);

  const auto_dismiss = setTimeout(() => { if (toast.isConnected) toast.remove(); }, 6000);

  yes_btn.addEventListener('click', () => {
    clearTimeout(auto_dismiss);
    toast.remove();
    state.tasks = state.tasks.map(t =>
      t.id === taskId ? { ...t, done: true } : t
    );
    state.completingId = taskId;
    saveTasks(state.dateKey, state.tasks);
    renderTasks();
    state.completingId = null;
    closeSubtaskPanel();
  });

  no_btn.addEventListener('click', () => {
    clearTimeout(auto_dismiss);
    toast.remove();
  });
}

// ── 子任务面板 ────────────────────────────────────────────

function closeSubtaskPanel() {
  const overlay = document.getElementById('subtask-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  overlay.classList.add('closing');
  subtask_panel_task_id = null;

  function onEnd(e) {
    if (e.target !== overlay) return;
    if (!overlay.classList.contains('closing')) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('closing');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.removeEventListener('animationend', onEnd);
  }
  overlay.addEventListener('animationend', onEnd);

  // 兜底：animationend 未触发时强制隐藏
  setTimeout(() => {
    if (overlay.classList.contains('closing')) {
      overlay.classList.add('hidden');
      overlay.classList.remove('closing');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }, 350);
}

// 渲染面板内子任务列表和进度（面板已打开时调用）
function renderSubtaskPanel(task) {
  if (!task || subtask_panel_task_id !== task.id) return;

  const overlay = document.getElementById('subtask-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;

  const panel = document.getElementById('subtask-panel');
  if (!panel) return;

  const subtasks  = task.subtasks || [];
  const { done, total } = getSubtaskProgress(task);
  const pct       = total === 0 ? 0 : Math.round((done / total) * 100);
  const all_done  = total > 0 && done === total;
  const fill_color = all_done ? 'var(--accent)' : PRIORITY_COLORS[task.priority];

  // 更新进度条和计数
  const fill_el = panel.querySelector('.subtask-panel-progress-fill');
  if (fill_el) {
    fill_el.style.width = `${pct}%`;
    fill_el.style.background = fill_color;
  }

  const count_el = panel.querySelector('.subtask-panel-progress-count');
  if (count_el) {
    count_el.textContent = total === 0 ? '暂无子任务' : `${done} / ${total} 完成`;
    count_el.className = `subtask-panel-progress-count${all_done ? ' all-done' : ''}`;
  }

  // 渲染子任务列表
  const list = panel.querySelector('.subtask-list');
  if (!list) return;
  list.innerHTML = '';

  subtasks.forEach(sub => {
    const item = document.createElement('div');
    item.className = `subtask-item${sub.done ? ' done' : ''}`;

    const checkbox = document.createElement('span');
    checkbox.className = 'subtask-checkbox';
    checkbox.textContent = sub.done ? '[x]' : '[ ]';

    const text_el = document.createElement('span');
    text_el.className = 'subtask-text';
    text_el.textContent = sub.text;

    const del_btn = document.createElement('button');
    del_btn.className = 'subtask-delete-btn';
    del_btn.textContent = '×';
    del_btn.title = '删除子任务';
    del_btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteSubtask(task.id, sub.id);
    });

    // 整个条目单击触发完成（与主任务行为一致），双击文字进入编辑
    let subtask_click_timer = null;
    text_el.addEventListener('dblclick', e => {
      e.stopPropagation();
      clearTimeout(subtask_click_timer);
      startSubtaskEditing(item, task.id, sub, text_el);
    });
    item.addEventListener('click', e => {
      if (e.target.closest('.subtask-delete-btn')) return;
      if (e.target.tagName === 'INPUT') return;
      clearTimeout(subtask_click_timer);
      subtask_click_timer = setTimeout(() => toggleSubtask(task.id, sub.id), 180);
    });

    item.appendChild(checkbox);
    item.appendChild(text_el);
    item.appendChild(del_btn);
    list.appendChild(item);
  });
}

// 子任务内联编辑
function startSubtaskEditing(item, taskId, sub, text_el) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'subtask-edit-input';
  input.value = sub.text;
  input.addEventListener('click', e => e.stopPropagation());
  item.replaceChild(input, text_el);
  input.focus();
  input.select();

  let committed = false;

  function commit() {
    if (committed) return;
    committed = true;
    // input.value.trim() 为空时回退到原始文本，防止纯空格提交后面板 DOM 状态异常
    editSubtask(taskId, sub.id, input.value.trim() || sub.text);
  }

  function cancel() {
    if (committed) return;
    committed = true;
    const task = state.tasks.find(t => t.id === taskId);
    if (task) renderSubtaskPanel(task);
  }

  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  });
  input.addEventListener('blur', commit);
}

// 打开子任务面板
function openSubtaskPanel(taskId) {
  // 再次点击同一任务则关闭
  if (subtask_panel_task_id === taskId) {
    closeSubtaskPanel();
    return;
  }

  const overlay = document.getElementById('subtask-overlay');
  if (!overlay) return;

  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  subtask_panel_task_id = taskId;

  // 先构建面板骨架（不渲染子任务列表，overlay 此时还是 hidden）
  buildSubtaskPanel(task);

  // 居中显示（与备忘录弹窗相同逻辑）
  overlay.classList.remove('hidden', 'closing');
  overlay.setAttribute('aria-hidden', 'false');

  // overlay 显示后再渲染子任务列表（此时可通过 overlay 可见性检查）
  renderSubtaskPanel(task);

  // 自动聚焦添加输入框
  setTimeout(() => {
    const add_input = document.querySelector('.subtask-add-input');
    if (add_input) add_input.focus();
  }, 60);
}

// 构建面板完整 DOM 结构
function buildSubtaskPanel(task) {
  const panel = document.getElementById('subtask-panel');

  // 头部
  const header = document.createElement('div');
  header.className = 'subtask-panel-header';

  const prompt = document.createElement('span');
  prompt.className = 'subtask-panel-prompt';
  prompt.textContent = '>';

  const title = document.createElement('span');
  title.className = 'subtask-panel-header-title';
  title.textContent = task.text;

  const close_btn = document.createElement('button');
  close_btn.className = 'subtask-panel-close';
  close_btn.textContent = '×';
  close_btn.addEventListener('click', closeSubtaskPanel);

  header.appendChild(prompt);
  header.appendChild(title);
  header.appendChild(close_btn);

  // 进度区域
  const progress_section = document.createElement('div');
  progress_section.className = 'subtask-panel-progress';

  const bar_wrap = document.createElement('div');
  bar_wrap.className = 'subtask-panel-progress-bar';

  const fill = document.createElement('div');
  fill.className = 'subtask-panel-progress-fill';
  fill.style.background = PRIORITY_COLORS[task.priority];
  bar_wrap.appendChild(fill);

  const count_el = document.createElement('span');
  count_el.className = 'subtask-panel-progress-count';
  count_el.textContent = '暂无子任务';

  progress_section.appendChild(bar_wrap);
  progress_section.appendChild(count_el);

  // 子任务列表（内容由 renderSubtaskPanel 填充）
  const list = document.createElement('div');
  list.className = 'subtask-list';

  // 添加子任务区域
  const add_section = document.createElement('div');
  add_section.className = 'subtask-add-section';

  const add_prompt = document.createElement('span');
  add_prompt.className = 'subtask-add-prompt';
  add_prompt.textContent = '+';

  const add_input = document.createElement('input');
  add_input.type = 'text';
  add_input.className = 'subtask-add-input';
  add_input.placeholder = '添加子任务... (Enter 提交)';
  add_input.autocomplete = 'off';
  add_input.spellcheck = false;
  add_input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const text = add_input.value.trim();
      if (!text) {
        add_input.classList.add('shake');
        add_input.addEventListener('animationend', () => add_input.classList.remove('shake'), { once: true });
        return;
      }
      addSubtask(task.id, text);
      add_input.value = '';
      add_input.focus();
    }
    if (e.key === 'Escape') closeSubtaskPanel();
  });

  add_section.appendChild(add_prompt);
  add_section.appendChild(add_input);

  // 组装面板骨架（子任务内容由 openSubtaskPanel 在 overlay 显示后填充）
  panel.innerHTML = '';
  panel.appendChild(header);
  panel.appendChild(progress_section);
  panel.appendChild(list);
  panel.appendChild(add_section);
}

// 注册子任务面板全局事件（overlay 点击关闭、Esc 关闭）
function initSubtaskPanel() {
  const overlay = document.getElementById('subtask-overlay');
  // 只有点击遮罩背景本身（而非面板内部）才关闭
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeSubtaskPanel();
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!overlay.classList.contains('hidden')) closeSubtaskPanel();
  });
}

// ── 长按检测 ──────────────────────────────────────────────

function initLongPress(li, taskId) {
  let press_timer        = null;
  let start_x            = 0, start_y = 0;
  let long_press_did_fire = false;

  li.addEventListener('pointerdown', e => {
    // 仅响应鼠标左键或触摸
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 忽略交互元素上的按压，避免干扰现有按钮和标签
    if (e.target.closest('.delete-btn, .priority-btn, .tag-chip, .delay-badge, .task-checkbox, input')) return;

    // 清除可能残留的旧计时器（多指触摸等异常情况）
    clearTimeout(press_timer);
    press_timer = null;

    start_x = e.clientX;
    start_y = e.clientY;
    long_press_did_fire = false;

    press_timer = setTimeout(() => {
      long_press_did_fire = true;
      li.classList.add('pressing');
      if (navigator.vibrate) navigator.vibrate(40); // 移动端触觉反馈
      openSubtaskPanel(taskId);
    }, LONG_PRESS_MS);
  });

  li.addEventListener('pointermove', e => {
    if (!press_timer) return;
    // 移动超出阈值视为滚动意图，取消长按
    if (Math.hypot(e.clientX - start_x, e.clientY - start_y) > LONG_PRESS_MOVE_THRESHOLD) {
      clearTimeout(press_timer);
      press_timer = null;
    }
  });

  li.addEventListener('pointerup', () => {
    clearTimeout(press_timer);
    press_timer = null;
    setTimeout(() => li.classList.remove('pressing'), 80);
  });

  li.addEventListener('pointercancel', () => {
    clearTimeout(press_timer);
    press_timer = null;
    li.classList.remove('pressing');
  });

  // 长按触发后在捕获阶段吸收下一次 click，防止误触发 toggleTask
  li.addEventListener('click', e => {
    if (!long_press_did_fire) return;
    long_press_did_fire = false;
    e.stopPropagation();
  }, { capture: true });
}

// ── 初始化 ────────────────────────────────────────────────

const state = {
  dateKey: getTodayKey(),
  tasks: [],
  completingId: null,
  activeTag: null,
  goals: [],
  newItemType: 'todo',
  activeGoalView: 'todo',
  is_archive_collapsed: false,
  memoContext: { type: 'daily' },
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(),   // 0-indexed
};

// ── 后端数据加载与 localStorage 自动迁移 ─────────────────────

function _isBackendEmpty(data) {
  return (
    Object.keys(data.tasks      || {}).length === 0 &&
    (data.goals                 || []).length === 0  &&
    Object.keys(data.workhard   || {}).length === 0  &&
    Object.keys(data.memos      || {}).length === 0  &&
    Object.keys(data.goal_memos || {}).length === 0
  );
}

async function _migrateLocalStorageIfNeeded() {
  const ls_tasks     = JSON.parse(localStorage.getItem(STORAGE_KEY)           || '{}');
  const ls_goals     = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY)     || '[]');
  const ls_workhard  = JSON.parse(localStorage.getItem(WORKHARD_STORAGE_KEY)  || '{}');
  const ls_memos     = JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY)      || '{}');
  const ls_goalMemos = JSON.parse(localStorage.getItem(GOAL_MEMO_STORAGE_KEY) || '{}');

  const has_local_data =
    Object.keys(ls_tasks).length > 0 ||
    ls_goals.length > 0 ||
    Object.keys(ls_workhard).length > 0;

  if (!has_local_data) return;

  try {
    await fetch(`${API_BASE}/migrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: ls_tasks, goals: ls_goals,
        workhard: ls_workhard, memos: ls_memos, goal_memos: ls_goalMemos,
      }),
    });
    showInfoToast('✓ 已将本地历史数据迁移至后端，数据安全有保障！');
  } catch (e) {
    console.warn('[daily_plan] localStorage 迁移失败:', e);
  }
}

async function loadFromBackend() {
  try {
    const res = await fetch(`${API_BASE}/data`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    cache.tasks     = data.tasks      || {};
    cache.workhard  = data.workhard   || {};
    cache.memos     = data.memos      || {};
    cache.goalMemos = data.goal_memos || {};
    cache.goals     = data.goals      || [];

    // 后端无数据时，自动将 localStorage 历史数据迁移过去
    if (_isBackendEmpty(data)) {
      await _migrateLocalStorageIfNeeded();
      // 迁移后重新加载
      const res2 = await fetch(`${API_BASE}/data`);
      if (res2.ok) {
        const data2 = await res2.json();
        cache.tasks     = data2.tasks      || {};
        cache.workhard  = data2.workhard   || {};
        cache.memos     = data2.memos      || {};
        cache.goalMemos = data2.goal_memos || {};
        cache.goals     = data2.goals      || [];
      }
    }
  } catch (e) {
    console.warn('[daily_plan] 后端不可用，回退到 localStorage:', e);
    showStorageError('⚠ 后端服务未运行，数据暂存本地。启动后端后刷新页面可同步。');
    cache.tasks     = JSON.parse(localStorage.getItem(STORAGE_KEY)           || '{}');
    cache.workhard  = JSON.parse(localStorage.getItem(WORKHARD_STORAGE_KEY)  || '{}');
    cache.memos     = JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY)      || '{}');
    cache.goalMemos = JSON.parse(localStorage.getItem(GOAL_MEMO_STORAGE_KEY) || '{}');
    cache.goals     = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY)     || '[]');
  }
}

async function init() {
  await loadFromBackend();
  document.getElementById('date-display').textContent = formatDateDisplay(state.dateKey);
  state.tasks = loadTasks(state.dateKey);
  renderTasks();

  const input = document.getElementById('task-input');
  const addBtn = document.getElementById('add-btn');

  function handleAdd() {
    addTask(input.value);
    input.value = '';
    input.focus();
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAdd();
  });

  addBtn.addEventListener('click', handleAdd);

  document.getElementById('prev-btn').addEventListener('click', () => navigateDate(-1));
  document.getElementById('next-btn').addEventListener('click', () => navigateDate(1));
  document.getElementById('carry-btn').addEventListener('click', carryOverTasks);
  document.getElementById('workhard-btn').addEventListener('click', toggleWorkhard);
  updateWorkhardBtn();

  // 左栏初始化
  state.goals = loadGoals();
  renderGoals();

  const goal_input = document.getElementById('goal-input');
  const goal_add_btn = document.getElementById('goal-add-btn');

  function handleGoalAdd() {
    addGoalItem(goal_input.value);
    goal_input.value = '';
    goal_input.focus();
  }

  goal_input.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleGoalAdd();
  });
  goal_add_btn.addEventListener('click', handleGoalAdd);

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => setNewItemType(btn.dataset.type));
  });

  initGoalPanelToggle();
  initMemo();
  initCalendar();
  initTimer();
  initSubtaskPanel();
  initKeyboardShortcuts();
}

function initKeyboardShortcuts() {
  const KEY_MAP = { a: 'prev-btn', d: 'next-btn', q: 'cal-btn', w: 'memo-btn', e: 'timer-btn' };

  document.addEventListener('keydown', e => {
    // 输入框/编辑区内不触发
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    // 有修饰键时不触发
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const btn_id = KEY_MAP[e.key];
    if (!btn_id) return;

    e.preventDefault();
    document.getElementById(btn_id)?.click();
  });
}

function initGoalPanelToggle() {
  const mq = window.matchMedia('(max-width: 900px)');
  const toggle = document.querySelector('.panel-goals-toggle');
  const panel = document.querySelector('.panel-goals');

  function handleToggleClick() {
    if (mq.matches) panel.classList.toggle('expanded');
  }

  toggle.addEventListener('click', handleToggleClick);
}

init();
