import { ExpressionError, holds, parse, validate, type Node, type Scope } from "../shared/expression.js";
import { pathExists } from "../shared/fields.js";
import type { Table } from "../shared/types.js";
import { fail } from "./errors.js";

const compiled = new Map<string, Node>();

/** Parses an expression text once; callers have already validated it when it was saved. */
export function compile(text: string): Node {
  let node = compiled.get(text);
  if (!node) {
    node = parse(text);
    if (compiled.size > 5000) compiled.clear();
    compiled.set(text, node);
  }
  return node;
}

export function conditionHolds(text: string, scope: Scope): boolean {
  return holds(compile(text), scope);
}

interface ConditionContext {
  table: Table | null;
  /** Extra root names that are valid, for contexts such as workflow inputs. */
  extraRoots?: string[];
  /** Variable names declared by a catalog item or answers by a guide. */
  names?: { variables?: string[]; answers?: string[] };
}

/** Saves-time check: the text must parse and every path and function must exist. Refuses with 422 `expression_error`. */
export function assertExpression(text: string, context: ConditionContext): Node {
  try {
    const node = parse(text);
    validate(node, {
      hasPath: (parts) => {
        const [head, second] = parts;
        if (context.extraRoots?.includes(head!)) return true;
        if (head === "variables" && context.names?.variables) return parts.length === 2 && context.names.variables.includes(second!);
        if (head === "answers" && context.names?.answers) return parts.length === 2 && context.names.answers.includes(second!);
        if (context.table === null) return ["variables", "answers", "inputs", "steps"].includes(head!) && parts.length > 1;
        return pathExists(context.table, parts);
      },
    });
    return node;
  } catch (error) {
    if (error instanceof ExpressionError) return fail(422, "expression_error", error.message);
    throw error;
  }
}
