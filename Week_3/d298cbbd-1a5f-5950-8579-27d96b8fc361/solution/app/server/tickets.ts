import { randomUUID } from "node:crypto";
import type { Mode, Ticket, TicketLength, TicketRequest } from "../shared/protocol";
import { countCustomText, customOverLimit, generateWords, pickQuote } from "../shared/texts";
import type { QuoteGroup, QuoteId } from "../shared/texts";
import { config } from "./config";
import { pool } from "./db";
import { fail, isRecord, json } from "./http";
import type { Reply } from "./http";

const SEED_RANGE = 2 ** 32;
const TIME_LENGTHS: readonly unknown[] = [15, 30, 60, 120];
const WORDS_LENGTHS: readonly unknown[] = [10, 25, 50, 100];
const QUOTE_LENGTHS: readonly unknown[] = ["short", "medium", "long", "all"];
const WORDS_PER_SECOND_OF_TIME = 4;

/** Words the grading route fixed for the next ticket (or race) of one target. */
interface FixedText {
  readonly words: readonly string[];
  readonly quoteId: QuoteId | null;
}

const fixedTexts = new Map<string, FixedText[]>();

export function fixText(target: string, text: FixedText): void {
  fixedTexts.set(target, [...(fixedTexts.get(target) ?? []), text]);
}

export function takeFixedText(target: string): FixedText | undefined {
  return fixedTexts.get(target)?.shift();
}

/** The next number in the database's text sequence; a ticket's seed and a race start both take one. */
export async function nextTextSeed(): Promise<{ sequence: number; seed: number }> {
  const { rows } = await pool.query<{ n: string }>("SELECT nextval('text_sequence') AS n");
  const sequence = Number(rows[0]!.n);
  return { sequence, seed: (config.textSeed + sequence) % SEED_RANGE };
}

function parseRequest(body: unknown): TicketRequest | null {
  if (!isRecord(body)) return null;
  const { mode, length, punctuation = false, numbers = false, text = null } = body;
  if (typeof punctuation !== "boolean" || typeof numbers !== "boolean" || (text !== null && typeof text !== "string")) return null;
  const lengths: Record<Mode, readonly unknown[]> = { time: TIME_LENGTHS, words: WORDS_LENGTHS, quote: QUOTE_LENGTHS, custom: [null] };
  if (typeof mode !== "string" || !(mode in lengths) || !lengths[mode as Mode].includes(length)) return null;
  if (mode === "custom" && text === null) return null;
  return { mode: mode as Mode, length: length as TicketLength, punctuation, numbers, text };
}

function ticketWords(request: TicketRequest, seed: number): { words: string[]; quoteId: QuoteId | null } {
  const decorated = request.mode === "time" || request.mode === "words";
  const punctuation = decorated && request.punctuation;
  const numbers = decorated && request.numbers;
  switch (request.mode) {
    case "time":
      return { words: generateWords(seed, (request.length as number) * WORDS_PER_SECOND_OF_TIME, punctuation, numbers), quoteId: null };
    case "words":
      return { words: generateWords(seed, request.length as number, punctuation, numbers), quoteId: null };
    case "quote": {
      const quote = pickQuote(seed, request.length as QuoteGroup | "all");
      return { words: quote.text.split(" "), quoteId: quote.id };
    }
    case "custom":
      return { words: countCustomText(request.text ?? "").text.split(" "), quoteId: null };
  }
}

export async function issueTicket(body: unknown, viewer: { typistId: string; emailKey: string } | null): Promise<Reply> {
  const request = parseRequest(body);
  if (request === null) return fail(422, "invalid_ticket_request");
  if (request.mode === "custom") {
    const count = countCustomText(request.text ?? "");
    if (count.characters === 0) return fail(422, "custom_text_empty");
    if (customOverLimit(count)) return fail(422, "custom_text_too_long");
  }
  const { sequence, seed } = await nextTextSeed();
  const fixed = takeFixedText(viewer ? `typist:${viewer.emailKey}` : "guest");
  const generated = fixed ? { words: [...fixed.words], quoteId: fixed.quoteId } : ticketWords(request, seed);
  const decorated = request.mode === "time" || request.mode === "words";
  const ticketId = randomUUID();
  const stored = await pool.query<{ expires_at: Date }>(
    `INSERT INTO tickets (id, typist_id, sequence, seed, mode, length, punctuation, numbers, words, quote_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(secs => $11)) RETURNING expires_at`,
    [
      ticketId,
      viewer?.typistId ?? null,
      sequence,
      fixed ? null : seed,
      request.mode,
      request.mode === "custom" ? String(generated.words.length) : request.length === null ? null : String(request.length),
      decorated && request.punctuation,
      decorated && request.numbers,
      JSON.stringify(generated.words),
      generated.quoteId,
      config.ticketTtlSeconds,
    ],
  );
  const ticket: Ticket = { ticketId, seed: fixed ? null : seed, words: generated.words, quoteId: generated.quoteId, expiresAt: stored.rows[0]!.expires_at.toISOString() };
  return json(201, ticket);
}
