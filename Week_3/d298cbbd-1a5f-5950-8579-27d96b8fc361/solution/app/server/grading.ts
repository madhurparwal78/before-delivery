import { randomUUID, timingSafeEqual } from "node:crypto";
import { QUOTES } from "../shared/texts";
import { config } from "./config";
import { transaction } from "./db";
import { hashPassword } from "./auth";
import { fail, isRecord, json } from "./http";
import type { Reply } from "./http";
import { fixText } from "./tickets";

export function gradingKeyMatches(sent: string | undefined): boolean {
  const wanted = Buffer.from(config.gradingKey);
  const given = Buffer.from(sent ?? "");
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Creates or replaces typists and adds counted runs that carry no log, as the grading harness needs them. */
export async function gradingSetup(body: unknown): Promise<Reply> {
  const input = isRecord(body) ? body : {};
  const typists = Array.isArray(input.typists) ? (input.typists as unknown[]).filter(isRecord) : [];
  const runs = Array.isArray(input.runs) ? (input.runs as unknown[]).filter(isRecord) : [];
  const hashes = await Promise.all(typists.map((typist) => hashPassword(text(typist.password))));
  return transaction(async (client) => {
    const created: { email: string; id: string }[] = [];
    for (const [index, typist] of typists.entries()) {
      const email = text(typist.email);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO typists (id, name, email, email_key, password_hash, verified) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email_key) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, verified = EXCLUDED.verified
         RETURNING id`,
        [randomUUID(), text(typist.name), email, email.toLowerCase(), hashes[index], typist.verified === true],
      );
      created.push({ email, id: rows[0]!.id });
    }
    for (const run of runs) {
      const owner = created.find((typist) => typist.email.toLowerCase() === text(run.email).toLowerCase());
      if (!owner) continue;
      await client.query(
        `INSERT INTO runs (id, typist_id, mode, length, punctuation, numbers, words, log, speed, raw, accuracy, consistency, verdict, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, '[]', '[]', $7, $8, $9, $10, 'counted', $11)`,
        [randomUUID(), owner.id, text(run.mode), String(run.length), run.punctuation === true, run.numbers === true, run.speed, run.raw, run.accuracy, run.consistency, text(run.finishedAt)],
      );
    }
    return json(201, { typists: created });
  });
}

/** Fixes the words (or the quote) of the next ticket for a typist or any guest, or of the next race. */
export function gradingNextText(body: unknown): Reply {
  const input = isRecord(body) ? body : {};
  const target = text(input.target);
  const quote = QUOTES.find((candidate) => candidate.id === input.quoteId);
  const key = target.startsWith("typist:") ? `typist:${target.slice(7).toLowerCase()}` : target;
  if (!["guest", "race"].includes(key) && !key.startsWith("typist:")) return fail(422, "invalid_fields");
  if (Array.isArray(input.words) && input.words.every((word) => typeof word === "string")) fixText(key, { words: input.words as string[], quoteId: null });
  else if (quote) fixText(key, { words: quote.text.split(" "), quoteId: quote.id });
  else return fail(422, "invalid_fields");
  return json(200, { queued: true });
}
