// DOM-free tests for the in-app board selection logic.
//   node --test samples/shared-json-todo/tests/
// resource-switcher-core.js is a classic script, so it is evaluated in a vm
// sandbox: no browser, no bundler, no dependency install.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, "..", "resource-switcher-core.js"), "utf8");

function loadCore() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: "resource-switcher-core.js" });
  return sandbox.AtoTodoResourceCore;
}

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

// routes: { "GET /__ato/data-ports": response | () => response | [responses] }
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const settings = init || {};
    const method = settings.method || "GET";
    const key = method + " " + url;
    calls.push({
      key,
      method,
      url,
      body: settings.body ? JSON.parse(settings.body) : null,
    });
    const entry = routes[key];
    if (typeof entry === "function") return entry(calls);
    if (Array.isArray(entry)) return entry.length > 1 ? entry.shift() : entry[0];
    if (entry) return entry;
    return response(404, { error: "not_found" });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    raw: map,
  };
}

// values cross the vm boundary, so compare them as JSON, not by prototype
const plain = (value) => JSON.parse(JSON.stringify(value));

const PORTS = "/__ato/data-ports";
const RESOURCES = "/__ato/data-resources";
const requirementsWith = (binding) => ({
  schema_id: "schema-1",
  instance_epoch: 3,
  personal_slots: [],
  requirements: [
    {
      port_name: "tasks",
      protocol_ref: "todo.board@1",
      scope: "user",
      max_access: "read_write",
      required: true,
      scope_mode: "document",
      operations: [],
      binding,
    },
  ],
  ready: binding !== null,
});

test("startupPlan: a bound Resource wins over the remembered hint", () => {
  const core = loadCore();
  const plan = core.startupPlan(
    requirementsWith({
      id: "dbind-1",
      resource_id: "dres-a",
      display_name: "work",
      max_access: "read_write",
      binding_epoch: 2,
    }),
    "tasks",
    { resource_id: "dres-b", display_name: "old" },
  );
  assert.equal(plan.kind, "bound");
  assert.equal(plan.binding.resource_id, "dres-a");
  assert.equal(plan.hintMatched, false);
});

test("startupPlan: a gone binding falls back to the chooser, not the hint", () => {
  const core = loadCore();
  const plan = core.startupPlan(requirementsWith(null), "tasks", {
    resource_id: "dres-gone",
    display_name: "previous",
  });
  assert.equal(plan.kind, "chooser");
  assert.equal(plan.hint.resource_id, "dres-gone");
});

test("startupPlan: a missing Port is an error, not an empty board", () => {
  const core = loadCore();
  const plan = core.startupPlan({ requirements: [] }, "tasks", null);
  assert.equal(plan.kind, "error");
  assert.equal(plan.code, "data_port_not_declared");
  assert.equal(core.failureStatus("data_port_not_connected"), "unbound");
  assert.equal(core.failureStatus("data_resource_unavailable"), "unbound");
  assert.equal(core.failureStatus("operation_not_found"), "error");
  assert.equal(core.failureStatus("data_binding_conflict"), "error");
});

