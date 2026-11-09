// Calendar consumes only the due-date projection. It never reads the board
// document: the Port lists one observation operation and the grant lists the
// same one.
async function load() {
  const status = document.getElementById("status");
  const list = document.getElementById("due");
  const result = await atoDataPorts.invoke(
    "tasks",
    "todo_list_due_dates",
    {},
    crypto.randomUUID(),
  );
  const tasks = (result && result.result && result.result.tasks) || [];
  for (const task of tasks) {
    const item = document.createElement("li");
    item.dataset.taskId = String(task.task_id);
    item.textContent = String(task.title) + " " + String(task.due_at);
    list.append(item);
  }
  status.textContent = "共有された期日: " + tasks.length;
}
load().catch((error) => {
  document.getElementById("status").textContent =
    "期日を取得できません: " + String(error && error.code);
});
