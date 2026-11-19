import { one, query } from '../db/pool';
import { copy, passportCopy } from '../domain/copy';
import { type Language, isLanguage } from '../domain/numbers';
import { LISBON, iso, localDate, shownDateOfLocalDate } from '../domain/time';
import { newId } from '../ids';
import { problem } from '../http/problem';
import type { Ctx, Reply } from '../http/router';
import { findStyle, latestResult, measuresOf, passportListShape, readScore, scoreShown } from '../store/read';
import { labelOfStyle } from './labels';
import type { PassportRow, PassportSnapshot } from '../store/rows';

export async function publishPassport(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  if (style.state === 'archived') throw problem.conflict(copy.styleArchived);

  const result = await latestResult(style.id);
  const score = await readScore(style.id);
  if (!result || !score || score.state !== 'current' || score.score === null || score.per100g === null) {
    throw problem.conflict(copy.publishWithoutScore);
  }

  const held = await one<{ gtin: string; style_id: string; withdrawn: boolean }>(
    'select * from published_gtins where gtin = $1',
    [style.gtin],
  );
  if (held && held.style_id !== style.id) throw problem.gtinTaken();
  if (held && held.withdrawn) throw problem.conflict(copy.gtinTaken);

  const editions = await query<{ edition: number; state: string }>(
    'select edition, state from passports where gtin = $1 order by edition',
    [style.gtin],
  );
  if (editions.some((edition) => edition.state === 'withdrawn')) throw problem.conflict(copy.gtinTaken);
  const next = editions.length + 1;

  const snapshot: PassportSnapshot = {
    styleName: style.name,
    labelName: label.name,
    garment: style.garment,
    factorEdition: result.edition,
    dataQualityPercent: result.data_quality_percent,
    dataQualityGrade: result.data_quality_grade,
    score: score.score,
    per100g: score.per100g,
    scoreShown: scoreShown(score.score, score.per100g),
    measures: measuresOf(result).map((measure) => ({
      measure: measure.measure,
      totalShown: measure.totalShown,
    })),
  };

  const id = newId();
  await query(
    `insert into passports (id, style_id, label_id, gtin, edition, state, published_at, corrected_on, snapshot)
     values ($1,$2,$3,$4,$5,'published',$6,$7,$8)`,
    [
      id,
      style.id,
      label.id,
      style.gtin,
      next,
      ctx.now,
      next === 1 ? null : localDate(ctx.now, LISBON),
      JSON.stringify(snapshot),
    ],
  );
  await query(
    `insert into published_gtins (gtin, style_id) values ($1,$2)
     on conflict (gtin) do update set style_id = excluded.style_id`,
    [style.gtin, style.id],
  );
  await query(`update styles set state = 'published' where id = $1`, [style.id]);

  return {
    status: 201,
    json: {
      gtin: style.gtin,
      edition: next,
      state: 'published',
      publishedAt: iso(ctx.now),
      address: `/p/${style.gtin}`,
    },
  };
}

export async function withdrawPassport(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const style = await findStyle(desk.id, ctx.params.id as string);
  const label = await labelOfStyle(style);
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  const editions = await query<PassportRow>('select * from passports where style_id = $1', [style.id]);
  if (editions.length === 0 || editions.every((edition) => edition.state === 'withdrawn')) {
    throw problem.conflict('There is no published passport to withdraw.');
  }
  await query(`update passports set state = 'withdrawn' where style_id = $1`, [style.id]);
  await query('update published_gtins set withdrawn = true where gtin = $1', [style.gtin]);
  await query(`update styles set state = 'worked' where id = $1 and state = 'published'`, [style.id]);
  return { status: 200, json: { gtin: style.gtin, state: 'withdrawn' } };
}

export async function listPassports(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const rows = await query<PassportRow & { style_name: string }>(
    `select p.*, s.name as style_name from passports p join styles s on s.id = p.style_id
     join labels l on l.id = p.label_id
     where s.assessor_id = $1 and l.state <> 'erased' order by s.name, p.edition`,
    [desk.id],
  );
  return { status: 200, json: { passports: rows.map((row) => passportListShape(row, row.style_name)) } };
}

export interface PublicPassport {
  gtin: string;
  edition: number;
  lang: Language;
  styleName: string;
  labelName: string;
  garment: string;
  publishedAt: string;
  correctedOn: string | null;
  factorEdition: string;
  dataQualityPercent: number;
  dataQualityGrade: string;
  scoreShown: string;
  measures: { measure: string; totalShown: string }[];
}

export function publicPassportJson(row: PassportRow, lang: Language): PublicPassport {
  const snapshot = row.snapshot;
  return {
    gtin: row.gtin,
    edition: row.edition,
    lang,
    styleName: snapshot.styleName,
    labelName: snapshot.labelName,
    garment: snapshot.garment,
    publishedAt: iso(Number(row.published_at)),
    correctedOn: row.corrected_on === null ? null : shownDateOfLocalDate(row.corrected_on),
    factorEdition: snapshot.factorEdition,
    dataQualityPercent: snapshot.dataQualityPercent,
    dataQualityGrade: snapshot.dataQualityGrade,
    scoreShown: snapshot.scoreShown,
    measures: snapshot.measures,
  };
}

export function readLanguage(value: string | null): Language {
  return isLanguage(value) ? value : 'en';
}

/** A published edition never changes, and a withdrawn passport answers 410. */
export async function findPublicPassport(gtin: string, edition: number | null): Promise<PassportRow> {
  const rows = await query<PassportRow>('select * from passports where gtin = $1 order by edition', [gtin]);
  if (rows.length === 0) {
    const held = await one<{ withdrawn: boolean }>('select withdrawn from published_gtins where gtin = $1', [
      gtin,
    ]);
    if (held && held.withdrawn) throw problem.withdrawn(passportCopy.withdrawn.en);
    throw problem.notFound();
  }
  const found = edition === null ? (rows[rows.length - 1] as PassportRow) : rows.find((row) => row.edition === edition);
  if (!found) throw problem.notFound();
  if (found.state === 'withdrawn') throw problem.withdrawn(passportCopy.withdrawn.en);
  return found;
}

export async function readPublicPassport(ctx: Ctx): Promise<Reply> {
  const lang = readLanguage(ctx.query.get('lang'));
  const row = await findPublicPassport(ctx.params.gtin as string, null);
  return { status: 200, json: publicPassportJson(row, lang) };
}

export async function readPublicPassportEdition(ctx: Ctx): Promise<Reply> {
  const lang = readLanguage(ctx.query.get('lang'));
  const number = Number(ctx.params.n);
  if (!Number.isInteger(number) || number < 1) throw problem.notFound();
  const row = await findPublicPassport(ctx.params.gtin as string, number);
  return { status: 200, json: publicPassportJson(row, lang) };
}
