import type { Evaluation } from '../../shared/types.ts';
import { h } from '../lib/dom.ts';

export interface ActionHandlers {
  back(): void;
  next(): void;
  submit(): void;
  save(opener: HTMLElement): void;
}

type Pending = 'back' | 'primary' | null;

/** Back, Next or Submit, and Save and finish later. Submit takes the place of Next on the last shown page. */
export interface Actions {
  readonly element: HTMLElement;
  update(evaluation: Evaluation): void;
  /** Next, or Submit on the last shown page. */
  primary(): HTMLButtonElement;
  busy(pending: Pending): void;
}

function mark(button: HTMLButtonElement, busy: boolean): void {
  if (busy) button.setAttribute('aria-busy', 'true');
  else button.removeAttribute('aria-busy');
}

export function createActions(handlers: ActionHandlers): Actions {
  const back = h('button', { type: 'button', onclick: handlers.back }, 'Back');
  const next = h('button', { type: 'button', class: 'primary', onclick: handlers.next }, 'Next');
  const submit = h('button', { type: 'button', class: 'primary', onclick: handlers.submit }, 'Submit');
  const save = h('button', { type: 'button', class: 'plain', onclick: () => handlers.save(save) }, 'Save and finish later');
  const element = h('div', { class: 'actions' });
  let primary = next;

  return {
    element,
    update(evaluation) {
      primary = evaluation.page_number === evaluation.shown_pages ? submit : next;
      const wanted = [evaluation.page_number > 1 ? back : null, primary, save].filter((button) => button !== null);
      if (wanted.length !== element.children.length || wanted.some((button, index) => element.children[index] !== button)) element.replaceChildren(...wanted);
    },
    primary: () => primary,
    busy(pending) {
      mark(back, pending === 'back');
      mark(next, pending === 'primary' && primary === next);
      mark(submit, pending === 'primary' && primary === submit);
    },
  };
}
