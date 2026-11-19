import { config } from '../config';
import { one, query } from '../db/pool';
import { copy } from '../domain/copy';
import { LISBON, iso, localTime, shownDate } from '../domain/time';
import { newId, newToken, nextSortIndex } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Reply } from '../http/router';
import { FieldCollector } from '../store/fields';
import { queueSignOffMail } from '../store/mailOut';
import { endPage, readEndedPage } from '../store/endedPages';
import { recordRateEvent } from '../store/rate';
import {
  dossierShape,
  findStyle,
  latestResult,
  measuresOf,
  supplierNames,
} from '../store/read';
import { labelOfStyle } from './labels';
import { FileStoreDown, files } from '../services/files';
import { DossierServiceDown, renderPdf } from '../services/pdf';
import { dossierHtmlFor } from './dossierHtml';
import type { DossierRow, LabelRow, ResultRow, StyleRowRecord } from '../store/rows';

export async function makeDossier(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  if (style.state === 'archived') throw problem.conflict(copy.styleArchived);
  const result = await latestResult(style.id);
  if (!result) throw problem.conflict(copy.dossierWithoutResult);

  let pdf: Buffer;
  try {
    pdf = await renderPdf(dossierHtmlFor(style, label, result));
  } catch (thrown) {
    if (thrown instanceof DossierServiceDown) throw problem.dossierServiceUnavailable();
    throw thrown;
  }

  const id = newId();
  const key = `dossiers/${desk.id}/${id}.pdf`;
  try {
    await files.put(key, pdf, 'application/pdf');
  } catch (thrown) {
    if (thrown instanceof FileStoreDown) throw problem.fileStoreUnavailable();
    throw thrown;
  }

  await query(`update dossiers set state = 'replaced' where style_id = $1 and state <> 'replaced'`, [style.id]);
  await query(
    `insert into dossiers (id, style_id, label_id, result_id, edition, state, made_at, object_key, sort_index)
     values ($1,$2,$3,$4,$5,'ready',$6,$7,$8)`,
    [id, style.id, label.id, result.id, result.edition, ctx.now, key, nextSortIndex()],
  );
  const made = await one<DossierRow>('select * from dossiers where id = $1', [id]);
  return { status: 201, json: dossierShape(made as DossierRow) };
}

export async function listDossiers(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const rows = await query<DossierRow>('select * from dossiers where style_id = $1 order by sort_index desc', [
    style.id,
  ]);
  return { status: 200, json: { dossiers: rows.map(dossierShape) } };
}

async function findDossier(deskId: string, dossierId: string): Promise<DossierRow> {
  const row = await one<DossierRow>(
    `select d.* from dossiers d join styles s on s.id = d.style_id join labels l on l.id = d.label_id
     where d.id = $1 and s.assessor_id = $2 and l.state <> 'erased'`,
    [dossierId, deskId],
  );
  if (!row) throw problem.notFound();
  return row;
}

export async function readDossier(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  return { status: 200, json: dossierShape(await findDossier(desk.id, ctx.params.id as string)) };
}

export async function downloadDossier(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const dossier = await findDossier(desk.id, ctx.params.id as string);
  if (dossier.object_key === null) throw problem.fileStoreUnavailable();
  let bytes: Buffer;
  try {
    bytes = await files.get(dossier.object_key);
  } catch {
    throw problem.fileStoreUnavailable();
  }
  await recordRateEvent('file', desk.id, ctx.now);
  return {
    status: 200,
    bytes,
    contentType: 'application/pdf',
    headers: { 'Content-Disposition': `attachment; filename="dossier-${dossier.id}.pdf"` },
  };
}

export async function sendSignOffPage(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const dossier = await findDossier(desk.id, ctx.params.id as string);
  if (dossier.state === 'replaced') {
    const newer = await one<{ made_at: string }>(
      'select made_at from dossiers where style_id = $1 order by sort_index desc limit 1',
      [dossier.style_id],
    );
    throw problem.newerDossier(copy.newerDossier(localTime(Number(newer?.made_at ?? ctx.now), LISBON)));
  }
  const style = await findStyle(desk.id, dossier.style_id);
  const label = await labelOfStyle(style);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);

  const token = newToken();
  const endsAt = ctx.now + config.signOffPageSeconds;
  if (dossier.token !== null) await endPage(dossier.token, 'signOff', 'en', ctx.now);
  await query('update dossiers set token = $1, token_ends_at = $2, token_ended = false where id = $3', [
    token,
    endsAt,
    dossier.id,
  ]);
  await queueSignOffMail({
    labelId: label.id,
    contactName: label.contact_name ?? '',
    contactEmail: label.contact_email ?? '',
    styleName: style.name,
    token,
    endsAt,
    sendAfter: ctx.now,
  });
  return { status: 201, json: { signOffAddress: `${config.publicUrl}/s/${token}`, endsAt: iso(endsAt) } };
}

export interface SignOffPage {
  dossier: DossierRow;
  style: StyleRowRecord;
  result: ResultRow;
  label: LabelRow;
}

