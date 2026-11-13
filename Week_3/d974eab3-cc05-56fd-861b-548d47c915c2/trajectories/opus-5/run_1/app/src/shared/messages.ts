import { PANEL_COUNT, STAGE_COUNT } from './progress';
import type { Mode } from './types';

export const STATUS_REGION_NAME = 'Story updates';

export function stageAnnouncement(stage: number, title: string): string {
  return `Stage ${stage} of ${STAGE_COUNT}: ${title}.`;
}

export function panelAnnouncement(panel: number, title: string): string {
  return `Panel ${panel} of ${PANEL_COUNT}: ${title}.`;
}

export function packViewAnnouncement(view: string): string {
  return `Showing the ${view} of the pack.`;
}

export function interviewFilterAnnouncement(shown: number): string {
  return shown === 1 ? 'Showing 1 interview.' : `Showing ${shown} interviews.`;
}

export function scenarioAnnouncement(
  mode: Mode,
  name: string,
  title: string,
): string {
  return `${mode.toUpperCase()}: ${name}. ${title}.`;
}

export const SHEET_PENDING_ANNOUNCEMENT = 'Preparing the product sheet.';
export const SHEET_READY_ANNOUNCEMENT = 'Product sheet ready.';

export const SHEET_UNAVAILABLE_MESSAGE =
  'The product sheet cannot be prepared right now. Please try again in a few minutes.';
export const SCENARIO_FAILED_MESSAGE =
  'This moment cannot be shown right now. Please choose it again.';
export const CONTENT_FAILED_MESSAGE =
  'The story cannot be loaded right now. Please reload the page.';

export const NOT_FOUND_MESSAGE = 'Not found.';
export const INTERVIEW_NOT_FOUND_MESSAGE = 'This interview does not exist.';
export const SCENARIO_NOT_FOUND_MESSAGE = 'This scenario does not exist.';
export const TOO_LARGE_MESSAGE = 'The request body is too large.';
export const INVALID_MESSAGE = 'The content does not match the published shape.';

export const PAGE_NOT_FOUND_HEADING = 'This page does not exist.';
export const PAGE_NOT_FOUND_LINK = 'Back to the story';

export const SHEET_FILENAME = 'vireo-pace-product-sheet.pdf';
export const ORGANISATION_NAME = 'Alder Quay Laboratories';
