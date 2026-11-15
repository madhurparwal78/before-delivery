import type { PreviewKind, PreviewMessage } from "../shared/types";

export interface RuntimeConfig {
  render: string;
  nonce: string;
  loopLimit: number;
  jsStartLine: number;
  loopReporter: string;
}

function isError(value: unknown): value is { name: string; message: string } {
  return value instanceof Error || value instanceof DOMException || Object.prototype.toString.call(value) === "[object Error]";
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (isError(value)) return `${value.name}: ${value.message}`;
  if (typeof value === "object" && (Array.isArray(value) || isPlainObject(value))) {
    try {
      const text = JSON.stringify(value);
      return text === undefined ? "[unserialisable object]" : text;
    } catch {
      return "[unserialisable object]";
    }
  }
  try {
    return String(value);
  } catch {
    return "[unserialisable object]";
  }
}

function urlText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return formatValue(input);
}

export function start(config: RuntimeConfig): void {
  const target = window.parent;
  const post = (kind: PreviewKind, text: string, line: number | null = null, title: string | null = null): void => {
    const message: PreviewMessage = { source: "ashlar-preview", render: config.render, nonce: config.nonce, kind, text, line, title };
    target.postMessage(message, "*");
  };

  for (const kind of ["log", "info", "warn", "error"] as const) {
    const original = console[kind].bind(console);
    console[kind] = (...args: unknown[]) => {
      post(kind, args.map(formatValue).join(" "));
      original(...args);
    };
  }

  const paneLine = (lineno: number, filename: string): number | null => {
    if (filename !== location.href || !lineno || lineno < config.jsStartLine) return null;
    return lineno - config.jsStartLine + 1;
  };

  window.addEventListener("error", (event: ErrorEvent) => {
    const error: unknown = event.error;
    const text = isError(error) ? `${error.name}: ${error.message}` : error === undefined || error === null ? event.message : formatValue(error);
    post("uncaught", text, paneLine(event.lineno, event.filename));
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    post("uncaught", `Unhandled rejection: ${isError(reason) ? reason.message : formatValue(reason)}`);
  });

  Object.defineProperty(window, config.loopReporter, {
    value: (line: number) => post("loop", `Stopped a loop on line ${line} after ${config.loopLimit} iterations.`, line),
  });

  const blockRequest = (url: unknown): void => post("blocked", `Request to ${urlText(url)} was blocked. Pens cannot use the network.`);

  window.fetch = (input: RequestInfo | URL) => {
    blockRequest(input);
    return new Promise<Response>(() => undefined);
  };

  class BlockedRequest extends EventTarget {
    readyState = 0;
    status = 0;
    responseText = "";
    private url: unknown = "";
    open(_method: string, url: string | URL): void {
      this.url = url;
    }
    send(): void {
      blockRequest(this.url);
    }
    setRequestHeader(): void {}
    abort(): void {}
    getAllResponseHeaders(): string {
      return "";
    }
    getResponseHeader(): null {
      return null;
    }
  }
  Object.defineProperty(window, "XMLHttpRequest", { value: BlockedRequest, writable: true, configurable: true });

  const inertConnection = (url: unknown) => {
    blockRequest(url);
    const connection = new EventTarget();
    return Object.assign(connection, { url: urlText(url), readyState: 2, close: () => undefined, send: () => undefined });
  };
  for (const name of ["WebSocket", "EventSource"]) {
    Object.defineProperty(window, name, {
      value: function BlockedConnection(url: unknown) {
        return inertConnection(url);
      },
      writable: true,
      configurable: true,
    });
  }
  navigator.sendBeacon = (url: string | URL) => {
    blockRequest(url);
    return false;
  };

  const checkScript = (script: HTMLScriptElement): void => {
    const src = script.getAttribute("src");
    if (src === null) return;
    const resolved = new URL(src, document.baseURI);
    if (resolved.origin !== location.origin || !resolved.pathname.startsWith("/shelf/")) {
      post("blocked", `Script ${src} is not on the shelf.`);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLScriptElement) checkScript(node);
        for (const script of node.querySelectorAll("script")) checkScript(script);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("load", () => {
    const text = [...(document.body?.innerText ?? "").trim()].slice(0, 500).join("");
    post("ready", text, null, document.title);
  });
}
