import { serverDate, serverNow } from './clock.ts';
import { allConnections, deliver, sendSocket, sweepPresence } from './hub.ts';
import { onTick } from './tick.ts';

/** Presence removal, session expiry and the daily re-evaluation of overdue flags. */
let lastDate = serverDate();

onTick(() => {
  sweepPresence();
  const now = serverNow();
  for (const conn of allConnections()) {
    const ends = conn.principal.expiresAt;
    if (ends !== null && ends <= now && !conn.expiredNotified) {
      conn.expiredNotified = true;
      sendSocket(conn.ws, { type: 'session_expired' });
    }
  }
  const today = serverDate();
  if (today !== lastDate) {
    lastDate = today;
    const rooms = new Set(allConnections().map((c) => c.mapId));
    for (const mapId of rooms) deliver(mapId, 0, { type: 'derived', server_date: today }, 'all', null);
  }
});

