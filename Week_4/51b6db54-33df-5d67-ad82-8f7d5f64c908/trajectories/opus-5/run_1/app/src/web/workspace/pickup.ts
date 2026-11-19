export interface PickupItem {
  label: string;
  node: HTMLElement;
}

export interface PickupOptions {
  container: HTMLElement;
  items: PickupItem[];
  announce(text: string): void;
  onSelect(at: number): void;
  onDrop(order: number[]): void;
}

const wiredKeys = new WeakMap<HTMLElement, (event: KeyboardEvent) => void>();

/**
 * Roving focus with keyboard pick-up: Enter selects, Space lifts, arrows move,
 * Space drops, Escape cancels, each step writing its published line.
 */
export function wirePickup(options: PickupOptions): void {
  const { container, items, announce } = options;
  const total = items.length;
  let focused = 0;
  let liftedFrom: number | null = null;
  let liftedLabel = '';
  let order = items.map((_item, at) => at);

  const place = (): void => {
    for (const at of order) container.append(items[at].node);
    items.forEach((item, at) => {
      item.node.tabIndex = order.indexOf(at) === focused ? 0 : -1;
    });
  };

  const focus = (position: number): void => {
    focused = Math.min(Math.max(position, 0), total - 1);
    items.forEach((item, at) => {
      item.node.tabIndex = order.indexOf(at) === focused ? 0 : -1;
    });
    const node = items[order[focused]].node;
    node.focus();
  };

  items.forEach((item, at) => {
    item.node.tabIndex = at === 0 ? 0 : -1;
    item.node.addEventListener('focus', () => {
      focused = order.indexOf(at);
    });
    item.node.addEventListener('click', () => {
      focused = order.indexOf(at);
      options.onSelect(at);
    });
  });

  const onKey = (event: KeyboardEvent): void => {
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'ArrowLeft' || key === 'ArrowRight') {
      const step = key === 'ArrowDown' || key === 'ArrowRight' ? 1 : -1;
      event.preventDefault();
      if (liftedFrom === null) {
        focus(focused + step);
        return;
      }
      const to = Math.min(Math.max(focused + step, 0), total - 1);
      if (to === focused) return;
      const moving = order[focused];
      order.splice(focused, 1);
      order.splice(to, 0, moving);
      focused = to;
      place();
      items[moving].node.focus();
      announce(`Moved ${liftedLabel}, position ${to + 1} of ${total}`);
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      if (liftedFrom === null) {
        liftedFrom = focused;
        liftedLabel = items[order[focused]].label;
        announce(`Lifted ${liftedLabel}, position ${focused + 1} of ${total}`);
        return;
      }
      liftedFrom = null;
      announce(`Dropped ${liftedLabel}, position ${focused + 1} of ${total}`);
      options.onDrop([...order]);
      return;
    }
    if (key === 'Escape' && liftedFrom !== null) {
      event.preventDefault();
      const moving = order[focused];
      order.splice(focused, 1);
      order.splice(liftedFrom, 0, moving);
      announce(`Cancelled, ${liftedLabel} back at position ${liftedFrom + 1} of ${total}`);
      focused = liftedFrom;
      liftedFrom = null;
      place();
      items[moving].node.focus();
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      options.onSelect(order[focused]);
    }
  };

  const previous = wiredKeys.get(container);
  if (previous !== undefined) container.removeEventListener('keydown', previous);
  container.addEventListener('keydown', onKey);
  wiredKeys.set(container, onKey);
}
