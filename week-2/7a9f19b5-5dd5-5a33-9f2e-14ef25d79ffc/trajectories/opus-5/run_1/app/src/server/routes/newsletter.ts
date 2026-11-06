/**
 * Newsletter. A subscription is stored with its email, occupation, consent time
 * and confirmation time, and counts as subscribed only once confirmed. Signing up
 * again with the same email sends a new link and keeps the earlier records.
 */

import { randomBytes } from "node:crypto";
import { query, queryOne } from "../db/pool.js";
import { isValidEmail } from "../../shared/domain.js";
import { NEWSLETTER_OCCUPATION_OPTIONS } from "../../shared/copy.js";
import type { NewsletterOccupation } from "../../shared/types.js";
import { readJson, sendJson, type Ctx } from "../http/context.js";
import { unknownToken } from "../http/errors.js";
import { FieldErrors, oneOf } from "../http/validate.js";
import { sendNewsletterConfirmation } from "../services/mail.js";

const OCCUPATIONS: readonly NewsletterOccupation[] = ["architect", "trade", "wholesaler", "other"];

export async function subscribe(ctx: Ctx): Promise<void> {
  const body = readJson<{ email?: unknown; occupation?: unknown; consent?: unknown }>(ctx);
  const errors = new FieldErrors();

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email === "") errors.set("email", "required");
  else if (!isValidEmail(email)) errors.set("email", "invalid");

  const occupation = oneOf(errors, "occupation", body.occupation, OCCUPATIONS);
  if (body.consent !== true) errors.set("consent", "required");
  errors.throwIfAny();

  const token = randomBytes(24).toString("hex");
  await query("INSERT INTO newsletter_subscriptions (email, occupation, token) VALUES ($1,$2,$3)", [
    email,
    occupation,
    token,
  ]);

  const label = NEWSLETTER_OCCUPATION_OPTIONS.find((option) => option.value === occupation)?.label ?? occupation;
  await sendNewsletterConfirmation({ to: email, occupationLabel: label, token });
  sendJson(ctx.res, 202, { status: "pending_confirmation" });
}

export async function confirm(ctx: Ctx): Promise<void> {
  const token = ctx.query.get("token") ?? "";
  const found = await queryOne<{ id: string; email: string; occupation: NewsletterOccupation }>(
    "SELECT id, email, occupation FROM newsletter_subscriptions WHERE token = $1",
    [token],
  );
  if (!found) throw unknownToken();

  // Repeats return the same answer.
  await query(
    "UPDATE newsletter_subscriptions SET confirmed_at = now() WHERE id = $1 AND confirmed_at IS NULL",
    [found.id],
  );
  sendJson(ctx.res, 200, { status: "confirmed", email: found.email, occupation: found.occupation });
}
