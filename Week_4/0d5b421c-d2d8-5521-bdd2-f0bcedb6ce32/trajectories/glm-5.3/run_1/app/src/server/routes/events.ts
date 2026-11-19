import express, { type Response } from "express";
import { now } from "../clock.js";
import { errors } from "../errors.js";
import { Handled } from "../http.js";
import { validDateString, dateInHorizon } from "./validate.js";
import type { AppCtx } from "../app.js";

/** Fields carried on the Valkey stream per event. */
export interface StreamEvent {
  id: string;
  type: string;
  date: string;
  time: string;
  table_ids: string[];
  party_size: number | null;
  reference?: string | undefined;
  name?: string | undefined;
  expires_at?: string | undefined;
}

function parseEvent(id: string, fields: Record<string, string>): StreamEvent {
  return {
    id,
    type: fields.__type ?? "",
    date: fields.date ?? "",
    time: fields.time ?? "",
    table_ids: (fields.table_ids ?? "").split(",").filter((s) => s !== ""),
    party_size: fields.party_size === "" || fields.party_size === undefined ? null : Number(fields.party_size),
    reference: fields.reference === "" || fields.reference === undefined ? undefined : fields.reference,
    name: fields.name === "" || fields.name === undefined ? undefined : fields.name,
    expires_at: fields.expires_at === "" || fields.expires_at === undefined ? undefined : fields.expires_at,
  };
}

export function registerEventRoutes(app: express.Express, ctx: AppCtx): void {
  const { valkey } = ctx;

  /** Public stream for a date: type, date, time, table_ids and party_size only. */
  app.get("/api/floor/events", async (req, res) => {
    const date = String(req.query.date ?? "");
    if (!validDateString(date) || !dateInHorizon(date)) {
      throw new Handled(errors.validation({ date: "Choose a date from today to 30 days ahead." }));
    }
    const lastEventId = typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null;
    await streamEvents(req as { headers: Record<string, unknown> }, res, date, lastEventId, false, valkey);
  });

  /** Host stream: tonight's events with reference, name and expires_at added. */
  app.get("/api/host/events", async (req, res) => {
    const cookie = req.headers.cookie ?? "";
    const m = /(?:^|;\s*)host_session=([^;]+)/.exec(cookie);
    if (!m) {
      res.status(401).json({ error: { code: "unauthenticated", message: "Sign in to continue." } });
      return;
    }
    const lastEventId = typeof req.headers["last-event-id"] === "string" ? req.headers["last-event-id"] : null;
    await streamEvents(req as { headers: Record<string, unknown> }, res, todayInLisbonDate(), lastEventId, true, valkey);
  });
}

import { todayInLisbon } from "../config.js";

function todayInLisbonDate(): string {
  return todayInLisbon(now());
}

async function streamEvents(
  req: { headers: Record<string, unknown> }, res: Response, date: string, lastEventId: string | null,
  host: boolean, valkey: import("../valkey.js").Valkey,
): Promise<void> {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let closed = false;
  const onClosed = (): void => { closed = true; };
  reqClose(req, onClosed);

  // One dedicated Valkey connection for this stream; released when it closes.
  const conn = valkey.streamConnection();
  res.on("close", () => { closed = true; conn.disconnect(); });

  // Send a retry hint so browsers reconnect quickly.
  res.write("retry: 1500\n\n");

  // Replay every kept event later than Last-Event-ID, in commit order.
  let last = lastEventId;
  try {
    const history = await valkey.readRange(date, lastEventId);
    for (const ev of history) {
      if (host || isPublicEvent(ev.fields.__type ?? "")) {
        res.write(formatSse(parseEvent(ev.id, ev.fields), host));
      }
      last = ev.id;
    }
  } catch { /* stream unavailable: continue with live events */ }

  // Live events until the client goes away.
  while (!closed && !res.writableEnded) {
    const batch = await valkey.readOn(conn, date, last ?? "$", 1000);
    for (const ev of batch) {
      if (host || isPublicEvent(ev.fields.__type ?? "")) {
        res.write(formatSse(parseEvent(ev.id, ev.fields), host));
      }
      last = ev.id;
    }
  }
  conn.disconnect();
  res.end();
}

function isPublicEvent(type: string): boolean {
  return type !== "";
}

function formatSse(ev: StreamEvent, host: boolean): string {
  const payload: Record<string, unknown> = {
    type: ev.type,
    date: ev.date,
    time: ev.time,
    table_ids: ev.table_ids,
    party_size: ev.party_size,
  };
  if (host) {
    payload.reference = ev.reference ?? null;
    payload.name = ev.name ?? null;
    payload.expires_at = ev.expires_at ?? null;
  }
  return `id: ${ev.id}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function reqClose(req: { headers: Record<string, unknown> }, cb: () => void): void {
  const res = req as unknown as { on?: (event: string, fn: () => void) => void; socket?: { on: (e: string, fn: () => void) => void } };
  if (typeof res.on === "function") res.on("close", cb);
  if (res.socket) res.socket.on("close", cb);
}