test("chooserView: groups by owner kind, keeps the binding visible, ignores duplicates", () => {
  const core = loadCore();
  const payload = {
    schema_id: "schema-1",
    port: { port_name: "tasks" },
    resources: [
      { resource_id: "dres-p2", display_name: "shopping", owner_kind: "user", access_epoch: 4 },
      { resource_id: "dres-p1", display_name: "work", owner_kind: "personal", access_epoch: 1 },
      { resource_id: "dres-t1", display_name: "dev team", owner_kind: "team", access_epoch: 9 },
      { resource_id: "dres-o1", display_name: "shared note", owner_kind: "instance", access_epoch: 2 },
      { resource_id: "dres-x1" },
      { resource_id: "dres-p1", display_name: "duplicate", owner_kind: "user" },
    ],
    next_cursor: null,
  };
  const view = core.chooserView(payload, {
    currentResourceId: "dres-t1",
    binding: { resource_id: "dres-internal", display_name: "personal board", binding_epoch: 7 },
  });
  // groups are ordered by display name ("dev team" before "personal board")
  assert.deepEqual(plain(view.current.map((e) => e.resource_id)), ["dres-t1", "dres-internal"]);
  assert.ok(view.current.every((e) => e.is_current));
  assert.deepEqual(plain(view.personal.map((e) => e.resource_id)), ["dres-p2", "dres-p1"]);
  assert.deepEqual(plain(view.team.map((e) => e.resource_id)), []);
  assert.deepEqual(plain(view.other.map((e) => e.resource_id)), ["dres-o1", "dres-x1"]);
  // 5 unique candidates + the bound board that candidates did not list
  assert.equal(view.total, 6);
  // the epoch the connect call has to echo back comes from the candidate row
  assert.equal(view.personal[0].expected_epoch, 4);
  assert.equal(view.other[1].expected_epoch, 0);
});

test("bridge: candidates are asked for read access and carry the Port name", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS + "/tasks/candidates?access=read"]: response(200, {
      schema_id: "schema-1",
      resources: [],
      next_cursor: null,
    }),
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  const payload = await bridge.candidates("tasks", "read_write");
  assert.equal(payload.schema_id, "schema-1");
  assert.equal(fetchImpl.calls[0].key, "GET " + PORTS + "/tasks/candidates?access=read");
});

test("bridge: requirements and create use the declared paths and body", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(null)),
    ["POST " + RESOURCES]: response(201, { resource_id: "dres-new", revision: 1 }),
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  assert.equal((await bridge.requirements()).schema_id, "schema-1");
  const created = await bridge.createResource({ display_name: "new board", document: { tasks: {} } });
  assert.equal(created.resource_id, "dres-new");
  const createCall = fetchImpl.calls[1];
  assert.equal(createCall.method, "POST");
  assert.deepEqual(Object.keys(createCall.body).sort(), ["display_name", "document"]);
});

test("bridge: an HTTP failure keeps the server code and never looks like success", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(503, { error: "data_resource_unavailable" }),
    ["POST " + PORTS + "/tasks/connect"]: response(409, { error: "data_binding_conflict" }),
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  await assert.rejects(bridge.requirements(), (error) => {
    assert.equal(error.code, "data_resource_unavailable");
    assert.equal(error.status, 503);
    return true;
  });
  await assert.rejects(
    bridge.connect("tasks", { resource_id: "dres-a", expected_epoch: 0, access: "read_write" }),
    (error) => error.code === "data_binding_conflict" && error.status === 409,
  );
});

test("bridge: a missing bridge (404) is reported as unavailable, not as a board error", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({});
  const bridge = core.createBridge({ fetch: fetchImpl });
  await assert.rejects(bridge.requirements(), (error) => {
    assert.equal(core.isBridgeUnavailable(error), true);
    return true;
  });
  assert.equal(core.isBridgeUnavailable({ code: "data_resource_unavailable", status: 404 }), false);
});

