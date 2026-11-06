import { randomBytes } from "node:crypto";
import { config } from "./config.js";
import { pool } from "./db.js";
import { notFound } from "./errors.js";
import { Fields } from "./fields.js";
import { json, type Route } from "./http.js";
import { newsletterConfirmMail, sendInBackground } from "./mail.js";

const OCCUPATIONS = ["architect", "trade", "wholesaler", "other"] as const;
/** Tokens are 24 random bytes in base64url; anything else names no subscription. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,64}$/;

export const newsletterRoutes: Route[] = [
  {
    method: "POST",
    path: "/api/newsletter",
    access: "public",
    async handler({ body }) {
      const fields = new Fields(body);
      const email = fields.email("email");
      const occupation = fields.choice("occupation", OCCUPATIONS);
      if (body.consent !== true) fields.fail("consent", "required");
      fields.done();
      // Signing up again sends a new link and keeps the earlier records.
      const token = randomBytes(24).toString("base64url");
      await pool.query(
        "INSERT INTO newsletter_subscriptions (email, occupation, consent_at, token) VALUES ($1, $2, now(), $3)",
        [email, occupation, token],
      );
      sendInBackground(
        newsletterConfirmMail({ to: email, occupation, link: `${config.publicUrl}/newsletter/confirm?token=${token}` }),
      );
      return json(202, { status: "pending_confirmation" });
    },
  },
  {
    method: "GET",
    path: "/api/newsletter/confirm",
    access: "public",
    async handler({ url }) {
      const token = url.searchParams.get("token") ?? "";
      if (!TOKEN_SHAPE.test(token)) throw notFound("unknown_token");
      const confirmed = await pool.query<{ email: string; occupation: string }>(
        `UPDATE newsletter_subscriptions SET confirmed_at = coalesce(confirmed_at, now())
         WHERE token = $1 RETURNING email, occupation`,
        [token],
      );
      const row = confirmed.rows[0];
      if (!row) throw notFound("unknown_token");
      return json(200, { status: "confirmed", email: row.email, occupation: row.occupation });
    },
  },
];
