/**
 * A calendar built from a projection, not from someone else's document.
 *
 * This App owns nothing and reads no board. The Port is operation-only and
 * lists exactly one observation, `todo_list_due_dates`; the owner's grant lists
 * the same one. The projection carries only `task_id`, `title`, `due_at` and
 * `completed`, never descriptions or the rest of the board.
 *
 * Rendering, date math and view navigation are FullCalendar 7.1.4 (MIT),
 * vendored in `vendor/fullcalendar` so the static Capsule makes no network
 * request. Ato only adapts the projection into events and keeps the calendar in
 * sync with the operation result. Narrow panes show one dot per due date;
 * wider panes show the task titles.
 *
 * Failure is never rendered as an empty month: not connected, revoked and
 * unsupported all stop visibly.
 */
(function () {
  "use strict";

  var PORT = "tasks";
  var OPERATION = "todo_list_due_dates";
  var COMPACT_MAX_WIDTH = 520;
  var REFRESH_MS = 4000;

  var where = document.getElementById("where");
  var problem = document.getElementById("problem");
  var empty = document.getElementById("empty");
  var calendarEl = document.getElementById("calendar");

  var calendar = null;
  var compact = null;
  var refreshTimer = null;
  var hasDueDates = false;

  function say(message) {
    where.textContent = message;
  }

  function describe(error) {
    var code = (error && error.code) || "";
    if (code === "data_port_not_connected")
      return "This app is not connected to any data yet. Connect it to the same data Todo uses, then reload.";
    if (code === "data_access_revoked" || code === "data_actor_changed")
      return "Access to this data changed. Reload to continue.";
    if (code === "operation_not_granted")
      return "The data owner has not allowed this app to read due dates. Ask them to grant todo_list_due_dates.";
    if (code === "unsupported_projection")
      return "This data is not in a format this app understands, so there is nothing to show. It is still stored, unchanged.";
    return "Could not read the shared due dates. Try again.";
  }

  function complain(error) {
    problem.hidden = false;
    problem.textContent = describe(error);
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
      title: String(task.title || "(untitled)"),
      start: task.due_at,
      allDay: true,
      extendedProps: { completed: task.completed === true },
    };
  }

  function fetchEvents(_info, success, failure) {
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
        say(
          "Reading the shared due dates. This app keeps no copy of the board.",
        );
        success(events);
      })
      .catch(function (error) {
        hasDueDates = false;
        empty.hidden = true;
        if (calendar) calendar.removeAllEvents();
        say("Your data is not available.");
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

  function start() {
    if (!window.AtoFullCalendar) {
      say("This app needs its vendored calendar bundle.");
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

  /** Access is gone: stop showing the projection with it. */
  window.addEventListener("ato:data-reset", function (event) {
    var reason = event && event.detail && event.detail.reason;
    problem.hidden = true;
    empty.hidden = true;
    hasDueDates = false;
    if (calendar) calendar.removeAllEvents();
    say(
      reason === "data_actor_changed"
        ? "You are signed in as someone else now. Reload to continue."
        : "Access to this data changed. Reload to continue.",
    );
  });

  start();
})();
