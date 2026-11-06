import { creditLine } from '../../domain/essayFields.js';
import type { EssayState } from '../../domain/lifecycle.js';
import { displayCoopTime, isoInstant, type LiftResolution } from '../../domain/time.js';
import { queryOn, type Queryable } from '../db/pool.js';
import { notFound, takenDown } from '../http/errors.js';
import type { SignedInPerson } from '../http/router.js';
import { essayWindow, type WindowView } from './licences.js';

export interface EssayRow {
  id: string;
  title: string;
  caption: string;
  lift_local: string;
  lift_at: Date;
  lift_resolution: LiftResolution;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  state: EssayState;
  version: number;
  withdrawal_requested: boolean;
  submitted_at: Date | null;
}

export interface CreditRow {
  contributor_handle: string;
  position: number;
  split_bp: number;
  name: string;
}

export interface FrameRow {
  id: string;
  essay_id: string;
  position: number;
  caption: string;
  filename: string;
  bytes: number;
  content_type: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

const ESSAY_COLUMNS = `id, title, caption, lift_local, lift_at, lift_resolution, exclusive_days,
  standard_days, exclusive_price_minor, standard_price_minor, state, version, withdrawal_requested, submitted_at`;

export async function loadEssay(client: Queryable, id: string): Promise<EssayRow | null> {
  const result = await queryOn<EssayRow>(client, `select ${ESSAY_COLUMNS} from essays where id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function loadEssayForUpdate(client: Queryable, id: string): Promise<EssayRow | null> {
  const result = await queryOn<EssayRow>(
    client,
    `select ${ESSAY_COLUMNS} from essays where id = $1 for update`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function loadCredits(client: Queryable, essayId: string): Promise<CreditRow[]> {
  const result = await queryOn<CreditRow>(
    client,
    `select c.contributor_handle, c.position, c.split_bp, p.name
     from essay_credits c join people p on p.contributor_handle = c.contributor_handle
     where c.essay_id = $1 order by c.position`,
    [essayId],
  );
  return result.rows;
}

export async function loadFrames(client: Queryable, essayId: string): Promise<FrameRow[]> {
  const result = await queryOn<FrameRow>(
    client,
    `select id, essay_id, position, caption, filename, bytes, content_type, width, height
     from frames where essay_id = $1 order by position`,
    [essayId],
  );
  return result.rows;
}

export async function loadFrame(client: Queryable, frameId: string): Promise<FrameRow | null> {
  const result = await queryOn<FrameRow>(
    client,
    `select id, essay_id, position, caption, filename, bytes, content_type, width, height
     from frames where id = $1`,
    [frameId],
  );
  return result.rows[0] ?? null;
}

export async function loadDeskNotes(
  client: Queryable,
  essayId: string,
): Promise<Array<{ note: string; at: Date }>> {
  const result = await queryOn<{ note: string; at: Date }>(
    client,
    'select note, at from desk_notes where essay_id = $1 order by at',
    [essayId],
  );
  return result.rows;
}

export function essayCreditLine(credits: CreditRow[]): string {
  return creditLine(credits.map((credit) => credit.name));
}

export async function bumpEssayVersion(client: Queryable, essayId: string): Promise<number> {
  const result = await queryOn<{ version: number }>(
    client,
    'update essays set version = version + 1 where id = $1 returning version',
    [essayId],
  );
  const row = result.rows[0];
  if (!row) throw notFound();
  return row.version;
}

export async function isCredited(client: Queryable, essayId: string, handle: string | null): Promise<boolean> {
  if (!handle) return false;
  const result = await queryOn<{ one: number }>(
    client,
    'select 1 as one from essay_credits where essay_id = $1 and contributor_handle = $2',
    [essayId, handle],
  );
  return result.rows.length > 0;
}

async function newsroomHasLicence(client: Queryable, essayId: string, newsroomSlug: string): Promise<boolean> {
  const result = await queryOn<{ one: number }>(
    client,
    'select 1 as one from licences where essay_id = $1 and newsroom_slug = $2 limit 1',
    [essayId, newsroomSlug],
  );
  return result.rows.length > 0;
}

/** Essay visibility: 404 for what the caller cannot see, 410 for a taken-down essay. */
export async function requireVisibleEssay(
  client: Queryable,
  id: string,
  person: SignedInPerson,
): Promise<EssayRow> {
  const essay = await loadEssay(client, id);
  if (!essay) throw notFound();
  if (person.role === 'desk_editor') return essay;
  if (essay.state === 'taken_down') throw takenDown();
  if (await isCredited(client, id, person.contributorHandle)) return essay;
  if (essay.state === 'embargoed' || essay.state === 'live') return essay;
  if (
    essay.state === 'withdrawn' &&
    person.newsroomSlug &&
    (await newsroomHasLicence(client, id, person.newsroomSlug))
  ) {
    return essay;
  }
  throw notFound();
}

export interface EssayViewOptions {
  newsroomView: boolean;
}

export interface EssayView {
  id: string;
  version: number;
  title: string;
  caption: string;
  credit_line: string;
  credits: Array<{ handle: string; name: string; position: number; split_bp?: number }>;
  state: EssayState;
  lift_local: string;
  lift_at: string;
  lift_display: string;
  lift_resolution: LiftResolution;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  frames: Array<{
    id: string;
    position: number;
    caption: string;
    grid_url: string;
    story_url?: string;
    preview_url: string;
  }>;
  desk_notes?: Array<{ note: string; at: string; at_display: string }>;
  withdrawal_requested?: boolean;
  window: WindowView;
}

export async function essayView(
  client: Queryable,
  essay: EssayRow,
  person: SignedInPerson,
  now: Date,
  options: EssayViewOptions,
): Promise<EssayView> {
  const credits = await loadCredits(client, essay.id);
  const frames = essay.state === 'taken_down' ? [] : await loadFrames(client, essay.id);
  const window = await essayWindow(client, essay, person, now);
  const view: EssayView = {
    id: essay.id,
    version: essay.version,
    title: essay.title,
    caption: essay.caption,
    credit_line: essayCreditLine(credits),
    credits: credits.map((credit) => ({
      handle: credit.contributor_handle,
      name: credit.name,
      position: credit.position,
      ...(options.newsroomView ? {} : { split_bp: credit.split_bp }),
    })),
    state: essay.state,
    lift_local: essay.lift_local,
    lift_at: isoInstant(essay.lift_at),
    lift_display: displayCoopTime(essay.lift_at),
    lift_resolution: essay.lift_resolution,
    exclusive_days: essay.exclusive_days,
    standard_days: essay.standard_days,
    exclusive_price_minor: essay.exclusive_price_minor,
    standard_price_minor: essay.standard_price_minor,
    frames: frames.map((frame) => ({
      id: frame.id,
      position: frame.position,
      caption: frame.caption,
      grid_url: `/media/frames/${frame.id}/grid`,
      ...(options.newsroomView ? {} : { story_url: `/media/frames/${frame.id}/story` }),
      preview_url: `/media/frames/${frame.id}/preview`,
    })),
    window,
  };
  if (!options.newsroomView) {
    const notes = await loadDeskNotes(client, essay.id);
    view.desk_notes = notes.map((note) => ({
      note: note.note,
      at: isoInstant(note.at),
      at_display: displayCoopTime(note.at),
    }));
    view.withdrawal_requested = essay.withdrawal_requested;
  }
  return view;
}

export function usesNewsroomView(person: SignedInPerson): boolean {
  return person.role === 'picture_editor' || person.role === 'licensing_manager';
}

export interface FeedEssay {
  id: string;
  title: string;
  credit_line: string;
  state: EssayState;
  lift_at: string;
  lift_display: string;
  frame_count: number;
  cover_url: string | null;
  window: WindowView;
}

/** The contact sheet: embargoed and live essays only, latest lift first. */
export async function feedEssays(
  client: Queryable,
  person: SignedInPerson,
  search: string,
  now: Date,
): Promise<FeedEssay[]> {
  const pattern = `%${search.toLowerCase()}%`;
  const result = await queryOn<EssayRow>(
    client,
    `select ${ESSAY_COLUMNS} from essays e
     where e.state in ('embargoed', 'live')
       and ($1 = ''
         or lower(e.title) like $2
         or lower(e.caption) like $2
         or exists (select 1 from frames f where f.essay_id = e.id and lower(f.caption) like $2)
         or exists (select 1 from essay_credits c join people p on p.contributor_handle = c.contributor_handle
                    where c.essay_id = e.id and lower(p.name) like $2))
     order by e.lift_at desc, e.id`,
    [search, pattern],
  );
  const essays: FeedEssay[] = [];
  for (const essay of result.rows) {
    const credits = await loadCredits(client, essay.id);
    const frames = await loadFrames(client, essay.id);
    essays.push({
      id: essay.id,
      title: essay.title,
      credit_line: essayCreditLine(credits),
      state: essay.state,
      lift_at: isoInstant(essay.lift_at),
      lift_display: displayCoopTime(essay.lift_at),
      frame_count: frames.length,
      cover_url: frames[0] ? `/media/frames/${frames[0].id}/grid` : null,
      window: await essayWindow(client, essay, person, now),
    });
  }
  return essays;
}

export async function essaysByState(
  client: Queryable,
  states: EssayState[],
  order: 'submitted' | 'created',
): Promise<EssayRow[]> {
  const result = await queryOn<EssayRow>(
    client,
    `select ${ESSAY_COLUMNS} from essays
     where state = any($1::text[])
     order by ${order === 'submitted' ? 'submitted_at nulls last, id' : 'created_at, id'}`,
    [states],
  );
  return result.rows;
}

export async function essaysCrediting(client: Queryable, handle: string): Promise<EssayRow[]> {
  const result = await queryOn<EssayRow>(
    client,
    `select ${ESSAY_COLUMNS} from essays e
     where exists (select 1 from essay_credits c where c.essay_id = e.id and c.contributor_handle = $1)
     order by e.created_at desc, e.id`,
    [handle],
  );
  return result.rows;
}

export async function allEssays(client: Queryable): Promise<EssayRow[]> {
  const result = await queryOn<EssayRow>(
    client,
    `select ${ESSAY_COLUMNS} from essays order by created_at desc, id`,
  );
  return result.rows;
}

export async function withdrawalRequests(client: Queryable): Promise<EssayRow[]> {
  const result = await queryOn<EssayRow>(
    client,
    `select ${ESSAY_COLUMNS} from essays
     where withdrawal_requested and state in ('embargoed', 'live') order by id`,
  );
  return result.rows;
}
