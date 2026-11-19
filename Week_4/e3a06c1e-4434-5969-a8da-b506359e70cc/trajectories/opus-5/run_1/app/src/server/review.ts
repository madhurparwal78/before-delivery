import { randomUUID } from 'node:crypto';
import { query, queryOne } from './db/pool.js';
import { cueFlagged, cueText, type SidecarCue } from './domain/sidecar.js';
import { correctionWords, wordErrorRate } from './domain/transcript.js';
import type { CorrectionState, CorrectionView, SegmentView, Word } from '../shared/types.js';

interface SegmentRow {
  id: string;
  session_id: string;
  seg_index: number;
  start_ms: number;
  end_ms: number;
  flagged: boolean;
  machine: { text: string; words: Word[] };
}

export interface CorrectionRow {
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
}

const CORRECTION_COLUMNS = `c.id, c.session_id, c.segment_id, c.author_id, m.name as author_name, c.state,
  c.text, c.note, c.created_at, c.submitted_at, c.decided_at, c.decided_by`;

export const correctionView = (row: CorrectionRow): CorrectionView => ({
  id: row.id,
  session_id: row.session_id,
  segment_id: row.segment_id,
  author: { id: row.author_id, name: row.author_name },
  state: row.state,
  text: row.text,
  note: row.note,
  created_at: row.created_at.toISOString(),
  submitted_at: row.submitted_at === null ? null : row.submitted_at.toISOString(),
  decided_at: row.decided_at === null ? null : row.decided_at.toISOString(),
  decided_by: row.decided_by,
});

export const loadCorrection = (correctionId: string): Promise<CorrectionRow | null> =>
  queryOne<CorrectionRow>(
    `select ${CORRECTION_COLUMNS} from corrections c join members m on m.id = c.author_id where c.id = $1`,
    [correctionId],
  );

export const loadCorrectionsForSession = (sessionId: string): Promise<CorrectionRow[]> =>
  query<CorrectionRow>(
    `select ${CORRECTION_COLUMNS} from corrections c join members m on m.id = c.author_id
      where c.session_id = $1 order by c.created_at`,
    [sessionId],
  );

export const loadSegment = (segmentId: string): Promise<SegmentRow | null> =>
  queryOne<SegmentRow>(
    'select id, session_id, seg_index, start_ms, end_ms, flagged, machine from segments where id = $1',
    [segmentId],
  );

interface SegmentContext {
  readonly approved: Map<string, { id: string; text: string }>;
  readonly open: Map<string, { id: string; state: CorrectionState; author_id: string }>;
}

const segmentContext = async (sessionId: string): Promise<SegmentContext> => {
  const approvedRows = await query<{ id: string; segment_id: string; text: string }>(
    `select distinct on (segment_id) id, segment_id, text from corrections
      where session_id = $1 and state = 'approved' order by segment_id, decided_at desc`,
    [sessionId],
  );
  const openRows = await query<{ id: string; segment_id: string; state: CorrectionState; author_id: string }>(
    `select id, segment_id, state, author_id from corrections
      where session_id = $1 and state in ('draft','submitted','returned')`,
    [sessionId],
  );
  return {
    approved: new Map(approvedRows.map((row) => [row.segment_id, { id: row.id, text: row.text }])),
    open: new Map(openRows.map((row) => [row.segment_id, { id: row.id, state: row.state, author_id: row.author_id }])),
  };
};

/** The reviewed transcript is the machine transcript with each segment replaced by its latest approved correction. */
const buildSegmentView = (row: SegmentRow, context: SegmentContext): SegmentView => {
  const approved = context.approved.get(row.id);
  const reviewedWords =
    approved === undefined ? row.machine.words : correctionWords(approved.text, row.start_ms, row.end_ms);
  return {
    id: row.id,
    index: row.seg_index,
    start_ms: row.start_ms,
    end_ms: row.end_ms,
    flagged: row.flagged,
    machine: row.machine,
    reviewed: {
      text: reviewedWords.map((word) => word.text).join(' '),
      words: reviewedWords,
      source: approved === undefined ? 'machine' : 'correction',
      correction_id: approved?.id ?? null,
    },
    open_correction: context.open.get(row.id) ?? null,
  };
};

export const loadSegmentViews = async (sessionId: string): Promise<SegmentView[]> => {
  const rows = await query<SegmentRow>(
    'select id, session_id, seg_index, start_ms, end_ms, flagged, machine from segments where session_id = $1 order by seg_index',
    [sessionId],
  );
  const context = await segmentContext(sessionId);
  return rows.map((row) => buildSegmentView(row, context));
};

export const loadSegmentView = async (segmentId: string): Promise<SegmentView | null> => {
  const row = await loadSegment(segmentId);
  if (row === null) return null;
  return buildSegmentView(row, await segmentContext(row.session_id));
};

export const createSegment = async (sessionId: string, cue: SidecarCue, index: number): Promise<SegmentView> => {
  const id = randomUUID();
  const machine = { text: cueText(cue.words), words: [...cue.words] };
  await query(
    `insert into segments (id, session_id, seg_index, start_ms, end_ms, flagged, machine)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)
     on conflict (session_id, seg_index) do nothing`,
    [id, sessionId, index, cue.startMs, cue.endMs, cueFlagged(cue.words), JSON.stringify(machine)],
  );
  await query(
    `update sessions set machine_text = case when machine_text = '' then $2 else machine_text || ' ' || $2 end
      where id = $1`,
    [sessionId, machine.text],
  );
  const view = await queryOne<SegmentRow>(
    'select id, session_id, seg_index, start_ms, end_ms, flagged, machine from segments where session_id = $1 and seg_index = $2',
    [sessionId, index],
  );
  if (view === null) throw new Error('segment vanished after insert');
  return buildSegmentView(view, await segmentContext(sessionId));
};

/**
 * The session's word error rate, derived from the machine and reviewed
 * transcripts, and stored so every read of the session reports the same figure.
 */
export const recomputeWer = async (sessionId: string): Promise<number | null> => {
  const segments = await loadSegmentViews(sessionId);
  const machineWords = segments.flatMap((segment) => segment.machine.words.map((word) => word.text));
  const reviewedWords = segments.flatMap((segment) => segment.reviewed.words.map((word) => word.text));
  const wer = wordErrorRate(machineWords, reviewedWords);
  await query('update sessions set wer = $2 where id = $1', [sessionId, wer]);
  return wer;
};
