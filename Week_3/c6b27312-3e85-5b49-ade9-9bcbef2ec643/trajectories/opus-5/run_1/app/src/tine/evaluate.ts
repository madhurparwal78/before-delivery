import { sentenceCaseLabel } from '../shared/labels';
import { roundTo } from '../shared/numbers';
import { Argument, BodyStatement, CutStatement, TineProgram } from './ast';
import {
  Diagnostic,
  MAX_LENGTH_MM,
  MAX_OPERATIONS,
  cutOutside,
  cutOverlap,
  nonPositive,
  tooLarge,
  tooManyOperations,
} from './diagnostics';
import {
  ManifestEntry,
  Values,
  buildManifest,
  evaluateExpr,
  resolveValues,
  scopeWithDerived,
} from './manifest';
import {
  Bbox,
  CentreLine,
  Measures,
  Solid,
  SolidOp,
  canonicalSolid,
  centreLine,
  cutGap,
  measure,
  outerWall,
} from './solid';

export type EvaluatedOp = {
  solid: SolidOp;
  kind: 'body' | 'cut' | 'join';
  statement: BodyStatement | CutStatement;
  label: string | null;
  line: number;
};

export type EvaluationSuccess = {
  ok: true;
  solid: Solid;
  ops: EvaluatedOp[];
  measures: Measures;
  values: Values;
  scope: Values;
  manifest: ManifestEntry[];
};

export type EvaluationFailure = { ok: false; diagnostic: Diagnostic };
export type EvaluationResult = EvaluationSuccess | EvaluationFailure;

function namedOf(program: TineProgram): Set<string> {
  return new Set(program.parameters.map((entry) => entry.name));
}

function argumentLabel(
  argument: Argument,
  named: Set<string>,
): { label: string; parameter: string | null } {
  for (const match of argument.text.matchAll(/[A-Za-z][A-Za-z0-9]*/g)) {
    if (match[0] !== 'pick' && named.has(match[0])) {
      return { label: sentenceCaseLabel(match[0]), parameter: match[0] };
    }
  }
  return { label: argument.role, parameter: null };
}

type Expanded = { op: EvaluatedOp; args: Argument[] };

/** The body, then the cuts and joins in source order with repeats expanded. */
function expand(program: TineProgram, scope: Values): { ops: Expanded[]; perLine: Map<number, SolidOp[]> } {
  const ops: Expanded[] = [];
  const perLine = new Map<number, SolidOp[]>();
  const counts: Record<string, number> = { hole: 0, slot: 0, boss: 0 };

  const record = (statement: BodyStatement | CutStatement, solid: SolidOp, kind: EvaluatedOp['kind']) => {
    let label: string | null = null;
    if (statement.k === 'cut') {
      counts[statement.verb] += 1;
      label = `${sentenceCaseLabel(statement.verb)} ${counts[statement.verb]}`;
    }
    const op: EvaluatedOp = { solid, kind, statement, label, line: statement.line };
    ops.push({ op, args: statement.args });
    const list = perLine.get(statement.line) ?? [];
    list.push(solid);
    perLine.set(statement.line, list);
  };

  const makeCut = (statement: CutStatement, offset: number): SolidOp | null => {
    if (statement.condition && scope[statement.condition] !== true) return null;
    const x = evaluateExpr(statement.at[0].expr, scope) + offset;
    const y = evaluateExpr(statement.at[1].expr, scope);
    if (statement.verb === 'hole') {
      return { op: 'hole', dia: evaluateExpr(statement.args[0].expr, scope), x, y };
    }
    if (statement.verb === 'slot') {
      return {
        op: 'slot',
        w: evaluateExpr(statement.args[0].expr, scope),
        len: evaluateExpr(statement.args[1].expr, scope),
        x,
        y,
      };
    }
    const height = evaluateExpr(statement.args[1].expr, scope);
    if (height === 0) return null;
    return { op: 'boss', dia: evaluateExpr(statement.args[0].expr, scope), h: height, x, y };
  };

  for (const statement of program.statements) {
    if (statement.k === 'body') {
      const solid: SolidOp =
        statement.verb === 'box'
          ? {
              op: 'box',
              w: evaluateExpr(statement.args[0].expr, scope),
              d: evaluateExpr(statement.args[1].expr, scope),
              h: evaluateExpr(statement.args[2].expr, scope),
            }
          : {
              op: 'cylinder',
              dia: evaluateExpr(statement.args[0].expr, scope),
              h: evaluateExpr(statement.args[1].expr, scope),
            };
      record(statement, solid, 'body');
      continue;
    }
    if (statement.k === 'cut') {
      const solid = makeCut(statement, 0);
      if (solid) record(statement, solid, statement.verb === 'boss' ? 'join' : 'cut');
      else perLine.set(statement.line, perLine.get(statement.line) ?? []);
      continue;
    }
    if (statement.k === 'repeat') {
      const count = Math.trunc(evaluateExpr(statement.count.expr, scope));
      const pitch = evaluateExpr(statement.pitch.expr, scope);
      perLine.set(statement.line, []);
      for (const enclosed of statement.body) {
        if (enclosed.k !== 'cut') continue;
        perLine.set(enclosed.line, perLine.get(enclosed.line) ?? []);
        for (let copy = 0; copy < count; copy += 1) {
          const solid = makeCut(enclosed, copy * pitch);
          if (solid) record(enclosed, solid, enclosed.verb === 'boss' ? 'join' : 'cut');
        }
      }
    }
  }
  return { ops, perLine };
}

