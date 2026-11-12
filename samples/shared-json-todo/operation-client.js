"use strict";
// Resource authority only: observations render; prepared Operations commit.
const DEFAULT_BOARD_PORT = "all";
let pendingOperation = null;
let operationBusy = false;
let boardReadSequence = 0;
let syncQueued = false;
let boardReading = 0;
window.__atoBoardError = "board_loading";
/**
 * Which Port this board currently drives. "tasks" is the person's own board;
 * "team_tasks" is the team board the same Instance may also hold. The
 * selection is a view/write-target choice, not a second source of truth.
 */
function boardPort() {
  try {
    return (
      window.__atoBoardPort ||
      window.localStorage.getItem("ato.board.port") ||
      DEFAULT_BOARD_PORT
    );
  } catch {
    return window.__atoBoardPort || DEFAULT_BOARD_PORT;
  }
}
const PORT_PREFIXES = { tasks: "tasks", shared_tasks: "shared_tasks", team_tasks: "team_tasks" };
const PORT_LABELS = { tasks: "個人", shared_tasks: "共有", team_tasks: "チーム" };
/** Task ids in the merged view carry their Resource's Port. */
function portForTaskId(id) {
  const value = typeof id === "string" ? id : "";
  for (const port of Object.keys(PORT_PREFIXES))
    if (value.startsWith(port + ":")) return port;
  return null;
}
function localTaskId(id) {
  const port = portForTaskId(id);
  return port ? id.slice(port.length + 1) : id;
}
/** Each Port has its own operation set in the manifest (state.port). */
function operationForPort(port, operation) {
  const prefix =
    port === "shared_tasks"
      ? "todo_shared_"
      : port === "team_tasks"
        ? "todo_team_"
        : null;
  if (prefix && operation.startsWith("todo_") && !operation.startsWith(prefix))
    return prefix + operation.slice("todo_".length);
  return operation;
}
/** Address a Port explicitly; fall back to the served instance Port. */
function prepareOnPort(operation, args, key, portOverride) {
  const port = portOverride || boardPort();
  const scoped = operationForPort(port, operation);
  if (window.atoDataPorts?.request)
    return window.atoDataPorts.request(port, scoped, args, key);
  return atoInstanceOperations.prepare(scoped, args, key);
}
window.__atoBoardSetPort = (port) => {
  window.__atoBoardPort = port || DEFAULT_BOARD_PORT;
  try {
    window.localStorage.setItem("ato.board.port", window.__atoBoardPort);
  } catch {}
  return window.__atoBoardSync ? window.__atoBoardSync() : null;
};
const operationRetry = document.createElement("button");
operationRetry.textContent = "結果を確認";
operationRetry.className = "secondary";
operationRetry.hidden = true;
dom.syncLabel.parentElement.after(operationRetry);
operationRetry.onclick = () =>
  pendingOperation
    ? runOperation(pendingOperation.id, pendingOperation.arguments)
    : window.__atoBoardSync();
