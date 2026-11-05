export function qs<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

export function qsa<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function pageData<T>(): T | null {
  const node = document.getElementById("page-data");
  if (!node?.textContent) return null;
  return JSON.parse(node.textContent) as T;
}

export interface ApiResult<T> {
  status: number;
  body: T;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  let body: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body: body as T };
}

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export function announce(element: Element | null, text: string): void {
  if (!element) return;
  element.textContent = text;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface TrappedDialog {
  open(): void;
  close(): void;
  isOpen(): boolean;
}

/** Keeps Tab inside the dialog, closes on Escape and returns focus to the opener. */
export function trapDialog(
  container: HTMLElement,
  options: { onClose?: () => void; initialFocus?: () => HTMLElement | null } = {},
): TrappedDialog {
  let opener: HTMLElement | null = null;
  const focusables = (): HTMLElement[] =>
    qsa<HTMLElement>(FOCUSABLE, container).filter((element) => element.offsetParent !== null || element === document.activeElement);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    const active = document.activeElement as HTMLElement | null;
    if (event.shiftKey && (active === first || !container.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  function open(): void {
    opener = document.activeElement as HTMLElement | null;
    container.hidden = false;
    document.addEventListener("keydown", onKeyDown, true);
    const target = options.initialFocus?.() ?? focusables()[0] ?? null;
    target?.focus();
  }

  function close(): void {
    if (container.hidden) return;
    container.hidden = true;
    document.removeEventListener("keydown", onKeyDown, true);
    options.onClose?.();
    opener?.focus();
  }

  return { open, close, isOpen: () => !container.hidden };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
