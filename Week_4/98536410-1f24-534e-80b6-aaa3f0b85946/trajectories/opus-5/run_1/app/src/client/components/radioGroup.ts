import { clear, el, on } from '../lib/dom.js';

export type RadioOption = { value: string; label: string };

export type RadioGroup = {
  node: HTMLElement;
  setOptions: (options: RadioOption[]) => void;
  value: () => string | null;
  setValue: (value: string | null) => void;
  focus: () => void;
};

/** A radiogroup that is one Tab stop, with the arrow keys moving between its radios. */
export function radioGroup(
  label: string,
  focusId: string,
  onChange: (value: string) => void,
): RadioGroup {
  const node = el('div', {
    class: 'radio-group',
    role: 'radiogroup',
    'aria-label': label,
    'data-focus-id': focusId,
  });
  let chosen: string | null = null;

  const radios = (): HTMLElement[] => [...node.querySelectorAll<HTMLElement>('[role="radio"]')];

  function paint(): void {
    const all = radios();
    const checkedIndex = all.findIndex((radio) => radio.dataset['value'] === chosen);
    all.forEach((radio, index) => {
      const isChecked = radio.dataset['value'] === chosen;
      radio.setAttribute('aria-checked', isChecked ? 'true' : 'false');
      radio.tabIndex = isChecked || (checkedIndex === -1 && index === 0) ? 0 : -1;
    });
  }

  function choose(value: string): void {
    chosen = value;
    paint();
    onChange(value);
  }

  on(node, 'keydown', (event) => {
    const key = (event as KeyboardEvent).key;
    const all = radios();
    if (all.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const at = all.findIndex((radio) => radio === active);
    let next = -1;
    if (key === 'ArrowRight' || key === 'ArrowDown') next = (at + 1 + all.length) % all.length;
    if (key === 'ArrowLeft' || key === 'ArrowUp') next = (at - 1 + all.length) % all.length;
    if (next !== -1) {
      event.preventDefault();
      const radio = all[next] as HTMLElement;
      choose(radio.dataset['value'] as string);
      radio.focus();
      return;
    }
    if ((key === ' ' || key === 'Enter') && at !== -1) {
      event.preventDefault();
      choose((all[at] as HTMLElement).dataset['value'] as string);
    }
  });

  return {
    node,
    setOptions: (options) => {
      const keep = chosen;
      clear(node);
      for (const option of options) {
        const radio = el(
          'div',
          {
            class: 'radio-option',
            role: 'radio',
            'aria-checked': 'false',
            'data-value': option.value,
            tabindex: '-1',
          },
          option.label,
        );
        on(radio, 'click', () => choose(option.value));
        node.appendChild(radio);
      }
      chosen = options.some((option) => option.value === keep) ? keep : null;
      paint();
    },
    value: () => chosen,
    setValue: (value) => {
      chosen = value;
      paint();
    },
    focus: () => {
      const all = radios();
      const target = all.find((radio) => radio.tabIndex === 0) ?? all[0];
      (target ?? node).focus();
    },
  };
}
