// Countdowns run from the server's remaining seconds by elapsed time.

import { get, serverTime, hasServerTime } from './api.js';
import { el } from './dom.js';
import { settlementText, timerText } from './format.js';

const ticking = new Set();
let interval = null;

function tick() {
  ticking.forEach((timer) => timer.render());
}

function ensureTicking() {
  if (interval === null) interval = window.setInterval(tick, 1000);
}

export function settlementTimer() {
  const node = el('span', {
    role: 'timer',
    'aria-label': 'Settlement time',
    className: 'bar__clock',
  });
  let seen = false;
  const timer = {
    render() {
      if (node.isConnected) seen = true;
      else if (seen) {
        ticking.delete(timer);
        return;
      }
      if (hasServerTime()) node.textContent = settlementText(serverTime());
    },
  };
  ticking.add(timer);
  ensureTicking();
  timer.render();
  return node;
}

export function countdown({ label, seconds, reask }) {
  const node = el('span', { role: 'timer', 'aria-label': label });
  let remaining = seconds === null || seconds === undefined ? null : seconds;
  let startedAt = performance.now();
  let asked = false;
  let seen = false;
  const timer = {
    render() {
      if (node.isConnected) seen = true;
      else if (seen) {
        ticking.delete(timer);
        return;
      }
      if (remaining === null) {
        node.textContent = timerText(0);
        return;
      }
      const elapsed = Math.floor((performance.now() - startedAt) / 1000);
      const left = remaining - elapsed;
      node.textContent = timerText(Math.max(0, left));
      if (left <= 0 && !asked && reask) {
        asked = true;
        reask();
      }
    },
    set(next) {
      remaining = next === null || next === undefined ? null : next;
      startedAt = performance.now();
      asked = false;
      timer.render();
    },
  };
  ticking.add(timer);
  ensureTicking();
  timer.render();
  return { node, set: timer.set };
}

let sharedPending = null;
const sharedWaiting = new Set();

export function sharedWindowsReask(handler) {
  // Every row reaching zero together shares one re-ask of the list.
  sharedWaiting.add(handler);
  if (sharedPending) return sharedPending;
  sharedPending = window.setTimeout(async () => {
    sharedPending = null;
    const waiting = Array.from(sharedWaiting);
    sharedWaiting.clear();
    const answer = await get('/api/windows');
    waiting.forEach((listener) => listener(answer));
  }, 0);
  return sharedPending;
}
