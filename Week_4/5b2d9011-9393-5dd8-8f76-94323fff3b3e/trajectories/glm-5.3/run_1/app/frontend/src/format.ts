// Format helpers. The browser renders server values; it never recomputes a
// server rule.

export function fmtMs(remainingMs: number): string {
  if (remainingMs < 0) remainingMs = 0;
  if (remainingMs < 60_000) {
    const s = Math.floor(remainingMs / 100) / 10;
    return s.toFixed(1);
  }
  if (remainingMs < 3_600_000) {
    const m = Math.floor(remainingMs / 60_000);
    const s = Math.floor((remainingMs % 60_000) / 1000);
    return `${m}:${pad2(s)}`;
  }
  if (remainingMs < 86_400_000) {
    const h = Math.floor(remainingMs / 3_600_000);
    const m = Math.floor((remainingMs % 3_600_000) / 60_000);
    const s = Math.floor((remainingMs % 60_000) / 1000);
    return `${h}:${pad2(m)}:${pad2(s)}`;
  }
  const d = Math.floor(remainingMs / 86_400_000);
  const h = Math.floor((remainingMs % 86_400_000) / 3_600_000);
  const m = Math.floor((remainingMs % 3_600_000) / 60_000);
  return `${d}d ${pad2(h)}:${pad2(m)}`;
}

export function fmtLapMs(lapMs: number): string {
  const m = Math.floor(lapMs / 60_000);
  const s = Math.floor((lapMs % 60_000) / 1000);
  const ms = Math.floor(lapMs % 1000);
  return `${m}:${pad2(s)}.${pad3(ms)}`;
}

export function fmtLapCounting(elapsedMs: number): string {
  const m = Math.floor(elapsedMs / 60_000);
  const s = Math.floor((elapsedMs % 60_000) / 1000);
  const ds = Math.floor((elapsedMs % 1000) / 100);
  return `${m}:${pad2(s)}.${ds}`;
}

function pad2(n: number): string { return n < 10 ? "0" + n : String(n); }
function pad3(n: number): string { return n < 10 ? "00" + n : n < 100 ? "0" + n : String(n); }

// Key labels, from the keyboard code.
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  return code.replace(/([a-z])([A-Z0-9])/g, "$1 $2");
}

const actionNames: Record<string, string> = {
  move_up: "Move up",
  move_down: "Move down",
  move_left: "Move left",
  move_right: "Move right",
  aim_left: "Aim left",
  aim_right: "Aim right",
  fire: "Fire",
  reload: "Reload",
  grenade: "Grenade",
  revive: "Revive",
  shop: "Shop",
  timers: "Timers",
};

export function actionName(action: string): string {
  return actionNames[action] ?? action;
}

// Browser zone detection for the sign-up combobox default.
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