test("connectBoard: a write binding is used when the server grants it", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({
    ["POST " + PORTS + "/tasks/connect"]: response(200, {
      binding_id: "dbind-1",
      resource_id: "dres-a",
      scope_mode: "document",
    }),
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  const result = await core.connectBoard(bridge, "tasks", { resourceId: "dres-a", expectedEpoch: 4 });
  assert.equal(result.access, "read_write");
  assert.equal(fetchImpl.calls.length, 1);
  assert.deepEqual(fetchImpl.calls[0].body, {
    resource_id: "dres-a",
    expected_epoch: 4,
    access: "read_write",
  });
});

test("connectBoard: a stale epoch is refreshed once and the write binding still wins", async () => {
  const core = loadCore();
  const connect = [
    response(409, { error: "data_binding_conflict" }),
    response(200, { binding_id: "dbind-1", resource_id: "dres-a", scope_mode: "document" }),
  ];
  const fetchImpl = fakeFetch({
    ["POST " + PORTS + "/tasks/connect"]: () => connect.shift(),
    ["GET " + PORTS + "/tasks/candidates?access=read"]: response(200, {
      resources: [{ resource_id: "dres-a", display_name: "work", access_epoch: 8 }],
    }),
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  const result = await core.connectBoard(bridge, "tasks", { resourceId: "dres-a", expectedEpoch: 4 });
  assert.equal(result.access, "read_write");
  assert.equal(fetchImpl.calls.length, 3);
  assert.equal(fetchImpl.calls[2].body.expected_epoch, 8);
});

test("connectBoard: a board this person may only read degrades to a read binding", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({
    ["POST " + PORTS + "/tasks/connect"]: (calls) => {
      const last = calls[calls.length - 1];
      if (last.body.access === "read")
        return response(200, {
          binding_id: "dbind-2",
          resource_id: "dres-team",
          scope_mode: "document",
        });
      return response(409, { error: "data_binding_conflict" });
    },
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  const result = await core.connectBoard(bridge, "tasks", {
    resourceId: "dres-team",
    expectedEpoch: 2,
  });
  assert.equal(result.access, "read");
  assert.equal(result.degraded, true);
  assert.equal(fetchImpl.calls[fetchImpl.calls.length - 1].body.access, "read");
});

test("connectBoard: a board that refuses both bindings surfaces the error", async () => {
  const core = loadCore();
  const fetchImpl = fakeFetch({
    ["POST " + PORTS + "/tasks/connect"]: response(409, { error: "data_binding_conflict" }),
  });
  const bridge = core.createBridge({ fetch: fetchImpl });
  await assert.rejects(
    core.connectBoard(bridge, "tasks", { resourceId: "dres-a", expectedEpoch: 0 }),
    (error) => error.code === "data_binding_conflict",
  );
});

test("connectBoard: an empty resource id is refused before any network call", async () => {
  const core = loadCore();
  await assert.rejects(
    core.connectBoard({ connect: () => assert.fail("must not connect") }, "tasks", {
      resourceId: "",
      expectedEpoch: 0,
    }),
    (error) => error.code === "data_resource_required",
  );
});

test("hint: stored and read as a UI hint only, malformed entries are ignored", () => {
  const core = loadCore();
  const storage = memoryStorage();
  assert.equal(core.readHint(storage), null);
  assert.equal(
    core.writeHint(storage, { resource_id: "dres-a", display_name: "work" }, "2026-11-12T00:00:00.000Z"),
    true,
  );
  assert.deepEqual(plain(core.readHint(storage)), {
    resource_id: "dres-a",
    display_name: "work",
    at: "2026-11-12T00:00:00.000Z",
  });
  storage.setItem(core.HINT_KEY, "{not json");
  assert.equal(core.readHint(storage), null);
  storage.setItem(core.HINT_KEY, JSON.stringify({ display_name: "no id" }));
  assert.equal(core.readHint(storage), null);
  assert.equal(core.clearHint(storage), true);
  assert.equal(core.readHint(storage), null);
});

test("newBoardDocument: a created board is empty and uses the app columns", () => {
  const core = loadCore();
  const columns = [
    { id: "todo", title: "Todo", order: 1000 },
    { id: "done", title: "Done", order: 4000 },
  ];
  const document = core.newBoardDocument("2026-11-12T00:00:00.000Z", columns);
  assert.equal(document.schemaVersion, 3);
  assert.equal(document.revision, 0);
  assert.equal(document.nextTaskNumber, 1);
  assert.deepEqual(plain(document.tasks), {});
  assert.deepEqual(plain(document.columns), columns);
  assert.equal(document.updatedAt, "2026-11-12T00:00:00.000Z");
});
