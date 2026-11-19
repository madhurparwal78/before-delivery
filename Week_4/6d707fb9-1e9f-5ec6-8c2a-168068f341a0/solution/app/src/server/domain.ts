import { randomBytes, randomUUID } from "node:crypto";
import { materialName, townName, townZone, type Language } from "../shared/catalog";
import { ANSWER_COPY, PASSPORT_COPY } from "../shared/copy";
import type {
  Dossier,
  Label,
  Line,
  PublicPassport,
  Result,
  Score,
  Style,
  StyleRow,
  SupplierRequest,
  Tier,
  Visit,
} from "../shared/api";
import { hoursOfDay, instantText, localDate, LISBON, shownDay, wallTime } from "../shared/time";
import { now, type Queryable, type DbRow } from "./db";
import { ApiError, conflict, notFound, publicAddress } from "./http";
import { exact, fullGrouped, shownMass } from "./figures";
import type { FootprintInputs, InputLine, LibraryRow } from "./footprint";
import { dataQuality, workOut } from "./footprint";
import { config } from "./config";

export const newId = (): string => randomUUID();
export const newToken = (): string => randomBytes(24).toString("base64url");

export function instant(value: Date | null): string | null {
  return value ? instantText(value) : null;
}

export function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

// ---- labels

// Rows come from pg, so their columns are read at this third-party boundary.
export function labelJson(row: DbRow): Label {
  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    state: row.state,
    closedAt: instant(row.closed_at),
    eraseAt: instant(row.erase_at),
  };
}

export const CLOSED_COPY = "This label is closed. Bring it back first.";
export const ARCHIVED_COPY = "This style is archived.";

