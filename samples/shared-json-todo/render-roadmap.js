"use strict";
(function () {
  const ui = window.TaskBoardViewState,
    icon = (name) => TaskBoardIcons.icon(name);
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
  function progress(project) {
    const tasks = Object.values(state.tasks).filter(
      (task) => task.projectId === project.id,
    );
    const done = tasks.filter((task) => task.completed).length;
    const status =
      project.status ||
      (tasks.length && done === tasks.length
        ? "Completed"
        : tasks.some((task) => task.columnId === "progress")
          ? "In progress"
          : "Planned");
    return done + "/" + tasks.length + " 完了 · " + escapeHtml(status);
  }
  function projectButton(project, mobile = false) {
    return (
      '<button class="' +
      (mobile ? "mobile-project-card" : "project-name") +
      '" data-open-project="' +
      escapeAttr(project.id) +
      '"><strong>' +
      escapeHtml(project.name) +
      "</strong><span>" +
      progress(project) +
      "</span>" +
      (mobile
        ? '<span class="project-dates">' +
          icon("calendar") +
          escapeHtml(project.startDate + " — " + project.targetDate) +
          "</span>"
        : "") +
      "</button>"
    );
  }
  function taskLinks(tasks) {
    return tasks
      .map(
        (task) =>
          '<button class="unassigned-ticket" data-open-task="' +
          escapeAttr(task.id) +
          '"><span class="unassigned-title"><span class="ticket-number">' +
          escapeHtml(formatTaskNumber(task.number)) +
          "</span> " +
          escapeHtml(task.title) +
          '</span><span class="task-meta">' +
          TaskBoardSelectors.meta(task) +
          "</span></button>",
      )
      .join("");
  }
  window.renderRoadmap = function () {
    const panel = document.getElementById("roadmapView"),
      { start, end, days } = range();
    const enabled = document.body.dataset.projectOperations === "true";
    const projects = TaskBoardSelectors.projects().filter(
      (p) => !ui.project || p.id === ui.project,
    );
    const tasks = TaskBoardSelectors.tasks(),
      scheduled = projects.filter((p) => day(p.startDate) && day(p.targetDate));
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
    const timeline =
      '<div class="roadmap-toolbar"><span>' +
      key(start) +
      " — " +
      key(new Date(+end - 86400000)) +
      '</span><div><button class="secondary" data-time-step="-1" aria-label="前の期間">' +
      icon("left") +
      '</button><button class="secondary" data-time-step="0">Today</button><button class="secondary" data-time-step="1" aria-label="次の期間">' +
      icon("right") +
      '</button><label class="visually-hidden" for="roadmapZoom">タイムラインの表示範囲</label><select id="roadmapZoom">' +
      ["week", "month", "quarter"]
        .map(
          (zoom) =>
            '<option value="' +
            zoom +
            '"' +
            (zoom === ui.zoom ? " selected" : "") +
            ">" +
            { week: "Week", month: "Month", quarter: "Quarter" }[zoom] +
            "</option>",
        )
        .join("") +
      "</select></div></div>" +
      '<p class="timeline-hint">' +
      icon("deadline") +
      ' Ticketの期限 · Today線 · 横にスクロールできます</p><div class="timeline-scroll" tabindex="0" aria-label="Projectタイムライン。横にスクロールできます"><div class="project-timeline"><div class="project-lane timeline-head"><span>Project / Progress / Status</span><div class="project-track"' +
      trackStyle +
      ">" +
      ticks +
      "</div></div>" +
      scheduled
        .map((project) => {
          const first = day(project.startDate),
            after = new Date(+day(project.targetDate) + 86400000),
            outside = after <= start || first >= end;
          const own = tasks.filter(
            (task) =>
              task.projectId === project.id && day(task.dueAt?.slice(0, 10)),
          );
          return (
            '<div class="project-lane">' +
            projectButton(project) +
            '<div class="project-track"' +
            trackStyle +
            ">" +
            line +
            (outside
              ? '<button class="outside-project" data-time-jump="' +
                escapeAttr(project.startDate) +
                '">' +
                (after <= start ? "← " : "") +
                escapeHtml(project.startDate + " — " + project.targetDate) +
                (first >= end ? " →" : "") +
                "</button>"
              : '<button class="project-bar" data-open-project="' +
                escapeAttr(project.id) +
                '" style="left:' +
                pct(first) +
                "%;width:" +
                Math.max(0.5, pct(after) - pct(first)) +
                '%" aria-label="' +
                escapeAttr(
                  project.name +
                    " " +
                    project.startDate +
                    " から " +
                    project.targetDate,
                ) +
                '">' +
                escapeHtml(project.name) +
                (first < start ? " ←" : "") +
                (after > end ? " →" : "") +
                "</button>") +
            own
              .filter(
                (task) =>
                  day(task.dueAt.slice(0, 10)) >= start &&
                  day(task.dueAt.slice(0, 10)) < end,
              )
              .map(
                (task) =>
                  '<button class="ticket-marker" data-open-task="' +
                  escapeAttr(task.id) +
                  '" style="left:' +
                  pct(day(task.dueAt.slice(0, 10))) +
                  '%" aria-label="' +
                  escapeAttr(
                    formatTaskNumber(task.number) +
                      " " +
                      task.title +
                      " 期限 " +
                      task.dueAt.slice(0, 10),
                  ) +
                  '">' +
                  icon("deadline") +
                  "</button>",
              )
              .join("") +
            "</div></div>"
          );
        })
        .join("") +
      "</div></div>";
    const unassigned = tasks.filter((task) => !task.projectId);
    panel.innerHTML =
      (!enabled
        ? '<p class="contract-note">Projectの期間表示は準備中です。タスクの期日は未所属の一覧で確認できます。</p>'
        : projects.length
          ? '<div class="mobile-projects">' +
            scheduled.map((project) => projectButton(project, true)).join("") +
            '</div><button class="secondary mobile-timeline-toggle" data-toggle-timeline aria-expanded="' +
            !!ui.timelineExpanded +
            '">' +
            icon("roadmap") +
            (ui.timelineExpanded ? "Project一覧に戻る" : "タイムラインを表示") +
            '</button><div class="timeline-region" data-expanded="' +
            !!ui.timelineExpanded +
            '">' +
            timeline +
            "</div>"
          : '<div class="workspace-empty">Projectを作成すると計画期間を表示できます。<button class="secondary" data-new-project>' +
            icon("plus") +
            " New project</button></div>") +
      (enabled &&
      projects.some(
        (project) => !day(project.startDate) || !day(project.targetDate),
      )
        ? '<section class="project-unscheduled"><h2>Unscheduled</h2>' +
          projects
            .filter(
              (project) => !day(project.startDate) || !day(project.targetDate),
            )
            .map((project) => projectButton(project))
            .join("") +
          "</section>"
        : "") +
      '<section class="project-unassigned"><h2>Unassigned <span>' +
      unassigned.length +
      "</span></h2>" +
      taskLinks(unassigned) +
      "</section>";
  };
  window.renderProjects = function () {
    document.getElementById("projectsView").innerHTML =
      '<div class="projects-head">' +
      (document.body.dataset.projectOperations === "true"
        ? '<button class="primary" data-new-project>' +
          icon("plus") +
          " New project</button>"
        : "<p>Project機能は準備中です。</p>") +
      "</div>" +
      TaskBoardSelectors.projects()
        .map((project) => projectButton(project))
        .join("");
  };
  document.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-timeline]");
    if (toggle) {
      ui.timelineExpanded = !ui.timelineExpanded;
      window.renderRoadmap();
      document.querySelector("[data-toggle-timeline]")?.focus();
      return;
    }
    const step = event.target.closest("[data-time-step]"),
      jump = event.target.closest("[data-time-jump]");
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
      document.getElementById("roadmapZoom")?.focus();
    }
  });
})();
