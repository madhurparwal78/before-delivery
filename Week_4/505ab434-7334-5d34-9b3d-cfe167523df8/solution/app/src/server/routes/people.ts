// Invitations, activation, organisations and engagement ends (brief: Invitations and engagements).
import { randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { hashPassword, startSession, toPrincipal } from "../auth.ts";
import { read, transaction } from "../db.ts";
import { ApiError, forbidden, invalidBody, notFound } from "../errors.ts";
import { created, ok, sessionCookie, type Ctx, type Reply, type Router } from "../http.ts";
import { hashToken, invitationInvalid, newInviteToken, openInvitation } from "../invitations.ts";
import { formatDate, formatTime, isCalendarDate, toIso } from "../../shared/dates.ts";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface OrganisationRow {
  id: string;
  name: string;
  kind: string;
  engagement_starts_on: string | null;
  engagement_ends_on: string | null;
  engagement_territories: string[] | null;
}

const engagementOf = (row: OrganisationRow): { startsOn: string; endsOn: string; territories: string[] } | null =>
  row.engagement_ends_on ? { startsOn: row.engagement_starts_on!, endsOn: row.engagement_ends_on, territories: row.engagement_territories! } : null;

async function invite(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  if (principal.role !== "owner") throw forbidden();
  const body = await ctx.json();
  return transaction(async (tx) => {
    const organisation = typeof body.organisationId === "string" ? await tx.one("SELECT 1 FROM organisations WHERE id = $1", [body.organisationId]) : undefined;
    if (!organisation) throw notFound();
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (email !== "" && (await tx.one("SELECT 1 FROM principals WHERE lower(email) = lower($1)", [email]))) {
      throw new ApiError(409, "already_registered", `${email} already has an account.`);
    }
    if (!EMAIL.test(email)) throw new ApiError(422, "email_invalid", "Enter a valid email address.");
    if (typeof body.displayName !== "string" || body.displayName.trim() === "" || (body.role !== "agency" && body.role !== "press")) throw invalidBody();
    const token = newInviteToken();
    const expiresAt = toIso(Date.parse(tx.now) + config.inviteTtlHours * 3_600_000);
    await tx.q(
      "INSERT INTO invitations (token, email, display_name, role, organisation_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [hashToken(token), email, body.displayName.trim(), body.role, body.organisationId, expiresAt],
    );
    await tx.mail(
      email,
      "Your Rulehouse invitation",
      [
        `Hello ${body.displayName.trim()},`,
        "",
        "You are invited to Rulehouse for Quenby & Co. Open this link to set a password and sign in:",
        `${config.publicUrl}/activate/${token}`,
        "",
        `This link works once and expires on ${formatDate(expiresAt, config.timeZone)} at ${formatTime(expiresAt, config.timeZone)}.`,
      ].join("\n"),
    );
    return created({ id: `inv_${hashToken(token).slice(0, 12)}`, email, expiresAt });
  });
}

async function showInvitation(ctx: Ctx): Promise<Reply> {
  const row = await read((tx) => openInvitation(tx, ctx.params.token));
  return ok({ email: row.email, displayName: row.display_name });
}

async function activate(ctx: Ctx): Promise<Reply> {
  const body = await ctx.json();
  const password = typeof body.password === "string" ? body.password : "";
  const hash = password.length >= 12 ? await hashPassword(password) : null;
  const { principal, token } = await transaction(async (tx) => {
    const row = await openInvitation(tx, ctx.params.token, true);
    if (hash === null) throw new ApiError(422, "weak_password", "Password must be at least 12 characters.");
    if (await tx.one("SELECT 1 FROM principals WHERE lower(email) = lower($1)", [row.email])) throw invitationInvalid();
    const id = `usr_${randomBytes(6).toString("hex")}`;
    await tx.q("INSERT INTO principals (id, email, display_name, role, organisation_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6)", [
      id, row.email, row.display_name, row.role, row.organisation_id, hash,
    ]);
    await tx.q("UPDATE invitations SET used_at = $2 WHERE token = $1", [row.token, tx.now]);
    return {
      principal: toPrincipal({ id, display_name: row.display_name, role: row.role, organisation_id: row.organisation_id }),
      token: await startSession(tx, id),
    };
  });
  return { ...ok({ principal }), headers: { "set-cookie": sessionCookie(token) } };
}

async function listOrganisations(ctx: Ctx): Promise<Reply> {
  if (ctx.user().role !== "owner") throw forbidden();
  const rows = await read((tx) =>
    tx.q<OrganisationRow>(
      "SELECT id, name, kind, engagement_starts_on, engagement_ends_on, engagement_territories FROM organisations ORDER BY name"),
  );
  return ok({ organisations: rows.map((row) => ({ id: row.id, name: row.name, kind: row.kind, engagement: engagementOf(row) })) });
}

async function setEngagementEnd(ctx: Ctx): Promise<Reply> {
  const principal = ctx.user();
  const found = await read((tx) => tx.one("SELECT 1 FROM organisations WHERE id = $1 AND engagement_ends_on IS NOT NULL", [ctx.params.id]));
  if (!found) throw notFound();
  if (principal.role !== "owner") throw forbidden();
  const body = await ctx.json();
  if (!isCalendarDate(body.endsOn)) throw invalidBody();
  return transaction(async (tx) => {
    await tx.q("UPDATE organisations SET engagement_ends_on = $2 WHERE id = $1", [ctx.params.id, body.endsOn]);
    const row = (await tx.one<OrganisationRow>(
      "SELECT id, name, kind, engagement_starts_on, engagement_ends_on, engagement_territories FROM organisations WHERE id = $1", [ctx.params.id]))!;
    tx.live({ type: "library.updated" }, { all: true });
    return ok({ id: row.id, engagement: engagementOf(row) });
  });
}

export function registerPeople(router: Router): void {
  router.post("/api/invitations", invite);
  router.get("/api/invitations/:token", showInvitation);
  router.post("/api/invitations/:token/activate", activate);
  router.get("/api/organisations", listOrganisations);
  router.put("/api/organisations/:id/engagement", setEngagementEnd);
}
