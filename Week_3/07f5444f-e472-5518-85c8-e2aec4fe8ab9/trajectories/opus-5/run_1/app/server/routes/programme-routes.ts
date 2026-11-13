import type { CatalogueWork, Notice, ProgrammeStatus, StringCount } from '../../shared/api.js';
import { isoWithLondonOffset } from '../../shared/london.js';
import {
  loadProgrammeAggregate,
  loadProgrammeAggregates,
  loadSectionRosterSizes,
  stringCountOf,
} from '../data/programmes.js';
import type { Queryable } from '../db/pool.js';
import { pool, withTransaction } from '../db/pool.js';
import { roundToSeconds } from '../domain/running-time.js';
import { fullMs } from '../domain/running-time.js';
import { SECTION_KEYS, stringSectionByCountKey } from '../domain/sections.js';
import {
  PROGRAMME_TRANSITION_TARGETS,
  isLegalProgrammeEdge,
  programmeAcceptsWorks,
} from '../domain/transitions.js';
import { readSingleLineText } from '../domain/text.js';
import { publishBlockers } from '../domain/publish.js';
import {
  illegalProgrammeTransition,
  programmeNumber,
  requireIdempotencyKey,
  requireNotClosed,
  requireRole,
  viewContext,
  visibleProgramme,
} from '../http/access.js';
import { DESK_ROLES, LIBRARIANS, signedInPerson } from '../http/context.js';
import type { RequestContext } from '../http/context.js';
import { conflict, notFound, validation } from '../http/errors.js';
import { sendJson } from '../http/http-io.js';
import { bodyObject, isArray, isInteger, isObject, isString, readInstant } from '../http/validate.js';
import { noticeCounts, noticeSeatedPlayers } from '../services/notices.js';
import { runIdempotent } from '../services/idempotency.js';
import { programmeDetailView, programmeSummaryView, workDetailView } from '../view/programme-view.js';

const PRINCIPAL = ['principal_librarian'] as const;

export async function listCatalogue(context: RequestContext): Promise<void> {
  requireRole(signedInPerson(context), DESK_ROLES);
  const works = await pool.query<{ id: string; title: string; composer: string; bars: number }>(
    `SELECT id, title, composer, bars FROM catalogue_works ORDER BY ord`,
  );
  const spans = await pool.query<{ catalogue_work_id: string; from_bar: number; to_bar: number; bar_ms: number }>(
    `SELECT catalogue_work_id, from_bar, to_bar, bar_ms FROM catalogue_bar_spans ORDER BY from_bar`,
  );
  const parts = await pool.query<{
    catalogue_work_id: string;
    name: string;
    chair_key: string;
    bars_from: number;
    bars_to: number;
  }>(`SELECT catalogue_work_id, name, chair_key, bars_from, bars_to FROM catalogue_parts ORDER BY ord`);

  const body: { works: CatalogueWork[] } = {
    works: works.rows.map((work) => ({
      id: work.id,
      title: work.title,
      composer: work.composer,
      bars: work.bars,
      running_time_seconds: roundToSeconds(
        fullMs(spans.rows.filter((span) => span.catalogue_work_id === work.id)),
      ),
      parts: parts.rows
        .filter((part) => part.catalogue_work_id === work.id)
        .map((part) => ({
          name: part.name,
          chair_key: part.chair_key,
          bars_from: part.bars_from,
          bars_to: part.bars_to,
        })),
    })),
  };
  sendJson(context.response, 200, body);
}

export async function listProgrammes(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  requireRole(person, DESK_ROLES);
  const aggregates = await loadProgrammeAggregates(pool, null);
  const view = await viewContext(pool, context);
  sendJson(context.response, 200, {
    programmes: aggregates.map((aggregate) => programmeSummaryView(aggregate, view)),
  });
}

export async function readProgramme(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await visibleProgramme(pool, person, context.params.id ?? '');
  requireRole(person, DESK_ROLES);
  sendJson(context.response, 200, programmeDetailView(aggregate, await viewContext(pool, context)));
}

