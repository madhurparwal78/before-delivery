import { one, query } from './db/pool';
import { announce, copy } from './domain/copy';
import { isCountry, isMaterial, isMeasure, isMode } from './domain/factors';
import { type Language, isLanguage } from './domain/numbers';
import { LISBON, TOWNS, type Town, localDate, localTime } from './domain/time';
import { ApiProblem } from './http/problem';
import type { Ctx, Reply } from './http/router';
import { findAnswerPage } from './api/requests';
import { findSignOffPage } from './api/dossiers';
import { findPublicPassport, publicPassportJson, readLanguage } from './api/passports';
import { labelOfStyle, stylesOfLabel } from './api/labels';
import { type ScenarioFigures, scenarioFigures } from './api/results';
import { styleListPage } from './api/styles';
import { findLabel, findStyle, latestResult, newerFactorsFor, readLegs, readLines } from './store/read';
import { keptInputOf } from './store/read';
import type {
  DossierRow,
  LabelRow,
  PassportRow,
  RequestRow,
  ResultRow,
  StyleRowRecord,
  SupplierRow,
} from './store/rows';
import { readVisitReadings, readVisitRows, findVisit } from './api/visits';
import {
  homePage,
  methodPage,
  notFoundPage,
  questionsPage,
  readEstimateChoice,
  signInPage,
  signUpPage,
  QUESTIONS,
} from './views/publicPages';
import {
  answerPageHtml,
  endedPageHtml,
  passportPageHtml,
  passportWithdrawnHtml,
  signOffEndedHtml,
  signOffPageHtml,
} from './views/privatePages';
import {
  labelScreen,
  labelsScreen,
  passportsScreen,
  requestsScreen,
  visitScreen,
  visitsScreen,
} from './views/screensDesk';
import { materialsScreen, scenariosScreen, seasonsOf, styleScreen, stylesScreen } from './views/screensStyles';

function pageReply(status: number, body: string): Reply {
  return { status, html: body };
}

export function notFoundReply(): Reply {
  return pageReply(404, notFoundPage());
}

export function homeRoute(ctx: Ctx): Reply {
  return pageReply(200, homePage(readEstimateChoice(ctx.query)));
}

export function methodRoute(): Reply {
  return pageReply(200, methodPage());
}

export function questionsRoute(ctx: Ctx): Reply {
  const asked = ctx.query.get('q');
  const open = QUESTIONS.some((entry) => entry.slug === asked) ? (asked as string) : null;
  return pageReply(200, questionsPage(open));
}

export function signInRoute(ctx: Ctx): Reply {
  return pageReply(200, signInPage(ctx.query.get('next')));
}

export function signUpRoute(): Reply {
  return pageReply(200, signUpPage());
}

/** The document request itself answers the status, before any script runs. */
export async function answerPageRoute(ctx: Ctx): Promise<Reply> {
  const token = ctx.params.token as string;
  try {
    const page = await findAnswerPage(token, ctx.now);
    return pageReply(200, answerPageHtml(page, TOWNS[page.request.town].name));
  } catch (thrown) {
    if (thrown instanceof ApiProblem && thrown.status === 410) {
      const row = await one<{ language: Language }>('select language from supplier_requests where token = $1', [
        token,
      ]);
      return pageReply(410, endedPageHtml(row ? row.language : 'en'));
    }
    if (thrown instanceof ApiProblem && thrown.status === 404) return notFoundReply();
    throw thrown;
  }
}

export async function signOffPageRoute(ctx: Ctx): Promise<Reply> {
  try {
    const page = await findSignOffPage(ctx.params.token as string, ctx.now);
    return pageReply(200, signOffPageHtml(page));
  } catch (thrown) {
    if (thrown instanceof ApiProblem && thrown.status === 410) return pageReply(410, signOffEndedHtml());
    if (thrown instanceof ApiProblem && thrown.status === 404) return notFoundReply();
    throw thrown;
  }
}

async function passportRoute(ctx: Ctx, edition: number | null): Promise<Reply> {
  const lang = readLanguage(ctx.query.get('lang'));
  const gtin = ctx.params.gtin as string;
  try {
    const row = await findPublicPassport(gtin, edition);
    const base = edition === null ? `/p/${gtin}` : `/p/${gtin}/e/${edition}`;
    return pageReply(200, passportPageHtml(publicPassportJson(row, lang), base));
  } catch (thrown) {
    if (thrown instanceof ApiProblem && thrown.status === 410) return pageReply(410, passportWithdrawnHtml(lang));
    if (thrown instanceof ApiProblem && thrown.status === 404) return notFoundReply();
    throw thrown;
  }
}

