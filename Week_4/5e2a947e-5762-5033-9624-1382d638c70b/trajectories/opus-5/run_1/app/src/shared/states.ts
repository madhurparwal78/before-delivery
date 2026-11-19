import type { ExportState, PresentationState, ShareLinkState } from './types.js';

/** The legal presentation transitions. `paused` is only ever set by the server. */
export const PRESENTATION_TRANSITIONS: Record<PresentationState, PresentationState[]> = {
  waiting: ['live', 'ended'],
  live: ['paused', 'ended'],
  paused: ['live', 'ended'],
  ended: [],
};

export function canPresentationMove(from: PresentationState, to: PresentationState): boolean {
  return PRESENTATION_TRANSITIONS[from].includes(to);
}

export const SHARE_LINK_TRANSITIONS: Record<ShareLinkState, ShareLinkState[]> = {
  active: ['expired', 'revoked'],
  expired: [],
  revoked: [],
};

export function canShareLinkMove(from: ShareLinkState, to: ShareLinkState): boolean {
  return SHARE_LINK_TRANSITIONS[from].includes(to);
}

export const EXPORT_TRANSITIONS: Record<ExportState, ExportState[]> = {
  queued: ['running'],
  running: ['running', 'ready', 'failed'],
  ready: [],
  failed: ['running'],
};

export function canExportMove(from: ExportState, to: ExportState): boolean {
  return EXPORT_TRANSITIONS[from].includes(to);
}

/** The five export steps: four progress steps then the write. */
export const EXPORT_PROGRESS = [20, 40, 60, 80] as const;

export function nextExportProgress(progress: number): number {
  for (const value of EXPORT_PROGRESS) {
    if (progress < value) return value;
  }
  return 100;
}

