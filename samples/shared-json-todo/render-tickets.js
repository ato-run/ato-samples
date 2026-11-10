"use strict";
window.renderTickets = function () {
  const panel = document.getElementById("ticketsView"),
    ui = window.TaskBoardViewState;
  const tasks = window.TaskBoardSelectors.tasks();
  const groups =
    ui.group === "none"
      ? [{ title: "", tasks }]
      : ui.group === "priority"
        ? ["high", "medium", "low", "none"].map((id) => ({
            title: { high: "高", medium: "中", low: "低", none: "なし" }[id],
            tasks: tasks.filter((t) => t.priority === id),
          }))
        : ui.group === "project"
          ? [
              { id: null, name: "Unassigned" },
              ...window.TaskBoardSelectors.projects(),
            ].map((p) => ({
              title: p.name,
              tasks: tasks.filter((t) => (t.projectId || null) === p.id),
            }))
          : getColumns().map((c) => ({
              title: c.title,
              tasks: tasks.filter((t) => t.columnId === c.id),
            }));
  panel.innerHTML =
    '<div class="ticket-table-scroll" tabindex="0" aria-label="Tickets一覧。横にスクロールできます"><table class="ticket-table"><caption class="visually-hidden">同じタスクを行で表示</caption><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th><th>Due</th><th>Subtasks</th>' +
    (document.body.dataset.projectOperations === "true"
      ? "<th>Project</th>"
      : "") +
    "</tr></thead><tbody>" +
    groups
      .map(
        (group) =>
          (group.tasks.length && group.title
            ? '<tr class="ticket-group"><th colspan="' +
              (document.body.dataset.projectOperations === "true" ? 7 : 6) +
              '">' +
              escapeHtml(group.title) +
              " <span>" +
              group.tasks.length +
              "</span></th></tr>"
            : "") +
          group.tasks
            .map((task) => {
              const disabled =
                operationBusy || pendingOperation || window.__atoBoardError
                  ? " disabled"
                  : "";
              return (
                '<tr data-ticket-id="' +
                escapeAttr(task.id) +
                '"><td class="ticket-number">' +
                escapeHtml(formatTaskNumber(task.number)) +
                '</td><td><button type="button" class="ticket-title" data-open-task="' +
                escapeAttr(task.id) +
                '"' +
                disabled +
                ">" +
                escapeHtml(task.title) +
                "</button>" +
                (ui.description
                  ? '<p class="ticket-description">' +
                    escapeHtml(task.description) +
                    "</p>"
                  : "") +
                (task.recurrenceId
                  ? '<span class="ticket-recurrence">↻ 毎週</span>'
                  : "") +
                "</td>" +
                '<td><span class="ticket-status">' +
                window.TaskBoardSelectors.statusMark(task) +
                '<select aria-label="' +
                escapeAttr(formatTaskNumber(task.number) + " ステータス") +
                '" data-inline-status="' +
                escapeAttr(task.id) +
                '"' +
                disabled +
                ">" +
                getColumns()
                  .map(
                    (c) =>
                      '<option value="' +
                      escapeAttr(c.id) +
                      '"' +
                      (task.columnId === c.id ? " selected" : "") +
                      ">" +
                      escapeHtml(c.title) +
                      "</option>",
                  )
                  .join("") +
                "</select></span></td>" +
                '<td><span class="task-priority" data-priority="' +
                escapeAttr(task.priority) +
                '">' +
                { high: "↑ 高", medium: "＝ 中", low: "↓ 低", none: "— なし" }[
                  task.priority
                ] +
                '</span></td><td class="' +
                (isOverdue(task) ? "overdue" : "") +
                '">' +
                (task.dueAt ? "◷ " : "") +
                escapeHtml(task.dueAt?.slice(0, 10) || "—") +
                (isOverdue(task) ? " 期限切れ" : "") +
                "</td><td>☑ " +
                task.subtasks.filter((s) => s.completed).length +
                "/" +
                task.subtasks.length +
                "</td>" +
                (document.body.dataset.projectOperations === "true"
                  ? "<td>" +
                    escapeHtml(
                      state.projects?.[task.projectId]?.name || "Unassigned",
                    ) +
                    "</td>"
                  : "") +
                "</tr>"
              );
            })
            .join(""),
      )
      .join("") +
    "</tbody></table></div>" +
    (!tasks.length
      ? '<div class="workspace-empty">一致するタスクはありません。検索やフィルターを変更してください。<button class="secondary" data-add-column="todo">＋ New ticket</button></div>'
      : "");
};
