'use strict';

// The one business clock. APP_NOW, when set, is the instant the clock reads at
// the moment serve starts; it then advances in real time from there.

const raw = (process.env.APP_NOW || '').trim();
let offsetMs = 0;

if (raw) {
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) offsetMs = parsed - Date.now();
}

function nowMs() {
  return Date.now() + offsetMs;
}

function now() {
  return new Date(nowMs());
}

function nowIso() {
  return now().toISOString();
}

module.exports = { now, nowMs, nowIso };
