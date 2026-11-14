import type { EvalQuestion } from '../../../shared/types.ts';
import { h } from '../../lib/dom.ts';

/** `label` names one control, `legend` names a fieldset, `text` names a composite (grid, ranking). */
type LabelKind = 'label' | 'legend' | 'text';
type GroupRole = 'radiogroup' | 'group';

export const controlId = (key: string): string => `q-${key}`;
const errorId = (key: string): string => `error-${key}`;
export const labelId = (key: string): string => `label-${key}`;
const helpId = (key: string): string => `help-${key}`;

/** The label, help and error that every question block carries, and the attributes that tie them to the control. */
interface Shell {
  readonly root: HTMLElement;
  /** The elements that get `aria-describedby` and `aria-invalid`. A fieldset shell is its own target. */
  bind(...targets: HTMLElement[]): void;
  describeWith(...ids: string[]): void;
  relabel(label: string, help: string | null): void;
  showError(message: string): void;
  clearError(): void;
}

function labelElement(key: string, kind: LabelKind, text: string): HTMLElement {
  const props = { id: labelId(key), class: 'q-label' };
  if (kind === 'label') return h('label', { ...props, for: controlId(key) }, text);
  return kind === 'legend' ? h('legend', props, text) : h('div', props, text);
}

export function createShell(item: EvalQuestion, kind: LabelKind, role?: GroupRole): Shell {
  const { key } = item;
  const label = labelElement(key, kind, item.label);
  const root = kind === 'legend'
    ? h('fieldset', { class: 'question', id: controlId(key), 'data-question': key, role, 'aria-labelledby': role ? labelId(key) : null }, label)
    : h('div', { class: 'question', id: kind === 'text' ? controlId(key) : null, 'data-question': key }, label);
  let targets: HTMLElement[] = kind === 'legend' ? [root] : [];
  let extra: string[] = [];
  let help: HTMLElement | null = null;
  let error: HTMLElement | null = null;

  function refresh(): void {
    const ids = [help ? helpId(key) : '', ...extra, error ? errorId(key) : ''].filter(Boolean);
    for (const target of targets) {
      if (ids.length > 0) target.setAttribute('aria-describedby', ids.join(' '));
      else target.removeAttribute('aria-describedby');
      if (error) target.setAttribute('aria-invalid', 'true');
      else target.removeAttribute('aria-invalid');
    }
  }

  return {
    root,
    bind(...bound) {
      targets = bound;
      refresh();
    },
    describeWith(...ids) {
      extra = ids;
      refresh();
    },
    relabel(text, helpText) {
      if (label.textContent !== text) label.textContent = text;
      if (helpText === null) {
        help?.remove();
        help = null;
      } else if (help) {
        if (help.textContent !== helpText) help.textContent = helpText;
      } else {
        help = h('p', { id: helpId(key), class: 'q-help' }, helpText);
        label.after(help);
      }
      refresh();
    },
    showError(message) {
      if (error) {
        error.textContent = message;
        return;
      }
      error = h('p', { id: errorId(key), class: 'error-text' }, message);
      root.append(error);
      refresh();
    },
    clearError() {
      error?.remove();
      error = null;
      refresh();
    },
  };
}
