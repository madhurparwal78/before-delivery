// Live event streams stored in Postgres (brief: Business rules, Live streams). Each stream's ids are contiguous
// integers from 1, allocated by the writer while it holds the barn day's or horse's row lock, so commit order
// can never skip a number; every instance reads the same rows, replays from Last-Event-ID and polls for new ones.
import { sessionValid } from "./auth.js";
import { now } from "./clock.js";
import { config } from "./config.js";
import { db, first } from "./db.js";
const POLL_MS = 300;
const SESSION_CHECK_MS = 2_000;
export const dayStream = (dayId, role) => `day:${dayId}:${role}`;
export const horseStream = (horseId, audience) => `horse:${horseId}:${audience}`;
/** Appends one event; the caller holds the lock that serialises this stream's writers. */
export async function appendEvent(client, stream, event, data) {
    await client.query(`INSERT INTO stream_events (stream, seq, event, data, at)
     SELECT $1, coalesce(max(seq), 0) + 1, $2, $3, $4 FROM stream_events WHERE stream = $1`, [stream, event, JSON.stringify(data), new Date(now())]);
}
const openStreams = new Set();
/** Ends every open stream on this instance (graceful shutdown). */
export function endAllStreams() {
    for (const end of [...openStreams])
        end();
}
const frame = (event) => `id: ${event.seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
/**
 * Serves one stream until the client leaves, the session ends on any instance, or this instance shuts down.
 * Without Last-Event-ID only new events are sent; with it, n + 1 onward are replayed, or one reset is sent when
 * n + 1 fell out of the retained events or lies beyond the newest.
 */
export async function serveStream(req, res, stream, sessionHash, requestId) {
    const newest = first((await db.query(`SELECT coalesce(max(seq), 0)::int AS newest FROM stream_events WHERE stream = $1`, [stream]))
        .rows).newest;
    const header = req.headers["last-event-id"];
    const lastId = typeof header === "string" && /^\d+$/.test(header.trim()) ? Number(header.trim()) : null;
    res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-request-id": requestId,
    });
    res.write("retry: 2000\n\n");
    let cursor = newest;
    if (lastId !== null) {
        const oldestKept = Math.max(1, newest - config.sseRetentionEvents + 1);
        if (lastId > newest || (lastId + 1 < oldestKept && newest > 0))
            res.write("event: reset\ndata: {}\n\n");
        else
            cursor = lastId;
    }
    await new Promise((resolve) => {
        let ended = false;
        let polling = false;
        let lastSessionCheck = Date.now();
        const end = () => {
            if (ended)
                return;
            ended = true;
            clearInterval(poller);
            clearInterval(heartbeat);
            openStreams.delete(end);
            res.end();
            resolve();
        };
        const poll = async () => {
            if (polling || ended)
                return;
            polling = true;
            try {
                if (Date.now() - lastSessionCheck >= SESSION_CHECK_MS) {
                    lastSessionCheck = Date.now();
                    if (!(await sessionValid(sessionHash)))
                        return end();
                }
                const { rows } = await db.query(`SELECT seq, event, data FROM stream_events WHERE stream = $1 AND seq > $2 ORDER BY seq`, [stream, cursor]);
                for (const event of rows) {
                    if (ended)
                        break;
                    res.write(frame(event));
                    cursor = event.seq;
                }
            }
            catch {
                // The client reconnects with Last-Event-ID and resumes exactly where this stream stopped.
                end();
            }
            finally {
                polling = false;
            }
        };
        const poller = setInterval(() => void poll(), POLL_MS);
        const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), config.sseHeartbeatSeconds * 1000);
        openStreams.add(end);
        req.on("close", end);
        void poll();
    });
    return { status: 200, streamed: true };
}
