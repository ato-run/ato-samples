/**
 * The acceptance fixture's only real requirement: read `localStorage` at
 * STARTUP and render from it. If the instance state bridge has not hydrated
 * by the time this line runs, a restored App shows an empty list and the
 * whole promise silently fails — so this is deliberately a synchronous read
 * in the first statement, with no fetch, no timer and no framework in front
 * of it.
 */
const STORAGE_KEY = "expenses";

let expenses = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
}

function render() {
  const list = document.getElementById("list");
  const total = document.getElementById("total");
  list.textContent = "";

  if (expenses.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Nothing yet.";
    list.appendChild(empty);
    total.textContent = "";
    return;
  }

  for (const expense of expenses) {
    const row = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = expense.label;
    const amount = document.createElement("span");
    amount.textContent = String(expense.amount);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      expenses = expenses.filter((entry) => entry.id !== expense.id);
      save();
      render();
    });
    row.append(label, amount, remove);
    list.appendChild(row);
  }
  total.textContent = `Total ${expenses.reduce((sum, e) => sum + e.amount, 0)}`;
}

document.getElementById("add").addEventListener("submit", (event) => {
  event.preventDefault();
  const label = document.getElementById("label");
  const amount = document.getElementById("amount");
  expenses.push({
    id: `e${Date.now()}`,
    label: label.value.trim(),
    amount: Number(amount.value) || 0,
  });
  save();
  label.value = "";
  amount.value = "";
  render();
});

render();
