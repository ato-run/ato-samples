"use strict";
(function () {
  const ui = window.TaskBoardViewState,
    selectors = window.TaskBoardSelectors,
    content = document.querySelector(".workspace-content");
  let initialDraft = "",
    editorCommitted = false,
    returnFocus = null,
    editBasis = null,
    restoreFocusPending = false;
  const projectEnabled = document.body.dataset.projectOperations === "true";
  const toolbar = document.querySelector(".toolbar");
  const controls = document.createElement("div");
  controls.className = "view-options";
  controls.innerHTML =
    '<details id="filterMenu"><summary>Filter</summary><div class="filter-fields"><label>Status<select id="statusFilter"><option value="">すべてのステータス</option>' +
    getColumns()
      .map(
        (c) =>
          '<option value="' +
          escapeAttr(c.id) +
          '">' +
          escapeHtml(c.title) +
          "</option>",
      )
      .join("") +
    '</select></label><div id="sharedFilters"></div></div></details><label>Group<select id="groupSelect"><option value="status">Status</option><option value="priority">Priority</option><option value="none">None</option>' +
    (projectEnabled ? '<option value="project">Project</option>' : "") +
    '</select></label><label>Sort<select id="sortSelect"><option value="order">手動の並び順</option><option value="due">期限が近い順</option><option value="priority">優先度が高い順</option><option value="updated">更新が新しい順</option></select></label><details><summary>Display</summary><label><input type="checkbox" id="descriptionDisplay">説明を表示</label><button class="secondary" id="keyboardShortcuts" type="button" aria-pressed="false">文字ショートカットを有効にする</button><p class="keyboard-help">有効時：C 新規 · / 検索。Escで詳細を閉じ、タスクにフォーカスして↑↓で移動できます。</p></details>';
  toolbar.after(controls);
  const shared = controls.querySelector("#sharedFilters");
  shared.append(dom.priorityFilter, dom.dueFilter);
  const archive = document.querySelector(".archive-toggle-btn");
  if (archive) shared.append(archive);
  dom.search.setAttribute(
    "aria-label",
    "タスク番号・タイトル・説明・サブタスクを検索",
  );
  dom.search.placeholder = "検索…";
  dom.globalAdd.textContent = "＋ New ticket";
  const notice = document.createElement("p");
  notice.id = "boardAvailability";
  notice.className = "board-availability";
  notice.setAttribute("role", "status");
  controls.after(notice);
  const projectField = document.createElement("div");
  projectField.className = "field";
  projectField.innerHTML =
    '<label for="taskProjectSelect">Project</label><select id="taskProjectSelect" class="control"></select>';
  if (projectEnabled)
    document.querySelector(".modal-body").append(projectField);
  const timestamps = document.createElement("p");
  timestamps.className = "task-timestamps";
  document.querySelector(".modal-body").append(timestamps);
  const draft = () =>
    JSON.stringify({
      fields: [
        ...document.querySelectorAll(
          ".modal-body input,.modal-body textarea,.modal-body select",
        ),
      ].map((el) => [el.id, el.type === "checkbox" ? el.checked : el.value]),
      subtasks: draftSubtasks,
    });
  const baseOpen = openTaskModal,
    baseClose = closeModal;
  openTaskModal = function (taskId = null, columnId = "todo") {
    if (operationBusy || pendingOperation || window.__atoBoardError) {
      toast("正本と操作の結果を確認してください");
      return;
    }
    returnFocus = document.activeElement;
    editorCommitted = false;
    baseOpen(taskId, columnId);
    if (projectEnabled) {
      const select = document.getElementById("taskProjectSelect");
      select.innerHTML =
        '<option value="">Unassigned</option>' +
        selectors
          .projects()
          .map(
            (p) =>
              '<option value="' +
              escapeAttr(p.id) +
              '">' +
              escapeHtml(p.name) +
              "</option>",
          )
          .join("");
      select.value = state.tasks[taskId]?.projectId || "";
    }
    const task = state.tasks[taskId];
    editBasis = task?.editVersion || 0;
    timestamps.textContent = task
      ? "作成 " + (task.createdAt || "—") + " · 更新 " + (task.updatedAt || "—")
      : "";
    initialDraft = draft();
    content.inert = true;
    document.querySelector(".workspace-rail").inert = true;
    document.body.classList.add("drawer-open");
  };
  function dismiss(force = false) {
    if (
      !force &&
      !editorCommitted &&
      draft() !== initialDraft &&
      !confirm("保存していない変更を破棄しますか？")
    )
      return false;
    baseClose();
    content.inert = false;
    document.querySelector(".workspace-rail").inert = false;
    document.body.classList.remove("drawer-open");
    restoreFocusPending = true;
    if (!operationBusy) restoreEditorFocus();
    return true;
  }
  function restoreEditorFocus() {
    if (
      returnFocus?.isConnected &&
      !returnFocus.disabled &&
      !returnFocus.closest("[hidden]")
    )
      returnFocus.focus();
    else if (!dom.globalAdd.disabled) dom.globalAdd.focus();
    restoreFocusPending = false;
  }
  closeModal = () => dismiss();
  // Legacy listeners captured the original close function; route them through the draft guard.
  for (const button of [dom.closeModal, dom.cancelTask])
    button.addEventListener(
      "click",
      (event) => {
        event.stopImmediatePropagation();
        dismiss();
      },
      true,
    );
  dom.modalBackdrop.addEventListener(
    "click",
    (event) => {
      if (event.target === dom.modalBackdrop) {
        event.stopImmediatePropagation();
        dismiss();
      }
    },
    true,
  );
  dom.modalBackdrop.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const items = [
      ...dom.modalBackdrop.querySelectorAll("button,input,select,textarea"),
    ].filter(
      (el) =>
        !el.disabled &&
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== "hidden",
    );
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  });
  function setView(next, screen = "tasks") {
    if (!["kanban", "tickets", "roadmap"].includes(next)) next = "kanban";
    ui.view = next;
    ui.screen = screen;
    const url = new URL(location.href);
    url.searchParams.set("view", next);
    history.replaceState(history.state, "", url);
    render();
  }
  function renderWorkspace() {
    const unavailable = !!window.__atoBoardError;
    notice.hidden = !unavailable;
    notice.textContent = unavailable
      ? boardFailureLabel(window.__atoBoardError)
      : "";
    const name =
      ui.screen === "projects"
        ? "Projects"
        : { kanban: "Kanban", tickets: "Tickets", roadmap: "Roadmap" }[ui.view];
    document.getElementById("currentViewTitle").textContent = name;
    document.querySelectorAll("[role=tab][data-view]").forEach((tab) => {
      const selected = tab.dataset.view === ui.view && ui.screen === "tasks";
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    for (const view of ["kanban", "tickets", "roadmap"])
      document.getElementById(view + "View").hidden =
        unavailable || ui.screen !== "tasks" || ui.view !== view;
    document.getElementById("projectsView").hidden =
      unavailable || ui.screen !== "projects";
    document.querySelector(".view-strip").hidden = ui.screen !== "tasks";
    document.getElementById("taskResultCount").textContent =
      selectors.tasks().length + " tickets";
    if (!unavailable && ui.screen === "projects") window.renderProjects();
    if (!unavailable && ui.screen === "tasks" && ui.view === "tickets")
      window.renderTickets();
    if (!unavailable && ui.screen === "tasks" && ui.view === "roadmap")
      window.renderRoadmap();
    document.querySelectorAll(".task-card").forEach((card) => {
      card.draggable =
        ui.sort === "order" &&
        !operationBusy &&
        !pendingOperation &&
        !unavailable;
      card.tabIndex = 0;
      card.setAttribute("role", "group");
      card.setAttribute(
        "aria-label",
        state.tasks[card.dataset.taskId]?.title || "タスク",
      );
      card
        .querySelectorAll("[data-task-handle]")
        .forEach(
          (handle) => (handle.disabled = ui.sort !== "order" || unavailable),
        );
    });
    document.querySelectorAll(".column-title").forEach((title) => {
      if (!title.querySelector(".status-dot")) {
        const dot = document.createElement("span");
        dot.className = "status-dot";
        dot.dataset.status = title.closest(".column").dataset.columnId;
        dot.setAttribute("aria-hidden", "true");
        title.prepend(dot);
      }
    });
    document.getElementById("groupSelect").disabled =
      ui.view !== "tickets" || ui.screen !== "tasks";
    setOperationControls();
    if (restoreFocusPending && !operationBusy) restoreEditorFocus();
  }
  const baseCard = renderTaskCard;
  renderTaskCard = function (task) {
    const card = baseCard(task);
    const meta = card.querySelector(".task-meta");
    if (meta) meta.innerHTML = selectors.meta(task);
    if (ui.description && task.description) {
      const text = document.createElement("p");
      text.className = "card-description";
      text.textContent = task.description;
      card.append(text);
    }
    return card;
  };
  controls.addEventListener("change", (event) => {
    const map = {
      statusFilter: "status",
      groupSelect: "group",
      sortSelect: "sort",
    };
    if (map[event.target.id]) ui[map[event.target.id]] = event.target.value;
    if (event.target.id === "descriptionDisplay")
      ui.description = event.target.checked;
    render();
  });
  document.addEventListener("change", async (event) => {
    const el = event.target.closest("[data-inline-status]");
    if (!el) return;
    const id = el.dataset.inlineStatus;
    await runOperation("todo_update", {
      id,
      column_id: el.value,
      completed: el.value === "done",
    });
    document
      .querySelector('[data-inline-status="' + CSS.escape(id) + '"]')
      ?.focus();
  });
  document.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-view]");
    if (tab) setView(tab.dataset.view, tab.dataset.screen || "tasks");
    if (event.target.closest('[data-screen="projects"]')) {
      ui.screen = "projects";
      render();
    }
    if (event.target.closest("#archivedNav")) {
      if (archive?.getAttribute("aria-pressed") !== "true") archive?.click();
      setView("tickets");
    }
    if (event.target.closest("#railToggle")) {
      const collapsed = document.body.classList.toggle("rail-collapsed");
      document
        .getElementById("railToggle")
        .setAttribute("aria-expanded", String(!collapsed));
    }
    if (event.target.closest("#keyboardShortcuts")) {
      const button = event.target.closest("button");
      button.setAttribute(
        "aria-pressed",
        String(button.getAttribute("aria-pressed") !== "true"),
      );
    }
    const row = event.target.closest("[data-ticket-id]");
    if (row && !event.target.closest("button,input,select,a"))
      openTaskModal(row.dataset.ticketId);
    const card = event.target.closest(".task-card");
    if (card && !event.target.closest("button,input,select,a,[data-open-task]"))
      openTaskModal(card.dataset.taskId);
    if (event.target.closest("[data-new-project]")) openProject();
    const project = event.target.closest("[data-open-project]");
    if (project) openProject(project.dataset.openProject);
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        dom.modalBackdrop.classList.contains("open")
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismiss();
        return;
      }
      if (
        event.target.closest("dialog") ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        event.target.closest(
          'input,select,textarea,[contenteditable="true"],[role="textbox"]',
        )
      )
        return;
      const tab = event.target.closest("[role=tab]");
      if (
        tab &&
        ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
      ) {
        event.preventDefault();
        const tabs = [...document.querySelectorAll("[role=tab]")];
        const n =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        setView(tabs[n].dataset.view);
        tabs[n].focus();
        return;
      }
      const items = [
        ...document.querySelectorAll(
          ui.view === "kanban"
            ? ".task-card"
            : ui.view === "tickets"
              ? ".ticket-title"
              : "#roadmapView [data-open-task]",
        ),
      ].filter((el) => el.getClientRects().length);
      const item = event.target.closest(
        ".task-card,.ticket-title,[data-open-task]",
      );
      if (item && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        items[
          Math.max(
            0,
            Math.min(
              items.length - 1,
              items.indexOf(item) + (event.key === "ArrowDown" ? 1 : -1),
            ),
          )
        ]?.focus();
        return;
      }
      if (
        item?.classList.contains("task-card") &&
        ["Enter", " "].includes(event.key)
      ) {
        event.preventDefault();
        openTaskModal(item.dataset.taskId);
        return;
      }
      // Character shortcuts are opt-in so screen-reader browse commands are never assumed to be app commands.
      if (
        document
          .getElementById("keyboardShortcuts")
          .getAttribute("aria-pressed") === "true" &&
        !dom.modalBackdrop.classList.contains("open")
      ) {
        if (event.key === "c") {
          event.preventDefault();
          openTaskModal();
        }
        if (event.key === "/") {
          event.preventDefault();
          dom.search.focus();
        }
      }
    },
    true,
  );
  function openProject(id = null) {
    if (
      !projectEnabled ||
      operationBusy ||
      pendingOperation ||
      window.__atoBoardError
    )
      return;
    const project = id ? state.projects?.[id] : null;
    if (id && !project) return;
    const dialog = document.createElement("dialog");
    dialog.className = "project-dialog";
    dialog.innerHTML =
      '<form method="dialog"><h2>' +
      (project ? "Project" : "New project") +
      '</h2><label>Name<input name="name" maxlength="160" required value="' +
      escapeAttr(project?.name || "") +
      '"></label><label>Description<textarea name="description" maxlength="5000">' +
      escapeHtml(project?.description || "") +
      '</textarea></label><div class="form-row"><label>Start date<input type="date" name="start" value="' +
      escapeAttr(project?.startDate || "") +
      '"></label><label>Target date<input type="date" name="target" value="' +
      escapeAttr(project?.targetDate || "") +
      '"></label></div><p class="project-error" role="alert"></p><div class="project-tickets">' +
      (id
        ? Object.values(state.tasks)
            .filter((t) => t.projectId === id)
            .map(
              (t) =>
                '<button type="button" data-project-ticket="' +
                escapeAttr(t.id) +
                '">' +
                escapeHtml(formatTaskNumber(t.number) + " " + t.title) +
                "</button>",
            )
            .join("")
        : "") +
      "</div><footer>" +
      (id
        ? '<button type="button" class="danger" data-delete-project>削除してTicketsをUnassignedへ戻す</button>'
        : "") +
      '<button value="cancel" class="secondary">キャンセル</button><button type="button" class="primary" data-save-project>保存</button></footer></form>';
    document.body.append(dialog);
    dialog.showModal();
    const form = dialog.querySelector("form"),
      initial = new FormData(form);
    const signature = () => JSON.stringify([...new FormData(form)]);
    const before = JSON.stringify([...initial]);
    let committed = false;
    dialog.addEventListener("cancel", (event) => {
      if (
        !committed &&
        signature() !== before &&
        !confirm("保存していない変更を破棄しますか？")
      )
        event.preventDefault();
    });
    form.addEventListener("submit", (event) => {
      if (
        !committed &&
        signature() !== before &&
        !confirm("保存していない変更を破棄しますか？")
      )
        event.preventDefault();
    });
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", async (event) => {
      const error = dialog.querySelector(".project-error");
      if (event.target.closest("[data-project-ticket]")) {
        if (
          signature() !== before &&
          !confirm("保存していない変更を破棄しますか？")
        )
          return;
        dialog.close();
        openTaskModal(event.target.dataset.projectTicket);
        return;
      }
      if (event.target.closest("[data-save-project]")) {
        if (!form.reportValidity()) return;
        const data = new FormData(form),
          start = data.get("start"),
          target = data.get("target");
        if (start && target && start > target) {
          error.textContent = "開始日は終了日以前にしてください";
          return;
        }
        const result = await runOperation(
          id ? "todo_project_update" : "todo_project_create",
          {
            id: id || "project_" + crypto.randomUUID(),
            ...(id ? { expected_version: project.editVersion || 0 } : {}),
            name: data.get("name"),
            description: data.get("description"),
            start_date: start,
            target_date: target,
          },
          () => {
            committed = true;
            dialog.close();
          },
        );
        if (!result)
          error.textContent =
            "保存できませんでした。操作の結果を確認してください";
      }
      if (
        event.target.closest("[data-delete-project]") &&
        confirm(
          "Projectを削除し、所属Ticketsと繰り返しをUnassignedへ戻します。Tickets自体は残ります。",
        )
      ) {
        await runOperation(
          "todo_project_delete",
          {
            id,
            confirm: true,
            expected_version: project.editVersion || 0,
          },
          () => {
            committed = true;
            dialog.close();
          },
        );
      }
    });
  }
  window.TaskBoardUI = Object.freeze({
    render: renderWorkspace,
    committed: (id) => {
      if (["todo_create", "todo_update", "todo_delete"].includes(id))
        editorCommitted = true;
    },
    revoke: () => {
      editorCommitted = true;
      dismiss(true);
      document.querySelector(".project-dialog")?.close();
      dom.title.value = dom.description.value = "";
      draftSubtasks = [];
    },
    taskVersion: (id) =>
      id === editingTaskId ? editBasis : state.tasks[id]?.editVersion || 0,
    taskArguments: (args) => {
      if (projectEnabled) {
        if (editingTaskId) args.expected_version = editBasis;
        const value =
          document.getElementById("taskProjectSelect").value || null;
        if (value !== (state.tasks[editingTaskId]?.projectId || null))
          args.project_id = value || "";
      }
    },
  });
  if (window.top !== window.self) document.body.classList.add("rail-collapsed");
  render();
})();
