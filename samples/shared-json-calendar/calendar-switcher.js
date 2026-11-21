"use strict";

// The DOM half of Calendar's board selection. The header says which board this
// calendar reads; the panel lists the boards the person may use (grouped like
// Task Board) and every switch is one explicit click. The platform never picks
// a Resource for the app, so an unbound Port shows a prompt and a button, not a
// board chosen on the person's behalf.
//
// The bridge client and decision logic live in resource-switcher-core.js and
// calendar-core.js; this file only renders their state and forwards clicks.
(function installCalendarSwitcher() {
  const core = window.AtoCalendarCore;
  if (!core) return;
  const BRIDGE = core.createBridge({});
  const dom = {
    header: document.querySelector(".board-header"),
    prompt: document.getElementById("boardPrompt"),
    button: document.getElementById("boardSwitcherBtn"),
    name: document.getElementById("boardSwitcherName"),
    panel: document.getElementById("boardSwitcherPanel"),
    body: document.getElementById("boardSwitcherBody"),
    where: document.getElementById("where"),
  };
  if (!dom.header || !dom.button || !dom.panel || !dom.body) return;

  let open = false;
  let controller = null;

  function note(text, className) {
    const p = document.createElement("p");
    p.className = className || "board-panel-note";
    p.textContent = text;
    return p;
  }

  function setOpen(next) {
    open = !!next;
    dom.panel.hidden = !open;
    dom.button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) renderPanel();
  }

  function setPrompt(text) {
    if (!dom.prompt) return;
    dom.prompt.hidden = !text;
    dom.prompt.textContent = text || "";
  }

  function setWhere(text) {
    if (!dom.where) return;
    dom.where.hidden = !text;
    dom.where.textContent = text || "";
  }

  function render(state) {
    const current =
      state || (controller ? controller.current() : { kind: "loading" });
    if (current.kind === "bound") {
      setPrompt("");
      dom.name.textContent = current.boardName || "ボード";
      dom.button.disabled = !!current.busy;
      setWhere(current.note || core.CONNECTED_NOTE);
    } else if (current.kind === "error") {
      setPrompt(current.problem || core.problemText({}));
      dom.name.textContent = "再試行";
      dom.button.disabled = !!current.busy;
      setWhere("");
    } else {
      const lines = [];
      if (current.notice) lines.push(current.notice);
      if (current.kind === "chooser")
        lines.push(current.prompt || core.UNCONNECTED_PROMPT);
      setPrompt(lines.join(" "));
      dom.name.textContent =
        current.kind === "loading" ? "読み込み中…" : "ボードを選ぶ";
      dom.button.disabled = current.kind === "loading" || !!current.busy;
      setWhere("");
    }
    // The panel stays open while its own state changes; onBound/onUnbound and
    // a successful choice are what close it.
    if (open) renderPanel();
  }

  function optionButton(entry, busy) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "board-option";
    button.dataset.resourceId = entry.resource_id;
    button.disabled = !!busy;
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
      choose(entry);
    });
    return button;
  }

  function section(title, entries, busy) {
    const box = document.createElement("div");
    box.className = "board-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    box.appendChild(heading);
    for (const entry of entries) box.appendChild(optionButton(entry, busy));
    return box;
  }

  function errorBlock(text) {
    const box = document.createElement("div");
    box.className = "board-panel-error";
    box.setAttribute("role", "alert");
    box.appendChild(note(text, "board-panel-error-text"));
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary";
    retry.textContent = "一覧を更新";
    retry.addEventListener("click", function () {
      if (controller) controller.loadCandidates();
    });
    box.appendChild(retry);
    return box;
  }

  function disconnectBlock() {
    const box = document.createElement("div");
    box.className = "board-disconnect";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "接続を解除";
    button.addEventListener("click", function () {
      if (controller) controller.disconnect();
    });
    box.appendChild(button);
    return box;
  }

  function renderPanel() {
    if (!open || !controller) return;
    const state = controller.current();
    const body = dom.body;
    body.innerHTML = "";
    if (state.candidatesLoading) {
      body.appendChild(note("ボード一覧を読み込み中…"));
      return;
    }
    if (state.candidatesError) {
      body.appendChild(errorBlock(state.candidatesError));
      if (state.binding) body.appendChild(disconnectBlock());
      return;
    }
    const view = state.candidates;
    if (!view) {
      body.appendChild(note("ボード一覧を取得できませんでした。"));
      if (state.binding) body.appendChild(disconnectBlock());
      return;
    }
    let rendered = 0;
    for (const group of core.chooserSections(view)) {
      body.appendChild(section(group.title, group.entries, !!state.busy));
      rendered += 1;
    }
    if (!rendered) body.appendChild(note("接続できるボードがありません。"));
    if (state.binding) body.appendChild(disconnectBlock());
  }

  async function choose(entry) {
    if (!entry || !controller) return;
    const state = controller.current();
    if (state.busy) return;
    if (entry.is_current) {
      setOpen(false);
      return;
    }
    const result = await controller.connect(
      entry.resource_id,
      entry.expected_epoch,
    );
    if (result && result.kind === "bound") setOpen(false);
    else if (open) renderPanel();
  }

  function openPanel() {
    setOpen(true);
    if (controller) controller.loadCandidates();
  }

  dom.button.addEventListener("click", function () {
    const state = controller ? controller.current() : null;
    if (state && state.kind === "error") {
      controller.start();
      return;
    }
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

  controller = core.createController({
    bridge: BRIDGE,
    onChange: render,
    onBound: function () {
      setOpen(false);
      if (window.AtoCalendarView) window.AtoCalendarView.load();
    },
    onUnbound: function () {
      setOpen(false);
      if (window.AtoCalendarView) window.AtoCalendarView.clear();
    },
  });

  // Access can change under a running calendar (revoked grant, another actor).
  // Re-read the platform instead of telling the person to reload: the chooser
  // is the app's own way to reconnect.
  function resync(reason) {
    if (!controller) return;
    controller.start({
      notice: reason ? core.problemText({ code: reason }) : "",
    });
  }

  window.AtoCalendarSwitcher = { resync: resync };
  window.addEventListener("ato:data-reset", function (event) {
    const reason = event && event.detail && event.detail.reason;
    resync(reason || "data_access_revoked");
  });

  render(controller.current());
  setTimeout(function () {
    controller.start();
  }, 0);
})();
