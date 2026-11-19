import type { PreviewKind, PreviewMessage } from '../shared/api';
import { copy } from '../shared/copy';
import { formatArguments, rejectionText, uncaughtText } from '../shared/console-format';

interface PreviewSettings {
  render: string;
  nonce: string;
  loopLimit: number;
  blockedScripts: string[];
}

declare global {
  interface Window {
    __ASHLAR_PREVIEW__: PreviewSettings;
    __ashlarJsLineOffset?: number;
    __ashlarEnterLoop: (id: number) => void;
    __ashlarTickLoop: (id: number, line: number) => boolean;
  }
}

const settings = window.__ASHLAR_PREVIEW__;

const post = (kind: PreviewKind, text: string, line: number | null, title: string | null): void => {
  const message: PreviewMessage = {
    source: 'ashlar-preview',
    render: settings.render,
    nonce: settings.nonce,
    kind,
    text,
    line,
    title,
  };
  window.parent.postMessage(message, '*');
};

const native = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

const hook = (kind: 'log' | 'info' | 'warn' | 'error'): void => {
  console[kind] = (...args: unknown[]): void => {
    post(kind, formatArguments(args), null, null);
    native[kind](...args);
  };
};
hook('log');
hook('info');
hook('warn');
hook('error');

const paneLine = (lineno: number): number | null => {
  const offset = window.__ashlarJsLineOffset;
  if (offset === undefined) return null;
  const line = lineno - offset;
  return line >= 1 ? line : null;
};

window.addEventListener('error', (event: ErrorEvent) => {
  const error = event.error as Error | undefined;
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : event.message;
  post('uncaught', uncaughtText(name, message, paneLine(event.lineno)), paneLine(event.lineno), null);
});

window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  post('uncaught', rejectionText(event.reason), null, null);
});

const counters = new Map<number, number>();

window.__ashlarEnterLoop = (id: number): void => {
  counters.set(id, 0);
};

window.__ashlarTickLoop = (id: number, line: number): boolean => {
  const count = (counters.get(id) ?? 0) + 1;
  counters.set(id, count);
  if (count > settings.loopLimit) {
    post('loop', copy.loopStopped(line, settings.loopLimit), line, null);
    return false;
  }
  return true;
};

const blockRequest = (url: string): void => {
  post('blocked', copy.blockedRequest(url), null, null);
};

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

window.fetch = ((input: RequestInfo | URL): Promise<Response> => {
  blockRequest(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  return never<Response>();
}) as typeof window.fetch;

const xhrTargets = new WeakMap<XMLHttpRequest, string>();
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, _method: string, url: string | URL) {
  xhrTargets.set(this, typeof url === 'string' ? url : url.href);
} as typeof XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.send = function (this: XMLHttpRequest) {
  blockRequest(xhrTargets.get(this) ?? '');
} as typeof XMLHttpRequest.prototype.send;

class BlockedWebSocket {
  constructor(url: string | URL) {
    blockRequest(typeof url === 'string' ? url : url.href);
  }
}
window.WebSocket = BlockedWebSocket as unknown as typeof WebSocket;

class BlockedEventSource {
  constructor(url: string | URL) {
    blockRequest(typeof url === 'string' ? url : url.href);
  }
}
window.EventSource = BlockedEventSource as unknown as typeof EventSource;

navigator.sendBeacon = ((url: string | URL): boolean => {
  blockRequest(typeof url === 'string' ? url : url.href);
  return false;
}) as typeof navigator.sendBeacon;

for (const url of settings.blockedScripts) post('blocked', copy.blockedScript(url), null, null);

const isShelfSrc = (src: string): boolean => {
  const base = `${window.location.origin}/shelf/`;
  return src.startsWith('/shelf/') || src.startsWith(base);
};

new MutationObserver((records) => {
  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) {
      if (node instanceof HTMLScriptElement) {
        const src = node.getAttribute('src');
        if (src !== null && !isShelfSrc(src)) {
          node.remove();
          post('blocked', copy.blockedScript(src), null, null);
        }
      }
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

const sendReady = (): void => {
  const text = document.body.innerText.trim().slice(0, 500);
  post('ready', text, null, document.title);
};

if (document.readyState === 'complete') sendReady();
else window.addEventListener('load', sendReady, { once: true });
