"use strict";

// Show a compact subtask list directly on board cards so tasks created or
// updated through Operations expose their subtasks without opening modal.
(function installDashboardSubtaskPreview() {
  const MAX_VISIBLE_SUBTASKS = 6;

  const style = document.createElement("style");
  style.textContent = `
        .task-subtasks-preview {
          margin-top: 10px;
          display: grid;
          gap: 5px;
          padding: 8px 9px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: color-mix(in srgb, var(--panel-2) 58%, transparent);
          cursor: pointer;
        }
        .task-subtask-preview-row {
          display: grid;
          grid-template-columns: 14px minmax(0, 1fr);
          gap: 6px;
          align-items: start;
          min-width: 0;
          font-size: 11px;
          line-height: 1.35;
          color: var(--text);
        }
        .task-subtask-preview-mark {
          display: grid;
          place-items: center;
          width: 14px;
          height: 14px;
          margin-top: 1px;
          border: 1px solid var(--line-strong);
          border-radius: 4px;
          color: var(--muted);
          font-size: 9px;
          font-weight: 900;
          background: var(--panel);
        }
        .task-subtask-preview-row.done .task-subtask-preview-mark {
          background: var(--text);
          border-color: var(--text);
          color: var(--panel);
        }
        .task-subtask-preview-title {
          overflow-wrap: anywhere;
        }
        .task-subtask-preview-row.done .task-subtask-preview-title {
          color: var(--muted);
          text-decoration: line-through;
        }
        .task-subtasks-more {
          padding-left: 20px;
          color: var(--muted);
          font-size: 10.5px;
          font-weight: 700;
        }
      `;
  document.head.appendChild(style);

  const baseRenderTaskCard = renderTaskCard;
  renderTaskCard = function (task) {
    const card = baseRenderTaskCard(task);
    const subtasks = Array.isArray(task.subtasks)
      ? [...task.subtasks].sort((a, b) => (a.order || 0) - (b.order || 0))
      : [];
    if (!subtasks.length) return card;

    const preview = document.createElement("div");
    preview.className = "task-subtasks-preview";
    preview.dataset.openTask = task.id;
    preview.setAttribute("aria-label", `${task.title} のサブタスク`);

    for (const subtask of subtasks.slice(0, MAX_VISIBLE_SUBTASKS)) {
      const row = document.createElement("div");
      row.className = `task-subtask-preview-row${subtask.completed ? " done" : ""}`;

      const mark = document.createElement("span");
      mark.className = "task-subtask-preview-mark";
      mark.textContent = subtask.completed ? "✓" : "";

      const title = document.createElement("span");
      title.className = "task-subtask-preview-title";
      title.textContent = subtask.title;

      row.append(mark, title);
      preview.appendChild(row);
    }

    if (subtasks.length > MAX_VISIBLE_SUBTASKS) {
      const more = document.createElement("div");
      more.className = "task-subtasks-more";
      more.textContent = `＋${subtasks.length - MAX_VISIBLE_SUBTASKS}件`;
      preview.appendChild(more);
    }

    const progress = card.querySelector(".sub-progress");
    if (progress) card.insertBefore(preview, progress);
    else card.appendChild(preview);
    return card;
  };

  render();
})();
