/**
 * The reactive core: signals with fine-grained effects. Each effect reruns when a signal
 * it read changes, so DOM updates land in place and focus and caret are never touched.
 */
const queue = new Set<() => void>();
let flushing = false;
let insideBatch = false;

export interface Signal<T> {
  (): T;
  subs: Set<() => void>;
  set(next: T): void;
  update(fn: (v: T) => T): void;
}

export function signal<T>(value: T): Signal<T> {
  const subs = new Set<() => void>();
  const sig = Object.assign(
    () => {
      if (currentTrack) currentTrack.add(sig as unknown as Signal<unknown>);
      return value;
    },
    {
      subs,
      set(next: T) {
        if (next === value) return;
        value = next;
        for (const fn of subs) queue.add(fn);
        flush();
      },
      update(fn: (v: T) => T) {
        sig.set(fn(value));
      },
    },
  );
  return sig;
}

let currentTrack: Set<Signal<unknown>> | null = null;

/** Run fn now and whenever a signal it reads changes. Returns a stop function. */
export function effect(fn: () => void): () => void {
  let alive = true;
  let reads = new Set<Signal<unknown>>();
  const run = (): void => {
    if (!alive) return;
    const next = new Set<Signal<unknown>>();
    const prev = currentTrack;
    currentTrack = next;
    try {
      fn();
    } finally {
      currentTrack = prev;
      for (const s of reads) if (!next.has(s)) s.subs.delete(run);
      for (const s of next) s.subs.add(run);
      reads = next;
    }
  };
  run();
  return () => {
    alive = false;
    for (const s of reads) s.subs.delete(run);
  };
}


/** Group several signal writes into one update pass. */
export function batch(fn: () => void): void {
  const was = insideBatch;
  insideBatch = true;
  try {
    fn();
  } finally {
    insideBatch = was;
    if (!was) flush();
  }
}

function flush(): void {
  if (insideBatch || flushing) return;
  flushing = true;
  try {
    for (let pass = 0; pass < 8 && queue.size > 0; pass += 1) {
      const current = [...queue];
      queue.clear();
      for (const fn of current) fn();
    }
  } finally {
    flushing = false;
  }
}

/** Whether the browser asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Run one named Web Animations animation, or apply the final state at once under
 * reduced motion. Returns nothing; the animation is identified by its id.
 */
export function animate(
  el: Element,
  id: "bar-settle" | "panel-in" | "sheet-rise" | "tab-slide",
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): void {
  if (prefersReducedMotion()) return;
  el.animate(keyframes, { ...options, id });
}

/** Element creation helper with props and children. */
export function h(
  tag: string,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): HTMLElement {
  const el = document.createElement(tag);
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (name.startsWith("on") && typeof value === "function") {
        el.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
      } else if (name === "class") {
        el.className = String(value);
      } else if (name === "style" && typeof value === "object") {
        Object.assign(el.style, value);
      } else if (value === true) {
        el.setAttribute(name, "");
      } else if (value !== false && value !== null && value !== undefined) {
        el.setAttribute(name, String(value));
      }
    }
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Append children into a container, clearing it first. */
export function fill(container: HTMLElement, ...children: unknown[]): void {
  container.replaceChildren(...children.flat(9).filter(Boolean) as Node[]);
}

/** Text content helper for elements. */
export function text(el: HTMLElement, s: string): void {
  if (el.textContent !== s) el.textContent = s;
}

/** Memoised element factory for repeated lists. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
  return document.createElement(tag);
}

/** Insert children into a container without clearing it. */
export function insert(parent: HTMLElement, ...nodes: unknown[]): void {
  for (const n of nodes.flat(9)) {
    if (n === null || n === undefined || n === false) continue;
    parent.append(n instanceof Node ? n : document.createTextNode(String(n)));
  }
}

/** A reactive list renderer with keyed reconciliation. */
export function renderList<T>(
  container: HTMLElement,
  items: () => T[],
  keyOf: (item: T, index: number) => string,
  render: (item: T, index: number, node: HTMLElement) => void,
  make: () => HTMLElement = () => document.createElement("div"),
): void {
  const map = new Map<string, HTMLElement>();
  effect(() => {
    const items2 = items();
    const seen = new Set<string>();
    let index = 0;
    for (const item of items2) {
      const key = keyOf(item, index);
      index += 1;
      seen.add(key);
      let node = map.get(key);
      if (!node) {
        node = make();
        map.set(key, node);
      }
      render(item, index - 1, node);
      if (node.parentElement !== container) container.append(node);
    }
    for (const [key, node] of map) {
      if (!seen.has(key)) {
        node.remove();
        map.delete(key);
      }
    }
    // order
    let ref: Node | null = container.firstChild;
    index = 0;
    for (const item of items2) {
      const key = keyOf(item, index);
      const node = map.get(key)!;
      index += 1;
      if (ref === node) {
        ref = ref.nextSibling;
      } else if (ref) {
        container.insertBefore(node, ref);
      } else {
        container.append(node);
      }
    }
  });
}
