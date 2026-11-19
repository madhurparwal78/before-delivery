import { parseFormula, isAggregateName, isTableCalcName, type Node, type CheckContext, type FormulaError, type FormulaType } from "./parser.js";

export interface CheckResult {
  valid: boolean;
  type: FormulaType | null;
  aggregate: boolean;
  message: string | null;
  line: number | null;
  column: number | null;
  node: Node | null;
}

const TYPE_ORDER: Record<FormulaType, number> = { number: 0, text: 1, date: 2, boolean: 3 };

function typeName(t: FormulaType): string {
  return t;
}

interface CheckState {
  ctx: CheckContext;
  aggregateDepth: number;
  lodDepth: number;
  tableCalcDepth: number;
}

function fieldByName(s: CheckState, name: string) {
  return s.ctx.fields.find((f) => f.name === name);
}

function calcByName(s: CheckState, name: string) {
  return s.ctx.calcs.find((c) => c.name === name);
}

/**
 * The published check order. Only the first error found is reported.
 * 1 length; 2 syntax; 3 depth; 4 unknown names; 5 arity; 6 types; 7 mixing;
 * 8 LOD nesting; (9 cycles is checked at save time).
 */
export function checkFormula(formula: string, ctx: CheckContext, maxChars: number): CheckResult {
  if (formula.length > maxChars) {
    return {
      valid: false,
      type: null,
      aggregate: false,
      message: `Formula is ${formula.length} characters. The limit is ${maxChars}.`,
      line: null,
      column: null,
      node: null,
    };
  }
  const parsed = parseFormula(formula, ctx);
  if (parsed.error) {
    return {
      valid: false,
      type: null,
      aggregate: false,
      message: parsed.error.message,
      line: parsed.error.line,
      column: parsed.error.column,
      node: null,
    };
  }
  if (!parsed.node) {
    return { valid: false, type: null, aggregate: false, message: null, line: null, column: null, node: null };
  }
  // Error 7 is reported at the first row-level field outside every aggregate.
  // An aggregate, a table calculation and a level-of-detail expression each
  // start a fresh context for their own body.
  if (hasTopLevelAggregate(parsed.node)) {
    const mixing = findMixing(parsed.node, true, false, false);
    if (mixing) {
      return {
        valid: false,
        type: null,
        aggregate: false,
        message: mixing.message,
        line: mixing.line,
        column: mixing.column,
        node: null,
      };
    }
  }
  const s: CheckState = { ctx, aggregateDepth: 0, lodDepth: 0, tableCalcDepth: 0 };
  const type = checkNode(parsed.node, s);
  if (typeof type === "object" && type !== null && "message" in type) {
    return {
      valid: false,
      type: null,
      aggregate: false,
      message: type.message,
      line: type.line,
      column: type.column,
      node: null,
    };
  }
  const aggregate = nodeHasAggregate(parsed.node);
  return { valid: true, type: type as FormulaType, aggregate, message: null, line: null, column: null, node: parsed.node };
}

/**
 * A formula that has an aggregate may not use row-level fields outside every
 * aggregate. The error points at the first such field, an aggregate inside
 * another aggregate, or a non-aggregate argument of a table calculation.
 * `insideAgg` means inside an aggregate; `insideCalc` means inside a table
 * calculation or a level-of-detail body, which aggregates its own way.
 */
function findMixing(
  node: Node,
  hasAggSibling: boolean,
  insideAgg: boolean,
  insideCalc: boolean,
): { message: string; line: number; column: number } | null {
  switch (node.kind) {
    case "field":
      if (!insideAgg && !insideCalc && hasAggSibling) {
        return {
          message: `Line ${node.line}, column ${node.column}: cannot mix aggregate and row values.`,
          line: node.line,
          column: node.column,
        };
      }
      return null;
    case "call":
      if (isTableCalcName(node.fn)) {
        if (insideAgg) {
          return {
            message: `Line ${node.line}, column ${node.column}: cannot mix aggregate and row values.`,
            line: node.line,
            column: node.column,
          };
        }
        for (const a of node.args) {
          const found = findMixing(a, false, false, true);
          if (found) return found;
        }
        return null;
      }
      if (isAggregateName(node.fn)) {
        if (insideAgg) {
          return {
            message: `Line ${node.line}, column ${node.column}: cannot mix aggregate and row values.`,
            line: node.line,
            column: node.column,
          };
        }
        for (const a of node.args) {
          const found = findMixing(a, false, true, insideCalc);
          if (found) return found;
        }
        return null;
      }
      for (const a of node.args) {
        const found = findMixing(a, hasAggSibling, insideAgg, insideCalc);
        if (found) return found;
      }
      return null;
    case "binary": {
      const l = findMixing(node.left, hasAggSibling || subtreeHasAggregate(node.right), insideAgg, insideCalc);
      if (l) return l;
      const r = findMixing(node.right, hasAggSibling || subtreeHasAggregate(node.left), insideAgg, insideCalc);
      if (r) return r;
      return null;
    }
    case "unary":
      return findMixing(node.operand, hasAggSibling, insideAgg, insideCalc);
    case "lod":
      return findMixing(node.body, false, false, true);
    default:
      return null;
  }
}

