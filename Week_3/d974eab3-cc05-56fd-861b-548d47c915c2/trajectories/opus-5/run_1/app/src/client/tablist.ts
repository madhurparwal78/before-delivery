import { all, find } from './dom';

/**
 * One Tab stop at the selected tab, arrow keys that select at once and wrap,
 * Home and End for the ends, and Tab into the selected tab panel.
 */
export class TabList {
  private readonly tabs: HTMLElement[];
  private index = 0;

  constructor(
    container: HTMLElement,
    private readonly onUserSelect?: (index: number) => void,
  ) {
    this.tabs = all<HTMLElement>('[role="tab"]', container);
    this.tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        this.choose(index);
      });
    });
    container.addEventListener('keydown', (event) => {
      const last = this.tabs.length - 1;
      const next = {
        ArrowRight: this.index === last ? 0 : this.index + 1,
        ArrowLeft: this.index === 0 ? last : this.index - 1,
        Home: 0,
        End: last,
      }[event.key];
      if (next === undefined) {
        return;
      }
      event.preventDefault();
      this.choose(next);
    });
  }

  private choose(index: number): void {
    this.select(index);
    this.tabs[index]?.focus();
    this.onUserSelect?.(index);
  }

  /** Marks the tab selected and shows its panel. */
  select(index: number): void {
    this.index = index;
    this.tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.tabIndex = selected ? 0 : -1;
      const panel = find<HTMLElement>(
        `#${tab.getAttribute('aria-controls') ?? ''}`,
      );
      if (panel !== null) {
        panel.hidden = !selected;
      }
    });
  }

  selectedIndex(): number {
    return this.index;
  }
}
