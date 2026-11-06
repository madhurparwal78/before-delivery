/**
 * The project live stream. Browsers hold one server-sent-event stream per open
 * project; the server polls PocketBase and relays presence, comments and
 * placement changes to every other open view.
 *
 * Nothing records that PocketBase is down: each cycle calls it afresh, so the
 * first cycle that succeeds resumes live collaboration on its own.
 */

import { initialsOf } from "../../shared/domain.js";
import type { Comment, LiveEvent, Placement, PresenceViewer, User } from "../../shared/types.js";
import type { Ctx } from "../http/context.js";
import * as pocketbase from "../services/pocketbase.js";
import { ProviderUnavailable } from "../services/provider.js";

/** A viewer appears within 3 seconds and changes reach every view within 3 seconds. */
const POLL_INTERVAL_MS = 2_000;
/** Presence is refreshed every 10 seconds while a project is open. */
const PRESENCE_REFRESH_MS = 10_000;
/** PocketBase is retried on this cadence while it is unreachable. */
const RECONNECT_INTERVAL_MS = 5_000;

interface Subscriber {
  send: (event: LiveEvent) => void;
}

const subscribersByProject = new Map<string, Set<Subscriber>>();

function subscribers(projectId: string): Set<Subscriber> {
  const existing = subscribersByProject.get(projectId);
  if (existing) return existing;
  const created = new Set<Subscriber>();
  subscribersByProject.set(projectId, created);
  return created;
}

function broadcast(projectId: string, event: LiveEvent, except?: Subscriber): void {
  for (const subscriber of subscribersByProject.get(projectId) ?? []) {
    if (subscriber === except) continue;
    subscriber.send(event);
  }
}

/**
 * Mirrors a saved placement change into PocketBase and relays it to the other open
 * rooms. Returns whether live collaboration is connected.
 */
export async function publishPlacement(
  projectId: string,
  action: "created" | "updated" | "deleted",
  placement: Placement,
): Promise<boolean> {
  broadcast(projectId, { type: "placement", action, placement });
  try {
    await pocketbase.recordPlacementChange({
      projectId,
      placementId: placement.id,
      variantCode: placement.variant_code,
      xMm: placement.x_mm,
      yMm: placement.y_mm,
      action,
    });
    return true;
  } catch (error) {
    if (error instanceof ProviderUnavailable) return false;
    throw error;
  }
}

/** Holds one browser's stream open until it disconnects. */
export async function subscribeToProject(ctx: Ctx, projectId: string, user: User): Promise<void> {
  const { res } = ctx;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });

  const write = (event: LiveEvent): void => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const subscriber: Subscriber = { send: write };
  subscribers(projectId).add(subscriber);

  let lastCommentId: string | null = null;
  let seenComments = new Set<string>();
  let lastPresenceKey = "";
  let lastLive: boolean | null = null;
  let lastPresenceTouch = 0;

  const cycle = async (): Promise<void> => {
    try {
      const now = Date.now();
      if (now - lastPresenceTouch >= PRESENCE_REFRESH_MS) {
        await pocketbase.touchPresence({ projectId, userId: user.id, name: user.name });
        lastPresenceTouch = now;
      }

      const [presence, comments] = await Promise.all([
        pocketbase.listPresence(projectId),
        pocketbase.listComments(projectId),
      ]);

      if (lastLive !== true) {
        lastLive = true;
        write({ type: "status", live: true });
      }

      const viewers: PresenceViewer[] = presence.map((record) => ({
        user_id: record.user_id,
        name: record.name,
        initials: initialsOf(record.name),
      }));
      const presenceKey = viewers
        .map((viewer) => viewer.user_id)
        .sort()
        .join(",");
      if (presenceKey !== lastPresenceKey) {
        lastPresenceKey = presenceKey;
        write({ type: "presence", viewers });
      }

      // The first cycle only records which comments already exist.
      if (lastCommentId === null) {
        seenComments = new Set(comments.map((comment) => comment.id));
        lastCommentId = comments[comments.length - 1]?.id ?? "";
      } else {
        for (const comment of comments) {
          if (seenComments.has(comment.id)) continue;
          seenComments.add(comment.id);
          const dto: Comment = {
            id: comment.id,
            author_name: comment.author_name,
            body: comment.body,
            created_at: comment.created,
          };
          write({ type: "comment", comment: dto });
        }
      }
    } catch (error) {
      if (!(error instanceof ProviderUnavailable)) throw error;
      if (lastLive !== false) {
        lastLive = false;
        write({ type: "status", live: false });
      }
      // Reset so the comment baseline is rebuilt when PocketBase returns.
      lastCommentId = null;
    }
  };

  await cycle();

  const timer = setInterval(() => {
    void cycle().catch(() => undefined);
  }, POLL_INTERVAL_MS);
  const reconnectTimer = setInterval(() => {
    if (lastLive === false) void cycle().catch(() => undefined);
  }, RECONNECT_INTERVAL_MS);

  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearInterval(timer);
      clearInterval(reconnectTimer);
      subscribers(projectId).delete(subscriber);
      void pocketbase.dropPresence({ projectId, userId: user.id }).catch(() => undefined);
      resolve();
    };
    ctx.res.on("close", finish);
    ctx.res.on("error", finish);
  });
}
