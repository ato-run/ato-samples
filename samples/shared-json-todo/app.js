/**
 * A task board whose JSON is its own, kept in a Data Resource the person owns.
 *
 * The document here is not an Ato data type. It is this App's shape — the one
 * the staging TODO already uses (`ato.task-board.state.v1`): `columns`, and
 * `tasks` as an OBJECT keyed by task id, each task carrying a title, a
 * description, a priority, subtasks, an order, a column and a `completed` flag
 * that is allowed to disagree with that column.
 *
 * ato.run stores it, decides who may read or write it, orders concurrent
 * writes and keeps it alive. It does not know what any of it means. That is
 * what makes a second App possible: Calendar reads THIS document, having been
 * written against the description the owner saved beside it — not against a
 * type the platform imposed.
 *
 * Four rules shape this file more than anything else:
 *
 *   1. Never rebuild from the fields this build knows. Changes are merged onto
 *      the document that was just read, so a field written by a newer version
 *      of this app — or a different app — survives the write.
 *   2. Never treat an error as empty. Not connected, failed to read and
 *      unexpected shape all stop visibly. An empty board is something a person
 *      asks for, never something a failure produces.
 *   3. Never lose an edit to an unfinished save. The compose fields are
 *      cleared only once the write is durable, and a response that never
 *      arrived is retried as the SAME operation rather than reissued.
 *   4. Never render backwards. A snapshot arriving mid-save is kept and
 *      applied afterwards, so the view converges on the newest revision.
 */
