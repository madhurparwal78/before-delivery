// The two per-member rate limits, counted on accepted requests only.

import { cityOf, localTime, type TimeZone } from "../shared/time";
import { config } from "./config";
import { one, pool, type Db } from "./db";
import { ApiError } from "./errors";
import type { Caller } from "./http";
import { memberRow } from "./members";

interface RateRule {
  kind: string;
  limit: number;
  windowSeconds: number;
  copy: (time: string) => string;
}

const MESSAGES: RateRule = {
  kind: "message",
  limit: 10,
  windowSeconds: config.messageRateWindowSeconds,
  copy: (time) => `Too many messages for now. You can send another at ${time}.`,
};

const DOWNLOADS: RateRule = {
  kind: "download",
  limit: 5,
  windowSeconds: config.fileRateWindowSeconds,
  copy: (time) => `Too many downloads for now. You can download again at ${time}.`,
};

// The Retry-After instant in the member's time, rounded up to a whole minute.
function retryTime(at: Date, zone: TimeZone): string {
  const minute = 60000;
  const rounded = new Date(Math.ceil(at.getTime() / minute) * minute);
  return `${localTime(rounded, zone)} ${cityOf(zone)} time`;
}

async function refuseWhenFull(db: Db, rule: RateRule, personId: string): Promise<void> {
  const member = await memberRow(db, personId);
  if (!member?.time_zone) return;
  const counted = await one<{ count: string; oldest: Date | null }>(
    db,
    `SELECT count(*) AS count, min(at) AS oldest FROM rate_events
     WHERE person_id = $1 AND kind = $2 AND at > now() - make_interval(secs => $3)`,
    [personId, rule.kind, rule.windowSeconds],
  );
  if (!counted || Number(counted.count) < rule.limit || !counted.oldest) return;
  const freeAt = counted.oldest.getTime() + rule.windowSeconds * 1000;
  const retryAfter = Math.max(1, Math.ceil((freeAt - Date.now()) / 1000));
  const copy = rule.copy(retryTime(new Date(Date.now() + retryAfter * 1000), member.time_zone));
  throw new ApiError(429, "rate_limited", copy, undefined, { "Retry-After": String(retryAfter) });
}

export const enforceMessageLimit = (caller: Caller): Promise<void> => refuseWhenFull(pool, MESSAGES, caller.id);
export const enforceDownloadLimit = (caller: Caller): Promise<void> => refuseWhenFull(pool, DOWNLOADS, caller.id);

// Inside the writer's transaction: requests racing past the first check take turns here, so the limit holds.
async function count(db: Db, rule: RateRule, personId: string, now: Date): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${personId}|${rule.kind}`]);
  await refuseWhenFull(db, rule, personId);
  await db.query("INSERT INTO rate_events (person_id, kind, at) VALUES ($1, $2, $3)", [personId, rule.kind, now]);
}

export const countMessage = (db: Db, personId: string, now: Date): Promise<void> => count(db, MESSAGES, personId, now);
export const countDownload = (db: Db, personId: string, now: Date): Promise<void> => count(db, DOWNLOADS, personId, now);
