// DOM-free tests for Calendar's in-app board selection.
//   cd samples/shared-json-calendar && node --test "tests/*.test.mjs"
// resource-switcher-core.js and calendar-core.js are classic scripts, so they
// are evaluated in a vm sandbox: no browser, no bundler, no dependency install.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeSource = readFileSync(
  path.join(here, "..", "resource-switcher-core.js"),
  "utf8",
);
const calendarSource = readFileSync(
  path.join(here, "..", "calendar-core.js"),
  "utf8",
);

function loadModules() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bridgeSource, sandbox, { filename: "resource-switcher-core.js" });
  vm.runInContext(calendarSource, sandbox, { filename: "calendar-core.js" });
  return {
    core: sandbox.AtoTodoResourceCore,
    calendar: sandbox.AtoCalendarCore,
  };
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

// values cross the vm boundary, so compare them as JSON, not by prototype
const plain = (value) => JSON.parse(JSON.stringify(value));

const PORTS = "/__ato/data-ports";

// Calendar's Port is operation-only: it lists exactly one observation and no
// document access.
function requirementsWith(binding) {
  return {
    schema_id: "schema-1",
    instance_epoch: 3,
    personal_slots: [],
    requirements: [
      {
        port_name: "tasks",
        protocol_ref: "todo.board@1",
        scope: "user",
        max_access: "operations",
        required: true,
        scope_mode: "operations",
        operations: ["todo_list_due_dates"],
        binding,
      },
    ],
    ready: binding !== null,
  };
}

const BOUND = {
  id: "dbind-1",
  resource_id: "dres-work",
  display_name: "仕事ボード",
  max_access: "operations",
  binding_epoch: 2,
};

function makeController(calendar, fetchImpl, extra) {
  const settings = extra || {};
  const bridge = calendar.createBridge({ fetch: fetchImpl });
  const events = { states: [], bound: [], unbound: [] };
  const controller = calendar.createController({
    bridge: bridge,
    onChange: function (state) {
      events.states.push(plain(state));
      if (settings.onChange) settings.onChange(state);
    },
    onBound: function (binding) {
      events.bound.push(plain(binding));
      if (settings.onBound) settings.onBound(binding);
    },
    onUnbound: function (reason) {
      events.unbound.push(reason);
      if (settings.onUnbound) settings.onUnbound(reason);
    },
  });
  return { controller: controller, bridge: bridge, events: events };
}

test("start: an unbound Port offers the chooser, never a board picked for the person", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(null)),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  const state = await controller.start();
  assert.equal(state.kind, "chooser");
  assert.equal(state.binding, null);
  assert.equal(state.prompt, calendar.UNCONNECTED_PROMPT);
  assert.match(state.prompt, /ボードを選んでください/);
  assert.equal(state.canDisconnect, false);
  assert.equal(events.bound.length, 0);
  assert.deepEqual(events.unbound, ["unbound"]);
  // Only the declarations are read: no candidate listing and no connect yet.
  assert.deepEqual(fetchImpl.calls.map((call) => call.key), ["GET " + PORTS]);
});

test("start: a bound Port names the board and reads its due dates", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(BOUND)),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  const state = await controller.start();
  assert.equal(state.kind, "bound");
  assert.equal(state.boardName, "仕事ボード");
  assert.equal(state.note, calendar.CONNECTED_NOTE);
  assert.equal(state.canDisconnect, true);
  // onBound is the calendar reading the events behind the Port.
  assert.equal(events.bound.length, 1);
  assert.equal(events.bound[0].resource_id, "dres-work");
  assert.deepEqual(events.unbound, []);
});

