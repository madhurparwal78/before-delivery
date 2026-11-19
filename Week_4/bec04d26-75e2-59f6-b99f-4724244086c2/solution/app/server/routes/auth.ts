import type { Hono } from "hono";
import { pool, query, transaction } from "../db";
import { invalid } from "../http/errors";
import { type Env, authorize, endSessionCookie, reply, sessionToken, startSessionCookie } from "../http/context";
import { DEFAULT_REMINDER_HOUR } from "../domain/reminders";
import { PRACTICE_ZONE } from "../domain/zone";
import { toIso } from "../domain/labels";
import { rescheduleReminders } from "../store/returns";
import { createPractice, createSession, createUser, emailTaken, endSession, getPractice, nowOf, verifyCredentials } from "../store/practice";
import { insertCatalogue } from "../store/states";
import { dispatchMail } from "../services/outbox";
import { publish } from "../services/hub";
import { Check, MESSAGES, asObject, duplicate } from "../validation";
import type { Account } from "../store/practice";
import type { User } from "../../shared/types";

const userView = (a: Account): User =>
  ({ id: a.id, display_name: a.displayName, email: a.email, role: a.role, client_id: a.clientId });

export function registerAuth(app: Hono<Env>): void {
  app.post("/api/auth/signup", async (c) => {
    const body = asObject(c.get("body"));
    const check = new Check();
    const displayName = check.displayName("display_name", body.display_name, MESSAGES.yourName);
    const email = check.email("email", body.email);
    const password = check.password("password", body.password);
    if (!("email" in check.errors) && (await emailTaken(pool, email))) check.fail("email", MESSAGES.emailTaken);
    check.done();
    const { account, token } = await transaction(async (db) => {
      const practiceId = await createPractice(db, DEFAULT_REMINDER_HOUR, null);
      await insertCatalogue(db, practiceId);
      const id = await createUser(db, { practiceId, clientId: null, displayName, email, password, role: "bookkeeper" });
      return {
        account: { id, practiceId, clientId: null, displayName, email, role: "bookkeeper" } satisfies Account,
        token: await createSession(db, id),
      };
    }).catch(duplicate("email", MESSAGES.emailTaken));
    return reply({ practice_id: account.practiceId, user: userView(account) }, 201, {
      "set-cookie": startSessionCookie(token),
    });
  });

  app.post("/api/auth/signin", async (c) => {
    const body = asObject(c.get("body"));
    const account = typeof body.email === "string" && typeof body.password === "string"
      ? await verifyCredentials(pool, body.email.trim(), body.password) : null;
    if (!account) throw invalid({ email: MESSAGES.signIn });
    return reply({ user: userView(account) }, 200, { "set-cookie": startSessionCookie(await createSession(pool, account.id)) });
  });

  app.post("/api/auth/signout", async (c) => {
    await authorize(c, { roles: "either" });
    await endSession(pool, sessionToken(c)!);
    return new Response(null, { status: 204, headers: { "set-cookie": endSessionCookie() } });
  });

  app.get("/api/me", async (c) => {
    const account = await authorize(c, { roles: "either" });
    const practice = await getPractice(pool, account.practiceId);
    const [client] = account.clientId ? await query<{ name: string }>(pool, "SELECT name FROM clients WHERE id = $1", [account.clientId]) : [];
    return reply({
      user: userView(account), client_name: client?.name ?? null, practice_id: practice.id, now: toIso(nowOf(practice)), practice_zone: PRACTICE_ZONE,
      reminder_hour: practice.reminderHour,
    });
  });

  app.patch("/api/practice", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    const check = new Check();
    const hour = check.integer("reminder_hour", asObject(c.get("body")).reminder_hour, 6, 21, MESSAGES.reminderHour);
    check.done();
    await transaction(async (db) => {
      await db.query("UPDATE practices SET reminder_hour = $2 WHERE id = $1", [account.practiceId, hour]);
      await rescheduleReminders(db, account.practiceId, hour);
    });
    await dispatchMail(account.practiceId);
    publish(account.practiceId, { type: "practice", reminder_hour: hour }, { bookkeeperOnly: true });
    return reply({ reminder_hour: hour });
  });
}
