import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { recordActivity } from "./activity.ts";
import { OWNER_ONLY, requireMember, requireRole, roleIn } from "./access.ts";
import type { Database } from "./db.ts";
import { rows } from "./db.ts";
import { insertDocument, loadDocument } from "./documents.ts";
import { ApiError, notFound, writeJson } from "./errors.ts";
import type { Router } from "./http.ts";
import { parsedJson, requireUser } from "./http.ts";
import { oneOf, object, str } from "../shared/schema.ts";
import { BLANK_STAGE_BPM, blankStage } from "../shared/starter.ts";
import type { MemberDoc, Role, SetDocument, SetListing } from "../shared/types.ts";

const SET_NAME_MESSAGE = "Set name must be 1 to 80 characters";

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

export function emptyDocument(id: string, name: string, bpm: number): SetDocument {
  return {
    set: {
      id, name, bpm, head: 0, settings_version: 1, graph_version: 1, active_camera_id: null, show_token: newToken(), role: "owner",
    },
    layers: [],
    keys: [],
    graph: { version: 1, nodes: [], wires: [] },
    scripts: [],
  };
}

async function createBlankStageSet(tx: PoolClient, ownerId: string, name: string): Promise<SetDocument> {
  const stage = blankStage(randomUUID);
  const doc = emptyDocument(randomUUID(), name, BLANK_STAGE_BPM);
  doc.layers = stage.layers;
  doc.graph = stage.graph;
  doc.set.active_camera_id = stage.activeCameraId;
  await insertDocument(tx, doc, ownerId);
  return doc;
}

export class Sets {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  register(router: Router): void {
    const createBody = object({
      name: str({ trim: true, min: 1, max: 80, message: SET_NAME_MESSAGE }),
      starter: oneOf(["blank-stage"], "Choose the Blank stage starter"),
    });

    router.add("GET", "/api/sets", {}, async (ctx) => {
      const user = requireUser(ctx);
      const listing = await rows<SetListing>(this.db, 
        `SELECT s.id, s.name, m.role, s.bpm, s.head, s.live_number
         FROM members m JOIN sets s ON s.id = m.set_id WHERE m.user_id = $1 ORDER BY s.created_at, s.id`,
        [user.id],
      );
      writeJson(ctx.res, 200, { sets: listing });
    });

    router.add("POST", "/api/sets", { body: "json" }, async (ctx) => {
      const user = requireUser(ctx);
      const body = parsedJson(ctx, createBody);
      const doc = await this.db.transaction((tx) => createBlankStageSet(tx, user.id, body.name));
      writeJson(ctx.res, 201, doc);
    });

    router.add("GET", "/api/sets/:id", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      writeJson(ctx.res, 200, await loadDocument(this.db, membership.setId, membership.role));
    });

    router.add("GET", "/api/sets/:id/members", {}, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      const members = await rows<MemberDoc>(this.db, 
        `SELECT u.id AS user_id, u.display_name, u.email, m.role FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.set_id = $1 ORDER BY m.joined_at, u.id`,
        [membership.setId],
      );
      writeJson(ctx.res, 200, { members });
    });

    router.add("POST", "/api/sets/:id/invites", { body: "json" }, async (ctx) => {
      const membership = await requireMember(this.db, ctx);
      requireRole(membership, OWNER_ONLY);
      const body = parsedJson(ctx, object({ role: oneOf(["editor", "viewer"], "Choose editor or viewer") }));
      const token = newToken();
      await this.db.query("INSERT INTO invites (token, set_id, role, created_by) VALUES ($1,$2,$3,$4)", [token, membership.setId, body.role, membership.userId]);
      writeJson(ctx.res, 201, { token, url: `/join/${token}`, role: body.role });
    });

    router.add("GET", "/api/invites/:token", { public: true }, async (ctx) => {
      const [invite] = await rows<{ set_name: string; role: Role; owner_display_name: string; used: boolean }>(this.db, 
        `SELECT s.name AS set_name, i.role, o.display_name AS owner_display_name, i.used_by IS NOT NULL AS used
         FROM invites i JOIN sets s ON s.id = i.set_id JOIN users o ON o.id = s.owner_id WHERE i.token = $1`,
        [ctx.params["token"] ?? ""],
      );
      if (!invite) throw notFound();
      writeJson(ctx.res, 200, invite);
    });

    router.add("POST", "/api/invites/:token/accept", {}, async (ctx) => {
      const user = requireUser(ctx);
      const accepted = await this.db.transaction(async (tx) => {
        const [invite] = await rows<{ set_id: string; role: Role; used_by: string | null }>(
          tx, "SELECT set_id, role, used_by FROM invites WHERE token = $1 FOR UPDATE", [ctx.params["token"] ?? ""],
        );
        if (!invite) throw notFound();
        const existing = await roleIn(tx, invite.set_id, user.id);
        if (existing) return { set_id: invite.set_id, role: existing };
        if (invite.used_by !== null) throw new ApiError(410, "invite_used", "This invite link has already been used");
        await tx.query("INSERT INTO members (set_id, user_id, role) VALUES ($1,$2,$3)", [invite.set_id, user.id, invite.role]);
        await tx.query("UPDATE invites SET used_by = $2 WHERE token = $1", [ctx.params["token"], user.id]);
        await recordActivity(tx, invite.set_id, user.id, "member.join", user.id, `${user.display_name} joined as ${invite.role}`);
        return { set_id: invite.set_id, role: invite.role };
      });
      writeJson(ctx.res, 200, accepted);
    });
  }
}
