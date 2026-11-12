"use strict";
// Presentation preferences never enter the DataResource document.
window.TaskBoardViewState = {
  view: ["kanban", "tickets", "roadmap"].includes(
    new URL(location.href).searchParams.get("view"),
  )
    ? new URL(location.href).searchParams.get("view")
    : "kanban",
  screen: "tasks",
  status: "",
  project: "",
  sort: "priority",
  portFilter: "",
  group: "none",
  description: false,
  zoom: "month",
  anchor: new Date().toISOString().slice(0, 10),
  selected: null,
  roadmapMode: "wbs",
  planningAnchor: null,
  calendarDate: null,
  calendarScale: "month",
  wbsZoom: "month",
};