/**
 * Whether the formula's result depends on an aggregate at its own level: an
 * aggregate, a table calculation or a level-of-detail expression anywhere that
 * is not itself nested inside one.
 */
function hasTopLevelAggregate(node: Node): boolean {
  switch (node.kind) {
    case "call":
      if (isAggregateName(node.fn) || isTableCalcName(node.fn)) return true;
      return node.args.some(hasTopLevelAggregate);
    case "binary":
      return hasTopLevelAggregate(node.left) || hasTopLevelAggregate(node.right);
    case "unary":
      return hasTopLevelAggregate(node.operand);
    case "lod":
      return true;
    default:
      return false;
  }
}

function subtreeHasAggregate(node: Node): boolean {
  switch (node.kind) {
    case "call":
      if (isAggregateName(node.fn) || isTableCalcName(node.fn)) return true;
      return node.args.some(subtreeHasAggregate);
    case "binary":
      return subtreeHasAggregate(node.left) || subtreeHasAggregate(node.right);
    case "unary":
      return subtreeHasAggregate(node.operand);
    case "lod":
      return true;
    default:
      return false;
  }
}

type TypeOrError = FormulaType | FormulaError;

function err(message: string, line: number, column: number): FormulaError {
  return { message, line, column };
}

function nodeHasAggregate(node: Node): boolean {
  switch (node.kind) {
    case "call":
      if (isAggregateName(node.fn) || isTableCalcName(node.fn)) return true;
      return node.args.some(nodeHasAggregate);
    case "binary":
      return nodeHasAggregate(node.left) || nodeHasAggregate(node.right);
    case "unary":
      return nodeHasAggregate(node.operand);
    case "lod":
      return true;
    default:
      return false;
  }
}

function checkNode(node: Node, s: CheckState): TypeOrError {
  switch (node.kind) {
    case "number":
      return "number";
    case "text":
      return "text";
    case "boolean":
      return "boolean";
    case "null":
      return "number";
    case "parameter": {
      const p = s.ctx.parameters.find((x) => x.name === node.name);
      if (!p) return err(`Line ${node.line}, column ${node.column}: unknown parameter "${node.name}".`, node.line, node.column);
      return p.type === "number" ? "number" : "text";
    }
    case "set": {
      const set = s.ctx.sets.find((x) => x.name === node.name);
      if (!set) return err(`Line ${node.line}, column ${node.column}: unknown field "${node.name}".`, node.line, node.column);
      return "boolean";
    }
    case "field": {
      const field = fieldByName(s, node.name);
      if (field) return field.type;
      const set = s.ctx.sets.find((x) => x.name === node.name);
      if (set) return "boolean";
      const calc = calcByName(s, node.name);
      if (calc) {
        const parsedCalc = parseFormula(calc.formula, s.ctx);
        if (parsedCalc.node) {
          const sub = checkNode(parsedCalc.node, s);
          if (typeof sub === "object" && "message" in sub) return sub;
          return sub;
        }
      }
      return err(`Line ${node.line}, column ${node.column}: unknown field "${node.name}".`, node.line, node.column);
    }
    case "unary": {
      const inner = checkNode(node.operand, s);
      if (typeof inner === "object") return inner;
      if (node.op === "NOT") {
        if (inner !== "boolean") {
          return err(`Line ${node.line}, column ${node.column}: NOT argument 1 must be boolean, found ${inner}.`, node.line, node.column);
        }
        return "boolean";
      }
      if (inner !== "number") {
        return err(`Line ${node.line}, column ${node.column}: - argument 1 must be number, found ${inner}.`, node.line, node.column);
      }
      return "number";
    }
    case "binary": {
      const lt = checkNode(node.left, s);
      if (typeof lt === "object") return lt;
      const rt = checkNode(node.right, s);
      if (typeof rt === "object") return rt;
      switch (node.op) {
        case "OR":
        case "AND":
          if (lt !== "boolean" || rt !== "boolean") {
            return err(`Line ${node.line}, column ${node.column}: ${node.op} argument 1 must be boolean, found ${lt !== "boolean" ? lt : rt}.`, node.line, node.column);
          }
          return "boolean";
        case "=":
        case "<>":
          if (lt !== rt) {
            return err(`Line ${node.line}, column ${node.column}: cannot compare ${lt} with ${rt}.`, node.line, node.column);
          }
          return "boolean";
        case "<":
        case "<=":
        case ">":
        case ">=":
          if (lt !== rt || (lt !== "number" && lt !== "date" && lt !== "text")) {
            return err(`Line ${node.line}, column ${node.column}: cannot compare ${lt} with ${rt}.`, node.line, node.column);
          }
          return "boolean";
        case "&":
          return "text";
        case "+":
        case "-":
        case "*":
        case "/":
        case "%":
          if (lt !== "number" || rt !== "number") {
            return err(`Line ${node.line}, column ${node.column}: ${node.op} argument ${lt !== "number" ? 1 : 2} must be number, found ${lt !== "number" ? lt : rt}.`, node.line, node.column);
          }
          return "number";
      }
      return "number";
    }
    case "call":
      return checkCall(node, s);
    case "lod":
      return checkLod(node, s);
  }
}

