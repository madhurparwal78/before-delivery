import type { ResourceHealth, ResourceSync, StageStatus } from '../shared/types.js';
import { el, svgIcon } from './dom.js';

/** Outline glyphs from the Lucide icon set, so every status reads in greyscale. */
const GLYPHS = {
  circleCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  arrowRightLeft: '<path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/>',
  triangleAlert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  gitFork:
    '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  circleSlash: '<circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/>',
  circleDashed:
    '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  menu: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  snowflake:
    '<path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/>',
  rotate: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  shieldCheck:
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  package:
    '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  clock: '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/>',
} as const;

export const icons = GLYPHS;

const STAGE_STATUS: Record<StageStatus, { glyph: string; word: string }> = {
  healthy: { glyph: GLYPHS.circleCheck, word: 'Healthy' },
  progressing: { glyph: GLYPHS.arrowRightLeft, word: 'Progressing' },
  degraded: { glyph: GLYPHS.triangleAlert, word: 'Degraded' },
  out_of_sync: { glyph: GLYPHS.gitFork, word: 'Out-of-sync' },
  not_deployed: { glyph: GLYPHS.circleSlash, word: 'Not deployed' },
};

const SYNC_STATUS: Record<ResourceSync, { glyph: string; tone: StageStatus }> = {
  Synced: { glyph: GLYPHS.circleCheck, tone: 'healthy' },
  OutOfSync: { glyph: GLYPHS.gitFork, tone: 'out_of_sync' },
};

const HEALTH_STATUS: Record<ResourceHealth, { glyph: string; tone: StageStatus }> = {
  Healthy: { glyph: GLYPHS.circleCheck, tone: 'healthy' },
  Progressing: { glyph: GLYPHS.arrowRightLeft, tone: 'progressing' },
  Degraded: { glyph: GLYPHS.triangleAlert, tone: 'degraded' },
  Missing: { glyph: GLYPHS.circleDashed, tone: 'not_deployed' },
};

/** Every status shows its own glyph next to its word, never colour alone. */
export function statusChip(status: StageStatus): HTMLElement {
  const { glyph, word } = STAGE_STATUS[status];
  return el('span', { class: 'status', 'data-tone': status, 'data-status': status }, [
    svgIcon(glyph),
    el('span', {}, [word]),
  ]);
}

export function syncChip(sync: ResourceSync): HTMLElement {
  const { glyph, tone } = SYNC_STATUS[sync];
  return el('span', { class: 'status', 'data-tone': tone }, [svgIcon(glyph), el('span', {}, [sync])]);
}

export function healthChip(health: ResourceHealth): HTMLElement {
  const { glyph, tone } = HEALTH_STATUS[health];
  return el('span', { class: 'status', 'data-tone': tone }, [svgIcon(glyph), el('span', {}, [health])]);
}
