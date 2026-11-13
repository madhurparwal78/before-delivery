/** The author's reader-count stream and the share link's mission-changed stream. */

import { randomUUID } from "node:crypto";
import { pool, onMissionChange } from "../db/pool.js";
import { countReaders, releaseReader, touchReader } from "../services/cache.js";
import type { Context } from "../http/context.js";
import type { MissionRow } from "../domain/missionRead.js";
import type { ShareLinkRow } from "../domain/share.js";

const COMMENT_INTERVAL_MS = 15_000;
const READER_POLL_MS = 2000;
const READER_RENEW_MS = 10_000;

function openStream(context: Context): void {
  context.response.writeHead(200, {
    ...context.extraHeaders,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
}

export async function authorStream(context: Context, mission: MissionRow): Promise<void> {
  const disconnected = new Promise<void>((resolve) => context.response.once("close", resolve));
  const timers: ReturnType<typeof setInterval>[] = [];
  openStream(context);
  let lastSent: number | null | undefined;
  const send = (readers: number | null): void => {
    if (context.response.destroyed) return;
    context.response.write(`event: readers\ndata: ${JSON.stringify({ readers })}\n\n`);
    lastSent = readers;
  };
  try {
    send(await countReaders(mission.id));
    if (context.response.destroyed) return;
    timers.push(setInterval(() => {
      void countReaders(mission.id).then((readers) => {
        if (readers !== lastSent) send(readers);
      });
    }, READER_POLL_MS));
    timers.push(setInterval(() => {
      context.response.write(": keep-alive\n\n");
    }, COMMENT_INTERVAL_MS));
    await disconnected;
  } finally {
    for (const timer of timers) clearInterval(timer);
  }
}

export async function shareStream(
  context: Context,
  link: ShareLinkRow,
  lastEventId: string | null,
): Promise<void> {
  const streamId = randomUUID();
  const disconnected = new Promise<void>((resolve) => context.response.once("close", resolve));
  const timers: ReturnType<typeof setInterval>[] = [];
  let lastApplied: number | null = null;
  let pendingVersion = 0;
  let lastWrite = Date.now();
  const currentVersion = async (): Promise<number> => {
    const result = await pool.query<{ change_version: number }>(
      "select change_version from missions where id = $1", [link.mission_id],
    );
    return result.rows[0].change_version;
  };
  const sendVersion = (version: number): void => {
    if (context.response.destroyed) return;
    context.response.write(
      `event: mission-changed\nid: ${version}\ndata: ${JSON.stringify({ version })}\n\n`,
    );
    lastWrite = Date.now();
  };
  const sendThrough = (version: number): void => {
    if (lastApplied === null) {
      pendingVersion = Math.max(pendingVersion, version);
      return;
    }
    for (let next = lastApplied + 1; next <= version; next += 1) sendVersion(next);
    lastApplied = Math.max(lastApplied, version);
  };
  // Subscribe before reading the snapshot; notices during initialization are buffered.
  const unsubscribe = onMissionChange((notice) => {
    if (notice.mission_id === link.mission_id) sendThrough(notice.version);
  });
  openStream(context);
  try {
    await touchReader(link.mission_id, streamId);
    if (context.response.destroyed) return;
    const current = await currentVersion();
    if (context.response.destroyed) return;
    const resumeFrom = lastEventId !== null && /^\d+$/.test(lastEventId) ? Number(lastEventId) : null;
    if (resumeFrom !== null && resumeFrom >= current - 1000 && resumeFrom <= current) {
      for (let version = resumeFrom + 1; version <= current; version += 1) sendVersion(version);
    } else {
      sendVersion(current);
    }
    lastApplied = current;
    sendThrough(pendingVersion);
    timers.push(setInterval(() => {
      void touchReader(link.mission_id, streamId);
    }, READER_RENEW_MS));
    timers.push(setInterval(() => {
      if (Date.now() - lastWrite >= COMMENT_INTERVAL_MS) {
        context.response.write(": keep-alive\n\n");
        lastWrite = Date.now();
      }
    }, 1000));
    timers.push(setInterval(() => {
      if (Date.now() >= link.expires_ms) {
        context.response.end();
        return;
      }
      void pool.query<{ revoked: boolean }>(
        "select revoked from share_links where id = $1", [link.id],
      ).then(async (result) => {
        if (result.rows[0].revoked) {
          // The terminal version must precede stream closure even if its notice is delayed.
          sendThrough(await currentVersion());
          context.response.end();
        }
      }).catch(() => context.response.end());
    }, 1000));
    await disconnected;
  } finally {
    unsubscribe();
    for (const timer of timers) clearInterval(timer);
    await releaseReader(link.mission_id, streamId);
  }
}
