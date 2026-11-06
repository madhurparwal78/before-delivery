import { randomUUID } from "node:crypto";
import { emailTaken, hashPassword, newToken, signIn, tokenHash, toUser, validEmail, type Session } from "./auth";
import { config } from "./config";
import { rows, tx, type Row } from "./db";
import { errors, HttpError, record } from "./http";
import { enqueue, messages } from "./mail";
import { projectAccess } from "./projects";
import { studioInstant } from "./time";
import { COPY } from "../shared/copy";
import { PLAN_NAMES, type PlanId, type User } from "../shared/domain";

export async function createInvite(projectId: string, user: User, body: unknown) {
  const { project, access } = await projectAccess(projectId, user);
  if (access !== "owner") throw errors.forbidden();
  const email = record(body).email;
  if (!validEmail(email)) throw errors.invalid({ email: "Enter a valid email address." });
  const address = email.trim();
  if (await emailTaken(address)) throw errors.invalid({ email: COPY.existingSignIn });
  const token = newToken();
  const id = randomUUID();
  const expires = new Date(Date.now() + config.inviteTtlSeconds * 1000);
  await tx(async (db) => {
    await db.query("INSERT INTO invites (id, token_hash, account_id, project_id, email, expires_at) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      tokenHash(token),
      project.account_id,
      projectId,
      address,
      expires,
    ]);
    await enqueue(
      db,
      messages.invite({ inviteId: id, to: address, businessName: project.business_name, projectName: `${project.number} ${PLAN_NAMES[project.plan]}`, token }),
    );
  });
  return { invite: { id, email: address, expiresAt: studioInstant(expires) } };
}

interface InviteRow extends Row {
  id: string;
  account_id: string;
  project_id: string;
  email: string;
  expires_at: Date;
  used_at: Date | null;
  business_name: string;
  number: string;
  plan: PlanId;
}

const INVITE_SELECT = `SELECT i.*, a.business_name, o.number, o.plan FROM invites i
  JOIN client_accounts a ON a.id = i.account_id JOIN projects p ON p.id = i.project_id JOIN orders o ON o.id = p.order_id
  WHERE i.token_hash = $1`;

function usable(invite: InviteRow | undefined): InviteRow {
  if (!invite) throw errors.notFound();
  if (invite.used_at) throw new HttpError(409, "invite_used", "This invite has already been used.");
  if (invite.expires_at.getTime() <= Date.now()) throw new HttpError(410, "invite_expired", "This invite has expired. Ask for a new one.");
  return invite;
}

export async function inviteInfo(token: string) {
  const [invite] = await tx((db) => rows<InviteRow>(db, INVITE_SELECT, [tokenHash(token)]));
  const found = usable(invite);
  return { businessName: found.business_name, projectName: `${found.number} ${PLAN_NAMES[found.plan]}`, email: found.email };
}

export async function acceptInvite(token: string, body: unknown, session: Session | null): Promise<{ user: User; projectId: string; token: string }> {
  const input = record(body);
  return tx(async (db) => {
    const [invite] = await rows<InviteRow>(db, `${INVITE_SELECT} FOR UPDATE OF i`, [tokenHash(token)]);
    const found = usable(invite);
    const fields: Record<string, string> = {};
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > 80) fields.name = "Enter your name (up to 80 characters).";
    if (typeof input.password !== "string" || input.password.length < 10) fields.password = "Use at least 10 characters.";
    if (Object.keys(fields).length) throw errors.invalid(fields);
    if (await emailTaken(found.email, db)) throw errors.invalid({ email: COPY.existingSignIn });
    const [created] = await rows<Row & { id: string; name: string; email: string; role: "teammate"; account_id: string }>(
      db,
      "INSERT INTO users (id, account_id, role, name, email, password_hash) VALUES ($1, $2, 'teammate', $3, $4, $5) RETURNING *",
      [randomUUID(), found.account_id, name, found.email, await hashPassword(input.password as string)],
    );
    await db.query("UPDATE invites SET used_at = now() WHERE id = $1", [found.id]);
    const user = toUser(created!);
    return { user, projectId: found.project_id, token: await signIn(db, user.id, session) };
  });
}