function checkCall(node: Node & { kind: "call" }, s: CheckState): TypeOrError {
  const fn = node.fn;
  // Keywords and functions are upper case only: a lower-case name followed by
  // ( is an unknown function, reported with its own spelling.
  const known =
    isAggregateName(fn) ||
    isTableCalcName(fn) ||
    ["IF", "IFNULL", "ISNULL", "ABS", "ROUND", "UPPER", "LOWER", "LEN", "LEFT", "RIGHT", "CONTAINS", "PART_OF", "TRUNC_TO", "DAYS_BETWEEN", "NUM", "TEXT"].includes(fn);
  const spelled = known && /^[A-Z][A-Z0-9_]*$/.test(node.word);
  if (!spelled) {
    return err(`Line ${node.line}, column ${node.column}: unknown function "${node.word}".`, node.line, node.column);
  }
  const arity: Record<string, number> = {
    SUM: 1, AVG: 1, MEDIAN: 1, MIN: 1, MAX: 1, COUNT: 1, COUNT_UNIQUE: 1,
    RUN_TOTAL: 1, PREV_DIFF: 1, SHARE: 1, RANK_OF: 1,
    IF: 3, IFNULL: 2, ISNULL: 1, ABS: 1, ROUND: 2,
    UPPER: 1, LOWER: 1, LEN: 1, LEFT: 2, RIGHT: 2, CONTAINS: 2,
    PART_OF: 2, TRUNC_TO: 2, DAYS_BETWEEN: 2,
    NUM: 1, TEXT: 1,
  };
  if (node.args.length !== arity[fn]) {
    return err(`Line ${node.line}, column ${node.column}: ${fn} expects ${arity[fn]} arguments, found ${node.args.length}.`, node.line, node.column);
  }
  if (isAggregateName(fn)) {
    if (s.aggregateDepth > 0) {
      return err(`Line ${node.line}, column ${node.column}: cannot mix aggregate and row values.`, node.line, node.column);
    }
    s.aggregateDepth++;
    const argType = checkNode(node.args[0], s);
    s.aggregateDepth--;
    if (typeof argType === "object") return argType;
    const argTok = node.args[0];
    const needs: Record<string, FormulaType[]> = {
      SUM: ["number"], AVG: ["number"], MEDIAN: ["number"], MIN: ["number", "date", "text"], MAX: ["number", "date", "text"],
      COUNT: ["number", "date", "text", "boolean"], COUNT_UNIQUE: ["number", "date", "text", "boolean"],
    };
    if (!needs[fn].includes(argType as FormulaType)) {
      return err(`Line ${argTok.line}, column ${argTok.column}: ${fn} argument 1 must be number, found ${argType}.`, argTok.line, argTok.column);
    }
    return "number";
  }
  if (isTableCalcName(fn)) {
    if (s.tableCalcDepth > 0) {
      return err(`Line ${node.line}, column ${node.column}: cannot mix aggregate and row values.`, node.line, node.column);
    }
    if (s.lodDepth > 0) {
      return err(`Line ${node.line}, column ${node.column}: a table calculation cannot appear inside a level-of-detail expression.`, node.line, node.column);
    }
    s.tableCalcDepth++;
    const argType = checkNode(node.args[0], s);
    s.tableCalcDepth--;
    if (typeof argType === "object") return argType;
    if (argType !== "number") {
      return err(`Line ${node.line}, column ${node.column}: ${fn} argument 1 must be number, found ${argType}.`, node.line, node.column);
    }
    return "number";
  }
  const argTypes: FormulaType[] = [];
  for (const a of node.args) {
    const t = checkNode(a, s);
    if (typeof t === "object") return t;
    argTypes.push(t);
  }
  const [a1, a2, a3] = argTypes;
  switch (fn) {
    case "IF":
      if (a1 !== "boolean") return err(`Line ${node.line}, column ${node.column}: IF argument 1 must be boolean, found ${a1}.`, node.line, node.column);
      if (a2 !== a3) return err(`Line ${node.line}, column ${node.column}: IF argument 2 must be ${a3}, found ${a2}.`, node.line, node.column);
      return a2;
    case "IFNULL":
      return a1;
    case "ISNULL":
      return "boolean";
    case "ABS":
      if (a1 !== "number") return err(`Line ${node.line}, column ${node.column}: ABS argument 1 must be number, found ${a1}.`, node.line, node.column);
      return "number";
    case "ROUND":
      if (a1 !== "number") return err(`Line ${node.line}, column ${node.column}: ROUND argument 1 must be number, found ${a1}.`, node.line, node.column);
      if (a2 !== "number") return err(`Line ${node.line}, column ${node.column}: ROUND argument 2 must be number, found ${a2}.`, node.line, node.column);
      return "number";
    case "UPPER":
    case "LOWER":
    case "LEN":
      if (a1 !== "text") return err(`Line ${node.line}, column ${node.column}: ${fn} argument 1 must be text, found ${a1}.`, node.line, node.column);
      return fn === "LEN" ? "number" : "text";
    case "LEFT":
    case "RIGHT":
      if (a1 !== "text") return err(`Line ${node.line}, column ${node.column}: ${fn} argument 1 must be text, found ${a1}.`, node.line, node.column);
      if (a2 !== "number") return err(`Line ${node.line}, column ${node.column}: ${fn} argument 2 must be number, found ${a2}.`, node.line, node.column);
      return "text";
    case "CONTAINS":
      if (a1 !== "text" || a2 !== "text") return err(`Line ${node.line}, column ${node.column}: CONTAINS argument ${a1 !== "text" ? 1 : 2} must be text, found ${a1 !== "text" ? a1 : a2}.`, node.line, node.column);
      return "boolean";
    case "PART_OF":
      if (a1 !== "date") return err(`Line ${node.line}, column ${node.column}: PART_OF argument 1 must be date, found ${a1}.`, node.line, node.column);
      if (a2 !== "text") return err(`Line ${node.line}, column ${node.column}: PART_OF argument 2 must be text, found ${a2}.`, node.line, node.column);
      return "number";
    case "TRUNC_TO":
      if (a1 !== "date") return err(`Line ${node.line}, column ${node.column}: TRUNC_TO argument 1 must be date, found ${a1}.`, node.line, node.column);
      if (a2 !== "text") return err(`Line ${node.line}, column ${node.column}: TRUNC_TO argument 2 must be text, found ${a2}.`, node.line, node.column);
      return "date";
    case "DAYS_BETWEEN":
      if (a1 !== "date") return err(`Line ${node.line}, column ${node.column}: DAYS_BETWEEN argument 1 must be date, found ${a1}.`, node.line, node.column);
      if (a2 !== "date") return err(`Line ${node.line}, column ${node.column}: DAYS_BETWEEN argument 2 must be date, found ${a2}.`, node.line, node.column);
      return "number";
    case "NUM":
      if (a1 !== "text") return err(`Line ${node.line}, column ${node.column}: NUM argument 1 must be text, found ${a1}.`, node.line, node.column);
      return "number";
    case "TEXT":
      return "text";
  }
  return "number";
}

