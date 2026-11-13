import { el, focus, on } from '../core/dom';

export interface Chip {
  id: string;
  label: string;
}

export interface ChipGroup {
  element: HTMLElement;
  pressed(): string[];
  setPressed(values: ReadonlyArray<string>): void;
  setCounts(counts: Record<string, number>): void;
}

interface ChipGroupSettings {
  name: string;
  chips: ReadonlyArray<Chip>;
  /** Reports the change that started the search, for the announcement. */
  onToggle(change: { chip: Chip; added: boolean }): void;
  clearButton?: () => HTMLElement | null;
}

/** Space or Enter toggles; Delete or Backspace removes a pressed chip. */
export function chipGroup(settings: ChipGroupSettings): ChipGroup {
  const group = el('div', { role: 'group', 'aria-label': settings.name, class: 'chip-group' });
  const buttons = new Map<string, HTMLButtonElement>();
  const countNodes = new Map<string, HTMLElement>();
  const pressed = new Set<string>();

  const paint = (): void => {
    for (const [id, button] of buttons) button.setAttribute('aria-pressed', pressed.has(id) ? 'true' : 'false');
  };

  const toggle = (chip: Chip): void => {
    const added = !pressed.has(chip.id);
    if (added) pressed.add(chip.id);
    else pressed.delete(chip.id);
    paint();
    settings.onToggle({ chip, added });
  };

  for (const chip of settings.chips) {
    const button = el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', text: chip.label });
    const count = el('span', { class: 'chip-count', text: '0' });
    on(button, 'click', () => toggle(chip));
    on(button, 'keydown', (event) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        toggle(chip);
        return;
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      event.preventDefault();
      if (!pressed.has(chip.id)) return;
      toggle(chip);
      const order = settings.chips.map((item) => item.id);
      const next = order[order.indexOf(chip.id) + 1];
      const nextButton = next ? buttons.get(next) : null;
      focus(nextButton ?? settings.clearButton?.() ?? null);
    });
    buttons.set(chip.id, button);
    countNodes.set(chip.id, count);
    group.append(el('span', { class: 'chip-holder' }, [button, count]));
  }

  return {
    element: group,
    pressed: () => settings.chips.filter((chip) => pressed.has(chip.id)).map((chip) => chip.id),
    setPressed: (values) => {
      pressed.clear();
      for (const value of values) if (buttons.has(value)) pressed.add(value);
      paint();
    },
    setCounts: (counts) => {
      for (const [id, node] of countNodes) node.textContent = String(counts[id] ?? 0);
    },
  };
}
