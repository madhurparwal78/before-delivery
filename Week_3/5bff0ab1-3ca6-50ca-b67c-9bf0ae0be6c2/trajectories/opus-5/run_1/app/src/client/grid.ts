export interface GridCell {
  key: string;
  label: string;
  disabled: boolean;
}

/** One tab stop, a roving tabindex, and cells kept as the same nodes across re-reads. */
export class CellGrid {
  private readonly element: HTMLElement;
  private readonly cells = new Map<string, HTMLElement>();
  private order: string[] = [];
  private chosenKey: string | null = null;
  private focusKey: string | null = null;
  private readonly onChoose: (key: string | null) => void;

  constructor(container: HTMLElement, label: string, onChoose: (key: string | null) => void) {
    this.element = document.createElement('div');
    this.element.className = 'grid';
    this.element.setAttribute('role', 'grid');
    this.element.setAttribute('aria-label', label);
    this.onChoose = onChoose;
    container.append(this.element);
    this.element.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('resize', () => this.layout());
  }

  private columns(): number {
    return window.innerWidth <= 767 ? 2 : 4;
  }

  update(cells: readonly GridCell[]): void {
    this.order = cells.map((cell) => cell.key);
    for (const [key, node] of this.cells) {
      if (!this.order.includes(key)) {
        node.remove();
        this.cells.delete(key);
      }
    }
    for (const cell of cells) {
      let node = this.cells.get(cell.key);
      if (!node) {
        node = document.createElement('div');
        node.setAttribute('role', 'gridcell');
        node.tabIndex = -1;
        node.dataset.key = cell.key;
        node.addEventListener('click', () => this.pick(cell.key));
        this.cells.set(cell.key, node);
      }
      if (node.textContent !== cell.label) node.textContent = cell.label;
      node.setAttribute('aria-label', cell.label);
      node.setAttribute('aria-disabled', cell.disabled ? 'true' : 'false');
      node.setAttribute('aria-selected', cell.key === this.chosenKey ? 'true' : 'false');
    }
    if (this.chosenKey !== null) {
      const chosen = cells.find((cell) => cell.key === this.chosenKey);
      if (!chosen || chosen.disabled) {
        this.chosenKey = null;
        for (const [, node] of this.cells) node.setAttribute('aria-selected', 'false');
      }
    }
    this.layout();
  }

  private layout(): void {
    const columns = this.columns();
    const rows: HTMLElement[] = [];
    let row: HTMLElement | null = null;
    this.order.forEach((key, index) => {
      if (index % columns === 0) {
        row = document.createElement('div');
        row.setAttribute('role', 'row');
        row.className = 'grid-row';
        rows.push(row);
      }
      const node = this.cells.get(key);
      if (node && row) row.append(node);
    });
    this.element.replaceChildren(...rows);
    this.element.style.display = 'grid';
    this.element.style.gridTemplateColumns = '';
    for (const node of rows) {
      node.style.display = 'grid';
      node.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
      node.style.gap = '8px';
    }
    this.element.style.gap = '8px';
    this.applyRoving();
  }

  private applyRoving(): void {
    const first = this.focusKey ?? this.chosenKey ?? this.order[0] ?? null;
    for (const [key, node] of this.cells) node.tabIndex = key === first ? 0 : -1;
  }

  private pick(key: string): void {
    const node = this.cells.get(key);
    if (!node || node.getAttribute('aria-disabled') === 'true') return;
    this.chosenKey = this.chosenKey === key ? null : key;
    for (const [other, entry] of this.cells) {
      entry.setAttribute('aria-selected', other === this.chosenKey ? 'true' : 'false');
    }
    this.focusKey = key;
    this.applyRoving();
    this.onChoose(this.chosenKey);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const active = document.activeElement as HTMLElement | null;
    const key = active?.dataset.key;
    if (!key) return;
    const index = this.order.indexOf(key);
    if (index < 0) return;
    const columns = this.columns();
    let next = index;
    if (event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowLeft') next = index - 1;
    else if (event.key === 'ArrowDown') next = index + columns;
    else if (event.key === 'ArrowUp') next = index - columns;
    else if (event.key === 'Enter') {
      event.preventDefault();
      this.pick(key);
      return;
    } else return;
    event.preventDefault();
    next = Math.max(0, Math.min(this.order.length - 1, next));
    const target = this.cells.get(this.order[next] as string);
    if (!target) return;
    this.focusKey = this.order[next] as string;
    this.applyRoving();
    target.focus();
  }

  chosen(): string | null {
    return this.chosenKey;
  }

  set(key: string | null): void {
    this.chosenKey = key;
    for (const [other, entry] of this.cells) {
      entry.setAttribute('aria-selected', other === key ? 'true' : 'false');
    }
    this.applyRoving();
  }

  focusCell(key: string): void {
    this.cells.get(key)?.focus();
  }

  node(): HTMLElement {
    return this.element;
  }
}
