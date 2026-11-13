import { PartStatus } from './values.js';

export interface PartLifecycleInput {
  status: PartStatus;
  lastError: string | null;
}

export type PartEvent =
  | { event: 'extract'; to: 'engraving' }
  | { event: 'pages_stored'; to: 'rendering' }
  | { event: 'pages_refused'; to: 'draft'; lastError: 'storage_unavailable' }
  | { event: 'pdf_stored'; to: 'ready' }
  | { event: 'pdf_failed'; to: 'pdf_pending'; lastError: 'renderer_unavailable' | 'storage_unavailable' }
  | { event: 'retry_succeeded'; to: 'ready' };

/**
 * The one place that decides which part lifecycle transitions exist.
 * draft → engraving → (rendering → ready | pdf_pending → ready) and
 * storage refusal back to draft. Every other move is impossible.
 */
export function nextPartStatus(status: PartStatus, event: PartEvent['event']): PartStatus | null {
  switch (status) {
    case 'draft':
      return event === 'extract' ? 'engraving' : null;
    case 'engraving':
      if (event === 'pages_stored') return 'rendering';
      if (event === 'pages_refused') return 'draft';
      return null;
    case 'rendering':
      if (event === 'pdf_stored') return 'ready';
      if (event === 'pdf_failed') return 'pdf_pending';
      return null;
    case 'pdf_pending':
      return event === 'retry_succeeded' ? 'ready' : null;
    case 'ready':
      return event === 'extract' ? 'engraving' : null;
  }
}

/** Statuses that refuse a new extract with part_busy. */
export function isPartBusy(status: PartStatus): boolean {
  return status === 'engraving' || status === 'rendering';
}

export function isExtractable(status: PartStatus): boolean {
  return status === 'draft' || status === 'ready' || status === 'pdf_pending';
}
