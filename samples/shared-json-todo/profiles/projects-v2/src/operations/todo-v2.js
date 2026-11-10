// New TODO-owned Protocol closure. The sealed todo.board@1 handler stays unchanged.
import * as legacy from "./todo-v1.js";
const clone = (value) => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.hasOwn(value, key);
const safeId = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value) &&
  !["__proto__", "constructor", "prototype"].includes(value);
function fail(message) {
  throw new Error(message);
}
function date(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    fail("Invalid project date");
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1000 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1]
  )
    fail("Invalid project date");
  return value;
}
function validate(board) {
  if (
    !board.tasks ||
    typeof board.tasks !== "object" ||
    Array.isArray(board.tasks) ||
    !Array.isArray(board.columns)
  )
    fail("Invalid TODO document");
  if (board.schemaVersion !== 4) fail("TODO project schema migration required");
  if (
    !board.projects ||
    typeof board.projects !== "object" ||
    Array.isArray(board.projects)
  )
    fail("Invalid projects map");
  for (const [id, p] of Object.entries(board.projects)) {
    if (
      !safeId(id) ||
      !p ||
      p.id !== id ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 160
    )
      fail("Invalid project");
    const start = date(p.startDate),
      target = date(p.targetDate);
    if (start && target && start > target)
      fail("Project startDate must precede targetDate");
  }
  for (const t of [
    ...Object.values(board.tasks || {}),
    ...Object.values(board.recurrences || {}),
  ])
    if (t.projectId != null && !own(board.projects, t.projectId))
      fail("Unknown project reference");
  return board;
}
// Offline preflight/copy helper, not a published Operation or automatic rebind.
export function upgradeBoard(value) {
  const board = clone(value);
  if (
    !board ||
    typeof board !== "object" ||
    Array.isArray(board) ||
    !board.tasks ||
    typeof board.tasks !== "object" ||
    !Array.isArray(board.columns)
  )
    fail("Invalid legacy board");
  if (![3, 4].includes(board.schemaVersion))
    fail("Unsupported TODO document version");
  board.schemaVersion = 4;
  board.projects ??= {};
  return validate(board);
}
function context(input) {
  const raw = input.state?.document;
  const board =
    raw && Object.keys(raw).length
      ? clone(raw)
      : {
          schemaVersion: 4,
          revision: 0,
          columns: [],
          tasks: {},
          projects: {},
          recurrences: {},
          recurrenceOccurrences: {},
        };
  validate(board);
  return { ...input, state: { document: board } };
}
function preserveNested(before, after) {
  for (const [id, task] of Object.entries(after.tasks || {})) {
    const old = before.tasks?.[id];
    if (old) {
      task.subtasks = (task.subtasks || []).map((sub) => ({
        ...old.subtasks?.find((s) => s.id === sub.id),
        ...sub,
      }));
    } else if (
      task.recurrenceId &&
      before.recurrences?.[task.recurrenceId]?.projectId
    )
      task.projectId = before.recurrences[task.recurrenceId].projectId;
  }
  for (const [id, recurrence] of Object.entries(after.recurrences || {}))
    recurrence.subtasks = (recurrence.subtasks || []).map((sub) => ({
      ...before.recurrences?.[id]?.subtasks?.find((s) => s.id === sub.id),
      ...sub,
    }));
}
function publicTask(raw, projection) {
  return {
    ...raw,
    ...projection,
    subtasks: (projection.subtasks || []).map((sub) => ({
      ...raw?.subtasks?.find((s) => s.id === sub.id),
      ...sub,
    })),
    project_id: raw?.projectId || null,
  };
}
function invoke(name, input) {
  const next = context(input),
    before = clone(next.state.document),
    args = { ...next.arguments };
  // project_id is interpreted by this Protocol only; the v1 code never sees it.
  if (["updateTodo", "moveTodo", "deleteTodo"].includes(name)) {
    const resolved = legacy.getTodo({ ...next, arguments: { id: args.id } })
      .result?.task;
    const task = before.tasks[resolved?.id];
    if (!task || args.expected_version !== (task.editVersion || 0))
      fail("Task edit conflict");
  }
  delete args.expected_version;
  const projectId = args.project_id === "" ? null : args.project_id;
  delete args.project_id;
  if (
    projectId !== undefined &&
    projectId !== null &&
    !own(before.projects, projectId)
  )
    fail("Unknown project");
  if (name === "replaceBoard") args.board = upgradeBoard(args.board);
  const output = legacy[name]({ ...next, arguments: args });
  const board = output.operations?.[0]?.value || next.state.document;
  if (output.operations?.length) {
    board.schemaVersion = 4;
    board.projects ??= before.projects;
    preserveNested(name === "replaceBoard" ? args.board : before, board);
    const id = output.result?.task?.id;
    if (id && projectId !== undefined) {
      board.tasks[id].projectId = projectId;
      if (board.tasks[id].recurrenceId) {
        const recurrence = board.recurrences[board.tasks[id].recurrenceId];
        if (recurrence) recurrence.projectId = projectId;
      }
    }
    // Reset is explicit, preserving its existing whole-board semantics.
    if (name === "resetBoard") board.projects = {};
    for (const [id, task] of Object.entries(board.tasks)) {
      const old = before.tasks[id];
      if (!old) task.editVersion = 1;
      else if (JSON.stringify(task) !== JSON.stringify(old))
        task.editVersion = (old.editVersion || 0) + 1;
    }
    validate(board);
  }
  if (output.result?.task)
    output.result.task = publicTask(
      board.tasks[output.result.task.id],
      output.result.task,
    );
  if (output.result?.recurrences)
    output.result.recurrences = output.result.recurrences.map((r) => ({
      ...board.recurrences?.[r.id],
      ...r,
      project_id: board.recurrences?.[r.id]?.projectId || null,
    }));
  if (output.result?.tasks)
    output.result.tasks = output.result.tasks.map((task) =>
      publicTask(board.tasks[task.id], task),
    );
  return output;
}
export function boardDocument(input) {
  const next = context(input);
  return { operations: [], result: legacy.boardDocument(next).result };
}
export function listTodos(input) {
  return invoke("listTodos", input);
}
export function getTodo(input) {
  return invoke("getTodo", input);
}
export function getTodoByNumber(input) {
  return invoke("getTodoByNumber", input);
}
export function createTodo(input) {
  return invoke("createTodo", input);
}
export function updateTodo(input) {
  return invoke("updateTodo", input);
}
export function initializeBoard(input) {
  return invoke("initializeBoard", input);
}
export function moveTodo(input) {
  return invoke("moveTodo", input);
}
export function deleteTodo(input) {
  return invoke("deleteTodo", input);
}
export function archiveDone(input) {
  return invoke("archiveDone", input);
}
export function resetBoard(input) {
  return invoke("resetBoard", input);
}
export function replaceBoard(input) {
  return invoke("replaceBoard", input);
}
export function listDueDates(input) {
  const board = context(input).state.document;
  return {
    operations: [],
    result: {
      tasks: Object.values(board.tasks)
        .filter((t) => !t.archived && typeof t.dueAt === "string" && t.dueAt)
        .map((t) => ({
          task_id: t.id,
          title: t.title,
          due_at: t.dueAt,
          completed: !!t.completed,
        })),
    },
  };
}
function projectCommit(board, result, at) {
  if (
    typeof at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(at)
  )
    fail("Invalid timestamp");
  date(at.slice(0, 10));
  validate(board);
  board.revision = (board.revision || 0) + 1;
  board.updatedAt = at;
  board.updatedBy = "operation";
  return {
    operations: [{ kind: "replace", value: board }],
    result: { ...result, revision: board.revision, updated_at: at },
  };
}
function projectFields(args, existing = {}) {
  const project = { ...existing };
  if (args.name !== undefined) {
    if (
      typeof args.name !== "string" ||
      !args.name.trim() ||
      args.name.trim().length > 160
    )
      fail("Invalid project name");
    project.name = args.name.trim();
  }
  if (args.description !== undefined) {
    if (typeof args.description !== "string" || args.description.length > 5000)
      fail("Invalid project description");
    project.description = args.description;
  }
  if (args.start_date !== undefined) project.startDate = date(args.start_date);
  if (args.target_date !== undefined)
    project.targetDate = date(args.target_date);
  if (
    project.startDate &&
    project.targetDate &&
    project.startDate > project.targetDate
  )
    fail("Project startDate must precede targetDate");
  return project;
}
export function createProject(input) {
  const board = context(input).state.document,
    args = input.arguments;
  if (!safeId(args.id) || own(board.projects, args.id))
    fail("Invalid or duplicate project id");
  const project = projectFields(args, {
    id: args.id,
    name: "",
    description: "",
    startDate: null,
    targetDate: null,
    color: "teal",
    order:
      Math.max(
        0,
        ...Object.values(board.projects).map((p) => Number(p.order) || 0),
      ) + 1000,
  });
  project.createdAt = args.at;
  project.updatedAt = args.at;
  project.editVersion = 1;
  board.projects[args.id] = project;
  return projectCommit(board, { project }, args.at);
}
export function updateProject(input) {
  const board = context(input).state.document,
    args = input.arguments;
  if (!own(board.projects, args.id)) fail("Project not found");
  if (args.expected_version !== (board.projects[args.id].editVersion || 0))
    fail("Project edit conflict");
  board.projects[args.id] = {
    ...projectFields(args, board.projects[args.id]),
    updatedAt: args.at,
    editVersion: (board.projects[args.id].editVersion || 0) + 1,
  };
  return projectCommit(board, { project: board.projects[args.id] }, args.at);
}
export function deleteProject(input) {
  const board = context(input).state.document,
    args = input.arguments;
  if (args.confirm !== true)
    fail("Project deletion requires explicit confirmation");
  if (!own(board.projects, args.id)) fail("Project not found");
  if (args.expected_version !== (board.projects[args.id].editVersion || 0))
    fail("Project edit conflict");
  delete board.projects[args.id];
  for (const task of Object.values(board.tasks))
    if (task.projectId === args.id) {
      task.projectId = null;
      task.updatedAt = args.at;
      task.editVersion = (task.editVersion || 0) + 1;
    }
  for (const recurrence of Object.values(board.recurrences || {}))
    if (recurrence.projectId === args.id) recurrence.projectId = null;
  return projectCommit(board, { deleted: args.id }, args.at);
}
