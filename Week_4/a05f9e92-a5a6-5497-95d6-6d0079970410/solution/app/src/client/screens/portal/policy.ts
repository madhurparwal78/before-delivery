import { holds, parse, type Node, type Value } from "../../../shared/expression.js";
import type { FormPolicy } from "../../../server/rules.js";

export interface FieldState {
  mandatory?: boolean;
  visible?: boolean;
  read_only?: boolean;
}

export interface ReadyPolicy {
  condition: Node;
  actions: FormPolicy["actions"];
}

/** The catalog item's policies in the order they apply: ascending `order`, then name in code-point order. */
export function policiesFor(all: FormPolicy[], itemId: string): ReadyPolicy[] {
  const mine = all.filter((policy) => policy.catalog_item === itemId);
  mine.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const ready: ReadyPolicy[] = [];
  for (const policy of mine) {
    try {
      ready.push({ condition: parse(policy.condition), actions: policy.actions });
    } catch {
      continue;
    }
  }
  return ready;
}

/** What the policies say about each variable for the current values: a later policy wins per property. */
export function applyPolicies(policies: ReadyPolicy[], values: Record<string, Value>, username: string, roles: readonly string[]): Record<string, FieldState> {
  const scope = {
    path: (parts: string[]): Value => (parts[0] === "variables" && parts.length === 2 ? (values[parts[1]!] ?? null) : null),
    me: () => username,
    hasRole: (role: string) => roles.includes(role),
    now: () => Number.NaN,
  };
  const states: Record<string, FieldState> = {};
  for (const policy of policies) {
    if (!holds(policy.condition, scope)) continue;
    for (const action of policy.actions) {
      const state = (states[action.field] ??= {});
      if (action.mandatory !== null && action.mandatory !== undefined) state.mandatory = action.mandatory;
      if (action.visible !== null && action.visible !== undefined) state.visible = action.visible;
      if (action.read_only !== null && action.read_only !== undefined) state.read_only = action.read_only;
    }
  }
  return states;
}