test("chooser: candidates are grouped like Task Board and listing binds nothing", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(null)),
    ["GET " + PORTS + "/tasks/candidates?access=read"]: response(200, {
      schema_id: "schema-1",
      port: { port_name: "tasks" },
      resources: [
        {
          resource_id: "dres-p2",
          display_name: "買い物",
          owner_kind: "user",
          access_epoch: 4,
        },
        {
          resource_id: "dres-p1",
          display_name: "仕事",
          owner_kind: "personal",
          access_epoch: 1,
        },
        {
          resource_id: "dres-t1",
          display_name: "開発チーム",
          owner_kind: "team",
          access_epoch: 9,
        },
        {
          resource_id: "dres-o1",
          display_name: "共有ノート",
          owner_kind: "instance",
          access_epoch: 2,
        },
      ],
      next_cursor: null,
    }),
  });
  const { controller } = makeController(calendar, fetchImpl);
  await controller.start();
  const state = await controller.loadCandidates();
  const sections = plain(
    calendar
      .chooserSections(state.candidates)
      .map((section) => section.title),
  );
  // 自分のボード / チームのボード are the groups Task Board shows; the rest keep
  // their own heading instead of being mixed in.
  assert.deepEqual(sections, ["自分のボード", "チームのボード", "その他のボード"]);
  const ids = (entries) => entries.map((entry) => entry.resource_id).sort();
  assert.deepEqual(plain(ids(state.candidates.personal)), ["dres-p1", "dres-p2"]);
  assert.deepEqual(plain(ids(state.candidates.team)), ["dres-t1"]);
  assert.deepEqual(plain(ids(state.candidates.other)), ["dres-o1"]);
  // The epoch the connect has to echo comes from the candidate row.
  const team = state.candidates.team[0];
  assert.equal(team.expected_epoch, 9);
  // Listing candidates is not connecting: no POST happened.
  assert.equal(
    fetchImpl.calls.filter((call) => call.method === "POST").length,
    0,
  );
});

test("connect: binds only the declared operation and reads the events again", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: [
      response(200, requirementsWith(null)),
      response(
        200,
        requirementsWith({
          ...BOUND,
          resource_id: "dres-team",
          display_name: "開発チーム",
        }),
      ),
    ],
    ["POST " + PORTS + "/tasks/connect"]: response(200, {
      binding_id: "dbind-2",
      resource_id: "dres-team",
      scope_mode: "operations",
    }),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  await controller.start();
  const state = await controller.connect("dres-team", 9);
  assert.equal(state.kind, "bound");
  assert.equal(state.boardName, "開発チーム");
  // The events are read again for the newly bound board, with no page reload.
  assert.equal(events.bound.length, 1);
  assert.equal(events.bound[0].resource_id, "dres-team");
  const connectCall = fetchImpl.calls.find((call) => call.method === "POST");
  assert.deepEqual(connectCall.body, {
    resource_id: "dres-team",
    expected_epoch: 9,
    access: "operations",
    operations: ["todo_list_due_dates"],
  });
  assert.deepEqual(
    fetchImpl.calls.map((call) => call.key),
    [
      "GET " + PORTS,
      "POST " + PORTS + "/tasks/connect",
      "GET " + PORTS,
    ],
  );
});

test("connect: a stale candidate epoch is refreshed once and the connect is retried", async () => {
  const { calendar } = loadModules();
  const connect = [
    response(409, { error: "data_binding_conflict" }),
    response(200, {
      binding_id: "dbind-2",
      resource_id: "dres-team",
      scope_mode: "operations",
    }),
  ];
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: [
      response(200, requirementsWith(null)),
      response(200, requirementsWith(BOUND)),
    ],
    ["POST " + PORTS + "/tasks/connect"]: () => connect.shift(),
    ["GET " + PORTS + "/tasks/candidates?access=read"]: response(200, {
      resources: [
        {
          resource_id: "dres-team",
          display_name: "開発チーム",
          access_epoch: 8,
        },
      ],
    }),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  await controller.start();
  const state = await controller.connect("dres-team", 4);
  assert.equal(state.kind, "bound");
  assert.equal(events.bound.length, 1);
  const posts = fetchImpl.calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.expected_epoch, 4);
  assert.equal(posts[1].body.expected_epoch, 8);
  assert.equal(posts[1].body.access, "operations");
  assert.deepEqual(posts[1].body.operations, ["todo_list_due_dates"]);
});

