import type { Evaluation } from '../../shared/types.ts';
import { M06, M07, M08, M09, M12 } from '../../shared/messages.ts';
import { h } from '../lib/dom.ts';
import { litQuestions, type Run } from './run.ts';

/** The path notice of a commit: answers it hid, answers it brought back, or nothing. */
export function pathSentence(evaluation: Evaluation): string {
  const hidden = evaluation.hidden_now === 1 ? M06 : evaluation.hidden_now > 1 ? M07(evaluation.hidden_now) : '';
  const restored = evaluation.restored === 1 ? M08 : evaluation.restored > 1 ? M09(evaluation.restored) : '';
  return [hidden, restored].filter(Boolean).join(' ');
}

/** The M12 lines of the shown calculated fields whose text this reply changed, in form order. */
export function changedCalculations(run: Run, after: Evaluation): string[] {
  const page = after.pages.find((candidate) => candidate.key === run.page);
  if (!page) return [];
  return litQuestions(page)
    .filter((item) => run.structure[item.key]?.type === 'calculated')
    .filter((item) => run.evaluation.values[item.key]?.text !== after.values[item.key]?.text)
    .map((item) => M12(item.label, after.values[item.key]?.text ?? ''));
}

/** A plain line of text above the questions (#notice, #path-notice); null or empty text removes it. */
export function placeBanner(current: HTMLElement | null, id: string, text: string | null, anchor: Element): HTMLElement | null {
  if (!text) {
    current?.remove();
    return null;
  }
  const banner = current ?? h('p', { id, class: 'banner' });
  banner.textContent = text;
  if (!current) anchor.after(banner);
  return banner;
}
