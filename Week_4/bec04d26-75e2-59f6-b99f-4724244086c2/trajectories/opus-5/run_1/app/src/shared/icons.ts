/**
 * Two glyphs from Lucide (ISC), drawn in the same black line weight as the
 * folded-return specimen. They sit beside a full-word label and never replace
 * one, so they are hidden from assistive technology.
 */
const ICON_PATHS = {
  'chevron-left': 'm15 18-6-6 6-6',
  'chevron-right': 'm9 18 6-6-6-6',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function iconSvg(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${ICON_PATHS[name]}"/></svg>`;
}
