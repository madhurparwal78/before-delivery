// Reading a car's state. Every derived figure — bands, counts, blockers, progress — is computed
// here on every read, so nothing can drift.

import { config } from '../config.js';
import { query, one, type Row } from '../db/pool.js';
import { PANELS, isGaugeable, panelOf, type Substrate } from '../../shared/panels.js';
import { bandFor, median, mils, type Band } from '../../shared/measures.js';
import {
  buildRecord, openAdvisories, type ConditionRecord, type RecordPayload, type StoredResponse,
} from './record.js';
import {
  contentHash, walkroundOrder, type Finding, type FindingRow,
} from './findings.js';
import { LIVE_OFFER } from './offers.js';

export type ListingStatus = 'draft' | 'rendering' | 'live' | 'under_offer' | 'sold' | 'withdrawn';

export interface CarRow extends Row {
  id: string;
  name: string;
  registration: string;
  asking_pounds: number;
  viewing_area: string;
  home_address: string;
  story: string;
  listing_status: ListingStatus;
  prior_status: ListingStatus | null;
  current_version: number | null;
}

interface Standing {
  panelsRead: number;
  panelsGaugeable: number;
  findings: number;
  files: number;
  activeLinks: number;
  slotsHeld: number;
  slots: number;
  liveOffers: number;
  failedAlerts: number;
}

interface CarJson {
  id: string;
  name: string;
  registration: string;
  askingPounds: number;
  viewingArea: string;
  homeAddress: string;
  story: string;
  listingStatus: ListingStatus;
  currentVersion: number | null;
  pulledAt: string | null;
  publishedOpenAdvisories: number;
  workingOpenAdvisories: number;
  publishBlockers: string[];
  standing: Standing;
}

export async function loadCar(id: string): Promise<CarRow | null> {
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return one<CarRow>('SELECT * FROM car WHERE id = $1', [id]);
}

export async function findingRows(carId: string): Promise<FindingRow[]> {
  const rows = await query<FindingRow>(
    'SELECT * FROM finding WHERE car_id = $1 AND removed_at IS NULL',
    [carId],
  );
  return walkroundOrder(rows);
}

interface PanelReadings {
  owner: Map<string, { microns: number; readAt: Date }>;
  medians: { steel: number | null; aluminium: number | null };
}

export async function loadReadings(carId: string): Promise<PanelReadings> {
  const rows = await query<{ panel_id: string; microns: number; read_at: Date }>(
    'SELECT panel_id, microns, read_at FROM reading WHERE car_id = $1',
    [carId],
  );
  const owner = new Map(rows.map((row) => [row.panel_id, { microns: row.microns, readAt: row.read_at }]));
  const bySubstrate = (substrate: string): number[] =>
    PANELS.filter((item) => item.substrate === substrate)
      .map((item) => owner.get(item.id)?.microns)
      .filter((value): value is number => typeof value === 'number');
  return {
    owner,
    medians: { steel: median(bySubstrate('steel')), aluminium: median(bySubstrate('aluminium')) },
  };
}

export function bandOfPanel(panelId: string, readings: PanelReadings): Band {
  const found = panelOf(panelId);
  if (found.substrate === 'plastic') return 'Not gauged';
  const reading = readings.owner.get(panelId);
  if (!reading) return 'No reading';
  const base = found.substrate === 'steel' ? readings.medians.steel : readings.medians.aluminium;
  return bandFor(reading.microns, base);
}

interface CapturedRow extends Row {
  link_id: string;
  kind: string;
  panel_id: string;
  microns: number | null;
  u: number | null;
  v: number | null;
  wording: string | null;
  captured_at: Date;
  received_at: Date;
  name: string;
}

type Viewer = { kind: 'owner' } | { kind: 'link'; linkId: string; role: 'buyer' | 'inspector' };

/** A panel as the product publishes it: the owner's reading, then the inspector's beside it. */
interface OwnerReadingJson {
  microns: number | null;
  mils: string | null;
  band: Band;
  readAt: string | null;
}

interface InspectorReadingJson {
  name?: string;
  microns: number;
  mils: string;
  band: Band;
  capturedAt: string;
  receivedAt: string;
}

