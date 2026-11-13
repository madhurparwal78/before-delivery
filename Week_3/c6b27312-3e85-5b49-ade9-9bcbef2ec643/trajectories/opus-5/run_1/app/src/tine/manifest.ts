import { sentenceCaseLabel } from '../shared/labels';
import { Expr, ParameterKind, TineProgram } from './ast';

export type ParameterValue = number | boolean | string;
export type Values = Record<string, ParameterValue>;

export type ManifestEntry = {
  name: string;
  label: string;
  kind: ParameterKind;
  unit: 'mm' | '°' | null;
  value: ParameterValue;
  default: ParameterValue;
  min?: number;
  max?: number;
  step?: number;
  precision: number;
  options?: string[];
  group: string;
  derived: boolean;
  order: number;
};

/** The step and display precision derived from the default when the source declares none. */
export function derivedStep(defaultValue: number): { step: number; precision: number } {
  const magnitude = defaultValue === 0 ? 0 : Math.floor(Math.log10(Math.abs(defaultValue)));
  return { step: 10 ** (magnitude - 2), precision: Math.max(0, 2 - magnitude) };
}

export function precisionOfNumber(defaultValue: number): number {
  return derivedStep(defaultValue).precision;
}

export function evaluateExpr(expr: Expr, scope: Values): number {
  switch (expr.k) {
    case 'num':
      return expr.v;
    case 'ref': {
      const value = scope[expr.name];
      return typeof value === 'number' ? value : typeof value === 'boolean' ? (value ? 1 : 0) : 0;
    }
    case 'neg':
      return -evaluateExpr(expr.a, scope);
    case 'bin': {
      const a = evaluateExpr(expr.a, scope);
      const b = evaluateExpr(expr.b, scope);
      switch (expr.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          return a / b;
      }
    }
    // eslint-disable-next-line no-fallthrough
    case 'pick': {
      const chosen = scope[expr.enumName];
      const option = expr.options.find((entry) => entry.option === chosen);
      return option ? option.value : 0;
    }
  }
}

export function sourceDefaults(program: TineProgram): Values {
  const values: Values = {};
  for (const parameter of program.parameters) {
    if (parameter.k === 'let') continue;
    if (parameter.kind === 'boolean') values[parameter.name] = parameter.defaultBoolean!;
    else if (parameter.kind === 'enum') values[parameter.name] = parameter.defaultOption!;
    else values[parameter.name] = parameter.defaultNumber!;
  }
  return values;
}

/** The source defaults with the given values applied; unknown names are ignored. */
export function resolveValues(program: TineProgram, provided: Values): Values {
  const values = sourceDefaults(program);
  for (const parameter of program.parameters) {
    if (parameter.k === 'let') continue;
    if (Object.prototype.hasOwnProperty.call(provided, parameter.name)) {
      values[parameter.name] = provided[parameter.name];
    }
  }
  return values;
}

/** The parameter scope used by expressions: declared values plus every derived length. */
export function scopeWithDerived(program: TineProgram, values: Values): Values {
  const scope: Values = { ...values };
  for (const parameter of program.parameters) {
    if (parameter.k === 'let') scope[parameter.name] = evaluateExpr(parameter.expr, scope);
  }
  return scope;
}

export function buildManifest(program: TineProgram, values: Values): ManifestEntry[] {
  const defaults = sourceDefaults(program);
  const defaultScope = scopeWithDerived(program, defaults);
  const currentScope = scopeWithDerived(program, resolveValues(program, values));
  return program.parameters.map((parameter, order) => {
    if (parameter.k === 'let') {
      const defaultValue = defaultScope[parameter.name] as number;
      return {
        name: parameter.name,
        label: sentenceCaseLabel(parameter.name),
        kind: 'length' as ParameterKind,
        unit: 'mm' as const,
        value: currentScope[parameter.name],
        default: defaultValue,
        precision: precisionOfNumber(defaultValue),
        group: parameter.group,
        derived: true,
        order,
      };
    }
    const entry: ManifestEntry = {
      name: parameter.name,
      label: sentenceCaseLabel(parameter.name),
      kind: parameter.kind,
      unit: parameter.kind === 'length' ? 'mm' : parameter.kind === 'angle' ? '°' : null,
      value: currentScope[parameter.name],
      default:
        parameter.kind === 'boolean'
          ? parameter.defaultBoolean!
          : parameter.kind === 'enum'
            ? parameter.defaultOption!
            : parameter.defaultNumber!,
      precision: 0,
      group: parameter.group,
      derived: false,
      order,
    };
    if (parameter.min !== undefined) entry.min = parameter.min;
    if (parameter.max !== undefined) entry.max = parameter.max;
    if (parameter.kind === 'count') {
      entry.step = 1;
      entry.precision = 0;
    } else if (parameter.kind === 'length' || parameter.kind === 'angle') {
      if (parameter.stepText !== undefined) {
        entry.step = Number(parameter.stepText);
        const dot = parameter.stepText.indexOf('.');
        entry.precision = dot === -1 ? 0 : parameter.stepText.length - dot - 1;
      } else {
        const derived = derivedStep(parameter.defaultNumber!);
        entry.step = derived.step;
        entry.precision = derived.precision;
      }
    }
    if (parameter.kind === 'enum') entry.options = parameter.options!;
    return entry;
  });
}
