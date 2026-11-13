import { Pose } from './api';
import { clear, el, icon, on } from './dom';

export type FindingOption = {
  id: string;
  severity: 'Blocking' | 'Advisory' | 'Pass';
  text: string;
  parameters: string[];
  pose: Pose | null;
  stale?: boolean;
};

export function optionName(option: FindingOption): string {
  return `${option.severity}: ${option.text}`;
}

/** The Findings listbox: focus stays on the list, walked by arrows, Home, End and type-ahead. */
export class FindingsList {
  readonly region: HTMLElement;
  readonly listbox: HTMLElement;
  private readonly actions: HTMLElement;
  private options: FindingOption[] = [];
  private activeId: string | null = null;
  private selectedId: string | null = null;
  private search = '';
  private searchAt = 0;

  constructor(
    private readonly onSelect: (option: FindingOption) => void,
    private readonly onGoTo: (parameter: string) => void,
    private readonly labelOf: (parameter: string) => string,
  ) {
    this.listbox = el('div', {
      role: 'listbox',
      'aria-label': 'Findings',
      tabindex: '0',
      class: 'findings-list',
    });
    this.actions = el('div', { class: 'findings-actions' });
    this.region = el('section', { role: 'region', 'aria-label': 'Findings', class: 'findings' }, [
      el('h2', { class: 'section-title' }, ['Findings']),
      this.listbox,
      this.actions,
    ]);
    this.wireKeys();
  }

  private wireKeys(): void {
    on(this.listbox, 'keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      if (keyboard.isComposing) return;
      const index = this.options.findIndex((option) => option.id === this.activeId);
      if (keyboard.key === 'ArrowDown') {
        keyboard.preventDefault();
        this.setActive(this.options[Math.min(this.options.length - 1, index + 1)]?.id ?? this.activeId);
      } else if (keyboard.key === 'ArrowUp') {
        keyboard.preventDefault();
        this.setActive(this.options[Math.max(0, index - 1)]?.id ?? this.activeId);
      } else if (keyboard.key === 'Home') {
        keyboard.preventDefault();
        this.setActive(this.options[0]?.id ?? null);
      } else if (keyboard.key === 'End') {
        keyboard.preventDefault();
        this.setActive(this.options[this.options.length - 1]?.id ?? null);
      } else if (keyboard.key === 'Enter' || keyboard.key === ' ') {
        keyboard.preventDefault();
        const active = this.options.find((option) => option.id === this.activeId);
        if (active) this.select(active);
      } else if (keyboard.key.length === 1 && /\S/.test(keyboard.key)) {
        const now = performance.now();
        this.search = now - this.searchAt < 500 ? this.search + keyboard.key : keyboard.key;
        this.searchAt = now;
        const needle = this.search.toLowerCase();
        const from = index + (this.search.length > 1 ? 0 : 1);
        const ordered = [...this.options.slice(from), ...this.options.slice(0, from)];
        const match = ordered.find((option) => optionName(option).toLowerCase().startsWith(needle));
        if (match) {
          keyboard.preventDefault();
          this.setActive(match.id);
        }
      }
    });
  }

  private setActive(id: string | null): void {
    this.activeId = id;
    if (id) this.listbox.setAttribute('aria-activedescendant', id);
    else this.listbox.removeAttribute('aria-activedescendant');
    for (const node of this.listbox.children) {
      node.classList.toggle('is-active', node.id === id);
    }
  }

  private select(option: FindingOption): void {
    this.selectedId = option.id;
    for (const node of this.listbox.children) {
      node.setAttribute('aria-selected', node.id === option.id ? 'true' : 'false');
    }
    this.setActive(option.id);
    this.renderActions();
    this.onSelect(option);
  }

  selectedOption(): FindingOption | null {
    return this.options.find((option) => option.id === this.selectedId) ?? null;
  }

  private renderActions(): void {
    clear(this.actions);
    const selected = this.selectedOption();
    if (!selected) return;
    for (const parameter of selected.parameters) {
      const label = this.labelOf(parameter);
      const button = el('button', { type: 'button', class: 'chip' }, [`Go to ${label}`]);
      on(button, 'click', () => this.onGoTo(parameter));
      this.actions.append(button);
    }
  }

  /** A repaint keeps the active and selected option while an option of the same name exists. */
  setOptions(options: FindingOption[], stale = false): void {
    const activeName = this.options.find((option) => option.id === this.activeId);
    const selectedName = this.options.find((option) => option.id === this.selectedId);
    this.options = options;
    clear(this.listbox);
    for (const option of options) {
      const node = el(
        'div',
        {
          role: 'option',
          id: option.id,
          'aria-selected': option.id === this.selectedId ? 'true' : 'false',
          class: `finding-option severity-${option.severity.toLowerCase()}${stale ? ' is-stale' : ''}`,
        },
        [
          icon(option.severity.toLowerCase() as 'blocking' | 'advisory' | 'pass', stale),
          el('span', { class: 'finding-severity' }, [option.severity]),
          el('span', { class: 'finding-text' }, [option.text]),
        ],
      );
      node.setAttribute('aria-label', optionName(option));
      on(node, 'click', () => {
        this.select(option);
        this.listbox.focus();
      });
      this.listbox.append(node);
    }
    const keptActive = activeName
      ? options.find((option) => optionName(option) === optionName(activeName))
      : undefined;
    const keptSelected = selectedName
      ? options.find((option) => optionName(option) === optionName(selectedName))
      : undefined;
    this.selectedId = keptSelected?.id ?? null;
    for (const node of this.listbox.children) {
      node.setAttribute('aria-selected', node.id === this.selectedId ? 'true' : 'false');
    }
    this.setActive(keptActive?.id ?? options[0]?.id ?? null);
    this.renderActions();
  }
}
