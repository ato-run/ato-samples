"use strict";
(function () {
  const ui = window.TaskBoardViewState;
  const baseMatches = taskMatchesFilters;
  taskMatchesFilters = function (task) {
    return (
      baseMatches(task) &&
      (ui.portFilter ? (task.__port || "tasks") === ui.portFilter : true) &&
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
  const icon = (name) => window.TaskBoardIcons.icon(name);
  const statusMark = (task) =>
    '<span class="status-mark" data-status="' +
    escapeAttr(task.columnId) +
    '" aria-hidden="true">' +
    icon(task.columnId) +
    "</span>";
  function priority(task, includeEmpty = false) {
    if (task.priority === "none" && !includeEmpty) return "";
    const label =
      { high: "高", medium: "中", low: "低", none: "なし" }[task.priority] ||
      "なし";
    return (
      '<span class="task-priority" data-priority="' +
      escapeAttr(task.priority) +
      '" role="img" aria-label="優先度 ' +
      label +
      '">' +
      icon(task.priority) +
      "<span>" +
      label +
      "</span></span>"
    );
  }
  function due(task, includeEmpty = false) {
    if (!task.dueAt)
      return includeEmpty
        ? '<span class="empty-value" aria-label="期限なし">—</span>'
        : "";
    const date = task.dueAt.slice(0, 10),
      overdue = isOverdue(task);
    const label = date.startsWith(new Date().getFullYear() + "-")
      ? date.slice(5).replaceAll("-", "/")
      : date.replaceAll("-", "/");
    return (
      '<time class="task-date' +
      (overdue ? " overdue" : "") +
      '" datetime="' +
      escapeAttr(date) +
      '" title="' +
      escapeAttr(date) +
      '" aria-label="期限 ' +
      escapeAttr(date) +
      (overdue ? " 期限切れ" : "") +
      '">' +
      icon("calendar") +
      "<span>" +
      escapeHtml(label) +
      "</span>" +
      (overdue ? '<span class="overdue-label">期限切れ</span>' : "") +
      "</time>"
    );
  }
  function subtasks(task, includeEmpty = false) {
    if (!task.subtasks.length)
      return includeEmpty
        ? '<span class="empty-value" aria-label="サブタスクなし">—</span>'
        : "";
    const done = task.subtasks.filter((sub) => sub.completed).length;
    return (
      '<span class="task-subtask-progress" aria-label="サブタスク ' +
      done +
      "/" +
      task.subtasks.length +
      '">' +
      icon("subtasks") +
      "<span>" +
      done +
      "/" +
      task.subtasks.length +
      "</span></span>"
    );
  }
  function meta(task) {
    const labels = statusLabels();
    return (
      '<span class="task-status" data-status="' +
      escapeAttr(task.columnId) +
      '">' +
      statusMark(task) +
      "<span>" +
      escapeHtml(labels[task.columnId] || task.columnId) +
      "</span></span>" +
      priority(task) +
      due(task) +
      subtasks(task) +
      (task.recurrenceId
        ? '<span class="task-recurrence">' +
          icon("repeat") +
          "<span>毎週</span></span>"
        : "") +
      (task.archived
        ? '<span class="task-archived">' +
          icon("archive") +
          "<span>Archived</span></span>"
        : "")
    );
  }
  window.TaskBoardSelectors = Object.freeze({
    compare,
    statusMark,
    priority,
    due,
    subtasks,
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
