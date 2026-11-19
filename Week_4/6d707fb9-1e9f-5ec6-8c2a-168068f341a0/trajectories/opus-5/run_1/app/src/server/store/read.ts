import { query, one } from '../db/pool';
import { dec } from '../domain/decimal';
import { shownMass, shownWhole } from '../domain/display';
import { copy } from '../domain/copy';
import type { FactorRow } from '../domain/factors';
import { materialName } from '../domain/factors';
import type { MeasureFigure } from '../domain/footprint';
import { iso } from '../domain/time';
import { TOWNS } from '../domain/time';
import { problem } from '../http/problem';
import type {
  DossierRow,
  EvidenceRow,
  LabelRow,
  LegRow,
  LineRow,
  PassportRow,
  RequestRow,
  ResultRow,
  ScoreRow,
  StyleRowRecord,
  SupplierRow,
  VisitRow,
} from './rows';

export async function findLabel(deskId: string, labelId: string): Promise<LabelRow> {
  const row = await one<LabelRow>('select * from labels where id = $1 and assessor_id = $2', [labelId, deskId]);
  if (!row) throw problem.notFound();
  return row;
}

export async function findStyle(deskId: string, styleId: string): Promise<StyleRowRecord> {
  const row = await one<StyleRowRecord>(
    `select s.* from styles s join labels l on l.id = s.label_id
     where s.id = $1 and s.assessor_id = $2 and l.state <> 'erased'`,
    [styleId, deskId],
  );
  if (!row) throw problem.notFound();
  return row;
}

export async function readLines(styleId: string): Promise<LineRow[]> {
  return query<LineRow>('select * from material_lines where style_id = $1 order by position', [styleId]);
}

export async function readLegs(styleId: string): Promise<LegRow[]> {
  return query<LegRow>('select * from transport_legs where style_id = $1 order by position', [styleId]);
}

export async function latestResult(styleId: string): Promise<ResultRow | null> {
  return one<ResultRow>('select * from results where style_id = $1 order by sort_index desc limit 1', [styleId]);
}

export async function readScore(styleId: string): Promise<ScoreRow | null> {
  return one<ScoreRow>('select * from scores where style_id = $1', [styleId]);
}

/**
 * Every factory name on a style's lines' tiers, by line position and then tier 1
 * to 3, followed by the suppliers its requests went to in the order first sent,
 * keeping only the first occurrence of an exactly equal name.
 */
export async function supplierNames(styleId: string): Promise<string[]> {
  const lines = await readLines(styleId);
  const requests = await query<{ supplier_name: string }>(
    'select supplier_name from supplier_requests where style_id = $1 order by sort_index',
    [styleId],
  );
  const names: string[] = [];
  const add = (name: string | null | undefined): void => {
    if (name && name !== '' && !names.includes(name)) names.push(name);
  };
  for (const line of lines) {
    add(line.tier1?.factory);
    add(line.tier2?.factory);
    add(line.tier3?.factory);
  }
  for (const request of requests) add(request.supplier_name);
  return names;
}

export function lineShape(line: LineRow): Record<string, unknown> {
  return {
    id: line.id,
    position: line.position,
    materialId: line.material_id,
    materialName: materialName(line.material_id),
    fabricWeightGsm: line.fabric_weight_gsm,
    areaM2: line.area_m2,
    massGrams: line.mass_grams,
    massShown: shownMass(dec(line.mass_grams)),
    fibres: line.fibres,
    tier1: line.tier1,
    tier2: line.tier2,
    tier3: line.tier3,
    answeredFacts: {
      energyMjPerKg: line.answered_energy_mj,
      waterLitresPerKg: line.answered_water_litres,
      fibreOrigin: line.answered_origin,
    },
  };
}

export function legShape(leg: LegRow): Record<string, unknown> {
  return { id: leg.id, mode: leg.mode, km: leg.km };
}

export function resultShape(result: ResultRow): Record<string, unknown> {
  return {
    id: result.id,
    styleId: result.style_id,
    edition: result.edition,
    workedOutAt: iso(Number(result.worked_out_at)),
    dataQualityPercent: result.data_quality_percent,
    dataQualityGrade: result.data_quality_grade,
    measures: result.measures as MeasureFigure[],
    current: result.is_current,
  };
}

