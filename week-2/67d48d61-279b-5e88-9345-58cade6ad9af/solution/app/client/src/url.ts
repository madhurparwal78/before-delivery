// The tasks view lives in the address: view, department, blocked filter, grouping, cycle,
// highlighted row and open task.

import { CYCLES, departmentByKey } from "../../shared/catalog";

export type Grouping = "status" | "cycle" | "department" | "owner";

export interface View {
  view: "list" | "board";
  dept: string | null;
  blocked: boolean;
  group: Grouping;
  cycle: string | null;
  row: string | null;
  task: string | null;
}

export const DEFAULT_VIEW: View = { view: "list", dept: null, blocked: false, group: "status", cycle: null, row: null, task: null };

const GROUPS: Grouping[] = ["status", "cycle", "department", "owner"];
const ID = /^STG-\d+$/;

export const parseView = (search: string): View => {
  const q = new URLSearchParams(search);
  const view = q.get("view");
  const dept = q.get("dept");
  const group = q.get("group") as Grouping | null;
  const cycle = q.get("cycle");
  const row = q.get("row");
  const task = q.get("task");
  return {
    view: view === "board" ? "board" : "list",
    dept: dept && departmentByKey(dept) ? dept : null,
    blocked: q.get("blocked") === "1",
    group: group && GROUPS.includes(group) ? group : "status",
    cycle: cycle && CYCLES.some((c) => c.key === cycle) ? cycle : null,
    row: row && ID.test(row) ? row : null,
    task: task && ID.test(task) ? task : null,
  };
};

export const formatView = (v: View): string => {
  const q = new URLSearchParams();
  if (v.view !== "list") q.set("view", v.view);
  if (v.dept) q.set("dept", v.dept);
  if (v.blocked) q.set("blocked", "1");
  if (v.group !== "status") q.set("group", v.group);
  if (v.cycle) q.set("cycle", v.cycle);
  if (v.row) q.set("row", v.row);
  if (v.task) q.set("task", v.task);
  const text = q.toString();
  return text ? `?${text}` : "";
};