(function () {
  "use strict";

  var PORT = "todo";
  var DEFAULT_COLUMNS = [
    { id: "todo", title: "Todo", order: 1000 },
    { id: "progress", title: "In Progress", order: 2000 },
    { id: "done", title: "Done", order: 3000 },
  ];

  var where = document.getElementById("where");
  var problem = document.getElementById("problem");
  var compose = document.getElementById("compose");
  var board = document.getElementById("board");
  var empty = document.getElementById("empty");
  var startBox = document.getElementById("start");
  var startButton = document.getElementById("start-board");
  var titleField = document.getElementById("title");
  var descriptionField = document.getElementById("description");
  var priorityField = document.getElementById("priority");
  var dueField = document.getElementById("due");
  var columnField = document.getElementById("column");

  var port = null;
  /** The last document rendered. Display only; never a write source. */
  var shown = null;
  /** A snapshot that arrived while a save was in flight, applied afterwards. */
  var deferred = null;
  var busy = false;
  /** Set once access is gone. Nothing re-enables editing after this. */
  var dead = false;
  /** True while a write's outcome is unknown, so the next one must wait. */
  var unresolved = false;

  function say(message) {
    where.textContent = message;
  }
  function clearComplaint() {
    problem.hidden = true;
    problem.textContent = "";
  }
  function complain(error) {
    problem.hidden = false;
    problem.textContent = message(error);
  }
  function message(error) {
    var code = (error && error.code) || "";
    if (code === "data_port_not_connected")
      return "This app is not connected to any data yet. Connect data from its app page, then reload.";
    if (code === "data_access_revoked" || code === "data_actor_changed")
      return "Access to this data changed. Reload to continue.";
    if (code === "data_revision_or_authority_conflict")
      return "Someone else changed this board at the same time. Try again.";
    if (code === "document_too_large")
      return "This board is too large to save. Remove something and try again.";
    return "Something went wrong. Try again.";
  }

  /**
   * Merge, preserving every own property of both sides.
   *
   * `Object.fromEntries` rather than `Object.assign` or spread: those two
   * ASSIGN, and assigning a key named `__proto__` invokes the inherited setter
   * instead of creating a property, so the key silently disappears.
   * `fromEntries` defines. ato.run happens to refuse `__proto__`,
   * `constructor` and `prototype` as document keys, so that exact key cannot
   * arrive here — this stays because defining is simply the correct operation
   * for copying a document nobody fully understands.
   */
  function merge(base, changes) {
    return Object.fromEntries(
      Object.entries(base).concat(Object.entries(changes)),
    );
  }

  /** Copy an object minus one key, defining rather than assigning. */
  function without(base, key) {
    return Object.fromEntries(
      Object.entries(base).filter(function (entry) {
        return entry[0] !== key;
      }),
    );
  }

  /**
   * Is this a board this App can show?
   *
   * Deliberately generous: `tasks` must be an object, and that is all. Extra
   * top-level keys, unknown task fields and missing optional fields are all
   * fine — refusing them would defeat the point of sharing the document.
   */
  function isBoard(value) {
    return !!(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value.tasks &&
      typeof value.tasks === "object" &&
      !Array.isArray(value.tasks)
    );
  }

  function isUntouched(value) {
    return !!(
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    );
  }

  function columnsOf(doc) {
    return Array.isArray(doc.columns) && doc.columns.length
      ? doc.columns
      : DEFAULT_COLUMNS;
  }

  function tasksIn(doc, columnId) {
    return Object.keys(doc.tasks)
      .map(function (id) {
        return doc.tasks[id];
      })
      .filter(function (task) {
        return task && task.columnId === columnId;
      })
      .sort(function (a, b) {
        return (
          (a.order || 0) - (b.order || 0) ||
          String(a.id).localeCompare(String(b.id))
        );
      });
  }

  function nextOrder(doc, columnId) {
    return (
      tasksIn(doc, columnId).reduce(function (max, task) {
        return Math.max(max, task.order || 0);
      }, 0) + 1000
    );
  }

  function render(doc) {
    shown = doc;
    board.textContent = "";
    var columns = columnsOf(doc);
    empty.hidden = Object.keys(doc.tasks).length > 0;

    // The column selector follows the document's own columns, so a board with
    // different ones is usable without changing this App.
    if (columnField.dataset.signature !== JSON.stringify(columns)) {
      columnField.dataset.signature = JSON.stringify(columns);
      var chosen = columnField.value;
      columnField.textContent = "";
      columns.forEach(function (column) {
        var option = document.createElement("option");
        option.value = column.id;
        option.textContent = column.title || column.id;
        columnField.append(option);
      });
      columnField.value = chosen || columns[0].id;
    }

    columns.forEach(function (column) {
      var section = document.createElement("section");
      section.className = "column";
      var heading = document.createElement("h2");
      heading.className = "column-title";
      heading.textContent = column.title || column.id;
      var list = document.createElement("ul");
      list.className = "cards";
      tasksIn(doc, column.id).forEach(function (task) {
        list.append(card(task, columns));
      });
      section.append(heading, list);
      board.append(section);
    });
  }

  function card(task, columns) {
    var item = document.createElement("li");
    item.className = "card" + (task.completed ? " card--done" : "");

    var head = document.createElement("div");
    head.className = "card-head";

    var done = document.createElement("input");
    done.type = "checkbox";
    done.checked = !!task.completed;
    done.setAttribute(
      "aria-label",
      (task.completed ? "Reopen " : "Complete ") + (task.title || task.id),
    );
    done.addEventListener("change", function () {
      change(function (doc) {
        return patchTask(doc, task.id, { completed: !task.completed });
      });
    });

    var title = document.createElement("span");
    title.className = "card-title";
    title.textContent = task.title || "(untitled)";

    head.append(done, title);

    var meta = document.createElement("p");
    meta.className = "card-meta";
    var bits = [];
    if (task.priority) bits.push(task.priority);
    if (task.dueAt) bits.push("due " + task.dueAt);
    // The board's own contradiction, surfaced rather than silently fixed.
    if (task.completed && task.columnId !== "done")
      bits.push("done, off-column");
    if (!task.completed && task.columnId === "done")
      bits.push("in Done, not completed");
    meta.textContent = bits.join(" · ");

    item.append(head, meta);

    if (task.description) {
      var description = document.createElement("p");
      description.className = "card-description";
      description.textContent = task.description;
      item.append(description);
    }

    if (Array.isArray(task.subtasks) && task.subtasks.length) {
      var subtasks = document.createElement("ul");
      subtasks.className = "subtasks";
      task.subtasks
        .slice()
        .sort(function (a, b) {
          return (a.order || 0) - (b.order || 0);
        })
        .forEach(function (sub) {
          var row = document.createElement("li");
          row.className = sub.completed ? "subtask subtask--done" : "subtask";
          row.textContent = sub.title || sub.id;
          subtasks.append(row);
        });
      item.append(subtasks);
    }

    var actions = document.createElement("div");
    actions.className = "card-actions";

    var move = document.createElement("select");
    move.setAttribute("aria-label", "Column for " + (task.title || task.id));
    columns.forEach(function (column) {
      var option = document.createElement("option");
      option.value = column.id;
      option.textContent = column.title || column.id;
      move.append(option);
    });
    move.value = task.columnId;
    move.addEventListener("change", function () {
      var columnId = move.value;
      change(function (doc) {
        // Only the column moves. `completed` is a separate fact about the task
        // and this App does not get to decide they must agree.
        return patchTask(doc, task.id, {
          columnId: columnId,
          order: nextOrder(doc, columnId),
        });
      });
    });

    var remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.setAttribute("aria-label", "Delete " + (task.title || task.id));
    remove.addEventListener("click", function () {
      change(function (doc) {
        return merge(doc, { tasks: without(doc.tasks, task.id) });
      });
    });

    actions.append(move, remove);
    item.append(actions);
    return item;
  }

  /**
   * Change one task, leaving every other field of the document — and every
   * other field of that task — exactly as it was read.
   *
   * Returns null when the task is gone, so a change racing a delete abandons
   * rather than resurrecting it.
   */
  function patchTask(doc, id, changes) {
    var current = doc.tasks[id];
    if (!current) return null;
    var tasks = merge(doc.tasks, {});
    tasks[id] = merge(current, changes);
    return merge(doc, { tasks: tasks });
  }

  /** A response that never arrived: the operation may or may not have landed,
   *  so it must be retried as ITSELF rather than reissued as a new one. */
  function lostResponse(error) {
    return !error || !error.status || error.status >= 500;
  }

  /**
   * Read, transform, commit — under the revision that was read.
   *
   * `expected` pins the commit to the document `apply` actually saw, so a
   * concurrent change loses the race with a conflict instead of being erased.
   * A conflict re-reads and re-applies; it never replays the stale payload.
   *
   * Resolves to true only when the write is durable, which is what the compose
   * form waits for before clearing itself.
   */
  async function change(apply) {
    if (!port || busy || dead) return false;
    if (unresolved) {
      // The previous write's outcome is still unknown. Finish that one first;
      // starting another would race two operations against one document.
      return resolvePending();
    }
    busy = true;
    setEnabled(false);
    clearComplaint();
    try {
      for (var attempt = 0; attempt < 3; attempt++) {
        var snapshot = await port.read();
        if (!isBoard(snapshot.document)) {
          say("The connected data is not a board this app understands.");
          return false;
        }
        var next = apply(snapshot.document);
        if (!next) {
          render(snapshot.document);
          return false;
        }
        try {
          var receipt = await port.mutate(
            { kind: "replace", value: next },
            { expected: snapshot, operation_id: crypto.randomUUID() },
          );
          settle(next, receipt);
          return true;
        } catch (error) {
          if (error && error.code === "data_operation_pending_use_retry")
            return resolvePending();
          if (lostResponse(error)) {
            unresolved = true;
            complain(error);
            return false;
          }
          var retriable =
            error && error.code === "data_revision_or_authority_conflict";
          if (!retriable || attempt === 2) throw error;
        }
      }
      return false;
    } catch (error) {
      complain(error);
      await showServerTruth();
      return false;
    } finally {
      busy = false;
      // A late finally must not re-enable editing that revocation disabled.
      if (!dead) setEnabled(true);
    }
  }

  /** Finish the one operation whose outcome is unknown, without reissuing it. */
  async function resolvePending() {
    if (!port || dead) return false;
    busy = true;
    setEnabled(false);
    try {
      await port.retry();
      unresolved = false;
      clearComplaint();
      await showServerTruth();
      return true;
    } catch (error) {
      if (error && error.code === "no_pending_data_operation") {
        // It landed after all, or the runtime already cleared it.
        unresolved = false;
        clearComplaint();
        await showServerTruth();
        return true;
      }
      if (!lostResponse(error)) unresolved = false;
      complain(error);
      return false;
    } finally {
      busy = false;
      if (!dead) setEnabled(true);
    }
  }

  /**
   * Show what the write produced, or the newer snapshot that arrived while it
   * was in flight — whichever is further ahead. Nothing is dropped just
   * because it landed at an inconvenient moment.
   */
  function settle(next, receipt) {
    var newer =
      deferred &&
      receipt &&
      (deferred.generation > receipt.generation ||
        (deferred.generation === receipt.generation &&
          deferred.revision >= receipt.revision));
    var document_ = newer ? deferred.document : next;
    deferred = null;
    if (isBoard(document_)) render(document_);
  }

  async function showServerTruth() {
    try {
      var current = await port.read();
      deferred = null;
      if (isBoard(current.document)) render(current.document);
    } catch (_) {
      // The complaint already on screen is the whole story.
    }
  }

  function setEnabled(enabled) {
    compose
      .querySelectorAll("input, button, select, textarea")
      .forEach(function (node) {
        node.disabled = !enabled;
      });
    board.querySelectorAll("input, button, select").forEach(function (node) {
      node.disabled = !enabled;
    });
  }

  compose.addEventListener("submit", async function (event) {
    event.preventDefault();
    var title = titleField.value.trim();
    if (!title) return;
    var columnId = columnField.value || DEFAULT_COLUMNS[0].id;
    var draft = {
      id: "task-" + crypto.randomUUID(),
      columnId: columnId,
      title: title,
      description: descriptionField.value.trim(),
      priority: priorityField.value,
      dueAt: dueField.value || null,
      completed: false,
      subtasks: [],
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
    var saved = await change(function (doc) {
      var tasks = merge(doc.tasks, {});
      tasks[draft.id] = merge(draft, { order: nextOrder(doc, columnId) });
      return merge(doc, { tasks: tasks });
    });
    // Only once it is durable. Clearing first loses the typing on any failure.
    if (saved) {
      titleField.value = "";
      descriptionField.value = "";
      dueField.value = "";
    }
  });

  /**
   * The board a person gets when they ask for one.
   *
   * Deliberately an explicit action, not something an empty document triggers:
   * connecting an existing Resource that happens to be `{}` must not be
   * indistinguishable from creating a new board, and a failed read must never
   * reach here at all.
   */
  function startingBoard() {
    return {
      schemaVersion: 1,
      revision: 1,
      updatedAt: null,
      updatedBy: "shared-json-todo",
      columns: DEFAULT_COLUMNS,
      tasks: {},
    };
  }

  startButton.addEventListener("click", async function () {
    if (!port || busy || dead) return;
    busy = true;
    startButton.disabled = true;
    clearComplaint();
    try {
      var snapshot = await port.read();
      if (!isUntouched(snapshot.document)) {
        // Someone got there first; show what is actually stored.
        say("This data already has content.");
        if (isBoard(snapshot.document)) {
          startBox.hidden = true;
          compose.hidden = false;
          render(snapshot.document);
        }
        return;
      }
      // Same CAS as every other write: a concurrent initialisation loses.
      await port.mutate(
        { kind: "replace", value: startingBoard() },
        { expected: snapshot, operation_id: crypto.randomUUID() },
      );
      var current = await port.read();
      startBox.hidden = true;
      compose.hidden = false;
      say("Your board. Any app you connect reads this same document.");
      render(current.document);
    } catch (error) {
      complain(error);
    } finally {
      busy = false;
      if (!dead) {
        startButton.disabled = false;
        setEnabled(true);
      }
    }
  });

  /** Access is gone: stop showing the data, and stop offering to edit it. */
  function shutDown(reason) {
    dead = true;
    shown = null;
    deferred = null;
    board.textContent = "";
    empty.hidden = true;
    compose.hidden = true;
    startBox.hidden = true;
    setEnabled(false);
    say(
      reason === "data_actor_changed"
        ? "You are signed in as someone else now. Reload to continue."
        : "Access to this data changed. Reload to continue.",
    );
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
    var snapshot;
    try {
      snapshot = await port.read();
    } catch (error) {
      say("Could not read your data.");
      complain(error);
      return;
    }
    if (isUntouched(snapshot.document)) {
      // Empty is a state, not a signal. Offer; do not assume.
      say("This data is empty.");
      startBox.hidden = false;
      return;
    }
    if (!isBoard(snapshot.document)) {
      say("The connected data is not a board this app understands.");
      return;
    }
    say("Your board. Any app you connect reads this same document.");
    compose.hidden = false;
    setEnabled(true);
    render(snapshot.document);
    await port.subscribe(
      function (next) {
        if (dead) return;
        // Keep it rather than drop it; `settle` applies it once the save ends.
        if (busy) deferred = next;
        else if (isBoard(next.document)) render(next.document);
      },
      function (error) {
        complain(error);
      },
    );
  }

  window.addEventListener("ato:data-reset", function (event) {
    shutDown(event && event.detail && event.detail.reason);
  });

  start();
})();
