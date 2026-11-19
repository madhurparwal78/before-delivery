// Shared helpers and object builders for the REST routes.

import type { Db } from './db';
import { errors } from './errors';
import type { Ctx } from './router';
import { visibleProjectIds } from './access';
import { splitWords } from '../src-shared/text';
import { wordErrorRate } from '../src-shared/vtt';
import type { Correction, Quota, Segment, Session, Word } from '../src-shared/protocol';
import type { PlanId } from '../src-shared/billing';

export function iso(d: Date): string {
  return d.toISOString().replace(/(\.\d{3})Z$/, 'Z');
}

export function serverTime(): string {
  return iso(new Date());
}

export type SessionRow = {
  id: string; project_id: string; kind: 'live' | 'replay'; source: 'live' | 'tone' | 'upload';
  label: string; state: Session['state']; close_reason: string | null; channels: number;
  sample_rate: number; audio_ms: number; frame: number; plan: PlanId; key_id: string;
  started_at: Date; live_at: Date | null; ended_at: Date | null;
  billable_seconds: number | null; billing_state: Session['billing_state'];
  flagged_segments: number; wer: number | null;
};

export const SESSION_COLUMNS = `id, project_id, kind, source, label, state, close_reason, channels, sample_rate, audio_ms, frame, plan, key_id, started_at, live_at, ended_at, billable_seconds, billing_state`;

export function sessionObject(r: SessionRow): Session {
  return {
    id: r.id, project_id: r.project_id, kind: r.kind, source: r.source, label: r.label,
    state: r.state, close_reason: r.close_reason as Session['close_reason'], channels: r.channels,
    sample_rate: 16000, audio_ms: r.audio_ms, frame: r.frame, plan: r.plan, key_id: r.key_id,
    started_at: iso(r.started_at), live_at: r.live_at ? iso(r.live_at) : null,
    ended_at: r.ended_at ? iso(r.ended_at) : null,
    billable_seconds: r.billable_seconds, billing_state: r.billing_state,
    flagged_segments: Number(r.flagged_segments), wer: r.wer, server_time: serverTime(),
  };
}

export type WordJson = { text: string; confidence: number; start_ms: number; end_ms: number };

export type SegmentRow = {
  id: string; index_in_session: number; start_ms: number; end_ms: number; machine_words: WordJson[];
};

export async function segmentObject(db: Db, s: SegmentRow): Promise<Segment> {
  const machineWords = s.machine_words;
  const machineText = machineWords.map((w) => w.text).join(' ');
  const { rows: corr } = await db.query(
    `SELECT id, text FROM corrections WHERE segment_id=$1 AND state='approved' ORDER BY decided_at DESC NULLS LAST LIMIT 1`,
    [s.id],
  );
  const { rows: open } = await db.query(
    `SELECT id, state, author_id FROM corrections WHERE segment_id=$1 AND state IN ('draft','submitted','returned') ORDER BY created_at DESC LIMIT 1`,
    [s.id],
  );
  let reviewedWords: WordJson[] = machineWords;
  let reviewedText = machineText;
  let source: 'machine' | 'correction' = 'machine';
  let correctionId: string | null = null;
  if (corr.length > 0) {
    const words = splitWords(corr[0].text as string);
    const span = s.end_ms - s.start_ms;
    const n = words.length;
    reviewedWords = words.map((w, k) => ({
      text: w, confidence: 1,
      start_ms: Math.floor(s.start_ms + (k * span) / n),
      end_ms: Math.floor(s.start_ms + ((k + 1) * span) / n),
    }));
    reviewedText = words.join(' ');
    source = 'correction';
    correctionId = corr[0].id as string;
  }
  return {
    id: s.id, index: s.index_in_session, start_ms: s.start_ms, end_ms: s.end_ms,
    flagged: machineWords.length > 0 && machineWords.some((w) => w.confidence < 0.85),
    machine: { text: machineText, words: machineWords },
    reviewed: { text: reviewedText, words: reviewedWords, source, correction_id: correctionId },
    open_correction: open.length > 0
      ? { id: open[0].id as string, state: open[0].state as string, author_id: open[0].author_id as string }
      : null,
  };
}

export type CorrectionRow = {
  id: string; session_id: string; segment_id: string; state: Correction['state'];
  text: string; note: string | null; created_at: Date; submitted_at: Date | null;
  decided_at: Date | null; decided_by: string | null; author_id: string; author_name: string;
};

export function correctionObject(r: CorrectionRow): Correction {
  return {
    id: r.id, session_id: r.session_id, segment_id: r.segment_id,
    author: { id: r.author_id, name: r.author_name }, state: r.state, text: r.text, note: r.note,
    created_at: iso(r.created_at), submitted_at: r.submitted_at ? iso(r.submitted_at) : null,
    decided_at: r.decided_at ? iso(r.decided_at) : null, decided_by: r.decided_by,
  };
}

/** WER is derived from machine vs reviewed words (DP-42), in exactly this one place. */
export async function sessionWer(db: Db, sessionId: string): Promise<number | null> {
  const { rows } = await db.query(
    `SELECT machine_words,
            (SELECT c.text FROM corrections c WHERE c.segment_id = segments.id AND c.state='approved' ORDER BY c.decided_at DESC NULLS LAST LIMIT 1) AS approved_text
       FROM segments WHERE session_id=$1 ORDER BY index_in_session`,
    [sessionId],
  );
  const machine: string[] = [];
  const reviewed: string[] = [];
  for (const r of rows) {
    for (const w of r.machine_words as WordJson[]) machine.push(w.text);
    if (r.approved_text !== null) reviewed.push(...splitWords(r.approved_text as string));
    else for (const w of r.machine_words as WordJson[]) reviewed.push(w.text);
  }
  return wordErrorRate(machine, reviewed);
}

export async function loadSessionRow(db: Db, id: string): Promise<SessionRow | null> {
  const { rows } = await db.query(
    `SELECT ${SESSION_COLUMNS},
            (SELECT count(*)::int FROM segments sg WHERE sg.session_id = sessions.id AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(sg.machine_words) w WHERE (w->>'confidence')::numeric < 0.85)) AS flagged_segments
       FROM sessions WHERE id=$1`,
    [id],
  );
  if (rows.length === 0) return null;
  return rows[0] as unknown as SessionRow;
}

/** Sessions outside visible projects are not found (DP-09). */
export async function requireSessionVisible(ctx: Ctx, sessionId: string): Promise<SessionRow> {
  if (!ctx.member) throw errors.unauthenticated();
  const row = await loadSessionRow(ctx.db, sessionId);
  if (!row) throw errors.notFound();
  const visible = await visibleProjectIds(ctx.db, ctx.member);
  if (!visible.includes(row.project_id)) throw errors.notFound();
  return row;
}

export async function loadSegmentRow(db: Db, sessionId: string, segmentId: string): Promise<SegmentRow | null> {
  const { rows } = await db.query(
    `SELECT id, index_in_session, start_ms, end_ms, machine_words FROM segments WHERE session_id=$1 AND id=$2`,
    [sessionId, segmentId],
  );
  if (rows.length === 0) return null;
  return rows[0] as unknown as SegmentRow;
}

export async function requireQuotaForProject(ctx: Ctx, projectId: string): Promise<Quota> {
  const { rows } = await ctx.db.query(`SELECT monthly_quota_minutes FROM projects WHERE id=$1`, [projectId]);
  if (rows.length === 0) throw errors.notFound();
  return ctx.hub.quotaFor(projectId, rows[0].monthly_quota_minutes as number);
}
