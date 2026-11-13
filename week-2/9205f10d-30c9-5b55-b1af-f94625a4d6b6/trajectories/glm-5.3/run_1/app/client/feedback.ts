import { api, Unreachable } from "./api.js";

export type ToastKind = "info" | "alert";

/** A live region that holds the latest async action's copy. */
export class StatusRegion {
  private node: HTMLElement;
  private original: string;

  constructor(node: HTMLElement) {
    this.node = node;
    this.original = "";
  }

  set(text: string, kind: ToastKind = "info"): void {
    this.node.textContent = text;
    this.node.classList.toggle("alert", kind === "alert");
    this.original = text;
  }

  clear(): void {
    this.node.textContent = "";
    this.node.classList.remove("alert");
  }

  attach(): void {
    // region is already part of the page tree
  }
}

export function unreachableMessage(): string {
  return "Couldn't reach Crosshand Relay. Check your connection and try again.";
}

export function isUnreachable(err: unknown): boolean {
  return err instanceof Unreachable;
}

export function errorMessage(err: unknown): string {
  if (isUnreachable(err)) return unreachableMessage();
  return err instanceof Error ? err.message : "Something went wrong.";
}

export function errorFields(err: unknown): Record<string, string> {
  const e = err as { api?: { error?: { fields?: Record<string, string> } } };
  return e?.api?.error?.fields ?? {};
}

export function errorCode(err: unknown): string | null {
  const e = err as { api?: { error?: { code?: string } } };
  return e?.api?.error?.code ?? null;
}

export function errorQuote(err: unknown): import("./api.js").Quote | null {
  const e = err as { api?: { quote?: import("./api.js").Quote } };
  return e?.api?.quote ?? null;
}

/** Debounce helper for search boxes: fire after 333ms of quiet or immediately on Enter. */
export function searchOnInput(input: HTMLInputElement, apply: (q: string) => void): void {
  let timer: number | undefined;
  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => apply(input.value), 333);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      window.clearTimeout(timer);
      apply(input.value);
    }
  });
}

/** A 10-second poll that never stacks requests. */
export class Poller {
  private timer: number | undefined;
  private running = false;

  constructor(private readonly fn: () => Promise<void>) {}

  start(): void {
    this.stop();
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.fn();
      } catch {
        // transient; keep polling
      } finally {
        this.running = false;
      }
      this.timer = window.setTimeout(tick, 10_000);
    };
    this.timer = window.setTimeout(tick, 10_000);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
