/**
 * A calendar built from a projection, not from someone else's document.
 *
 * This App owns nothing and reads no board. The Port is operation-only and
 * lists exactly one observation, `todo_list_due_dates`; the owner's grant lists
 * the same one. The handler runs against the Resource document on the trusted
 * side and returns only `task_id`, `title`, `due_at` and `completed`, so the
 * calendar never receives a task description, subtasks, columns or anything
 * else the board may hold.
 *
 * Failure is never rendered as an empty month: not connected, revoked and
 * unsupported all stop visibly. The projection is a set of due dates, so an
 * unknown field is ignored rather than treated as a document schema.
 */
(function () {
  "use strict";

  var PORT = "tasks";
  var OPERATION = "todo_list_due_dates";

  var where = document.getElementById("where");
  var problem = document.getElementById("problem");
  var days = document.getElementById("days");
  var empty = document.getElementById("empty");
  var undated = document.getElementById("undated");
  var unsupported = document.getElementById("unsupported");

  function say(message) {
    where.textContent = message;
  }
  function complain(error) {
    problem.hidden = false;
    problem.textContent = describe(error);
  }
  function describe(error) {
    var code = (error && error.code) || "";
    if (code === "data_port_not_connected")
      return "This app is not connected to any data yet. Connect it to the same data Todo uses, then reload.";
    if (code === "data_access_revoked" || code === "data_actor_changed")
      return "Access to this data changed. Reload to continue.";
    if (code === "operation_not_granted")
      return "The data owner has not allowed this app to read due dates. Ask them to grant todo_list_due_dates.";
    return "Could not read the shared due dates. Try again.";
  }

  /** ISO date only, used as the day itself; no time or zone is invented. */
  function dayOf(task) {
    var due = task && task.due_at;
    return typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due)
      ? due
      : null;
  }

  function dayLabel(day) {
    var parsed = new Date(day + "T12:00:00Z");
    if (Number.isNaN(parsed.getTime())) return day;
    return parsed.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }

  function render(tasks) {
    var byDay = new Map();
    var withoutDue = 0;
    tasks.forEach(function (task) {
      var day = dayOf(task);
      if (!day) {
        withoutDue++;
        return;
      }
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(task);
    });

    days.textContent = "";
    var ordered = [...byDay.keys()].sort();
    empty.hidden = ordered.length > 0;
    ordered.forEach(function (day) {
      var block = document.createElement("li");
      block.className = "day";
      var label = document.createElement("p");
      label.className = "day-label";
      label.textContent = dayLabel(day);
      var entries = document.createElement("ul");
      entries.className = "entries";
      byDay
        .get(day)
        .sort(function (a, b) {
          return String(a.title).localeCompare(String(b.title));
        })
        .forEach(function (task) {
          var row = document.createElement("li");
          row.className = "entry" + (task.completed ? " entry--done" : "");
          row.dataset.taskId = String(task.task_id);
          var title = document.createElement("span");
          title.textContent = task.title || "(untitled)";
          row.append(title);
          entries.append(row);
        });
      block.append(label, entries);
      days.append(block);
    });

    undated.hidden = withoutDue === 0;
    undated.textContent =
      withoutDue === 1
        ? "1 task has no due date, so it is not on the calendar."
        : withoutDue + " tasks have no due date, so they are not on the calendar.";
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

  async function load() {
    if (!window.atoDataPorts || !window.atoDataPorts.invoke) {
      say("This app needs to run on an ato runtime to reach your data.");
      return;
    }
    say("Reading the shared due dates. This app keeps no copy of the board.");
    try {
      var result = await window.atoDataPorts.invoke(
        PORT,
        OPERATION,
        {},
        crypto.randomUUID(),
      );
      var tasks = projectionOf(result);
      if (!tasks) {
        unsupported.hidden = false;
        days.textContent = "";
        empty.hidden = true;
        undated.hidden = true;
        return;
      }
      unsupported.hidden = true;
      problem.hidden = true;
      render(tasks);
    } catch (error) {
      days.textContent = "";
      empty.hidden = true;
      undated.hidden = true;
      say("Your data is not available.");
      complain(error);
    }
  }

  /** Access is gone: stop showing the projection with it. */
  window.addEventListener("ato:data-reset", function (event) {
    var reason = event && event.detail && event.detail.reason;
    days.textContent = "";
    empty.hidden = true;
    undated.hidden = true;
    unsupported.hidden = true;
    say(
      reason === "data_actor_changed"
        ? "You are signed in as someone else now. Reload to continue."
        : "Access to this data changed. Reload to continue.",
    );
  });

  load();
})();
