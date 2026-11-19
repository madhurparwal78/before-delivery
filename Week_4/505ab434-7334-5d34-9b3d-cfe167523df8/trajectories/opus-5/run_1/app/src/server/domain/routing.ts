import { APPLICATION_LABELS } from '../../shared/labels.js';
import type { ApplicationClass, AssetClass, StageKind } from '../../shared/types.js';

const LEGAL_APPLICATIONS: ApplicationClass[] = ['co_brand', 'merchandise', 'partnership'];

/** The stage plan for a request: brand, a second brand stage for marks, then legal where required. */
export function planStages(applicationClass: ApplicationClass, assetClass: AssetClass): StageKind[] {
  const stages: StageKind[] = ['brand'];
  if (assetClass === 'mark') stages.push('brand');
  if (LEGAL_APPLICATIONS.includes(applicationClass)) stages.push('legal');
  return stages;
}

export function stageReason(
  stageIndex: number,
  stages: StageKind[],
  applicationClass: ApplicationClass,
  assetClass: AssetClass,
): string {
  const position = `Stage ${stageIndex} of ${stages.length}`;
  const kind = stages[stageIndex - 1];
  if (kind === 'legal') return `${position}: legal review (${APPLICATION_LABELS[applicationClass]}).`;
  if (assetClass === 'mark') {
    return stageIndex === 1
      ? `${position}: first brand review (mark asset).`
      : `${position}: second brand review (mark asset).`;
  }
  return `${position}: brand review.`;
}

export function stageLabel(stageIndex: number, stages: StageKind[], assetClass: AssetClass): string {
  const kind = stages[stageIndex - 1];
  if (kind === 'legal') return 'Legal review';
  if (assetClass === 'mark') return stageIndex === 1 ? 'First brand review' : 'Second brand review';
  return 'Brand review';
}

export interface ReviewerCandidate {
  id: string;
  displayName: string;
  openStages: number;
}

/** The eligible reviewer with the fewest open stages, ties by display name A to Z. */
export function leastLoaded(candidates: ReviewerCandidate[]): ReviewerCandidate | null {
  const sorted = [...candidates].sort(
    (left, right) => left.openStages - right.openStages || left.displayName.localeCompare(right.displayName, 'en'),
  );
  return sorted[0] ?? null;
}
