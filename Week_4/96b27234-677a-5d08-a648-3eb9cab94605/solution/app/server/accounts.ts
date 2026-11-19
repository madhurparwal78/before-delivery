import { RANKS } from "../shared/protocol.js";
import { one, query, tx } from "./db.js";
import { invalid, notFound, originOf, Refusal, reply, Router, text, textLength } from "./http.js";
import { enqueueMail, absoluteUrl } from "./mail.js";
import { checkPassword, closeLogin, hashPassword, newId, newToken, openLogin, type Person } from "./people.js";
import { repaintSessionsOf } from "./notify.js";
import { isZone } from "./zones.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
export const lowerEmail = (email: string): string => email.trim().toLowerCase();

export const COOKIE = "ht_session";
const WRONG_LOGIN = "Email or password is wrong.";

export function accountRoutes(router: Router<Person>): void {
  router.add(
    "POST",
    "/api/signup",
    async (ctx) => {
      const body = ctx.json();
      const email = body.email;
      const password = text(body.password);
      const name = text(body.displayName)?.trim() ?? "";
      if (!validEmail(email)) throw invalid("Enter a valid email address.");
      if (password === null || password.length < 10) throw invalid("Passwords need at least 10 characters.");
      if (textLength(name) < 1 || textLength(name) > 40) throw invalid("Give a display name of 1 to 40 characters.");
      if (!isZone(body.timeZone)) throw invalid("Choose a time zone from the list.");
      const known = await one<{ id: string }>("SELECT id FROM people WHERE email = $1", [lowerEmail(email)]);
      if (!known) {
        const id = newId();
        const token = newToken();
        const hash = await hashPassword(password);
        await tx(async (client) => {
          await query(
            "INSERT INTO people (id, world_id, email, password_hash, display_name, time_zone) VALUES ($1, 'default', $2, $3, $4, $5) ON CONFLICT DO NOTHING",
            [id, lowerEmail(email), hash, name, body.timeZone],
            client,
          );
          const created = await one<{ id: string }>("SELECT id FROM people WHERE id = $1", [id], client);
          if (created) {
            await query("INSERT INTO confirmations (token, person_id) VALUES ($1, $2)", [token, id], client);
            await enqueueMail(
              lowerEmail(email),
              "Confirm your Hearthtile account",
              `Welcome to Hearthtile. Confirm your account: ${absoluteUrl(originOf(ctx), `/confirm/${token}`)}`,
              client,
            );
          }
        });
      }
      return reply(202, { status: "check-your-email" });
    },
    { anonymous: true },
  );

  router.add(
    "POST",
    "/api/confirm/:token",
    async (ctx) => {
      const claimed = await one<{ person_id: string }>("DELETE FROM confirmations WHERE token = $1 RETURNING person_id", [ctx.params.token]);
      if (!claimed) throw notFound();
      await query("UPDATE people SET confirmed = true WHERE id = $1", [claimed.person_id]);
      return reply(200, { status: "confirmed" });
    },
    { anonymous: true },
  );

  router.add(
    "POST",
    "/api/signin",
    async (ctx) => {
      const body = ctx.json();
      const email = text(body.email);
      const password = text(body.password);
      const row = email
        ? await one<{ id: string; password_hash: string; display_name: string; site_role: string; time_zone: string; confirmed: boolean; suspended: boolean }>(
            "SELECT id, password_hash, display_name, site_role, time_zone, confirmed, suspended FROM people WHERE email = $1",
            [lowerEmail(email)],
          )
        : null;
      const matches = row && password !== null ? await checkPassword(password, row.password_hash) : false;
      if (!row || !matches || !row.confirmed || row.suspended) throw new Refusal(401, WRONG_LOGIN);
      const token = await openLogin(row.id);
      return reply(
        200,
        { personId: row.id, displayName: row.display_name, siteRole: row.site_role, timeZone: row.time_zone },
        { "set-cookie": `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000` },
      );
    },
    { anonymous: true },
  );

  router.add(
    "POST",
    "/api/signout",
    async (ctx) => {
      const token = ctx.cookie(COOKIE);
      if (token) await closeLogin(token);
      return reply(200, { status: "signed-out" }, { "set-cookie": `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0` });
    },
    { anonymous: true },
  );

  router.add("GET", "/api/me", (_ctx, person) =>
    reply(200, {
      personId: person.id,
      displayName: person.displayName,
      email: person.email,
      siteRole: person.siteRole,
      timeZone: person.timeZone,
      avatarId: person.avatarId,
      hideAbove: person.hideAbove,
      worldId: person.worldId,
    }),
  );

  router.add("PUT", "/api/me/avatar", async (ctx, person) => {
    const body = ctx.json();
    const wanted = text(body.avatarId);
    const avatar = wanted
      ? await one<{ id: string }>(
          "SELECT id FROM assets WHERE id = $1 AND world_id = $2 AND kind = 'avatar' AND NOT removed AND current_version IS NOT NULL",
          [wanted, person.worldId],
        )
      : null;
    if (!avatar) throw notFound();
    await query("UPDATE people SET avatar_id = $2 WHERE id = $1", [person.id, avatar.id]);
    await repaintSessionsOf([person.id]);
    return reply(200, { avatarId: avatar.id });
  });

  router.add("PUT", "/api/me/hide-above", async (ctx, person) => {
    const rank = ctx.json().rank;
    if (rank !== null && !(RANKS as readonly unknown[]).includes(rank)) throw invalid("Choose Feather, Linen, Cedar or Granite.");
    await query("UPDATE people SET hide_above = $2 WHERE id = $1", [person.id, rank]);
    await repaintSessionsOf([person.id]);
    return reply(200, { hideAbove: rank });
  });
}
