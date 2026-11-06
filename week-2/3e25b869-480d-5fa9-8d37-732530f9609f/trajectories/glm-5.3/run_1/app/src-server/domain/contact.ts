// The contact form: reference numbers, validation, one bilingual acknowledgement.
import { type Pool } from "pg";
import { ApiError } from "../core/http.js";
import type { Locale, ContactTopic } from "../core/catalog.js";
import { fieldMessage } from "../core/copy.js";
import { hasControlChars, hasDisallowedControlChars, isValidEmail, normalizeEmail } from "./text.js";
import { contactReplyEmail } from "../core/emails.js";
import { queueNotice, type Outbox } from "../services/outbox.js";

export interface ContactInput {
  name: string;
  email: string;
  topic: string;
  message: string;
}

export async function submitContact(
  pool: Pool,
  outbox: Outbox,
  locale: Locale,
  input: ContactInput
): Promise<{ reference: string }> {
  const fields: Record<string, string> = {};
  if (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.length > 120 || hasControlChars(input.name)) {
    fields.name = fieldMessage("name", locale);
  }
  if (typeof input.email !== "string" || !isValidEmail(input.email)) {
    fields.email = fieldMessage("email", locale);
  }
  const topics: ContactTopic[] = ["order", "subscription", "wholesale", "other"];
  if (typeof input.topic !== "string" || !topics.includes(input.topic as ContactTopic)) {
    fields.topic = fieldMessage("topic", locale);
  }
  if (typeof input.message !== "string" || input.message.trim().length < 10 || input.message.length > 2000 || hasDisallowedControlChars(input.message)) {
    fields.message = fieldMessage("message", locale);
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError(422, "invalid", null, fields);
  }
  const email = normalizeEmail(input.email);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const counter = await client.query("SELECT value FROM counters WHERE name = 'contact' FOR UPDATE");
    const reference = `CT-${String(Number(counter.rows[0].value) + 1).padStart(6, "0")}`;
    await client.query("UPDATE counters SET value = value + 1 WHERE name = 'contact'");
    await client.query(
      "INSERT INTO contacts (number, name, email, topic, message) VALUES ($1, $2, $3, $4, $5)",
      [reference, input.name, email, input.topic, input.message]
    );
    const content = contactReplyEmail({ reference, topic: input.topic as ContactTopic, name: input.name });
    await queueNotice(client, {
      key: `contact.${reference}`,
      kind: "contact_reply",
      to: email,
      locale,
      subjectEn: content.subjectEn,
      subjectFr: content.subjectFr,
      linesEn: content.linesEn,
      linesFr: content.linesFr
    });
    await client.query("COMMIT");
    outbox.kick();
    return { reference };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw err;
  }
}
