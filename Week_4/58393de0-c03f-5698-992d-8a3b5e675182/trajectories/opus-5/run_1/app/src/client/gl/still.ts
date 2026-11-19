import type { SceneObject } from '../../shared/types.js';
import { flattenMembers } from '../geom/scene.js';

export interface StillOptions {
  width: number;
  height: number;
  azimuth?: number;
  topView?: boolean;
  background?: string;
  grid?: boolean;
}

interface Placed {
  object: SceneObject;
  depth: number;
  x: number;
  y: number;
}

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

const turn = (object: SceneObject, azimuth: number): SceneObject => {
  if (azimuth === 0) return object;
  const radians = (azimuth * Math.PI) / 180;
  return {
    ...object,
    x: object.x * Math.cos(radians) - object.y * Math.sin(radians),
    y: object.x * Math.sin(radians) + object.y * Math.cos(radians),
    rotationZ: (object.rotationZ + azimuth) % 360,
  };
};

const stripePattern = (): string =>
  `<pattern id="qy-hole" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
     <rect width="6" height="6" fill="#aeb6c0" fill-opacity="0.55" />
     <rect width="3" height="6" fill="#7f8894" fill-opacity="0.55" />
   </pattern>`;

const shade = (hex: string, factor: number): string => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const parts = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel * factor))),
  );
  return `#${parts.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
};

/**
 * A still procedural render of a design, used by tiles, cards, previews and wherever
 * WebGL is missing.
 */
export const stillSvg = (objects: SceneObject[], options: StillOptions): string => {
  const azimuth = options.azimuth ?? 0;
  const members = objects
    .flatMap((object) => (object.kind === 'group' ? flattenMembers(object) : [object]))
    .map((object) => turn(object, azimuth));
  const project = (x: number, y: number, z: number): { x: number; y: number } =>
    options.topView ? { x, y: -y } : { x: (x - y) * COS30, y: (x + y) * SIN30 - z };

  const placed: Placed[] = members.map((object) => {
    const point = project(object.x, object.y, object.z);
    return { object, depth: object.x + object.y - object.z, x: point.x, y: point.y };
  });
  let minX = -40;
  let maxX = 40;
  let minY = -40;
  let maxY = 40;
  for (const item of placed) {
    const reach = Math.max(item.object.w, item.object.d, item.object.h);
    minX = Math.min(minX, item.x - reach);
    maxX = Math.max(maxX, item.x + reach);
    minY = Math.min(minY, item.y - reach);
    maxY = Math.max(maxY, item.y + reach);
  }
  const pad = 8;
  const spanX = maxX - minX + pad * 2;
  const spanY = maxY - minY + pad * 2;
  const parts: string[] = [];
  if (options.background) {
    parts.push(`<rect x="${minX - pad}" y="${minY - pad}" width="${spanX}" height="${spanY}" fill="${options.background}" />`);
  }
  if (options.grid) {
    for (let line = -60; line <= 60; line += 20) {
      const a = project(line, -60, 0);
      const b = project(line, 60, 0);
      const c = project(-60, line, 0);
      const d = project(60, line, 0);
      parts.push(
        `<path d="M ${a.x} ${a.y} L ${b.x} ${b.y}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.6" fill="none" />`,
        `<path d="M ${c.x} ${c.y} L ${d.x} ${d.y}" stroke="#ffffff" stroke-opacity="0.35" stroke-width="0.6" fill="none" />`,
      );
    }
  }

  for (const item of [...placed].sort((left, right) => left.depth - right.depth)) {
    const object = item.object;
    const fill = object.mode === 'hole' ? 'url(#qy-hole)' : object.color;
    const half = { x: object.w / 2, y: object.d / 2, z: object.h / 2 };
    if (object.kind === 'sphere') {
      parts.push(
        `<circle cx="${item.x}" cy="${item.y}" r="${object.w / 2}" fill="${fill}" />`,
        `<circle cx="${item.x - object.w / 6}" cy="${item.y - object.w / 6}" r="${object.w / 6}" fill="#ffffff" fill-opacity="0.22" />`,
      );
      continue;
    }
    if (object.kind === 'cylinder') {
      const top = project(object.x, object.y, object.z + half.z);
      const bottom = project(object.x, object.y, object.z - half.z);
      const rx = object.w / 2;
      const ry = options.topView ? object.d / 2 : (object.d / 2) * SIN30 * 1.2;
      parts.push(
        `<path d="M ${top.x - rx} ${top.y} L ${bottom.x - rx} ${bottom.y} A ${rx} ${ry} 0 0 0 ${bottom.x + rx} ${bottom.y} L ${top.x + rx} ${top.y} Z" fill="${object.mode === 'hole' ? fill : shade(object.color, 0.8)}" />`,
        `<ellipse cx="${top.x}" cy="${top.y}" rx="${rx}" ry="${ry}" fill="${fill}" />`,
      );
      continue;
    }
    const corners = ([
      [-half.x, -half.y],
      [half.x, -half.y],
      [half.x, half.y],
      [-half.x, half.y],
    ] as [number, number][]).map(([cx, cy]) => {
      const radians = (object.rotationZ * Math.PI) / 180;
      return [
        object.x + cx * Math.cos(radians) - cy * Math.sin(radians),
        object.y + cx * Math.sin(radians) + cy * Math.cos(radians),
      ] as [number, number];
    });
    const topFace = corners.map(([cx, cy]) => project(cx, cy, object.z + half.z));
    const bottomFace = corners.map(([cx, cy]) => project(cx, cy, object.z - half.z));
    const path = (points: { x: number; y: number }[]): string =>
      `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} Z`;
    if (!options.topView) {
      parts.push(
        `<path d="${path([bottomFace[0], bottomFace[1], topFace[1], topFace[0]])}" fill="${object.mode === 'hole' ? fill : shade(object.color, 0.72)}" />`,
        `<path d="${path([bottomFace[1], bottomFace[2], topFace[2], topFace[1]])}" fill="${object.mode === 'hole' ? fill : shade(object.color, 0.86)}" />`,
      );
    }
    parts.push(`<path d="${path(topFace)}" fill="${fill}" />`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="${minX - pad} ${minY - pad} ${spanX} ${spanY}" role="img" aria-hidden="true" focusable="false"><defs>${stripePattern()}</defs>${parts.join('')}</svg>`;
};

/** The thin-stroke doodle shown by empty states. */
export const emptyStateDoodle = (): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 90" width="180" height="90" aria-hidden="true" focusable="false" class="qy-doodle">
     <ellipse cx="34" cy="26" rx="18" ry="7" fill="none" stroke="#2742a6" stroke-width="2" />
     <path d="M16 26v28a18 7 0 0 0 36 0V26" fill="none" stroke="#2742a6" stroke-width="2" />
     <path d="M78 64V40a16 16 0 0 1 32 0v24" fill="none" stroke="#1552f0" stroke-width="2" />
     <path d="M124 70h44" fill="none" stroke="#5b6472" stroke-width="2" stroke-dasharray="6 7" />
   </svg>`;
