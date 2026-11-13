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
  openStream(context);
  let lastSent: number | null | undefined;
  const send = (readers: number | null): void => {
    context.response.write(`event: readers\ndata: ${JSON.stringify({ readers })}\n\n`);
    lastSent = readers;
  };
  send(await countReaders(mission.id));
  const poll = setInterval(() => {
    void countReaders(mission.id).then((readers) => {
      if (readers !== lastSent) {
        send(readers);
      }
    });
  }, READER_POLL_MS);
  const comment = setInterval(() => {
    context.response.write(": keep-alive\n\n");
  }, COMMENT_INTERVAL_MS);
  await new Promise<void>((resolve) => {
    const close = (): void => {
      clearInterval(poll);
      clearInterval(comment);
      resolve();
    };
    context.response.on("close", close);
  });
}

export async function shareStream(
  context: Context,
  link: ShareLinkRow,
  lastEventId: string | null,
): Promise<void> {
  const streamId = randomUUID();
  openStream(context);
  await touchReader(link.mission_id, streamId);

  const currentVersion = async (): Promise<number> => {
    const result = await pool.query<{ change_version: number }>(
      "select change_version from missions where id = $1",
      [link.mission_id],
    );
    return result.rows[0]?.change_version ?? 0;
  };

  const sendVersion = (version: number): void => {
    context.response.write(
      `event: mission-changed\nid: ${version}\ndata: ${JSON.stringify({ version })}\n\n`,
    );
  };

  const current = await currentVersion();
  let lastApplied = current;
  const resumeFrom = lastEventId !== null && /^\d+$/.test(lastEventId) ? Number(lastEventId) : null;
  if (resumeFrom !== null && resumeFrom >= current - 1000 && resumeFrom <= current) {
    for (let version = resumeFrom + 1; version <= current; version += 1) {
      sendVersion(version);
    }
  } else {
    sendVersion(current);
  }

  let lastWrite = Date.now();
  const unsubscribe = onMissionChange((notice) => {
    if (notice.mission_id !== link.mission_id || notice.version <= lastApplied) {
      return;
    }
    for (let version = lastApplied + 1; version <= notice.version; version += 1) {
      sendVersion(version);
    }
    lastApplied = notice.version;
    lastWrite = Date.now();
  });

  const renew = setInterval(() => {
    void touchReader(link.mission_id, streamId);
  }, READER_RENEW_MS);
  const comment = setInterval(() => {
    if (Date.now() - lastWrite >= COMMENT_INTERVAL_MS) {
      context.response.write(": keep-alive\n\n");
      lastWrite = Date.now();
    }
  }, 1000);
  const stateWatch = setInterval(() => {
    if (Date.now() >= link.expires_ms) {
      context.response.end();
      return;
    }
    void pool
      .query<{ revoked: boolean }>("select revoked from share_links where id = $1", [link.id])
      .then((result) => {
        if (result.rows[0]?.revoked === true) {
          context.response.end();
        }
      });
  }, 1000);

  await new Promise<void>((resolve) => {
    const close = (): void => {
      unsubscribe();
      clearInterval(renew);
      clearInterval(comment);
      clearInterval(stateWatch);
      void releaseReader(link.mission_id, streamId);
      resolve();
    };
    context.response.on("close", close);
  });
}
