"use strict";
window.renderTickets = function () {
  const panel = document.getElementById("ticketsView"),
    ui = window.TaskBoardViewState,
    meta = window.TaskBoardSelectors;
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
    '<div class="ticket-table-scroll" tabindex="0" aria-label="Tickets一覧"><table class="ticket-table" role="table"><caption class="visually-hidden">同じタスクを行で表示</caption><thead role="rowgroup"><tr role="row"><th scope="col">ID</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Due</th><th scope="col">Subtasks</th>' +
    (document.body.dataset.projectOperations === "true"
      ? '<th scope="col">Project</th>'
      : "") +
    '</tr></thead><tbody role="rowgroup">' +
    groups
      .map(
        (group) =>
          (group.tasks.length && group.title
            ? '<tr role="row" class="ticket-group"><th colspan="' +
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
                '<tr role="row" data-ticket-id="' +
                escapeAttr(task.id) +
                '"><td role="cell" class="ticket-number">' +
                escapeHtml(formatTaskNumber(task.number)) +
                '</td><td role="cell" class="ticket-title-cell"><button type="button" class="ticket-title" data-open-task="' +
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
                  ? '<span class="ticket-recurrence">' +
                    TaskBoardIcons.icon("repeat") +
                    " 毎週</span>"
                  : "") +
                "</td>" +
                '<td role="cell" class="ticket-status-cell"><span class="ticket-status">' +
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
                '<td role="cell" class="ticket-priority-cell" data-empty="' +
                (task.priority === "none") +
                '">' +
                meta.priority(task, true) +
                "</td>" +
                '<td role="cell" class="ticket-due-cell" data-empty="' +
                !task.dueAt +
                '">' +
                meta.due(task, true) +
                "</td>" +
                '<td role="cell" class="ticket-subtasks-cell" data-empty="' +
                !task.subtasks.length +
                '">' +
                meta.subtasks(task, true) +
                "</td>" +
                (document.body.dataset.projectOperations === "true"
                  ? '<td role="cell" class="ticket-project-cell">' +
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
      ? '<div class="workspace-empty">一致するタスクはありません。検索やフィルターを変更してください。<button class="secondary" data-add-column="todo">' +
        TaskBoardIcons.icon("plus") +
        " New ticket</button></div>"
      : "");
};
