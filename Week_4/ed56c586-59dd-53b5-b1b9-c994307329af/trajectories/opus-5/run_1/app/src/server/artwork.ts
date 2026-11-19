/**
 * Original procedural artwork for the project covers and preview frames.
 * Every object the media library holds is drawn here, by this app, from the
 * seed data: there is no third-party or downloaded imagery anywhere on the site.
 */

import { FRAMES_PER_PROJECT, type Project } from '../shared/seed.js';

const PAPER = '#eef0e6';
const INK = '#14161d';
const ACCENT = '#2b3fd4';
const RULE = '#8c9a8a';

/** A small deterministic generator, so each key always draws the same art. */
const makeRandom = (seedText: string): (() => number) => {
  let seed = 0x811c9dc5;
  for (const char of seedText) {
    seed ^= char.codePointAt(0) ?? 0;
    seed = Math.imul(seed, 0x01000193) >>> 0;
  }
  return () => {
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0x100000000;
  };
};

const round = (value: number): number => Math.round(value * 100) / 100;

const svg = (width: number, height: number, body: string): Buffer =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
      `width="${width}" height="${height}" role="presentation">${body}</svg>`,
    'utf8',
  );

const hairlines = (
  random: () => number,
  width: number,
  height: number,
  count: number,
): string => {
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const y = round(height * (0.08 + 0.84 * random()));
    const x = round(width * 0.06 + width * 0.1 * random());
    const length = round(width * (0.2 + 0.6 * random()));
    out += `<path d="M${x} ${y} h${length}" stroke="${RULE}" stroke-width="1" fill="none" opacity="0.55"/>`;
  }
  return out;
};

const monogram = (x: number, y: number, size: number, colour: string, opacity: number): string =>
  `<g transform="translate(${x} ${y})" fill="none" stroke="${colour}" stroke-width="${round(size * 0.06)}" opacity="${opacity}">` +
  `<circle cx="${round(size * 0.5)}" cy="${round(size * 0.5)}" r="${round(size * 0.42)}"/>` +
  `<path d="M${round(size * 0.78)} ${round(size * 0.62)} L${round(size * 1.08)} ${round(size * 1.02)}"/>` +
  `<path d="M${round(size * 1.02)} ${round(size * 0.12)} v${round(size * 0.78)}"/>` +
  `<path d="M${round(size * 1.02)} ${round(size * 0.12)} h${round(size * 0.3)} a${round(size * 0.22)} ${round(size * 0.22)} 0 0 1 0 ${round(size * 0.44)} h${round(size * 0.3)}"/>` +
  '</g>';

export const coverArtwork = (project: Project): Buffer => {
  const width = 1200;
  const height = 900;
  const random = makeRandom(`cover:${project.slug}`);
  let body = `<rect width="${width}" height="${height}" fill="${project.tint}"/>`;
  body += `<rect x="48" y="48" width="${width - 96}" height="${height - 96}" fill="none" stroke="${INK}" stroke-width="2"/>`;

  const bars = 5 + Math.floor(random() * 4);
  for (let i = 0; i < bars; i += 1) {
    const barWidth = round(width * (0.16 + 0.5 * random()));
    const barHeight = round(28 + 70 * random());
    const x = round(90 + (width * 0.45 - 90) * random());
    const y = round(140 + i * ((height - 280) / bars));
    const fill = i % 3 === 0 ? ACCENT : INK;
    body += `<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${fill}" opacity="${i % 3 === 0 ? 0.85 : 0.14}"/>`;
  }

  body += monogram(width * 0.52, height * 0.2, 420, INK, 0.5);
  body += hairlines(random, width, height, 7);

  const discs = 3 + Math.floor(random() * 3);
  for (let i = 0; i < discs; i += 1) {
    const r = round(26 + 64 * random());
    body += `<circle cx="${round(width * (0.12 + 0.76 * random()))}" cy="${round(height * (0.12 + 0.76 * random()))}" r="${r}" fill="none" stroke="${ACCENT}" stroke-width="3"/>`;
  }

  body += `<rect x="48" y="${height - 150}" width="${width - 96}" height="102" fill="${INK}"/>`;
  body += `<text x="88" y="${height - 86}" fill="${PAPER}" font-family="serif" font-size="56">${project.title}</text>`;
  body += `<text x="${width - 88}" y="${height - 86}" fill="${PAPER}" font-family="monospace" font-size="38" text-anchor="end">${project.year}</text>`;
  return svg(width, height, body);
};

