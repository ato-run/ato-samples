"use strict";

// In-app board selection (DESIGN.md 4). The header shows the board this
// instance is bound to; opening it lists the boards the person may use and
// "create a new board". The platform never picks a Resource for the app, so
// every switch here is one explicit user action and one explicit Binding.
// The decision logic and the bridge client live in resource-switcher-core.js.
(function installBoardSwitcher() {
  const core = window.AtoTodoResourceCore;
  if (!core) return;
  // Port name declared in ato.data.toml (protocol todo.board@1).
  const PORT_NAME = "tasks";
  const BRIDGE = core.createBridge({});
  const MESSAGES = {
    data_binding_conflict:
      "ボードの状態が変わりました。一覧を更新してもう一度お試しください。",
    data_grant_required: "このボードへのアクセス権がありません。",
    data_port_unavailable: "このボードはこのアプリに接続できません。",
    data_resource_unavailable: "このボードを読み込めませんでした。",
    data_resource_create_invalid: "ボードを作成できませんでした。",
  };

  const dom = {
    header: document.querySelector(".board-header"),
    button: document.getElementById("boardSwitcherBtn"),
    name: document.getElementById("boardSwitcherName"),
    badge: document.getElementById("boardAccessBadge"),
    panel: document.getElementById("boardSwitcherPanel"),
    body: document.getElementById("boardSwitcherBody"),
  };
  if (!dom.header || !dom.button || !dom.panel || !dom.body) return;

  let requirements = null;
  let binding = null;
  let access = "read_write";
  let view = null;
  let open = false;
  let loading = false;
  let errorText = "";
  let draftName = "";
  let unavailable = false;

  window.__atoBoardReadOnly = false;

  function messageFor(error) {
    const code = error && error.code ? String(error.code) : "";
    return (
      MESSAGES[code] ||
      "ボードを切り替えられませんでした（" + (code || "unknown") + "）"
    );
  }

  function setHeaderName(name) {
    dom.name.textContent = name || "ボード未選択";
  }

  function setBadge() {
    dom.badge.hidden = access !== "read";
  }

  function note(text, className) {
    const p = document.createElement("p");
    p.className = className || "board-panel-note";
    p.textContent = text;
    return p;
  }

  function degrade(reason) {
    unavailable = true;
    dom.button.disabled = true;
    dom.button.title = "この実行環境ではボードを切り替えられません";
    dom.button.classList.add("is-unavailable");
    setHeaderName("Task Board");
    dom.badge.hidden = true;
    setOpen(false);
    console.warn("board switcher unavailable:", reason || "resource bridge");
  }

  async function loadRequirements() {
    try {
      return await BRIDGE.requirements();
    } catch (error) {
      if (core.isBridgeUnavailable(error)) return null;
      throw error;
    }
  }

  // Reload the board from the Resource behind the Port. A failed read keeps the
  // app's error state; it is never rendered as an empty board.
  async function reloadBoard() {
    window.__atoBoardReadOnly = access === "read";
    if (typeof refreshBoard !== "function") return false;
    const loaded = await refreshBoard();
    if (loaded) {
      state = loadState();
      render();
      return true;
    }
    if (window.__atoBoardStatus === "error") return false;
    // The Port says the instance is connected but the document did not load,
    // or the binding disappeared between the two calls.
    const fresh = await loadRequirements().catch(() => null);
    if (!fresh) return false;
    const plan = core.startupPlan(fresh, PORT_NAME, null);
    if (plan.kind === "bound") {
      binding = plan.binding;
      access = core.accessOf(plan.binding);
      setBadge();
      window.__atoBoardStatus = "error";
      window.__atoBoardError =
        window.__atoBoardError || "data_resource_unavailable";
      render();
      return false;
    }
    await applyPlan(fresh, { reload: false, autoOpen: true });
    return false;
  }

  async function applyPlan(payload, options) {
    requirements = payload;
    const plan = core.startupPlan(payload, PORT_NAME, core.readHint(window.localStorage));
    if (plan.kind === "error") {
      degrade("data_port_not_declared");
      return;
    }
    if (plan.kind === "bound") {
      binding = plan.binding;
      access = core.accessOf(plan.binding);
      setHeaderName(plan.binding.display_name || "ボード");
      setBadge();
      // The platform's answer, not the remembered id, is what gets remembered.
      core.writeHint(window.localStorage, {
        resource_id: plan.binding.resource_id,
        display_name: plan.binding.display_name || "",
      });
      if (options.reload) await reloadBoard();
      return;
    }
    binding = null;
    access = "read_write";
    setHeaderName("ボード未選択");
    setBadge();
    if (options.reload) await reloadBoard();
    if (options.autoOpen) await openPanel();
  }

  async function start() {
    let payload = null;
    try {
      payload = await loadRequirements();
    } catch (error) {
      window.__atoBoardStatus = "error";
      window.__atoBoardError = (error && error.code) || "data_bridge_failed";
      render();
      degrade(error && error.code);
      return;
    }
    if (!payload) {
      degrade("data_bridge_unavailable");
      return;
    }
    await applyPlan(payload, { reload: true, autoOpen: true });
  }

  function setOpen(next) {
    open = !!next;
    dom.panel.hidden = !open;
    dom.button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderPanel();
  }

  async function openPanel() {
    if (unavailable) return;
    setOpen(true);
    await loadCandidates();
  }

  async function loadCandidates() {
    loading = true;
    errorText = "";
    renderPanel();
    try {
      const payload = await BRIDGE.candidates(PORT_NAME, "read");
      view = core.chooserView(payload, {
        currentResourceId: binding ? binding.resource_id : "",
        binding: binding,
      });
    } catch (error) {
      if (core.isBridgeUnavailable(error)) {
        degrade(error && error.code);
        return;
      }
      view = null;
      errorText = messageFor(error);
    } finally {
      loading = false;
      renderPanel();
    }
  }

  function optionButton(entry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-option";
    button.dataset.resourceId = entry.resource_id;
    if (entry.is_current) button.setAttribute("aria-current", "true");
    const name = document.createElement("span");
    name.className = "board-option-name";
    name.textContent = entry.display_name || "名称未設定のボード";
    button.appendChild(name);
    if (entry.is_current) {
      const badge = document.createElement("span");
      badge.className = "board-option-badge";
      badge.textContent = "使用中";
      button.appendChild(badge);
    }
    button.addEventListener("click", function () {
      selectBoard(entry);
    });
    return button;
  }

  function section(title, entries) {
    if (!entries || !entries.length) return null;
    const box = document.createElement("div");
    box.className = "board-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    box.appendChild(heading);
    for (const entry of entries) box.appendChild(optionButton(entry));
    return box;
  }

  function createSection() {
    const box = document.createElement("div");
    box.className = "board-section board-create";
    const heading = document.createElement("h3");
    heading.textContent = "新しいボードを作成";
    const row = document.createElement("div");
    row.className = "board-create-row";
    const input = document.createElement("input");
    input.id = "newBoardName";
    input.className = "control";
    input.maxLength = 200;
    input.placeholder = "ボード名";
    input.value = draftName;
    input.addEventListener("input", function () {
      draftName = input.value;
    });
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") createBoard(input.value);
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    button.textContent = "作成";
    button.disabled = loading;
    button.addEventListener("click", function () {
      createBoard(input.value);
    });
    row.append(input, button);
    box.append(heading, row);
    return box;
  }

  function errorBlock() {
    const box = document.createElement("div");
    box.className = "board-panel-error";
    box.setAttribute("role", "alert");
    box.appendChild(note(errorText, "board-panel-error-text"));
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary";
    retry.textContent = "一覧を更新";
    retry.disabled = loading;
    retry.addEventListener("click", function () {
      loadCandidates();
    });
    box.appendChild(retry);
    return box;
  }

  function renderPanel() {
    if (!open) return;
    const body = dom.body;
    body.innerHTML = "";
    if (unavailable) {
      body.appendChild(note("この実行環境ではボードを切り替えられません。"));
      return;
    }
    if (loading) {
      body.appendChild(note("ボード一覧を読み込み中…"));
      return;
    }
    if (errorText) body.appendChild(errorBlock());
    if (!view) {
      if (!errorText) body.appendChild(note("ボード一覧を取得できませんでした。"));
      return;
    }
    const hint = core.readHint(window.localStorage);
    if (hint && !view.current.length) {
      body.appendChild(
        note(
          "前回のボード「" +
            (hint.display_name || hint.resource_id) +
            "」は利用できません。",
        ),
      );
    }
    let rendered = 0;
    for (const group of [
      section("現在のボード", view.current),
      section("個人ボード", view.personal),
      section("チームボード", view.team),
      section("その他のボード", view.other),
    ]) {
      if (!group) continue;
      body.appendChild(group);
      rendered += 1;
    }
    if (!rendered) body.appendChild(note("接続できるボードがありません。"));
    body.appendChild(createSection());
  }

  async function bindAndLoad(resourceId, expectedEpoch, displayName) {
    await core.connectBoard(BRIDGE, PORT_NAME, {
      resourceId: resourceId,
      expectedEpoch: expectedEpoch,
    });
    // What the binding actually got is read back, not assumed from the request.
    const fresh = await BRIDGE.requirements();
    const plan = core.startupPlan(fresh, PORT_NAME, null);
    if (plan.kind !== "bound") throw core.dataBridgeError("data_binding_conflict");
    requirements = fresh;
    binding = plan.binding;
    access = core.accessOf(plan.binding);
    window.__atoBoardReadOnly = access === "read";
    setHeaderName(plan.binding.display_name || displayName || "ボード");
    setBadge();
    core.writeHint(window.localStorage, {
      resource_id: plan.binding.resource_id,
      display_name: plan.binding.display_name || displayName || "",
    });
    draftName = "";
    const loaded = await reloadBoard();
    if (!loaded) {
      errorText = "ボードを読み込めませんでした。一覧から別のボードを選ぶか、再試行してください。";
      return;
    }
    setOpen(false);
    if (access === "read") toast("読み取り専用のボードとして接続しました");
  }

  async function handleActionError(error) {
    if (core.isBridgeUnavailable(error)) {
      degrade(error && error.code);
      return;
    }
    if (error && error.code === "data_binding_conflict") view = null;
    errorText = messageFor(error);
  }

  async function selectBoard(entry) {
    if (!entry || loading) return;
    if (entry.is_current) {
      setOpen(false);
      return;
    }
    loading = true;
    errorText = "";
    renderPanel();
    try {
      await bindAndLoad(entry.resource_id, entry.expected_epoch, entry.display_name);
    } catch (error) {
      await handleActionError(error);
    } finally {
      loading = false;
      renderPanel();
    }
  }

  async function createBoard(rawName) {
    if (loading) return;
    const displayName = String(rawName || "").trim();
    draftName = displayName;
    if (!displayName) {
      errorText = "ボード名を入力してください。";
      renderPanel();
      return;
    }
    loading = true;
    errorText = "";
    renderPanel();
    try {
      const created = await BRIDGE.createResource({
        display_name: displayName,
        document: core.newBoardDocument(
          new Date().toISOString(),
          typeof DEFAULT_COLUMNS !== "undefined" ? DEFAULT_COLUMNS : undefined,
        ),
      });
      const resourceId =
        created && (created.resource_id || created.id)
          ? created.resource_id || created.id
          : "";
      if (!resourceId) throw core.dataBridgeError("data_resource_create_invalid");
      const epoch =
        typeof created.expected_epoch === "number"
          ? created.expected_epoch
          : typeof created.access_epoch === "number"
            ? created.access_epoch
            : typeof created.revision === "number"
              ? created.revision
              : 0;
      await bindAndLoad(resourceId, epoch, displayName);
    } catch (error) {
      await handleActionError(error);
    } finally {
      loading = false;
      renderPanel();
    }
  }

  dom.button.addEventListener("click", function () {
    if (unavailable) return;
    if (open) setOpen(false);
    else openPanel();
  });
  document.addEventListener("click", function (event) {
    if (!open) return;
    if (dom.header.contains(event.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (!open || event.key !== "Escape") return;
    setOpen(false);
    dom.button.focus();
  });

  setTimeout(start, 0);
})();
