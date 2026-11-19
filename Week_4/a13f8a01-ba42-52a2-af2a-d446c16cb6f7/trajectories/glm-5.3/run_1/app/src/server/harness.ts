// Preview harness: runs inside the sandboxed iframe. Reports to the parent
// page only through postMessage carrying this render's id and nonce.
interface HarnessMeta {
  render: string;
  nonce: string;
  loopLimit: number;
}

interface AshlarWindow {
  __ASHLAR: HarnessMeta;
  __ashlarReportLoop: (line: number) => void;
  __ashlarLoopExit: Error;
}

const meta = (window as unknown as AshlarWindow & typeof window).__ASHLAR;

function post(kind: string, text: string, line: number | null, title: string | null): void {
  try {
    window.parent.postMessage(
      { source: "ashlar-preview", render: meta.render, nonce: meta.nonce, kind, text, line, title },
      "*",
    );
  } catch {
    // the parent may have navigated away; nothing to do
  }
}

// Console formatting: several arguments joined by one space, strings as they
// are, numbers/booleans/null/undefined as JavaScript writes them, arrays and
// plain objects as compact JSON, Errors as <Name>: <message>.
function formatValue(value: unknown, depth: number): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "function") return String(value);
  if (value instanceof Error) return `${value.name || "Error"}: ${value.message || ""}`;
  if (typeof value === "object") {
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag === "Array") {
      if (depth > 0) return "[object]";
      const arr = value as unknown[];
      const items: string[] = [];
      for (let i = 0; i < arr.length && i < 100; i++) items.push(formatValue(arr[i], depth + 1));
      return `[${items.join(",")}]`;
    }
    try {
      const json = JSON.stringify(value, (_k, v) => (typeof v === "function" ? undefined : v));
      return json ?? "[unserialisable object]";
    } catch {
      return "[unserialisable object]";
    }
  }
  return String(value);
}

function formatArgs(args: unknown[]): string {
  return args.map((a) => formatValue(a, 0)).join(" ");
}

for (const kind of ["log", "info", "warn", "error"] as const) {
  const original = console[kind].bind(console);
  console[kind] = (...args: unknown[]) => {
    post(kind, formatArgs(args), null, null);
    try {
      original(...args);
    } catch {
      // keep going
    }
  };
}

// Blocked network: fetch, XHR, WebSocket, EventSource and sendBeacon are refused.
function requestBlocked(url: string): void {
  post("blocked", `Request to ${url} was blocked. Pens cannot use the network.`, null, null);
}

const w = window as unknown as Record<string, unknown>;
w.fetch = (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  requestBlocked(String(url));
  return Promise.reject(new Error("Pens cannot use the network."));
};
w.XMLHttpRequest = function XMLHttpRequestShim(this: Record<string, unknown>) {
  this.open = (_method: string, url: string) => {
    requestBlocked(String(url));
    throw new Error("Pens cannot use the network.");
  };
  this.send = () => {};
  this.addEventListener = () => {};
  this.setRequestHeader = () => {};
  this.abort = () => {};
} as unknown as typeof XMLHttpRequest;
w.WebSocket = function WebSocketShim(this: unknown, url: string | URL) {
  requestBlocked(String(url));
  throw new Error("Pens cannot use the network.");
} as unknown as typeof WebSocket;
w.EventSource = function EventSourceShim(this: unknown, url: string | URL) {
  requestBlocked(String(url));
  throw new Error("Pens cannot use the network.");
} as unknown as typeof EventSource;
if (navigator.sendBeacon) {
  navigator.sendBeacon = (url: string | URL) => {
    requestBlocked(String(url));
    return false;
  };
}

// Uncaught errors and unhandled rejections.
const loopExit = new Error("__ashlarLoopExit");
loopExit.name = "AshlarLoopExit";
(window as unknown as AshlarWindow).__ashlarLoopExit = loopExit;
(window as unknown as AshlarWindow).__ashlarReportLoop = (line: number) => {
  post("loop", `Stopped a loop on line ${line} after ${meta.loopLimit} iterations.`, line, null);
};

window.addEventListener("error", (event: ErrorEvent) => {
  const err = event.error as Error | undefined;
  if (err && err.name === "AshlarLoopExit") return;
  const name = err?.name || "Error";
  const message = err?.message ?? event.message ?? "";
  post("uncaught", `${name}: ${message}`, null, null);
});

window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
  const reason = event.reason;
  const text = reason instanceof Error ? `Unhandled rejection: ${reason.message}` : `Unhandled rejection: ${formatValue(reason, 0)}`;
  post("uncaught", text, null, null);
});

// Blocked scripts: a script tag pointing outside the shelf is refused.
const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof HTMLScriptElement && node.src) {
        const src = node.getAttribute("src") || "";
        if (!src.startsWith("/shelf/")) {
          post("blocked", `Script ${src} is not on the shelf.`, null, null);
          node.remove();
        }
      }
    }
  }
});
observer.observe(document, { childList: true, subtree: true });

// Ready: report once the document has loaded.
function ready(): void {
  let title: string | null = null;
  try {
    title = document.title || "";
  } catch {
    title = null;
  }
  post("ready", "", null, title);
}
if (document.readyState === "complete") {
  setTimeout(ready, 0);
} else {
  window.addEventListener("load", () => {
    setTimeout(ready, 0);
  });
}
