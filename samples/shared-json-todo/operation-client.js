// UI input and display only. Business changes live in src/operations/todo.js.
let pendingOperation = null;
let operationBusy = false;
// The board's authoritative copy is the DataResource document; the UI keeps a
// snapshot refreshed through the todo_board observation after every commit.
// Returns true when the authoritative board was loaded. `not_connected` means
// the instance has no Resource yet and the legacy local state may be shown; any
// other failure is surfaced and the stale copy is never presented as the truth.
function boardFailureLabel(code) {
  return "正本を取得できません: " + String(code || "board_unavailable");
}
// "unbound" is a first run, not a failure: the in-app chooser takes over and
// the legacy local board stays usable. Every other failure is an error state.
function boardFailureStatus(code) {
  const core = window.AtoTodoResourceCore;
  if (core && typeof core.failureStatus === "function")
    return core.failureStatus(code);
  return code === "data_port_not_connected" || code === "data_resource_unavailable"
    ? "unbound"
    : "error";
}
async function refreshBoard() {
  try {
    const handle = await atoInstanceOperations.prepare(
      "todo_board",
      {},
      crypto.randomUUID(),
    );
    const result = await handle.invoke();
    if (result && result.result && typeof result.result === "object") {
      window.__atoBoardDocument = result.result;
      delete window.__atoBoardError;
      window.__atoBoardStatus = "bound";
      return true;
    }
    window.__atoBoardError = "board_unavailable";
    window.__atoBoardStatus = "error";
  } catch (error) {
    const code = error && error.code;
    if (code === "data_port_not_connected" || code === "data_resource_unavailable") {
      // Not connected: the legacy local state is the only available view.
      delete window.__atoBoardError;
      window.__atoBoardStatus = boardFailureStatus(code);
    } else {
      window.__atoBoardError = code || "board_unavailable";
      window.__atoBoardStatus = boardFailureStatus(window.__atoBoardError);
    }
  }
  // Every outcome repaints: an error panel left over from an earlier attempt
  // must disappear as soon as the state it described is gone.
  window.__atoBoardDocument = undefined;
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
  const signature = JSON.stringify([id, args]);
  if (pendingOperation && pendingOperation.signature !== signature) {
    toast("前の操作の結果を確認してから変更してください");
    return null;
  }
  if (!pendingOperation)
    pendingOperation = {
      id,
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
      id,
      intent.input,
      intent.key,
    );
    const result = await intent.handle.invoke();
    intent.committed = result;
    await refreshBoard();
    state = loadState();
    render();
    showSync("保存済み");
    intent.onSuccess?.(result);
    pendingOperation = null;
    operationRetry.hidden = true;
    operationRetry.style.display = "none";
    return result;
  } catch (error) {
    const terminal = ["failed", "conflict", "revoked"].includes(
      error.details?.status,
    );
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
  if (await refreshBoard()) {
    state = loadState();
    render();
    return true;
  }
  return false;
};

refreshBoard().then((loaded) => {
  if (loaded) {
    state = loadState();
    render();
  }
});

setTimeout(() => {
  // A sync from a change made elsewhere (MCP, another tab) refreshes the board
  // from the DataResource; the browser-state subscription only covers the
  // legacy storage path.
  const sync = window.__atoInstanceState?.sync;
  if (window.__atoInstanceState && typeof sync === "function")
    window.__atoInstanceState.sync = async (...args) => {
      const result = await sync.apply(window.__atoInstanceState, args);
      if (await refreshBoard()) {
        state = loadState();
        render();
      }
      return result;
    };
  window.__atoInstanceState.subscribe(() => {
    const incoming = loadState();
    acceptRemoteState(incoming, "ato.run");
  });
}, 0);
