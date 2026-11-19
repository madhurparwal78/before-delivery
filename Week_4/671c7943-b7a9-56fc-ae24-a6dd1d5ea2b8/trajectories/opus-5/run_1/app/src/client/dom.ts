export const query = <T extends Element>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(selector);

export const queryAll = <T extends Element>(
  selector: string,
  root: ParentNode = document,
): T[] => [...root.querySelectorAll<T>(selector)];

export const need = <T extends Element>(selector: string, root: ParentNode = document): T => {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element ${selector}`);
  return element;
};

export const view = (): HTMLElement => need<HTMLElement>('[data-view]');

const disposers: (() => void)[] = [];

export function onDispose(dispose: () => void): void {
  disposers.push(dispose);
}

export function disposeView(): void {
  while (disposers.length > 0) {
    disposers.pop()!();
  }
}

export function listen<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;
export function listen<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;
export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void;
export function listen(
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler, options);
  onDispose(() => target.removeEventListener(type, handler, options));
}

let frame = 0;
const framed = new Set<() => void>();

export function onFrame(run: () => void): void {
  framed.add(run);
  if (frame !== 0) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const tasks = [...framed];
    framed.clear();
    for (const task of tasks) task();
  });
}
