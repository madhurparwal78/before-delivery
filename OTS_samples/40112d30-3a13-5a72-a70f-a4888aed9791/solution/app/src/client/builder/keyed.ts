// Keeps a list of elements in step with a list of items by key: new items are made, then every item is patched in
// place, gone ones are removed, and the order follows the items. Nothing that did not change is rebuilt, so
// focus and typed text survive.

interface KeyedOptions<T> {
  key: (item: T) => string;
  create: (item: T) => HTMLElement;
  update: (element: HTMLElement, item: T) => void;
}

export class KeyedList<T> {
  private readonly elements = new Map<string, HTMLElement>();

  constructor(private readonly parent: Element, private readonly options: KeyedOptions<T>) {}

  element(key: string): HTMLElement | undefined {
    return this.elements.get(key);
  }

  render(items: readonly T[]): void {
    const focused = this.parent.contains(document.activeElement) ? document.activeElement : null;
    const keys = new Set(items.map(this.options.key));
    for (const [key, element] of this.elements) {
      if (keys.has(key)) continue;
      element.remove();
      this.elements.delete(key);
    }
    items.forEach((item, index) => {
      const key = this.options.key(item);
      let element = this.elements.get(key);
      if (!element) {
        element = this.options.create(item);
        this.elements.set(key, element);
      }
      this.options.update(element, item);
      if (this.parent.children[index] !== element) this.parent.insertBefore(element, this.parent.children[index] ?? null);
    });
    if (focused instanceof HTMLElement && document.activeElement !== focused && focused.isConnected) focused.focus({ preventScroll: true });
  }
}
