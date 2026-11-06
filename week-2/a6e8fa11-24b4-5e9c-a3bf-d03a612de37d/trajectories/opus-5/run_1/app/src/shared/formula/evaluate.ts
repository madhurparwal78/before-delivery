import { LIMITS } from '../limits';
import { RangeAddress, cellKey, formatCellRef, rangeCells } from '../refs';
import {
  CellError,
  CellValue,
  ErrorCode,
  NumberFormat,
  ParsedInput,
  dateToSerial,
  displayValue,
  error,
  generalNumberText,
  isError,
  parseInput,
  roundHalfAway,
} from '../values';
import { WorkbookState } from '../workbook';
import { zoneParts } from '../zone';
import { FormulaNode, ParsedFormula, parseFormula } from './parse';

export interface EvaluatedCell {
  input: string;
  value: CellValue;
  display: string;
  numberFormat: NumberFormat;
  bold: boolean;
  chain: number;
}

export interface ClosureEntry {
  sheetId: string;
  ref: string;
  depth: number;
}

export interface EvaluationOptions {
  timeZone: string;
  nowMs: number;
}

interface CompiledCell {
  key: string;
  sheetId: string;
  ref: string;
  input: string;
  numberFormat: NumberFormat;
  bold: boolean;
  parsed: ParsedInput;
  formula: ParsedFormula | null;
  staticError: ErrorCode | null;
  precedents: string[];
}

type Arg = { kind: 'value'; value: CellValue } | { kind: 'range'; values: CellValue[] };

function valueArg(value: CellValue): Arg {
  return { kind: 'value', value };
}

export class Evaluation {
  private readonly cells = new Map<string, EvaluatedCell>();
  private readonly dependents = new Map<string, string[]>();
  private readonly compiled = new Map<string, CompiledCell>();
  private readonly sheetsByLowerName = new Map<string, string>();
  readonly todaySerial: number;
  readonly nowSerial: number;

