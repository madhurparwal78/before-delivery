// Filter and branch conditions: both sides resolved to text, compared as
// numbers when both parse as finite decimals, else as case-sensitive strings.

import { parseDecimal } from "./text.js";
import { stringify } from "./template.js";

export type Operator = "equals" | "not equals" | "contains" | "greater than" | "less than" | "is empty" | "is not empty";

export function compare(left: string, right: string, op: Operator): boolean {
  const ln = parseDecimal(left);
  const rn = parseDecimal(right);
  const asNumbers = ln !== null && rn !== null;
  switch (op) {
    case "equals":
      return asNumbers ? ln === rn : left === right;
    case "not equals":
      return asNumbers ? ln !== rn : left !== right;
    case "contains":
      return left.includes(right);
    case "greater than":
      return asNumbers ? ln! > rn! : left > right;
    case "less than":
      return asNumbers ? ln! < rn! : left < right;
    case "is empty":
      return left.trim() === "";
    case "is not empty":
      return left.trim() !== "";
  }
}
export function condText(v: unknown): string {
  return stringify(v);
}
