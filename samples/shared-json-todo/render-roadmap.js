"use strict";
(function () {
  const ui = window.TaskBoardViewState;
  const day = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value
      ? date
      : null;
  };
  const key = (date) => date.toISOString().slice(0, 10);
  function range() {
    const date = day(ui.anchor) || new Date();
    const start = new Date(
      Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        ui.zoom === "week"
          ? date.getUTCDate() - ((date.getUTCDay() + 6) % 7)
          : 1,
      ),
    );
    const end = new Date(start);
    if (ui.zoom === "week") end.setUTCDate(end.getUTCDate() + 7);
    else end.setUTCMonth(end.getUTCMonth() + (ui.zoom === "quarter" ? 3 : 1));
    return { start, end, days: (end - start) / 86400000 };
  }
  function projectTasks(project) {
    return Object.values(state.tasks).filter((t) => t.projectId === project.id);
  }
  function projectButton(p) {
    const tasks = projectTasks(p),
      done = tasks.filter((t) => t.completed).length;
    const status =
      p.status ||
      (tasks.length && done === tasks.length
        ? "Completed"
        : tasks.some((t) => t.columnId === "progress")
          ? "In progress"
          : "Planned");
    return (
      '<button class="project-name" data-open-project="' +
      escapeAttr(p.id) +
      '"><strong>' +
      escapeHtml(p.name) +
      "</strong><span>" +
      done +
      "/" +
      tasks.length +
      " 完了 · " +
      escapeHtml(status) +
      "</span></button>"
    );
  }
  function taskLinks(tasks) {
    return tasks
      .map(
        (t) =>
          '<button class="unassigned-ticket" data-open-task="' +
          escapeAttr(t.id) +
          '"><span>' +
          escapeHtml(formatTaskNumber(t.number)) +
          " " +
          escapeHtml(t.title) +
          '</span><span class="task-meta">' +
          window.TaskBoardSelectors.meta(t) +
          "</span></button>",
      )
      .join("");
  }

  window.renderRoadmap = function () {
    const panel = document.getElementById("roadmapView"),
      { start, end, days } = range();
    const projects = window.TaskBoardSelectors.projects().filter(
      (p) => !ui.project || p.id === ui.project,
    );
    const tasks = window.TaskBoardSelectors.tasks();
    const pct = (date) =>
      Math.max(0, Math.min(100, ((date - start) / 86400000 / days) * 100));
    const today = day(localDateString(new Date()));
    const trackStyle =
      ' style="--tick-size:' +
      ((ui.zoom === "week" ? 1 : 7) / days) * 100 +
      '%"';
    const line =
      today >= start && today < end
        ? '<span class="today-line" style="left:' +
          pct(today) +
          '%" aria-hidden="true"></span>'
        : "";
    let ticks = "";
    for (let i = 0; i < days; i += ui.zoom === "week" ? 1 : 7) {
      const date = new Date(+start + i * 86400000);
      ticks +=
        '<span class="timeline-tick" style="left:' +
        (i / days) * 100 +
        '%">' +
        (date.getUTCMonth() + 1) +
        "/" +
        date.getUTCDate() +
        "</span>";
    }
    panel.innerHTML =
      '<div class="roadmap-toolbar"><span>' +
      key(start) +
      " — " +
      key(new Date(+end - 86400000)) +
      '</span><div><button class="secondary" data-time-step="-1" aria-label="前の期間">‹</button><button class="secondary" data-time-step="0">Today</button><button class="secondary" data-time-step="1" aria-label="次の期間">›</button><label class="visually-hidden" for="roadmapZoom">タイムラインの表示範囲</label><select id="roadmapZoom">' +
      ["week", "month", "quarter"]
        .map(
          (z) =>
            '<option value="' +
            z +
            '"' +
            (z === ui.zoom ? " selected" : "") +
            ">" +
            { week: "Week", month: "Month", quarter: "Quarter" }[z] +
            "</option>",
        )
        .join("") +
      "</select></div></div>" +
      (document.body.dataset.projectOperations !== "true"
        ? '<p class="contract-note">Projectの作成・期間設定は新しいTODO契約への切替後に利用できます。既存のタスクはUnassignedに表示します。</p>'
        : "") +
      '<p class="timeline-hint">◆ Ticketの期限 · │ Today · 横にスクロールして期間を確認</p><div class="timeline-scroll" tabindex="0" aria-label="Projectタイムライン。横にスクロールできます"><div class="project-timeline"><div class="project-lane timeline-head"><span>Project / Progress / Status</span><div class="project-track"' +
      trackStyle +
      ">" +
      ticks +
      "</div></div>" +
      projects
        .filter((p) => day(p.startDate) && day(p.targetDate))
        .map((p) => {
          const first = day(p.startDate),
            last = day(p.targetDate),
            after = new Date(+last + 86400000),
            outside = after <= start || first >= end;
          const own = tasks.filter(
            (t) => t.projectId === p.id && day(t.dueAt?.slice(0, 10)),
          );
          return (
            '<div class="project-lane">' +
            projectButton(p) +
            '<div class="project-track"' +
            trackStyle +
            ">" +
            line +
            (outside
              ? '<button class="outside-project" data-time-jump="' +
                escapeAttr(p.startDate) +
                '">' +
                (after <= start ? "← " : "") +
                escapeHtml(p.startDate + " — " + p.targetDate) +
                (first >= end ? " →" : "") +
                "</button>"
              : '<button class="project-bar" data-open-project="' +
                escapeAttr(p.id) +
                '" style="left:' +
                pct(first) +
                "%;width:" +
                Math.max(0.5, pct(after) - pct(first)) +
                '%" aria-label="' +
                escapeAttr(
                  p.name + " " + p.startDate + " から " + p.targetDate,
                ) +
                '">' +
                escapeHtml(p.name) +
                (first < start ? " ←" : "") +
                (after > end ? " →" : "") +
                "</button>") +
            own
              .filter(
                (t) =>
                  day(t.dueAt.slice(0, 10)) >= start &&
                  day(t.dueAt.slice(0, 10)) < end,
              )
              .map(
                (t) =>
                  '<button class="ticket-marker" data-open-task="' +
                  escapeAttr(t.id) +
                  '" style="left:' +
                  pct(day(t.dueAt.slice(0, 10))) +
                  '%" aria-label="' +
                  escapeAttr(t.title + " 期限 " + t.dueAt.slice(0, 10)) +
                  '">◆</button>',
              )
              .join("") +
            "</div></div>"
          );
        })
        .join("") +
      '</div></div><section class="project-unscheduled"><h2>Unscheduled</h2>' +
      projects
        .filter((p) => !day(p.startDate) || !day(p.targetDate))
        .map(projectButton)
        .join("") +
      (projects.some((p) => !day(p.startDate) || !day(p.targetDate))
        ? ""
        : "<p>日時未設定のProjectはありません</p>") +
      '</section><section class="project-unassigned"><h2>Unassigned <span>' +
      tasks.filter((t) => !t.projectId).length +
      "</span></h2>" +
      taskLinks(tasks.filter((t) => !t.projectId)) +
      "</section>";
  };
  window.renderProjects = function () {
    const panel = document.getElementById("projectsView");
    panel.innerHTML =
      '<div class="projects-head">' +
      (document.body.dataset.projectOperations === "true"
        ? '<button class="primary" data-new-project>＋ New project</button>'
        : "<p>Projectの永続化は新しいTODO契約への切替が必要です</p>") +
      "</div>" +
      window.TaskBoardSelectors.projects().map(projectButton).join("");
  };
  document.addEventListener("click", (event) => {
    const step = event.target.closest("[data-time-step]");
    const jump = event.target.closest("[data-time-jump]");
    if (!step && !jump) return;
    if (jump) ui.anchor = jump.dataset.timeJump;
    else if (step.dataset.timeStep === "0")
      ui.anchor = localDateString(new Date());
    else {
      const { start } = range();
      if (ui.zoom === "week")
        start.setUTCDate(
          start.getUTCDate() + Number(step.dataset.timeStep) * 7,
        );
      else
        start.setUTCMonth(
          start.getUTCMonth() +
            Number(step.dataset.timeStep) * (ui.zoom === "quarter" ? 3 : 1),
        );
      ui.anchor = key(start);
    }
    window.renderRoadmap();
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "roadmapZoom") {
      ui.zoom = event.target.value;
      window.renderRoadmap();
      document.getElementById("roadmapZoom").focus();
    }
  });
})();
