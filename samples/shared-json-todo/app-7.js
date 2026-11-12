"use strict";

(function installWeeklyRecurrenceFeature() {
  const WEEKDAY_LABELS = {
    1: "月",
    2: "火",
    3: "水",
    4: "木",
    5: "金",
    6: "土",
    7: "日",
  };

  function normalizeSubtasksLocal(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item, index) => {
      const raw = typeof item === "string" ? { title: item } : item || {};
      return {
        id: String(raw.id || uid("sub")),
        title: String(raw.title || ""),
        completed: !!raw.completed,
        order: Number.isFinite(raw.order)
          ? raw.order
          : (index + 1) * ORDER_STEP,
      };
    });
  }

  function normalizeRecurrenceMap(input) {
    const source =
      input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const out = {};
    for (const [key, raw] of Object.entries(source)) {
      if (!raw || typeof raw !== "object") continue;
      const id = String(raw.id || key);
      const weekday = Number(raw.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) continue;
      out[id] = {
        id,
        frequency: "weekly",
        weekday,
        enabled: raw.enabled !== false,
        title: String(raw.title || "Untitled"),
        description: String(raw.description || ""),
        priority: ["none", "low", "medium", "high"].includes(raw.priority)
          ? raw.priority
          : "none",
        columnId: ["todo", "pending", "progress"].includes(raw.columnId)
          ? raw.columnId
          : "todo",
        subtasks: normalizeSubtasksLocal(raw.subtasks),
        createdAt: raw.createdAt || nowISO(),
        updatedAt: raw.updatedAt || nowISO(),
      };
    }
    return out;
  }

  function normalizeOccurrenceIndex(input) {
    const source =
      input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const out = {};
    for (const [key, value] of Object.entries(source))
      out[String(key)] = String(value || "");
    return out;
  }

  function isoWeekday(date) {
    const day = date.getDay();
    return day === 0 ? 7 : day;
  }

  function nextOccurrenceDate(weekday, from = new Date()) {
    const start = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      12,
      0,
      0,
      0,
    );
    let delta = (Number(weekday) - isoWeekday(start) + 7) % 7;
    if (delta === 0) delta = 7;
    start.setDate(start.getDate() + delta);
    return localDateString(start);
  }

  const rawAtInstall = rawBoardDocument();

  state.schemaVersion = Math.max(Number(state.schemaVersion) || 1, 2);
  state.recurrences = normalizeRecurrenceMap(
    rawAtInstall?.recurrences ?? state.recurrences,
  );
  state.recurrenceOccurrences = normalizeOccurrenceIndex(
    rawAtInstall?.recurrenceOccurrences,
  );
  for (const [id, task] of Object.entries(state.tasks)) {
    const rawTask = rawAtInstall?.tasks?.[id];
    task.recurrenceId =
      typeof rawTask?.recurrenceId === "string" ? rawTask.recurrenceId : null;
    task.occurrenceDate =
      typeof rawTask?.occurrenceDate === "string"
        ? rawTask.occurrenceDate
        : null;
  }

  const baseFreshState = freshState;
  freshState = function () {
    const next = baseFreshState();
    next.schemaVersion = 3;
    next.recurrences = {};
    next.recurrenceOccurrences = {};
    return next;
  };

  const baseNormalizeState = normalizeState;
  normalizeState = function (input) {
    const normalized = baseNormalizeState(input);
    normalized.schemaVersion = Math.max(
      Number(normalized.schemaVersion) || 1,
      2,
    );
    normalized.recurrences = normalizeRecurrenceMap(input?.recurrences);
    normalized.recurrenceOccurrences = normalizeOccurrenceIndex(
      input?.recurrenceOccurrences,
    );
    const rawTasks =
      input?.tasks && typeof input.tasks === "object" ? input.tasks : {};
    for (const [id, task] of Object.entries(normalized.tasks)) {
      task.recurrenceId =
        typeof rawTasks?.[id]?.recurrenceId === "string"
          ? rawTasks[id].recurrenceId
          : null;
      task.occurrenceDate =
        typeof rawTasks?.[id]?.occurrenceDate === "string"
          ? rawTasks[id].occurrenceDate
          : null;
    }
    return normalized;
  };

  const recurrencePanel = document.createElement("div");
  recurrencePanel.className = "recurrence-panel";
  recurrencePanel.style.display = "none";
  recurrencePanel.innerHTML =
    '<div class="section-title"><h3>繰り返し</h3></div>' +
    '<div class="recurrence-grid">' +
    '<label class="check-row"><input id="recurrenceEnabledInput" type="checkbox"> 次回以降も有効</label>' +
    '<div class="field"><label for="recurrenceWeekdaySelect">曜日</label>' +
    '<select id="recurrenceWeekdaySelect" class="control">' +
    '<option value="1">月曜日</option><option value="2">火曜日</option><option value="3">水曜日</option>' +
    '<option value="4">木曜日</option><option value="5">金曜日</option><option value="6">土曜日</option><option value="7">日曜日</option>' +
    "</select></div>" +
    '<div class="recurrence-next" id="recurrenceNextLabel"></div>' +
    "</div>";
  document.querySelector(".modal-body")?.appendChild(recurrencePanel);

  const recurrenceEnabledInput = recurrencePanel.querySelector(
    "#recurrenceEnabledInput",
  );
  const recurrenceWeekdaySelect = recurrencePanel.querySelector(
    "#recurrenceWeekdaySelect",
  );
  const recurrenceNextLabel = recurrencePanel.querySelector(
    "#recurrenceNextLabel",
  );

  const style = document.createElement("style");
  style.textContent = [
    ".recurrence-panel{margin-top:18px;padding-top:4px;border-top:1px solid var(--line)}",
    ".recurrence-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,220px);gap:12px;align-items:end}",
    ".recurrence-next{grid-column:1/-1;color:var(--muted);font-size:12px;font-weight:650}",
    ".recurrence-tag{background:color-mix(in srgb,var(--panel-2) 70%,transparent)}",
    "@media(max-width:640px){.recurrence-grid{grid-template-columns:1fr}}",
  ].join("");
  document.head.appendChild(style);

  const baseRenderTaskCard = renderTaskCard;
  renderTaskCard = function (task) {
    const card = baseRenderTaskCard(task);
    if (task.recurrenceId && task.occurrenceDate) {
      const recurrence = state.recurrences?.[task.recurrenceId];
      const meta = card.querySelector(".task-meta");
      if (meta) {
        const tag = document.createElement("span");
        tag.className = "tag recurrence-tag";
        tag.textContent = recurrence
          ? "Weekly · " + WEEKDAY_LABELS[recurrence.weekday]
          : "Weekly";
        meta.appendChild(tag);
      }
    }
    return card;
  };

  const baseOpenTaskModal = openTaskModal;
  openTaskModal = function (taskId = null, columnId = "todo") {
    baseOpenTaskModal(taskId, columnId);
    const task = taskId ? state.tasks[taskId] : null;
    const recurrence = task?.recurrenceId
      ? state.recurrences?.[task.recurrenceId]
      : null;
    if (!recurrence) {
      recurrencePanel.style.display = "none";
      return;
    }
    recurrencePanel.style.display = "";
    recurrenceEnabledInput.checked = recurrence.enabled !== false;
    recurrenceWeekdaySelect.value = String(recurrence.weekday);
    recurrenceNextLabel.textContent =
      "発生日: " +
      (task.occurrenceDate || "—") +
      " · 次回: " +
      nextOccurrenceDate(recurrence.weekday);
  };

  recurrenceWeekdaySelect.addEventListener("change", () => {
    recurrenceNextLabel.textContent =
      "次回: " + nextOccurrenceDate(Number(recurrenceWeekdaySelect.value));
  });

  const materialize = () =>
    runOperation("todo_initialize", {
      at: new Date().toISOString(),
      date: localDateString(new Date()),
    });
  let lastCheckedDate = localDateString(new Date());
  setInterval(() => {
    const date = localDateString(new Date());
    if (date !== lastCheckedDate)
      materialize().then((result) => {
        if (result) lastCheckedDate = date;
      });
  }, 60000);
  window.AtoRecurrence = Object.freeze({
    materializeToday: materialize,
    list: () =>
      Object.values(state.recurrences || {}).map((item) =>
        structuredCloneSafe(item),
      ),
  });
  render();
})();
