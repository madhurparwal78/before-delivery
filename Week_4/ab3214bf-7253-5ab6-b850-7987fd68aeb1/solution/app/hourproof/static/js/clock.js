// Server time on every screen: all clocks start from the latest server_now and advance by elapsed time.

let base = null;
const handles = new Set();
const settlementNodes = new Set();

export function sync(serverNow) {
  if (!serverNow) return;
  const ms = Date.parse(serverNow);
  if (!base || ms > nowMs()) base = { ms, at: performance.now() };
}

export function nowMs() {
  return base ? base.ms + (performance.now() - base.at) : Date.now();
}

export function settlementText() {
  return new Date(nowMs()).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

export function watchSettlement(el) {
  settlementNodes.add(el);
  el.textContent = settlementText();
  return () => settlementNodes.delete(el);
}

export function countdownText(seconds) {
  const s = Math.max(0, seconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  return `${days}d ${two(hours)}h ${two(minutes)}m ${two(rest)}s left`;
}

// A countdown runs from the server's remaining seconds by elapsed time. At zero its group asks the server once.
export function countdown(el, seconds, group) {
  const handle = {
    el, group, asking: false, done: false, from: seconds, at: performance.now(),
    remaining() { return this.from - (performance.now() - this.at) / 1000; },
    set(next) { this.from = next; this.at = performance.now(); this.asking = false; this.done = false; paint(this); },
    stop() { handles.delete(this); },
  };
  handles.add(handle);
  paint(handle);
  return handle;
}

function paint(handle) {
  handle.el.textContent = countdownText(Math.ceil(handle.remaining()));
}

async function tick() {
  for (const el of settlementNodes) {
    if (el.isConnected) el.textContent = settlementText();
    else settlementNodes.delete(el);
  }
  const due = new Map();
  for (const handle of handles) {
    if (!handle.el.isConnected) { handles.delete(handle); continue; }
    paint(handle);
    if (handle.remaining() <= 0 && !handle.asking && !handle.done) {
      handle.asking = true;
      if (!due.has(handle.group)) due.set(handle.group, []);
      due.get(handle.group).push(handle);
    }
  }
  for (const [group, list] of due) {
    try { await group.ask(); } catch { /* the next poll shows the failure */ }
    for (const handle of list) {
      if (handle.asking) { handle.asking = false; handle.done = true; }
    }
  }
}

setInterval(tick, 250);
