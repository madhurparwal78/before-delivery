import type { Account, Role } from "../../shared/api.ts";
import { pool } from "../db.ts";
import { ApiError, invalid } from "../errors.ts";
import { json, publicRoute, route } from "../http.ts";
import { createUser, PocketBaseUnreachable, signInUser } from "../pocketbase.ts";
import { OPERATOR } from "../seed.ts";
import { endedSessionCookie, endSession, startSession } from "../session.ts";
import { objectBody, trimmedText } from "../validate.ts";

// Manager accounts (brief: DP-01, DP-02). PocketBase holds the accounts; the server keeps the sessions.

const EMAIL = /^[^\s@"'\\]+@[^\s@"'\\]+\.[^\s@"'\\]+$/;

const accountsUnavailable = () => new ApiError(503, "accounts_unavailable", "Sign-in is unavailable right now. Try again in a minute.");

async function viaPocketBase<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PocketBaseUnreachable) throw accountsUnavailable();
    throw error;
  }
}

export const accountRoutes = [
  publicRoute("POST", "/api/auth/signup", async ({ body }) => {
    const input = objectBody(body);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    const fields: Record<string, string> = {};
    if (!EMAIL.test(email)) fields.email = "Enter an email address such as name@example.com.";
    const length = [...password].length;
    if (length < 10 || length > 72) fields.password = "Password must be 10 to 72 characters.";
    let teamName = "";
    try {
      teamName = trimmedText(input.team_name, "team_name", 3, 30, "Team name");
    } catch {
      fields.team_name = "Team name must be 3 to 30 characters.";
    }
    if (Object.keys(fields).length > 0) throw invalid(fields);
    const created = await viaPocketBase(() => createUser(email, password, teamName));
    if ("taken" in created) throw new ApiError(409, "email_taken", "An account with this email already exists.");
    await pool.query(
      "INSERT INTO managers (id, email, team_name, role) VALUES ($1, $2, $3, 'manager') ON CONFLICT (id) DO NOTHING",
      [created.id, email, teamName],
    );
    const account: Account = { id: created.id, email, team_name: teamName, role: "manager" };
    return json(201, account, { "Set-Cookie": await startSession(created.id) });
  }),

  publicRoute("POST", "/api/auth/signin", async ({ body }) => {
    const input = objectBody(body);
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!email || !password) throw invalid({ ...(email ? {} : { email: "Enter your email." }), ...(password ? {} : { password: "Enter your password." }) });
    const user = await viaPocketBase(() => signInUser(email, password));
    if (!user) throw new ApiError(401, "bad_credentials", "Email or password is wrong.");
    // Signing in on a database that has no manager record for the account creates it.
    const role: Role = email === OPERATOR.email ? "operator" : "manager";
    await pool.query(
      "INSERT INTO managers (id, email, team_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING",
      [user.id, email, user.name || email, role],
    );
    const stored = await pool.query<{ team_name: string; role: Role }>("SELECT team_name, role FROM managers WHERE id = $1", [user.id]);
    const row = stored.rows[0]!;
    const account: Account = { id: user.id, email, team_name: row.team_name, role: row.role };
    return json(200, account, { "Set-Cookie": await startSession(user.id) });
  }),

  route("POST", "/api/auth/signout", "signed-in", async ({ session }) => {
    await endSession(session);
    return json(204, undefined, { "Set-Cookie": endedSessionCookie() });
  }),

  route("GET", "/api/me", "signed-in", async ({ session }) => {
    const account: Account = { id: session.managerId, email: session.email, team_name: session.teamName, role: session.role };
    return json(200, account);
  }),
];
