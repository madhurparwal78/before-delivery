import { holds, parse, type Node, type Scope, type Value } from "../../../shared/expression.js";
import type { Table } from "../../../shared/types.js";
import type { FieldState, FormPolicy } from "../../../server/rules.js";

const compiled = new Map<string, Node>();

function compile(text: string): Node {
  let node = compiled.get(text);
  if (!node) {
    node = parse(text);
    compiled.set(text, node);
  }
  return node;
}

interface PolicyContext {
  number: string;
  username: string;
  roles: readonly string[];
  /** The value a field has in the form right now. */
  valueOf(field: string): Value;
  /** The last server time received with the record, in milliseconds. */
  serverNow: number;
}

/** The published policies for a table, applied to the form's current values: a later policy wins per property. */
export function applyPolicies(policies: FormPolicy[], table: Table, context: PolicyContext): Record<string, FieldState> {
  const scope: Scope = {
    path: (parts) => (parts[0] === "number" ? context.number : parts.length === 1 ? context.valueOf(parts[0]!) : null),
    me: () => context.username,
    hasRole: (role) => context.roles.includes(role),
    now: () => context.serverNow,
  };
  const states: Record<string, FieldState> = {};
  const ordered = policies.filter((p) => p.table === table && p.catalog_item === null).sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const policy of ordered) {
    if (!holds(compile(policy.condition), scope)) continue;
    for (const action of policy.actions) {
      const state = (states[action.field] ??= {});
      if (action.mandatory !== null && action.mandatory !== undefined) state.mandatory = action.mandatory;
      if (action.visible !== null && action.visible !== undefined) state.visible = action.visible;
      if (action.read_only !== null && action.read_only !== undefined) state.read_only = action.read_only;
    }
  }
  return states;
}
