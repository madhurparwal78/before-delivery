// Live views: every copy LISTENs for committed changes and pushes them to its open pages over a same-origin
// WebSocket (`/api/events`), each page receiving only the events meant for its buyer cookie or the offer it shows.
// The socket only ever sends small text frames; the pages never send anything but the protocol's own replies.
import { createHash } from "node:crypto";
import type { Duplex } from "node:stream";
import pg from "pg";
import type { LiveEvent } from "../shared/types.js";
import { config } from "./config.js";
import { CHANNEL, type Notice } from "./db.js";
import { deliverQueued } from "./outbox.js";

interface Listener {
  socket: Duplex;
  buyerId: string;
  offerToken: string | null;
}

const listeners = new Set<Listener>();

function eventFor(notice: Notice, listener: Listener): LiveEvent | null {
  switch (notice.k) {
    case "seats":
      return { type: "seats", performanceId: notice.p };
    case "performances":
      return { type: "performances" };
    case "outbox":
      return { type: "outbox" };
    case "buyer":
      return notice.b === listener.buyerId ? { type: "buyer" } : null;
    case "hold_ended":
      return notice.b === listener.buyerId ? { type: "hold_ended", performanceId: notice.p, expiresAt: notice.e } : null;
    case "offer":
      return notice.b === listener.buyerId ? { type: "offer", token: notice.t, label: notice.l } : null;
    case "offer_closed":
      return notice.t === listener.offerToken
        ? { type: "offer_closed", token: notice.t, byThisBrowser: notice.by === listener.buyerId }
        : null;
  }
}

function broadcast(notice: Notice): void {
  if (notice.k === "outbox") void deliverQueued();
  for (const listener of listeners) {
    const event = eventFor(notice, listener);
    if (event) listener.socket.write(textFrame(JSON.stringify(event)));
  }
}

/** An unmasked, final text frame (RFC 6455 §5.2); events are far shorter than 64 KiB. */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = payload.length < 126
    ? Buffer.from([0x81, payload.length])
    : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

const PING = Buffer.from([0x89, 0x00]);
const CLOSE = Buffer.from([0x88, 0x00]);
const HANDSHAKE_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** Completes the WebSocket handshake and registers the page for the events it may see. */
export function openSocket(socket: Duplex, key: string, buyerId: string, offerToken: string | null, setCookies: string[]): void {
  const accept = createHash("sha1").update(key + HANDSHAKE_GUID).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${accept}`,
    ...setCookies.map((cookie) => `Set-Cookie: ${cookie}`), "", "",
  ].join("\r\n"));
  const listener = { socket, buyerId, offerToken };
  listeners.add(listener);
  socket.on("data", (chunk: Buffer) => {
    // A close frame from the page (opcode 8) is answered and the socket ends; pongs need no answer.
    if ((chunk[0] & 0x0f) === 0x8) socket.end(CLOSE);
  });
  socket.on("close", () => listeners.delete(listener));
  socket.on("error", () => listeners.delete(listener));
}

setInterval(() => {
  for (const listener of listeners) listener.socket.write(PING);
}, 15_000).unref();

/** Keeps one LISTEN connection open, reconnecting every 2 s while Postgres is away. */
export function listen(): void {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  let retried = false;
  const retry = (): void => {
    if (retried) return;
    retried = true;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    setTimeout(listen, 2000);
  };
  client.on("error", retry);
  client.on("notification", (message) => {
    if (message.payload) broadcast(JSON.parse(message.payload) as Notice);
  });
  client.connect().then(() => client.query(`LISTEN ${CHANNEL}`)).catch(retry);
}
