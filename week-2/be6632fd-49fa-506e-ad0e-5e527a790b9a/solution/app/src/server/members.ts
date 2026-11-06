// Members of a workspace (brief: API → Members). Only the launch producer writes; a stockist buyer sees only
// themselves, so any other member id is unknown to them (404 at step 5, before the role check).
import { COPY, FIELD } from "../shared/copy";
import { type Member, ROLES, type Role, memberById, memberJson, randomToken, requireRole, sha256, staff } from "./auth";
import { config } from "./config";
import { type Db, nowSeconds, one, pool, rows, tx } from "./db";
import { ApiError, notFound, reply, route, validationFailed } from "./http";
import { queueMail } from "./mail";
import { checkEmail, failed, type Fields } from "./validate";

async function visibleMember(db: Db, me: Member, id: string): Promise<Member> {
  const member = await memberById(db, id);
  if (!member || member.workspaceId !== me.workspaceId) throw notFound();
  if (me.role === "stockist_buyer" && member.id !== me.id) throw notFound();
  return member;
}

function checkRole(value: unknown, fields: Fields): Role {
  if (value === undefined || value === null || value === "") fields.role = FIELD.required;
  else if (!(ROLES as readonly unknown[]).includes(value)) fields.role = "Choose one of the five roles.";
  return (ROLES as readonly unknown[]).includes(value) ? (value as Role) : "merchandiser";
}

async function checkStockist(db: Db, me: Member, role: Role, value: unknown, fields: Fields): Promise<string | null> {
  if (role !== "stockist_buyer") {
    if (value !== undefined && value !== null) fields.stockistId = "Leave the stockist empty for this role.";
    return null;
  }
  const found =
    typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
      ? await one(db, "SELECT 1 FROM stockists WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL", [value, me.workspaceId])
      : undefined;
  if (!found) fields.stockistId = FIELD.stockist;
  return found ? (value as string) : null;
}

/** 409 when the change would leave the workspace without a launch producer. */
async function keepProducer(db: Db, me: Member, target: Member): Promise<void> {
  if (target.role !== "launch_producer") return;
  const left = await one<{ n: number }>(
    db,
    "SELECT count(*)::int AS n FROM members WHERE workspace_id = $1 AND role = 'launch_producer' AND removed_at IS NULL AND id <> $2",
    [me.workspaceId, target.id],
  );
  if (!left?.n) throw new ApiError(409, "last_producer", COPY.lastProducer);
}

route("GET", "/api/members", "none", async (ctx) => {
  const me = await staff(ctx);
  if (me.role === "stockist_buyer") return reply(200, { items: [memberJson(me)] });
  const all = await rows<{ id: string }>(pool, "SELECT id FROM members WHERE workspace_id = $1 AND removed_at IS NULL ORDER BY created_at, name", [me.workspaceId]);
  const members = await Promise.all(all.map((m) => memberById(pool, m.id)));
  return reply(200, { items: members.flatMap((m) => (m ? [memberJson(m)] : [])) });
});

route("GET", "/api/members/{memberId}", "none", async (ctx) => {
  const me = await staff(ctx);
  return reply(200, memberJson(await visibleMember(pool, me, ctx.params.memberId)));
});

route("POST", "/api/members/invitations", "json", async (ctx) => {
  const me = await staff(ctx);
  requireRole(me, "launch_producer");
  const body = ctx.json();
  const fields: Fields = {};
  const email = checkEmail(body.email, "email", fields);
  const role = checkRole(body.role, fields);
  const stockistId = await checkStockist(pool, me, role, body.stockistId, fields);
  if (failed(fields)) throw validationFailed(fields);
  const existing = await one(pool, "SELECT 1 FROM members WHERE lower(email) = lower($1) AND removed_at IS NULL", [email]);
  if (!existing) {
    await tx(async (db) => {
      const token = randomToken();
      const issued = nowSeconds();
      await db.query(
        "INSERT INTO account_links (token_hash, kind, workspace_id, email, role, stockist_id, issued_at, expires_at) VALUES ($1, 'invite', $2, $3, $4, $5, $6, $7)",
        [sha256(token), me.workspaceId, email, role, stockistId, issued, new Date(issued.getTime() + config.ttl.invite * 1000)],
      );
      await queueMail(db, {
        toName: null,
        toEmail: email,
        subject: `You're invited to ${me.workspaceName} on Hourline`,
        body: `Hello,\n\n${me.name} invited you to join ${me.workspaceName} on Hourline.\n\nSet your password and join here:\n${config.publicUrl}/invite/${token}\n\nThe link works once and expires in ${Math.round(config.ttl.invite / 86_400)} days.\n`,
      });
    });
  }
  return reply(202, { status: "invitation_sent" });
});

route("PATCH", "/api/members/{memberId}", "json", async (ctx) => {
  const me = await staff(ctx);
  const target = await visibleMember(pool, me, ctx.params.memberId);
  requireRole(me, "launch_producer");
  const body = ctx.json();
  return tx(async (db) => {
    const fields: Fields = {};
    const role = checkRole(body.role, fields);
    const stockistId = await checkStockist(db, me, role, role === "stockist_buyer" ? (body.stockistId ?? target.stockistId) : body.stockistId, fields);
    if (role !== "launch_producer") await keepProducer(db, me, target);
    if (failed(fields)) throw validationFailed(fields);
    await db.query("UPDATE members SET role = $2, stockist_id = $3 WHERE id = $1", [target.id, role, stockistId]);
    return reply(200, memberJson({ ...target, role, stockistId }));
  });
});

route("DELETE", "/api/members/{memberId}", "none", async (ctx) => {
  const me = await staff(ctx);
  const target = await visibleMember(pool, me, ctx.params.memberId);
  requireRole(me, "launch_producer");
  return tx(async (db) => {
    await keepProducer(db, me, target);
    await db.query("UPDATE members SET removed_at = $2 WHERE id = $1", [target.id, new Date()]);
    return reply(204);
  });
});