export function scoreShown(score: number, per100g: number): string {
  return copy.scoreShown(shownWhole(score), shownWhole(per100g));
}

export function scoreShape(row: ScoreRow | null): Record<string, unknown> {
  if (!row) {
    return {
      state: 'none',
      score: null,
      per100g: null,
      runId: null,
      shown: null,
      worstCaseFacts: [],
      busyUntil: null,
    };
  }
  return {
    state: row.state,
    score: row.score,
    per100g: row.per100g,
    runId: row.run_id,
    shown: row.score !== null && row.per100g !== null ? scoreShown(row.score, row.per100g) : null,
    worstCaseFacts: row.worst_case,
    busyUntil: row.busy_until === null ? null : iso(Number(row.busy_until)),
  };
}

export function measuresOf(result: ResultRow): MeasureFigure[] {
  return result.measures as MeasureFigure[];
}

export function factorRowsOf(result: ResultRow): FactorRow[] {
  return result.factor_rows as FactorRow[];
}

export interface KeptInput {
  lines: {
    lineId: string;
    materialId: string;
    massGrams: string;
    tier1Country: string | null;
    answeredEnergyMjPerKg: string | null;
    answeredWaterLitresPerKg: string | null;
    hasAnsweredFacts: boolean;
  }[];
  legs: { mode: string; km: string }[];
  washes: number;
}

export function keptInputOf(result: ResultRow): KeptInput {
  return result.input as KeptInput;
}

export function climateShownOf(result: ResultRow | null): string | null {
  if (!result) return null;
  const climate = measuresOf(result).find((measure) => measure.measure === 'climate');
  return climate ? climate.totalShown : null;
}

async function styleRowShape(style: StyleRowRecord, labelName: string): Promise<Record<string, unknown>> {
  const result = await latestResult(style.id);
  return {
    id: style.id,
    labelId: style.label_id,
    labelName,
    styleCode: style.style_code,
    name: style.name,
    season: style.season,
    gtin: style.gtin,
    garment: style.garment,
    state: style.state,
    suppliers: await supplierNames(style.id),
    climateShown: climateShownOf(result),
  };
}

export async function newerFactorsFor(style: StyleRowRecord, todayLisbon: string): Promise<string | null> {
  const result = await latestResult(style.id);
  if (!result) return null;
  const seen = await query<{ edition: string; valid_from: string }>(
    'select edition, valid_from from editions_seen order by valid_from, edition',
  );
  const used = seen.find((entry) => entry.edition === result.edition);
  const usedFrom = used ? used.valid_from : null;
  let newest: { edition: string; valid_from: string } | null = null;
  for (const entry of seen) {
    if (entry.valid_from > todayLisbon) continue;
    if (usedFrom !== null && entry.valid_from <= usedFrom) continue;
    if (usedFrom === null && entry.edition === result.edition) continue;
    if (!newest || entry.valid_from > newest.valid_from) newest = entry;
  }
  return newest ? newest.edition : null;
}

export async function styleShape(
  style: StyleRowRecord,
  labelName: string,
  todayLisbon: string,
): Promise<Record<string, unknown>> {
  const base = await styleRowShape(style, labelName);
  const result = await latestResult(style.id);
  const legs = await readLegs(style.id);
  return {
    ...base,
    washes: style.washes,
    repairService: style.repair_service,
    rangeSize: style.range_size,
    notes: style.notes,
    legs: legs.map(legShape),
    version: style.version,
    changedAt: iso(Number(style.changed_at)),
    changedBy: style.changed_by,
    latestResult: result ? resultShape(result) : null,
    newerFactors: await newerFactorsFor(style, todayLisbon),
    score: scoreShape(await readScore(style.id)),
  };
}

export function labelShape(label: LabelRow): Record<string, unknown> {
  return {
    id: label.id,
    name: label.name,
    contactName: label.contact_name,
    contactEmail: label.contact_email,
    state: label.state,
    closedAt: label.closed_at === null ? null : iso(Number(label.closed_at)),
    eraseAt: label.erase_at === null ? null : iso(Number(label.erase_at)),
  };
}

