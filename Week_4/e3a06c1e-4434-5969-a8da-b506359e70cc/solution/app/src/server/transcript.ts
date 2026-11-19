// Session, segment and correction objects as the API publishes them, with the reviewed transcript
// (machine words with each segment's latest approved correction applied) and its word error rate.
import { OPEN_CORRECTION_STATES, type Correction, type CorrectionState, type Segment, type Session, type Word } from "../shared/types";
import { isFlagged, wordErrorRate } from "../shared/review";
import type { Plan } from "../shared/billing";
import { rows, type Db } from "./db";
import { spreadWords } from "./sidecar";
import { words } from "../shared/text";

export interface SessionRow {
  id: string;
  project_id: string;
  key_id: string;
  kind: Session["kind"];
  source: Session["source"];
  label: string;
  state: Session["state"];
  close_reason: Session["close_reason"];
  channels: number;
  audio_ms: number;
  frame: number;
  mean: number[];
  plan: Plan;
  started_at: Date;
  live_at: Date | null;
  ended_at: Date | null;
  billable_seconds: number | null;
  billing_state: Session["billing_state"];
}

export const SESSION_COLUMNS =
  "s.id, s.project_id, s.key_id, s.kind, s.source, s.label, s.state, s.close_reason, s.channels, s.audio_ms, s.frame, s.mean, s.plan, s.started_at, s.live_at, s.ended_at, s.billable_seconds, s.billing_state";

