// The first view appears whole: the page stays transparent until its opening requests and fonts have settled, so nothing jumps as each answer lands.
const QUIET_MS = 100;
const MOST_MS = 1500;

let outstanding = 0;
let latest = 0;

function reveal(): void {
  document.documentElement.classList.add("settled");
}

/** A native timer: the reveal keeps to real time whatever happens to the page's own timers. */
function after(ms: number, work: () => void): void {
  AbortSignal.timeout(ms).addEventListener("abort", work, { once: true });
}

export function requestStarted(): void {
  outstanding += 1;
  latest += 1;
}

export function requestEnded(): void {
  outstanding -= 1;
  latest += 1;
  if (outstanding > 0) return;
  const seen = latest;
  after(QUIET_MS, () => {
    if (seen === latest) void document.fonts.ready.then(reveal);
  });
}

after(MOST_MS, reveal);
