"use strict";

// Bulk archive action for the Done column. Kept as a UI extension so the
// existing state schema and individual archive behavior remain unchanged.
(function installArchiveAllDoneFeature() {
  const style = document.createElement("style");
  style.textContent = `
        .column-head-actions {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: auto;
        }
        .archive-all-done-btn {
          height: 34px;
          min-height: 34px;
          padding: 0 9px;
          border: 1px solid var(--line);
          border-radius: 10px;
          background: var(--panel);
          color: var(--muted);
          font-size: 11px;
          font-weight: 750;
          white-space: nowrap;
        }
        .archive-all-done-btn:hover:not(:disabled) {
          border-color: var(--line-strong);
          color: var(--text);
        }
      `;
  document.head.appendChild(style);

  function activeDoneTasks() {
    return Object.values(state.tasks).filter(
      (task) => task && task.columnId === "done" && !task.archived,
    );
  }

  function ensureButton() {
    const doneColumn = dom.board.querySelector(
      '.column[data-column-id="done"]',
    );
    const head = doneColumn?.querySelector(".column-head");
    if (!head) return;

    let button = head.querySelector("[data-archive-all-done]");
    if (!button) {
      const actions = document.createElement("div");
      actions.className = "column-head-actions";

      button = document.createElement("button");
      button.type = "button";
      button.className = "archive-all-done-btn";
      button.dataset.archiveAllDone = "true";
      button.textContent = "全てアーカイブ";

      const addButton = head.querySelector('[data-add-column="done"]');
      actions.appendChild(button);
      if (addButton) actions.appendChild(addButton);
      head.appendChild(actions);
    }

    const count = activeDoneTasks().length;
    button.disabled = count === 0;
    button.title = count
      ? `Doneの${count}件をすべてアーカイブ`
      : "アーカイブ対象はありません";
  }

  dom.board.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-archive-all-done]");
    if (!button) return;

    const tasks = activeDoneTasks();
    if (!tasks.length) {
      toast("アーカイブ対象はありません");
      return;
    }

    if (!confirm(`Doneの${tasks.length}件をすべてアーカイブしますか？`)) return;

    await runOperation("todo_archive_done", {}, (result) =>
      toast(result.result.count + "件をアーカイブしました"),
    );
  });

  const observer = new MutationObserver(() => ensureButton());
  observer.observe(dom.board, { childList: true, subtree: true });
  ensureButton();
})();
