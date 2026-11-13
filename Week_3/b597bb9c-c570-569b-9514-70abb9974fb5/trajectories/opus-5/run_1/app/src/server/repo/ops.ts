/**
 * The one place a timeline change is saved. Ops apply in server order, raise the
 * project version by one, and decide the concurrency winner.
 */
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import { ApiError } from '../../domain/api-error.js';
import { runOp, type AppliedOp } from '../../domain/ops-apply.js';
import { exactRate } from '../../domain/rate.js';
import type { EngineContext, MediaInfo, TimelineSnapshot } from '../../domain/timeline-state.js';
import { loadMediaInfo } from './media.js';
import { commentRecord, loadProject, loadSnapshots, publicCaption, publicClip, projectRecord, type LoadedProject } from './projects.js';
import { randomId } from '../ids.js';
import type { KitRecord, OpChanges, OpResult, Role } from '../../shared/types.js';

export interface OpAuthor {
  id: string;
  name: string;
}

export interface OpInput {
  projectId: string;
  author: OpAuthor;
  role: Role;
  opId: string;
  baseVersion: number;
  type: string;
  body: Record<string, unknown>;
  /** an undo or redo applies a stored entry instead of starting a new one */
  entry?: { id: number; mode: 'undo' | 'redo' };
}

export interface OpOutcome {
  status: number;
  result: OpResult;
  author: OpAuthor;
  type: string;
  op: Record<string, unknown>;
}

async function kitsOf(client: PoolClient): Promise<Map<string, KitRecord>> {
  const kits = await client.query<KitRecord>(`select id, name, text_colour, box_colour, font_weight from kits`);
  return new Map(kits.rows.map((kit) => [kit.id, kit]));
}

function changesOf(
  applied: AppliedOp,
  loaded: LoadedProject,
  snapshots: Map<string, TimelineSnapshot>,
  rateName: string,
): OpChanges {
  const rate = exactRate(loaded.row.frame_rate);
  void rateName;
  const comments = loaded.comments
    .filter((comment) => applied.commentIds.includes(comment.id))
    .map((comment) => commentRecord(comment, loaded.state.clips, snapshots, rate));
  return {
    clips: applied.clips.map(publicClip),
    captions: applied.captions.map(publicCaption),
    comments,
    rows: applied.rows.map((row) => ({ ...row })),
  };
}

