// Casting packages: private links (issue, expire, revoke, replace), the casting director's choices and the photo ZIP.

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { exec, lockKey, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, publicRoute, json, type Ctx, type MemberCtx } from "../http.js";
import { ApiError, EMAIL_COPY, FieldErrors, conflict, gone, isoInstant, notFound, required } from "../errors.js";
import { randomToken } from "../auth.js";
import { config } from "../config.js";
import { appLink, enqueue } from "../mail.js";
import { getObject, putObject } from "../storage.js";
import { zip } from "../zip.js";
import { asObject, newId, str } from "../util.js";
import { formatOfficeTime } from "../../shared/format.js";
import { isEmail, singleLine, slugBase } from "../../shared/text.js";
import { profileBody } from "./public.js";
import { portfolioOf, type TalentRow } from "./talent.js";

interface PackageRow {
  id: string;
  title: string;
  recipient_name: string;
  recipient_email: string;
  state: "active" | "revoked";
  created_at: Date;
}

interface LinkRow {
  token: string;
  package_id: string;
  issued_at: Date;
  expires_at: Date;
  state: "active" | "revoked" | "replaced";
}

const DECISIONS = ["shortlisted", "passed", "undecided"];

async function currentLink(db: Db, packageId: string): Promise<LinkRow | null> {
  return one<LinkRow>(db, "SELECT * FROM package_links WHERE package_id = $1 ORDER BY issued_at DESC LIMIT 1", [packageId]);
}

async function packageBody(db: Db, row: PackageRow) {
  const link = await currentLink(db, row.id);
  const talent = await rows<{ talent_id: string; display_name: string; decision: string }>(
    db,
    `SELECT pt.talent_id, t.display_name, pt.decision FROM package_talent pt JOIN talent t ON t.id = pt.talent_id
      WHERE pt.package_id = $1 ORDER BY pt.position`,
    [row.id],
  );
  return {
    id: row.id,
    title: row.title,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    state: row.state,
    url: link ? appLink(`/p/${link.token}`) : null,
    issuedAt: link ? isoInstant(link.issued_at) : null,
    expiresAt: link ? isoInstant(link.expires_at) : null,
    talent: talent.map((t) => ({ talentId: t.talent_id, displayName: t.display_name, decision: t.decision })),
  };
}

/** Issues a fresh link and emails it to the recipient. */
async function issueLink(client: PoolClient, row: PackageRow, ctx: MemberCtx): Promise<void> {
  const token = randomToken(32);
  const expires = new Date((Math.floor(ctx.now / 1000) + config.packageLinkTtlSeconds) * 1000);
  await exec(client, "INSERT INTO package_links (token, package_id, issued_at, expires_at, state) VALUES ($1, $2, $3, $4, 'active')",
    [token, row.id, new Date(Math.floor(ctx.now / 1000) * 1000), expires]);
  const talentIds = (await rows<{ talent_id: string }>(client,
    "SELECT talent_id FROM package_talent WHERE package_id = $1", [row.id])).map((t) => t.talent_id);
  await enqueue(client, {
    to: row.recipient_email,
    subject: `Casting package: ${row.title}`,
    text: [
      `Hello ${row.recipient_name},`,
      "",
      `${ctx.member.name} at Vesper & Rowe Talent shared a casting package with you: ${row.title}.`,
      "Open it on your phone or computer to shortlist or pass on each talent:",
      appLink(`/p/${token}`),
      "",
      `The link works until ${formatOfficeTime(expires.getTime(), ctx.member.office)}.`,
      "",
      "Vesper & Rowe Talent",
    ].join("\n"),
    talentIds,
  });
}

async function staffPackage(ctx: MemberCtx): Promise<PackageRow> {
  const row = ctx.isTalent() ? null : await one<PackageRow>(pool, "SELECT * FROM packages WHERE id = $1", [ctx.params.id]);
  if (!row) throw notFound();
  ctx.allow("booker", "agency_director");
  return row;
}

