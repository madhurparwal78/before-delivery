/** Live character counters, counting exactly as the server counts. */

import { countCodePoints } from '../shared/text.js';
import { el, setText } from './dom.js';
import type { DeskMessages } from './messages.js';

export interface CountedField {
  field: HTMLInputElement | HTMLTextAreaElement;
  counter: HTMLElement;
  error: HTMLElement;
  used(): number;
  refresh(): void;
  showError(copy: string): void;
}

export interface CountedFieldSpec {
  field: HTMLInputElement | HTMLTextAreaElement;
  limit: number;
  overLimitCopy: string;
  messages: DeskMessages;
}

export function countedField(spec: CountedFieldSpec): CountedField {
  const counter = el('span', { class: 'counter' }, [`${countCodePoints(spec.field.value)}/${spec.limit}`]);
  const error = el('p', { class: 'field-error' });
  let wasOver = countCodePoints(spec.field.value) > spec.limit;

  const refresh = (announce: boolean): void => {
    const used = countCodePoints(spec.field.value);
    setText(counter, `${used}/${spec.limit}`);
    const over = used > spec.limit;
    counter.classList.toggle('over-limit', over);
    spec.field.classList.toggle('over-limit', over);
    if (over) {
      setText(error, spec.overLimitCopy);
      if (announce && !wasOver) spec.messages.result(spec.overLimitCopy);
    } else {
      setText(error, '');
    }
    wasOver = over;
  };

  spec.field.addEventListener('input', () => refresh(true));
  refresh(false);

  return {
    field: spec.field,
    counter,
    error,
    used: () => countCodePoints(spec.field.value),
    refresh: () => refresh(false),
    showError: (copy: string) => setText(error, copy),
  };
}
