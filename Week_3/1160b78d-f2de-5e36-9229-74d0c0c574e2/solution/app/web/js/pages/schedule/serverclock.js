// The server's present, as last told by GET /api/clock and the ever-second `clock` socket message. The device clock is
// never read.
import { boot } from '../../lib/boot.js';
import { api } from '../../lib/api.js';
import { live } from '../../lib/live.js';

let current = Date.parse(boot.now);
let started = false;

function start() {
  if (started) return;
  started = true;
  live.on('clock', (data) => {
    if (data && data.now) current = Date.parse(data.now);
  });
  api.get('/api/clock').then((res) => {
    if (res.ok) current = Date.parse(res.data.now);
  });
}

// serverNow is the server clock in epoch milliseconds.
export function serverNow() {
  start();
  return current;
}