async function persist(
  client: PoolClient,
  loaded: LoadedProject,
  applied: AppliedOp,
  markersBefore: string,
): Promise<void> {
  const projectId = loaded.row.id;
  for (const clip of applied.clips) {
    await client.query(
      `insert into clips (id, project_id, row_id, name, kind, media_id, start_frame, end_frame, source_in, source_out,
        speed_percent, hidden, group_id, text, text_colour, box_colour, font_weight, keyframes, base, added_seq)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       on conflict (id) do update set row_id = excluded.row_id, name = excluded.name, kind = excluded.kind,
         media_id = excluded.media_id, start_frame = excluded.start_frame, end_frame = excluded.end_frame,
         source_in = excluded.source_in, source_out = excluded.source_out, speed_percent = excluded.speed_percent,
         hidden = excluded.hidden, group_id = excluded.group_id, text = excluded.text,
         text_colour = excluded.text_colour, box_colour = excluded.box_colour, font_weight = excluded.font_weight,
         keyframes = excluded.keyframes, base = excluded.base`,
      [
        clip.id,
        projectId,
        clip.row_id,
        clip.name,
        clip.kind,
        clip.media_id,
        clip.start_frame,
        clip.end_frame,
        clip.source_in,
        clip.source_out,
        clip.speed_percent,
        clip.hidden,
        clip.group_id,
        clip.text,
        clip.text_colour,
        clip.box_colour,
        clip.font_weight,
        JSON.stringify(clip.keyframes),
        JSON.stringify(clip.base),
        clip.added_seq,
      ],
    );
  }
  for (const caption of applied.captions) {
    await client.query(
      `insert into captions (id, project_id, row_id, start_frame, end_frame, text, import_start_ms, import_end_ms,
         import_start_frame, import_end_frame)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do update set row_id = excluded.row_id, start_frame = excluded.start_frame,
         end_frame = excluded.end_frame, text = excluded.text, import_start_ms = excluded.import_start_ms,
         import_end_ms = excluded.import_end_ms, import_start_frame = excluded.import_start_frame,
         import_end_frame = excluded.import_end_frame`,
      [
        caption.id,
        projectId,
        caption.row_id,
        caption.start_frame,
        caption.end_frame,
        caption.text,
        caption.import_start_ms,
        caption.import_end_ms,
        caption.import_start_frame,
        caption.import_end_frame,
      ],
    );
  }
  for (const row of applied.rows) {
    await client.query(
      `insert into project_rows (id, project_id, name, kind, position, locked) values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set name = excluded.name, kind = excluded.kind, position = excluded.position,
         locked = excluded.locked`,
      [row.id, projectId, row.name, row.kind, row.position, row.locked],
    );
  }
  for (const id of applied.removed) {
    await client.query(`delete from clips where id = $1 and project_id = $2`, [id, projectId]);
    await client.query(`delete from captions where id = $1 and project_id = $2`, [id, projectId]);
    await client.query(`delete from project_rows where id = $1 and project_id = $2`, [id, projectId]);
  }
  for (const comment of loaded.state.comments) {
    if (!applied.commentIds.includes(comment.id)) continue;
    await client.query(`update comments set pin_frame = $2, pin_row_id = $3 where id = $1`, [
      comment.id,
      comment.pin_frame,
      comment.pin_row_id,
    ]);
  }
  const markersAfter = JSON.stringify(loaded.state.markers);
  if (markersAfter !== markersBefore) {
    await client.query(`delete from markers where project_id = $1`, [projectId]);
    for (const marker of loaded.state.markers) {
      await client.query(`insert into markers (project_id, frame, label) values ($1,$2,$3)`, [
        projectId,
        marker.frame,
        marker.label,
      ]);
    }
  }
  if (loaded.state.project.aspect_ratio !== loaded.row.aspect_ratio) {
    await client.query(`update projects set aspect_ratio = $2 where id = $1`, [
      projectId,
      loaded.state.project.aspect_ratio,
    ]);
  }
}

export class ConflictError extends ApiError {
  constructor(winner: string, clipName: string, items: unknown[]) {
    super('conflict', `${winner} changed ${clipName} first. Your change to it was not saved.`, { winner, items });
  }
}

