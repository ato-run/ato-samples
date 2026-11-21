"use strict";

// DOM-free half of Calendar's board selection. resource-switcher-core.js is the
// bridge client and candidate/decision helper, copied unchanged from Task Board.
// This file decides what Calendar shows on start and what connecting means for
// an operation-only Port.
//
// Calendar owns no board: its Port lists exactly one operation,
// `todo_list_due_dates`. A connection therefore names only that operation, and
// only after the person chooses a board from the candidates. Nothing here picks
// a board on its own, and an unbound Port is a chooser, never an empty month.
(function (scope) {
  const core = scope.AtoTodoResourceCore;

  const PORT = "tasks";
  const OPERATION = "todo_list_due_dates";
  const UNCONNECTED_PROMPT =
    "このカレンダーはまだボードに接続されていません。期限を読み取るボードを選んでください。";
  const CONNECTED_NOTE =
    "共有された期限を読み取っています。このアプリはボードの写しを保存しません。";
  const FALLBACK_PROBLEM =
    "共有された期限を読み取れませんでした。もう一度お試しください。";
  const TRANSPORT_PROBLEM =
    "この実行環境ではボードを切り替えられません。";
  const PORT_NOT_DECLARED = "このアプリにはデータ接続が宣言されていません。";

  // Task Board's UI language, and its existing meaning: a revoked grant is not
  // an empty board, and the operation the owner must allow is named.
  const MESSAGES = {
    data_port_not_connected: UNCONNECTED_PROMPT,
    data_access_revoked:
      "このデータへのアクセスが変わりました。続けるには再読み込みしてください。",
    data_actor_changed:
      "別のアカウントでサインインしているため、このデータへのアクセスが変わりました。続けるには再読み込みしてください。",
    operation_not_granted:
      "データの所有者がこのアプリに期限の読み取りを許可していません。todo_list_due_dates の許可を依頼してください。",
    unsupported_projection:
      "このデータはこのアプリが理解できる形式ではありません。表示できるものがないだけで、データは変更されていません。",
    data_binding_conflict:
      "ボードの状態が変わりました。一覧を更新してもう一度お試しください。",
    data_grant_required: "このボードへのアクセス権がありません。",
    data_port_unavailable: "このボードはこのアプリに接続できません。",
    data_resource_unavailable: "このボードを読み込めませんでした。",
  };

  // The groups the picker shows, in Task Board's order and words.
  const SECTIONS = [
    { key: "current", title: "現在のボード" },
    { key: "personal", title: "自分のボード" },
    { key: "team", title: "チームのボード" },
    { key: "other", title: "その他のボード" },
  ];

  function errorCode(error) {
    return error && error.code ? String(error.code) : "";
  }

  function problemText(error) {
    const code = errorCode(error);
    if (code && MESSAGES[code]) return MESSAGES[code];
    if (code) return "期限を読み取れませんでした（" + code + "）。";
    return FALLBACK_PROBLEM;
  }

  function boardNameOf(binding) {
    return binding &&
      typeof binding.display_name === "string" &&
      binding.display_name
      ? binding.display_name
      : "ボード";
  }

  function isConflict(error) {
    return (
      !!error &&
      (error.status === 409 || error.code === "data_binding_conflict")
    );
  }

  /**
   * The candidate row carries the epoch the connect call has to echo back so a
   * stale chooser cannot overwrite a binding the person made elsewhere.
   */
  async function refreshedEpoch(bridge, port, resourceId) {
    try {
      const payload = await bridge.candidates(port, "read");
      const resources =
        payload && Array.isArray(payload.resources) ? payload.resources : [];
      for (const resource of resources) {
        if (resource && resource.resource_id === resourceId)
          return core.candidateEpoch(resource);
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function connectBody(resourceId, epoch, operation) {
    // Operation-only Port: the connect API takes access "read" or "write";
    // Calendar only reads, and names the one operation the Port declares.
    return {
      resource_id: resourceId,
      expected_epoch: epoch,
      access: "read",
      operations: [operation],
    };
  }

  /**
   * Bind the operation-only Port to one Resource. A 409 is what the server
   * returns for a stale expected_epoch, so the epoch is refreshed once from the
   * candidates list and the same connect is retried. There is deliberately no
   * read/write fallback: this Port cannot read or write the document at all.
   */
  async function connectPort(bridge, port, operation, options) {
    const settings = options && typeof options === "object" ? options : {};
    const resourceId =
      typeof settings.resourceId === "string" ? settings.resourceId : "";
    if (!resourceId) throw core.dataBridgeError("data_resource_required");
    let epoch =
      typeof settings.expectedEpoch === "number" &&
      Number.isFinite(settings.expectedEpoch) &&
      settings.expectedEpoch >= 0
        ? settings.expectedEpoch
        : 0;
    const attempt = function () {
      return bridge.connect(port, connectBody(resourceId, epoch, operation));
    };
    try {
      return await attempt();
    } catch (first) {
      if (!isConflict(first)) throw first;
      const next = await refreshedEpoch(bridge, port, resourceId);
      if (next === null || next === epoch) throw first;
      epoch = next;
      return await attempt();
    }
  }

  function chooserSections(view) {
    const sections = [];
    for (const section of SECTIONS) {
      const entries =
        view && Array.isArray(view[section.key]) ? view[section.key] : [];
      if (entries.length)
        sections.push({
          key: section.key,
          title: section.title,
          entries: entries,
        });
    }
    return sections;
  }

  function blankState() {
    return {
      kind: "loading",
      binding: null,
      boardName: "",
      prompt: "",
      note: "",
      notice: "",
      problem: "",
      busy: false,
      candidates: null,
      candidatesLoading: false,
      candidatesError: "",
      canDisconnect: false,
    };
  }

  /**
   * The observable state machine behind the header. The DOM (calendar-switcher.js)
   * renders `onChange`; `onBound` is the calendar reading its events and
   * `onUnbound` is it clearing them. Tests drive the same callbacks with a
   * fake bridge.
   */
  function createController(options) {
    const settings = options && typeof options === "object" ? options : {};
    const bridge = settings.bridge;
    const port =
      typeof settings.port === "string" && settings.port ? settings.port : PORT;
    const operation =
      typeof settings.operation === "string" && settings.operation
        ? settings.operation
        : OPERATION;
    const onChange =
      typeof settings.onChange === "function" ? settings.onChange : function () {};
    const onBound =
      typeof settings.onBound === "function" ? settings.onBound : function () {};
    const onUnbound =
      typeof settings.onUnbound === "function" ? settings.onUnbound : function () {};
    let state = blankState();

    function snapshot() {
      return Object.assign({}, state);
    }

    function emit() {
      onChange(snapshot());
      return snapshot();
    }

    function set(next) {
      state = Object.assign(blankState(), next);
      return emit();
    }

    function chooserState(patch) {
      return Object.assign(
        { kind: "chooser", prompt: UNCONNECTED_PROMPT },
        patch && typeof patch === "object" ? patch : {},
      );
    }

    function planOf(requirements) {
      return core.startupPlan(requirements, port, null);
    }

    // What the platform answers after a connect is what decides the new state;
    // a successful POST is not itself a binding.
    function boundFrom(requirements) {
      const plan = planOf(requirements);
      return plan.kind === "bound" ? plan.binding : null;
    }

    /** Re-read the platform: bound (read), unbound (chooser) or an error. */
    async function start(startOptions) {
      if (state.busy) return snapshot();
      const opts =
        startOptions && typeof startOptions === "object" ? startOptions : {};
      const notice = typeof opts.notice === "string" ? opts.notice : "";
      state = Object.assign(blankState(), {
        kind: "loading",
        busy: true,
        notice: notice,
      });
      emit();
      let requirements = null;
      try {
        requirements = await bridge.requirements();
      } catch (error) {
        onUnbound("error");
        return set({
          kind: "error",
          notice: notice,
          problem: core.isBridgeUnavailable(error)
            ? TRANSPORT_PROBLEM
            : problemText(error),
        });
      }
      const plan = planOf(requirements);
      if (plan.kind === "error") {
        onUnbound("error");
        return set({
          kind: "error",
          notice: notice,
          problem: PORT_NOT_DECLARED,
        });
      }
      if (plan.kind === "bound") {
        const binding = plan.binding;
        const next = set({
          kind: "bound",
          binding: binding,
          boardName: boardNameOf(binding),
          note: CONNECTED_NOTE,
          canDisconnect: true,
          notice: notice,
        });
        onBound(binding);
        return next;
      }
      onUnbound("unbound");
      return set(chooserState({ notice: notice }));
    }

    /** The boards the person may choose. Never fetched to auto-select one. */
    async function loadCandidates() {
      state = Object.assign({}, state, {
        candidatesLoading: true,
        candidatesError: "",
      });
      emit();
      try {
        const payload = await bridge.candidates(port, "read");
        state = Object.assign({}, state, {
          candidates: core.chooserView(payload, {
            currentResourceId: state.binding ? state.binding.resource_id : "",
            binding: state.binding,
          }),
          candidatesLoading: false,
          candidatesError: "",
        });
      } catch (error) {
        state = Object.assign({}, state, {
          candidates: null,
          candidatesLoading: false,
          candidatesError: core.isBridgeUnavailable(error)
            ? TRANSPORT_PROBLEM
            : problemText(error),
        });
      }
      return emit();
    }

    /** One explicit choice: bind the Port, then read the events it exposes. */
    async function connect(resourceId, expectedEpoch) {
      if (state.busy) return snapshot();
      const id = typeof resourceId === "string" ? resourceId : "";
      if (!id) {
        state = Object.assign({}, state, {
          candidatesError: "接続するボードを選んでください。",
        });
        return emit();
      }
      state = Object.assign({}, state, { busy: true, candidatesError: "" });
      emit();
      try {
        await connectPort(bridge, port, operation, {
          resourceId: id,
          expectedEpoch: expectedEpoch,
        });
      } catch (error) {
        state = Object.assign({}, state, {
          busy: false,
          candidatesError: core.isBridgeUnavailable(error)
            ? TRANSPORT_PROBLEM
            : problemText(error),
        });
        return emit();
      }
      let requirements = null;
      try {
        requirements = await bridge.requirements();
      } catch (error) {
        state = Object.assign({}, state, {
          busy: false,
          candidatesError: problemText(error),
        });
        return emit();
      }
      const binding = boundFrom(requirements);
      if (!binding) {
        state = Object.assign({}, state, {
          busy: false,
          candidates: null,
          candidatesError:
            "ボードを接続できませんでした。一覧を更新してもう一度お試しください。",
        });
        return emit();
      }
      const next = set({
        kind: "bound",
        binding: binding,
        boardName: boardNameOf(binding),
        note: CONNECTED_NOTE,
        canDisconnect: true,
      });
      onBound(binding);
      return next;
    }

    /** Forget the binding; the calendar clears its events with it. */
    async function disconnect() {
      if (state.busy || !state.binding) return snapshot();
      state = Object.assign({}, state, { busy: true, candidatesError: "" });
      emit();
      try {
        await bridge.disconnect(port, {});
      } catch (error) {
        state = Object.assign({}, state, {
          busy: false,
          candidatesError: core.isBridgeUnavailable(error)
            ? TRANSPORT_PROBLEM
            : problemText(error),
        });
        return emit();
      }
      onUnbound("disconnected");
      return set(chooserState());
    }

    return {
      port: port,
      operation: operation,
      start: start,
      loadCandidates: loadCandidates,
      connect: connect,
      disconnect: disconnect,
      current: snapshot,
    };
  }

  const api = {
    PORT: PORT,
    OPERATION: OPERATION,
    UNCONNECTED_PROMPT: UNCONNECTED_PROMPT,
    CONNECTED_NOTE: CONNECTED_NOTE,
    MESSAGES: MESSAGES,
    createBridge: core.createBridge,
    createController: createController,
    connectPort: connectPort,
    connectBody: connectBody,
    problemText: problemText,
    chooserSections: chooserSections,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  scope.AtoCalendarCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
