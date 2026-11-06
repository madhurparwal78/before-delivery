/**
 * One outline icon set, drawn on a 24-unit grid with a single stroke weight.
 * Authored for Saltreach, so nothing is loaded from another origin.
 */
const PATHS: Record<string, string[]> = {
  village: ['M3 12 12 4l9 8', 'M5 11v9h14v-9', 'M10 20v-5h4v5'],
  raid: ['M4 20 14 10', 'M14 6h4v4', 'M13 5l6 6', 'M4 14l6 6'],
  log: ['M4 6h16', 'M4 12h16', 'M4 18h10'],
  clan: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M2 20c0-3 3-5 6-5s6 2 6 5', 'M16 8h6', 'M19 5v6'],
  league: ['M8 4h8v5a4 4 0 0 1-8 0V4Z', 'M12 13v4', 'M8 20h8', 'M8 6H5v2a3 3 0 0 0 3 3', 'M16 6h3v2a3 3 0 0 1-3 3'],
  rewards: ['M4 9h16v11H4V9Z', 'M4 9l2-4h12l2 4', 'M12 5v15'],
  profile: ['M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  operations: ['M4 18a8 8 0 1 1 16 0', 'M12 18l5-6', 'M4 18h16'],
  signout: ['M15 4h4v16h-4', 'M10 12h9', 'M13 8l-4 4 4 4', 'M3 4h7v16H3z']
};

export function icon(name: keyof typeof PATHS | string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const shape of PATHS[name] ?? PATHS.village ?? []) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', shape);
    svg.append(path);
  }
  return svg;
}
