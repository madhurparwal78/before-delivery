import { createHash } from 'node:crypto';
import { panelOrder } from '../../shared/panels';
import type { Severity } from '../../shared/types';

export const SEVERITIES: readonly Severity[] = ['cosmetic', 'moderate', 'serious'];

/** Cosmetic is not material; moderate and serious are. */
export const isMaterial = (severity: Severity): boolean => severity !== 'cosmetic';

const SEVERITY_RANK: Record<Severity, number> = { cosmetic: 0, moderate: 1, serious: 2 };

export interface Placed {
  readonly panelId: string;
  readonly createdSeq: number;
  readonly severity: Severity;
}

export type PlacedKey<T> = (item: T) => Placed;

/** Walkround order: panel order first, then creation order within a panel. */
export const walkroundOrder = <T>(findings: readonly T[], key: PlacedKey<T>): T[] =>
  [...findings].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    const byPanel = panelOrder(left.panelId) - panelOrder(right.panelId);
    return byPanel !== 0 ? byPanel : left.createdSeq - right.createdSeq;
  });

/** The hero is the highest severity, with a tie going to the earliest walkround position. */
export const heroOf = <T>(findings: readonly T[], key: PlacedKey<T>): T | null => {
  let hero: T | null = null;
  for (const finding of walkroundOrder(findings, key)) {
    if (hero === null || SEVERITY_RANK[key(finding).severity] > SEVERITY_RANK[key(hero).severity]) hero = finding;
  }
  return hero;
};

export interface FindingContent {
  readonly panelId: string;
  readonly u: number;
  readonly v: number;
  readonly title: string;
  readonly wording: string;
  readonly severity: Severity;
  readonly photoId: string | null;
}

/**
 * A seen record is one row per link, finding and finding content. This hash is
 * that content, so a changed finding loses its seen status.
 */
export const contentHash = (content: FindingContent): string =>
  createHash('sha256')
    .update(
      [
        content.panelId,
        content.u.toFixed(3),
        content.v.toFixed(3),
        content.title,
        content.wording,
        content.severity,
        content.photoId ?? '',
      ].join('\u0000'),
    )
    .digest('hex');

/** Coordinates are stored to three decimals. */
export const roundAnchor = (value: number): number => Math.round(value * 1000) / 1000;
