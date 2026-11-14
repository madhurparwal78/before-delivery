import { h } from '../lib/dom.ts';
import { alertText } from '../lib/live.ts';

// `#formula-error`: the exact refusal of a rule, jump, formula or check. The box that was refused is marked
// invalid and keeps (or gets back) the focus.

export interface FormulaError {
  element: HTMLElement;
  show: (message: string, box: HTMLElement) => void;
  clear: () => void;
}

export function formulaError(): FormulaError {
  const element = h('p', { id: 'formula-error', class: 'error-text' });
  let marked: HTMLElement | null = null;
  const clear = (): void => {
    element.textContent = '';
    marked?.removeAttribute('aria-invalid');
    marked?.removeAttribute('aria-describedby');
    marked = null;
  };
  return {
    element,
    clear,
    show: (message, box) => {
      clear();
      element.textContent = message;
      alertText(message);
      box.setAttribute('aria-invalid', 'true');
      box.setAttribute('aria-describedby', element.id);
      marked = box;
      box.focus();
    },
  };
}