interface InspectorFindingJson {
  name?: string;
  u: number;
  v: number;
  wording: string | null;
  capturedAt: string;
  receivedAt: string;
}

interface PanelJson {
  id: string;
  label: string;
  substrate: Substrate;
  owner: OwnerReadingJson;
  inspector: InspectorReadingJson[];
  inspectorFindings: InspectorFindingJson[];
}

interface PanelsJson {
  panels: PanelJson[];
  medians: { steel: number | null; aluminium: number | null };
}

export async function panelsJson(carId: string, viewer: Viewer): Promise<PanelsJson> {
  const readings = await loadReadings(carId);
  const captured = await query<CapturedRow>(
    `SELECT c.*, l.name FROM capture_item c JOIN link l ON l.id = c.link_id
     WHERE l.car_id = $1 ORDER BY c.received_at ASC`,
    [carId],
  );
  const withName = viewer.kind === 'owner';
  const panels = PANELS.map((item) => {
    const reading = readings.owner.get(item.id);
    const base = item.substrate === 'steel' ? readings.medians.steel : readings.medians.aluminium;
    const inspector = captured
      .filter((row) => row.kind === 'reading' && row.panel_id === item.id)
      // An inspector reading is banded against the owner's median on the same substrate.
      .map((row) => ({
        ...(withName || (viewer.kind === 'link' && viewer.linkId === row.link_id) ? { name: row.name } : {}),
        microns: row.microns as number, // a reading capture always carries microns
        mils: mils(row.microns as number),
        band: bandFor(row.microns as number, base),
        capturedAt: row.captured_at.toISOString(),
        receivedAt: row.received_at.toISOString(),
      }));
    const inspectorFindings = captured
      .filter((row) => row.kind === 'finding' && row.panel_id === item.id)
      .map((row) => ({
        ...(withName || (viewer.kind === 'link' && viewer.linkId === row.link_id) ? { name: row.name } : {}),
        u: Number(row.u),
        v: Number(row.v),
        wording: row.wording,
        capturedAt: row.captured_at.toISOString(),
        receivedAt: row.received_at.toISOString(),
      }));
    return {
      id: item.id,
      label: item.label,
      substrate: item.substrate,
      // The band is decided in one place, for the owner's reading as for every other surface.
      owner: reading
        ? {
            microns: reading.microns,
            mils: mils(reading.microns),
            band: bandOfPanel(item.id, readings),
            readAt: reading.readAt.toISOString(),
          }
        : { microns: null, mils: null, band: bandOfPanel(item.id, readings), readAt: null },
      inspector,
      inspectorFindings,
    };
  });
  return { panels, medians: readings.medians };
}

interface PullRow extends Row {
  id: string;
  pulled_at: Date;
  payload: RecordPayload;
}

export async function latestPull(carId: string): Promise<PullRow | null> {
  return one<PullRow>(
    'SELECT * FROM record_pull WHERE car_id = $1 ORDER BY pulled_at DESC, id DESC LIMIT 1',
    [carId],
  );
}

export async function workingRecord(carId: string): Promise<ConditionRecord | null> {
  const pull = await latestPull(carId);
  if (!pull) return null;
  const responses = await query<StoredResponse>(
    'SELECT advisory_id, stance, note, answered_at FROM advisory_response WHERE car_id = $1',
    [carId],
  );
  return buildRecord(pull.pulled_at, pull.payload, responses);
}

/** The publish gate, decided on every read against the server's clock. */
export async function publishBlockers(car: CarRow): Promise<string[]> {
  if (car.listing_status !== 'draft' && car.listing_status !== 'live') return [];
  const reasons: string[] = [];
  const findings = await findingRows(car.id);
  if (findings.length === 0) reasons.push('no_findings');
  const record = await workingRecord(car.id);
  if (!record) {
    reasons.push('no_record_pull');
    return reasons;
  }
  const age = (Date.now() - new Date(record.pulledAt).getTime()) / 1000;
  if (age > config.recordPullMaxAgeSeconds) reasons.push('record_stale');
  if (record.advisories.some((item) => item.stance === null)) reasons.push('advisories_unanswered');
  if (record.advisories.some((item) => item.recurred)) reasons.push('advisory_recurred');
  return reasons;
}

