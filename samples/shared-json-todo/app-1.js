"use strict";

const STORAGE_KEY = "ato.task-board.state.v1";
const CHANNEL_NAME = "ato.task-board.state.v1";
const CLIENT_ID = crypto.randomUUID
  ? crypto.randomUUID()
  : "client-" + Math.random().toString(36).slice(2);
const ORDER_STEP = 1000;

const DEFAULT_COLUMNS = [
  { id: "todo", title: "Todo", order: 1000 },
  { id: "pending", title: "Pending", order: 2000 },
  { id: "progress", title: "In Progress", order: 3000 },
  { id: "done", title: "Done", order: 4000 },
];

const dom = {
  board: document.getElementById("board"),
  search: document.getElementById("searchInput"),
  priorityFilter: document.getElementById("priorityFilter"),
  dueFilter: document.getElementById("dueFilter"),
  globalAdd: document.getElementById("globalAddBtn"),
  syncLabel: document.getElementById("syncLabel"),

  modalBackdrop: document.getElementById("modalBackdrop"),
  modalTitle: document.getElementById("modalTitle"),
  closeModal: document.getElementById("closeModalBtn"),
  title: document.getElementById("taskTitleInput"),
  description: document.getElementById("taskDescriptionInput"),
  column: document.getElementById("taskColumnSelect"),
  priority: document.getElementById("taskPrioritySelect"),
  due: document.getElementById("taskDueInput"),
  completed: document.getElementById("taskCompletedInput"),
  subtaskList: document.getElementById("subtaskList"),
  subtaskProgressLabel: document.getElementById("subtaskProgressLabel"),
  newSubtask: document.getElementById("newSubtaskInput"),
  addSubtask: document.getElementById("addSubtaskBtn"),
  deleteTask: document.getElementById("deleteTaskBtn"),
  cancelTask: document.getElementById("cancelTaskBtn"),
  saveTask: document.getElementById("saveTaskBtn"),
  toast: document.getElementById("toast"),
};

let state = loadState();
let editingTaskId = null;
let draftSubtasks = [];
let modalInitialColumn = "todo";
let broadcast = null;
let dragContext = null;
let touchDrag = null;
let pendingRemoteState = null;

try {
  broadcast = new BroadcastChannel(CHANNEL_NAME);
  broadcast.onmessage = (event) => {
    if (!event.data || event.data.clientId === CLIENT_ID) return;
    acceptRemoteState(event.data.state, "BroadcastChannel");
  };
} catch (_) {}

function nowISO() {
  return new Date().toISOString();
}

function uid(prefix) {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  return `${prefix}-${id}`;
}

function normalizeTaskNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function formatTaskNumber(value) {
  const number = normalizeTaskNumber(value);
  return number ? `#${String(number).padStart(3, "0")}` : "";
}

function freshState() {
  const now = nowISO();
  return {
    schemaVersion: 3,
    revision: 0,
    updatedAt: now,
    updatedBy: CLIENT_ID,
    nextTaskNumber: 1,
    columns: DEFAULT_COLUMNS.map((x) => ({ ...x })),
    tasks: {},
  };
}