type SizeCheck = { value: number; argument: Argument };

function sizeArguments(expanded: Expanded): SizeCheck[] {
  const { op } = expanded;
  switch (op.solid.op) {
    case 'box':
      return [
        { value: op.solid.w, argument: expanded.args[0] },
        { value: op.solid.d, argument: expanded.args[1] },
        { value: op.solid.h, argument: expanded.args[2] },
      ];
    case 'cylinder':
      return [
        { value: op.solid.dia, argument: expanded.args[0] },
        { value: op.solid.h, argument: expanded.args[1] },
      ];
    case 'hole':
      return [{ value: op.solid.dia, argument: expanded.args[0] }];
    case 'slot':
      return [
        { value: op.solid.w, argument: expanded.args[0] },
        { value: op.solid.len, argument: expanded.args[1] },
      ];
    case 'boss':
      return [
        { value: op.solid.dia, argument: expanded.args[0] },
        { value: op.solid.h, argument: expanded.args[1] },
      ];
  }
}

/** The body sizes, diameters and slot widths that must be greater than zero. */
function positiveArguments(expanded: Expanded): SizeCheck[] {
  const { op } = expanded;
  switch (op.solid.op) {
    case 'box':
      return [
        { value: op.solid.w, argument: expanded.args[0] },
        { value: op.solid.d, argument: expanded.args[1] },
        { value: op.solid.h, argument: expanded.args[2] },
      ];
    case 'cylinder':
      return [
        { value: op.solid.dia, argument: expanded.args[0] },
        { value: op.solid.h, argument: expanded.args[1] },
      ];
    case 'hole':
    case 'boss':
      return [{ value: op.solid.dia, argument: expanded.args[0] }];
    case 'slot':
      return [{ value: op.solid.w, argument: expanded.args[0] }];
  }
}