export async function performOp(input: OpInput): Promise<OpOutcome> {
  const media: Map<string, MediaInfo> = await loadMediaInfo();
  const client: PoolClient = await pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query<{ version: number }>(`select version from projects where id = $1 for update`, [
      input.projectId,
    ]);
    if (locked.rows.length === 0) throw ApiError.of('not_found', undefined);

    const replay = await client.query<{ response: OpResult; status: number }>(
      `select response, status from op_ids where project_id = $1 and person_id = $2 and op_id = $3`,
      [input.projectId, input.author.id, input.opId],
    );
    if (replay.rows.length > 0) {
      await client.query('commit');
      return {
        status: replay.rows[0].status,
        result: replay.rows[0].response,
        author: input.author,
        type: input.type,
        op: input.body,
      };
    }

    const loaded = await loadProject(client, input.projectId, media);
    if (loaded === null) throw ApiError.of('not_found', undefined);
    const currentVersion = loaded.row.version;
    if (input.baseVersion > currentVersion) throw ApiError.validation({ base_version: 'That value is not allowed here.' });

    const markersBefore = JSON.stringify(loaded.state.markers);
    const snapshots = await loadSnapshots(client, input.projectId);
    const context: EngineContext = {
      state: loaded.state,
      media,
      kits: await kitsOf(client),
      snapshots,
      nextId: (prefix) => randomId(prefix),
      nextSeq: () => Date.now() * 1000 + Math.floor(Math.random() * 1000),
    };
    const applied = runOp(context, input.type, input.body);

    if (input.baseVersion < currentVersion) {
      const later = await client.query<{ version: number; author_id: string; touched: string[]; name: string }>(
        `select o.version, o.author_id, o.touched, p.name from ops o join people p on p.id = o.author_id
         where o.project_id = $1 and o.version > $2 and o.author_id <> $3 order by o.version`,
        [input.projectId, input.baseVersion, input.author.id],
      );
      for (const op of later.rows) {
        const clash = op.touched.find((id) => applied.touched.includes(id));
        if (clash !== undefined) {
          const contested = applied.touched.filter((id) => op.touched.includes(id));
          const items = [
            ...loaded.state.clips.filter((clip) => contested.includes(clip.id)).map(publicClip),
            ...loaded.state.captions.filter((caption) => contested.includes(caption.id)).map(publicCaption),
          ];
          const clip = loaded.state.clips.find((candidate) => candidate.id === clash);
          throw new ConflictError(op.name, clip?.name ?? clash, items);
        }
      }
    }

    await persist(client, loaded, applied, markersBefore);
    const version = currentVersion + 1;
    await client.query(`update projects set version = $2, updated_at = now() where id = $1`, [input.projectId, version]);
    const changes = changesOf(applied, loaded, snapshots, loaded.row.frame_rate);
    await client.query(
      `insert into ops (project_id, version, author_id, type, op, changes, removed, touched)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.projectId,
        version,
        input.author.id,
        input.type,
        JSON.stringify({ ...input.body, type: input.type }),
        JSON.stringify(changes),
        JSON.stringify(applied.removed),
        JSON.stringify(applied.touched),
      ],
    );

    if (input.entry === undefined) {
      await client.query(`update undo_entries set state = 'dead' where project_id = $1 and person_id = $2 and state = 'undone'`, [
        input.projectId,
        input.author.id,
      ]);
      await client.query(
        `insert into undo_entries (project_id, person_id, forward, inverse, state) values ($1,$2,$3,$4,'active')`,
        [
          input.projectId,
          input.author.id,
          JSON.stringify({ ...input.body, type: input.type }),
          JSON.stringify(applied.inverse),
        ],
      );
    } else if (input.entry.mode === 'undo') {
      await client.query(`update undo_entries set state = 'undone' where id = $1`, [input.entry.id]);
    } else {
      await client.query(`update undo_entries set state = 'active', inverse = $2 where id = $1`, [
        input.entry.id,
        JSON.stringify(applied.inverse),
      ]);
    }

    const result: OpResult = {
      version,
      changes,
      removed: applied.removed,
      stopped: applied.stopped,
    };
    if (loaded.state.project.aspect_ratio !== loaded.row.aspect_ratio) {
      const role = input.role;
      const refreshed = { ...loaded, row: { ...loaded.row, aspect_ratio: loaded.state.project.aspect_ratio, version } };
      result.project = projectRecord(refreshed, role, null);
    }
    await client.query(
      `insert into op_ids (project_id, person_id, op_id, response, status) values ($1,$2,$3,$4,$5)
       on conflict do nothing`,
      [input.projectId, input.author.id, input.opId, JSON.stringify(result), 200],
    );
    await client.query('commit');
    return { status: 200, result, author: input.author, type: input.type, op: { ...input.body, type: input.type } };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export interface UndoEntryRow {
  id: number;
  forward: Record<string, unknown> & { type: string };
  inverse: Record<string, unknown> & { type: string };
}

export async function nextUndoEntry(projectId: string, personId: string): Promise<UndoEntryRow | null> {
  const found = await pool.query<UndoEntryRow>(
    `select id, forward, inverse from undo_entries
     where project_id = $1 and person_id = $2 and state = 'active' order by id desc limit 1`,
    [projectId, personId],
  );
  return found.rows.length > 0 ? found.rows[0] : null;
}

export async function nextRedoEntry(projectId: string, personId: string): Promise<UndoEntryRow | null> {
  const found = await pool.query<UndoEntryRow>(
    `select id, forward, inverse from undo_entries
     where project_id = $1 and person_id = $2 and state = 'undone' order by id desc limit 1`,
    [projectId, personId],
  );
  return found.rows.length > 0 ? found.rows[0] : null;
}
