/**
 * A calendar built from a projection, not from someone else's document.
 *
 * This App owns nothing and reads no board of its own. The Port is
 * operation-only and lists exactly one observation, `todo_list_due_dates`; the
 * owner's grant lists the same one. The projection carries only `task_id`,
 * `title`, `due_at` and `completed`, never descriptions or the rest of the
 * board.
 *
 * Rendering, date math and view navigation are FullCalendar 7.1.4 (MIT),
 * vendored in `vendor/fullcalendar` so the static Capsule makes no network
 * request. Ato only adapts the projection into events and keeps the calendar in
 * sync with the operation result. Narrow panes show one dot per due date;
 * wider panes show the task titles.
 *
 * Which board it reads is chosen by the person, in the header, and only then is
 * this Port bound (calendar-switcher.js). Nothing here reads or renders an
 * empty month in place of a failure: not connected shows the chooser prompt,
 * revoked and unsupported stop visibly.
 */
(function () {
  "use strict";

  var PORT = "tasks";
  var OPERATION = "todo_list_due_dates";
  var COMPACT_MAX_WIDTH = 520;
  var REFRESH_MS = 4000;

  var problem = document.getElementById("problem");
  var empty = document.getElementById("empty");
  var calendarEl = document.getElementById("calendar");

  var calendar = null;
  var compact = null;
  var refreshTimer = null;
  var hasDueDates = false;
  // Reads start only after the switcher binds this Port to a board the person
  // chose; before that the calendar shows its chooser, not a failed read.
  var connected = false;

  function problemMessage(error) {
    var core = window.AtoCalendarCore;
    return core
      ? core.problemText(error)
      : "共有された期限を読み取れませんでした。もう一度お試しください。";
  }

  function complain(error) {
    problem.hidden = false;
    problem.textContent = problemMessage(error);
  }

  function projectionOf(result) {
    var tasks =
      result && result.result && Array.isArray(result.result.tasks)
        ? result.result.tasks
        : null;
    if (!tasks) return null;
    return tasks.filter(function (task) {
      return task && typeof task === "object" && "task_id" in task;
    });
  }

  function toEvent(task) {
    return {
      id: String(task.task_id),
      title: String(task.title || "(タイトルなし)"),
      start: task.due_at,
      allDay: true,
      extendedProps: { completed: task.completed === true },
    };
  }

  function fetchEvents(_info, success, failure) {
    if (!connected) {
      success([]);
      return;
    }
    if (!window.atoDataPorts || !window.atoDataPorts.invoke) {
      failure({ code: "no_runtime" });
      return;
    }
    window.atoDataPorts
      .invoke(PORT, OPERATION, {}, crypto.randomUUID())
      .then(function (result) {
        var tasks = projectionOf(result);
        if (!tasks) {
          hasDueDates = false;
          empty.hidden = true;
          failure({ code: "unsupported_projection" });
          return;
        }
        problem.hidden = true;
        var events = tasks
          .filter(function (task) {
            return (
              typeof task.due_at === "string" &&
              /^\d{4}-\d{2}-\d{2}$/.test(task.due_at)
            );
          })
          .map(toEvent);
        hasDueDates = events.length > 0;
        empty.hidden = hasDueDates;
        success(events);
      })
      .catch(function (error) {
        hasDueDates = false;
        empty.hidden = true;
        if (calendar) calendar.removeAllEvents();
        complain(error);
        failure(error);
      });
  }

  function eventContent(arg) {
    var wrapper = document.createElement("div");
    wrapper.className = "ato-event";
    if (arg.event.extendedProps.completed) wrapper.classList.add("is-done");
    wrapper.title = arg.event.title;

    var dot = document.createElement("span");
    dot.className = "ato-dot";
    var title = document.createElement("span");
    title.className = "ato-title";
    title.textContent = arg.event.title;

    wrapper.append(dot, title);
    return { domNodes: [wrapper] };
  }

  function buildCalendar() {
    compact = calendarEl.clientWidth < COMPACT_MAX_WIDTH;
    calendarEl.classList.toggle("compact", compact);

    calendar = new AtoFullCalendar.Calendar(calendarEl, {
      initialView: "dayGridMonth",
      height: "100%",
      editable: false,
      selectable: false,
      dayMaxEvents: compact ? 3 : false,
      eventDisplay: "block",
      eventBackgroundColor: "transparent",
      eventBorderColor: "transparent",
      eventClassNames: ["ato-event-wrap"],
      eventContent: eventContent,
      locale: "ja",
      plugins: [
        AtoFullCalendar.daygrid,
        AtoFullCalendar.list,
        AtoFullCalendar.pulseTheme,
      ],
      locales: [AtoFullCalendar.jaLocale],
      headerToolbar: compact
        ? { left: "prev,next", center: "title", right: "" }
        : {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,listMonth",
          },
      events: fetchEvents,
      eventSourceFailure: function (error) {
        complain(error);
      },
    });
    calendar.render();
  }

  function rebuildForWidth() {
    var nextCompact = calendarEl.clientWidth < COMPACT_MAX_WIDTH;
    if (nextCompact === compact) return;
    calendar.destroy();
    buildCalendar();
  }

  /** Bound: read the projection the switcher attached to this Port. */
  function loadView() {
    connected = true;
    problem.hidden = true;
    empty.hidden = true;
    if (calendar) calendar.refetchEvents();
  }

  /** Unbound or access gone: stop showing the previous projection with it. */
  function clearView() {
    connected = false;
    problem.hidden = true;
    empty.hidden = true;
    hasDueDates = false;
    if (calendar) calendar.removeAllEvents();
  }

  // The switcher owns the connection state; it calls these when the Port is
  // bound, unbound, or reset underneath a running calendar.
  window.AtoCalendarView = {
    load: loadView,
    clear: clearView,
  };

  function start() {
    if (!window.AtoFullCalendar) {
      problem.hidden = false;
      problem.textContent = "このアプリのカレンダー表示を読み込めませんでした。";
      return;
    }
    buildCalendar();
    if (typeof ResizeObserver === "function")
      new ResizeObserver(rebuildForWidth).observe(calendarEl);
    refreshTimer = setInterval(function () {
      if (calendar) calendar.refetchEvents();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && calendar) calendar.refetchEvents();
    });
  }

  // The switcher re-reads the platform after a reset and offers the chooser;
  // clearing first makes sure the projection stops showing immediately.
  window.addEventListener("ato:data-reset", clearView);

  start();
})();
