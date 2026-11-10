"use strict";
// Read-only planning projections. All edits still use the shared Task drawer.
(function () {
  const ui = TaskBoardViewState,
    selectors = TaskBoardSelectors,
    icon = (name) => TaskBoardIcons.icon(name),
    panel = document.getElementById("roadmapView"),
    legacy = window.renderRoadmap,
    DAY = 86400000,
    today = () => localDateString(new Date()),
    expandedTasks = new Set(),
    collapsedGroups = new Set();
  const parse = (value) => {
    const key = typeof value === "string" ? value.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const date = new Date(key + "T00:00:00Z");
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === key
      ? date
      : null;
  };
  const key = (date) => date.toISOString().slice(0, 10),
    add = (date, days) => new Date(+date + days * DAY),
    monday = (date) => add(date, -((date.getUTCDay() + 6) % 7)),
    short = (date) => date.getUTCMonth() + 1 + "/" + date.getUTCDate(),
    attr = (value) => escapeAttr(String(value)),
    html = (value) => escapeHtml(String(value)),
    blocked = () =>
      operationBusy ||
      pendingOperation ||
      window.__atoBoardError ||
      window.__atoBoardReadOnly
        ? " disabled"
        : "";
  ui.planningAnchor ||= today();
  ui.calendarDate ||= today();
  const nav = document.createElement("div");
  nav.className = "planning-nav";
  nav.setAttribute("role", "group");
  nav.setAttribute("aria-label", "Roadmapの表示");
  const modes = [
    ["wbs", "gantt", "WBS・ガント"],
    ["calendar", "calendar", "カレンダー"],
    ["projects", "tickets", "概要"],
  ];
  modes.forEach(([mode, symbol, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.roadmapMode = mode;
    button.setAttribute("aria-label", "Roadmap：" + label);
    button.innerHTML =
      '<span class="nav-symbol">' +
      icon(symbol) +
      '</span><span class="nav-label">' +
      label +
      "</span>";
    nav.append(button);
  });
  document.getElementById("roadmapNav").after(nav);
  function updateNavigation() {
    const visible = ui.view === "roadmap" && ui.screen === "tasks";
    nav.hidden = !visible;
    for (const button of nav.querySelectorAll("button")) {
      button.hidden = !visible;
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.roadmapMode === ui.roadmapMode),
      );
      button.title = button.getAttribute("aria-label");
    }
  }
  function range() {
    const anchor = parse(ui.planningAnchor) || parse(today());
    const scale = ui.roadmapMode === "calendar" ? ui.calendarScale : ui.wbsZoom;
    const start =
      scale === "week"
        ? monday(anchor)
        : new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const end =
      scale === "week"
        ? add(start, 7)
        : new Date(
            Date.UTC(
              start.getUTCFullYear(),
              start.getUTCMonth() + (scale === "quarter" ? 3 : 1),
              1,
            ),
          );
    return { start, end, days: Math.round((end - start) / DAY), scale };
  }
  function toolbar() {
    const { start, end } = range(),
      calendar = ui.roadmapMode === "calendar";
    return (
      '<div class="planning-toolbar"><span class="planning-range" role="status">' +
      key(start) +
      " — " +
      key(add(end, -1)) +
      '</span><div class="planning-actions">' +
      '<button class="secondary" data-plan-step="-1" aria-label="前の期間">' +
      icon("left") +
      "</button>" +
      '<button class="secondary" data-plan-today>今日</button><button class="secondary" data-plan-step="1" aria-label="次の期間">' +
      icon("right") +
      "</button>" +
      '<label class="visually-hidden" for="planningScale">表示期間</label><select id="planningScale" aria-label="表示期間">' +
      (calendar ? ["month", "week"] : ["week", "month", "quarter"])
        .map(
          (value) =>
            '<option value="' +
            value +
            '"' +
            (value === (calendar ? ui.calendarScale : ui.wbsZoom)
              ? " selected"
              : "") +
            ">" +
            { week: "週", month: "月", quarter: "四半期" }[value] +
            "</option>",
        )
        .join("") +
      "</select></div></div>"
    );
  }
  function taskButton(task, compact = false) {
    const status =
      getColumns().find((c) => c.id === task.columnId)?.title || task.columnId;
    return (
      '<button type="button" class="planning-ticket' +
      (compact ? " compact" : "") +
      '" data-open-task="' +
      attr(task.id) +
      '"' +
      blocked() +
      '><span class="planning-ticket-title"><span class="ticket-number">' +
      html(formatTaskNumber(task.number)) +
      "</span> " +
      html(task.title) +
      '</span><span class="planning-ticket-meta">' +
      selectors.statusMark(task) +
      "<span>" +
      html(status) +
      "</span>" +
      selectors.priority(task) +
      selectors.subtasks(task) +
      "</span></button>"
    );
  }
  function deadline(task, start, end, days) {
    const date = parse(task.dueAt);
    if (!date) return '<span class="wbs-no-date">期日なし</span>';
    if (date < start || date >= end)
      return (
        '<button class="wbs-outside" data-plan-jump="' +
        key(date) +
        '" aria-label="' +
        attr(key(date) + "の期間へ移動") +
        '">' +
        (date < start ? "← " : "") +
        short(date) +
        (date >= end ? " →" : "") +
        "</button>"
      );
    return (
      '<button class="wbs-deadline" data-plan-task="' +
      attr(task.id) +
      '" style="left:' +
      (((date - start) / DAY + 0.5) / days) * 100 +
      '%" aria-label="' +
      attr(
        formatTaskNumber(task.number) + " 期限 " + key(date) + " " + task.title,
      ) +
      '"' +
      blocked() +
      ">" +
      icon("deadline") +
      "</button>"
    );
  }
  function wbs() {
    const { start, end, days, scale } = range(),
      tasks = selectors.tasks(),
      projects = selectors.projects(),
      known = new Set(projects.map((p) => p.id)),
      cell = scale === "week" ? 44 : scale === "quarter" ? 12 : 28;
    const groups = projects.map((p) => ({
      id: p.id,
      name: p.name,
      project: p,
      tasks: tasks.filter((t) => t.projectId === p.id),
    }));
    const unassigned = tasks.filter((t) => !t.projectId),
      unavailable = tasks.filter((t) => t.projectId && !known.has(t.projectId));
    if (unassigned.length || !groups.length)
      groups.push({ id: "unassigned", name: "Unassigned", tasks: unassigned });
    if (unavailable.length)
      groups.push({
        id: "unavailable",
        name: "Project未登録",
        tasks: unavailable,
      });
    const dates = Array.from({ length: days }, (_, index) => {
      const date = add(start, index),
        label =
          scale === "quarter"
            ? date.getUTCDate() === 1 || date.getUTCDay() === 1
              ? short(date)
              : ""
            : scale === "week"
              ? short(date)
              : date.getUTCDate();
      return (
        '<span class="wbs-day' +
        ([0, 6].includes(date.getUTCDay()) ? " weekend" : "") +
        '" title="' +
        key(date) +
        '">' +
        label +
        "</span>"
      );
    }).join("");
    const now = parse(today()),
      todayLine =
        now >= start && now < end
          ? '<span class="wbs-today" style="left:' +
            (((now - start) / DAY + 0.5) / days) * 100 +
            '%" aria-hidden="true"></span>'
          : "";
    let rows =
      '<div class="wbs-row wbs-head"><span class="wbs-label">WBS / Ticket</span><div class="wbs-days">' +
      dates +
      "</div></div>";
    groups.forEach((group, groupIndex) => {
      const folded = collapsedGroups.has(group.id),
        complete = group.tasks.filter((t) => t.completed).length,
        project = group.project,
        first = parse(project?.startDate),
        last = parse(project?.targetDate);
      let period =
        '<span class="wbs-no-date">' +
        (project ? "期間未設定" : "チケットの期日を表示") +
        "</span>";
      if (first && last && first <= last) {
        const after = add(last, 1);
        period =
          after <= start || first >= end
            ? '<button class="wbs-outside" data-plan-jump="' +
              key(first) +
              '">期間外 ' +
              short(first) +
              " — " +
              short(last) +
              "</button>"
            : '<button class="wbs-project-bar" data-open-project="' +
              attr(project.id) +
              '" style="left:' +
              Math.max(0, ((first - start) / DAY / days) * 100) +
              "%;width:" +
              Math.max(
                0.3,
                ((Math.min(+after, +end) - Math.max(+first, +start)) /
                  DAY /
                  days) *
                  100,
              ) +
              '%" aria-label="' +
              attr(project.name + " " + key(first) + " — " + key(last)) +
              '">' +
              html(project.name) +
              "</button>";
      }
      rows +=
        '<div class="wbs-row wbs-group"><div class="wbs-label"><button class="wbs-toggle" data-plan-group="' +
        attr(group.id) +
        '" aria-expanded="' +
        !folded +
        '" aria-label="' +
        attr(group.name + "の階層を切り替え") +
        '">' +
        icon(folded ? "right" : "low") +
        "</button><span><strong>" +
        html(group.name) +
        "</strong><small>" +
        complete +
        "/" +
        group.tasks.length +
        ' 完了</small></span></div><div class="wbs-track">' +
        todayLine +
        period +
        "</div></div>";
      if (folded) return;
      group.tasks.forEach((task, taskIndex) => {
        const subs = [...task.subtasks].sort((a, b) => a.order - b.order),
          expanded = expandedTasks.has(task.id),
          code = groupIndex + 1 + "." + (taskIndex + 1);
        rows +=
          '<div class="wbs-row" data-wbs-task="' +
          attr(task.id) +
          '"><div class="wbs-label">' +
          (subs.length
            ? '<button class="wbs-toggle" data-plan-fold="' +
              attr(task.id) +
              '" aria-expanded="' +
              expanded +
              '" aria-label="' +
              attr(formatTaskNumber(task.number) + "のサブタスクを切り替え") +
              '">' +
              icon(expanded ? "low" : "right") +
              "</button>"
            : '<span class="wbs-toggle-spacer"></span>') +
          '<div class="wbs-task"><span class="wbs-code">' +
          code +
          "</span>" +
          taskButton(task, true) +
          '</div></div><div class="wbs-track">' +
          todayLine +
          deadline(task, start, end, days) +
          "</div></div>";
        if (expanded)
          subs.forEach((sub, subIndex) => {
            rows +=
              '<div class="wbs-row wbs-subtask"><div class="wbs-label"><span class="wbs-child-icon">' +
              icon(sub.completed ? "done" : "todo") +
              '</span><button class="wbs-subtask-title" data-plan-task="' +
              attr(task.id) +
              '"' +
              blocked() +
              '><span class="wbs-code">' +
              code +
              "." +
              (subIndex + 1) +
              "</span> " +
              html(sub.title) +
              '</button></div><div class="wbs-track">' +
              todayLine +
              '<span class="wbs-no-date">日時なし</span></div></div>';
          });
      });
    });
    return (
      '<p class="planning-hint">' +
      icon("deadline") +
      '<span>Projectは期間、チケットは期日、サブタスクは進捗を表示します。横にスクロールして日付を確認できます。</span></p><div class="wbs-scroll" tabindex="0" role="region" aria-label="WBS・ガント。日付は横にスクロールできます"><div class="wbs-grid" style="--planning-days:' +
      days +
      ";--day-width:" +
      cell +
      "px;--time-width:" +
      days * cell +
      'px">' +
      rows +
      "</div></div>" +
      (!tasks.length
        ? '<p class="workspace-empty">表示するチケットはありません。検索やフィルターを確認してください。</p>'
        : "")
    );
  }
  function calendar() {
    const { start, end, scale } = range(),
      tasks = selectors.tasks(),
      byDate = new Map(),
      unscheduled = [];
    tasks.forEach((task) => {
      const date = parse(task.dueAt);
      if (!date) unscheduled.push(task);
      else {
        const k = key(date);
        if (!byDate.has(k)) byDate.set(k, []);
        byDate.get(k).push(task);
      }
    });
    const selected = ui.calendarDate,
      dateButton = (date, items) =>
        '<button class="calendar-date" data-plan-date="' +
        key(date) +
        '" aria-pressed="' +
        (key(date) === selected) +
        '"' +
        (key(date) === today() ? ' aria-current="date"' : "") +
        ' aria-label="' +
        attr(key(date) + "、" + items.length + "件") +
        '"><time datetime="' +
        key(date) +
        '">' +
        date.getUTCDate() +
        "</time>" +
        (items.length
          ? '<span class="calendar-count">' + items.length + "</span>"
          : "") +
        "</button>";
    let grid = "";
    if (scale === "month") {
      const first = monday(start);
      grid =
        '<div class="calendar-grid-wrap"><table class="calendar-grid"><caption class="visually-hidden">' +
        html(key(start).slice(0, 7)) +
        "の期日カレンダー</caption><thead><tr>" +
        ["月", "火", "水", "木", "金", "土", "日"]
          .map((d) => '<th scope="col">' + d + "</th>")
          .join("") +
        "</tr></thead><tbody>";
      for (let week = 0; week < 6; week++) {
        grid += "<tr>";
        for (let day = 0; day < 7; day++) {
          const date = add(first, week * 7 + day),
            k = key(date),
            items = byDate.get(k) || [];
          grid +=
            '<td class="' +
            (date.getUTCMonth() !== start.getUTCMonth() ? "adjacent " : "") +
            (k === selected ? "selected-day" : "") +
            '">' +
            dateButton(date, items) +
            '<div class="calendar-cell-tickets">' +
            items
              .slice(0, 2)
              .map((t) => taskButton(t, true))
              .join("") +
            (items.length > 2
              ? '<button class="calendar-more" data-plan-date="' +
                k +
                '">ほか' +
                (items.length - 2) +
                "件</button>"
              : "") +
            "</div></td>";
        }
        grid += "</tr>";
      }
      grid += "</tbody></table></div>";
    } else {
      grid =
        '<div class="calendar-week-list">' +
        Array.from({ length: 7 }, (_, index) => {
          const date = add(start, index),
            items = byDate.get(key(date)) || [];
          return (
            '<section class="calendar-week-day"><h3>' +
            dateButton(date, items) +
            "<span>" +
            ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()] +
            "曜</span></h3>" +
            items.map((t) => taskButton(t)).join("") +
            (!items.length
              ? '<p class="planning-empty">この日のチケットはありません</p>'
              : "") +
            "</section>"
          );
        }).join("") +
        "</div>";
    }
    const agenda = byDate.get(selected) || [];
    return (
      '<p class="planning-hint">' +
      icon("calendar") +
      "<span>チケットの期日を表示します。日付を選ぶと、その日の一覧を確認できます。</span></p>" +
      grid +
      '<section class="calendar-agenda" aria-label="選択日のチケット"><h2>' +
      html(selected) +
      ' <span class="section-count">' +
      agenda.length +
      "件</span></h2>" +
      (agenda.length
        ? agenda.map((t) => taskButton(t)).join("")
        : '<p class="planning-empty">この日に期日のあるチケットはありません。</p>') +
      "</section>" +
      '<details class="calendar-unscheduled"><summary>期日なし <span class="section-count">' +
      unscheduled.length +
      "件</span></summary>" +
      unscheduled.map((t) => taskButton(t)).join("") +
      "</details>"
    );
  }
  window.renderRoadmap = function () {
    updateNavigation();
    if (ui.roadmapMode === "projects") return legacy();
    panel.innerHTML =
      '<div class="planning-view" data-planning-mode="' +
      attr(ui.roadmapMode) +
      '">' +
      toolbar() +
      (ui.roadmapMode === "calendar" ? calendar() : wbs()) +
      "</div>";
  };
  function refresh(focusSelector) {
    const scroll = panel.querySelector(".wbs-scroll"),
      position = scroll && [scroll.scrollLeft, scroll.scrollTop];
    window.renderRoadmap();
    const next = panel.querySelector(".wbs-scroll");
    if (next && position) {
      next.scrollLeft = position[0];
      next.scrollTop = position[1];
    }
    if (focusSelector)
      panel.querySelector(focusSelector)?.focus({ preventScroll: true });
  }
  document.addEventListener("click", (event) => {
    const mode = event.target.closest("[data-roadmap-mode]");
    if (mode) {
      window.TaskBoardResponsive?.closeNavigation(false);
      ui.roadmapMode = mode.dataset.roadmapMode;
      refresh();
      return;
    }
    const button = event.target.closest("#roadmapView button");
    if (!button) return;
    if (button.hasAttribute("data-plan-fold")) {
      const id = button.dataset.planFold;
      expandedTasks.has(id) ? expandedTasks.delete(id) : expandedTasks.add(id);
      refresh('[data-plan-fold="' + CSS.escape(id) + '"]');
    } else if (button.hasAttribute("data-plan-group")) {
      const id = button.dataset.planGroup;
      collapsedGroups.has(id)
        ? collapsedGroups.delete(id)
        : collapsedGroups.add(id);
      refresh('[data-plan-group="' + CSS.escape(id) + '"]');
    } else if (button.hasAttribute("data-plan-task"))
      openTaskModal(button.dataset.planTask);
    else if (button.hasAttribute("data-plan-date")) {
      ui.calendarDate = button.dataset.planDate;
      refresh('[data-plan-date="' + ui.calendarDate + '"]');
    } else if (
      button.hasAttribute("data-plan-jump") ||
      button.hasAttribute("data-plan-today")
    ) {
      ui.planningAnchor = button.dataset.planJump || today();
      ui.calendarDate = ui.planningAnchor;
      refresh(
        button.hasAttribute("data-plan-today")
          ? "[data-plan-today]"
          : "#planningScale",
      );
      if (button.hasAttribute("data-plan-today")) {
        const scroll = panel.querySelector(".wbs-scroll"),
          line = panel.querySelector(".wbs-today"),
          label = panel.querySelector(".wbs-label");
        if (scroll && line && label)
          scroll.scrollLeft = Math.max(
            0,
            line.offsetLeft - (scroll.clientWidth - label.offsetWidth) / 2,
          );
      }
    } else if (button.hasAttribute("data-plan-step")) {
      const { start, scale } = range(),
        step = Number(button.dataset.planStep);
      ui.planningAnchor = key(
        scale === "week"
          ? add(start, step * 7)
          : new Date(
              Date.UTC(
                start.getUTCFullYear(),
                start.getUTCMonth() + step * (scale === "quarter" ? 3 : 1),
                1,
              ),
            ),
      );
      ui.calendarDate = ui.planningAnchor;
      refresh('[data-plan-step="' + step + '"]');
    }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id !== "planningScale") return;
    if (ui.roadmapMode === "calendar") ui.calendarScale = event.target.value;
    else ui.wbsZoom = event.target.value;
    refresh("#planningScale");
  });
  panel.addEventListener("keydown", (event) => {
    const button = event.target.closest("[data-plan-date]");
    if (
      !button ||
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const current = parse(button.dataset.planDate),
      offset = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -7,
        ArrowDown: 7,
        Home: -((current.getUTCDay() + 6) % 7),
        End: 6 - ((current.getUTCDay() + 6) % 7),
      }[event.key],
      next = add(current, offset);
    ui.calendarDate = key(next);
    ui.planningAnchor = key(next);
    refresh('[data-plan-date="' + key(next) + '"]');
  });
  window.TaskBoardPlanning = Object.freeze({ updateNavigation });
  updateNavigation();
  if (ui.view === "roadmap" && ui.screen === "tasks" && !window.__atoBoardError)
    refresh();
})();
