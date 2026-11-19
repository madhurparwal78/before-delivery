import { PANELS, isGaugeable, panelById } from '../../shared/panels';
import { micronsToMils } from '../../shared/format';
import type {
  Band,
  CarDto,
  FindingDto,
  ListingStatus,
  PanelDto,
  PanelsResponse,
  RecordDto,
  Severity,
  Standing,
} from '../../shared/types';
import { bandFor, computeMedians, ownerBandForPanel, type Medians } from '../domain/bands';
import { publishBlockers } from '../domain/blockers';
import { contentHash, isMaterial, walkroundOrder, type Placed } from '../domain/findings';
import { reportsBlockers } from '../domain/listing';
import { advisoryId, buildRecord, type ProviderVehicle, type StoredResponse } from '../domain/record';
import { query, queryOne, type Tx } from '../db';

export interface CarRow {
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

export interface FindingRow {
  id: string;
  car_id: string;
  panel_id: string;
  u: string;
  v: string;
  title: string;
  wording: string;
  severity: Severity;
  photo_id: string | null;
  revision: number;
  created_seq: string;
}

const CAR_COLUMNS = `id, name, registration, asking_pounds, viewing_area, home_address, story,
  listing_status, prior_status, current_version`;

export const findCarRow = async (carId: string): Promise<CarRow | null> =>
  queryOne<CarRow>(`SELECT ${CAR_COLUMNS} FROM car WHERE id = $1`, [carId]);

export const findCarRowIn = async (tx: Tx, carId: string): Promise<CarRow | null> =>
  tx.queryOne<CarRow>(`SELECT ${CAR_COLUMNS} FROM car WHERE id = $1`, [carId]);

export const lockCarRow = async (tx: Tx, carId: string): Promise<CarRow | null> =>
  tx.queryOne<CarRow>(`SELECT ${CAR_COLUMNS} FROM car WHERE id = $1 FOR UPDATE`, [carId]);

export const listCarRows = async (): Promise<CarRow[]> =>
  query<CarRow>(`SELECT ${CAR_COLUMNS} FROM car ORDER BY created_at ASC`);

export interface OwnerReading {
  microns: number;
  readAt: string;
}

export const loadOwnerReadings = async (carId: string): Promise<Map<string, OwnerReading>> => {
  const rows = await query<{ panel_id: string; microns: number; read_at: Date }>(
    'SELECT panel_id, microns, read_at FROM panel_reading WHERE car_id = $1',
    [carId],
  );
  return new Map(rows.map((row) => [row.panel_id, { microns: row.microns, readAt: row.read_at.toISOString() }]));
};

/** The key that puts a stored finding row in walkround order. */
export const placedKeyOf = (row: FindingRow): Placed => ({
  panelId: row.panel_id,
  createdSeq: Number(row.created_seq),
  severity: row.severity,
});

export const loadFindingRows = async (carId: string): Promise<FindingRow[]> => {
  const rows = await query<FindingRow>(
    `SELECT id, car_id, panel_id, u, v, title, wording, severity, photo_id, revision, created_seq
     FROM finding WHERE car_id = $1`,
    [carId],
  );
  return walkroundOrder(rows, placedKeyOf);
};

export interface PullRow {
  id: string;
  pulled_at: Date;
  first_used_date: string | null;
  payload: ProviderVehicle;
}

export const loadLatestPull = async (carId: string): Promise<PullRow | null> =>
  queryOne<PullRow>(
    'SELECT id, pulled_at, first_used_date, payload FROM record_pull WHERE car_id = $1 ORDER BY pulled_at DESC, id DESC LIMIT 1',
    [carId],
  );

export const loadAdvisoryResponses = async (carId: string): Promise<Map<string, StoredResponse>> => {
  const rows = await query<{
    mot_test_number: string;
    advisory_text: string;
    stance: StoredResponse['stance'];
    note: string;
    answered_at: Date;
  }>('SELECT mot_test_number, advisory_text, stance, note, answered_at FROM advisory_response WHERE car_id = $1', [
    carId,
  ]);
  return new Map(
    rows.map((row) => [
      advisoryId(row.mot_test_number, row.advisory_text),
      { stance: row.stance, note: row.note, answeredAt: row.answered_at.toISOString() },
    ]),
  );
};

/** The working record: the latest pull and the owner's responses against it. */
export const loadWorkingRecord = async (carId: string): Promise<RecordDto | null> => {
  const pull = await loadLatestPull(carId);
  if (pull === null) return null;
  const responses = await loadAdvisoryResponses(carId);
  return buildRecord(pull.pulled_at.toISOString(), pull.payload, responses);
};

export const findingDtoOf = (
  row: FindingRow,
  position: number,
  ownerReadings: ReadonlyMap<string, number>,
  medians: Medians,
): FindingDto => {
  const panel = panelById(row.panel_id);
  if (panel === undefined) throw new Error(`Unknown panel ${row.panel_id}`);
  return {
    id: row.id,
    revision: row.revision,
    position,
    panelId: row.panel_id,
    panelLabel: panel.label,
    u: Number(row.u),
    v: Number(row.v),
    title: row.title,
    wording: row.wording,
    severity: row.severity,
    material: isMaterial(row.severity),
    band: ownerBandForPanel(row.panel_id, ownerReadings, medians),
    photoId: row.photo_id,
  };
};

export const micronsMapOf = (readings: ReadonlyMap<string, OwnerReading>): Map<string, number> =>
  new Map([...readings].map(([panelId, reading]) => [panelId, reading.microns]));

export const loadFindingDtos = async (carId: string): Promise<FindingDto[]> => {
  const [rows, readings] = await Promise.all([loadFindingRows(carId), loadOwnerReadings(carId)]);
  const microns = micronsMapOf(readings);
  const medians = computeMedians(microns);
  return rows.map((row, index) => findingDtoOf(row, index + 1, microns, medians));
};

export const contentHashOfRow = (row: FindingRow): string =>
  contentHash({
    panelId: row.panel_id,
    u: Number(row.u),
    v: Number(row.v),
    title: row.title,
    wording: row.wording,
    severity: row.severity,
    photoId: row.photo_id,
  });

export interface InspectorCapture {
  link_id: string;
  name: string;
  kind: string;
  panel_id: string;
  microns: number | null;
  u: string | null;
  v: string | null;
  wording: string | null;
  captured_at: Date;
  received_at: Date;
}

export const loadInspectorCaptures = async (carId: string): Promise<InspectorCapture[]> =>
  query<InspectorCapture>(
    `SELECT c.link_id, l.name, c.kind, c.panel_id, c.microns, c.u, c.v, c.wording, c.captured_at, c.received_at
     FROM capture_item c
     JOIN named_link l ON l.id = c.link_id
     WHERE l.car_id = $1
     ORDER BY c.received_at ASC`,
    [carId],
  );

export interface PanelsOptions {
  /** A buyer never receives another person's name. */
  includeNames: boolean;
  /** Inspector captures are never frozen into a version. */
  includeInspector: boolean;
}

export const buildPanels = async (carId: string, options: PanelsOptions): Promise<PanelsResponse> => {
  const [readings, captures] = await Promise.all([
    loadOwnerReadings(carId),
    options.includeInspector ? loadInspectorCaptures(carId) : Promise.resolve([] as InspectorCapture[]),
  ]);
  const microns = micronsMapOf(readings);
  const medians = computeMedians(microns);

  const panels: PanelDto[] = PANELS.map((panel) => {
    const reading = readings.get(panel.id);
    const ownerBand: Band = ownerBandForPanel(panel.id, microns, medians);
    return {
      id: panel.id,
      label: panel.label,
      substrate: panel.substrate,
      owner:
        reading === undefined || !isGaugeable(panel)
          ? null
          : {
              microns: reading.microns,
              mils: micronsToMils(reading.microns),
              band: ownerBand,
              readAt: reading.readAt,
            },
      inspector: captures
        .filter((capture) => capture.kind === 'reading' && capture.panel_id === panel.id && capture.microns !== null)
        .map((capture) => ({
          ...(options.includeNames ? { name: capture.name } : {}),
          microns: capture.microns as number,
          mils: micronsToMils(capture.microns as number),
          band: bandFor(panel.substrate, capture.microns, medians),
          capturedAt: capture.captured_at.toISOString(),
          receivedAt: capture.received_at.toISOString(),
        })),
      inspectorFindings: captures
        .filter((capture) => capture.kind === 'finding' && capture.panel_id === panel.id)
        .map((capture) => ({
          ...(options.includeNames ? { name: capture.name } : {}),
          u: Number(capture.u),
          v: Number(capture.v),
          wording: capture.wording ?? '',
          capturedAt: capture.captured_at.toISOString(),
          receivedAt: capture.received_at.toISOString(),
        })),
    };
  });

  return { panels, medians };
};

export const loadStanding = async (carId: string): Promise<Standing> => {
  const row = await queryOne<{
    panels_read: string;
    findings: string;
    files: string;
    active_links: string;
    slots_held: string;
    slots: string;
    live_offers: string;
    failed_alerts: string;
  }>(
    `SELECT
       (SELECT count(*) FROM panel_reading r WHERE r.car_id = $1 AND r.panel_id = ANY($2::text[])) AS panels_read,
       (SELECT count(*) FROM finding f WHERE f.car_id = $1) AS findings,
       (SELECT count(*) FROM upload u WHERE u.car_id = $1) AS files,
       (SELECT count(*) FROM named_link l WHERE l.car_id = $1 AND l.revoked_at IS NULL AND l.expires_at > now()) AS active_links,
       (SELECT count(*) FROM viewing_slot s WHERE s.car_id = $1 AND s.holder_link_id IS NOT NULL) AS slots_held,
       (SELECT count(*) FROM viewing_slot s WHERE s.car_id = $1) AS slots,
       (SELECT count(*) FROM offer o WHERE o.car_id = $1 AND o.status IN ('open','needs_reread') AND o.lapses_at > now()) AS live_offers,
       (SELECT count(*) FROM phone_alert a WHERE a.car_id = $1 AND a.state = 'failed') AS failed_alerts`,
    [carId, PANELS.filter(isGaugeable).map((panel) => panel.id)],
  );
  if (row === null) throw new Error('The standing query returned no row');
  return {
    panelsRead: Number(row.panels_read),
    panelsGaugeable: PANELS.filter(isGaugeable).length,
    findings: Number(row.findings),
    files: Number(row.files),
    activeLinks: Number(row.active_links),
    slotsHeld: Number(row.slots_held),
    slots: Number(row.slots),
    liveOffers: Number(row.live_offers),
    failedAlerts: Number(row.failed_alerts),
  };
};

export const loadPublishedOpenAdvisories = async (carId: string, version: number | null): Promise<number> => {
  if (version === null) return 0;
  const row = await queryOne<{ open_advisories: number }>(
    'SELECT open_advisories FROM car_version WHERE car_id = $1 AND number = $2',
    [carId, version],
  );
  return row === null ? 0 : row.open_advisories;
};

export const buildCarDto = async (row: CarRow): Promise<CarDto> => {
  const [record, standing, publishedOpenAdvisories] = await Promise.all([
    loadWorkingRecord(row.id),
    loadStanding(row.id),
    loadPublishedOpenAdvisories(row.id, row.current_version),
  ]);

  const blockers = reportsBlockers(row.listing_status)
    ? publishBlockers({
        findingCount: standing.findings,
        pulledAt: record === null ? null : new Date(record.pulledAt),
        advisories: record?.advisories ?? [],
        now: new Date(),
      })
    : [];

  return {
    id: row.id,
    name: row.name,
    registration: row.registration,
    askingPounds: row.asking_pounds,
    viewingArea: row.viewing_area,
    homeAddress: row.home_address,
    story: row.story,
    listingStatus: row.listing_status,
    currentVersion: row.current_version,
    pulledAt: record?.pulledAt ?? null,
    publishedOpenAdvisories,
    workingOpenAdvisories: record?.openAdvisories ?? 0,
    publishBlockers: blockers,
    standing,
  };
};
