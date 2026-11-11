const STORAGE_KEY = "ato.task-board.state.v1";
const ORDER_STEP = 1000;
const DEFAULT_COLUMNS = [
  { id: "todo", title: "Todo", order: 1000 },
  { id: "pending", title: "Pending", order: 2000 },
  { id: "progress", title: "In Progress", order: 3000 },
  { id: "done", title: "Done", order: 4000 },
];

// Keep Task IDs compatible with ato-api's reservedDataKey rule. A Task ID is
// also used as a JSON field name in `tasks`, so accepting a reserved segment
// would hide the entire localStorage record from state-transform operations.
function reservedDataKey(key) {
  return /^(?:__ato)|(?:^|[_.:/-])(?:token|password|secret|credential|credentials|binding|bindings|cookie|authorization|api_key|private_key)(?:$|[_.:/-])/i.test(
    String(key).replace(/([a-z])([A-Z])/g, "$1_$2"),
  );
}
function assertSafeTaskId(id) {
  if (
    !id ||
    id.length > 256 ||
    ["__proto__", "constructor", "prototype"].includes(id) ||
    reservedDataKey(id)
  )
    throw new Error("task id contains a reserved segment");
}
function assertSafeTaskIds(board) {
  for (const [id, task] of Object.entries(board.tasks)) {
    assertSafeTaskId(id);
    if (task && typeof task === "object")
      assertSafeTaskId(String(task.id ?? id));
  }
}

function normalizeTaskNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function formatTaskRef(value) {
  const number = normalizeTaskNumber(value);
  return number ? `#${String(number).padStart(3, "0")}` : null;
}
function ensureTaskNumbers(board) {
  const ordered = Object.values(board.tasks || {})
    .filter((task) => task && typeof task === "object")
    .sort(
      (a, b) =>
        String(a.createdAt || "").localeCompare(String(b.createdAt || "")) ||
        String(a.id).localeCompare(String(b.id)),
    );
  const used = new Set();
  const missing = [];
  let changed = false;
  for (const task of ordered) {
    const number = normalizeTaskNumber(task.number);
    if (number && !used.has(number)) {
      task.number = number;
      used.add(number);
    } else {
      if (task.number != null) changed = true;
      task.number = null;
      missing.push(task);
    }
  }
  let candidate = 1;
  for (const task of missing) {
    while (used.has(candidate)) candidate += 1;
    task.number = candidate;
    used.add(candidate);
    candidate += 1;
    changed = true;
  }
  let maxNumber = 0;
  for (const number of used) maxNumber = Math.max(maxNumber, number);
  const inferredNext = maxNumber + 1;
  const configuredNext = normalizeTaskNumber(board.nextTaskNumber) || 1;
  const nextTaskNumber = Math.max(configuredNext, inferredNext);
  if (board.nextTaskNumber !== nextTaskNumber) changed = true;
  board.nextTaskNumber = nextTaskNumber;
  return changed;
}
function allocateTaskNumber(board) {
  ensureTaskNumbers(board);
  const number = board.nextTaskNumber;
  board.nextTaskNumber = number + 1;
  return number;
}
function findTaskByNumber(board, number) {
  const wanted = normalizeTaskNumber(number);
  if (!wanted) return null;
  return (
    Object.values(board.tasks).find(
      (task) => normalizeTaskNumber(task?.number) === wanted,
    ) || null
  );
}
function resolveTask(board, ref) {
  const value = String(ref ?? "").trim();
  if (board.tasks[value]) return board.tasks[value];
  const match = /^#?(\d+)$/.exec(value);
  return match ? findTaskByNumber(board, Number(match[1])) : null;
}

