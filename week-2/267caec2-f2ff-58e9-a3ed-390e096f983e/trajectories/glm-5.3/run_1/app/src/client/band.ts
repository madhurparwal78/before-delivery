let timerId = 0;
let target: Date | null = null;
let closed = false;

export interface BandConfig {
  contextName: string;
  countdownIso: string | null;
  fallback?: string;
}

/** Sets the sticky band's context name and its countdown target, if any. */
export function setBand(config: BandConfig): void {
  const context = document.getElementById("band-context");
  const countdown = document.getElementById("band-countdown");
  if (context) {
    context.textContent = config.contextName;
  }
  window.clearInterval(timerId);
  target = config.countdownIso ? new Date(config.countdownIso) : null;
  closed = false;
  if (!countdown) {
    return;
  }
  if (!target) {
    countdown.textContent = config.fallback ?? "";
    countdown.removeAttribute("role");
    countdown.classList.remove("almost");
    return;
  }
  countdown.setAttribute("role", "timer");
  countdown.setAttribute("aria-label", "Time remaining");
  countdown.classList.remove("almost");
  render();
  timerId = window.setInterval(render, 1000);
}

function render(): void {
  const countdown = document.getElementById("band-countdown");
  if (!countdown || !target) {
    return;
  }
  const remaining = target.getTime() - Date.now();
  if (remaining <= 0) {
    if (!closed) {
      countdown.textContent = "Closed";
      closed = true;
    }
    return;
  }
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  countdown.textContent = `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (remaining < 24 * 3_600_000) {
    countdown.classList.add("almost");
  } else {
    countdown.classList.remove("almost");
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function setNavCurrent(path: string): void {
  const current = path === "/" ? "leaderboard" : path.startsWith("/gallery") ? "gallery" : path.startsWith("/studio") ? "studio" : path.startsWith("/jury") ? "jury" : path.startsWith("/director") ? "director" : "";
  for (const link of document.querySelectorAll<HTMLAnchorElement>(".primary-nav a[data-nav]")) {
    if (link.dataset.nav === current) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
}
