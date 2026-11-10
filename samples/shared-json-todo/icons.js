"use strict";
// One local, outlined icon vocabulary. No font glyphs or remote assets.
(function () {
  const paths = {
    panel:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M6 8h.01M6 12h.01"/>',
    tickets:
      '<rect x="6" y="6" width="15" height="15" rx="2"/><path d="M17 3H5a2 2 0 0 0-2 2v12M10 11h7M10 15h5"/>',
    kanban:
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M6 8v4M12 8v7M18 8v2"/>',
    roadmap:
      '<path d="M5 3v18M3 7h18M3 17h18"/><rect x="7" y="5" width="8" height="4" rx="1"/><rect x="12" y="15" width="8" height="4" rx="1"/>',
    projects:
      '<path d="M3 7h6l2-3h5l2 3h3v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 11h18"/>',
    archive:
      '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8M10 12h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    filter:
      '<path d="M4 6h16M7 12h10M10 18h4"/><circle cx="8" cy="6" r="2" fill="var(--panel)"/><circle cx="15" cy="12" r="2" fill="var(--panel)"/>',
    display:
      '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="var(--panel)"/><circle cx="16" cy="12" r="2" fill="var(--panel)"/><circle cx="10" cy="18" r="2" fill="var(--panel)"/>',
    calendar:
      '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 17h3"/>',
    subtasks:
      '<path d="m3 6 2 2 3-4M11 6h10M3 13h5M11 13h10M3 20h5M11 20h10"/>',
    repeat:
      '<path d="m17 2 4 4-4 4M3 11V8a2 2 0 0 1 2-2h16M7 22l-4-4 4-4M21 13v3a2 2 0 0 1-2 2H3"/>',
    todo: '<circle cx="12" cy="12" r="8"/>',
    pending: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    progress:
      '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
    done: '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
    high: '<path d="m6 13 6-6 6 6M6 19l6-6 6 6"/>',
    medium: '<path d="M6 9h12M6 15h12"/>',
    low: '<path d="m6 9 6 6 6-6"/>',
    none: '<path d="M6 12h12"/>',
    grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    deadline: '<path d="M6 21V3h12l-2 4 2 4H6"/>',
  };
  const icon = (name) =>
    '<svg class="ui-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    (Object.hasOwn(paths, name) ? paths[name] : paths.todo) +
    "</svg>";
  window.TaskBoardIcons = Object.freeze({ icon });
  document.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
})();