function checkLod(node: Node & { kind: "lod" }, s: CheckState): TypeOrError {
  if (s.lodDepth > 0) {
    return err(`Line ${node.line}, column ${node.column}: a level-of-detail expression cannot contain another.`, node.line, node.column);
  }
  for (const d of node.dims) {
    if (d.kind !== "field") continue;
    const f = fieldByName(s, d.name) ?? calcByName(s, d.name);
    if (!f) return err(`Line ${node.line}, column ${node.column}: unknown field "${d.name}".`, d.line, d.column);
    const field = fieldByName(s, d.name);
    if (!field || field.kind !== "dimension") {
      return err(`Line ${d.line}, column ${d.column}: ${node.form === "at" ? "AT" : node.form === "plus" ? "PLUS" : "MINUS"} argument 1 must be dimension, found ${field?.kind === "measure" ? "measure" : "number"}.`, d.line, d.column);
    }
  }
  s.lodDepth++;
  const bodyType = checkNode(node.body, s);
  s.lodDepth--;
  if (typeof bodyType === "object") return bodyType;
  if (bodyType !== "number") {
    return err(`Line ${node.line}, column ${node.column}: a level-of-detail expression must produce a number, found ${bodyType}.`, node.line, node.column);
  }
  return "number";
}

export { TYPE_ORDER, typeName };
