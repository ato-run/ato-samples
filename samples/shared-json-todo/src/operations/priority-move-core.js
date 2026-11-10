// Versioned private Operation composition. One existing move, one atomic commit.
const KEY = "ato.task-board.state.v1";
export function prioritizedMove(move, input) {
  const args = input.arguments,
    documentState = Object.hasOwn(input.state || {}, "document"),
    before = documentState
      ? input.state.document
      : JSON.parse(
          input.state?.local_storage?.find((entry) => entry.key === KEY)
            ?.value || "null",
        );
  if (
    !before?.tasks ||
    !Number.isInteger(args.expected_revision) ||
    args.expected_revision !== before.revision
  )
    throw new Error("Board revision conflict");
  if (!Object.hasOwn(before.tasks, args.id)) throw new Error("Invalid task");
  const source = before.tasks[args.id],
    target =
      args.target_id && Object.hasOwn(before.tasks, args.target_id)
        ? before.tasks[args.target_id]
        : null;
  if (
    args.target_id &&
    (!target || target.id === source.id || target.columnId !== args.column_id)
  )
    throw new Error("Move target is stale");
  const priority = (target ? target.priority : source.priority) ?? "none";
  if (!["high", "medium", "low", "none"].includes(priority))
    throw new Error("Invalid target priority");
  const output = move({
    ...input,
    arguments: {
      id: args.id,
      column_id: args.column_id,
      target_id: args.target_id,
      after: args.after,
      at: args.at,
      ...(args.expected_version === undefined
        ? {}
        : { expected_version: args.expected_version }),
    },
  });
  if (output.operations?.length !== 1) throw new Error("Invalid move result");
  const mutation = output.operations[0],
    encoded = typeof mutation.value === "string",
    next = encoded ? JSON.parse(mutation.value) : mutation.value,
    moved = next.tasks[source.id];
  moved.priority = priority;
  if (
    documentState &&
    priority !== source.priority &&
    (moved.editVersion || 0) <= (source.editVersion || 0)
  )
    moved.editVersion = (source.editVersion || 0) + 1;
  mutation.value = encoded ? JSON.stringify(next) : next;
  output.result.task.priority = priority;
  if (documentState) output.result.task.editVersion = moved.editVersion;
  output.result.priority_changed = source.priority !== priority;
  return output;
}