memberRoute("GET", "/api/packages", async (ctx) => {
  ctx.allow("booker", "agency_director");
  const found = await rows<PackageRow>(pool, "SELECT * FROM packages ORDER BY created_at DESC, id");
  return json(200, { packages: await Promise.all(found.map((row) => packageBody(pool, row))) });
});

memberRoute("GET", "/api/packages/:id", async (ctx) => json(200, { package: await packageBody(pool, await staffPackage(ctx)) }));

memberRoute("POST", "/api/packages", async (ctx) => {
  ctx.allow("booker", "agency_director");
  const body = asObject(await ctx.json());
  const title = singleLine(str(body, "title")).trim();
  const recipientName = singleLine(str(body, "recipientName")).trim();
  const recipientEmail = singleLine(str(body, "recipientEmail")).trim();
  const talentIds = Array.isArray(body.talentIds) ? body.talentIds.filter((id): id is string => typeof id === "string") : [];
  const errors: FieldErrors = new FieldErrors();
  if (!title) errors.add("title", required("Title"));
  if (!recipientName) errors.add("recipientName", required("Recipient name"));
  if (!recipientEmail) errors.add("recipientEmail", required("Recipient email"));
  else if (!isEmail(recipientEmail)) errors.add("recipientEmail", EMAIL_COPY);
  const unique = [...new Set(talentIds)];
  const active = await rows<{ id: string }>(pool, "SELECT id FROM talent WHERE id = ANY($1) AND state = 'active'", [unique]);
  if (!unique.length) errors.add("talentIds", "Choose at least one talent.");
  else if (active.length !== unique.length || unique.length !== talentIds.length) {
    errors.add("talentIds", "Choose only active talent, each once.");
  }
  errors.throwIfAny();
  return tx(async (client) => {
    const row: PackageRow = { id: newId(), title, recipient_name: recipientName, recipient_email: recipientEmail,
      state: "active", created_at: new Date(ctx.now) };
    await exec(client, `INSERT INTO packages (id, title, recipient_name, recipient_email, state, created_by, created_at)
      VALUES ($1, $2, $3, $4, 'active', $5, $6)`, [row.id, title, recipientName, recipientEmail, ctx.member.name, row.created_at]);
    for (const [position, talentId] of unique.entries()) {
      await exec(client, "INSERT INTO package_talent (package_id, talent_id, position) VALUES ($1, $2, $3)",
        [row.id, talentId, position + 1]);
    }
    await issueLink(client, row, ctx);
    return json(201, { package: await packageBody(client, row) });
  });
});

memberRoute("POST", "/api/packages/:id/revoke", async (ctx) => {
  const found = await staffPackage(ctx);
  await ctx.json();
  return tx(async (client) => {
    await lockKey(client, `package:${found.id}`);
    const row = await one<PackageRow>(client, "SELECT * FROM packages WHERE id = $1", [found.id]) ?? found;
    if (row.state === "revoked") throw conflict("already_revoked");
    await exec(client, "UPDATE packages SET state = 'revoked' WHERE id = $1", [row.id]);
    await exec(client, "UPDATE package_links SET state = 'revoked' WHERE package_id = $1 AND state = 'active'", [row.id]);
    return json(200, { package: await packageBody(client, { ...row, state: "revoked" }) });
  });
});

memberRoute("POST", "/api/packages/:id/regenerate", async (ctx) => {
  const found = await staffPackage(ctx);
  await ctx.json();
  return tx(async (client) => {
    await lockKey(client, `package:${found.id}`);
    const row = await one<PackageRow>(client, "SELECT * FROM packages WHERE id = $1", [found.id]) ?? found;
    await exec(client, "UPDATE package_links SET state = 'replaced' WHERE package_id = $1 AND state = 'active'", [row.id]);
    await exec(client, "UPDATE packages SET state = 'active' WHERE id = $1", [row.id]);
    await issueLink(client, row, ctx);
    return json(200, { package: await packageBody(client, { ...row, state: "active" }) });
  });
});

