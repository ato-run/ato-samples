"use strict";

// Which board (DataResource) this instance reads and writes is the app's
// decision, not the platform's. This file is the DOM-free half: the client for
// the app-facing Resource bridge and the rules that decide what to show.
// resource-switcher.js owns the DOM; tests/resource-switcher-core.test.mjs
// exercises everything here without a browser.
//
// Bridge contract (DESIGN.md 4 / 2), same-origin and instance-scoped:
//   GET  /__ato/data-ports                       declarations + current binding
//   GET  /__ato/data-ports/:port/candidates      -> { schema_id, port, resources, next_cursor }
//   POST /__ato/data-ports/:port/connect         { resource_id, expected_epoch, access, operations? }
//   POST /__ato/data-resources                   { display_name, document }
//
// The candidates query is always asked for "read": the protocol of a Resource
// is fixed by the declared Port, and asking for the narrower list first would
// hide boards this person may read but not write. Write capability is settled
// by connect (see connectBoard), which is the server's own decision.
(function (scope) {
  const DATA_PORTS_PATH = "/__ato/data-ports";
  const DATA_RESOURCES_PATH = "/__ato/data-resources";
  // A remembered selection is a UI hint only; it never decides a binding.
  const HINT_KEY = "ato.task-board.resource.v1";
  const PERSONAL_OWNER_KINDS = ["personal", "user"];
  const TEAM_OWNER_KINDS = ["team", "organization", "org", "organization_member"];
  const DEFAULT_COLUMNS = [
    { id: "todo", title: "Todo", order: 1000 },
    { id: "pending", title: "Pending", order: 2000 },
    { id: "progress", title: "In Progress", order: 3000 },
    { id: "done", title: "Done", order: 4000 },
  ];

  function dataBridgeError(code, status, details) {
    const error = new Error(String(code || "data_bridge_failed"));
    error.name = "AtoDataBridgeError";
    error.code = String(code || "data_bridge_failed");
    error.status = typeof status === "number" ? status : null;
    error.details = details && typeof details === "object" ? details : {};
    return error;
  }

  function isBridgeUnavailable(error) {
    const code = error && error.code;
    return (
      code === "not_found" ||
      code === "data_bridge_unavailable" ||
      (error && error.status === 404 && code !== "data_resource_unavailable")
    );
  }

  /**
   * A failed board read is never an empty board: an instance with no binding is
   * a first run (the chooser takes over), anything else is an error state.
   */
  function failureStatus(code) {
    return code === "data_port_not_connected" ||
      code === "data_resource_unavailable"
      ? "unbound"
      : "error";
  }

  function createBridge(options) {
    const settings = options && typeof options === "object" ? options : {};
    const fetchImpl =
      typeof settings.fetch === "function"
        ? settings.fetch
        : typeof fetch === "function"
          ? fetch
          : null;
    if (!fetchImpl) throw dataBridgeError("data_bridge_unavailable");
    const base = String(settings.base || DATA_PORTS_PATH).replace(/\/+$/, "");
    const resourcesPath = String(settings.resourcesPath || DATA_RESOURCES_PATH);

    async function request(path, init) {
      const response = await fetchImpl(
        path,
        Object.assign({ credentials: "same-origin", cache: "no-store" }, init),
      );
      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        payload = null;
      }
      if (!response || response.ok !== true) {
        throw dataBridgeError(
          payload && typeof payload === "object" ? payload.error : null,
          response ? response.status : null,
          payload,
        );
      }
      if (!payload || typeof payload !== "object")
        throw dataBridgeError("data_bridge_invalid_response", response.status);
      return payload;
    }

    function requirements() {
      return request(base);
    }

    function candidates(port, access) {
      const query = access === "read_write" ? "read" : access || "read";
      return request(
        base +
          "/" +
          encodeURIComponent(port) +
          "/candidates?access=" +
          encodeURIComponent(query),
      );
    }

    function connect(port, body) {
      return request(base + "/" + encodeURIComponent(port) + "/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    function disconnect(port, body) {
      return request(base + "/" + encodeURIComponent(port) + "/connection", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
      });
    }

    function createResource(body) {
      return request(resourcesPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    return {
      requirements: requirements,
      candidates: candidates,
      connect: connect,
      disconnect: disconnect,
      createResource: createResource,
    };
  }

  function findPortRequirement(requirements, port) {
    const list =
      requirements && Array.isArray(requirements.requirements)
        ? requirements.requirements
        : [];
    for (const item of list) {
      if (item && item.port_name === port) return item;
    }
    return null;
  }

  function bindingOf(requirement) {
    const binding = requirement && requirement.binding;
    return binding &&
      typeof binding.resource_id === "string" &&
      binding.resource_id
      ? binding
      : null;
  }

  function accessOf(binding) {
    return binding && binding.max_access === "read" ? "read" : "read_write";
  }

  /**
   * What the app may show on start. The platform reports the binding; the
   * remembered id is returned only so the chooser can label it.
   */
  function startupPlan(requirements, port, hint) {
    const requirement = findPortRequirement(requirements, port);
    if (!requirement) return { kind: "error", code: "data_port_not_declared" };
    const remembered =
      hint && typeof hint.resource_id === "string" && hint.resource_id
        ? hint
        : null;
    const binding = bindingOf(requirement);
    if (binding) {
      return {
        kind: "bound",
        requirement: requirement,
        binding: binding,
        hintMatched: !!remembered && remembered.resource_id === binding.resource_id,
      };
    }
    return { kind: "chooser", requirement: requirement, hint: remembered };
  }

  function candidateEpoch(candidate) {
    const keys = ["expected_epoch", "access_epoch", "revision"];
    for (const key of keys) {
      const value = candidate ? candidate[key] : undefined;
      if (typeof value === "number" && Number.isFinite(value) && value >= 0)
        return value;
    }
    return 0;
  }

  function ownerSection(ownerKind) {
    const kind =
      typeof ownerKind === "string" ? ownerKind.trim().toLowerCase() : "";
    if (PERSONAL_OWNER_KINDS.indexOf(kind) !== -1) return "personal";
    if (TEAM_OWNER_KINDS.indexOf(kind) !== -1) return "team";
    return "other";
  }

  function candidateEntry(resource, currentResourceId) {
    const id =
      resource && typeof resource.resource_id === "string"
        ? resource.resource_id
        : "";
    if (!id) return null;
    return {
      resource_id: id,
      display_name:
        typeof resource.display_name === "string" && resource.display_name
          ? resource.display_name
          : "",
      owner_kind:
        typeof resource.owner_kind === "string" ? resource.owner_kind : "",
      expected_epoch: candidateEpoch(resource),
      is_current:
        resource.is_current === true || id === (currentResourceId || ""),
    };
  }

  function sortByName(entries) {
    // A board without a name is still selectable, but it sorts last.
    const label = function (entry) {
      return entry.display_name || "￿";
    };
    return entries.sort(function (a, b) {
      return label(a).localeCompare(label(b), "ja");
    });
  }

  /**
   * Split the candidates into the groups the picker shows. A Resource missing
   * from candidates (internal listing, or bound through a personal slot) is
   * added from the binding so the current board is always selectable.
   */
  function chooserView(payload, options) {
    const settings = options && typeof options === "object" ? options : {};
    const currentResourceId =
      typeof settings.currentResourceId === "string"
        ? settings.currentResourceId
        : "";
    const view = { current: [], personal: [], team: [], other: [], total: 0 };
    const seen = Object.create(null);
    const resources =
      payload && Array.isArray(payload.resources) ? payload.resources : [];
    for (const resource of resources) {
      const entry = candidateEntry(resource, currentResourceId);
      if (!entry || seen[entry.resource_id]) continue;
      seen[entry.resource_id] = true;
      view.total += 1;
      if (entry.is_current) view.current.push(entry);
      else view[ownerSection(entry.owner_kind)].push(entry);
    }
    const binding = settings.binding;
    if (
      binding &&
      typeof binding.resource_id === "string" &&
      binding.resource_id &&
      !seen[binding.resource_id]
    ) {
      view.current.unshift({
        resource_id: binding.resource_id,
        display_name:
          typeof binding.display_name === "string" ? binding.display_name : "",
        owner_kind: "",
        expected_epoch: candidateEpoch(binding),
        is_current: true,
      });
      view.total += 1;
    }
    sortByName(view.current);
    sortByName(view.personal);
    sortByName(view.team);
    sortByName(view.other);
    return view;
  }

  function isConflict(error) {
    return !!error && (error.status === 409 || error.code === "data_binding_conflict");
  }

  async function refreshedEpoch(bridge, port, resourceId) {
    try {
      const payload = await bridge.candidates(port, "read");
      const resources =
        payload && Array.isArray(payload.resources) ? payload.resources : [];
      for (const resource of resources) {
        if (resource && resource.resource_id === resourceId)
          return candidateEpoch(resource);
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  /**
   * Bind this instance to one Resource and report the access the binding got.
   * A 409 is what the server returns both for a stale expected_epoch and for a
   * grant that cannot write, so the retry is ordered: refresh the epoch, try
   * write once more, then accept a read-only binding instead of failing.
   */
  async function connectBoard(bridge, port, options) {
    const settings = options && typeof options === "object" ? options : {};
    const resourceId =
      typeof settings.resourceId === "string" ? settings.resourceId : "";
    if (!resourceId) throw dataBridgeError("data_resource_required");
    let epoch =
      typeof settings.expectedEpoch === "number" &&
      Number.isFinite(settings.expectedEpoch) &&
      settings.expectedEpoch >= 0
        ? settings.expectedEpoch
        : 0;
    const attempt = function (access) {
      return bridge.connect(port, {
        resource_id: resourceId,
        expected_epoch: epoch,
        access: access,
      });
    };
    try {
      return { binding: await attempt("read_write"), access: "read_write" };
    } catch (first) {
      if (!isConflict(first)) throw first;
      const next = await refreshedEpoch(bridge, port, resourceId);
      if (next !== null && next !== epoch) {
        epoch = next;
        try {
          return { binding: await attempt("read_write"), access: "read_write" };
        } catch (second) {
          if (!isConflict(second)) throw second;
        }
      }
      try {
        return { binding: await attempt("read"), access: "read", degraded: true };
      } catch (third) {
        throw third;
      }
    }
  }

  function readHint(storage) {
    try {
      const raw = storage ? storage.getItem(HINT_KEY) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.resource_id !== "string" || !parsed.resource_id)
        return null;
      return {
        resource_id: parsed.resource_id,
        display_name:
          typeof parsed.display_name === "string" ? parsed.display_name : "",
        at: typeof parsed.at === "string" ? parsed.at : "",
      };
    } catch (_) {
      return null;
    }
  }

  function writeHint(storage, entry, now) {
    if (!storage || !entry || typeof entry.resource_id !== "string") return false;
    const at =
      typeof now === "string" && now ? now : new Date().toISOString();
    try {
      storage.setItem(
        HINT_KEY,
        JSON.stringify({
          resource_id: entry.resource_id,
          display_name:
            typeof entry.display_name === "string" ? entry.display_name : "",
          at: at,
        }),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearHint(storage) {
    try {
      if (storage) storage.removeItem(HINT_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** The document a brand-new board starts with; never a copy of another board. */
  function newBoardDocument(now, columns) {
    const at = typeof now === "string" && now ? now : new Date().toISOString();
    const source = Array.isArray(columns) && columns.length ? columns : DEFAULT_COLUMNS;
    return {
      schemaVersion: 3,
      revision: 0,
      updatedAt: at,
      updatedBy: "shared-json-todo",
      nextTaskNumber: 1,
      columns: source.map(function (column, index) {
        return {
          id: String(column.id),
          title: String(column.title),
          order: Number.isFinite(column.order)
            ? column.order
            : (index + 1) * 1000,
        };
      }),
      tasks: {},
    };
  }

  const api = {
    DATA_PORTS_PATH: DATA_PORTS_PATH,
    DATA_RESOURCES_PATH: DATA_RESOURCES_PATH,
    HINT_KEY: HINT_KEY,
    createBridge: createBridge,
    dataBridgeError: dataBridgeError,
    isBridgeUnavailable: isBridgeUnavailable,
    failureStatus: failureStatus,
    findPortRequirement: findPortRequirement,
    bindingOf: bindingOf,
    accessOf: accessOf,
    startupPlan: startupPlan,
    candidateEpoch: candidateEpoch,
    ownerSection: ownerSection,
    chooserView: chooserView,
    connectBoard: connectBoard,
    readHint: readHint,
    writeHint: writeHint,
    clearHint: clearHint,
    newBoardDocument: newBoardDocument,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  scope.AtoTodoResourceCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
