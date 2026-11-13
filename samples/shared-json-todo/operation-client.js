// UI input and display only. Business changes live in src/operations/todo.js.
let pendingOperation = null;
let operationBusy = false;
let activeBoardPort = "tasks";
let boardReadSequence = 0;
let boardReadPending = false;

function boardOperation(port, id) {
  return port === "shared_tasks" ? "todo_shared_" + id.slice("todo_".length) : id;
}

function changeBoardPort(port) {
  activeBoardPort = port;
  boardReadSequence++;
  boardReadPending = false;
  pendingRemoteState = null;
  closeModal();
  window.__atoBoardDocument = undefined;
  window.__atoBoardError = "board_loading";
  window.__atoBoardStatus = "loading";
  window.__atoBoardReadOnly = true;
  state = freshState();
  render();
}
// The board's authoritative copy is the DataResource document; the UI keeps a
// snapshot refreshed through the todo_board observation after every commit.
// Returns true when the selected Port's board was loaded.
function boardFailureLabel(code) {
  return "正本を取得できません: " + String(code || "board_unavailable");
}
// An unbound Personal Port opens the Resource chooser.
function boardFailureStatus(code) {
  const core = window.AtoTodoResourceCore;
  if (core && typeof core.failureStatus === "function")
    return core.failureStatus(code);
  return code === "data_port_not_connected" || code === "data_resource_unavailable"
    ? "unbound"
    : "error";
}
async function refreshBoard() {
  const port = activeBoardPort;
  const sequence = ++boardReadSequence;
  boardReadPending = true;
  try {
    const handle = await atoInstanceOperations.prepare(
      boardOperation(port, "todo_board"),
      {},
      crypto.randomUUID(),
    );
    const result = await handle.invoke();
    if (sequence !== boardReadSequence) return false;
    if (Array.isArray(result?.result?.columns) && result.result.tasks) {
      window.__atoBoardDocument = result.result;
      delete window.__atoBoardError;
      window.__atoBoardStatus = "bound";
      return true;
    }
    window.__atoBoardError = "board_unavailable";
    window.__atoBoardStatus = "error";
  } catch (error) {
    if (sequence !== boardReadSequence) return false;
    const code = error && error.code;
    if (port === "tasks" && boardFailureStatus(code) === "unbound") {
      delete window.__atoBoardError;
      window.__atoBoardStatus = boardFailureStatus(code);
    } else {
      window.__atoBoardError = code || "board_unavailable";
      window.__atoBoardStatus = "error";
    }
  } finally {
    if (sequence === boardReadSequence) boardReadPending = false;
  }
  // Every outcome repaints: an error panel left over from an earlier attempt
  // must disappear as soon as the state it described is gone.
  window.__atoBoardDocument = undefined;
  pendingRemoteState = null;
  if (port === "shared_tasks") closeModal();
  state = loadState();
  render();
  showSync(
    window.__atoBoardStatus === "unbound"
      ? "ボード未選択"
      : boardFailureLabel(window.__atoBoardError),
  );
  return false;
}
const operationRetry = document.createElement("button");
operationRetry.textContent = "結果を確認";
operationRetry.hidden = true;
operationRetry.style.display = "none";
dom.syncLabel.parentElement.after(operationRetry);
operationRetry.onclick = () =>
  pendingOperation &&
  runOperation(pendingOperation.id, pendingOperation.arguments);