/** Step 4 for link paths: unknown → 404; revoked, replaced or expired → 410. */
async function liveLink(ctx: Ctx): Promise<{ link: LinkRow; row: PackageRow }> {
  const found = await one<LinkRow & { title: string; recipient_name: string; recipient_email: string;
    package_state: PackageRow["state"]; created_at: Date }>(
    pool,
    `SELECT l.*, p.title, p.recipient_name, p.recipient_email, p.state AS package_state, p.created_at
       FROM package_links l JOIN packages p ON p.id = l.package_id WHERE l.token = $1`,
    [ctx.params.token],
  );
  if (!found) throw notFound();
  if (found.state === "revoked") throw gone("link_revoked");
  if (found.state === "replaced") throw gone("link_replaced");
  if (found.expires_at.getTime() <= ctx.now) throw gone("link_expired");
  return {
    link: found,
    row: { id: found.package_id, title: found.title, recipient_name: found.recipient_name,
      recipient_email: found.recipient_email, state: found.package_state, created_at: found.created_at },
  };
}

async function activeMembers(db: Db, packageId: string): Promise<Array<TalentRow & { decision: string }>> {
  return rows<TalentRow & { decision: string }>(
    db,
    `SELECT t.*, pt.decision FROM package_talent pt JOIN talent t ON t.id = pt.talent_id
      WHERE pt.package_id = $1 AND t.state = 'active' ORDER BY pt.position`,
    [packageId],
  );
}

publicRoute("GET", "/api/p/:token", async (ctx) => {
  const { link, row } = await liveLink(ctx);
  const members = await activeMembers(pool, row.id);
  return json(200, {
    title: row.title,
    expiresAt: isoInstant(link.expires_at),
    shortlistedCount: members.filter((t) => t.decision === "shortlisted").length,
    talent: await Promise.all(members.map(async (t) => ({ ...(await profileBody(pool, t)), decision: t.decision }))),
  });
});

publicRoute("PUT", "/api/p/:token/decisions/:slug", async (ctx) => {
  const { row } = await liveLink(ctx);
  const member = (await activeMembers(pool, row.id)).find((t) => t.slug === ctx.params.slug);
  if (!member) throw notFound();
  const decision = str(asObject(await ctx.json()), "decision");
  if (!DECISIONS.includes(decision)) {
    throw new ApiError(422, "validation", { errors: { decision: "Choose shortlisted, passed or undecided." } });
  }
  await exec(pool, "UPDATE package_talent SET decision = $3 WHERE package_id = $1 AND talent_id = $2", [row.id, member.id, decision]);
  const shortlistedCount = (await activeMembers(pool, row.id)).filter((t) => t.decision === "shortlisted").length;
  return json(200, { slug: member.slug, decision, shortlistedCount });
});

publicRoute("GET", "/api/p/:token/photos.zip", async (ctx) => {
  const { row } = await liveLink(ctx);
  const files: Array<{ name: string; data: Buffer }> = [];
  for (const talent of await activeMembers(pool, row.id)) {
    for (const [index, photo] of (await portfolioOf(pool, talent.id)).entries()) {
      const data = await getObject(`portfolio/${talent.id}/${photo.id}.jpg`);
      if (data) files.push({ name: `${talent.slug}/${String(index + 1).padStart(2, "0")}.jpg`, data });
    }
  }
  const manifest = {
    package: row.title,
    generatedAt: isoInstant(ctx.now),
    files: files.map((file) => ({ name: file.name, bytes: file.data.length,
      sha256: createHash("sha256").update(file.data).digest("hex") })),
  };
  const archive = zip([...files, { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) }]);
  await putObject(`packages/${row.id}/photos.zip`, archive, "application/zip");
  return {
    status: 200,
    raw: archive,
    contentType: "application/zip",
    headers: { "Content-Disposition": `attachment; filename="${slugBase(row.title) || "package"}-photos.zip"` },
  };
});