export function evaluateProgram(program: TineProgram, values: Values): EvaluationResult {
  const named = namedOf(program);
  const resolved = resolveValues(program, values);
  const scope = scopeWithDerived(program, resolved);

  for (const parameter of program.parameters) {
    if (parameter.k === 'let' || parameter.kind !== 'length') continue;
    const value = scope[parameter.name];
    if (typeof value === 'number' && value > MAX_LENGTH_MM) {
      return { ok: false, diagnostic: tooLarge(sentenceCaseLabel(parameter.name), value, parameter.name) };
    }
  }

  const { ops, perLine } = expand(program, scope);

  for (const expanded of ops) {
    for (const check of sizeArguments(expanded)) {
      if (check.value > MAX_LENGTH_MM) {
        const named1 = argumentLabel(check.argument, named);
        return { ok: false, diagnostic: tooLarge(named1.label, check.value, named1.parameter) };
      }
    }
  }

  for (const expanded of ops) {
    for (const check of positiveArguments(expanded)) {
      if (check.value <= 0) {
        const named1 = argumentLabel(check.argument, named);
        return { ok: false, diagnostic: nonPositive(named1.label, named1.parameter) };
      }
    }
  }

  if (ops.length > MAX_OPERATIONS) {
    return { ok: false, diagnostic: tooManyOperations(ops.length) };
  }

  const body = ops[0];
  const earlier: { line: CentreLine; label: string }[] = [];
  for (const expanded of ops) {
    const line = centreLine(expanded.op.solid);
    if (!line || !body) continue;
    const sizeArgument = expanded.args[0];
    const described = argumentLabel(sizeArgument, named);
    const label = expanded.op.label!;
    if (outerWall(line, body.op.solid) <= 0) {
      const bodySolid = body.op.solid;
      const width = bodySolid.op === 'box' ? bodySolid.w : bodySolid.op === 'cylinder' ? bodySolid.dia : 0;
      const depth = bodySolid.op === 'box' ? bodySolid.d : bodySolid.op === 'cylinder' ? bodySolid.dia : 0;
      return {
        ok: false,
        diagnostic: cutOutside(label, line.radius * 2, width, depth, described.parameter),
      };
    }
    for (const previous of earlier) {
      if (cutGap(line, previous.line) <= 0) {
        return { ok: false, diagnostic: cutOverlap(label, previous.label, described.parameter) };
      }
    }
    earlier.push({ line, label });
  }

  const solid = canonicalSolid(ops.map((entry) => entry.op.solid));
  return {
    ok: true,
    solid,
    ops: ops.map((entry) => entry.op),
    measures: measure(solid),
    values: resolved,
    scope,
    manifest: buildManifest(program, values),
  };
}

export type TapeStep = {
  index: number;
  kind: 'start' | 'params' | 'body' | 'cut' | 'join';
  op: string;
  line: number | null;
  solid: Solid;
  volume: number;
  delta: number;
  bbox: Bbox;
};

/** Every revision's tape: one operation per parameter, repeat and geometry line. */
export function buildTape(program: TineProgram, values: Values): TapeStep[] {
  const scope = scopeWithDerived(program, resolveValues(program, values));
  const { perLine } = expand(program, scope);
  const steps: TapeStep[] = [];
  const accumulated: SolidOp[] = [];
  let previousVolume = 0;

  const push = (kind: TapeStep['kind'], op: string, line: number | null) => {
    const solid = canonicalSolid([...accumulated]);
    const measures = measure(solid);
    const volume = roundTo(measures.volume, 3);
    steps.push({
      index: steps.length,
      kind,
      op,
      line,
      solid,
      volume,
      delta: roundTo(volume - previousVolume, 3),
      bbox: [roundTo(measures.bbox[0], 3), roundTo(measures.bbox[1], 3), roundTo(measures.bbox[2], 3)],
    });
    previousVolume = volume;
  };

  push('start', 'empty', null);

  const addLine = (line: number) => {
    for (const op of perLine.get(line) ?? []) accumulated.push(op);
  };

  for (const statement of program.statements) {
    switch (statement.k) {
      case 'param':
        push('params', `param ${statement.name}`, statement.line);
        break;
      case 'let':
        push('params', `let ${statement.name}`, statement.line);
        break;
      case 'body':
        addLine(statement.line);
        push('body', statement.verb, statement.line);
        break;
      case 'cut':
        addLine(statement.line);
        push(statement.verb === 'boss' ? 'join' : 'cut', statement.verb, statement.line);
        break;
      case 'repeat': {
        push('params', 'repeat', statement.line);
        for (const enclosed of statement.body) {
          if (enclosed.k !== 'cut') continue;
          addLine(enclosed.line);
          push(enclosed.verb === 'boss' ? 'join' : 'cut', enclosed.verb, enclosed.line);
        }
        break;
      }
    }
  }
  return steps;
}

/** The source cut off after a tape operation's line, closing an open repeat block. */
export function truncateSource(source: string, program: TineProgram, operation: number): string {
  const steps = buildTape(program, {});
  const line = steps[operation].line!;
  const kept = source.split('\n').slice(0, line);
  const text = kept.join('\n');
  const opens = (text.match(/^\s*repeat .*\{\s*$/gm) ?? []).length;
  const closes = (text.match(/^\s*\}\s*$/gm) ?? []).length;
  return opens > closes ? `${text}\n}\n` : `${text}\n`;
}