async function readStringCount(
  db: Queryable,
  raw: unknown,
  prefix: string,
  errors: Record<string, string>,
): Promise<StringCount | null> {
  const rosters = await loadSectionRosterSizes(db);
  if (!isObject(raw)) {
    for (const key of SECTION_KEYS) {
      const section = stringSectionByCountKey(key);
      errors[`${prefix}${key}`] = `Enter a whole number from 0 to ${rosters.get(section.chairKey) ?? 0}.`;
    }
    return null;
  }
  const values: Partial<Record<keyof StringCount, number>> = {};
  for (const key of SECTION_KEYS) {
    const section = stringSectionByCountKey(key);
    const roster = rosters.get(section.chairKey) ?? 0;
    const value = raw[key];
    if (isInteger(value) && value > roster) {
      errors[`${prefix}${key}`] = `The roster has ${roster} players in ${section.name}.`;
      continue;
    }
    if (!isInteger(value) || value < 0) {
      errors[`${prefix}${key}`] = `Enter a whole number from 0 to ${roster}.`;
      continue;
    }
    values[key] = value;
  }
  if (Object.keys(errors).length > 0) return null;
  return {
    violin_1: values.violin_1 ?? 0,
    violin_2: values.violin_2 ?? 0,
    viola: values.viola ?? 0,
    cello: values.cello ?? 0,
    bass: values.bass ?? 0,
  };
}

export async function createProgramme(context: RequestContext): Promise<void> {
  requireRole(signedInPerson(context), PRINCIPAL);
  const body = bodyObject(context.jsonBody);
  const errors: Record<string, string> = {};

  const title = readSingleLineText('title', body.title);
  if (title.message !== null) errors.title = title.message;

  const firstRehearsal = readInstant(body.first_rehearsal);
  if (firstRehearsal === null) {
    errors.first_rehearsal = 'Enter a date and time with a time zone offset.';
  }

  const rawPerformances = body.performances;
  let performances: number[] = [];
  if (!isArray(rawPerformances) || rawPerformances.length < 1 || rawPerformances.length > 10) {
    errors.performances = 'Enter 1 to 10 performances.';
  } else {
    const parsed = rawPerformances.map((entry) => readInstant(entry));
    if (parsed.some((instant) => instant === null)) {
      errors.performances = 'Enter each performance as a date and time with a time zone offset.';
    } else {
      performances = parsed.filter((instant): instant is number => instant !== null);
      if (new Set(performances).size !== performances.length) {
        errors.performances = 'Each performance must be at a different time.';
      } else if (firstRehearsal !== null && performances.some((instant) => instant <= firstRehearsal)) {
        errors.performances = 'Each performance must be after the first rehearsal.';
      }
    }
  }

  const stringCount = await readStringCount(pool, body.string_count, 'string_count.', errors);
  if (Object.keys(errors).length > 0 || stringCount === null || firstRehearsal === null) {
    throw validation(errors);
  }

  const created = await withTransaction(async (db) => {
    const next = await db.query<{ number: number }>(
      `SELECT coalesce(max(number), 0) + 1 AS number FROM programmes`,
    );
    const number = next.rows[0]?.number ?? 1;
    const id = `p${String(number).padStart(2, '0')}`;
    await db.query(
      `INSERT INTO programmes (id, number, title, status, first_rehearsal, violin_1, violin_2, viola, cello, bass)
       VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9)`,
      [
        id,
        number,
        title.value,
        new Date(firstRehearsal),
        stringCount.violin_1,
        stringCount.violin_2,
        stringCount.viola,
        stringCount.cello,
        stringCount.bass,
      ],
    );
    for (const instant of performances) {
      await db.query(`INSERT INTO performances (programme_id, at) VALUES ($1, $2)`, [id, new Date(instant)]);
    }
    const aggregate = await loadProgrammeAggregate(db, id);
    if (!aggregate) throw new Error(`created programme ${id} could not be read back`);
    return aggregate;
  });

  sendJson(context.response, 201, programmeDetailView(created, await viewContext(pool, context)));
}