async function runOperation(id, args, onSuccess) {
  if (operationBusy) {
    toast("保存中です");
    return null;
  }
  // A board this person may only read is a real state (a team board shared
  // read-only): refuse locally instead of letting the server reject every edit.
  if (window.__atoBoardReadOnly === true) {
    toast("このボードは読み取り専用です");
    return null;
  }
  if (window.__atoBoardStatus !== "bound") return null;
  const signature = JSON.stringify([id, args]);
  if (pendingOperation && pendingOperation.signature !== signature) {
    toast("前の操作の結果を確認してから変更してください");
    return null;
  }
  if (!pendingOperation)
    pendingOperation = {
      id,
      operation: boardOperation(activeBoardPort, id),
      signature,
      arguments: JSON.parse(JSON.stringify(args)),
      input: {
        ...JSON.parse(JSON.stringify(args)),
        at: new Date().toISOString(),
      },
      key: crypto.randomUUID(),
      handle: null,
      onSuccess,
      controls: [
        ...document.querySelectorAll("button,input,textarea,select"),
      ].map((control) => [control, control.disabled]),
    };
  const intent = pendingOperation;
  operationBusy = true;
  const controls = intent.controls;
  controls.forEach(([button]) => {
    button.disabled = true;
  });
  try {
    intent.handle ??= await atoInstanceOperations.prepare(
      intent.operation,
      intent.input,
      intent.key,
    );
    if (!intent.committed) {
      try {
        intent.committed = await intent.handle.invoke();
      } catch (error) {
        if (error.code !== "operation_state_sync_failed" ||
            error.details?.status !== "succeeded") throw error;
        intent.committed = error.details;
      }
    }
    const loaded = await refreshBoard();
    state = loadState();
    render();
    if (loaded) showSync("保存済み");
    intent.onSuccess?.(intent.committed);
    pendingOperation = null;
    operationRetry.hidden = true;
    operationRetry.style.display = "none";
    return intent.committed;
  } catch (error) {
    const terminal =
      ["failed", "conflict", "revoked"].includes(error.details?.status) ||
      (error.status >= 400 && error.status < 500 &&
        ![408, 429].includes(error.status));
    if (terminal) await refreshBoard();
    if (!intent.handle || terminal) pendingOperation = null;
    if (pendingOperation) {
      if (dom.modalBackdrop.classList.contains("open"))
        dom.saveTask.before(operationRetry);
      else dom.syncLabel.parentElement.after(operationRetry);
    }
    operationRetry.hidden = !pendingOperation;
    operationRetry.style.display = pendingOperation ? "" : "none";
    const message =
      intent.committed || error.code === "operation_state_sync_failed"
        ? "保存済みです。結果を確認して表示を更新してください。"
        : pendingOperation
          ? "結果を確認できません。同じ操作の結果を確認してください。"
          : "操作を完了できませんでした。";
    dom.syncLabel.textContent = message;
    toast(message);
    return null;
  } finally {
    operationBusy = false;
    controls.forEach(([control, disabled]) => {
      control.disabled =
        pendingOperation &&
        ![operationRetry, dom.cancelTask, dom.closeModal].includes(control)
          ? true
          : disabled;
    });
  }
}

// Reload the board from its authoritative Resource. A surface that changed the
// board elsewhere (MCP, another tab, a sync event) calls this instead of
// assuming Browser State is the store.
window.__atoBoardSync = async () => {
  if (operationBusy || boardReadPending || touchDrag || dragContext) return false;
  const previous = window.__atoBoardDocument;
  if (await refreshBoard()) {
    if (JSON.stringify(previous) !== JSON.stringify(window.__atoBoardDocument)) {
      state = loadState();
      render();
      if (editingTaskId && !state.tasks[editingTaskId]) closeModal();
    }
    return true;
  }
  return false;
};

refreshBoard().then((loaded) => {
  if (loaded) {
    state = loadState();
    render();
    window.AtoRecurrence?.materializeToday();
  }
});

setTimeout(() => {
  // A sync from a change made elsewhere (MCP, another tab) refreshes the board
  // from the DataResource; the browser-state subscription only covers the
  // legacy storage path.
  window.__atoInstanceState?.subscribe?.(() => window.__atoBoardSync());
}, 0);

function refreshSharedBoard() {
  if (activeBoardPort === "shared_tasks" && !document.hidden)
    window.__atoBoardSync();
}
window.addEventListener("focus", refreshSharedBoard);
document.addEventListener("visibilitychange", refreshSharedBoard);
setInterval(refreshSharedBoard, 5000);