export async function supplierShapes(labelId: string): Promise<Record<string, unknown>[]> {
  const suppliers = await query<SupplierRow>(
    'select * from suppliers where label_id = $1 order by first_sent_at, name',
    [labelId],
  );
  return suppliers.map((supplier) => ({
    id: supplier.id,
    name: supplier.name,
    town: supplier.town,
    townName: TOWNS[supplier.town].name,
    language: supplier.language,
    contactName: supplier.contact_name,
    contactEmail: supplier.contact_email,
  }));
}

export function requestState(request: RequestRow, now: number): RequestRow['state'] {
  if (request.state === 'answered') return 'answered';
  if (request.state === 'ended') return 'ended';
  if (now >= Number(request.ends_at)) return 'ended';
  return request.state;
}

function answerShape(request: RequestRow): Record<string, unknown> | null {
  if (!request.answer) return null;
  const answer = request.answer;
  return {
    energyValue: answer.energyValue,
    energyUnit: answer.energyUnit,
    energyMjPerKg: answer.energyMjPerKg,
    waterLitresPerKg: answer.waterLitresPerKg,
    fibreOrigin: answer.fibreOrigin,
    evidenceIds: answer.evidenceIds,
    answeredAt: answer.answeredAt,
    state: 'answered',
  };
}

export function requestShape(
  request: RequestRow,
  styleName: string,
  now: number,
  publicUrl: string,
): Record<string, unknown> {
  const ended = requestState(request, now) === 'ended';
  return {
    id: request.id,
    styleId: request.style_id,
    lineId: request.line_id,
    styleName,
    supplierName: request.supplier_name,
    contactName: request.contact_name,
    contactEmail: request.contact_email,
    town: request.town,
    townName: TOWNS[request.town].name,
    language: request.language,
    questions: request.questions,
    dueDate: request.due_date,
    state: requestState(request, now),
    sentAt: iso(Number(request.sent_at)),
    endsAt: iso(Number(request.ends_at)),
    remindedAt: request.reminded_at === null ? null : iso(Number(request.reminded_at)),
    answeredAt: request.answered_at === null ? null : iso(Number(request.answered_at)),
    answer: answerShape(request),
    answerAddress: ended || request.token_ended ? null : `${publicUrl}/a/${request.token}`,
  };
}

export function visitShape(visit: VisitRow, lisbonDate: string, lisbonDayHours: number, shown: string) {
  return {
    id: visit.id,
    labelId: visit.label_id,
    factoryName: visit.factory_name,
    town: visit.town,
    townName: TOWNS[visit.town].name,
    localDate: visit.local_date,
    localTime: visit.local_time,
    at: iso(Number(visit.at)),
    lisbonDate,
    lisbonDayHours,
    shown,
  };
}

export function dossierShape(dossier: DossierRow): Record<string, unknown> {
  return {
    id: dossier.id,
    styleId: dossier.style_id,
    resultId: dossier.result_id,
    edition: dossier.edition,
    state: dossier.state,
    madeAt: iso(Number(dossier.made_at)),
    signedOffBy: dossier.signed_off_by,
    signedOffAt: dossier.signed_off_at === null ? null : iso(Number(dossier.signed_off_at)),
  };
}

export function passportListShape(passport: PassportRow, styleName: string): Record<string, unknown> {
  return {
    styleId: passport.style_id,
    styleName,
    gtin: passport.gtin,
    edition: passport.edition,
    state: passport.state,
    publishedAt: iso(Number(passport.published_at)),
    address: `/p/${passport.gtin}`,
  };
}

export async function readEvidence(ids: string[]): Promise<EvidenceRow[]> {
  if (ids.length === 0) return [];
  const rows = await query<EvidenceRow>('select * from evidence_files where id = any($1::text[])', [ids]);
  return ids
    .map((id) => rows.find((row) => row.id === id))
    .filter((row): row is EvidenceRow => row !== undefined);
}
