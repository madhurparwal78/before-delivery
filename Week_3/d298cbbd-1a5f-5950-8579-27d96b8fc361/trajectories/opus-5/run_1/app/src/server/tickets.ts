import { config } from './config.js';
import { query, queryOne } from './db.js';
import { ApiError } from './http.js';
import { generateWords, pickQuote, quoteWords, ticketSeed } from '../shared/generator.js';
import type { QuoteId, QuoteLength } from '../shared/quotes.js';
import { quoteById } from '../shared/quotes.js';
import type { TestMode } from '../shared/engine.js';

export const TIME_LENGTHS = [15, 30, 60, 120] as const;
export const WORD_LENGTHS = [10, 25, 50, 100] as const;
export const QUOTE_LENGTHS = ['short', 'medium', 'long', 'all'] as const;

export const CUSTOM_MAX_CHARACTERS = 2000;
export const CUSTOM_MAX_WORDS = 400;

export interface TicketRequest {
  readonly mode: TestMode;
  readonly length: string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly text: string | null;
}

export interface Ticket {
  readonly id: string;
  readonly typistId: string | null;
  readonly mode: TestMode;
  readonly length: string | null;
  readonly punctuation: boolean;
  readonly numbers: boolean;
  readonly seed: number | null;
  readonly quoteId: QuoteId | null;
  readonly words: string[];
  readonly expiresAt: Date;
}

interface TicketRow {
  id: string;
  typist_id: string | null;
  mode: string;
  length: string | null;
  punctuation: boolean;
  numbers: boolean;
  seed: string | null;
  quote_id: string | null;
  words: string[];
  expires_at: Date;
}

function toTicket(row: TicketRow): Ticket {
  return {
    id: row.id,
    typistId: row.typist_id,
    mode: row.mode as TestMode,
    length: row.length,
    punctuation: row.punctuation,
    numbers: row.numbers,
    seed: row.seed === null ? null : Number(row.seed),
    quoteId: row.quote_id as QuoteId | null,
    words: row.words,
    expiresAt: row.expires_at,
  };
}

/** Collapses runs of whitespace to one space and trims, the one custom text rule. */
export function collapseCustomText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function customTextCharacters(text: string): number {
  return [...text].length;
}

export function customTextWords(text: string): string[] {
  return text === '' ? [] : text.split(' ');
}

export function parseTicketRequest(body: unknown): TicketRequest {
  if (typeof body !== 'object' || body === null) throw new ApiError(422, 'invalid_ticket_request');
  const raw = body as Record<string, unknown>;
  const mode = raw['mode'];
  const length = raw['length'];
  const punctuation = raw['punctuation'];
  const numbers = raw['numbers'];
  const text = raw['text'];
  if (typeof punctuation !== 'boolean' || typeof numbers !== 'boolean') {
    throw new ApiError(422, 'invalid_ticket_request');
  }
  if (mode === 'time' || mode === 'words') {
    const allowed: readonly number[] = mode === 'time' ? TIME_LENGTHS : WORD_LENGTHS;
    if (typeof length !== 'number' || !allowed.includes(length)) {
      throw new ApiError(422, 'invalid_ticket_request');
    }
    return { mode, length: String(length), punctuation, numbers, text: null };
  }
  if (mode === 'quote') {
    if (typeof length !== 'string' || !(QUOTE_LENGTHS as readonly string[]).includes(length)) {
      throw new ApiError(422, 'invalid_ticket_request');
    }
    return { mode, length, punctuation: false, numbers: false, text: null };
  }
  if (mode === 'custom') {
    if (length !== null && length !== undefined) throw new ApiError(422, 'invalid_ticket_request');
    if (typeof text !== 'string') throw new ApiError(422, 'invalid_ticket_request');
    const collapsed = collapseCustomText(text);
    if (collapsed === '') throw new ApiError(422, 'custom_text_empty');
    if (
      customTextCharacters(collapsed) > CUSTOM_MAX_CHARACTERS ||
      customTextWords(collapsed).length > CUSTOM_MAX_WORDS
    ) {
      throw new ApiError(422, 'custom_text_too_long');
    }
    return { mode, length: null, punctuation: false, numbers: false, text: collapsed };
  }
  throw new ApiError(422, 'invalid_ticket_request');
}

