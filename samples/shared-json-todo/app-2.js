async function moveTask(taskId, columnId, targetTaskId = null, after = false) {
  await runOperation("todo_move", {
    id: taskId,
    column_id: columnId,
    target_id: targetTaskId || "",
    after,
  });
}

function installNativeDnD() {
  document.querySelectorAll(".task-card").forEach((card) => {
    card.addEventListener("dragstart", (event) => {
      dragContext = { type: "task", taskId: card.dataset.taskId };
      card.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", card.dataset.taskId);
      } catch (_) {}
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      clearDropMarkers();
      dragContext = null;
      applyPendingRemoteIfAny();
    });
  });
  document.querySelectorAll(".task-list").forEach((list) => {
    list.addEventListener("dragover", (event) => {
      if (!dragContext || dragContext.type !== "task") return;
      event.preventDefault();
      const column = list.closest(".column");
      column?.classList.add("drop-target");
      const card = event.target.closest(".task-card");
      document
        .querySelectorAll(".task-card")
        .forEach((x) => x.classList.remove("drop-before", "drop-after"));
      if (card && card.dataset.taskId !== dragContext.taskId) {
        const rect = card.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        card.classList.add(after ? "drop-after" : "drop-before");
      }
    });
    list.addEventListener("dragleave", (event) => {
      if (!list.contains(event.relatedTarget))
        list.closest(".column")?.classList.remove("drop-target");
    });
    list.addEventListener("drop", (event) => {
      if (!dragContext || dragContext.type !== "task") return;
      event.preventDefault();
      const targetColumnId = list.dataset.columnId;
      const card = event.target.closest(".task-card");
      let targetTaskId = null;
      let after = false;
      if (card && card.dataset.taskId !== dragContext.taskId) {
        targetTaskId = card.dataset.taskId;
        const rect = card.getBoundingClientRect();
        after = event.clientY > rect.top + rect.height / 2;
      }
      moveTask(dragContext.taskId, targetColumnId, targetTaskId, after);
      clearDropMarkers();
      dragContext = null;
      applyPendingRemoteIfAny();
    });
  });
}

function clearDropMarkers() {
  document
    .querySelectorAll(".column")
    .forEach((x) => x.classList.remove("drop-target"));
  document
    .querySelectorAll(".task-card,.subtask-row")
    .forEach((x) => x.classList.remove("drop-before", "drop-after"));
}

function openTaskModal(taskId = null, columnId = "todo") {
  if (operationBusy || pendingOperation) {
    toast("先に操作の結果を確認してください");
    return;
  }
  editingTaskId = taskId;
  modalInitialColumn = columnId;
  const task = taskId ? state.tasks[taskId] : null;
  dom.modalTitle.textContent = task
    ? `${formatTaskNumber(task.number)} タスクを編集`
    : "タスクを追加";
  dom.title.value = task?.title || "";
  dom.description.value = task?.description || "";
  dom.column.value = task?.columnId || columnId;
  dom.priority.value = task?.priority || "none";
  dom.due.value = task?.dueAt || "";
  dom.completed.checked = !!task?.completed;
  draftSubtasks = task ? task.subtasks.map((s) => ({ ...s })) : [];
  dom.deleteTask.style.visibility = task ? "visible" : "hidden";
  dom.newSubtask.value = "";
  renderSubtasks();
  dom.modalBackdrop.classList.add("open");
  setTimeout(() => dom.title.focus(), 0);
}

function closeModal() {
  if (pendingOperation) dom.syncLabel.parentElement.after(operationRetry);
  dom.modalBackdrop.classList.remove("open");
  editingTaskId = null;
  draftSubtasks = [];
}

function renderSubtasks() {
  const sorted = [...draftSubtasks].sort((a, b) => a.order - b.order);
  draftSubtasks = sorted;
  dom.subtaskList.innerHTML = "";
  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "empty-column";
    empty.style.padding = "16px 10px";
    empty.textContent = "サブタスクはありません";
    dom.subtaskList.appendChild(empty);
  } else {
    for (const sub of sorted) {
      const row = document.createElement("div");
      row.className = "subtask-row";
      row.dataset.subtaskId = sub.id;
      row.draggable = true;
      row.innerHTML = `<input type="checkbox" ${sub.completed ? "checked" : ""} data-sub-check="${escapeAttr(sub.id)}" aria-label="サブタスク完了"><input class="subtask-title-input ${sub.completed ? "done" : ""}" value="${escapeAttr(sub.title)}" data-sub-title="${escapeAttr(sub.id)}" maxlength="200"><button class="drag-handle" data-sub-handle="${escapeAttr(sub.id)}" aria-label="ドラッグして並び替え">⋮⋮</button><button class="mini-btn" data-sub-delete="${escapeAttr(sub.id)}" aria-label="サブタスクを削除">×</button>`;
      dom.subtaskList.appendChild(row);
    }
  }
  const done = draftSubtasks.filter((s) => s.completed).length;
  dom.subtaskProgressLabel.textContent = draftSubtasks.length
    ? `${done}/${draftSubtasks.length}`
    : "";
  installSubtaskNativeDnD();
}