function readStorageValue(state, key) {
  // data_port: the DataResource document *is* the board. The adapter passes
  // { document }, so no key indirection is needed here.
  if (state && typeof state === "object" && Object.hasOwn(state, "document")) {
    const document = state.document;
    if (document === null || document === undefined) return null;
    if (typeof document !== "object" || Array.isArray(document))
      throw new Error("Invalid Task Board document");
    if (Object.keys(document).length === 0) return null;
    return JSON.stringify(document);
  }
  // Legacy browser-state shape, kept so the same module still runs in a
  // browser-state harness during the migration.
  const items = Array.isArray(state?.local_storage) ? state.local_storage : [];
  const item = items.find((entry) => entry && entry.key === key);
  return typeof item?.value === "string" ? item.value : null;
}
function freshBoardState() {
  return {
    schemaVersion: 3,
    revision: 0,
    updatedAt: null,
    updatedBy: "mcp",
    nextTaskNumber: 1,
    columns: DEFAULT_COLUMNS.map((column) => ({ ...column })),
    tasks: {},
  };
}
function readBoardState(state) {
  const raw = readStorageValue(state, STORAGE_KEY);
  if (!raw) return freshBoardState();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {
    throw new Error(`Invalid JSON in ${STORAGE_KEY}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error(`Invalid Task Board state in ${STORAGE_KEY}`);
  if (!Array.isArray(parsed.columns) || parsed.columns.length === 0)
    parsed.columns = DEFAULT_COLUMNS.map((column) => ({ ...column }));
  for (const defaultColumn of DEFAULT_COLUMNS) {
    const existing = parsed.columns.find(
      (column) => String(column?.id) === defaultColumn.id,
    );
    if (existing) existing.order = defaultColumn.order;
    else parsed.columns.push({ ...defaultColumn });
  }
  if (
    !parsed.tasks ||
    typeof parsed.tasks !== "object" ||
    Array.isArray(parsed.tasks)
  )
    parsed.tasks = {};
  if (
    !parsed.recurrences ||
    typeof parsed.recurrences !== "object" ||
    Array.isArray(parsed.recurrences)
  )
    parsed.recurrences = {};
  if (
    !parsed.recurrenceOccurrences ||
    typeof parsed.recurrenceOccurrences !== "object" ||
    Array.isArray(parsed.recurrenceOccurrences)
  )
    parsed.recurrenceOccurrences = {};
  if (!Number.isFinite(parsed.revision)) parsed.revision = 0;
  parsed.schemaVersion = Math.max(
    Number.isFinite(parsed.schemaVersion) ? parsed.schemaVersion : 1,
    3,
  );
  return parsed;
}
function publicSubtask(subtask) {
  return {
    id: String(subtask?.id ?? ""),
    title: String(subtask?.title ?? ""),
    completed: !!subtask?.completed,
    order: Number.isFinite(subtask?.order) ? subtask.order : ORDER_STEP,
  };
}
function normalizeSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  if (subtasks.length > 100) throw new Error("Too many subtasks");
  const seen = new Set();
  return subtasks.map((subtask, index) => {
    const title = String(subtask?.title ?? "").trim();
    if (!title || title.length > 240)
      throw new Error(`subtasks[${index}].title must contain 1–240 characters`);
    const id = String(subtask?.id ?? `sub-mcp-${index + 1}`).trim();
    if (!id || id.length > 256 || seen.has(id))
      throw new Error(
        `subtasks[${index}].id must be unique and contain 1–256 characters`,
      );
    seen.add(id);
    return {
      id,
      title,
      completed: subtask?.completed === true,
      order: Number.isFinite(subtask?.order)
        ? subtask.order
        : (index + 1) * ORDER_STEP,
    };
  });
}
function publicTask(task) {
  return {
    id: String(task.id),
    number: normalizeTaskNumber(task.number),
    ref: formatTaskRef(task.number),
    column_id: String(task.columnId ?? "todo"),
    title: String(task.title ?? ""),
    description: String(task.description ?? ""),
    priority: ["none", "low", "medium", "high"].includes(task.priority)
      ? task.priority
      : "none",
    due_at: typeof task.dueAt === "string" && task.dueAt ? task.dueAt : null,
    completed: !!task.completed,
    archived: !!task.archived,
    order: Number.isFinite(task.order) ? task.order : ORDER_STEP,
    subtasks: Array.isArray(task.subtasks)
      ? [...task.subtasks]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(publicSubtask)
      : [],
    recurrence_id:
      typeof task.recurrenceId === "string" && task.recurrenceId
        ? task.recurrenceId
        : null,
    occurrence_date:
      typeof task.occurrenceDate === "string" && task.occurrenceDate
        ? task.occurrenceDate
        : null,
    created_at: task.createdAt ?? null,
    updated_at: task.updatedAt ?? null,
  };
}
function sortedTasks(board) {
  const columnOrder = new Map(
    [...board.columns]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((column, index) => [String(column.id), index]),
  );
  return Object.values(board.tasks)
    .filter((task) => task && typeof task === "object")
    .sort((a, b) => {
      const ac = columnOrder.get(String(a.columnId)) ?? Number.MAX_SAFE_INTEGER;
      const bc = columnOrder.get(String(b.columnId)) ?? Number.MAX_SAFE_INTEGER;
      if (ac !== bc) return ac - bc;
      return (a.order ?? 0) - (b.order ?? 0);
    });
}
function nextOrderInColumn(board, columnId, excludeId = null) {
  const values = Object.values(board.tasks)
    .filter(
      (task) =>
        task?.columnId === columnId &&
        String(task.id) !== String(excludeId ?? ""),
    )
    .map((task) => (Number.isFinite(task.order) ? task.order : 0));
  return values.length ? Math.max(...values) + ORDER_STEP : ORDER_STEP;
}
function reindexColumn(board, columnId) {
  Object.values(board.tasks)
    .filter((task) => task?.columnId === columnId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((task, index) => {
      task.order = (index + 1) * ORDER_STEP;
    });
}
function makeTaskId(board) {
  const nextRevision =
    (Number.isFinite(board.revision) ? board.revision : 0) + 1;
  const base = `task-op-${nextRevision}`;
  let candidate = base;
  let suffix = 1;
  while (board.tasks[candidate]) candidate = `${base}-${suffix++}`;
  return candidate;
}
const INITIAL_TRAINING_RECURRENCES = [
  {
    id: "training-weekly-mon",
    weekday: 1,
    title: "月曜トレーニング：全身筋トレ + 傾斜ウォーク",
    description: "全身筋トレ35〜40分 + 傾斜ウォーク15〜20分",
    subtasks: [
      "レッグプレス 10〜12回×3",
      "チェストプレス 8〜12回×3",
      "ラットプルダウン 8〜12回×3",
      "ショルダープレス 8〜12回×2",
      "腹筋 12〜15回×2",
      "傾斜ウォーク 5〜6km/h・傾斜5〜10%",
    ],
  },
  {
    id: "training-weekly-tue",
    weekday: 2,
    title: "火曜トレーニング：傾斜ウォーキング 50〜60分",
    description: "傾斜ウォーキング 50〜60分",
    subtasks: [
      "5分ウォームアップ",
      "40〜45分: 5〜6km/h・傾斜5〜10%",
      "5分クールダウン",
    ],
  },
  {
    id: "training-weekly-wed",
    weekday: 3,
    title: "水曜トレーニング：全身筋トレ + 有酸素",
    description:
      "全身筋トレ35〜40分 + 有酸素15〜20分。月曜と同系統。重量は最後2〜3回がきつい程度。",
    subtasks: [
      "月曜と同系統の全身筋トレ 35〜40分",
      "重量は最後2〜3回がきつい程度",
      "有酸素 15〜20分",
    ],
  },
  {
    id: "training-weekly-thu",
    weekday: 4,
    title: "木曜トレーニング：インターバル有酸素 40〜50分",
    description: "インターバル有酸素 40〜50分",
    subtasks: [
      "5〜10分ウォームアップ",
      "速い3分 + ゆっくり2分 ×6",
      "ランニング8〜10km/h または傾斜10〜15%の速歩",
    ],
  },
  {
    id: "training-weekly-fri",
    weekday: 5,
    title: "金曜トレーニング：全身筋トレ + 傾斜ウォーク",
    description: "全身筋トレ35〜40分 + 傾斜ウォーク15〜20分。月曜と同系統。",
    subtasks: ["月曜と同系統の全身筋トレ 35〜40分", "傾斜ウォーク 15〜20分"],
  },
  {
    id: "training-weekly-sat",
    weekday: 6,
    title: "土曜トレーニング：長めの有酸素 55〜60分",
    description: "傾斜ウォーク / 自転車 / 軽いジョギング。一定ペース。",
    subtasks: [
      "傾斜ウォーク / 自転車 / 軽いジョギングから選ぶ",
      "55〜60分を一定ペース",
    ],
  },
  {
    id: "training-weekly-sun",
    weekday: 7,
    title: "日曜トレーニング：回復ウォーキング 40〜50分",
    description: "普通〜速歩、低強度。疲労が強ければ30分程度に短縮可。",
    subtasks: [
      "普通〜速歩、低強度で40〜50分",
      "疲労が強ければ30分程度に短縮可",
    ],
  },
];

function publicRecurrence(recurrence) {
  return {
    id: String(recurrence.id),
    frequency: "weekly",
    weekday: Number(recurrence.weekday),
    enabled: recurrence.enabled !== false,
    title: String(recurrence.title ?? ""),
    description: String(recurrence.description ?? ""),
    priority: ["none", "low", "medium", "high"].includes(recurrence.priority)
      ? recurrence.priority
      : "none",
    column_id: ["todo", "pending", "progress"].includes(recurrence.columnId)
      ? recurrence.columnId
      : "todo",
    subtasks: Array.isArray(recurrence.subtasks)
      ? [...recurrence.subtasks]
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(publicSubtask)
      : [],
  };
}
function sortedRecurrences(board) {
  return Object.values(board.recurrences || {})
    .filter((item) => item && typeof item === "object")
    .sort((a, b) => {
      const weekday = Number(a.weekday) - Number(b.weekday);
      return weekday || String(a.id).localeCompare(String(b.id));
    });
}
function ensureTrainingRecurrences(board, at) {
  let changed = false;
  board.recurrences ||= {};
  board.recurrenceOccurrences ||= {};
  for (const seed of INITIAL_TRAINING_RECURRENCES) {
    if (board.recurrences[seed.id]) continue;
    board.recurrences[seed.id] = {
      id: seed.id,
      frequency: "weekly",
      weekday: seed.weekday,
      enabled: true,
      title: seed.title,
      description: seed.description,
      priority: "none",
      columnId: "todo",
      subtasks: seed.subtasks.map((title, index) => ({
        id: `sub-${seed.id}-${index + 1}`,
        title,
        completed: false,
        order: (index + 1) * ORDER_STEP,
      })),
      createdAt: at,
      updatedAt: at,
    };
    changed = true;
  }
  return changed;
}
function commit(board, result, at) {
  assertSafeTaskIds(board);
  board.revision = (Number.isFinite(board.revision) ? board.revision : 0) + 1;
  board.updatedAt = at;
  board.updatedBy = "operation";
  return {
    // Evolution: the next document is the whole board, committed by the origin.
    operations: [{ kind: "replace", value: board }],
    result: {
      ...result,
      revision: board.revision,
      updated_at: board.updatedAt,
    },
  };
}

// The TODO screen renders from the authoritative document itself; Calendar and
// other consumers use the narrower operations declared for their Ports.
export function boardDocument({ state }) {
  return { operations: [], result: readBoardState(state) };
}

// Calendar's whole contract: four fields per task with a due date. The board
// document (descriptions, subtasks, columns, recurrences) never leaves this
// handler, so a consumer cannot read more than the owner granted.
export function listDueDates({ state }) {
  const board = readBoardState(state);
  const tasks = sortedTasks(board)
    .filter((task) => task && task.dueAt && !task.archived)
    .map((task) => ({
      task_id: String(task.id),
      title: String(task.title ?? ""),
      due_at: String(task.dueAt),
      completed: task.completed === true,
    }));
  return { operations: [], result: { tasks } };
}

export function listTodos({ state }) {
  const board = readBoardState(state);
  const numbered = ensureTaskNumbers(board);

  const result = {
    revision: board.revision,
    updated_at: board.updatedAt ?? null,
    columns: [...board.columns]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((column) => ({
        id: String(column.id),
        title: String(column.title ?? column.id),
        order: Number.isFinite(column.order) ? column.order : ORDER_STEP,
      })),
    tasks: sortedTasks(board).map(publicTask),
    recurrences: sortedRecurrences(board).map(publicRecurrence),
  };
  return { operations: [], result };
}

export function getTodo({ arguments: args, state }) {
  const board = readBoardState(state);
  ensureTaskNumbers(board);
  const task = resolveTask(board, args.id);
  if (!task) throw new Error(`TODO not found: ${args.id}`);
  return {
    operations: [],
    result: { revision: board.revision, task: publicTask(task) },
  };
}

export function getTodoByNumber({ arguments: args, state }) {
  const board = readBoardState(state);
  ensureTaskNumbers(board);
  const task = findTaskByNumber(board, args.number);
  if (!task)
    throw new Error(`TODO not found: #${String(args.number).padStart(3, "0")}`);
  return {
    operations: [],
    result: { revision: board.revision, task: publicTask(task) },
  };
}

export function createTodo({ arguments: args, state }) {
  const board = readBoardState(state);
  const at = timestamp(args.at);
  ensureTaskNumbers(board);
  const title = String(args.title ?? "").trim();
  if (!title) throw new Error("title is required");
  const requestedId = args.id == null ? "" : String(args.id).trim();
  const id = requestedId || makeTaskId(board);
  assertSafeTaskId(id);
  if (board.tasks[id]) throw new Error(`TODO already exists: ${id}`);
  let columnId = args.column_id ?? "todo";
  if (!board.columns.some((column) => column.id === columnId))
    throw new Error("Unknown column");
  const completed = args.completed === true || columnId === "done";
  if (completed) columnId = "done";
  const task = {
    id,
    number: allocateTaskNumber(board),
    columnId,
    title,
    description: String(args.description ?? "").trim(),
    priority: ["none", "low", "medium", "high"].includes(args.priority)
      ? args.priority
      : "none",
    dueAt:
      typeof args.due_at === "string" && args.due_at.trim()
        ? args.due_at.trim()
        : null,
    completed,
    archived: false,
    order: nextOrderInColumn(board, columnId),
    subtasks: normalizeSubtasks(args.subtasks),
    createdAt: at,
    updatedAt: at,
  };
  board.tasks[id] = task;
  return commit(board, { task: publicTask(task) }, at);
}

export function updateTodo({ arguments: args, state }) {
  const board = readBoardState(state);
  ensureTaskNumbers(board);
  const at = timestamp(args.at);
  const requestedRef = String(args.id);
  const task = resolveTask(board, requestedRef);
  if (!task) throw new Error(`TODO not found: ${requestedRef}`);
  const id = String(task.id);
  const oldColumnId = task.columnId;
  if (args.title !== undefined) {
    const title = String(args.title).trim();
    if (!title) throw new Error("title must not be empty");
    task.title = title;
  }
  if (args.description !== undefined)
    task.description = String(args.description).trim();
  if (args.priority !== undefined) task.priority = args.priority;
  if (args.due_at !== undefined) {
    const dueAt = String(args.due_at).trim();
    task.dueAt = dueAt || null;
  }
  if (args.column_id !== undefined) {
    if (!board.columns.some((column) => column.id === args.column_id))
      throw new Error("Unknown column");
    task.columnId = args.column_id;
    task.completed = task.columnId === "done";
  }
  if (args.completed !== undefined) {
    if (args.completed) {
      task.completed = true;
      task.columnId = "done";
    } else {
      task.completed = false;
      if (task.columnId === "done")
        task.columnId =
          args.column_id && args.column_id !== "done" ? args.column_id : "todo";
    }
  }
  if (task.columnId === "done") task.completed = true;
  if (!task.completed) task.archived = false;
  if (args.archived === true && !task.completed)
    throw new Error("Only completed tasks may be archived");
  if (args.archived !== undefined) task.archived = args.archived === true;
  if (args.subtasks !== undefined)
    task.subtasks = normalizeSubtasks(args.subtasks);
  if (oldColumnId !== task.columnId) {
    task.order = nextOrderInColumn(board, task.columnId, id);
    reindexColumn(board, oldColumnId);
  }
  if (
    args.recurrence_enabled !== undefined ||
    args.recurrence_weekday !== undefined
  ) {
    const recurrence = board.recurrences[task.recurrenceId];
    if (!recurrence) throw new Error("Task has no recurrence");
    if (args.recurrence_enabled !== undefined)
      recurrence.enabled = args.recurrence_enabled;
    if (args.recurrence_weekday !== undefined)
      recurrence.weekday = args.recurrence_weekday;
    Object.assign(recurrence, {
      title: task.title,
      description: task.description,
      priority: task.priority,
      columnId: task.completed ? "todo" : task.columnId,
      updatedAt: at,
      subtasks: task.subtasks.map((sub, index) => ({
        ...sub,
        completed: false,
        order: (index + 1) * ORDER_STEP,
      })),
    });
  }
  task.updatedAt = at;
  return commit(board, { task: publicTask(task) }, at);
}

function civilDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid date");
  let [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]
  )
    throw new Error("Invalid date");
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  if (month < 3) year--;
  return (
    (year +
      Math.floor(year / 4) -
      Math.floor(year / 100) +
      Math.floor(year / 400) +
      offsets[month - 1] +
      day) %
      7 || 7
  );
}
function timestamp(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value)
  )
    throw new Error("Explicit ISO timestamp required");
  civilDate(value.slice(0, 10));
  return value;
}
export function initializeBoard({ arguments: args, state }) {
  const at = timestamp(args.at),
    board = readBoardState(state);
  let changed = !readStorageValue(state, STORAGE_KEY);
  changed = ensureTaskNumbers(board) || changed;
  changed = ensureTrainingRecurrences(board, at) || changed;
  const weekday = civilDate(args.date);
  let count = 0;
  for (const recurrence of Object.values(board.recurrences)) {
    if (
      !recurrence ||
      recurrence.enabled === false ||
      recurrence.frequency !== "weekly" ||
      Number(recurrence.weekday) !== weekday
    )
      continue;
    const key = recurrence.id + "|" + args.date;
    if (Object.hasOwn(board.recurrenceOccurrences, key)) continue;
    const stem = ("occ-" + recurrence.id + "-" + args.date)
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .slice(0, 240);
    let id = stem,
      suffix = 1;
    while (board.tasks[id]) id = stem.slice(0, 230) + "-" + suffix++;
    assertSafeTaskId(id);
    const columnId = ["todo", "pending", "progress"].includes(
      recurrence.columnId,
    )
      ? recurrence.columnId
      : "todo";
    board.tasks[id] = {
      id,
      number: allocateTaskNumber(board),
      columnId,
      title: recurrence.title,
      description: recurrence.description,
      priority: recurrence.priority,
      dueAt: args.date,
      completed: false,
      archived: false,
      order: nextOrderInColumn(board, columnId),
      subtasks: normalizeSubtasks(recurrence.subtasks).map((sub) => ({
        ...sub,
        completed: false,
      })),
      recurrenceId: recurrence.id,
      occurrenceDate: args.date,
      createdAt: at,
      updatedAt: at,
    };
    board.recurrenceOccurrences[key] = id;
    count++;
  }
  // The operation-scoped adapter requires exactly one `replace` per mutating
  // operation; a no-op must still commit the (unchanged) board, otherwise a
  // repeated materialize (e.g. after resuming a workspace) fails with
  // handler_failed instead of reporting success.
  return commit(board, { count }, at);
}
export function moveTodo({ arguments: args, state }) {
  const at = timestamp(args.at),
    board = readBoardState(state),
    task = resolveTask(board, args.id);
  if (!task || !board.columns.some((column) => column.id === args.column_id))
    throw new Error("Invalid task or column");
  const oldColumn = task.columnId;
  const target = sortedTasks(board).filter(
    (t) => t.columnId === args.column_id && t.id !== task.id,
  );
  let index = args.target_id
    ? target.findIndex((t) => t.id === args.target_id)
    : target.length;
  if (index < 0) throw new Error("Move target is stale");
  if (args.target_id && args.after) index++;
  task.columnId = args.column_id;
  task.completed = task.columnId === "done";
  if (!task.completed) task.archived = false;
  task.updatedAt = at;
  target.splice(index, 0, task);
  target.forEach((entry, i) => {
    entry.order = (i + 1) * ORDER_STEP;
  });
  if (oldColumn !== task.columnId) reindexColumn(board, oldColumn);
  return commit(board, { task: publicTask(task) }, at);
}
export function deleteTodo({ arguments: args, state }) {
  const at = timestamp(args.at),
    board = readBoardState(state),
    task = resolveTask(board, args.id);
  if (!task) throw new Error("TODO not found");
  delete board.tasks[task.id];
  reindexColumn(board, task.columnId);
  // Keep occurrence tombstones: deleting today's task must not recreate it.
  return commit(board, { deleted_id: task.id }, at);
}
export function archiveDone({ arguments: args, state }) {
  const at = timestamp(args.at),
    board = readBoardState(state);
  let count = 0;
  for (const task of Object.values(board.tasks))
    if (task.columnId === "done" && !task.archived) {
      task.completed = true;
      task.archived = true;
      task.updatedAt = at;
      count++;
    }
  return count
    ? commit(board, { count }, at)
    : { operations: [], result: { count: 0 } };
}
export function resetBoard({ arguments: args, state }) {
  const board = freshBoardState();
  board.revision = readBoardState(state).revision;
  return commit(board, { reset: true }, timestamp(args.at));
}
export function replaceBoard({ arguments: args, state }) {
  const board = readBoardState({ document: args.board });
  const columnIds = new Set();
  for (const column of board.columns) {
    if (typeof column.id !== "string" || !column.id || columnIds.has(column.id))
      throw new Error("Invalid columns");
    columnIds.add(column.id);
  }
  function validateFields(item) {
    if (
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 160
    )
      throw new Error("Invalid title");
    if (typeof item.description !== "string" || item.description.length > 5000)
      throw new Error("Invalid description");
    if (
      !["none", "low", "medium", "high"].includes(item.priority) ||
      !columnIds.has(item.columnId)
    )
      throw new Error("Invalid task fields");
    item.subtasks = normalizeSubtasks(item.subtasks);
  }
  for (const [id, task] of Object.entries(board.tasks)) {
    assertSafeTaskId(id);
    if (
      task.id !== id ||
      typeof task.completed !== "boolean" ||
      (task.archived && !task.completed)
    )
      throw new Error("Invalid task");
    validateFields(task);
  }
  for (const [id, recurrence] of Object.entries(board.recurrences)) {
    assertSafeTaskId(id);
    if (
      recurrence.id !== id ||
      recurrence.frequency !== "weekly" ||
      !Number.isInteger(recurrence.weekday) ||
      recurrence.weekday < 1 ||
      recurrence.weekday > 7 ||
      typeof recurrence.enabled !== "boolean"
    )
      throw new Error("Invalid recurrence");
    validateFields(recurrence);
  }
  ensureTaskNumbers(board);
  board.revision = Math.max(board.revision, readBoardState(state).revision);
  return commit(board, { replaced: true }, timestamp(args.at));
}