export function passportNewestRoute(ctx: Ctx): Promise<Reply> {
  return passportRoute(ctx, null);
}

export function passportEditionRoute(ctx: Ctx): Promise<Reply> {
  const number = Number(ctx.params.n);
  if (!Number.isInteger(number) || number < 1) return Promise.resolve(notFoundReply());
  return passportRoute(ctx, number);
}

export async function stylesRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const list = await styleListPage(desk.id, ctx.query);
  const labels = await query<LabelRow>('select * from labels where assessor_id = $1 order by sort_index', [
    desk.id,
  ]);
  const seasons = await seasonsOf(desk.id);
  return pageReply(200, stylesScreen({ list, labels, seasons, parameters: ctx.query }));
}

export async function styleRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  let style: StyleRowRecord;
  try {
    style = await findStyle(desk.id, ctx.params.id as string);
  } catch {
    return notFoundReply();
  }
  const label = await labelOfStyle(style);
  const results = await query<ResultRow>('select * from results where style_id = $1 order by sort_index desc', [
    style.id,
  ]);
  const current = results[0] ?? null;
  const asked = ctx.query.get('result');
  const shown = asked === null ? current : (results.find((result) => result.id === asked) ?? current);
  const dossiers = await query<DossierRow>(
    'select * from dossiers where style_id = $1 order by sort_index desc',
    [style.id],
  );
  const passports = await query<PassportRow>('select * from passports where style_id = $1 order by edition', [
    style.id,
  ]);
  const measure = ctx.query.get('measure');
  return pageReply(
    200,
    await styleScreen({
      style,
      label,
      result: current,
      shownResult: shown,
      earlier: results.filter((result) => result.id !== (shown ? shown.id : '')),
      dossiers,
      passports,
      measure: isMeasure(measure) ? measure : 'climate',
      newerFactors: await newerFactorsFor(style, localDate(ctx.now, LISBON)),
      arrival: await answerArrival(style),
      labelContact: label.contact_name ?? '',
    }),
  );
}

/** The announcement a refresh makes when a supplier's answer changed the style. */
async function answerArrival(style: StyleRowRecord): Promise<{ key: string; text: string } | null> {
  if (style.changed_by === null) return null;
  const supplier = await one<{ town: Town }>('select town from suppliers where label_id = $1 and name = $2', [
    style.label_id,
    style.changed_by,
  ]);
  const town = supplier ? TOWNS[supplier.town] : TOWNS.porto;
  return {
    key: `${style.changed_by}:${style.changed_at}`,
    text: announce.answered(style.changed_by, localTime(Number(style.changed_at), town.zone), town.name),
  };
}

export async function materialsRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  let style: StyleRowRecord;
  try {
    style = await findStyle(desk.id, ctx.params.id as string);
  } catch {
    return notFoundReply();
  }
  const label = await labelOfStyle(style);
  return pageReply(200, await materialsScreen(style, label));
}

function readScenarioChanges(parameters: URLSearchParams) {
  const recycled: Record<string, number> = {};
  const material: Record<string, string> = {};
  const factory: Record<string, string> = {};
  const mode: Record<number, string> = {};
  for (const value of parameters.getAll('recycled')) {
    const [lineId, percent] = value.split(':');
    if (lineId && percent && /^\d+$/.test(percent)) recycled[lineId] = Number(percent);
  }
  for (const value of parameters.getAll('material')) {
    const [lineId, materialId] = value.split(':');
    if (lineId && isMaterial(materialId)) material[lineId] = materialId;
  }
  for (const value of parameters.getAll('factory')) {
    const [lineId, country] = value.split(':');
    if (lineId && isCountry(country)) factory[lineId] = country;
  }
  for (const value of parameters.getAll('mode')) {
    const [index, chosen] = value.split(':');
    if (index && /^\d+$/.test(index) && isMode(chosen)) mode[Number(index)] = chosen;
  }
  return { recycled, material, factory, mode };
}