test("connect: a board that still conflicts leaves the chooser and reports it", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(null)),
    ["POST " + PORTS + "/tasks/connect"]: response(409, {
      error: "data_binding_conflict",
    }),
    ["GET " + PORTS + "/tasks/candidates?access=read"]: response(200, {
      resources: [
        {
          resource_id: "dres-stale",
          display_name: "古いボード",
          access_epoch: 4,
        },
      ],
    }),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  await controller.start();
  const state = await controller.connect("dres-stale", 4);
  assert.equal(state.kind, "chooser");
  assert.equal(state.binding, null);
  assert.match(state.candidatesError, /状態が変わりました/);
  assert.equal(events.bound.length, 0);
});

test("connect: no Resource means no network call", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(null)),
  });
  const { controller } = makeController(calendar, fetchImpl);
  await controller.start();
  const before = fetchImpl.calls.length;
  const state = await controller.connect("", 0);
  assert.equal(fetchImpl.calls.length, before);
  assert.equal(state.kind, "chooser");
  assert.match(state.candidatesError, /選んでください/);
});

test("disconnect: the Port stops being bound and the calendar stops reading", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, requirementsWith(BOUND)),
    ["DELETE " + PORTS + "/tasks/connection"]: response(200, { ok: true }),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  await controller.start();
  const state = await controller.disconnect();
  assert.equal(state.kind, "chooser");
  assert.equal(state.binding, null);
  assert.deepEqual(
    plain(events.bound.map((binding) => binding.resource_id)),
    ["dres-work"],
  );
  assert.deepEqual(plain(events.unbound), ["disconnected"]);
  const deleteCall = fetchImpl.calls.find((call) => call.method === "DELETE");
  assert.equal(deleteCall.key, "DELETE " + PORTS + "/tasks/connection");
  assert.deepEqual(deleteCall.body, {});
});

test("start: an undeclared Port is an error, not an empty calendar", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({
    ["GET " + PORTS]: response(200, { requirements: [], ready: false }),
  });
  const { controller, events } = makeController(calendar, fetchImpl);
  const state = await controller.start();
  assert.equal(state.kind, "error");
  assert.match(state.problem, /データ接続が宣言されていません/);
  assert.deepEqual(events.unbound, ["error"]);
});

test("start: a missing bridge is explained instead of shown as an empty month", async () => {
  const { calendar } = loadModules();
  const fetchImpl = fakeFetch({});
  const { controller, events } = makeController(calendar, fetchImpl);
  const state = await controller.start();
  assert.equal(state.kind, "error");
  assert.equal(state.problem, "この実行環境ではボードを切り替えられません。");
  assert.deepEqual(events.unbound, ["error"]);
});

test("problemText: the existing failure texts stay distinct, in Japanese", () => {
  const { calendar } = loadModules();
  assert.match(
    calendar.problemText({ code: "data_access_revoked" }),
    /アクセスが変わりました/,
  );
  assert.match(
    calendar.problemText({ code: "data_actor_changed" }),
    /別のアカウント/,
  );
  assert.match(
    calendar.problemText({ code: "operation_not_granted" }),
    /todo_list_due_dates/,
  );
  assert.match(
    calendar.problemText({ code: "unsupported_projection" }),
    /形式/,
  );
  assert.match(
    calendar.problemText({ code: "data_binding_conflict" }),
    /一覧を更新/,
  );
  assert.match(
    calendar.problemText({ code: "data_port_not_connected" }),
    /ボードを選んでください/,
  );
  assert.match(calendar.problemText({}), /期限を読み取れませんでした/);
  assert.match(calendar.problemText({ code: "unknown_code" }), /unknown_code/);
});
