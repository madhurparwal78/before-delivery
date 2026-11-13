import { drawing } from "./dom.js";

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  menu: '<path d="M4 8h16M4 16h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  warning: '<path d="M12 4l9 16H3zM12 10v5M12 17.5v.5"/>',
} as const;

type IconName = keyof typeof PATHS;

export function icon(name: IconName): SVGSVGElement {
  return drawing(`<svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" ${STROKE}>${PATHS[name]}</svg>`);
}
