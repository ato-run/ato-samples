/**
 * A calendar built by reading someone else's JSON, not by defining a type.
 *
 * This App owns nothing. It opens the same port Todo does, reads the one
 * Resource the person connected, and arranges what is already there by due
 * date. There is no calendar copy to drift: delete a task in Todo and it is
 * simply not here.
 *
 * Everything below about the shape — `tasks` keyed by id, `dueAt` as
 * `YYYY-MM-DD` or null, `completed` independent of `columnId` — was learned
 * from the description the owner saved beside the data (and from Todo's
 * source). ato.run did not standardise any of it, and does not enforce any of
 * it. That is the point: a second App becomes possible because the shape is
 * written down, not because the platform imposed one.
 *
 * Consequently this App must be honest when it meets a document it was not
 * written for. Same JSON protocol never means same meaning, so an unrecognised
 * document is reported as unsupported rather than rendered as an empty month.
 *
 * The port is declared `access = "read"` and the runtime enforces it — a write
 * from here is refused server-side, not by this App's restraint. That boundary
 * is worth proving, but not by having a read-only App attempt a write on every
 * single launch: the check lives in the E2E, which asks once, deliberately,
 * from a known-good session.
 */
(function () {
  "use strict";

  var PORT = "todo";

  var where = document.getElementById("where");
  var problem = document.getElementById("problem");
  var days = document.getElementById("days");
  var empty = document.getElementById("empty");
  var undated = document.getElementById("undated");
  var unsupported = document.getElementById("unsupported");
  var describeBox = document.getElementById("description");

  var port = null;

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
    return "Could not read the data. Try again.";
  }

  /**
   * Does this document look like the board this App was written against?
   *
   * A deliberately shallow check: `tasks` is an object whose values look like
   * tasks. Unknown extra fields are expected and ignored — they belong to
   * whoever wrote them, and this App has no business objecting to them.
   */
  function isKnownBoard(value) {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !value.tasks ||
      typeof value.tasks !== "object" ||
      Array.isArray(value.tasks)
    )
      return false;
    var ids = Object.keys(value.tasks);
    if (!ids.length) return true;
    return ids.every(function (id) {
      var task = value.tasks[id];
      return task && typeof task === "object" && "title" in task;
    });
  }

  /**
   * The day a task belongs on.
   *
   * `dueAt` is a plain calendar date, so it is used as the day directly. No
   * time and no timezone is invented for it: turning "2026-09-20" into an
   * instant is exactly how a date slips to the 19th or the 21st for somebody.
   */
  function dayOf(task) {
    var due = task.dueAt;
    return typeof due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(due)
      ? due
      : null;
  }

  /** Parsed at noon UTC and formatted in UTC, so no zone can shift the date. */
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

  function render(document_) {
    var byDay = new Map();
    var withoutDue = 0;
    var tasks = document_.tasks;
    Object.keys(tasks).forEach(function (id) {
      var task = tasks[id];
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
          return (
            (a.order || 0) - (b.order || 0) ||
            String(a.title).localeCompare(String(b.title))
          );
        })
        .forEach(function (task) {
          var row = document.createElement("li");
          // Completion comes from `completed`. The column is a separate fact,
          // shown as its own note rather than used to correct the flag.
          row.className = "entry" + (task.completed ? " entry--done" : "");
          var title = document.createElement("span");
          title.textContent = task.title || "(untitled)";
          row.append(title);
          var notes = [];
          if (task.columnId) notes.push(task.columnId);
          if (task.priority) notes.push(task.priority);
          if (Array.isArray(task.subtasks) && task.subtasks.length)
            notes.push(task.subtasks.length + " subtasks");
          if (notes.length) {
            var note = document.createElement("span");
            note.className = "entry-note";
            note.textContent = notes.join(" · ");
            row.append(note);
          }
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

  /** Show the description the owner wrote, as plain text. It is prose, so it is
   *  never rendered as markup and nothing in it is followed. */
  async function showDescription() {
    try {
      var described = await port.description();
      if (!described || !described.description) return;
      describeBox.hidden = false;
      describeBox.querySelector("pre").textContent = described.description;
    } catch (_) {
      // Optional by design; its absence is not a problem to report.
    }
  }

  function show(snapshot) {
    if (!isKnownBoard(snapshot.document)) {
      // Same JSON protocol does NOT mean same meaning.
      unsupported.hidden = false;
      days.textContent = "";
      empty.hidden = true;
      undated.hidden = true;
      return;
    }
    unsupported.hidden = true;
    problem.hidden = true;
    render(snapshot.document);
  }

  async function start() {
    if (!window.ato || !window.ato.data) {
      say("This app needs to run on ato.run to reach your data.");
      return;
    }
    try {
      port = await window.ato.data.open(PORT);
    } catch (error) {
      say("Your data is not available.");
      complain(error);
      return;
    }
    var first;
    try {
      first = await port.read();
    } catch (error) {
      say("Could not read the data.");
      complain(error);
      return;
    }
    say("Reading the Todo board. This app keeps no copy of it.");
    show(first);
    await showDescription();
    // The existing Resource notification lane: a revision bump wakes this App,
    // which then re-reads under its own authority. No document body is pushed.
    await port.subscribe(show, function (error) {
      complain(error);
    });
  }

  /** Access is gone: stop showing the data and the description with it. */
  window.addEventListener("ato:data-reset", function (event) {
    var reason = event && event.detail && event.detail.reason;
    days.textContent = "";
    empty.hidden = true;
    undated.hidden = true;
    unsupported.hidden = true;
    describeBox.hidden = true;
    describeBox.querySelector("pre").textContent = "";
    say(
      reason === "data_actor_changed"
        ? "You are signed in as someone else now. Reload to continue."
        : "Access to this data changed. Reload to continue.",
    );
  });

  start();
})();