export interface FixedText {
  readonly words: string[];
  readonly quoteId: QuoteId | null;
}

export async function takeFixedText(targets: readonly string[]): Promise<FixedText | null> {
  for (const target of targets) {
    const row = await queryOne<{ words: string[]; quote_id: string | null }>(
      'delete from fixed_texts where target = $1 returning words, quote_id',
      [target],
    );
    if (row) return { words: row.words, quoteId: row.quote_id as QuoteId | null };
  }
  return null;
}

export async function queueFixedText(
  target: string,
  words: string[],
  quoteId: QuoteId | null,
): Promise<void> {
  await query(
    `insert into fixed_texts (target, words, quote_id) values ($1, $2::jsonb, $3)
     on conflict (target) do update set words = $2::jsonb, quote_id = $3, created_at = now()`,
    [target, JSON.stringify(words), quoteId],
  );
}

export async function nextTicketSequence(): Promise<number> {
  const row = await queryOne<{ value: string }>("select nextval('ticket_sequence') as value");
  if (!row) throw new Error('no ticket sequence');
  return Number(row.value);
}

function wordCountFor(request: TicketRequest): number {
  if (request.mode === 'time') return Number(request.length) * 4;
  return Number(request.length);
}

export interface TicketText {
  readonly words: string[];
  readonly seed: number | null;
  readonly quoteId: QuoteId | null;
}

export async function ticketText(
  request: TicketRequest,
  seed: number,
  fixed: FixedText | null,
): Promise<TicketText> {
  if (fixed) {
    if (fixed.quoteId) {
      const quote = quoteById(fixed.quoteId);
      return { words: quoteWords(quote.text), seed: null, quoteId: quote.id };
    }
    return { words: fixed.words, seed: null, quoteId: null };
  }
  if (request.mode === 'quote') {
    const quote = pickQuote(seed, request.length as QuoteLength);
    return { words: quoteWords(quote.text), seed, quoteId: quote.id };
  }
  if (request.mode === 'custom') {
    return { words: customTextWords(request.text ?? ''), seed, quoteId: null };
  }
  return {
    words: generateWords(seed, wordCountFor(request), {
      punctuation: request.punctuation,
      numbers: request.numbers,
    }),
    seed,
    quoteId: null,
  };
}

export async function issueTicket(
  request: TicketRequest,
  typist: { id: string; email: string } | null,
): Promise<Ticket> {
  const sequence = await nextTicketSequence();
  const seed = ticketSeed(config.textSeed, sequence);
  const targets = typist ? [`typist:${typist.email}`] : ['guest'];
  const fixed = await takeFixedText(targets);
  const text = await ticketText(request, seed, fixed);
  const row = await queryOne<TicketRow>(
    `insert into tickets (typist_id, mode, length, punctuation, numbers, seed, quote_id, words, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now() + ($9 || ' seconds')::interval)
     returning id, typist_id, mode, length, punctuation, numbers, seed, quote_id, words, expires_at`,
    [
      typist?.id ?? null,
      request.mode,
      request.length,
      request.punctuation,
      request.numbers,
      text.seed,
      text.quoteId,
      JSON.stringify(text.words),
      String(config.ticketTtlSeconds),
    ],
  );
  if (!row) throw new Error('ticket not issued');
  return toTicket(row);
}

export async function ticketById(id: string): Promise<Ticket | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  const row = await queryOne<TicketRow>(
    `select id, typist_id, mode, length, punctuation, numbers, seed, quote_id, words, expires_at
       from tickets where id = $1`,
    [id],
  );
  return row ? toTicket(row) : null;
}

export function ticketResponse(ticket: Ticket): Record<string, unknown> {
  return {
    ticketId: ticket.id,
    seed: ticket.seed,
    words: ticket.words,
    quoteId: ticket.quoteId,
    expiresAt: ticket.expiresAt.toISOString(),
  };
}