export async function loadLabel(db: Queryable, assessorId: string, id: string): Promise<DbRow> {
  const { rows } = await db.query(`SELECT * FROM labels WHERE id = $1 AND assessor_id = $2`, [id, assessorId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

/** A label of this desk still visible under its address: an erased label keeps only /labels. */
export async function loadLiveLabel(db: Queryable, assessorId: string, id: string): Promise<DbRow> {
  const label = await loadLabel(db, assessorId, id);
  if (label.state === "erased") throw notFound();
  return label;
}

// ---- style state moves, decided only here

type StyleEvent = "firstResult" | "firstPassport" | "withdrawn" | "archive";

export function nextStyleState(state: StyleRow["state"], event: StyleEvent): StyleRow["state"] {
  switch (event) {
    case "firstResult":
      return state === "draft" ? "worked" : state;
    case "firstPassport":
      return "published";
    case "withdrawn":
      return state === "published" ? "worked" : state;
    case "archive":
      return "archived";
  }
}

// ---- styles

export interface StyleRecord {
  id: string;
  assessor_id: string;
  label_id: string;
  label_name: string;
  label_state: Label["state"];
  style_code: string | null;
  name: string;
  season: string;
  gtin: string;
  garment: string;
  washes: number;
  repair_service: boolean | null;
  range_size: number | null;
  notes: string | null;
  state: StyleRow["state"];
  version: number;
  changed_at: Date;
  changed_by: string | null;
  score_state: "none" | "current" | "outdated";
  score_id: string | null;
  busy_until: Date | null;
}

const STYLE_SELECT = `SELECT s.*, l.name AS label_name, l.state AS label_state FROM styles s JOIN labels l ON l.id = s.label_id`;

export async function loadStyle(db: Queryable, assessorId: string, id: string, lock = false): Promise<StyleRecord> {
  const { rows } = await db.query(`${STYLE_SELECT} WHERE s.id = $1 AND s.assessor_id = $2${lock ? " FOR UPDATE OF s" : ""}`, [id, assessorId]);
  if (!rows[0]) throw notFound();
  return rows[0];
}

async function allStyles(db: Queryable, assessorId: string): Promise<StyleRecord[]> {
  const { rows } = await db.query(`${STYLE_SELECT} WHERE s.assessor_id = $1`, [assessorId]);
  return rows;
}

/** Order of the state checks: the closed-label copy wins over the archived one. */
export function assertWritable(style: StyleRecord): void {
  if (style.label_state !== "open") throw conflict(CLOSED_COPY);
  if (style.state === "archived") throw conflict(ARCHIVED_COPY);
}

export function assertFresh(style: StyleRecord, baseVersion: unknown): void {
  if (baseVersion === undefined || baseVersion === null || baseVersion === style.version) return;
  const at = wallTime(style.changed_at);
  const message = style.changed_by
    ? `This style was changed at ${at} Lisbon time by ${style.changed_by}'s answer. Your changes are still here.`
    : `This style was changed at ${at} Lisbon time elsewhere. Your changes are still here.`;
  throw new ApiError(412, "stale_edit", message);
}

/** Every change to a style raises its version; a change to the score's inputs outdates the score. */
export async function touchStyle(db: Queryable, styleId: string, changedBy: string | null, outdatesScore: boolean): Promise<void> {
  await db.query(
    `UPDATE styles SET version = version + 1, changed_at = $2, changed_by = $3,
       score_state = CASE WHEN $4 AND score_state = 'current' THEN 'outdated' ELSE score_state END
     WHERE id = $1`,
    [styleId, now(), changedBy, outdatesScore],
  );
}

export function lineJson(row: DbRow): Line {
  return {
    id: row.id,
    position: row.position,
    materialId: row.material_id,
    materialName: materialName(row.material_id),
    fabricWeightGsm: row.fabric_weight_gsm,
    areaM2: row.area_m2,
    massGrams: row.mass_grams,
    massShown: shownMass(exact(row.mass_grams)),
    fibres: row.fibres,
    tier1: row.tier1,
    tier2: row.tier2,
    tier3: row.tier3,
    answeredFacts: {
      energyMjPerKg: row.energy_mj_per_kg,
      waterLitresPerKg: row.water_litres_per_kg,
      fibreOrigin: row.fibre_origin,
    },
  };
}

export async function linesOf(db: Queryable, styleId: string): Promise<Line[]> {
  const { rows } = await db.query(`SELECT * FROM lines WHERE style_id = $1 ORDER BY position`, [styleId]);
  return rows.map(lineJson);
}

/** Factory names by line position and tier, then request suppliers in the order first sent. */
function supplierNames(lines: { tier1: Tier | null; tier2: Tier | null; tier3: Tier | null }[], sent: string[]): string[] {
  const names = lines.flatMap((line) => [line.tier1, line.tier2, line.tier3].map((tier) => tier?.factory ?? ""));
  return [...new Set([...names, ...sent].filter((name) => name))];
}

export async function suppliersOf(db: Queryable, styleId: string): Promise<string[]> {
  const lines = await db.query(`SELECT tier1, tier2, tier3 FROM lines WHERE style_id = $1 ORDER BY position`, [styleId]);
  const sent = await db.query(`SELECT supplier_name FROM requests WHERE style_id = $1 ORDER BY seq`, [styleId]);
  return supplierNames(lines.rows, sent.rows.map((row) => row.supplier_name));
}

function rowOf(style: StyleRecord, suppliers: string[], climateShown: string | null): StyleRow {
  return {
    id: style.id,
    labelId: style.label_id,
    labelName: style.label_name,
    styleCode: style.style_code,
    name: style.name,
    season: style.season,
    gtin: style.gtin,
    garment: style.garment,
    state: style.state,
    suppliers,
    climateShown,
  };
}

export interface ListedStyle {
  row: StyleRow;
  climateTotal: string | null;
}

export async function listedStyles(db: Queryable, assessorId: string): Promise<ListedStyle[]> {
  const styles = await allStyles(db, assessorId);
  const lines = await db.query(
    `SELECT style_id, tier1, tier2, tier3 FROM lines WHERE style_id IN (SELECT id FROM styles WHERE assessor_id = $1) ORDER BY position`,
    [assessorId],
  );
  const sent = await db.query(`SELECT style_id, supplier_name FROM requests WHERE assessor_id = $1 ORDER BY seq`, [assessorId]);
  const climate = await db.query(
    `SELECT DISTINCT ON (r.style_id) r.style_id, r.measures->0->>'total' AS total, r.measures->0->>'totalShown' AS shown
     FROM results r JOIN styles s ON s.id = r.style_id WHERE s.assessor_id = $1 ORDER BY r.style_id, r.seq DESC`,
    [assessorId],
  );
  const climateOf = new Map(climate.rows.map((row) => [row.style_id as string, row]));
  return styles.map((style) => {
    const figure = climateOf.get(style.id);
    return {
      row: rowOf(
        style,
        supplierNames(
          lines.rows.filter((line) => line.style_id === style.id),
          sent.rows.filter((row) => row.style_id === style.id).map((row) => row.supplier_name),
        ),
        figure?.shown ?? null,
      ),
      climateTotal: figure?.total ?? null,
    };
  });
}

function scoreLine(score: number, per100g: number, language: Language = "en"): string {
  return PASSPORT_COPY[language].score(fullGrouped(exact(score)), fullGrouped(exact(per100g)));
}

export async function scoreOf(db: Queryable, style: StyleRecord): Promise<Score> {
  const stored = style.score_id ? (await db.query(`SELECT * FROM scores WHERE id = $1`, [style.score_id])).rows[0] : null;
  const busy = style.busy_until && now() < style.busy_until;
  return {
    state: busy ? "busy" : style.score_state,
    score: stored?.score ?? null,
    per100g: stored?.per100g ?? null,
    runId: stored?.run_id ?? null,
    shown: stored ? scoreLine(stored.score, stored.per100g) : null,
    worstCaseFacts: stored?.worst_case_facts ?? [],
    busyUntil: busy ? instant(style.busy_until) : null,
  };
}

export function resultJson(row: DbRow, latestId: string | null): Result {
  return {
    id: row.id,
    styleId: row.style_id,
    edition: row.edition,
    workedOutAt: instantText(row.worked_out_at),
    dataQualityPercent: row.data_quality_percent,
    dataQualityGrade: row.data_quality_grade,
    measures: row.measures,
    current: row.id === latestId,
  };
}

export async function latestResultRow(db: Queryable, styleId: string): Promise<DbRow | null> {
  const { rows } = await db.query(`SELECT * FROM results WHERE style_id = $1 ORDER BY seq DESC LIMIT 1`, [styleId]);
  return rows[0] ?? null;
}

/** The newest edition a read of the list has shown, in effect today in Lisbon and newer than the one used. */
async function newerFactorsFor(db: Queryable, result: DbRow | null): Promise<string | null> {
  if (!result) return null;
  const { rows } = await db.query(
    `SELECT edition FROM editions_seen WHERE valid_from > $1 AND valid_from <= $2 ORDER BY valid_from DESC LIMIT 1`,
    [result.edition_valid_from, localDate(now(), LISBON)],
  );
  return rows[0]?.edition ?? null;
}

export async function styleJson(db: Queryable, style: StyleRecord): Promise<Style> {
  const legs = await db.query(`SELECT id, mode, km FROM legs WHERE style_id = $1 ORDER BY position`, [style.id]);
  const latest = await latestResultRow(db, style.id);
  const climate = latest ? (latest.measures as Result["measures"])[0]?.totalShown ?? null : null;
  return {
    ...rowOf(style, await suppliersOf(db, style.id), climate),
    washes: style.washes,
    repairService: style.repair_service,
    rangeSize: style.range_size,
    notes: style.notes,
    legs: legs.rows,
    version: style.version,
    changedAt: instantText(style.changed_at),
    changedBy: style.changed_by,
    latestResult: latest ? resultJson(latest, latest.id) : null,
    newerFactors: await newerFactorsFor(db, latest),
    score: await scoreOf(db, style),
  };
}

// ---- footprint inputs and new results

export function footprintInputs(lines: Line[], legs: { mode: string; km: string }[], washes: number): FootprintInputs {
  const inputLines: InputLine[] = lines.map((line) => ({
    id: line.id,
    materialId: line.materialId,
    massGrams: line.massGrams,
    country: line.tier1?.country as string,
    energyMjPerKg: line.answeredFacts.energyMjPerKg,
    waterLitresPerKg: line.answeredFacts.waterLitresPerKg,
    answered: Boolean(line.answeredFacts.energyMjPerKg || line.answeredFacts.waterLitresPerKg || line.answeredFacts.fibreOrigin),
  }));
  return { lines: inputLines, legs: legs.map((leg) => ({ mode: leg.mode, km: leg.km })), washes };
}

export async function insertResult(
  db: Queryable,
  style: StyleRecord,
  edition: string,
  validFrom: string,
  rows: LibraryRow[],
  inputs: FootprintInputs,
  at: Date,
): Promise<string> {
  const id = newId();
  const quality = dataQuality(inputs);
  await db.query(
    `INSERT INTO results (id, style_id, edition, edition_valid_from, worked_out_at, data_quality_percent, data_quality_grade, measures, kept_rows, inputs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, style.id, edition, validFrom, at, quality.percent, quality.grade, JSON.stringify(workOut(inputs, rows)), JSON.stringify(rows), JSON.stringify(inputs)],
  );
  await db.query(`UPDATE styles SET state = $2 WHERE id = $1`, [style.id, nextStyleState(style.state, "firstResult")]);
  return id;
}

export async function legsOf(db: Queryable, styleId: string): Promise<{ mode: string; km: string }[]> {
  const { rows } = await db.query(`SELECT mode, km FROM legs WHERE style_id = $1 ORDER BY position`, [styleId]);
  return rows;
}

// ---- requests

/** A private page ends exactly at its instant: a request at that instant finds it ended. */
export function pastEnd(endsAt: Date): boolean {
  return now() >= endsAt;
}

export function requestState(row: DbRow): SupplierRequest["state"] {
  if (row.answered_at) return "answered";
  if (row.ended || pastEnd(row.ends_at)) return "ended";
  return row.reminded_at ? "reminded" : "sent";
}

export function requestJson(row: DbRow): SupplierRequest {
  return {
    id: row.id,
    styleId: row.style_id,
    lineId: row.line_id,
    styleName: row.style_name,
    supplierName: row.supplier_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    town: row.town,
    townName: townName(row.town),
    language: row.language,
    questions: row.questions,
    dueDate: row.due_date,
    state: requestState(row),
    sentAt: instantText(row.sent_at),
    endsAt: instantText(row.ends_at),
    remindedAt: instant(row.reminded_at),
    answeredAt: instant(row.answered_at),
    answer: row.answer,
    answerAddress: publicAddress(`/a/${row.token}`),
  };
}

/** A page's end: the earlier of 23:59:59 supplier wall time on the due date and sending + the page lifetime. */
export function pageEnd(dueEnd: Date, sentAt: Date): Date {
  const lifetime = new Date(sentAt.getTime() + config.answerPageSeconds * 1000);
  return dueEnd < lifetime ? dueEnd : lifetime;
}

export function requestMail(
  language: Language,
  kind: "request" | "reminder",
  names: { label: string; style: string; contact: string; town: string },
  address: string,
  dueDate: string,
): { subject: string; body: string } {
  const subject = MAIL_SUBJECT[kind][language](names.label);
  const greeting = MAIL_GREETING[language](names.contact);
  const ask = MAIL_ASK[language](names.label, names.style);
  return { subject, body: [greeting, ask, address, ANSWER_COPY[language].due(dueDate, names.town)].join("\n") };
}

const MAIL_SUBJECT: Record<"request" | "reminder", Record<Language, (label: string) => string>> = {
  request: {
    en: (label) => `Facts needed for ${label}`,
    fr: (label) => `Informations demandées pour ${label}`,
    tr: (label) => `${label} için bilgi talebi`,
    ar: (label) => `معلومات مطلوبة من أجل ${label}`,
  },
  reminder: {
    en: (label) => `Reminder: facts needed for ${label}`,
    fr: (label) => `Rappel : informations demandées pour ${label}`,
    tr: (label) => `Hatırlatma: ${label} için bilgi talebi`,
    ar: (label) => `تذكير: معلومات مطلوبة من أجل ${label}`,
  },
};

const MAIL_GREETING: Record<Language, (contact: string) => string> = {
  en: (contact) => `Hello ${contact},`,
  fr: (contact) => `Bonjour ${contact},`,
  tr: (contact) => `Merhaba ${contact},`,
  ar: (contact) => `مرحبًا ${contact}،`,
};

const MAIL_ASK: Record<Language, (label: string, style: string) => string> = {
  en: (label, style) => `${label} asks you for facts about ${style}. Please answer on this private page:`,
  fr: (label, style) => `${label} vous demande des informations sur ${style}. Merci de répondre sur cette page privée :`,
  tr: (label, style) => `${label}, ${style} hakkında bilgi istiyor. Lütfen bu özel sayfadan yanıtlayın:`,
  ar: (label, style) => `تطلب منك ${label} معلومات عن ${style}. يرجى الإجابة في هذه الصفحة الخاصة:`,
};

type PageLookup =
  | { kind: "none" }
  | { kind: "ended"; language: Language }
  | { kind: "live"; row: DbRow };

export async function answerPageFor(db: Queryable, token: string): Promise<PageLookup> {
  const { rows } = await db.query(
    `SELECT r.*, p.token AS page_token, s.name AS style_name, s.label_id, l.name AS label_name, l.state AS label_state
     FROM request_pages p JOIN requests r ON r.id = p.request_id JOIN styles s ON s.id = r.style_id
     JOIN labels l ON l.id = s.label_id WHERE p.token = $1`,
    [token],
  );
  const row = rows[0];
  if (!row) return { kind: "none" };
  const ended = row.page_token !== row.token || row.label_state !== "open" || pastEnd(row.ends_at) || (row.ended && !row.answered_at);
  return ended ? { kind: "ended", language: row.language } : { kind: "live", row };
}

// ---- visits

export function visitJson(row: DbRow): Visit {
  const zone = townZone(row.town);
  const lisbonDate = localDate(row.at, LISBON);
  return {
    id: row.id,
    labelId: row.label_id,
    factoryName: row.factory_name,
    town: row.town,
    townName: townName(row.town),
    localDate: row.local_date,
    localTime: row.local_time,
    at: instantText(row.at),
    lisbonDate,
    lisbonDayHours: hoursOfDay(lisbonDate),
    shown: `${shownDay(row.local_date)}, ${wallTime(row.at, zone)} ${townName(row.town)} time · ${wallTime(row.at)} Lisbon time`,
  };
}

// ---- dossiers

export function dossierJson(row: DbRow): Dossier {
  return {
    id: row.id,
    styleId: row.style_id,
    resultId: row.result_id,
    edition: row.edition,
    state: row.state,
    madeAt: instantText(row.made_at),
    signedOffBy: row.signed_off_by,
    signedOffAt: instant(row.signed_off_at),
  };
}

export const dossierKey = (assessorId: string, dossierId: string): string => `dossiers/${assessorId}/${dossierId}.pdf`;
export const evidenceKey = (assessorId: string, requestId: string, evidenceId: string): string =>
  `evidence/${assessorId}/${requestId}/${evidenceId}`;

export function publicPassport(row: DbRow, language: Language): PublicPassport {
  const snapshot = row.snapshot as DbRow;
  return {
    gtin: row.gtin,
    edition: row.edition,
    lang: language,
    styleName: snapshot.styleName,
    labelName: snapshot.labelName,
    garment: snapshot.garment,
    publishedAt: instantText(row.published_at),
    correctedOn: row.edition > 1 ? shownDay(localDate(row.published_at, LISBON)) : null,
    factorEdition: snapshot.factorEdition,
    dataQualityPercent: snapshot.dataQualityPercent,
    dataQualityGrade: snapshot.dataQualityGrade,
    scoreShown: scoreLine(snapshot.score, snapshot.per100g, language),
    measures: snapshot.measures,
  };
}

type PassportLookup =
  | { kind: "none" }
  | { kind: "withdrawn" }
  | { kind: "live"; row: DbRow };

export async function passportFor(db: Queryable, gtin: string, edition: number | null): Promise<PassportLookup> {
  const passport = (await db.query(`SELECT state FROM passports WHERE gtin = $1`, [gtin])).rows[0];
  if (!passport) return { kind: "none" };
  const editions = await db.query(
    edition === null
      ? `SELECT * FROM passport_editions WHERE gtin = $1 ORDER BY edition DESC LIMIT 1`
      : `SELECT * FROM passport_editions WHERE gtin = $1 AND edition = $2`,
    edition === null ? [gtin] : [gtin, edition],
  );
  if (edition !== null && !editions.rows[0] && passport.state === "published") return { kind: "none" };
  if (passport.state === "withdrawn") return { kind: "withdrawn" };
  return editions.rows[0] ? { kind: "live", row: editions.rows[0] } : { kind: "none" };
}

/** Everything a label holds in the file store. */
export async function objectKeysOfLabel(db: Queryable, labelId: string): Promise<string[]> {
  const evidence = await db.query(
    `SELECT e.object_key FROM evidence e JOIN requests r ON r.id = e.request_id JOIN styles s ON s.id = r.style_id WHERE s.label_id = $1`,
    [labelId],
  );
  const dossiers = await db.query(
    `SELECT d.id, d.assessor_id FROM dossiers d JOIN styles s ON s.id = d.style_id WHERE s.label_id = $1 AND d.pdf_stored`,
    [labelId],
  );
  return [...evidence.rows.map((row) => row.object_key as string), ...dossiers.rows.map((row) => dossierKey(row.assessor_id, row.id))];
}

/** A deleted or erased label's passports answer 410 from this moment and leave the desk's list. */
export async function withdrawPassportsOfLabel(db: Queryable, labelId: string): Promise<void> {
  await db.query(
    `UPDATE passports SET state = 'withdrawn' WHERE style_id IN (SELECT id FROM styles WHERE label_id = $1)`,
    [labelId],
  );
}