export const frameArtwork = (project: Project, frame: number): Buffer => {
  const width = 1600;
  const height = 1000;
  const random = makeRandom(`frame:${project.slug}:${frame}`);
  const step = (frame - 1) / (FRAMES_PER_PROJECT - 1);

  let body = `<rect width="${width}" height="${height}" fill="${PAPER}"/>`;
  body += `<rect x="0" y="0" width="${width}" height="76" fill="${INK}"/>`;
  body += `<text x="32" y="50" fill="${PAPER}" font-family="monospace" font-size="34">${project.slug}</text>`;
  body += `<text x="${width - 32}" y="50" fill="${PAPER}" font-family="monospace" font-size="34" text-anchor="end">frame ${frame} / ${FRAMES_PER_PROJECT}</text>`;

  const stageTop = 96;
  const stageHeight = height - stageTop - 96;
  body += `<rect x="0" y="${stageTop}" width="${width}" height="${stageHeight}" fill="${project.tint}" opacity="0.5"/>`;

  // Each callout's published region becomes a block of interface art, lit while
  // the frame sits inside that callout's range.
  for (const callout of project.callouts) {
    const x = round((callout.region.left / 100) * width);
    const y = round((callout.region.top / 100) * height);
    const w = round((callout.region.width / 100) * width);
    const h = round((callout.region.height / 100) * height);
    const lit = frame >= callout.from && frame <= callout.to;
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${lit ? ACCENT : INK}" opacity="${lit ? 0.18 : 0.07}"/>`;
    body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${lit ? ACCENT : RULE}" stroke-width="${lit ? 4 : 2}"/>`;

    const rows = 2 + Math.floor((h / 120) % 5);
    for (let r = 0; r < rows; r += 1) {
      const rowY = round(y + 24 + r * ((h - 40) / rows));
      const rowW = round(w * (0.3 + 0.6 * random()) * (lit ? 0.5 + 0.5 * step : 0.6));
      body += `<rect x="${round(x + 20)}" y="${rowY}" width="${Math.max(12, rowW)}" height="10" fill="${INK}" opacity="0.55"/>`;
    }
    body += `<text x="${round(x + 16)}" y="${round(y + h - 14)}" fill="${INK}" font-family="monospace" font-size="26" opacity="0.8">${callout.n}</text>`;
  }

  // A travelling marker and a wave that both move with the frame number.
  const markerX = round(80 + (width - 160) * step);
  body += `<path d="M${markerX} ${stageTop} v${stageHeight}" stroke="${ACCENT}" stroke-width="5"/>`;
  let wave = `M80 ${round(height - 150)}`;
  for (let i = 1; i <= 24; i += 1) {
    const wx = round(80 + ((width - 160) / 24) * i);
    const wy = round(
      height - 150 - Math.sin((i / 24) * Math.PI * (1 + frame)) * (40 + 40 * step),
    );
    wave += ` L${wx} ${wy}`;
  }
  body += `<path d="${wave}" fill="none" stroke="${INK}" stroke-width="3" opacity="0.7"/>`;

  // Six ticks, with the shown frame's tick filled.
  for (let i = 1; i <= FRAMES_PER_PROJECT; i += 1) {
    const tx = round(width / 2 - 170 + (i - 1) * 64);
    const on = i === frame;
    body += `<rect x="${tx}" y="${height - 60}" width="${on ? 44 : 28}" height="${on ? 28 : 14}" fill="${on ? ACCENT : INK}" opacity="${on ? 1 : 0.3}"/>`;
  }
  body += hairlines(random, width, height, 4);
  return svg(width, height, body);
};
