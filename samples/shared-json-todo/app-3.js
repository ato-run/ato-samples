function beginTouchDrag(event, kind, id) {
  if (event.pointerType === "mouse" || event.isPrimary === false || touchDrag)
    return;
  const handle = event.target.closest(
    kind === "task" ? "[data-task-handle]" : "[data-sub-handle]",
  );
  if (!handle || handle.disabled) return;
  const source =
    kind === "task"
      ? handle.closest(".task-card")
      : handle.closest(".subtask-row");
  if (!source) return;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let activated = false;
  let pointerX = startX,
    pointerY = startY,
    scrollFrame = 0;
  let timer = setTimeout(() => activate(), 220);
  function activate() {
    if (activated) return;
    activated = true;
    navigator.vibrate?.(15);
    const rect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true);
    ghost.classList.add("touch-ghost");
    ghost.style.left = `${Math.max(8, rect.left)}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${Math.min(rect.width, window.innerWidth - 16)}px`;
    document.body.appendChild(ghost);
    source.classList.add("dragging");
    document.body.style.userSelect = "none";
    document.body.classList.add("touch-dragging");
    touchDrag = {
      kind,
      id,
      source,
      ghost,
      pointerId,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top,
      currentTargetId: null,
      currentColumnId: null,
      after: false,
      scrollFrame: 0,
    };
    if (kind === "task") scrollFrame = requestAnimationFrame(autoScroll);
  }
  function autoScroll() {
    if (!touchDrag) return;
    const scroll = document.querySelector(".board-scroll"),
      bounds = scroll.getBoundingClientRect();
    const speed = (position, start, end) =>
      position > end - 36
        ? Math.min(14, (position - end + 36) / 2)
        : position < start + 36
          ? -Math.min(14, (start + 36 - position) / 2)
          : 0;
    const previousX = scroll.scrollLeft,
      previousY = scroll.scrollTop;
    scroll.scrollLeft += speed(pointerX, bounds.left, bounds.right);
    scroll.scrollTop += speed(pointerY, bounds.top, bounds.bottom);
    if (previousX !== scroll.scrollLeft || previousY !== scroll.scrollTop)
      updateTarget(pointerX, pointerY);
    scrollFrame = requestAnimationFrame(autoScroll);
    touchDrag.scrollFrame = scrollFrame;
  }
  function move(e) {
    if (e.pointerId !== pointerId) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!activated && dist > 10) {
      clearTimeout(timer);
      cleanupListeners();
      return;
    }
    if (!activated || !touchDrag) return;
    e.preventDefault();
    pointerX = e.clientX;
    pointerY = e.clientY;
    updateTarget(pointerX, pointerY);
  }
  function updateTarget(x, y) {
    if (!touchDrag) return;
    touchDrag.ghost.style.left = `${Math.min(window.innerWidth - touchDrag.ghost.offsetWidth - 6, Math.max(6, x - touchDrag.offsetX))}px`;
    touchDrag.ghost.style.top = `${Math.min(window.innerHeight - 50, Math.max(6, y - touchDrag.offsetY))}px`;
    touchDrag.ghost.style.display = "none";
    const under = document.elementFromPoint(x, y);
    touchDrag.ghost.style.display = "";
    clearDropMarkers();
    if (kind === "task") {
      touchDrag.currentColumnId = null;
      touchDrag.currentTargetId = null;
      const column = under?.closest(".column");
      const card = under?.closest(".task-card");
      if (column) {
        column.classList.add("drop-target");
        touchDrag.currentColumnId = column.dataset.columnId;
        touchDrag.currentTargetId = null;
        touchDrag.after = false;
        if (card && card.dataset.taskId !== id) {
          const rect = card.getBoundingClientRect();
          touchDrag.after = y > rect.top + rect.height / 2;
          touchDrag.currentTargetId = card.dataset.taskId;
          card.classList.add(touchDrag.after ? "drop-after" : "drop-before");
        }
      }
    } else {
      const row = under?.closest(".subtask-row");
      touchDrag.currentTargetId = null;
      touchDrag.after = false;
      touchDrag.validDrop = !!under?.closest("#subtaskList");
      if (row && row.dataset.subtaskId !== id) {
        const rect = row.getBoundingClientRect();
        touchDrag.after = y > rect.top + rect.height / 2;
        touchDrag.currentTargetId = row.dataset.subtaskId;
        row.classList.add(touchDrag.after ? "drop-after" : "drop-before");
      }
    }
  }
  function end(e) {
    if (e.pointerId !== pointerId) return;
    clearTimeout(timer);
    if (activated && touchDrag) {
      if (kind === "task" && touchDrag.currentColumnId)
        moveTask(
          id,
          touchDrag.currentColumnId,
          touchDrag.currentTargetId,
          touchDrag.after,
        );
      else if (kind === "subtask" && touchDrag.validDrop)
        moveDraftSubtask(id, touchDrag.currentTargetId, touchDrag.after);
      finishTouchDrag();
    }
    cleanupListeners();
  }
  function cancel(e) {
    if (e.pointerId !== pointerId) return;
    clearTimeout(timer);
    if (activated) finishTouchDrag();
    cleanupListeners();
  }
  function cleanupListeners() {
    cancelAnimationFrame(scrollFrame);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", end, true);
    window.removeEventListener("pointercancel", cancel, true);
  }
  window.addEventListener("pointermove", move, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointerup", end, true);
  window.addEventListener("pointercancel", cancel, true);
}

function finishTouchDrag() {
  if (!touchDrag) return;
  cancelAnimationFrame(touchDrag.scrollFrame);
  document.body.classList.remove("touch-dragging");
  touchDrag.source?.classList.remove("dragging");
  touchDrag.ghost?.remove();
  document.body.style.userSelect = "";
  clearDropMarkers();
  touchDrag = null;
  applyPendingRemoteIfAny();
}