function normalizeState(input) {
  const s = input && typeof input === "object" ? input : freshState();
  const columns =
    Array.isArray(s.columns) && s.columns.length
      ? s.columns.map((c, i) => ({
          id: String(c.id || `column-${i}`),
          title: String(c.title || `Column ${i + 1}`),
          order: Number.isFinite(c.order) ? c.order : (i + 1) * ORDER_STEP,
        }))
      : DEFAULT_COLUMNS.map((x) => ({ ...x }));

  for (const defaultColumn of DEFAULT_COLUMNS) {
    const existing = columns.find((c) => c.id === defaultColumn.id);
    if (existing) existing.order = defaultColumn.order;
    else columns.push({ ...defaultColumn });
  }

  const tasks = {};
  const sourceTasks = s.tasks && typeof s.tasks === "object" ? s.tasks : {};
  for (const [key, raw] of Object.entries(sourceTasks)) {
    if (!raw || typeof raw !== "object") continue;
    const id = String(raw.id || key);
    const columnId = columns.some((c) => c.id === raw.columnId)
      ? raw.columnId
      : columns[0].id;
    const subtasks = Array.isArray(raw.subtasks)
      ? raw.subtasks.map((sub, i) => ({
          id: String(sub.id || uid("sub")),
          title: String(sub.title || ""),
          completed: !!sub.completed,
          order: Number.isFinite(sub.order) ? sub.order : (i + 1) * ORDER_STEP,
        }))
      : [];

    tasks[id] = {
      id,
      number: normalizeTaskNumber(raw.number),
      columnId,
      title: String(raw.title || "Untitled"),
      description: String(raw.description || ""),
      priority: ["none", "low", "medium", "high"].includes(raw.priority)
        ? raw.priority
        : "none",
      dueAt: typeof raw.dueAt === "string" && raw.dueAt ? raw.dueAt : null,
      completed:
        typeof raw.completed === "boolean"
          ? raw.completed
          : columnId === "done",
      order: Number.isFinite(raw.order) ? raw.order : ORDER_STEP,
      subtasks,
      createdAt: raw.createdAt || nowISO(),
      updatedAt: raw.updatedAt || nowISO(),
      // Fields owned by the archive and recurrence features survive the
      // normalization; the DataResource document is their only store now.
      archived: !!raw.archived,
      recurrenceId: raw.recurrenceId ?? null,
      occurrenceDate: raw.occurrenceDate ?? null,
    };
  }

  const inferredNextTaskNumber =
    Object.values(tasks).reduce(
      (max, task) => Math.max(max, Number(task.number) || 0),
      0,
    ) + 1;
  const configuredNextTaskNumber = normalizeTaskNumber(s.nextTaskNumber) || 1;

  return {
    schemaVersion: Math.max(
      Number.isFinite(s.schemaVersion) ? s.schemaVersion : 1,
      3,
    ),
    revision: Number.isFinite(s.revision) ? s.revision : 0,
    updatedAt: s.updatedAt || nowISO(),
    updatedBy: s.updatedBy || "unknown",
    nextTaskNumber: Math.max(configuredNextTaskNumber, inferredNextTaskNumber),
    columns: columns.sort((a, b) => a.order - b.order),
    tasks,
    recurrences:
      s.recurrences && typeof s.recurrences === "object" ? s.recurrences : {},
    recurrenceOccurrences:
      s.recurrenceOccurrences && typeof s.recurrenceOccurrences === "object"
        ? s.recurrenceOccurrences
        : {},
  };
}

// The board's authoritative copy is the DataResource document. The operation
// client refreshes this snapshot from the todo_board observation; localStorage
// is only the legacy fallback while an instance is not connected yet.
function rawBoardDocument() {
  if (window.__atoBoardDocument) return window.__atoBoardDocument;
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch (_) {
    return null;
  }
}
function loadState() {
  // A failed authoritative read must not be disguised as the legacy local
  // board: show an empty view and let the sync label explain the failure.
  if (window.__atoBoardError) return freshState();
  try {
    const raw = rawBoardDocument();
    return raw ? normalizeState(raw) : freshState();
  } catch (err) {
    console.warn("State load failed:", err);
    return freshState();
  }
}

function stateTimestamp(s) {
  const t = Date.parse(s?.updatedAt || "");
  return Number.isFinite(t) ? t : 0;
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (_) {}
  }
  return JSON.parse(JSON.stringify(value));
}

function acceptRemoteState(incoming, source) {
  const next = normalizeState(incoming);
  if (touchDrag || dragContext) {
    pendingRemoteState = next;
    return;
  }
  state = next;
  render();
  if (editingTaskId && !state.tasks[editingTaskId]) closeModal();
  showSync("同期: " + source);
}

function applyPendingRemoteIfAny() {
  if (!pendingRemoteState) return;
  const next = pendingRemoteState;
  pendingRemoteState = null;
  acceptRemoteState(next, "remote");
}

function showSync(text) {
  dom.syncLabel.textContent = text;
  clearTimeout(showSync._timer);
  showSync._timer = setTimeout(() => {
    dom.syncLabel.textContent = "同期準備完了";
  }, 1600);
}

function toast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => dom.toast.classList.remove("show"), 2200);
}

function getColumns() {
  return [...state.columns].sort((a, b) => a.order - b.order);
}

function tasksForColumn(columnId, filtered = true) {
  let list = Object.values(state.tasks)
    .filter((t) => t.columnId === columnId)
    .sort((a, b) => a.order - b.order);
  if (filtered) list = list.filter(taskMatchesFilters);
  return list;
}

