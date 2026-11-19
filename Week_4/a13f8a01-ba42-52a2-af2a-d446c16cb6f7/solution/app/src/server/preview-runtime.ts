import type { PreviewKind } from "../shared/types.js";

interface RuntimeEnv {
  render: string;
  nonce: string;
  firstLine: number;
  loopLimit: number;
  source: string;
}

/**
 * The frame's own script. It is serialised with Function.prototype.toString and runs first in every preview
 * document, so it may only use its argument and browser globals. Console formatting is decided here, once.
 */
export function previewRuntime(env: RuntimeEnv): void {
  const { render, nonce, firstLine, loopLimit, source } = env;
  const post = (kind: PreviewKind, text: string, line: number | null, title: string | null): void => {
    window.parent.postMessage({ source, render, nonce, kind, text, line, title }, "*");
  };

  const format = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    const prototype: unknown = typeof value === "object" && value !== null ? Object.getPrototypeOf(value) : undefined;
    if (Array.isArray(value) || (prototype !== undefined && (prototype === Object.prototype || prototype === null))) {
      try {
        return JSON.stringify(value) ?? "[unserialisable object]";
      } catch {
        return "[unserialisable object]";
      }
    }
    return String(value);
  };

  for (const kind of ["log", "info", "warn", "error"] as const) {
    console[kind] = (...values: unknown[]): void => post(kind, values.map(format).join(" "), null, null);
  }

  const refuse = (address: string): void =>
    post("blocked", `Request to ${address} was blocked. Pens cannot use the network.`, null, null);
  const unavailable = (): DOMException => new DOMException("The network is not available to pens.", "NetworkError");

  window.fetch = (input: RequestInfo | URL): Promise<Response> => {
    refuse(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return Promise.reject(new TypeError("Failed to fetch"));
  };
  const requested = new WeakMap<XMLHttpRequest, string>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, _method: string, address: string | URL): void {
    requested.set(this, String(address));
  };
  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest): void {
    refuse(requested.get(this) ?? "");
    throw unavailable();
  };
  for (const name of ["WebSocket", "EventSource"] as const) {
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: function (address: string | URL): never {
        refuse(String(address));
        throw unavailable();
      },
    });
  }
  navigator.sendBeacon = (address: string | URL): boolean => {
    refuse(String(address));
    return false;
  };

  document.addEventListener("securitypolicyviolation", (event) => {
    if (!event.effectiveDirective.startsWith("script-src")) return;
    const written = Array.from(document.querySelectorAll("script[src]")).find(
      (element) => (element as HTMLScriptElement).src === event.blockedURI,
    );
    post("blocked", `Script ${written?.getAttribute("src") ?? event.blockedURI} is not on the shelf.`, null, null);
  });

  window.addEventListener("error", (event) => {
    const reason: unknown = event.error;
    const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : event.message.replace(/^Uncaught /, "");
    if (event.filename === window.location.href) {
      const line = event.lineno - firstLine + 1;
      post("uncaught", `${text} (line ${line})`, line, null);
    } else {
      post("uncaught", text, null, null);
    }
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    post("uncaught", `Unhandled rejection: ${reason instanceof Error ? reason.message : format(reason)}`, null, null);
  });

  Object.defineProperty(window, "__ashlarLoop", {
    value: (line: number): void => post("loop", `Stopped a loop on line ${line} after ${loopLimit} iterations.`, line, null),
  });

  window.addEventListener("load", () => {
    const turn = new MessageChannel();
    turn.port1.onmessage = (): void => post("ready", (document.body?.innerText ?? "").trim().slice(0, 500), null, document.title);
    turn.port2.postMessage(0);
  });
  document.currentScript?.remove();
}
