/** Teardown callbacks for everything the story runtime creates, so it can unmount cleanly (and remount in React dev). */
export class Disposables {
  private callbacks: Array<() => void> = [];

  add(callback: () => void) {
    this.callbacks.push(callback);
  }

  listen<E extends Event = Event>(
    target: EventTarget,
    type: string,
    handler: (event: E) => void,
    options?: AddEventListenerOptions | boolean,
  ) {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.add(() => target.removeEventListener(type, listener, options));
  }

  dispose() {
    while (this.callbacks.length) this.callbacks.pop()?.();
  }
}

export function query<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Stillhour: missing element "${selector}"`);
  return element;
}

export function queryAll<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}
