"use strict";
(function () {
  const ui = window.TaskBoardViewState;
  const baseMatches = taskMatchesFilters;
  taskMatchesFilters = function (task) {
    return (
      baseMatches(task) &&
      (!ui.status || task.columnId === ui.status) &&
      (!ui.project ||
        (ui.project === "unassigned"
          ? !task.projectId
          : task.projectId === ui.project))
    );
  };
  const ranks = { high: 0, medium: 1, low: 2, none: 3 };
  function compare(a, b) {
    let value = 0;
    if (ui.sort === "priority")
      value = (ranks[a.priority] ?? 3) - (ranks[b.priority] ?? 3);
    if (ui.sort === "due")
      value = (a.dueAt || "9999").localeCompare(b.dueAt || "9999");
    if (ui.sort === "updated")
      value = String(b.updatedAt || "").localeCompare(
        String(a.updatedAt || ""),
      );
    return (
      value || a.order - b.order || String(a.id).localeCompare(String(b.id))
    );
  }
  const baseTasks = tasksForColumn;
  tasksForColumn = function (columnId, filtered = true) {
    const tasks = baseTasks(columnId, filtered);
    return filtered ? tasks.sort(compare) : tasks;
  };
  const statusLabels = () =>
    Object.fromEntries(getColumns().map((c) => [c.id, c.title]));
  const statusMark = (task) =>
    '<span class="status-mark" data-status="' +
    escapeAttr(task.columnId) +
    '" aria-hidden="true">●</span>';
  function meta(task) {
    const labels = statusLabels();
    const done = task.subtasks.filter((s) => s.completed).length;
    return (
      '<span class="task-status" data-status="' +
      escapeAttr(task.columnId) +
      '">' +
      statusMark(task) +
      " " +
      escapeHtml(labels[task.columnId] || task.columnId) +
      "</span>" +
      '<span class="task-priority" data-priority="' +
      escapeAttr(task.priority) +
      '">' +
      ({ high: "↑ 高", medium: "＝ 中", low: "↓ 低", none: "— なし" }[
        task.priority
      ] || "— なし") +
      "</span>" +
      '<span class="task-date' +
      (isOverdue(task) ? " overdue" : "") +
      '">' +
      (task.dueAt
        ? "◷ " +
          escapeHtml(task.dueAt.slice(0, 10)) +
          (isOverdue(task) ? " 期限切れ" : "")
        : "期限なし") +
      "</span>" +
      '<span class="task-subtask-progress">☑ ' +
      done +
      "/" +
      task.subtasks.length +
      "</span>" +
      (task.recurrenceId ? '<span class="task-recurrence">↻ 毎週</span>' : "") +
      (task.archived ? "<span>Archived</span>" : "")
    );
  }
  window.TaskBoardSelectors = Object.freeze({
    compare,
    statusMark,
    meta,
    tasks: () =>
      getColumns()
        .flatMap((c) => tasksForColumn(c.id, true))
        .sort(compare),
    projects: () =>
      Object.values(state.projects || {}).sort(
        (a, b) => a.order - b.order || a.id.localeCompare(b.id),
      ),
  });
})();
