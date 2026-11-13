// The live channel is a request that never ends, so it waits until the page has finished loading and the network
// has been quiet for a moment; the first thing it does once open is ask every page to re-read what it shows.
const QUIET_MS = 800;
const GIVE_UP_MS = 4000;
const POLL_MS = 200;

let inflight = 0;
let lastActivity = typeof performance === "undefined" ? 0 : performance.now();

function touch(): void {
  lastActivity = performance.now();
}

export function track<T>(request: Promise<T>): Promise<T> {
  inflight += 1;
  touch();
  const done = () => {
    inflight -= 1;
    touch();
  };
  request.then(done, done);
  return request;
}

if (typeof PerformanceObserver !== "undefined") {
  try {
    new PerformanceObserver(touch).observe({ type: "resource", buffered: false });
  } catch {
    // an engine without resource timing: the quiet window still holds for the fetches that were tracked
  }
}

export function whenQuiet(): Promise<void> {
  const began = performance.now();
  return new Promise((resolve) => {
    const check = () => {
      const now = performance.now();
      const loaded = document.readyState === "complete";
      if ((loaded && inflight === 0 && now - lastActivity >= QUIET_MS) || now - began >= GIVE_UP_MS) resolve();
      else window.setTimeout(check, POLL_MS);
    };
    check();
  });
}