interface StandingCounts {
  findings: number; files: number; active_links: number; slots_held: number; slots: number;
  live_offers: number; failed_alerts: number;
}

async function standingOf(carId: string): Promise<Standing> {
  const readings = await loadReadings(carId);
  const gaugeable = PANELS.filter((item) => isGaugeable(item.id));
  const counts = (await one<StandingCounts>(
    `SELECT
       (SELECT count(*) FROM finding WHERE car_id = $1 AND removed_at IS NULL) AS findings,
       (SELECT count(*) FROM upload WHERE car_id = $1) AS files,
       (SELECT count(*) FROM link WHERE car_id = $1 AND NOT revoked AND expires_at > now()) AS active_links,
       (SELECT count(*) FROM slot WHERE car_id = $1 AND holder_link_id IS NOT NULL) AS slots_held,
       (SELECT count(*) FROM slot WHERE car_id = $1) AS slots,
       (SELECT count(*) FROM offer WHERE car_id = $1 AND ${LIVE_OFFER}) AS live_offers,
       (SELECT count(*) FROM phone_alert WHERE car_id = $1 AND state = 'failed') AS failed_alerts`,
    [carId],
  )) as StandingCounts; // an aggregate SELECT always returns one row
  return {
    panelsRead: gaugeable.filter((item) => readings.owner.has(item.id)).length,
    panelsGaugeable: gaugeable.length,
    findings: Number(counts.findings),
    files: Number(counts.files),
    activeLinks: Number(counts.active_links),
    slotsHeld: Number(counts.slots_held),
    slots: Number(counts.slots),
    liveOffers: Number(counts.live_offers),
    failedAlerts: Number(counts.failed_alerts),
  };
}

export interface VersionRow extends Row {
  car_id: string;
  number: number;
  published_at: Date;
  report_sha256: string;
  signature: string;
  snapshot: {
    findings: Finding[];
    panels: unknown[];
    record: ConditionRecord;
    maskedRegistration: string;
    name: string;
    askingPounds: number;
  };
}

export async function currentVersion(car: CarRow): Promise<VersionRow | null> {
  if (car.current_version === null) return null;
  return one<VersionRow>('SELECT * FROM version WHERE car_id = $1 AND number = $2', [car.id, car.current_version]);
}

export async function carJson(car: CarRow): Promise<CarJson> {
  const [record, standing, blockers, version] = await Promise.all([
    workingRecord(car.id),
    standingOf(car.id),
    publishBlockers(car),
    currentVersion(car),
  ]);
  return {
    id: car.id,
    name: car.name,
    registration: car.registration,
    askingPounds: car.asking_pounds,
    viewingArea: car.viewing_area,
    homeAddress: car.home_address,
    story: car.story,
    listingStatus: car.listing_status,
    currentVersion: car.current_version,
    pulledAt: record?.pulledAt ?? null,
    publishedOpenAdvisories: version ? openAdvisories(version.snapshot.record.advisories) : 0,
    workingOpenAdvisories: record ? record.openAdvisories : 0,
    publishBlockers: blockers,
    standing,
  };
}

/** The first two characters of the stored registration, the rest replaced with asterisks. */
export function maskRegistration(registration: string): string {
  return registration.slice(0, 2) + '*'.repeat(Math.max(0, registration.length - 2));
}

/** What a publish would freeze, used to refuse a publish that would change nothing. */
export async function versionSignature(car: CarRow): Promise<string> {
  const rows = await findingRows(car.id);
  const readings = await loadReadings(car.id);
  const record = await workingRecord(car.id);
  const parts = {
    findings: rows.map((row) => ({ id: row.id, hash: contentHash(row) })),
    readings: Object.fromEntries([...readings.owner.entries()].map(([id, value]) => [id, value.microns])),
    record: record
      ? {
          pulledAt: record.pulledAt,
          advisories: record.advisories.map((item) => ({ id: item.id, stance: item.stance, note: item.note })),
        }
      : null,
  };
  return JSON.stringify(parts);
}
