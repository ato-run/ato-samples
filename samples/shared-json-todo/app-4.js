document.addEventListener("click", (event) => {
  const addColumn = event.target.closest("[data-add-column]");
  if (addColumn) {
    openTaskModal(null, addColumn.dataset.addColumn);
    return;
  }
  const open = event.target.closest("[data-open-task]");
  if (open) {
    openTaskModal(open.dataset.openTask);
    return;
  }
  const subDelete = event.target.closest("[data-sub-delete]");
  if (subDelete) {
    draftSubtasks = draftSubtasks.filter(
      (s) => s.id !== subDelete.dataset.subDelete,
    );
    draftSubtasks.forEach((s, i) => (s.order = (i + 1) * ORDER_STEP));
    renderSubtasks();
  }
});

document.addEventListener("change", (event) => {
  const check = event.target.closest("[data-sub-check]");
  if (check) {
    const sub = draftSubtasks.find((s) => s.id === check.dataset.subCheck);
    if (sub) {
      sub.completed = check.checked;
      renderSubtasks();
    }
    return;
  }
  if (event.target === dom.completed) {
    if (dom.completed.checked) dom.column.value = "done";
    else if (dom.column.value === "done")
      dom.column.value =
        modalInitialColumn === "done" ? "todo" : modalInitialColumn;
  }
  if (event.target === dom.column)
    dom.completed.checked = dom.column.value === "done";
});

document.addEventListener("input", (event) => {
  const input = event.target.closest("[data-sub-title]");
  if (!input) return;
  const sub = draftSubtasks.find((s) => s.id === input.dataset.subTitle);
  if (sub) sub.title = input.value;
});

document.addEventListener("pointerdown", (event) => {
  const taskHandle = event.target.closest("[data-task-handle]");
  if (taskHandle) {
    beginTouchDrag.call(null, event, "task", taskHandle.dataset.taskHandle);
    return;
  }
  const subHandle = event.target.closest("[data-sub-handle]");
  if (subHandle)
    beginTouchDrag.call(null, event, "subtask", subHandle.dataset.subHandle);
});

dom.globalAdd.addEventListener("click", () => openTaskModal(null, "todo"));
dom.closeModal.addEventListener("click", closeModal);
dom.cancelTask.addEventListener("click", closeModal);
dom.saveTask.addEventListener("click", saveModalTask);
dom.deleteTask.addEventListener("click", deleteEditingTask);
dom.addSubtask.addEventListener("click", addSubtaskFromInput);
dom.newSubtask.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addSubtaskFromInput();
  }
});
dom.modalBackdrop.addEventListener("click", (event) => {
  if (event.target === dom.modalBackdrop) closeModal();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dom.modalBackdrop.classList.contains("open"))
    closeModal();
});
[dom.search, dom.priorityFilter, dom.dueFilter].forEach((control) => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

// Forged storage/BroadcastChannel/custom-event payloads cannot replace Resource observations.
window.AtoTaskBoard = Object.freeze({
  storageKey: STORAGE_KEY,
  getState: () => structuredCloneSafe(state),
  setState: (next) => runOperation("todo_replace_board", { board: next }),
  reset: () => runOperation("todo_reset", {}),
});

render();

// Archive completed tasks while keeping the existing state schema backward compatible.
(function installArchiveFeature() {
  let showArchived = false;

  try {
    const raw = rawBoardDocument();
    if (raw)
      for (const [id, task] of Object.entries(state.tasks)) {
        task.archived = !!raw?.tasks?.[id]?.archived;
      }
  } catch (_) {
    for (const task of Object.values(state.tasks))
      task.archived = !!task.archived;
  }

  const baseNormalizeState = normalizeState;
  normalizeState = function (input) {
    const normalized = baseNormalizeState(input);
    const rawTasks =
      input?.tasks && typeof input.tasks === "object" ? input.tasks : {};
    for (const [id, task] of Object.entries(normalized.tasks)) {
      task.archived = !!rawTasks?.[id]?.archived;
    }
    return normalized;
  };

  const style = document.createElement("style");
  style.textContent = `
        .archive-toggle-btn { white-space: nowrap; align-self: flex-start; }
        .task-card.archived-task { opacity: .62; border-style: dashed; }
        .footer-left-actions { display: flex; gap: 8px; align-items: center; }
        @media (max-width: 820px) { .archive-toggle-btn { margin-top: 10px; } }
        @media (max-width: 480px) { .footer-left-actions { width: 100%; } .footer-left-actions button { flex: 1; } }
      `;
  document.head.appendChild(style);

  const archiveToggleBtn = document.createElement("button");
  archiveToggleBtn.type = "button";
  archiveToggleBtn.className = "secondary archive-toggle-btn";
  archiveToggleBtn.setAttribute("aria-pressed", "false");
  document.querySelector(".sync-pill")?.before(archiveToggleBtn);

  const archiveTaskBtn = document.createElement("button");
  archiveTaskBtn.type = "button";
  archiveTaskBtn.className = "secondary";
  archiveTaskBtn.style.display = "none";
  const footer = dom.deleteTask.parentElement;
  if (footer) {
    const leftActions = document.createElement("div");
    leftActions.className = "footer-left-actions";
    footer.insertBefore(leftActions, dom.deleteTask);
    leftActions.append(dom.deleteTask, archiveTaskBtn);
  }

  const baseTasksForColumn = tasksForColumn;
  tasksForColumn = function (columnId, filtered = true) {
    const list = baseTasksForColumn(columnId, filtered);
    return showArchived ? list : list.filter((task) => !task.archived);
  };

  const baseRenderTaskCard = renderTaskCard;
  renderTaskCard = function (task) {
    const card = baseRenderTaskCard(task);
    if (task.archived) {
      card.classList.add("archived-task");
      const meta = card.querySelector(".task-meta");
      if (meta) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "Archived";
        meta.appendChild(tag);
      }
    }
    return card;
  };

  const baseRender = render;
  render = function () {
    baseRender();
    const archivedCount = Object.values(state.tasks).filter(
      (task) => task.archived,
    ).length;
    archiveToggleBtn.textContent = showArchived
      ? `アーカイブを隠す (${archivedCount})`
      : `アーカイブ (${archivedCount})`;
    archiveToggleBtn.setAttribute(
      "aria-pressed",
      showArchived ? "true" : "false",
    );
    archiveToggleBtn.disabled = archivedCount === 0 && !showArchived;
  };

  const baseOpenTaskModal = openTaskModal;
  openTaskModal = function (taskId = null, columnId = "todo") {
    baseOpenTaskModal(taskId, columnId);
    const task = taskId ? state.tasks[taskId] : null;
    if (!task) {
      archiveTaskBtn.style.display = "none";
      return;
    }
    archiveTaskBtn.style.display =
      task.completed || task.archived ? "" : "none";
    const label = task.archived ? "アーカイブ解除" : "アーカイブ";
    archiveTaskBtn.setAttribute("aria-label", label);
    archiveTaskBtn.innerHTML =
      TaskBoardIcons.icon("archive") +
      '<span class="button-label">' +
      label +
      "</span>";
  };

  archiveToggleBtn.addEventListener("click", () => {
    showArchived = !showArchived;
    render();
  });

  archiveTaskBtn.addEventListener("click", async () => {
    const task = state.tasks[editingTaskId];
    if (!task) return;
    await runOperation(
      "todo_update",
      { id: editingTaskId, archived: !task.archived },
      closeModal,
    );
  });

  render();
})();
