const STORAGE_KEY = 'daily_plan_data';
const GOALS_STORAGE_KEY = 'daily_plan_goals';
const WEEK_DAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };
const PRIORITY_COLORS = { high: '#e74c3c', medium: '#f1c40f', low: '#2ecc71' };
const DRAG_HOLD_MS = 150;
const DRAG_MOVE_THRESHOLD = 5;

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

// ── 数据持久化 ────────────────────────────────────────────

function loadAllData() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

// 向下兼容：为旧任务补充新字段
function migrateTask(task) {
  return { priority: 'medium', tags: [], ...task };
}

function loadTasks(dateKey) {
  return (loadAllData()[dateKey] || []).map(migrateTask);
}

function saveTasks(dateKey, tasks) {
  const all = loadAllData();
  all[dateKey] = tasks;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
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
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function addTask(rawText) {
  const { cleanText, tags } = parseTagsFromText(rawText);
  if (!cleanText) return;

  state.tasks = [...state.tasks, { id: generateId(), text: cleanText, done: false, createdAt: Date.now(), priority: 'medium', tags }];
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

  li.replaceChild(editInput, textEl);
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
  const priority_order = { high: 0, medium: 1, low: 2 };
  const visibleTasks = [...getVisibleTasks()].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return priority_order[a.priority] - priority_order[b.priority];
  });
  list.innerHTML = '';
  visibleTasks.forEach(task => {
    const li = document.createElement('li');
    li.className = `task-item${task.done ? ' done' : ''}`;
    li.dataset.taskId = task.id;

    if (task.id === state.completingId) {
      li.classList.add('completing');
    }

    const checkbox = document.createElement('div');
    checkbox.className = 'task-checkbox';
    checkbox.textContent = task.done ? '[x]' : '[ ]';

    const textEl = document.createElement('span');
    textEl.className = 'task-text';
    textEl.textContent = task.text;

    const tagChips = buildTagChips(task);
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
      if (e.target.tagName === 'INPUT') return;
      clearTimeout(click_timer);
      click_timer = setTimeout(() => toggleTask(task.id), 180);
    });

    deleteBtn.addEventListener('click', e => {
      e.stopPropagation();
      deleteTask(task.id);
    });

    li.appendChild(checkbox);
    li.appendChild(textEl);
    li.appendChild(tagChips);
    li.appendChild(priorityBtn);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });

  renderTagFilter();
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
  try {
    const data = JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY)) || {};
    return data[dateKey] || '';
  } catch {
    return '';
  }
}

function saveMemo(dateKey, text) {
  try {
    const data = JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY)) || {};
    if (text.trim()) {
      data[dateKey] = text;
    } else {
      delete data[dateKey];
    }
    localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// ── 目标备忘录持久化 ──────────────────────────────────────

const GOAL_MEMO_STORAGE_KEY = 'daily_plan_goal_memo';

function loadGoalMemo(goalId) {
  try {
    return (JSON.parse(localStorage.getItem(GOAL_MEMO_STORAGE_KEY)) || {})[goalId] || '';
  } catch {
    return '';
  }
}

function saveGoalMemo(goalId, text) {
  try {
    const data = JSON.parse(localStorage.getItem(GOAL_MEMO_STORAGE_KEY)) || {};
    if (text.trim()) {
      data[goalId] = text;
    } else {
      delete data[goalId];
    }
    localStorage.setItem(GOAL_MEMO_STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// 目标删除时清理其备忘录，防止存储泄漏
function deleteGoalMemo(goalId) {
  try {
    const data = JSON.parse(localStorage.getItem(GOAL_MEMO_STORAGE_KEY)) || {};
    delete data[goalId];
    localStorage.setItem(GOAL_MEMO_STORAGE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// 一次性读取全量备忘录（供日历渲染使用，避免逐日读取）
function loadAllMemos() {
  try {
    return JSON.parse(localStorage.getItem(MEMO_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

// 获取某日期的任务/备忘录统计状态
function getDateStats(dateKey, allTasks, allMemos) {
  const tasks = allTasks[dateKey] || [];
  return {
    allDone: tasks.length > 0 && tasks.every(t => t.done),
    hasMemo: !!(allMemos[dateKey] && allMemos[dateKey].trim()),
  };
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
  try {
    const data = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY));
    return (Array.isArray(data) ? data : []).map(migrateGoalItem);
  } catch {
    return [];
  }
}

function saveGoals() {
  localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(state.goals));
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
  const priority_order = { high: 0, medium: 1, low: 2 };
  const filtered = state.goals.filter(g => g.type === state.activeGoalView);
  return filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.priority !== b.priority) return priority_order[a.priority] - priority_order[b.priority];
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

    // 拖拽结束后浏览器会补发 click，用捕获阶段吸收它，防止误触发完成逻辑
    source_el.addEventListener('click', e => e.stopPropagation(), { once: true, capture: true });

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
  const allTasks = loadAllData();
  const allMemos = loadAllMemos();

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

    const cell = document.createElement('div');
    cell.className = 'cal-day';
    cell.dataset.dateKey = dateKey;

    const num = document.createElement('span');
    num.textContent = d;
    cell.appendChild(num);

    if (dateKey === todayKey)    cell.classList.add('today');
    if (dateKey === selectedKey) cell.classList.add('selected');

    // 全部完成：格子绿化发光
    if (allDone) {
      cell.classList.add('all-done');
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
  state.dateKey   = dateKey;
  state.tasks     = loadTasks(dateKey);
  state.activeTag = null;
  document.getElementById('date-display').textContent = formatDateDisplay(dateKey);
  renderTasks();
  updateMemoBtnState();

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

function init() {
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