interface SegmentRow {
  id: string;
  session_id: string;
  idx: number;
  start_ms: number;
  end_ms: number;
  words: Word[];
  text: string;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

export function correctionObject(row: {
  id: string;
  session_id: string;
  segment_id: string;
  author_id: string;
  author_name: string;
  state: CorrectionState;
  text: string;
  note: string | null;
  created_at: Date;
  submitted_at: Date | null;
  decided_at: Date | null;
  decided_by: string | null;
}): Correction {
  return {
    id: row.id,
    session_id: row.session_id,
    segment_id: row.segment_id,
    author: { id: row.author_id, name: row.author_name },
    state: row.state,
    text: row.text,
    note: row.note,
    created_at: row.created_at.toISOString(),
    submitted_at: iso(row.submitted_at),
    decided_at: iso(row.decided_at),
    decided_by: row.decided_by,
  };
}

export const CORRECTION_SELECT =
  "SELECT c.id, c.session_id, c.segment_id, c.author_id, m.name AS author_name, c.state, c.text, c.note, c.created_at, c.submitted_at, c.decided_at, c.decided_by FROM corrections c JOIN members m ON m.id = c.author_id";

interface Loaded {
  segments: Map<string, SegmentRow[]>;
  approved: Map<string, { id: string; text: string }>;
  open: Map<string, { id: string; state: CorrectionState; author_id: string }>;
}

async function load(sessionIds: readonly string[], db?: Db): Promise<Loaded> {
  const [segmentRows, approvedRows, openRows] = await Promise.all([
    rows<SegmentRow>("SELECT id, session_id, idx, start_ms, end_ms, words, text FROM segments WHERE session_id = ANY($1::uuid[]) ORDER BY session_id, idx", [sessionIds], db),
    rows<{ id: string; segment_id: string; text: string }>(
      "SELECT DISTINCT ON (segment_id) id, segment_id, text FROM corrections WHERE session_id = ANY($1::uuid[]) AND state = 'approved' ORDER BY segment_id, decided_at DESC",
      [sessionIds],
      db,
    ),
    rows<{ id: string; segment_id: string; state: CorrectionState; author_id: string }>(
      "SELECT id, segment_id, state, author_id FROM corrections WHERE session_id = ANY($1::uuid[]) AND state = ANY($2)",
      [sessionIds, OPEN_CORRECTION_STATES],
      db,
    ),
  ]);
  const segments = new Map<string, SegmentRow[]>();
  for (const row of segmentRows) segments.set(row.session_id, [...(segments.get(row.session_id) ?? []), row]);
  return {
    segments,
    approved: new Map(approvedRows.map((row) => [row.segment_id, { id: row.id, text: row.text }])),
    open: new Map(openRows.map((row) => [row.segment_id, { id: row.id, state: row.state, author_id: row.author_id }])),
  };
}

function segmentObject(row: SegmentRow, loaded: Loaded): Segment {
  const approved = loaded.approved.get(row.id);
  const tokens = approved ? words(approved.text) : [];
  const reviewedWords = approved ? spreadWords(tokens, tokens.map(() => 1), row.start_ms, row.end_ms) : row.words;
  return {
    id: row.id,
    index: row.idx,
    start_ms: row.start_ms,
    end_ms: row.end_ms,
    flagged: isFlagged(row.words.map((word) => word.confidence)),
    machine: { text: row.text, words: row.words },
    reviewed: {
      text: approved ? reviewedWords.map((word) => word.text).join(" ") : row.text,
      words: reviewedWords,
      source: approved ? "correction" : "machine",
      correction_id: approved?.id ?? null,
    },
    open_correction: loaded.open.get(row.id) ?? null,
  };
}

function werOf(segments: readonly Segment[]): number | null {
  return wordErrorRate(
    segments.flatMap((segment) => segment.machine.words.map((word) => word.text)),
    segments.flatMap((segment) => segment.reviewed.words.map((word) => word.text)),
  );
}

export async function transcriptOf(sessionId: string, db?: Db): Promise<{ segments: Segment[]; wer: number | null }> {
  const loaded = await load([sessionId], db);
  const segments = (loaded.segments.get(sessionId) ?? []).map((row) => segmentObject(row, loaded));
  return { segments, wer: werOf(segments) };
}

export async function segmentById(sessionId: string, segmentId: string, db?: Db): Promise<Segment | undefined> {
  return (await transcriptOf(sessionId, db)).segments.find((segment) => segment.id === segmentId);
}

export async function sessionObjects(sessionRows: readonly SessionRow[], db?: Db): Promise<Session[]> {
  if (sessionRows.length === 0) return [];
  const loaded = await load(sessionRows.map((row) => row.id), db);
  const serverTime = new Date().toISOString();
  return sessionRows.map((row) => {
    const segments = (loaded.segments.get(row.id) ?? []).map((segment) => segmentObject(segment, loaded));
    return {
      id: row.id,
      project_id: row.project_id,
      kind: row.kind,
      source: row.source,
      label: row.label,
      state: row.state,
      close_reason: row.close_reason,
      channels: row.channels,
      sample_rate: 16000,
      audio_ms: row.audio_ms,
      frame: row.frame,
      plan: row.plan,
      key_id: row.key_id,
      started_at: row.started_at.toISOString(),
      live_at: iso(row.live_at),
      ended_at: iso(row.ended_at),
      billable_seconds: row.billable_seconds,
      billing_state: row.billing_state,
      flagged_segments: segments.filter((segment) => segment.flagged).length,
      wer: werOf(segments),
      mean: row.mean,
      server_time: serverTime,
    };
  });
}

export async function sessionObject(sessionId: string, db?: Db): Promise<Session> {
  const [row] = await rows<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions s WHERE s.id = $1`, [sessionId], db);
  const [session] = await sessionObjects([row], db);
  return session;
}

/** The machine transcript artifact, written once at close; the same bytes whenever it is rebuilt from the segments. */
export async function machineArtifact(sessionId: string, db?: Db): Promise<Buffer> {
  const segments = await rows<SegmentRow>("SELECT id, session_id, idx, start_ms, end_ms, words, text FROM segments WHERE session_id = $1 ORDER BY idx", [sessionId], db);
  return Buffer.from(
    JSON.stringify({
      session_id: sessionId,
      segments: segments.map((segment) => ({
        index: segment.idx,
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        words: segment.words.map((word) => ({ text: word.text, confidence: word.confidence, start_ms: word.start_ms, end_ms: word.end_ms })),
      })),
    }),
    "utf8",
  );
}