export async function saveStringCount(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await visibleProgramme(pool, person, context.params.id ?? '');
  requireRole(person, PRINCIPAL);
  requireNotClosed(aggregate);

  const body = bodyObject(context.jsonBody);
  const errors: Record<string, string> = {};
  const stringCount = await readStringCount(pool, body, '', errors);
  if (stringCount === null) throw validation(errors);

  const updated = await withTransaction(async (db) => {
    await db.query(
      `UPDATE programmes SET violin_1 = $2, violin_2 = $3, viola = $4, cello = $5, bass = $6 WHERE id = $1`,
      [
        aggregate.row.id,
        stringCount.violin_1,
        stringCount.violin_2,
        stringCount.viola,
        stringCount.cello,
        stringCount.bass,
      ],
    );
    const reloaded = await loadProgrammeAggregate(db, aggregate.row.id);
    if (!reloaded) throw new Error(`programme ${aggregate.row.id} could not be read back`);
    if (reloaded.row.status === 'published' || reloaded.row.status === 'in_performance') {
      await noticeSeatedPlayers(db, reloaded);
    }
    return reloaded;
  });

  sendJson(context.response, 200, programmeDetailView(updated, await viewContext(pool, context)));
}

export async function addWork(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await visibleProgramme(pool, person, context.params.id ?? '');
  requireRole(person, PRINCIPAL);

  const body = bodyObject(context.jsonBody);
  if (!isString(body.catalogue_work_id)) throw validation({ catalogue_work_id: 'Choose a catalogue work.' });
  const catalogueWorkId = body.catalogue_work_id;

  const created = await withTransaction(async (db) => {
    const locked = await db.query<{ status: ProgrammeStatus }>(
      `SELECT status FROM programmes WHERE id = $1 FOR UPDATE`,
      [aggregate.row.id],
    );
    const status = locked.rows[0]?.status;
    if (!status) throw notFound();
    const catalogue = await db.query<{ id: string; title: string; bars: number }>(
      `SELECT id, title, bars FROM catalogue_works WHERE id = $1`,
      [catalogueWorkId],
    );
    const catalogueWork = catalogue.rows[0];
    if (!catalogueWork) throw notFound();
    if (!programmeAcceptsWorks(status)) {
      throw conflict('wrong_status', 'Works can only be added while a programme is in draft or in preparation.');
    }
    const existing = await db.query(
      `SELECT 1 FROM programme_works WHERE programme_id = $1 AND catalogue_work_id = $2`,
      [aggregate.row.id, catalogueWorkId],
    );
    if (existing.rows.length > 0) {
      throw conflict('work_already_in_programme', `${catalogueWork.title} is already in this programme.`);
    }
    const workId = `${aggregate.row.id}-${catalogueWorkId.replace(/^cw-/, '')}`;
    const ord = await db.query<{ next: number }>(
      `SELECT coalesce(max(ord), 0) + 1 AS next FROM programme_works WHERE programme_id = $1`,
      [aggregate.row.id],
    );
    await db.query(
      `INSERT INTO programme_works (id, programme_id, catalogue_work_id, ord) VALUES ($1, $2, $3, $4)`,
      [workId, aggregate.row.id, catalogueWorkId, ord.rows[0]?.next ?? 1],
    );
    await db.query(
      `INSERT INTO parts (id, programme_work_id, chair_key, name, bars_from, bars_to, ord, copies_on_hand)
       SELECT $1 || '-' || cp.chair_key, $1, cp.chair_key, cp.name, cp.bars_from, cp.bars_to, cp.ord, 0
         FROM catalogue_parts cp
        WHERE cp.catalogue_work_id = $2`,
      [workId, catalogueWorkId],
    );
    const reloaded = await loadProgrammeAggregate(db, aggregate.row.id);
    const work = reloaded?.works.find((entry) => entry.row.id === workId);
    if (!reloaded || !work) throw new Error(`work ${workId} could not be read back`);
    return { reloaded, work };
  });

  sendJson(
    context.response,
    201,
    workDetailView(aggregate.row.id, created.work, stringCountOf(created.reloaded.row)),
  );
}

