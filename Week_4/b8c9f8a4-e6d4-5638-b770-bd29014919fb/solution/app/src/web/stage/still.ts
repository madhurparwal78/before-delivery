// The drawn still: the same facets, through the same camera matrix, as flat vector shapes. It
// replaces the canvas with no WebGL, under reduced motion after a lost context, and in the
// product's empty states.

import { bodyFacets, centroid, groundShadow, outwardNormal, panelRim, type Facet } from '../../shared/scene.js';
import { project, type CameraFrame } from '../../shared/camera.js';
import { escapeText } from '../../shared/diagram.js';
import { panel, type Vec3 } from '../../shared/panels.js';

export interface StillPin {
  id: string;
  point: Vec3;
  seen: boolean;
  title: string;
}

interface StillOptions {
  frame: CameraFrame;
  width: number;
  height: number;
  heroPoint: Vec3 | null;
  pins: StillPin[];
  dim: number;
  label: string;
  rimPanelId?: string;
  rimGlow?: number;
  /** Below zero when this stage shows no advisory ticks. */
  ticks?: number;
}

function tickStrip(width: number, height: number, open: number): string {
  if (open < 0) return '';
  const squares: string[] = [];
  for (let index = 1; index <= Math.min(12, open); index += 1) {
    squares.push(
      `<rect x="${16 * index - 5}" y="${height - 17}" width="10" height="10" fill="#FFF2DB"/>`,
    );
  }
  return `<rect x="0" y="${height - 24}" width="${width}" height="24" fill="#07021A"/>${squares.join('')}`;
}

function colourOf(facet: Facet): string {
  const to255 = (value: number): number => Math.max(0, Math.min(255, Math.round(value * 255)));
  return `rgb(${to255(facet.colour[0])},${to255(facet.colour[1])},${to255(facet.colour[2])})`;
}

/** Nearer facets paint later; a higher layer paints over what it lies on. */
function depthOf(facet: Facet, options: StillOptions): number {
  const at = facet.paintAt ?? centroid(facet.points);
  const depth = project(options.frame.viewProjection, at, options.width, options.height).w;
  return depth - (facet.layer ?? 0) * 0.4;
}

function facesTheEye(facet: Facet, eye: Vec3): boolean {
  const middle = centroid(facet.points);
  const normal = outwardNormal(facet.points);
  return normal[0] * (eye[0] - middle[0]) + normal[1] * (eye[1] - middle[1]) + normal[2] * (eye[2] - middle[2]) > 0;
}

function opacityOf(facet: Facet): string {
  // Light added over the body is painted at its own strength, so a rim fades out across its bands.
  const strength = facet.glow ?? facet.opacity;
  return strength === undefined ? '' : ` fill-opacity="${strength.toFixed(2)}"`;
}

function polygon(facet: Facet, options: StillOptions): string | null {
  const points: string[] = [];
  for (const point of facet.points) {
    const at = project(options.frame.viewProjection, point, options.width, options.height);
    if (at.w <= 0.01) return null;
    points.push(`${at.x.toFixed(1)},${at.y.toFixed(1)}`);
  }
  return `<polygon points="${points.join(' ')}" fill="${colourOf(facet)}"${opacityOf(facet)}/>`;
}

