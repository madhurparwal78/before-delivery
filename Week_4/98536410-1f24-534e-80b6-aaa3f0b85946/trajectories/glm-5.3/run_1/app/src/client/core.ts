// Shared client helpers: API access, focus, motion, figures, dialogs.

export interface ApiUser {
  id: string;
  name: string;
  email: string;
  role: "lead" | "manager" | "care" | "shopper";
  operator_id: string;
}

export class ApiFailure extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(String(body.code ?? status));
  }
}

export class StaleAnswer extends Error {
  constructor(public readonly generation: number) {
    super("stale answer");
  }
}

export class Api {
  private generation = 0;

  constructor(private readonly onUnauthenticated: () => void) {}

  nextGeneration(): void {
    this.generation += 1;
  }

  currentGeneration(): number {
    return this.generation;
  }

  async request<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>, generation?: number): Promise<T> {
    const gen = generation ?? this.generation;
    const init: RequestInit = { method, headers: { ...(headers ?? {}) }, credentials: "same-origin" };
    if (body !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(path, init);
    if (res.status === 401) {
      this.onUnauthenticated();
      throw new ApiFailure(401, { code: "unauthenticated" });
    }
    if (gen !== this.generation) {
      throw new StaleAnswer(gen);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      throw new ApiFailure(res.status, parsed as Record<string, unknown>);
    }
    return parsed as T;
  }

  get<T>(path: string, generation?: number): Promise<T> {
    return this.request<T>("GET", path, undefined, undefined, generation);
  }

  post<T>(path: string, body?: unknown, headers?: Record<string, string>, generation?: number): Promise<T> {
    return this.request<T>("POST", path, body ?? {}, headers, generation);
  }

  put<T>(path: string, body?: unknown, generation?: number): Promise<T> {
    return this.request<T>("PUT", path, body ?? {}, undefined, generation);
  }

  del<T>(path: string, generation?: number): Promise<T> {
    return this.request<T>("DELETE", path, undefined, undefined, generation);
  }
}

export function reducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function euroText(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const wholeText = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${wholeText},${String(rest).padStart(2, "0")} €`;
}

export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Animated figure: counts from old value to new value over ~360ms.
export interface FigureOptions {
  unit?: "count" | "cents" | "km";
}

export class Figure {
  private current = 0;
  private first = true;
  private timer: number | null = null;

  constructor(
    private readonly node: HTMLElement,
    private readonly options: FigureOptions = {},
  ) {
    node.classList.add("figure");
  }

  set(value: number): void {
    if (this.first || reducedMotion() || value === this.current) {
      this.current = value;
      this.first = false;
      this.render(value);
      return;
    }
    const from = this.current;
    this.current = value;
    this.node.setAttribute("data-value", String(value));
    this.node.setAttribute("data-counting", "true");
    if (this.timer !== null) window.clearInterval(this.timer);
    const duration = 360;
    const start = performance.now();
    this.timer = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.render(from + (value - from) * eased);
      if (t >= 1) {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        this.node.setAttribute("data-counting", "false");
      }
    }, 40);
  }

  private render(shown: number): void {
    if (this.options.unit === "cents") {
      this.node.textContent = euroText(Math.round(shown));
    } else if (this.options.unit === "km") {
      this.node.textContent = shown.toFixed(2);
    } else {
      this.node.textContent = String(Math.round(shown));
    }
  }
}

export class Sheet {
  private state = "closed";
  private openTimer: number | null = null;
  private closeTimer: number | null = null;
  readonly root: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly options: { onOpen?: () => void; onClose?: () => void } = {},
  ) {
    this.root = root;
    root.setAttribute("data-state", "closed");
    root.setAttribute("hidden", "hidden");
  }

  open(restored = false): void {
    if (this.closeTimer !== null) {
      window.clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    if (this.state === "open" || this.state === "opening") return;
    this.root.removeAttribute("hidden");
    if (restored || reducedMotion()) {
      this.state = "open";
      this.root.setAttribute("data-state", "open");
      this.options.onOpen?.();
      return;
    }
    this.state = "opening";
    this.root.setAttribute("data-state", "opening");
    this.openTimer = window.setTimeout(() => {
      this.state = "open";
      this.root.setAttribute("data-state", "open");
      this.options.onOpen?.();
    }, 200);
  }

  close(): void {
    if (this.openTimer !== null) {
      window.clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    if (this.state === "closed" || this.state === "closing") return;
    this.state = "closing";
    this.root.setAttribute("data-state", "closing");
    const done = (): void => {
      this.state = "closed";
      this.root.setAttribute("data-state", "closed");
      this.root.setAttribute("hidden", "hidden");
      this.options.onClose?.();
    };
    if (reducedMotion()) {
      done();
    } else {
      this.closeTimer = window.setTimeout(done, 200);
    }
  }

  isOpenNow(): boolean {
    return this.state !== "closed" && this.state !== "closing";
  }
}

export function trapFocus(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== "Tab") return;
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"),
  ).filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function historyParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function debounce(fn: () => void, ms: number): () => void {
  let timer: number | null = null;
  return () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}
