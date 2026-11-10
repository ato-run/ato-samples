function beginTouchDrag(event, kind, id) {
  if (event.pointerType === "mouse") return;
  const handle = event.currentTarget;
  const source =
    kind === "task"
      ? handle.closest(".task-card")
      : handle.closest(".subtask-row");
  if (!source) return;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let activated = false;
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
    };
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
    const x = e.clientX;
    const y = e.clientY;
    touchDrag.ghost.style.left = `${Math.min(window.innerWidth - touchDrag.ghost.offsetWidth - 6, Math.max(6, x - touchDrag.offsetX))}px`;
    touchDrag.ghost.style.top = `${Math.min(window.innerHeight - 50, Math.max(6, y - touchDrag.offsetY))}px`;
    touchDrag.ghost.style.display = "none";
    const under = document.elementFromPoint(x, y);
    touchDrag.ghost.style.display = "";
    clearDropMarkers();
    if (kind === "task") {
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
      else if (kind === "subtask")
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
  touchDrag.source?.classList.remove("dragging");
  touchDrag.ghost?.remove();
  document.body.style.userSelect = "";
  clearDropMarkers();
  touchDrag = null;
  applyPendingRemoteIfAny();
}