export async function scenariosRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  let style: StyleRowRecord;
  try {
    style = await findStyle(desk.id, ctx.params.id as string);
  } catch {
    return notFoundReply();
  }
  const result = await latestResult(style.id);
  const lines = await readLines(style.id);
  const legs = await readLegs(style.id);
  const changes = readScenarioChanges(ctx.query);

  let figures: ScenarioFigures | null = null;
  if (result) {
    const kept = keptInputOf(result);
    const lineIds = kept.lines.map((line) => line.lineId);
    figures = scenarioFigures(result, {
      recycled: new Map(
        Object.entries(changes.recycled).filter(([lineId]) => lineIds.includes(lineId)) as [string, number][],
      ),
      materialSwaps: new Map(
        Object.entries(changes.material).filter(([lineId]) => lineIds.includes(lineId)) as [string, string][],
      ),
      factorySwaps: new Map(
        Object.entries(changes.factory)
          .filter(([lineId]) => lineIds.includes(lineId))
          .map(([lineId, country]) => [lineId, country]) as [string, never][],
      ),
      legModes: new Map(
        Object.entries(changes.mode)
          .filter(([index]) => Number(index) < kept.legs.length)
          .map(([index, chosen]) => [Number(index), chosen]) as [number, never][],
      ),
    });
  }

  const saved = await query<{
    id: string;
    name: string;
    measures: ScenarioFigures['measures'];
    differences: ScenarioFigures['differences'];
  }>('select id, name, measures, differences from scenarios where style_id = $1 order by sort_index', [style.id]);

  const measure = ctx.query.get('measure');
  return pageReply(
    200,
    scenariosScreen({
      style,
      result,
      lines,
      legs,
      figures,
      measure: isMeasure(measure) ? measure : 'climate',
      saved,
      changes,
    }),
  );
}

export async function labelsRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const labels = await query<LabelRow>('select * from labels where assessor_id = $1 order by sort_index', [
    desk.id,
  ]);
  return pageReply(200, labelsScreen(labels));
}

export async function labelRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  let label: LabelRow;
  try {
    label = await findLabel(desk.id, ctx.params.id as string);
  } catch {
    return notFoundReply();
  }
  const suppliers =
    label.state === 'erased'
      ? []
      : await query<SupplierRow>('select * from suppliers where label_id = $1 order by first_sent_at, name', [
          label.id,
        ]);
  const styles = label.state === 'erased' ? [] : await stylesOfLabel(label.id);
  return pageReply(200, labelScreen({ label, suppliers, styles }));
}

export async function requestsRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const requests = await query<RequestRow & { style_name: string }>(
    `select r.*, s.name as style_name from supplier_requests r
     join styles s on s.id = r.style_id join labels l on l.id = r.label_id
     where r.assessor_id = $1 and l.state <> 'erased' order by r.sort_index desc`,
    [desk.id],
  );
  const styles = await query<StyleRowRecord>(
    `select s.* from styles s join labels l on l.id = s.label_id
     where s.assessor_id = $1 and s.state <> 'archived' and l.state <> 'erased' order by s.name`,
    [desk.id],
  );
  const answered = requests.filter((request) => request.answered_at !== null);
  const newest = answered[0] ?? null;
  const arrival = newest
    ? {
        key: `${newest.id}:${String(newest.answered_at)}`,
        text: announce.answered(
          newest.supplier_name,
          localTime(Number(newest.answered_at), TOWNS[newest.town].zone),
          TOWNS[newest.town].name,
        ),
      }
    : null;
  return pageReply(
    200,
    requestsScreen({ requests, styles, now: ctx.now, expanded: ctx.query.get('answer'), arrival }),
  );
}

export async function visitsRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const visits = await readVisitRows(desk.id);
  const labels = await query<LabelRow>('select * from labels where assessor_id = $1 order by sort_index', [
    desk.id,
  ]);
  return pageReply(200, visitsScreen({ visits, labels }));
}

export async function visitRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  try {
    const visit = await findVisit(desk.id, ctx.params.id as string);
    const readings = await readVisitReadings(visit.id);
    return pageReply(200, visitScreen({ visit, readings }));
  } catch {
    return notFoundReply();
  }
}

export async function passportsRoute(ctx: Ctx): Promise<Reply> {
  const desk = ctx.requireDesk();
  const rows = await query<PassportRow & { style_name: string }>(
    `select p.*, s.name as style_name from passports p join styles s on s.id = p.style_id
     join labels l on l.id = p.label_id
     where s.assessor_id = $1 and l.state <> 'erased' order by s.name, p.edition`,
    [desk.id],
  );
  return pageReply(200, passportsScreen(rows));
}

export { copy, isLanguage };
