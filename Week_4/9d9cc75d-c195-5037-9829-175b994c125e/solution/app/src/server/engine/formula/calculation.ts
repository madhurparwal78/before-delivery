// Saving a calculation: a name, a formula that passes checks 1 to 8, and no cycle through other calculations (check 9).
import type { CalculationDef, FormulaCheck } from '../../../shared/model.ts';
import { nameClash } from '../../sources/fields.ts';
import type { CalculationDraft, CalculationErrors, FormulaLimits, SheetScope } from '../contract.ts';
import { Resolver } from './checker.ts';
import { findCycle } from './names.ts';

const NAME_REQUIRED = 'Name is required.';

export function checkFormula(text: string, scope: SheetScope, limits: FormulaLimits): FormulaCheck {
  const checked = new Resolver(scope, limits).check(text);
  if (!checked.ok) return { valid: false, ...checked.error };
  const { root, level } = checked.analysis;
  return { valid: true, type: root.type ?? 'text', aggregate: level === 'agg' };
}

export function validateCalculation(draft: CalculationDraft, scope: SheetScope, limits: FormulaLimits): CalculationErrors {
  const errors: CalculationErrors = {};
  const name = draft.name.trim();
  if (name === '') errors.name = NAME_REQUIRED;
  else if (scope.dataset.byName.has(name) || scope.calculations.some((c) => c.name === name && c.id !== draft.id)) {
    errors.name = nameClash(name);
  }
  const self: CalculationDef = { id: draft.id ?? '', name, formula: draft.formula };
  const calculations = [...scope.calculations.filter((c) => c.id !== draft.id), self];
  const checked = new Resolver({ ...scope, calculations }, limits).check(draft.formula);
  if (!checked.ok) {
    errors.formula = checked.error.message;
    return errors;
  }
  const byName = new Map(calculations.map((c) => [c.name, c.formula]));
  const cycle = findCycle(name, (n) => (scope.dataset.byName.has(n) ? undefined : byName.get(n)));
  if (cycle) errors.formula = `Cycle: ${cycle.join(' -> ')}.`;
  return errors;
}
