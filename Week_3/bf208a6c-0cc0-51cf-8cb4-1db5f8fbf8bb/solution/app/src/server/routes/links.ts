import { callerOf, open, resolveAccess } from "../access";
import { pool } from "../db";
import { serveStream, writeBoard } from "../events";
import { json, notFound, param, passwordRequired, signInRequired, type Reply, type Request } from "../http";
import { boardOf, listingOf } from "../views";
import { unlock } from "./boards";
import { strongest } from "../../shared/permissions";
import type { LinkPage } from "../../shared/types";

const lookupOf = (request: Request) => ({ linkToken: param(request, "token") });

export async function read(request: Request): Promise<Reply> {
  const access = await open(request, lookupOf(request));
  const page: LinkPage = {
    board: await boardOf(pool, access.board, access.role),
    posts: await listingOf(pool, access.board, access.role, access.caller.user?.id ?? null),
  };
  return json(200, page);
}

export const unlockLink = (request: Request): Promise<Reply> => unlock(request, lookupOf(request));

export async function events(request: Request): Promise<Reply> {
  await serveStream(request, lookupOf(request));
  return null;
}

/** A signed-in holder joins as the link allows; joining never lowers an existing role. */
export async function join(request: Request): Promise<Reply> {
  const caller = await callerOf(request);
  const access = await resolveAccess(caller, lookupOf(request));
  if (access.kind === "not_found") throw notFound();
  if (access.kind === "password_required") throw passwordRequired();
  if (!caller.user) throw signInRequired();
  const user = caller.user;
  const role = strongest(access.role, access.board.link_access === "contribute" ? "contributor" : "viewer");
  if (access.role !== role) {
    await writeBoard(access.board.id, async ({ db, emit, accessChanged }) => {
      await db.query(`INSERT INTO members (board_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (board_id, user_id) DO UPDATE SET role = EXCLUDED.role`, [access.board.id, user.id, role]);
      accessChanged();
      await emit({ type: "role_changed", role }, { scope: "user", userId: user.id });
      await emit({ type: "members_changed" }, { scope: "user", userId: access.board.owner_id });
    });
  }
  return json(200, { board_id: access.board.id, role });
}