export async function findSignOffPage(token: string, now: number): Promise<SignOffPage> {
  const dossier = await one<DossierRow>('select * from dossiers where token = $1', [token]);
  if (!dossier) {
    const ended = await readEndedPage(token);
    if (ended) throw problem.pageEnded('This page has ended.');
    throw problem.notFound();
  }
  const label = await one<LabelRow>('select * from labels where id = $1', [dossier.label_id]);
  if (!label || label.state === 'erased') throw problem.notFound();
  const style = await one<StyleRowRecord>('select * from styles where id = $1', [dossier.style_id]);
  const result = await one<ResultRow>('select * from results where id = $1', [dossier.result_id]);
  if (!style || !result) throw problem.notFound();
  if (
    dossier.token_ended ||
    dossier.token_ends_at === null ||
    now >= Number(dossier.token_ends_at) ||
    label.state !== 'open'
  ) {
    throw problem.pageEnded('This page has ended.');
  }
  return { dossier, style, result, label };
}

function signOffJson(page: SignOffPage): Record<string, unknown> {
  const { dossier, style, result } = page;
  return {
    dossier: {
      id: dossier.id,
      state: dossier.state,
      styleName: style.name,
      edition: dossier.edition,
      dataQualityPercent: result.data_quality_percent,
      dataQualityGrade: result.data_quality_grade,
      measures: measuresOf(result),
      madeAt: iso(Number(dossier.made_at)),
      signedOffBy: dossier.signed_off_by,
      signedOffAt: dossier.signed_off_at === null ? null : iso(Number(dossier.signed_off_at)),
    },
    endsAt: iso(Number(dossier.token_ends_at)),
  };
}

export async function readSignOffPage(ctx: Ctx): Promise<Reply> {
  const page = await findSignOffPage(ctx.params.token as string, ctx.now);
  return { status: 200, json: signOffJson(page) };
}

export async function downloadSignOffFile(ctx: Ctx): Promise<Reply> {
  const page = await findSignOffPage(ctx.params.token as string, ctx.now);
  if (page.dossier.object_key === null) throw problem.fileStoreUnavailable();
  let bytes: Buffer;
  try {
    bytes = await files.get(page.dossier.object_key);
  } catch {
    throw problem.fileStoreUnavailable();
  }
  return {
    status: 200,
    bytes,
    contentType: 'application/pdf',
    headers: { 'Content-Disposition': `attachment; filename="dossier-${page.dossier.id}.pdf"` },
  };
}

export async function signDossier(ctx: Ctx): Promise<Reply> {
  const page = await findSignOffPage(ctx.params.token as string, ctx.now);
  const body = ctx.json();
  const problems = new FieldCollector();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name === '') problems.add('name', copy.signOffNameEmpty);
  problems.throwIfAny();

  if (page.dossier.state === 'replaced') {
    const newer = await one<{ made_at: string }>(
      'select made_at from dossiers where style_id = $1 order by sort_index desc limit 1',
      [page.dossier.style_id],
    );
    throw problem.newerDossier(copy.newerDossier(localTime(Number(newer?.made_at ?? ctx.now), LISBON)));
  }
  if (page.dossier.state === 'signedOff') throw problem.conflict(copy.alreadySigned);

  await query(`update dossiers set state = 'signedOff', signed_off_by = $1, signed_off_at = $2 where id = $3`, [
    name,
    ctx.now,
    page.dossier.id,
  ]);
  const after = await one<DossierRow>('select * from dossiers where id = $1', [page.dossier.id]);
  return { status: 200, json: dossierShape(after as DossierRow) };
}

const RISKY = ['=', '+', '-', '@', '\t', '\r'];

function csvCell(value: string): string {
  const guarded = RISKY.includes(value.slice(0, 1)) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

const RESULTS_COLUMNS = [
  'style',
  'gtin',
  'label',
  'suppliers',
  'notes',
  'edition',
  'workedOutAt',
  'climate',
  'water',
  'fossilEnergy',
  'landUse',
  'freshwaterToxicity',
  'microfibres',
  'dataQualityPercent',
  'dataQualityGrade',
];

/** The results file: UTF-8, every field quoted, CRLF after every row. */
export async function downloadResultsFile(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  const results = await query<ResultRow>('select * from results where style_id = $1 order by sort_index desc', [
    style.id,
  ]);
  const suppliers = (await supplierNames(style.id)).join('; ');

  const lines = [RESULTS_COLUMNS.map(csvCell).join(',')];
  for (const result of results) {
    const measures = measuresOf(result);
    const shown = (measure: string): string =>
      measures.find((entry) => entry.measure === measure)?.totalShown ?? '';
    lines.push(
      [
        style.name,
        style.gtin,
        label.name,
        suppliers,
        style.notes ?? '',
        result.edition,
        iso(Number(result.worked_out_at)),
        shown('climate'),
        shown('water'),
        shown('fossilEnergy'),
        shown('landUse'),
        shown('freshwaterToxicity'),
        shown('microfibres'),
        String(result.data_quality_percent),
        result.data_quality_grade,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await recordRateEvent('file', desk.id, ctx.now);
  return {
    status: 200,
    bytes: Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    headers: { 'Content-Disposition': `attachment; filename="results-${style.id}.csv"` },
  };
}

export function dossierStateName(dossier: DossierRow): string {
  if (dossier.state === 'making') return 'Making';
  if (dossier.state === 'ready') return 'Ready';
  if (dossier.state === 'replaced') return 'Replaced';
  return `Signed off by ${dossier.signed_off_by ?? ''} on ${shownDate(Number(dossier.signed_off_at ?? dossier.made_at), LISBON)}`;
}
