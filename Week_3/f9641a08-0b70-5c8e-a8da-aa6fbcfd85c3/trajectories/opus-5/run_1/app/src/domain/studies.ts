import { COLOUR_HEX } from './constants';

function shade(hex: string, amount: number): string {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  const mixed = channels.map((channel) =>
    Math.max(0, Math.min(255, Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount))))
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function greyscale(hex: string): string {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  const level = Math.round(0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2]);
  return `#${level.toString(16).padStart(2, '0').repeat(3)}`;
}

export type StudyOptions = {
  category: string;
  colour: string;
  study: string;
  grey?: boolean;
};

export function renderStudy(options: StudyOptions): string {
  const base = COLOUR_HEX[options.colour] ?? '#6b7074';
  const body = options.grey === true ? greyscale(base) : base;
  const dark = shade(body, -0.35);
  const light = shade(body, 0.25);
  const ground = options.grey === true ? '#2a2c2e' : '#232528';

  const tall = options.category === 'luggage';
  const wide = options.category === 'totes';
  const width = tall ? 150 : wide ? 210 : 170;
  const height = tall ? 230 : wide ? 150 : 200;
  const x = (320 - width) / 2;
  const y = (320 - height) / 2 + 10;

  const parts: string[] = [];
  parts.push(`<rect width="320" height="320" fill="${ground}"/>`);

  if (options.study === 'Side') {
    parts.push(`<rect x="${x + 30}" y="${y}" width="${width - 60}" height="${height}" fill="${body}"/>`);
    parts.push(`<rect x="${x + 30}" y="${y}" width="14" height="${height}" fill="${dark}"/>`);
    parts.push(`<rect x="${x + width / 2 - 24}" y="${y - 26}" width="48" height="26" fill="${light}"/>`);
  } else if (options.study === 'Back') {
    parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${dark}"/>`);
    parts.push(`<rect x="${x + 18}" y="${y + 24}" width="22" height="${height - 70}" fill="${body}"/>`);
    parts.push(`<rect x="${x + width - 40}" y="${y + 24}" width="22" height="${height - 70}" fill="${body}"/>`);
  } else if (options.study === 'Open') {
    parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${body}"/>`);
    parts.push(`<rect x="${x + 16}" y="${y + 16}" width="${width - 32}" height="${height - 32}" fill="${dark}"/>`);
    parts.push(`<rect x="${x + 30}" y="${y + 30}" width="${width - 60}" height="${(height - 60) / 2}" fill="${light}"/>`);
  } else {
    parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${body}"/>`);
    parts.push(`<rect x="${x + width / 3}" y="${y}" width="10" height="${height}" fill="${dark}"/>`);
    parts.push(`<rect x="${x + (2 * width) / 3}" y="${y}" width="10" height="${height}" fill="${dark}"/>`);
    parts.push(`<rect x="${x + width / 2 - 26}" y="${y - 24}" width="52" height="24" fill="${light}"/>`);
  }

  if (tall) {
    parts.push(`<rect x="${x + 12}" y="${y + height}" width="20" height="14" fill="${dark}"/>`);
    parts.push(`<rect x="${x + width - 32}" y="${y + height}" width="20" height="14" fill="${dark}"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320" role="img"><title>${options.study}</title>${parts.join('')}</svg>`;
}
