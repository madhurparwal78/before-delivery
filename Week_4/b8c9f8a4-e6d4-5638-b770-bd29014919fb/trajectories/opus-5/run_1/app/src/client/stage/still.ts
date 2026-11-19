import type { Matrix4 } from 'three';
import { PANELS, frameCorners, worldPoint, type Vec3 } from '../../shared/panels';
import { panelOf, projectToBox, type ScreenPoint, type StageFinding } from './camera';

export interface StillInput {
  matrix: Matrix4;
  eye: Vec3;
  width: number;
  height: number;
  anchor: Vec3;
  findings: readonly { finding: StageFinding; seen: boolean }[];
  dimmed: boolean;
  openAdvisories: number | null;
}

const distanceFrom = (eye: Vec3, point: Vec3): number =>
  Math.hypot(eye[0] - point[0], eye[1] - point[1], eye[2] - point[2]);

const shade = (point: Vec3): string => {
  const height = Math.min(1, Math.max(0, (point[1] - 0.12) / 1.25));
  const lightness = 8 + height * 46;
  const hue = 248 - height * 18 + (point[0] > 0.2 ? -24 : 0);
  const saturation = 46 + height * 22;
  return `hsl(${hue.toFixed(0)} ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
};

const TICK_STRIP_HEIGHT = 24;

/**
 * A drawn vector still of the facets at the resting vertex, with one pin per finding
 * placed by the same matrix the scene uses.
 */
export const facetStillSvg = (input: StillInput): string => {
  const box = { width: input.width, height: input.height };
  const faces = PANELS.map((panel) => {
    const corners = frameCorners(panel);
    const projected = corners.map((point) => projectToBox(input.matrix, point, box));
    const centre = worldPoint(panel, 0.5, 0.5);
    return { panel, projected, depth: distanceFrom(input.eye, centre), centre };
  })
    .filter((face) => face.projected.every((point: ScreenPoint) => point.inFront))
    .sort((left, right) => right.depth - left.depth);

  const polygons = faces
    .map(
      (face) =>
        `<polygon points="${face.projected.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}" fill="${shade(face.centre)}" stroke="hsl(250 40% 62%)" stroke-width="1" stroke-opacity="0.5"/>`,
    )
    .join('');

  const heroPoint = projectToBox(input.matrix, input.anchor, box);
  const glow =
    heroPoint.inFront
      ? `<circle cx="${heroPoint.x.toFixed(1)}" cy="${heroPoint.y.toFixed(1)}" r="96" fill="url(#still-glow)"/>`
      : '';

  const pins = input.findings
    .map(({ finding, seen }) => {
      const point = projectToBox(input.matrix, worldPoint(panelOf(finding.panelId), finding.u, finding.v), box);
      if (!point.inFront || point.x < 0 || point.y < 0 || point.x > input.width || point.y > input.height) return '';
      return `<g class="still-pin" data-finding-id="${finding.id}" data-seen="${seen ? 'true' : 'false'}" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})"><circle r="12" fill="none" stroke="#eaf0ff" stroke-width="3.4"/><circle r="5" fill="${seen ? '#f3f7ff' : '#100d22'}"/></g>`;
    })
    .join('');

  const ticks =
    input.openAdvisories === null
      ? ''
      : `<rect x="0" y="${(input.height - TICK_STRIP_HEIGHT).toFixed(1)}" width="${input.width}" height="${TICK_STRIP_HEIGHT}" fill="#0b0920"/>${Array.from(
          { length: Math.min(12, input.openAdvisories) },
          (_unused, index) =>
            `<rect x="${(16 * (index + 1) - 5).toFixed(1)}" y="${(input.height - 12 - 5).toFixed(1)}" width="10" height="10" fill="#f2f6ff"/>`,
        ).join('')}`;

  const dim = input.dimmed
    ? `<rect width="${input.width}" height="${input.height}" fill="#07060f" opacity="0.54"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" class="facet-still" width="${input.width}" height="${input.height}" viewBox="0 0 ${input.width} ${input.height}" preserveAspectRatio="none">
    <defs>
      <radialGradient id="still-glow">
        <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
        <stop offset="0.32" stop-color="#eef1ff" stop-opacity="0.96"/>
        <stop offset="0.58" stop-color="#b3c4ff" stop-opacity="0.56"/>
        <stop offset="1" stop-color="#5a3cbe" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${input.width}" height="${input.height}" fill="#0b0920"/>
    ${polygons}${glow}${pins}${dim}${ticks}
  </svg>`;
};
