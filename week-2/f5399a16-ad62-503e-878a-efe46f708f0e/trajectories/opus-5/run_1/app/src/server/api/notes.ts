import { COPY, say } from '../../domain/copy.js';
import { parseDecimal } from '../../domain/rational.js';
import { framesFromSeconds, timecode } from '../../domain/timecode.js';
import { toInstantText } from '../../domain/time.js';
import type { RouteSpec } from '../http.js';
import { readJsonBody, refuse, requireIdentity } from '../http.js';
import { one, query } from '../infra/db.js';
import { storeKeys } from '../infra/store.js';
import { FieldCollector, requireUuidParam } from '../validate.js';
import { newestCut, readCutFrames } from './cuts.js';
import { readStored } from './drawings.js';
import { addEvent, requireJob, requireWritableJob } from './support.js';
import type { JobRow } from './support.js';

export const NOTE_STATES = ['open', 'done', 'wontDo'] as const;

export type NoteRow = {
  id: string;
  job_id: string;
  producer_id: string;
  review_page_id: string | null;
  frame: number;
  x: string;
  y: string;
  typed_name: string;
  state: string;
  text: string;
  suggested_seconds: string | null;
  attachment_id: string | null;
  created_at: Date;
  producer_name: string;
};

/** A note's position is read against the job's newest cut. */
export type NotePlaces = {
  cutNumber: number | null;
  positions: Map<number, { position: number; timecode: string }>;
};

export async function readNotePlaces(job: JobRow): Promise<NotePlaces> {
  const cut = await newestCut(job.id);
  if (!cut) return { cutNumber: null, positions: new Map() };
  const frames = await readCutFrames(cut.id);
  const positions = new Map<number, { position: number; timecode: string }>();
  let running = 0;
  for (const frame of frames) {
    positions.set(frame.number, {
      position: frame.position,
      timecode: timecode(running, cut.frame_rate),
    });
    running += frame.duration_frames;
  }
  return { cutNumber: cut.number, positions };
}

export function noteJson(job: JobRow, note: NoteRow, places: NotePlaces): Record<string, unknown> {
  const place = places.positions.get(note.frame);
  const seconds = note.suggested_seconds;
  const value = seconds === null ? null : parseDecimal(seconds, '.');
  return {
    id: note.id,
    frame: note.frame,
    position: place?.position ?? null,
    goneText:
      place === undefined && places.cutNumber !== null ? say.frameGone(places.cutNumber) : null,
    timecode: place?.timecode ?? null,
    x: Number(note.x),
    y: Number(note.y),
    producerId: note.producer_id,
    producerName: note.producer_name,
    typedName: note.typed_name,
    state: note.state,
    text: note.text,
    suggestedSeconds: seconds,
    suggestedFrames: value === null ? null : framesFromSeconds(value, job.frame_rate),
    attachmentUrl: note.attachment_id === null ? null : `/api/notes/${note.id}/attachment`,
    createdAt: toInstantText(note.created_at),
  };
}

export async function readNotes(jobId: string): Promise<NoteRow[]> {
  return query<NoteRow>(
    `select n.*, p.name as producer_name from notes n join producers p on p.id = n.producer_id
      where n.job_id = $1 order by n.created_at asc, n.id asc`,
    [jobId],
  );
}

async function noteOf(deskId: string, noteId: string): Promise<{ note: NoteRow; job: JobRow }> {
  const note = await one<NoteRow>(
    `select n.*, pr.name as producer_name from notes n
       join jobs j on j.id = n.job_id
       join clients c on c.id = j.client_id
       join producers pr on pr.id = n.producer_id
      where n.id = $1 and j.desk_id = $2 and c.state <> 'erased'`,
    [noteId, deskId],
  );
  if (!note) throw refuse.notFound();
  return { note, job: await requireJob(deskId, note.job_id) };
}

function announcementFor(state: string): string {
  switch (state) {
    case 'done':
      return COPY.noteDone;
    case 'wontDo':
      return COPY.noteWontDo;
    default:
      return COPY.noteReopened;
  }
}

export const noteRoutes: RouteSpec[] = [
  {
    method: 'GET',
    pattern: '/api/jobs/:id/notes',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const wantedState = context.query.get('state');
      const wantedProducer = context.query.get('producer');
      const places = await readNotePlaces(job);
      const notes = (await readNotes(job.id)).filter(
        (note) =>
          (wantedState === null || note.state === wantedState) &&
          (wantedProducer === null || note.producer_id === wantedProducer),
      );
      return {
        status: 200,
        body: {
          notes: notes.map((note) => noteJson(job, note, places)),
          total: notes.length,
        },
      };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/notes/:id',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { note, job } = await noteOf(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const state = fields.choice(body, 'state', NOTE_STATES);
      fields.done();
      requireWritableJob(job);
      await query('update notes set state = $1 where id = $2', [state, note.id]);
      await addEvent(job.id, desk.name, 'noteMarked', announcementFor(state));
      const saved = await noteOf(desk.id, note.id);
      return {
        status: 200,
        body: noteJson(job, saved.note, await readNotePlaces(job)),
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/jobs/:id/notes/mark',
    body: 'json',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const job = await requireJob(desk.id, requireUuidParam(context.params['id'] ?? ''));
      const body = await readJsonBody(context);
      const fields = new FieldCollector();
      const state = fields.choice(body, 'state', NOTE_STATES);
      const asked = body['noteIds'];
      if (!Array.isArray(asked) || asked.some((id) => typeof id !== 'string')) {
        fields.problem('noteIds', 'Pick at least one note.');
      }
      fields.done();
      requireWritableJob(job);
      const noteIds = asked as string[];
      const held = await query<{ id: string }>(
        'select id from notes where job_id = $1 and id = any($2::uuid[])',
        [job.id, noteIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id))],
      );
      if (held.length !== noteIds.length) throw refuse.notFound();
      await query('update notes set state = $1 where id = any($2::uuid[])', [state, noteIds]);
      await addEvent(job.id, desk.name, 'notesMarked', say.notesMarkedDone(noteIds.length));
      const places = await readNotePlaces(job);
      const notes = (await readNotes(job.id)).filter((note) => noteIds.includes(note.id));
      return { status: 200, body: { notes: notes.map((note) => noteJson(job, note, places)) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/notes/:id/attachment',
    handler: async (context) => {
      const { desk } = requireIdentity(context);
      const { note, job } = await noteOf(desk.id, requireUuidParam(context.params['id'] ?? ''));
      if (note.attachment_id === null) throw refuse.notFound();
      const attachment = await one<{ content_type: string }>(
        'select content_type from attachments where id = $1',
        [note.attachment_id],
      );
      if (!attachment) throw refuse.notFound();
      const bytes = await readStored(
        storeKeys.attachment(job.client_id, job.id, note.attachment_id),
      );
      return { status: 200, bytes, contentType: attachment.content_type };
    },
  },
];
