// Findings: their walkround order, the content that decides whether one has changed, and the
// hero — the car's most serious fault.

import { createHash } from 'node:crypto';
import { panelOf, panelOrder } from '../../shared/panels.js';
import type { Row } from '../db/pool.js';

type Severity = 'cosmetic' | 'moderate' | 'serious';
export const SEVERITIES: Severity[] = ['cosmetic', 'moderate', 'serious'];

export interface FindingRow extends Row {
  id: string;
  car_id: string;
  panel_id: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: Severity;
  photo_id: string | null;
  revision: number;
  created_at: Date;
}

export interface Finding {
  id: string;
  revision: number;
  position: number;
  panelId: string;
  panelLabel: string;
  u: number;
  v: number;
  title: string;
  wording: string;
  severity: Severity;
  material: boolean;
  band: string;
  photoId: string | null;
}

export function isMaterial(severity: Severity): boolean {
  return severity !== 'cosmetic';
}

/** Panel order, then creation order within a panel. */
export function walkroundOrder(rows: FindingRow[]): FindingRow[] {
  return [...rows].sort((a, b) => {
    const byPanel = panelOrder(a.panel_id) - panelOrder(b.panel_id);
    if (byPanel !== 0) return byPanel;
    const byTime = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
}

/** The content a seen record is written against; an edit reverted before publishing is no change. */
export function contentHash(row: Pick<FindingRow, 'panel_id' | 'u' | 'v' | 'title' | 'wording' | 'severity' | 'photo_id'>): string {
  const parts = [
    row.panel_id,
    Number(row.u).toFixed(3),
    Number(row.v).toFixed(3),
    row.title,
    row.wording,
    row.severity,
    row.photo_id ?? '',
  ].join('\u0000');
  return createHash('sha256').update(parts).digest('hex');
}

export function toFinding(row: FindingRow, position: number, band: string): Finding {
  return {
    id: row.id,
    revision: row.revision,
    position,
    panelId: row.panel_id,
    panelLabel: panelOf(row.panel_id).label,
    u: Number(row.u),
    v: Number(row.v),
    title: row.title,
    wording: row.wording,
    severity: row.severity,
    material: isMaterial(row.severity),
    band,
    photoId: row.photo_id,
  };
}

