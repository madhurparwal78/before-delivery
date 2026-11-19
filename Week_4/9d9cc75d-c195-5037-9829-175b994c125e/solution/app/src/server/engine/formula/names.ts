// Formulas are stored with ids in place of names (fields, calculations, sets, parameters) and shown with current names,
// so a rename carries into every formula. Only bracket tokens change; everything else is kept byte for byte.
import type { SheetScope } from '../contract.ts';
import { Lexer } from './lexer.ts';

interface Named {
  id: string;
  name: string;
}

function namedThings(scope: SheetScope): { fields: Named[]; params: Named[] } {
  return {
    fields: [...scope.dataset.fields, ...scope.calculations, ...scope.sets],
    params: scope.parameters,
  };
}

/** Rewrites each `[x]` and `[@x]` through the maps, stopping at the first token the lexer cannot read. */
function rewrite(text: string, fields: ReadonlyMap<string, string>, params: ReadonlyMap<string, string>): string {
  const lexer = new Lexer(text);
  let out = '';
  let copied = 0;
  for (let token = lexer.next(); token.kind !== 'end' && token.kind !== 'open'; token = lexer.next()) {
    const map = token.kind === 'field' ? fields : token.kind === 'param' ? params : null;
    const replacement = map?.get(token.value);
    if (replacement === undefined) continue;
    out += text.slice(copied, token.start) + (token.kind === 'param' ? `[@${replacement}]` : `[${replacement}]`);
    copied = token.stop;
  }
  return out + text.slice(copied);
}

export function toStoredFormula(text: string, scope: SheetScope): string {
  const { fields, params } = namedThings(scope);
  const byName = new Map<string, string>();
  for (const thing of fields) if (!byName.has(thing.name)) byName.set(thing.name, thing.id);
  return rewrite(text, byName, new Map(params.map((p) => [p.name, p.id])));
}

export function toDisplayFormula(stored: string, scope: SheetScope): string {
  const { fields, params } = namedThings(scope);
  return rewrite(stored, new Map(fields.map((f) => [f.id, f.name])), new Map(params.map((p) => [p.id, p.name])));
}

/** The names a formula refers to in brackets (not parameters), in text order. */
function referencedNames(text: string): string[] {
  const lexer = new Lexer(text);
  const names: string[] = [];
  for (let token = lexer.next(); token.kind !== 'end' && token.kind !== 'open'; token = lexer.next()) {
    if (token.kind === 'field') names.push(token.value);
  }
  return names;
}

/**
 * The chain from the calculation being saved back to itself through the calculations its formula names, or null.
 * `formulaOf` gives each calculation's formula by name, with the one being saved already in place.
 */
export function findCycle(start: string, formulaOf: (name: string) => string | undefined): string[] | null {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (name: string): string[] | null => {
    const formula = formulaOf(name);
    if (formula === undefined || done.has(name)) return null;
    path.push(name);
    for (const next of referencedNames(formula)) {
      if (next === start) return [...path, start];
      if (path.includes(next)) continue;
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    done.add(name);
    return null;
  };
  return visit(start);
}