export function stillSvg(options: StillOptions): string {
  const { width, height } = options;
  const hero = options.heroPoint
    ? project(options.frame.viewProjection, options.heroPoint, width, height)
    : null;
  const heroX = hero && hero.w > 0 ? hero.x : width / 2;
  const heroY = hero && hero.w > 0 ? hero.y : height * 0.35;

  const facets = bodyFacets().filter((facet) => facesTheEye(facet, options.frame.eye));
  const lit = options.rimPanelId === undefined ? undefined : panel(options.rimPanelId);
  if (lit && (options.rimGlow ?? 0) > 0) facets.push(...panelRim(lit));
  const painted = facets
    .map((facet) => ({ facet, depth: depthOf(facet, options) }))
    .filter((item) => item.depth > 0.01)
    .sort((a, b) => b.depth - a.depth)
    .map((item) => polygon(item.facet, options))
    .filter((shape): shape is string => shape !== null)
    .join('');

  const road = groundShadow().map((facet) => polygon(facet, options) ?? '').join('');

  const span = Math.max(width, height);
  // The same creases as the scene: up and right, down and right, left and a little up.
  const planes = [{ angle: 0.96 }, { angle: -1.13 }, { angle: 2.99 }];
  const sectors = planes
    .map((plane, index) => {
      const next = planes[(index + 1) % planes.length];
      const first = `${(heroX + Math.cos(plane.angle) * span * 2).toFixed(1)},${(heroY - Math.sin(plane.angle) * span * 2).toFixed(1)}`;
      const second = `${(heroX + Math.cos(next.angle) * span * 2).toFixed(1)},${(heroY - Math.sin(next.angle) * span * 2).toFixed(1)}`;
      return `<polygon points="${heroX.toFixed(1)},${heroY.toFixed(1)} ${first} ${second}" fill="url(#ob-plane-${index})"/>`;
    })
    .join('');

  const rays = planes
    .map((plane) =>
      `<line x1="${heroX.toFixed(1)}" y1="${heroY.toFixed(1)}"` +
      ` x2="${(heroX + Math.cos(plane.angle) * span).toFixed(1)}"` +
      ` y2="${(heroY - Math.sin(plane.angle) * span).toFixed(1)}"` +
      ' stroke="url(#ob-ray)" stroke-width="2"/>')
    .join('');

  const pins = options.pins
    .map((pin) => {
      const at = project(options.frame.viewProjection, pin.point, width, height);
      if (at.w <= 0) {
        return `<g data-finding-id="${escapeText(pin.id)}" data-seen="${pin.seen}" opacity="0">` +
          `<circle cx="-50" cy="-50" r="12" fill="none"/></g>`;
      }
      const inner = pin.seen
        ? `<circle cx="${at.x.toFixed(2)}" cy="${at.y.toFixed(2)}" r="11.5" fill="#FFF2DB"/>`
        : `<circle cx="${at.x.toFixed(2)}" cy="${at.y.toFixed(2)}" r="8.5" fill="none" stroke="#FFF2DB" stroke-width="7"/>` +
          `<circle cx="${at.x.toFixed(2)}" cy="${at.y.toFixed(2)}" r="4.6" fill="#0A0320"/>`;
      return `<g data-finding-id="${escapeText(pin.id)}" data-seen="${pin.seen}" class="still-pin">` +
        `${inner}<title>${escapeText(pin.title)}</title></g>`;
    })
    .join('');

  // The bloom keeps its size on a full stage and shrinks with a small one, so a card-sized still
  // shows the car rather than one white blob.
  const bloomRadius = Math.max(16, Math.min(58, Math.min(width, height) * 0.22));

  // Right, left and upper plane, each running out from the vertex along the frame's width.
  const planeGradients = [
    { x1: heroX, y1: heroY, x2: width, y2: heroY, from: '#24134A', to: '#1A2FC0' },
    { x1: 0, y1: heroY - height * 0.12, x2: height * 0.06, y2: heroY + height * 0.16, from: '#8FA6F5', to: '#241C66' },
    { x1: heroX, y1: heroY, x2: 0, y2: 0, from: '#4A33C4', to: '#1A1456' },
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"` +
    ` role="img" aria-label="${escapeText(options.label)}" class="still">
    <defs>
      ${planeGradients.map((plane, index) => `<linearGradient id="ob-plane-${index}" gradientUnits="userSpaceOnUse"
        x1="${plane.x1.toFixed(1)}" y1="${plane.y1.toFixed(1)}" x2="${plane.x2.toFixed(1)}" y2="${plane.y2.toFixed(1)}">
        <stop offset="0" stop-color="${plane.from}"/><stop offset="1" stop-color="${plane.to}"/>
      </linearGradient>`).join('')}
      <radialGradient id="ob-magenta">
        <stop offset="0" stop-color="#8A3F85" stop-opacity="0.85"/>
        <stop offset="1" stop-color="#8A3F85" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="ob-bloom">
        <stop offset="0" stop-color="#FFFFFF" stop-opacity="1"/>
        <stop offset="0.3" stop-color="#FFF6E4" stop-opacity="0.92"/>
        <stop offset="0.62" stop-color="#9FB4F8" stop-opacity="0.34"/>
        <stop offset="1" stop-color="#8FA6F5" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ob-ray" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#FFF2DB" stop-opacity="0.8"/>
        <stop offset="0.22" stop-color="#FFF2DB" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#FFF2DB" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="ob-base" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0E0339" stop-opacity="0"/>
        <stop offset="1" stop-color="#0E0339"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="#0E0339"/>
    ${sectors}
    <ellipse cx="${(heroX - height * 0.3).toFixed(1)}" cy="${(heroY - height * 0.22).toFixed(1)}"
      rx="${(height * 0.42).toFixed(1)}" ry="${(height * 0.3).toFixed(1)}" fill="url(#ob-magenta)"/>
    ${rays}
    <rect y="${(height * 0.4).toFixed(0)}" width="${width}" height="${(height * 0.26).toFixed(0)}" fill="url(#ob-base)"/>
    <rect y="${(height * 0.66).toFixed(0)}" width="${width}" height="${Math.ceil(height * 0.34)}" fill="#0E0339"/>
    ${road}
    ${painted}
    <circle cx="${heroX.toFixed(1)}" cy="${heroY.toFixed(1)}" r="${bloomRadius.toFixed(1)}" fill="url(#ob-bloom)"/>
    ${pins}
    ${options.dim < 1 ? `<rect width="${width}" height="${height}" fill="#05010F" opacity="${(1 - options.dim).toFixed(2)}"/>` : ''}
    ${tickStrip(width, height, options.ticks ?? -1)}
  </svg>`;
}