export async function transitionProgramme(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await visibleProgramme(pool, person, context.params.id ?? '');
  requireRole(person, PRINCIPAL);

  const body = bodyObject(context.jsonBody);
  const to = body.to;
  if (!isString(to) || !PROGRAMME_TRANSITION_TARGETS.includes(to as ProgrammeStatus)) {
    throw validation({ to: 'Choose a status this programme can move to.' });
  }
  const target = to as ProgrammeStatus;

  const updated = await withTransaction(async (db) => {
    const locked = await db.query<{ status: ProgrammeStatus }>(
      `SELECT status FROM programmes WHERE id = $1 FOR UPDATE`,
      [aggregate.row.id],
    );
    const current = locked.rows[0]?.status;
    if (!current) throw notFound();
    if (!isLegalProgrammeEdge(current, target)) {
      throw illegalProgrammeTransition(programmeNumber(aggregate), current, target);
    }
    await db.query(`UPDATE programmes SET status = $2 WHERE id = $1`, [aggregate.row.id, target]);
    const reloaded = await loadProgrammeAggregate(db, aggregate.row.id);
    if (!reloaded) throw new Error(`programme ${aggregate.row.id} could not be read back`);
    return reloaded;
  });

  sendJson(context.response, 200, programmeDetailView(updated, await viewContext(pool, context)));
}

export async function publishFolders(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await visibleProgramme(pool, person, context.params.id ?? '');
  requireRole(person, PRINCIPAL);
  const key = requireIdempotencyKey(context);
  const programmeId = aggregate.row.id;

  const stored = await runIdempotent('publish', key, programmeId, async (db) => {
    await db.query(`SELECT 1 FROM programmes WHERE id = $1 FOR UPDATE`, [programmeId]);
    const locked = await loadProgrammeAggregate(db, programmeId);
    if (!locked) throw notFound();
    const view = await viewContext(db, context);
    const summary = programmeSummaryView(locked, view);
    const [blocker] = publishBlockers({
      status: locked.row.status,
      firstRehearsalMs: locked.row.first_rehearsal.getTime(),
      nowMs: Date.now(),
      workCount: locked.works.length,
      shortfall: summary.copies.shortfall,
    });
    if (blocker) {
      throw conflict(
        blocker.error,
        blocker.message,
        blocker.error === 'copies_short' ? { shortfall: summary.copies.shortfall } : {},
      );
    }
    await db.query(`UPDATE programmes SET status = 'published' WHERE id = $1`, [programmeId]);
    const published = await loadProgrammeAggregate(db, programmeId);
    if (!published) throw new Error(`programme ${programmeId} could not be read back`);
    await noticeSeatedPlayers(db, published);
    return {
      status: 200,
      body: {
        programme: programmeDetailView(published, await viewContext(db, context)),
        notices: await noticeCounts(db, programmeId),
      },
    };
  });

  sendJson(context.response, stored.status, stored.body);
}

export async function listNotices(context: RequestContext): Promise<void> {
  const person = signedInPerson(context);
  const aggregate = await visibleProgramme(pool, person, context.params.id ?? '');
  requireRole(person, LIBRARIANS);
  const result = await pool.query<{
    player_id: string;
    name: string;
    email: string;
    chair_label: string;
    status: 'sent' | 'queued';
    sent_at: Date | null;
  }>(
    `SELECT n.player_id, p.name, p.email, n.chair_label, n.status, n.sent_at
       FROM notices n JOIN people p ON p.id = n.player_id
      WHERE n.programme_id = $1
      ORDER BY p.chair_key, p.chair_number`,
    [aggregate.row.id],
  );
  const notices: Notice[] = result.rows.map((row) => ({
    player_id: row.player_id,
    name: row.name,
    email: row.email,
    chair_label: row.chair_label,
    status: row.status,
    sent_at: row.sent_at === null ? null : isoWithLondonOffset(row.sent_at.getTime()),
  }));
  sendJson(context.response, 200, { notices });
}
