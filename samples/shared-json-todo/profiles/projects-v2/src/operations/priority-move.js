import { moveTodo } from "./todo-v2.js";
import { prioritizedMove } from "./priority-move-core.js";
export function movePriority(input) {
  return prioritizedMove(moveTodo, input);
}
