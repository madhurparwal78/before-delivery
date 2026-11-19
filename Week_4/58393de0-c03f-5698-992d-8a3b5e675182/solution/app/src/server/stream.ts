import type { ServerResponse } from "node:http";
import type { Account } from "../shared/types";
import { requirePrincipal } from "./auth";
import { CLASSROOM_COLUMNS, isEducatorOf, type ClassroomRow } from "./classrooms-store";
import { stateEvent } from "./classroom-events";
import { pool, rows } from "./db";
import type { Route } from "./http-types";
import { register, replay, write, writeEvent, type Connection } from "./stream-hub";
import { logged } from "./failures";

const BEAT_MS = 15_000;
const STATE_EVERY_BEATS = 2;

/** Pushes the state of every open classroom this account follows to one stream. */
async function pushClassroomStates(connection: Connection, account: Account): Promise<void> {
  const classrooms = await rows<ClassroomRow>(pool,
    `SELECT ${CLASSROOM_COLUMNS} FROM classrooms c
     WHERE c.archived_at IS NULL AND (c.id = $2 OR ${isEducatorOf("c.id", "$1")})`, [account.id, account.classroomId]);
  for (const classroom of classrooms) writeEvent(connection, "classroom-state", stateEvent(classroom));
}

function open(res: ServerResponse, account: Account, sessionHash: string, after: number | null): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  const connection: Connection = { res, accountId: account.id, sessionHash };
  register(connection);
  write(connection, ": open\n\n");
  if (after !== null) replay(connection, after);
  let beats = 0;
  const timer = setInterval(() => {
    write(connection, ": keep-alive\n\n");
    beats += 1;
    if (beats % STATE_EVERY_BEATS === 0) void pushClassroomStates(connection, account).catch(logged("classroom state push", undefined));
  }, BEAT_MS);
  res.once("close", () => clearInterval(timer));
}

/** `GET /api/stream`: the server-sent events of every signed-in session; `?after=<n>` first replays what it missed since event n. */
export const streamRoute: Route = {
  method: "GET",
  pattern: "/api/stream",
  async handler(req) {
    const { account, sessionHash } = await requirePrincipal(req);
    const resumed = req.headers["last-event-id"];
    const raw = typeof resumed === "string" && resumed !== "" ? resumed : req.query.get("after");
    const after = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
    return { status: 200, stream: (res) => open(res, account, sessionHash, after) };
  },
};