  constructor(private readonly state: WorkbookState, options: EvaluationOptions) {
    const parts = zoneParts(options.nowMs, options.timeZone);
    this.todaySerial = dateToSerial(parts.year, parts.month, parts.day);
    this.nowSerial = this.todaySerial + (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86400;
    for (const sheet of state.sheets) this.sheetsByLowerName.set(sheet.name.toLowerCase(), sheet.id);
    this.compile();
    this.evaluateAll();
  }

  private compile(): void {
    for (const sheet of this.state.sheets) {
      for (const [ref, record] of sheet.cells) {
        const formatted = record.numberFormat !== 'general' || record.bold;
        if (record.input === '' && !formatted) continue;
        const key = cellKey(sheet.id, ref);
        const parsed = parseInput(record.input);
        const compiled: CompiledCell = {
          key,
          sheetId: sheet.id,
          ref,
          input: record.input,
          numberFormat: record.numberFormat,
          bold: record.bold,
          parsed,
          formula: null,
          staticError: null,
          precedents: [],
        };
        if (parsed.kind === 'formula') {
          const formula = parseFormula(parsed.formula as string);
          if (!formula) {
            compiled.staticError = '#ERROR!';
          } else if (formula.nodeCount > LIMITS.maxFormulaNodes || formula.cellsCovered > LIMITS.maxFormulaCells) {
            compiled.staticError = '#LIMIT';
          } else {
            compiled.formula = formula;
            compiled.precedents = this.precedentKeys(formula, sheet.id);
          }
        }
        this.compiled.set(key, compiled);
      }
    }
    for (const compiled of this.compiled.values()) {
      for (const precedent of compiled.precedents) {
        const list = this.dependents.get(precedent);
        if (list) list.push(compiled.key);
        else this.dependents.set(precedent, [compiled.key]);
      }
    }
  }

  private precedentKeys(formula: ParsedFormula, homeSheetId: string): string[] {
    const keys = new Set<string>();
    for (const ref of formula.refs) {
      const sheetId = ref.sheetName === null ? homeSheetId : this.sheetsByLowerName.get(ref.sheetName.toLowerCase());
      if (!sheetId) continue;
      for (const cell of rangeCells(ref.range)) keys.add(cellKey(sheetId, cell));
    }
    return [...keys];
  }

  /** Tarjan's algorithm: strongly connected components in reverse topological order of the condensation. */
  private stronglyConnectedComponents(): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const components: string[][] = [];
    let counter = 0;

    type Frame = { key: string; edges: string[]; at: number };
    for (const start of this.compiled.keys()) {
      if (index.has(start)) continue;
      const frames: Frame[] = [{ key: start, edges: this.formulaEdges(start), at: 0 }];
      index.set(start, counter);
      low.set(start, counter);
      counter++;
      stack.push(start);
      onStack.add(start);
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame.at < frame.edges.length) {
          const next = frame.edges[frame.at];
          frame.at++;
          if (!index.has(next)) {
            index.set(next, counter);
            low.set(next, counter);
            counter++;
            stack.push(next);
            onStack.add(next);
            frames.push({ key: next, edges: this.formulaEdges(next), at: 0 });
          } else if (onStack.has(next)) {
            low.set(frame.key, Math.min(low.get(frame.key) as number, index.get(next) as number));
          }
          continue;
        }
        frames.pop();
        if (low.get(frame.key) === index.get(frame.key)) {
          const component: string[] = [];
          for (;;) {
            const popped = stack.pop() as string;
            onStack.delete(popped);
            component.push(popped);
            if (popped === frame.key) break;
          }
          components.push(component);
        }
        const parent = frames[frames.length - 1];
        if (parent) low.set(parent.key, Math.min(low.get(parent.key) as number, low.get(frame.key) as number));
      }
    }
    return components;
  }

  private formulaEdges(key: string): string[] {
    const compiled = this.compiled.get(key);
    if (!compiled) return [];
    return compiled.precedents.filter((precedent) => this.compiled.has(precedent));
  }

  private evaluateAll(): void {
    for (const compiled of this.compiled.values()) {
      if (compiled.parsed.kind !== 'formula') {
        this.cells.set(compiled.key, this.constantCell(compiled));
      }
    }
    const components = this.stronglyConnectedComponents();
    for (const component of components) {
      const cyclic =
        component.length > 1 ||
        (component.length === 1 && this.formulaEdges(component[0]).includes(component[0]));
      for (const key of component) {
        const compiled = this.compiled.get(key);
        if (!compiled || compiled.parsed.kind !== 'formula') continue;
        if (cyclic) {
          this.cells.set(key, this.errorCell(compiled, '#CYCLE', Number.POSITIVE_INFINITY));
          continue;
        }
        this.cells.set(key, this.evaluateFormulaCell(compiled));
      }
    }
  }

  private constantCell(compiled: CompiledCell): EvaluatedCell {
    const value = compiled.parsed.literal;
    return {
      input: compiled.input,
      value,
      display: displayValue(value, compiled.numberFormat),
      numberFormat: compiled.numberFormat,
      bold: compiled.bold,
      chain: 0,
    };
  }

  private errorCell(compiled: CompiledCell, code: ErrorCode, chain: number): EvaluatedCell {
    return {
      input: compiled.input,
      value: error(code),
      display: code,
      numberFormat: compiled.numberFormat,
      bold: compiled.bold,
      chain,
    };
  }

  private evaluateFormulaCell(compiled: CompiledCell): EvaluatedCell {
    let chain = 0;
    let sawCycle = false;
    for (const precedent of compiled.precedents) {
      const cell = this.cells.get(precedent);
      if (!cell) continue;
      if (isError(cell.value) && cell.value.err === '#CYCLE') sawCycle = true;
      if (cell.chain > chain) chain = cell.chain;
    }
    if (sawCycle) return this.errorCell(compiled, '#CYCLE', Number.POSITIVE_INFINITY);
    if (compiled.staticError) return this.errorCell(compiled, compiled.staticError, chain + 1);
    const depth = chain + 1;
    if (depth > LIMITS.maxDependencyDepth) return this.errorCell(compiled, '#LIMIT', depth);
    const formula = compiled.formula as ParsedFormula;
    const arg = this.evaluateNode(formula.root, compiled.sheetId);
    const value = this.toScalar(arg);
    return {
      input: compiled.input,
      value,
      display: displayValue(value, compiled.numberFormat),
      numberFormat: compiled.numberFormat,
      bold: compiled.bold,
      chain: depth,
    };
  }

  private rawValue(sheetId: string, ref: string): CellValue {
    const cell = this.cells.get(cellKey(sheetId, ref));
    return cell ? cell.value : null;
  }

  private rangeValues(sheetId: string, range: RangeAddress): CellValue[] {
    const values: CellValue[] = [];
    for (let row = range.startRow; row <= range.endRow; row++) {
      for (let col = range.startCol; col <= range.endCol; col++) {
        values.push(this.rawValue(sheetId, formatCellRef({ col, row })));
      }
    }
    return values;
  }

  private evaluateNode(node: FormulaNode, homeSheetId: string): Arg {
    switch (node.k) {
      case 'num':
        return valueArg(node.v);
      case 'str':
        return valueArg(node.v);
      case 'bool':
        return valueArg(node.v);
      case 'name':
        return valueArg(error('#NAME?'));
      case 'ref': {
        const sheetId =
          node.sheetName === null ? homeSheetId : this.sheetsByLowerName.get(node.sheetName.toLowerCase());
        if (!sheetId) return valueArg(error('#REF!'));
        if (node.single) return valueArg(this.rawValue(sheetId, formatCellRef({ col: node.range.startCol, row: node.range.startRow })));
        return { kind: 'range', values: this.rangeValues(sheetId, node.range) };
      }
      case 'unary': {
        const value = this.toScalar(this.evaluateNode(node.a, homeSheetId));
        const num = this.toNumber(value);
        if (isError(num)) return valueArg(num);
        return valueArg(node.op === '-' ? -num : num);
      }
      case 'binary':
        return valueArg(this.evaluateBinary(node.op, node.a, node.b, homeSheetId));
      case 'call':
        return this.evaluateCall(node.name, node.args, homeSheetId);
    }
  }

  private evaluateBinary(op: string, aNode: FormulaNode, bNode: FormulaNode, homeSheetId: string): CellValue {
    const a = this.toScalar(this.evaluateNode(aNode, homeSheetId));
    const b = this.toScalar(this.evaluateNode(bNode, homeSheetId));
    if (isError(a)) return a;
    if (isError(b)) return b;
    if (op === '&') return this.toText(a) + this.toText(b);
    if (op === '=' || op === '<>' || op === '<' || op === '<=' || op === '>' || op === '>=') {
      const compared = this.compare(a, b);
      switch (op) {
        case '=':
          return compared === 0;
        case '<>':
          return compared !== 0;
        case '<':
          return compared < 0;
        case '<=':
          return compared <= 0;
        case '>':
          return compared > 0;
        default:
          return compared >= 0;
      }
    }
    const left = this.toNumber(a);
    if (isError(left)) return left;
    const right = this.toNumber(b);
    if (isError(right)) return right;
    switch (op) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return right === 0 ? error('#DIV/0!') : left / right;
      case '^': {
        const result = Math.pow(left, right);
        return Number.isFinite(result) ? result : error('#VALUE!');
      }
      default:
        return error('#ERROR!');
    }
  }

  private compare(a: CellValue, b: CellValue): number {
    const rank = (value: CellValue): number => {
      if (value === null) return 0;
      if (typeof value === 'number') return 1;
      if (typeof value === 'string') return 2;
      return 3;
    };
    const left = a === null ? (typeof b === 'string' ? '' : 0) : a;
    const right = b === null ? (typeof a === 'string' ? '' : 0) : b;
    if (typeof left === 'number' && typeof right === 'number') return left === right ? 0 : left < right ? -1 : 1;
    if (typeof left === 'string' && typeof right === 'string') {
      const l = left.toLowerCase();
      const r = right.toLowerCase();
      return l === r ? 0 : l < r ? -1 : 1;
    }
    if (typeof left === 'boolean' && typeof right === 'boolean') {
      return left === right ? 0 : left ? 1 : -1;
    }
    const diff = rank(left) - rank(right);
    return diff === 0 ? 0 : diff < 0 ? -1 : 1;
  }

  private toScalar(arg: Arg): CellValue {
    if (arg.kind === 'value') return arg.value;
    if (arg.values.length === 1) return arg.values[0];
    const found = arg.values.find((value) => isError(value));
    return found ? (found as CellError) : error('#VALUE!');
  }

  private toNumber(value: CellValue): number | CellError {
    if (value === null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (isError(value)) return value;
    return error('#VALUE!');
  }

  private toText(value: CellValue): string {
    if (value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (isError(value)) return value.err;
    return generalNumberText(value);
  }

  private toBoolean(value: CellValue): boolean | CellError {
    if (value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (isError(value)) return value;
    return error('#VALUE!');
  }

  private flatten(args: Arg[]): CellValue[] {
    const out: CellValue[] = [];
    for (const arg of args) {
      if (arg.kind === 'value') out.push(arg.value);
      else out.push(...arg.values);
    }
    return out;
  }

  /** Numbers for aggregation: errors stop the aggregate; empty cells, text and booleans in ranges are ignored. */
  private aggregateNumbers(args: Arg[]): number[] | CellError {
    const out: number[] = [];
    for (const arg of args) {
      if (arg.kind === 'range') {
        for (const value of arg.values) {
          if (isError(value)) return value;
          if (typeof value === 'number') out.push(value);
        }
        continue;
      }
      const value = arg.value;
      if (isError(value)) return value;
      if (value === null) continue;
      if (typeof value === 'number') out.push(value);
      else if (typeof value === 'boolean') out.push(value ? 1 : 0);
      else return error('#VALUE!');
    }
    return out;
  }

  private evaluateCall(name: string, argNodes: FormulaNode[], homeSheetId: string): Arg {
    if (name === 'TODAY') {
      if (argNodes.length !== 0) return valueArg(error('#VALUE!'));
      return valueArg(this.todaySerial);
    }
    if (name === 'NOW') {
      if (argNodes.length !== 0) return valueArg(error('#VALUE!'));
      return valueArg(this.nowSerial);
    }
    const args = argNodes.map((node) => this.evaluateNode(node, homeSheetId));
    switch (name) {
      case 'SUM': {
        const numbers = this.aggregateNumbers(args);
        if (!Array.isArray(numbers)) return valueArg(numbers);
        return valueArg(numbers.reduce((total, value) => total + value, 0));
      }
      case 'AVERAGE': {
        const numbers = this.aggregateNumbers(args);
        if (!Array.isArray(numbers)) return valueArg(numbers);
        if (numbers.length === 0) return valueArg(error('#DIV/0!'));
        return valueArg(numbers.reduce((total, value) => total + value, 0) / numbers.length);
      }
      case 'MIN': {
        const numbers = this.aggregateNumbers(args);
        if (!Array.isArray(numbers)) return valueArg(numbers);
        return valueArg(numbers.length === 0 ? 0 : Math.min(...numbers));
      }
      case 'MAX': {
        const numbers = this.aggregateNumbers(args);
        if (!Array.isArray(numbers)) return valueArg(numbers);
        return valueArg(numbers.length === 0 ? 0 : Math.max(...numbers));
      }
      case 'COUNT': {
        const numbers = this.aggregateNumbers(args);
        if (!Array.isArray(numbers)) return valueArg(numbers);
        return valueArg(numbers.length);
      }
      case 'COUNTA': {
        const values = this.flatten(args);
        return valueArg(values.filter((value) => value !== null).length);
      }
      case 'STDEV': {
        const numbers = this.aggregateNumbers(args);
        if (!Array.isArray(numbers)) return valueArg(numbers);
        if (numbers.length < 2) return valueArg(error('#DIV/0!'));
        const mean = numbers.reduce((total, value) => total + value, 0) / numbers.length;
        const variance =
          numbers.reduce((total, value) => total + (value - mean) * (value - mean), 0) / (numbers.length - 1);
        return valueArg(Math.sqrt(variance));
      }
      case 'ROUND': {
        if (args.length !== 2) return valueArg(error('#VALUE!'));
        const x = this.toNumber(this.toScalar(args[0]));
        if (isError(x)) return valueArg(x);
        const digits = this.toNumber(this.toScalar(args[1]));
        if (isError(digits)) return valueArg(digits);
        return valueArg(roundHalfAway(x, Math.trunc(digits)));
      }
      case 'ABS': {
        if (args.length !== 1) return valueArg(error('#VALUE!'));
        const x = this.toNumber(this.toScalar(args[0]));
        if (isError(x)) return valueArg(x);
        return valueArg(Math.abs(x));
      }
      case 'IF': {
        if (args.length < 2 || args.length > 3) return valueArg(error('#VALUE!'));
        const condition = this.toBoolean(this.toScalar(args[0]));
        if (isError(condition)) return valueArg(condition);
        if (condition) return args[1];
        return args.length === 3 ? args[2] : valueArg(false);
      }
      case 'AND':
      case 'OR': {
        const flags: boolean[] = [];
        for (const arg of args) {
          const values = arg.kind === 'range' ? arg.values : [arg.value];
          for (const value of values) {
            if (isError(value)) return valueArg(value);
            if (value === null) continue;
            if (typeof value === 'string') {
              if (arg.kind === 'range') continue;
              return valueArg(error('#VALUE!'));
            }
            flags.push(typeof value === 'boolean' ? value : value !== 0);
          }
        }
        if (flags.length === 0) return valueArg(error('#VALUE!'));
        return valueArg(name === 'AND' ? flags.every(Boolean) : flags.some(Boolean));
      }
      case 'SUMIF':
      case 'COUNTIF':
      case 'AVERAGEIF':
        return valueArg(this.evaluateCriterion(name, args));
      case 'DATE': {
        if (args.length !== 3) return valueArg(error('#VALUE!'));
        const parts: number[] = [];
        for (const arg of args) {
          const num = this.toNumber(this.toScalar(arg));
          if (isError(num)) return valueArg(num);
          parts.push(Math.trunc(num));
        }
        return valueArg(dateToSerial(parts[0], parts[1], parts[2]));
      }
      default:
        return valueArg(error('#NAME?'));
    }
  }

  private evaluateCriterion(name: 'SUMIF' | 'COUNTIF' | 'AVERAGEIF', args: Arg[]): CellValue {
    const maxArgs = name === 'COUNTIF' ? 2 : 3;
    if (args.length < 2 || args.length > maxArgs) return error('#VALUE!');
    const source = args[0];
    if (source.kind !== 'range') return error('#VALUE!');
    const criterion = this.toScalar(args[1]);
    if (isError(criterion)) return criterion;
    const target = args.length === 3 ? args[2] : args[0];
    const targetValues = target.kind === 'range' ? target.values : [target.value];
    let count = 0;
    let total = 0;
    for (let i = 0; i < source.values.length; i++) {
      const value = source.values[i];
      if (isError(value)) return value;
      if (this.compare(value, criterion) !== 0) continue;
      if (name === 'COUNTIF') {
        count++;
        continue;
      }
      const picked = targetValues[i] ?? null;
      if (isError(picked)) return picked;
      if (typeof picked === 'number') {
        total += picked;
        count++;
      } else if (typeof picked === 'boolean') {
        total += picked ? 1 : 0;
        count++;
      }
    }
    if (name === 'COUNTIF') return count;
    if (name === 'SUMIF') return total;
    return count === 0 ? error('#DIV/0!') : total / count;
  }

  cell(sheetId: string, ref: string): EvaluatedCell | undefined {
    return this.cells.get(cellKey(sheetId, ref));
  }

  valueAt(sheetId: string, ref: string): CellValue {
    return this.rawValue(sheetId, ref);
  }

  displayAt(sheetId: string, ref: string): string {
    return this.cells.get(cellKey(sheetId, ref))?.display ?? '';
  }

  /** Every cell that depends on the edited cell, directly or through other cells, with its dependency depth. */
  closure(sheetId: string, ref: string): ClosureEntry[] {
    const source = cellKey(sheetId, ref);
    const reachable = new Set<string>();
    const stack = [source];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const next of this.dependents.get(current) ?? []) {
        if (next === source || reachable.has(next)) continue;
        reachable.add(next);
        stack.push(next);
      }
    }
    if (reachable.size === 0) return [];
    const inDegree = new Map<string, number>();
    for (const key of reachable) inDegree.set(key, 0);
    const edgesFrom = (key: string): string[] =>
      (this.dependents.get(key) ?? []).filter((next) => reachable.has(next));
    for (const key of [source, ...reachable]) {
      for (const next of edgesFrom(key)) inDegree.set(next, (inDegree.get(next) as number) + 1);
    }
    const depth = new Map<string, number>();
    depth.set(source, 0);
    const queue: string[] = [source];
    const settled = new Set<string>([source]);
    while (queue.length > 0) {
      const key = queue.shift() as string;
      for (const next of edgesFrom(key)) {
        depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(key) as number) + 1));
        const left = (inDegree.get(next) as number) - 1;
        inDegree.set(next, left);
        if (left === 0) {
          settled.add(next);
          queue.push(next);
        }
      }
    }
    for (const key of reachable) {
      if (settled.has(key)) continue;
      settled.add(key);
      depth.set(key, Math.max(depth.get(key) ?? 0, 1));
      for (const next of edgesFrom(key)) {
        depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(key) as number) + 1));
      }
    }
    const entries: ClosureEntry[] = [];
    for (const key of reachable) {
      const compiled = this.compiled.get(key);
      if (!compiled) continue;
      entries.push({ sheetId: compiled.sheetId, ref: compiled.ref, depth: depth.get(key) ?? 1 });
    }
    entries.sort((a, b) => a.depth - b.depth || a.sheetId.localeCompare(b.sheetId) || a.ref.localeCompare(b.ref));
    return entries;
  }
}

export function evaluateWorkbook(state: WorkbookState, options: EvaluationOptions): Evaluation {
  return new Evaluation(state, options);
}
