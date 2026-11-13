import { el } from './dom.js';

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

export interface RadioGroupOptions {
  readonly label: string;
  readonly options: readonly ChoiceOption[];
  readonly value: string;
  /** Report every selection, not only a change, so choosing `custom` reopens its dialog. */
  readonly notifyAlways?: boolean;
  onChange(value: string): void;
}

export interface RadioGroupHandle {
  readonly element: HTMLElement;
  focusChecked(): void;
}

/** Radios change by arrow keys, click or tap only, with roving focus over one Tab stop. */
export function radioGroup(options: RadioGroupOptions): RadioGroupHandle {
  const group = el('div', { role: 'radiogroup', 'aria-label': options.label, class: 'radiogroup' });
  const radios: HTMLElement[] = [];
  let current = options.value;

  const paint = (): void => {
    radios.forEach((radio, index) => {
      const checked = options.options[index]?.value === current;
      radio.setAttribute('aria-checked', checked ? 'true' : 'false');
      radio.setAttribute('tabindex', checked ? '0' : '-1');
    });
  };

  const select = (index: number, focus: boolean): void => {
    const option = options.options[index];
    if (!option) return;
    const changed = option.value !== current;
    current = option.value;
    paint();
    if (focus) radios[index]?.focus();
    if (changed || options.notifyAlways === true) options.onChange(option.value);
  };

  options.options.forEach((option, index) => {
    const radio = el(
      'div',
      { role: 'radio', class: 'radio', 'data-value': option.value },
      [option.label],
    );
    radio.addEventListener('click', () => select(index, false));
    radio.addEventListener('keydown', (event) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      select((index + step + radios.length) % radios.length, true);
    });
    radios.push(radio);
    group.append(radio);
  });
  paint();

  return {
    element: group,
    focusChecked(): void {
      const index = options.options.findIndex((option) => option.value === current);
      radios[index === -1 ? 0 : index]?.focus();
    },
  };
}

export interface TabListOptions {
  readonly label: string;
  readonly tabs: readonly ChoiceOption[];
  readonly value: string;
  onChange(value: string): void;
}

/** Board tabs: arrow keys move and select at once, and only the selected tab is in the Tab order. */
export function tabList(options: TabListOptions): HTMLElement {
  const list = el('div', { role: 'tablist', 'aria-label': options.label, class: 'tablist' });
  const tabs: HTMLElement[] = [];
  let current = options.value;

  const paint = (): void => {
    tabs.forEach((tab, index) => {
      const selected = options.tabs[index]?.value === current;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.setAttribute('tabindex', selected ? '0' : '-1');
    });
  };

  const select = (index: number, focus: boolean): void => {
    const tab = options.tabs[index];
    if (!tab) return;
    const changed = tab.value !== current;
    current = tab.value;
    paint();
    if (focus) tabs[index]?.focus();
    if (changed) options.onChange(tab.value);
  };

  options.tabs.forEach((tab, index) => {
    const node = el(
      'button',
      { type: 'button', role: 'tab', class: 'tab', 'data-value': tab.value },
      [tab.label],
    );
    node.addEventListener('click', () => select(index, false));
    node.addEventListener('keydown', (event) => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      event.preventDefault();
      select((index + step + tabs.length) % tabs.length, true);
    });
    tabs.push(node);
    list.append(node);
  });
  paint();

  return list;
}
