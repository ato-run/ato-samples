import { boardDocument, getTodo, listTodos, replaceBoard } from "./todo.js";

export function listSharedTasks({ state }) {
  const { result: board } = boardDocument({ state });
  const { result } = listTodos({ state });
  const tasks = result.tasks
    .filter((task) => board.tasks[task.id]?.shared === true && !task.archived)
    .map((task) => ({
      task_id: task.id,
      number: task.number,
      title: task.title,
      status: task.column_id,
      due_at: task.due_at,
    }));
  return { operations: [], result: { tasks } };
}

export function setTaskSharing({ arguments: args, state }) {
  const { result: board } = boardDocument({ state });
  const { result: { task: { id } } } = getTodo({ arguments: { id: args.id }, state });
  const task = board.tasks[id];
  task.shared = args.shared;
  if (args.shared) task.sharedAt = args.at;
  else delete task.sharedAt;

  const { operations, result } = replaceBoard({
    arguments: { board, at: args.at },
    state,
  });
  return {
    operations,
    result: {
      task_id: id,
      shared: args.shared,
      revision: result.revision,
      updated_at: result.updated_at,
    },
  };
}
