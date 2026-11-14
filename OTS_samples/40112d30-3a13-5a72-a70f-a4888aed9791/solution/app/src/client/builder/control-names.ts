import type { Change } from '../../shared/types.ts';
import { FORM_KEY } from '../../shared/draft.ts';

// The accessible name of each builder control, by the draft field it edits. One table, so a conflict notice
// names a field the way the person sees it.

export const CONTROL_NAMES = {
  label: 'Question label',
  help: 'Help text',
  required: 'Required',
  options: 'Options',
  rows: 'Rows',
  columns: 'Columns',
  min: 'Minimum',
  max: 'Maximum',
  pattern: 'Pattern',
  note: 'Internal note',
  show_rule: 'Show when',
  formula: 'Formula',
  places: 'Decimal places',
  prefix: 'Prefix',
  suffix: 'Suffix',
  hidden: 'Hidden from respondents',
  jumps: 'Jump when',
  checks: 'Check message',
  pageTitle: 'Page title',
  formTitle: 'Form title',
} as const;

type SetChange = Extract<Change, { op: 'set' }>;

/** The lower-case name of the control a `set` change edits, for the conflict notice. */
export function controlNameOf(change: SetChange): string {
  if (change.field === 'title') return (change.key === FORM_KEY ? CONTROL_NAMES.formTitle : CONTROL_NAMES.pageTitle).toLowerCase();
  const name = (CONTROL_NAMES as Record<string, string>)[change.field];
  return (name ?? change.field).toLowerCase();
}
