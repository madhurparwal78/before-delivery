// Accounts, sessions and invite acceptance (brief: API > Endpoints; Business rules > Invites).
import { accountView, endSession, hashPassword, requireAccount, startSession, tokenHash, verifyPassword, ACCOUNT_COLUMNS, type Account } from "../access.js";
import { one, pool, returning, transaction } from "../db.js";
import { invalid, refuse } from "../errors.js";
import { noContent, route, send } from "../http.js";
import { Fields, isEmail, isHandle, isName, MESSAGES, normalEmail, text } from "../validate.js";

async function emailTaken(email: string): Promise<boolean> {
  return (await one(pool, "SELECT 1 FROM accounts WHERE email = $1", [email])) !== null;
}

async function handleTaken(handle: string): Promise<boolean> {
  return (await one(pool, "SELECT 1 FROM accounts WHERE handle = $1", [handle])) !== null;
}

const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "23505";

route("POST", "/api/auth/signin", async (ctx) => {
  const email = normalEmail(text(ctx.json, "email"));
  const password = text(ctx.json, "password") ?? "";
  const fields = new Fields().check(isEmail(email), "email", MESSAGES.email).check(password.length > 0, "password", MESSAGES.passwordEmpty);
  if (fields.failed) throw invalid(fields.errors);
  const row = await one<Account & { password_hash: string }>(pool, `SELECT ${ACCOUNT_COLUMNS}, a.password_hash FROM accounts a WHERE a.email = $1`, [email]);
  if (!(await verifyPassword(password, row?.password_hash ?? null)) || !row) throw refuse("invalid_credentials");
  await startSession(ctx.res, row.id);
  send(ctx.res, 200, await accountView(row));
});

route("POST", "/api/auth/signout", async (ctx) => {
  await requireAccount(ctx);
  await endSession(ctx.req, ctx.res);
  noContent(ctx.res);
});

route("POST", "/api/auth/signup", async (ctx) => {
  const email = normalEmail(text(ctx.json, "email"));
  const displayName = text(ctx.json, "displayName");
  const handle = text(ctx.json, "handle");
  const password = text(ctx.json, "password") ?? "";
  const fields = new Fields()
    .check(isEmail(email), "email", MESSAGES.email)
    .check(isName(displayName), "displayName", MESSAGES.name)
    .check(isHandle(handle), "handle", MESSAGES.handle)
    .check(password.length >= 10, "password", MESSAGES.passwordShort);
  if (!fields.errors.email && (await emailTaken(email))) fields.check(false, "email", MESSAGES.emailTaken);
  if (isHandle(handle) && (await handleTaken(handle))) fields.check(false, "handle", MESSAGES.handleTaken);
  if (fields.failed || !isName(displayName) || !isHandle(handle)) throw invalid(fields.errors);
  let account: Account;
  try {
    account = await returning<Account>(
      pool,
      `INSERT INTO accounts AS a (email, display_name, handle, password_hash, role) VALUES ($1, $2, $3, $4, 'follower') RETURNING ${ACCOUNT_COLUMNS}`,
      [email, displayName.trim(), handle, await hashPassword(password)],
    );
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    throw invalid((await emailTaken(email)) ? { email: MESSAGES.emailTaken } : { handle: MESSAGES.handleTaken });
  }
  await startSession(ctx.res, account.id);
  send(ctx.res, 201, await accountView(account));
});

route("GET", "/api/me", async (ctx) => {
  send(ctx.res, 200, await accountView(await requireAccount(ctx)));
});

interface InviteRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  email: string;
  display_name: string;
  used_at: Date | null;
}

async function inviteFor(token: string): Promise<InviteRow> {
  const invite = await one<InviteRow>(
    pool,
    `SELECT i.id, i.workspace_id, w.name AS workspace_name, i.email, i.display_name, i.used_at
       FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token_hash = $1`,
    [tokenHash(token)],
  );
  if (!invite) throw refuse("not_found");
  if (invite.used_at) throw refuse("invite_used");
  return invite;
}

route("GET", "/api/invites/:token", async (ctx) => {
  const invite = await inviteFor(ctx.params.token ?? "");
  send(ctx.res, 200, { workspaceName: invite.workspace_name, email: invite.email, displayName: invite.display_name });
});

route("POST", "/api/invites/:token/accept", async (ctx) => {
  const invite = await inviteFor(ctx.params.token ?? "");
  const handle = text(ctx.json, "handle");
  const password = text(ctx.json, "password") ?? "";
  const fields = new Fields().check(isHandle(handle), "handle", MESSAGES.handle).check(password.length >= 10, "password", MESSAGES.passwordShort);
  if (isHandle(handle) && (await handleTaken(handle))) fields.check(false, "handle", MESSAGES.handleTaken);
  if (fields.failed || !isHandle(handle)) throw invalid(fields.errors);
  const passwordHash = await hashPassword(password);
  const account = await transaction(async (client) => {
    const claimed = await one(client, "UPDATE invites SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id", [invite.id]);
    if (!claimed) throw refuse("invite_used");
    if (await one(client, "SELECT 1 FROM accounts WHERE email = $1", [invite.email])) throw refuse("invite_used");
    await client.query("UPDATE invites SET used_at = now() WHERE email = $1 AND used_at IS NULL", [invite.email]);
    try {
      return await returning<Account>(
        client,
        `INSERT INTO accounts AS a (email, display_name, handle, password_hash, role, workspace_id)
         VALUES ($1, $2, $3, $4, 'designer', $5) RETURNING ${ACCOUNT_COLUMNS}`,
        [invite.email, invite.display_name, handle, passwordHash, invite.workspace_id],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw invalid({ handle: MESSAGES.handleTaken });
      throw error;
    }
  });
  await startSession(ctx.res, account.id);
  send(ctx.res, 201, await accountView(account));
});
