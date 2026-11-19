import { query, queryOne, type Tx } from '../db';
import { contentHash } from '../domain/findings';
import type { FindingDto, PanelDto, RecordDto, VersionDto } from '../../shared/types';

export interface VersionRow {
  number: number;
  published_at: Date;
  report_sha256: string;
  findings: FindingDto[];
  panels: PanelDto[];
  record: RecordDto | null;
  open_advisories: number;
}

const COLUMNS = 'number, published_at, report_sha256, findings, panels, record, open_advisories';

export const loadVersion = async (carId: string, number: number): Promise<VersionRow | null> =>
  queryOne<VersionRow>(`SELECT ${COLUMNS} FROM car_version WHERE car_id = $1 AND number = $2`, [carId, number]);

export const loadVersionIn = async (tx: Tx, carId: string, number: number): Promise<VersionRow | null> =>
  tx.queryOne<VersionRow>(`SELECT ${COLUMNS} FROM car_version WHERE car_id = $1 AND number = $2`, [carId, number]);

export const listVersions = async (carId: string): Promise<VersionRow[]> =>
  query<VersionRow>(`SELECT ${COLUMNS} FROM car_version WHERE car_id = $1 ORDER BY number ASC`, [carId]);

export const versionDto = (row: VersionRow): VersionDto => ({
  number: row.number,
  publishedAt: row.published_at.toISOString(),
  findings: row.findings,
  panels: row.panels,
  record: row.record,
});

/** The frozen content of a finding, which is what a seen record is written against. */
export const contentHashOfFrozen = (finding: FindingDto): string =>
  contentHash({
    panelId: finding.panelId,
    u: finding.u,
    v: finding.v,
    title: finding.title,
    wording: finding.wording,
    severity: finding.severity,
    photoId: finding.photoId,
  });
