"use strict";
// Resource authority only: observations render; prepared Operations commit.
let pendingOperation = null;
let operationBusy = false;
let boardReadSequence = 0;
let syncQueued = false;
let boardReading = 0;
window.__atoBoardError = "board_loading";
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
    window.__atoBoardError
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
async function refreshBoard() {
  const sequence = ++boardReadSequence;
  boardReading++;
  try {
    const handle = await atoInstanceOperations.prepare(
      "todo_board",
      {},
      crypto.randomUUID(),
    );
    let result;
    try {
      result = await handle.invoke();
    } catch (error) {
      if (
        error.code === "operation_state_sync_failed" &&
        error.details?.status === "succeeded"
      )
        result = error.details;
      else throw error;
    }
    if (sequence !== boardReadSequence) return false;
    const value = result?.result;
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
    intent.handle ??= await atoInstanceOperations.prepare(
      id,
      intent.input,
      intent.key,
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
  if (loaded) window.AtoRecurrence?.materializeToday();
});
setTimeout(() => {
  const bridge = window.__atoInstanceState;
  bridge?.subscribe?.(() => window.__atoBoardSync());
}, 0);

window.addEventListener("focus", () => window.__atoBoardSync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") window.__atoBoardSync();
});