function taskMatchesFilters(task) {
  const q = dom.search.value.trim().toLowerCase();
  if (q) {
    const haystack = [
      formatTaskNumber(task.number),
      task.title,
      task.description,
      ...task.subtasks.map((s) => s.title),
    ]
      .join("\n")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  const p = dom.priorityFilter.value;
  if (p && task.priority !== p) return false;
  const due = dom.dueFilter.value;
  if (due) {
    if (due === "none") return !task.dueAt;
    if (!task.dueAt) return false;
    const today = localDateString(new Date());
    const target = task.dueAt;
    if (due === "today") return target === today;
    if (due === "overdue") return target < today && !task.completed;
    if (due === "week") {
      const end = new Date();
      end.setDate(end.getDate() + 7);
      const endStr = localDateString(end);
      return target >= today && target <= endStr;
    }
  }
  return true;
}

function localDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isOverdue(task) {
  if (!task.dueAt || task.completed) return false;
  return task.dueAt < localDateString(new Date());
}

function formatDue(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return value;
  return `${m}/${d}`;
}

// A board that could not be read is shown as a failure, never as an empty
// board: the columns of a fresh state would claim the person has no tasks.
function boardStatusLabel(code) {
  switch (String(code || "")) {
    case "data_port_not_connected":
      return "この実行環境はまだボードに接続されていません。";
    case "data_resource_unavailable":
      return "接続されているボードが見つかりませんでした。";
    case "data_port_unavailable":
      return "接続されているボードを読み取れませんでした。";
    default:
      return "正本を取得できません: " + String(code || "board_unavailable");
  }
}

function renderBoardStatusPanel() {
  if (window.__atoBoardStatus !== "error") return false;
  const code = window.__atoBoardError || "board_unavailable";
  dom.board.innerHTML = "";
  const panel = document.createElement("section");
  panel.className = "board-status";
  panel.setAttribute("role", "alert");
  const title = document.createElement("h2");
  title.textContent = "ボードを読み込めませんでした";
  const detail = document.createElement("p");
  detail.textContent = boardStatusLabel(code);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "primary";
  retry.textContent = "再試行";
  retry.onclick = async function () {
    retry.disabled = true;
    try {
      if (typeof refreshBoard === "function") {
        const loaded = await refreshBoard();
        if (loaded) {
          state = loadState();
          render();
        }
      }
    } finally {
      retry.disabled = false;
    }
  };
  panel.append(title, detail, retry);
  dom.board.appendChild(panel);
  dom.globalAdd.disabled = true;
  return true;
}

function render() {
  if (renderBoardStatusPanel()) return;
  dom.globalAdd.disabled = false;
  const columns = getColumns();
  dom.board.innerHTML = "";
  const selectedColumn = dom.column.value;
  dom.column.innerHTML = columns
    .map(
      (c) =>
        `<option value="${escapeAttr(c.id)}">${escapeHtml(c.title)}</option>`,
    )
    .join("");
  if (columns.some((column) => column.id === selectedColumn))
    dom.column.value = selectedColumn;
  for (const column of columns) {
    const allTasks = tasksForColumn(column.id, false);
    const visibleTasks = tasksForColumn(column.id, true);
    const columnEl = document.createElement("section");
    columnEl.className = "column";
    columnEl.dataset.columnId = column.id;
    const head = document.createElement("div");
    head.className = "column-head";
    head.innerHTML = `<div class="column-title"><span>${escapeHtml(column.title)}</span><span class="count-badge">${visibleTasks.length}${visibleTasks.length !== allTasks.length ? `/${allTasks.length}` : ""}</span></div><button class="add-task-btn" data-add-column="${escapeAttr(column.id)}" aria-label="${escapeAttr(column.title)}にタスクを追加">＋</button>`;
    const list = document.createElement("div");
    list.className = "task-list";
    list.dataset.columnId = column.id;
    if (!visibleTasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty-column";
      empty.style.padding = "16px 10px";
      empty.textContent = "タスクはありません";
      list.appendChild(empty);
    } else {
      for (const task of visibleTasks) list.appendChild(renderTaskCard(task));
    }
    columnEl.append(head, list);
    dom.board.appendChild(columnEl);
  }
  installNativeDnD();
}

function renderTaskCard(task) {
  const card = document.createElement("article");
  card.className = "task-card";
  card.dataset.taskId = task.id;
  card.draggable = true;
  const doneCount = task.subtasks.filter((s) => s.completed).length;
  const subCount = task.subtasks.length;
  const progress = subCount ? Math.round((doneCount / subCount) * 100) : 0;
  const priorityTag =
    task.priority !== "none"
      ? `<span class="tag priority-${task.priority}">${capitalize(task.priority)}</span>`
      : "";
  const dueTag = task.dueAt
    ? `<span class="tag ${isOverdue(task) ? "overdue" : ""}">Due ${escapeHtml(formatDue(task.dueAt))}</span>`
    : "";
  card.innerHTML = `<div class="task-topline"><div class="task-title" data-open-task="${escapeAttr(task.id)}"><span class="task-number">${escapeHtml(formatTaskNumber(task.number))}</span>${escapeHtml(task.title)}</div><button class="drag-handle" data-task-handle="${escapeAttr(task.id)}" aria-label="ドラッグして移動">⋮⋮</button></div><div class="task-meta">${priorityTag}${dueTag}${task.completed ? `<span class="tag">Done</span>` : ""}</div>${subCount ? `<div class="sub-progress"><div class="progress-track"><i style="width:${progress}%"></i></div><div class="progress-text">${doneCount}/${subCount}</div></div>` : ""}`;
  return card;
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(value) {
  return escapeHtml(value);
}
