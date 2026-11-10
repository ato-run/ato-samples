"use strict";
// Presentation only: column position comes from the rendered board, never saved data.
(function () {
  const board = document.getElementById("kanbanView"),
    mobile = matchMedia("(max-width: 767px)"),
    reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const indicator = document.createElement("div");
  indicator.className = "kanban-position";
  indicator.setAttribute("role", "group");
  indicator.setAttribute("aria-label", "Kanbanの列");
  const cursor = document.createElement("span"),
    announcement = document.createElement("span");
  cursor.className = "column-position-cursor";
  cursor.setAttribute("aria-hidden", "true");
  announcement.className = "visually-hidden";
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-atomic", "true");
  board.before(indicator);
  let columns = [],
    buttons = [],
    signature = "",
    frame = 0,
    timer = 0,
    selected = -1,
    lastAnnounced = "";
  const columnLeft = (column) =>
    column.getBoundingClientRect().left -
    board.getBoundingClientRect().left +
    board.scrollLeft;
  function position() {
    frame = 0;
    if (indicator.hidden || !columns.length) return;
    const start = columnLeft(columns[0]),
      step = columns.length > 1 ? columnLeft(columns[1]) - start : 1,
      progress = Math.max(
        0,
        Math.min(columns.length - 1, (board.scrollLeft - start) / step),
      );
    indicator.style.setProperty("--kanban-position", String(progress));
    const next = Math.round(progress);
    if (selected !== next) {
      selected = next;
      buttons.forEach((button, index) => {
        if (index === next) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
    }
  }
  function announce() {
    position();
    if (indicator.hidden || selected < 0) return;
    const label = buttons[selected].getAttribute("aria-label");
    if (label !== lastAnnounced) announcement.textContent = label;
    lastAnnounced = label;
  }
  function render() {
    columns = [...board.querySelectorAll(".column")];
    indicator.hidden = !mobile.matches || board.hidden || !columns.length;
    const labels = columns.map((column) => column.getAttribute("aria-label"));
    const next = JSON.stringify(labels);
    if (signature !== next) {
      signature = next;
      selected = -1;
      buttons = columns.map((column, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "column-step";
        button.textContent = labels[index];
        button.dataset.columnIndex = index;
        button.setAttribute(
          "aria-label",
          labels[index] + "、" + (index + 1) + " / " + columns.length + "列",
        );
        return button;
      });
      indicator.replaceChildren(...buttons, cursor, announcement);
      indicator.style.setProperty("--column-count", String(columns.length));
    }
    columns.forEach((column, index) => {
      column.id = "kanban-column-" + index;
      buttons[index].setAttribute("aria-controls", column.id);
    });
    position();
  }
  function go(index) {
    const column = columns[index];
    if (!column) return;
    board.scrollTo({
      left: columnLeft(column),
      behavior: reduced.matches ? "auto" : "smooth",
    });
  }
  indicator.addEventListener("click", (event) => {
    const button = event.target.closest("[data-column-index]");
    if (button) go(Number(button.dataset.columnIndex));
  });
  indicator.addEventListener("keydown", (event) => {
    const button = event.target.closest("[data-column-index]");
    if (
      !button ||
      !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    const index = Number(button.dataset.columnIndex),
      next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : Math.max(
                0,
                Math.min(
                  buttons.length - 1,
                  index + (event.key === "ArrowRight" ? 1 : -1),
                ),
              );
    buttons[next].focus();
    go(next);
  });
  board.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(position);
      clearTimeout(timer);
      timer = setTimeout(announce, 160);
    },
    { passive: true },
  );
  board.addEventListener("scrollend", announce);
  new ResizeObserver(position).observe(board);
  window.TaskBoardKanbanPosition = Object.freeze({ render });
  render();
})();
