// Live desk: Server-Sent Events replaying and streaming desk events, counterpart presence for
// review holds, the per-stream revocation re-check, and the hold-release sweeper.

import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { Party, StreamEvent } from "../shared/types.js";
import { config } from "./config.js";
import { listen, notify, query, transaction } from "./db.js";
import { loadDesk } from "./desk.js";
import { releaseHeld } from "./commands/exchange.js";
import { accountActive } from "./keycloak.js";
import { endSessionsOf, partyOf, type Session } from "./sessions.js";

const subscribers = new Map<string, Set<() => void>>();

export function startListening(): void {
  listen((ns) => subscribers.get(ns)?.forEach((wake) => wake()));
  setInterval(() => void releaseAbandonedHolds().catch(() => undefined), 1000).unref();
}

async function eventsAfter(ns: string, after: number, viewer: Party, subject: string): Promise<StreamEvent[]> {
  const rows = await query<StreamEvent & { sequence: string; offers: string[] }>(
    `SELECT command_id, actor, type, sequence, at, detail FROM desk_events
     WHERE ns = $1 AND sequence > $2 AND (
       $3 OR offers && COALESCE((SELECT array_agg(key) FROM offers WHERE ns = $1 AND data->>'status' <> 'draft'), '{}')
       OR (type = 'access.ended' AND detail->>'subject' = $4))
     ORDER BY sequence`,
    [ns, after, viewer === "dealer", subject],
  );
  return rows.map((e) => ({ ...e, sequence: Number(e.sequence), at: new Date(e.at).toISOString() }));
}

/** Ends a revoked or password-changed account's access once, with one `access.ended` event. */
async function endAccess(ns: string, subject: string): Promise<void> {
  if (!(await endSessionsOf(subject))) return;
  await transaction(async (client) => {
    const desk = await loadDesk(client, ns, true);
    if (!desk) return;
    desk.event("access.ended", "system", `access.ended:${subject}:${randomUUID()}`, [], { subject });
    await desk.save(client);
  });
  await notify(ns);
}

export async function openStream(res: ServerResponse, session: Session, after: number): Promise<void> {
  const ns = session.ns;
  const party = partyOf(session);
  let last = after;
  let closed = false;
  let flushing: Promise<void> | null = null;
  let again = false;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(": desk stream\n\n");
  const flush = (): Promise<void> => {
    if (flushing) {
      again = true;
      return flushing;
    }
    flushing = (async () => {
      do {
        again = false;
        const events = await eventsAfter(ns, last, party, session.subject).catch(() => []);
        for (const event of events) {
          if (closed) return;
          res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);
          last = event.sequence;
        }
      } while (again && !closed);
    })().finally(() => {
      flushing = null;
    });
    return flushing;
  };
  const wake = () => void flush();
  if (!subscribers.has(ns)) subscribers.set(ns, new Set());
  subscribers.get(ns)!.add(wake);
  const stream = randomUUID();
  const timers: NodeJS.Timeout[] = [setInterval(() => res.write(": keepalive\n\n"), 15000)];
  const close = () => {
    if (closed) return;
    closed = true;
    timers.forEach(clearInterval);
    subscribers.get(ns)?.delete(wake);
    if (party === "counterpart") {
      void query("DELETE FROM stream_presence WHERE stream = $1", [stream])
        .then(() =>
          query(
            `INSERT INTO stream_departures (ns, subject, left_at) VALUES ($1,$2,now())
             ON CONFLICT (ns, subject) DO UPDATE SET left_at = now()`,
            [ns, session.subject],
          ),
        )
        .catch(() => undefined);
    }
  };
  res.on("close", close);
  // The browser may already have gone while the stream was being prepared.
  if (!res.socket || res.socket.destroyed) close();
  if (closed) return;
  if (party === "counterpart") {
    await query("INSERT INTO stream_presence (stream, ns, subject, heartbeat_at) VALUES ($1,$2,$3,now())", [stream, ns, session.subject]);
    // The stream may have closed while the presence row was being written.
    if (closed) {
      await query("DELETE FROM stream_presence WHERE stream = $1", [stream]);
      return;
    }
    timers.push(setInterval(() => void query("UPDATE stream_presence SET heartbeat_at = now() WHERE stream = $1", [stream]).catch(() => undefined), 10000));
    let checking = false;
    timers.push(
      setInterval(() => {
        if (checking || closed || session.keycloak_session === null) return;
        checking = true;
        accountActive(session.subject, session.keycloak_session)
          .then(async (active) => {
            if (active || closed) return;
            await endAccess(ns, session.subject);
            await flush();
            res.end();
          })
          .catch(() => undefined)
          .finally(() => {
            checking = false;
          });
      }, config.limits.FLAN_LIVE_MS),
    );
  }
  await flush();
}

/** Releases review holds whose counterpart has had no open stream for FLAN_HOLD_GRACE_S. */
async function releaseAbandonedHolds(): Promise<void> {
  const due = await query<{ ns: string; key: string }>(
    `SELECT o.ns, o.key FROM offers o, jsonb_array_elements(o.data->'holds') h
     WHERE NOT EXISTS (SELECT 1 FROM stream_presence p WHERE p.ns = o.ns AND p.heartbeat_at > now() - interval '45 seconds')
       AND GREATEST((h->>'placed_at')::timestamptz,
                    COALESCE((SELECT max(d.left_at) FROM stream_departures d WHERE d.ns = o.ns), '-infinity'))
           <= now() - make_interval(secs => $1)
     GROUP BY o.ns, o.key`,
    [config.limits.FLAN_HOLD_GRACE_S],
  );
  for (const { ns, key } of due) {
    await transaction(async (client) => {
      const desk = await loadDesk(client, ns, true);
      const offer = desk?.offers.get(key);
      if (!desk || !offer) return;
      for (const hold of [...offer.holds]) releaseHeld(desk, offer, hold.specimen, "system", `hold.released:${key}:${hold.specimen}:${randomUUID()}`);
      await desk.save(client);
    });
    await notify(ns);
  }
}
