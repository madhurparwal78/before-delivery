export type SuggestKind = 'field' | 'operator' | 'value' | 'none';

export type SuggestTarget =
  | { kind: 'field'; typed: string }
  | { kind: 'operator'; field: string; typed: string }
  | { kind: 'value'; field: string; typed: string }
  | { kind: 'none' };

const BREAKERS = /[\s()}{]/;

/** Rule F: what to suggest is decided by the text before the caret. */
export function suggestTarget(
  query: string,
  cursor: number,
  isField: (name: string) => boolean,
): SuggestTarget {
  const chars = Array.from(query);
  const at = Math.max(0, Math.min(cursor, chars.length));
  let start = at;
  while (start > 0 && !BREAKERS.test(chars[start - 1])) start -= 1;
  const fragment = chars.slice(start, at).join('');
  const match = /^([^:<>]*)(>=|<=|:|>|<)([\s\S]*)$/.exec(fragment);
  if (!match) {
    if (fragment !== '' && isField(fragment)) return { kind: 'operator', field: fragment, typed: '' };
    return { kind: 'field', typed: fragment };
  }
  const [, field, operator, rest] = match;
  if (!isField(field)) return { kind: 'none' };
  if (rest === '' && (operator === '>' || operator === '<')) {
    return { kind: 'operator', field, typed: operator };
  }
  const typed = rest.startsWith('"') ? rest.slice(1) : rest;
  return { kind: 'value', field, typed };
}

export function operatorItems(type: string, typed: string): { label: string; insert: string }[] {
  const all = type === 'number' || type === 'date' ? [':', '>', '>=', '<', '<='] : [':'];
  return all
    .filter((operator) => operator.startsWith(typed))
    .map((operator) => ({ label: operator, insert: operator }));
}

const PLAIN_VALUE = /^[A-Za-z0-9\-_./]*$/;

export function valueInsert(value: string): string {
  if (PLAIN_VALUE.test(value)) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