function addSubtaskFromInput() {
  const title = dom.newSubtask.value.trim();
  if (!title) return;
  draftSubtasks.push({
    id: uid("sub"),
    title,
    completed: false,
    order: draftSubtasks.length
      ? Math.max(...draftSubtasks.map((s) => s.order || 0)) + ORDER_STEP
      : ORDER_STEP,
  });
  dom.newSubtask.value = "";
  renderSubtasks();
  dom.newSubtask.focus();
}

function reindexDraftSubtasks(ids) {
  ids.forEach((id, i) => {
    const sub = draftSubtasks.find((s) => s.id === id);
    if (sub) sub.order = (i + 1) * ORDER_STEP;
  });
  draftSubtasks.sort((a, b) => a.order - b.order);
}

function moveDraftSubtask(subtaskId, targetId = null, after = false) {
  const ids = draftSubtasks
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id)
    .filter((id) => id !== subtaskId);
  let index = targetId ? ids.indexOf(targetId) : ids.length;
  if (index < 0) index = ids.length;
  if (targetId && after) index += 1;
  ids.splice(index, 0, subtaskId);
  reindexDraftSubtasks(ids);
  renderSubtasks();
}

function installSubtaskNativeDnD() {
  dom.subtaskList.querySelectorAll(".subtask-row").forEach((row) => {
    row.addEventListener("dragstart", (event) => {
      dragContext = { type: "subtask", subtaskId: row.dataset.subtaskId };
      row.classList.add("dragging");
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearDropMarkers();
      dragContext = null;
    });
    row.addEventListener("dragover", (event) => {
      if (!dragContext || dragContext.type !== "subtask") return;
      event.preventDefault();
      event.stopPropagation();
      dom.subtaskList
        .querySelectorAll(".subtask-row")
        .forEach((x) => x.classList.remove("drop-before", "drop-after"));
      if (row.dataset.subtaskId === dragContext.subtaskId) return;
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      row.classList.add(after ? "drop-after" : "drop-before");
    });
    row.addEventListener("drop", (event) => {
      if (!dragContext || dragContext.type !== "subtask") return;
      event.preventDefault();
      event.stopPropagation();
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      moveDraftSubtask(dragContext.subtaskId, row.dataset.subtaskId, after);
      clearDropMarkers();
      dragContext = null;
    });
  });
  dom.subtaskList.addEventListener("dragover", (event) => {
    if (dragContext?.type === "subtask") event.preventDefault();
  });
  dom.subtaskList.addEventListener(
    "drop",
    (event) => {
      if (!dragContext || dragContext.type !== "subtask") return;
      const row = event.target.closest(".subtask-row");
      if (row) return;
      event.preventDefault();
      moveDraftSubtask(dragContext.subtaskId, null, false);
      dragContext = null;
    },
    { once: true },
  );
}

async function saveModalTask() {
  const title = dom.title.value.trim();
  if (!title) {
    toast("タイトルを入力してください");
    dom.title.focus();
    return;
  }
  const args = {
    title,
    description: dom.description.value,
    priority: dom.priority.value,
    due_at: dom.due.value,
    column_id: dom.column.value,
    completed: dom.completed.checked,
    subtasks: draftSubtasks.map((s, i) => ({
      ...s,
      order: (i + 1) * ORDER_STEP,
    })),
  };
  if (editingTaskId) args.id = editingTaskId;
  const recurrence = document.getElementById("recurrenceEnabledInput");
  if (editingTaskId && state.tasks[editingTaskId]?.recurrenceId && recurrence) {
    args.recurrence_enabled = recurrence.checked;
    args.recurrence_weekday = Number(
      document.getElementById("recurrenceWeekdaySelect").value,
    );
  }
  await runOperation(
    editingTaskId ? "todo_update" : "todo_create",
    args,
    closeModal,
  );
}

async function deleteEditingTask() {
  if (!editingTaskId || !state.tasks[editingTaskId]) return;
  if (!confirm("「" + state.tasks[editingTaskId].title + "」を削除しますか？"))
    return;
  await runOperation("todo_delete", { id: editingTaskId }, closeModal);
}
