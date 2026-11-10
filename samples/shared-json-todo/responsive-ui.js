"use strict";
// Responsive layout and focus only. Never reads or commits a board document.
(function () {
  const narrow = matchMedia("(max-width: 1199px)"),
    mobile = matchMedia("(max-width: 767px)");
  const rail = document.querySelector(".workspace-rail"),
    toggle = document.getElementById("railToggle");
  const scrim = document.getElementById("navigationScrim"),
    content = document.querySelector(".workspace-content");
  const menus = [...document.querySelectorAll(".view-options details")];
  const presentation = document.querySelector(".view-presentation"),
    display = document.querySelector(".display-fields");
  const settings = [
    document.getElementById("groupSelect").closest("label"),
    document.getElementById("sortSelect").closest("label"),
  ];
  let navigationOpen = false;
  const focusable = () =>
    [...rail.querySelectorAll("button")].filter(
      (button) => !button.disabled && button.getClientRects().length,
    );
  function setNavigation(open, restoreFocus = true) {
    navigationOpen = narrow.matches && open;
    document.body.classList.toggle("nav-open", navigationOpen);
    scrim.hidden = !navigationOpen;
    const editorOpen = document
      .getElementById("modalBackdrop")
      .classList.contains("open");
    content.inert = navigationOpen || editorOpen;
    rail.inert = editorOpen;
    if (navigationOpen) {
      rail.setAttribute("role", "dialog");
      rail.setAttribute("aria-modal", "true");
      focusable()[1]?.focus();
    } else {
      rail.removeAttribute("role");
      rail.removeAttribute("aria-modal");
      if (restoreFocus && !editorOpen) toggle.focus();
    }
    update();
  }
  function update() {
    const expanded = narrow.matches
      ? navigationOpen
      : !document.body.classList.contains("rail-collapsed");
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute(
      "aria-label",
      expanded ? "ナビゲーションを閉じる" : "ナビゲーションを開く",
    );
    toggle.title = toggle.getAttribute("aria-label");
    const footer = document.querySelector(".rail-footer"),
      sync = document.getElementById("syncLabel").textContent;
    footer.title = sync;
    footer.setAttribute("aria-label", sync);
    window.TaskBoardKanbanPosition?.render();
    sizeKanban();
  }
  function layoutSettings() {
    const target = mobile.matches ? display : presentation;
    if (mobile.matches)
      [...settings].reverse().forEach((label) => target.prepend(label));
    else settings.forEach((label) => target.append(label));
    menus.forEach((menu) => {
      menu.open = false;
    });
    setNavigation(false, false);
  }
  toggle.addEventListener("click", () => {
    if (narrow.matches) setNavigation(!navigationOpen);
    else {
      document.body.classList.toggle("rail-collapsed");
      update();
    }
  });
  scrim.addEventListener("click", () => setNavigation(false));
  for (const menu of menus)
    menu.addEventListener("toggle", () => {
      if (menu.open)
        menus
          .filter((other) => other !== menu)
          .forEach((other) => {
            other.open = false;
          });
    });
  document.addEventListener("pointerdown", (event) => {
    for (const menu of menus)
      if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented) return;
      if (navigationOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setNavigation(false);
          return;
        }
        if (event.key === "Tab") {
          const items = focusable(),
            first = items[0],
            last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      } else if (event.key === "Escape") {
        const open = menus.find((menu) => menu.open);
        if (open) {
          event.preventDefault();
          open.open = false;
          open.querySelector("summary").focus();
        }
      }
    },
    true,
  );
  function sizeKanban() {
    const board = document.getElementById("kanbanView");
    if (board.getClientRects().length)
      document.documentElement.style.setProperty(
        "--kanban-top",
        Math.ceil(board.getBoundingClientRect().top + window.scrollY) + "px",
      );
  }
  const visualHeight = () => {
    document.documentElement.style.setProperty(
      "--visual-height",
      Math.round(window.visualViewport?.height || innerHeight) + "px",
    );
    sizeKanban();
  };
  const toolbarSize = new ResizeObserver(sizeKanban);
  toolbarSize.observe(document.querySelector(".toolbar"));
  toolbarSize.observe(document.querySelector(".view-options"));
  window.visualViewport?.addEventListener("resize", visualHeight);
  window.addEventListener("resize", visualHeight, { passive: true });
  narrow.addEventListener("change", () => setNavigation(false, false));
  mobile.addEventListener("change", layoutSettings);
  window.TaskBoardResponsive = Object.freeze({
    update,
    closeNavigation: (restore) => setNavigation(false, restore),
  });
  layoutSettings();
  visualHeight();
  update();
})();