function boardFailureLabel(code) {
  if (code === "board_loading") return "正本を確認中";
  if (["data_port_not_connected", "data_resource_unavailable"].includes(code))
    return "データ未接続、またはアクセスが取り消されました";
  return "正本を取得できません。接続と権限を確認してください";
}
function setOperationControls() {
  const blocked = !!(
    operationBusy ||
    pendingOperation ||
    window.__atoBoardError ||
    window.__atoBoardReadOnly
  );
  for (const control of document.querySelectorAll(
    "[data-open-task],[data-add-column],[data-inline-status],#globalAddBtn,#saveTaskBtn,#deleteTaskBtn,[data-save-project],[data-delete-project],[data-new-project]",
  ))
    control.disabled = blocked;
  operationRetry.hidden =
    operationBusy || (!pendingOperation && !window.__atoBoardError);
  operationRetry.disabled = operationBusy;
  for (const field of document.querySelectorAll(
    ".modal-body input,.modal-body select,.modal-body textarea,.project-dialog input,.project-dialog textarea,#addSubtaskBtn",
  ))
    field.disabled = operationBusy || !!pendingOperation;
  const projectFooter = document.querySelector(".project-dialog[open] footer");
  if (projectFooter) projectFooter.append(operationRetry);
  else if (dom.modalBackdrop.classList.contains("open"))
    dom.saveTask.before(operationRetry);
  else dom.syncLabel.parentElement.after(operationRetry);
}
async function loadBoardRaw(port) {
  const key = crypto.randomUUID();
  const run =
    window.atoDataPorts?.invoke && port !== boardPort()
      ? () =>
          window.atoDataPorts.invoke(port, operationForPort(port, "todo_board"), {}, key)
      : async () => {
          const handle = await prepareOnPort("todo_board", {}, key, port);
          try {
            return await handle.invoke();
          } catch (error) {
            if (
              error.code === "operation_state_sync_failed" &&
              error.details?.status === "succeeded"
            )
              return error.details;
            throw error;
          }
        };
  const result = await run();
  return result?.result;
}
/** All = merge every connected Port; each task keeps the Port it came from. */
async function readRequirements() {
  if (window.atoDataPorts?.requirements)
    return window.atoDataPorts.requirements().catch(() => null);
  return fetch("/__ato/data-ports", { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}
const boardParts = new Map();
let boardBound = new Map();
window.__atoBoardPartialErrors = [];
function mergeBoards(entries, bound = boardBound) {
  const columns = [];
  const seenColumns = new Set();
  const tasks = {};
  for (const { port, board } of entries) {
    for (const column of board.columns ?? [])
      if (column?.id && !seenColumns.has(column.id)) {
        seenColumns.add(column.id);
        columns.push(column);
      }
    for (const [taskId, task] of Object.entries(board.tasks ?? {})) {
      const id = port + ":" + taskId;
      tasks[id] = {
        ...task,
        id,
        __port: port,
        __resourceId: bound.get(port) || null,
        __columnId: task.columnId,
      };
    }
  }
  const first = entries[0]?.board || freshState();
  return { ...first, columns, tasks };
}
async function loadMergedBoard() {
  const requirements = await readRequirements();
  const list = Array.isArray(requirements?.bindings)
    ? requirements.bindings
    : Array.isArray(requirements?.requirements)
      ? requirements.requirements
      : [];
  const bound = new Map(
    list
      .filter((entry) => entry && entry.binding)
      .map((entry) => [entry.port_name, entry.binding.resource_id || null]),
  );
  boardBound = bound;
  const candidates = ["tasks", "shared_tasks", "team_tasks"];
  const available = list.length
    ? candidates.filter((port) => bound.has(port))
    : candidates;
  const entries = [];
  const errors = [];
  for (const port of available) {
    try {
      const board = await loadBoardRaw(port);
      if (board) entries.push({ port, board });
    } catch (error) {
      errors.push({ port, code: error?.code || "board_unavailable" });
    }
  }
  if (entries.length === 0)
    throw Object.assign(new Error(errors[0]?.code || "board_invalid_shape"), {
      code: errors[0]?.code || "board_invalid_shape",
    });
  boardParts.clear();
  for (const entry of entries) boardParts.set(entry.port, entry.board);
  window.__atoBoardPartialErrors = errors;
  return mergeBoards(entries, bound);
}
function redrawParts() {
  if (boardParts.size === 0) return false;
  const merged = mergeBoards(
    [...boardParts].map(([port, board]) => ({ port, board })),
  );
  window.__atoBoardDocument = structuredCloneSafe(merged);
  delete window.__atoBoardError;
  if (!touchDrag && !dragContext) {
    state = loadState();
    render();
  }
  setOperationControls();
  return true;
}
/** A Port update replaces only that Port's tasks. */
async function refreshPort(port) {
  try {
    const board = await loadBoardRaw(port);
    if (!board) return;
    boardParts.set(port, board);
    window.__atoBoardPartialErrors = (
      window.__atoBoardPartialErrors || []
    ).filter((entry) => entry.port !== port);
    redrawParts();
    showSync("同期済み");
  } catch (error) {
    if (
      /revoked|forbidden|unauthorized|data_port_not_connected|data_resource_unavailable/.test(
        error?.code || "",
      )
    )
      dropPort(port);
  }
}
function dropPort(port) {
  if (!boardParts.delete(port)) return;
  const label = { tasks: "個人", shared_tasks: "共有", team_tasks: "チーム" }[port] || port;
  if (boardParts.size === 0) {
    delete window.__atoBoardDocument;
    window.__atoBoardError = "data_port_not_connected";
    state = freshState();
    render();
  } else redrawParts();
  setOperationControls();
  showSync(label + "の接続が解除されました");
}
function installPortSubscriptions() {
  if (!window.atoDataPorts?.subscribe || boardPort() !== "all") return false;
  for (const port of ["tasks", "shared_tasks", "team_tasks"]) {
    try {
      window.atoDataPorts.subscribe(port, () => refreshPort(port));
    } catch {
      /* a Port without a subscription keeps the page-level sync */
    }
  }
  return true;
}
async function actorFenceChanged() {
  try {
    const context = await fetch("/__ato/data/context", {
      credentials: "same-origin",
    }).then((response) => (response.ok ? response.json() : null));
    if (!context?.actor_fence) return false;
    const previous = window.__atoActorFence;
    window.__atoActorFence = context.actor_fence;
    return previous != null && previous !== context.actor_fence;
  } catch {
    return false;
  }
}

async function refreshBoard() {
  const sequence = ++boardReadSequence;
  boardReading++;
  try {
    if (await actorFenceChanged()) {
      try {
        localStorage.removeItem("ato.task-board.state.v1");
      } catch {}
      boardParts.clear();
      pendingOperation = null;
    }
    const merged = boardPort() === "all";
    window.__atoBoardReadOnly = false;
    const value = merged
      ? await loadMergedBoard()
      : await loadBoardRaw(boardPort());
    if (sequence !== boardReadSequence) return false;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !value.tasks ||
      Array.isArray(value.tasks) ||
      !Array.isArray(value.columns) ||
      value.columns.some((c) => !c || typeof c.id !== "string") ||
      Object.entries(value.tasks).some(
        ([id, task]) =>
          !task ||
          task.id !== id ||
          typeof task.title !== "string" ||
          !Array.isArray(task.subtasks),
      )
    )
      throw new Error("board_invalid_shape");
    window.__atoBoardDocument = structuredCloneSafe(value);
    delete window.__atoBoardError;
    if (touchDrag || dragContext) pendingRemoteState = normalizeState(value);
    else {
      state = loadState();
      render();
    }
    setOperationControls();
    if (merged && window.__atoBoardPartialErrors?.length)
      showSync("一部のデータを読み込めません");
    return true;
  } catch (error) {
    if (sequence !== boardReadSequence) return false;
    window.__atoBoardError = error.code || "board_unavailable";
    delete window.__atoBoardDocument;
    state = freshState();
    render();
    if (
      /revoked|forbidden|unauthorized|data_port_not_connected|data_resource_unavailable/.test(
        error.code || "",
      )
    )
      window.TaskBoardUI?.revoke();
    showSync(boardFailureLabel(window.__atoBoardError));
    setOperationControls();
    return false;
  } finally {
    boardReading--;
  }
}
async function runOperation(id, args, onSuccess) {
  if (id === "todo_initialize" && window.__atoBoardError === "board_loading")
    return null;
  if (operationBusy) {
    toast("保存中です");
    return null;
  }
  // Writes follow the task's own Port; a new task uses the modal's target.
  const portFromArgs = portForTaskId(args?.id);
  const writePort =
    portFromArgs ||
    (typeof window.__atoBoardWritePort === "string" &&
    window.__atoBoardWritePort
      ? window.__atoBoardWritePort
      : boardPort() === "all"
        ? "tasks"
        : boardPort());
  if (args && typeof args.id === "string" && portFromArgs)
    args = { ...args, id: localTaskId(args.id) };
  if (
    document.body.dataset.projectOperations === "true" &&
    ["todo_update", "todo_move", "todo_delete"].includes(id) &&
    args.expected_version === undefined
  )
    args = {
      ...args,
      expected_version:
        window.TaskBoardUI?.taskVersion(args.id) ??
        state.tasks[args.id]?.editVersion ??
        0,
    };
  const signature = JSON.stringify([id, args]);
  if (pendingOperation && pendingOperation.signature !== signature) {
    toast("先に前の操作の結果を確認してください");
    return null;
  }
  if (window.__atoBoardError && !pendingOperation) {
    toast(boardFailureLabel(window.__atoBoardError));
    return null;
  }
  pendingOperation ??= {
    id,
    signature,
    arguments: structuredCloneSafe(args),
    input: { ...structuredCloneSafe(args), at: new Date().toISOString() },
    key: crypto.randomUUID(),
    handle: null,
    onSuccess,
  };
  const intent = pendingOperation;
  operationBusy = true;
  setOperationControls();
  try {
    intent.handle ??= await prepareOnPort(
      id,
      intent.input,
      intent.key,
      id === "todo_board" ? undefined : writePort,
    );
    if (!intent.committed) {
      try {
        intent.committed = await intent.handle.invoke();
      } catch (error) {
        if (
          error.code === "operation_state_sync_failed" &&
          error.details?.status === "succeeded"
        )
          intent.committed = error.details;
        else throw error;
      }
    }
    if (!(await refreshBoard())) {
      showSync("保存結果を受領しましたが、正本の再確認が必要です");
      return null;
    }
    window.TaskBoardUI?.committed(id);
    intent.onSuccess?.(intent.committed);
    pendingOperation = null;
    showSync("保存済み");
    return intent.committed;
  } catch (error) {
    const terminal =
      ["failed", "conflict", "revoked"].includes(error.details?.status) ||
      /conflict|revoked|forbidden|unauthorized|data_port_not_connected|data_resource_unavailable/.test(
        error.code || "",
      ) ||
      (error.status >= 400 &&
        error.status < 500 &&
        ![408, 429].includes(error.status));
    if (!intent.handle || terminal) pendingOperation = null;
    if (terminal) await refreshBoard();
    const message = terminal
      ? "競合または権限の変更により保存できません。内容を確認してください"
      : "結果を確認できません。同じ操作の結果を確認してください";
    showSync(message);
    toast(message);
    return null;
  } finally {
    operationBusy = false;
    window.TaskBoardUI?.render();
    setOperationControls();
    if (syncQueued) {
      syncQueued = false;
      await window.__atoBoardSync();
    }
  }
}
window.__atoBoardSync = async () => {
  if (boardReading) return false;
  if (operationBusy) {
    syncQueued = true;
    return false;
  }
  const loaded = await refreshBoard();
  if (loaded) showSync("同期済み");
  return loaded;
};
refreshBoard().then((loaded) => {
  if (loaded) {
    showSync(
      window.__atoBoardPartialErrors?.length
        ? "一部のデータを読み込めません"
        : "同期済み",
    );
    window.AtoRecurrence?.materializeToday();
  }
  if (installPortSubscriptions()) return;
  setTimeout(() => {
    const bridge = window.__atoInstanceState;
    bridge?.subscribe?.(() => window.__atoBoardSync());
  }, 0);
});

window.addEventListener("focus", () => window.__atoBoardSync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.__atoBoardSync();
});
