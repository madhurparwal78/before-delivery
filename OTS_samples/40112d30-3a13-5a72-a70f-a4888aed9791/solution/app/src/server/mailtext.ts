import type { Resolved } from './engine/index.ts';
import { M29 } from '../shared/messages.ts';

/** `<label>: <answer>` for each shown question in order; hidden calculated fields and notes are left out. */
export function answerLines(res: Resolved): string[] {
  const shown = new Set(res.pages.filter((p) => p.state === 'lit').map((p) => p.key));
  return res.questions
    .filter((q) => q.state === 'lit' && shown.has(q.page) && !(q.calc && q.calc.hidden))
    .map((q) => `${q.label}: ${q.text === '' ? M29 : q.text}`);
}
