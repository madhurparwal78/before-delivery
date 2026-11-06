/**
 * Procedural pencil-line frames: the only imagery in the app. Every drawing is
 * worked out from its seed, so the same frame always draws the same way.
 */

function seededNumbers(seed: number): () => number {
  let state = (seed * 2654435761) % 4294967296 || 1;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

export type DrawingOptions = {
  width?: number;
  height?: number;
  label?: string;
};

/** A drawn storyboard frame: horizon, figures and hatching in pencil lines. */
export function frameSvg(seed: number, options: DrawingOptions = {}): string {
  const width = options.width ?? 1280;
  const height = options.height ?? 720;
  const next = seededNumbers(seed + 7);
  const parts: string[] = [];

  const horizon = height * (0.45 + next() * 0.2);
  parts.push(
    `<path d="M0 ${round(horizon)} L${width} ${round(horizon + (next() - 0.5) * 18)}" />`,
  );

  const buildings = 3 + Math.floor(next() * 4);
  let cursor = width * 0.04;
  for (let index = 0; index < buildings; index += 1) {
    const buildingWidth = width * (0.08 + next() * 0.12);
    const buildingHeight = height * (0.12 + next() * 0.3);
    const left = round(cursor);
    const right = round(cursor + buildingWidth);
    const top = round(horizon - buildingHeight);
    parts.push(
      `<path d="M${left} ${round(horizon)} L${left} ${top} L${right} ${top} L${right} ${round(
        horizon,
      )}" />`,
    );
    const windows = 2 + Math.floor(next() * 3);
    for (let row = 1; row <= windows; row += 1) {
      const y = round(top + ((horizon - top) * row) / (windows + 1));
      parts.push(`<path d="M${round(left + 8)} ${y} L${round(right - 8)} ${y} " />`);
    }
    cursor = cursor + buildingWidth + width * (0.01 + next() * 0.04);
    if (cursor > width * 0.95) break;
  }

  const figures = 1 + Math.floor(next() * 3);
  for (let index = 0; index < figures; index += 1) {
    const x = round(width * (0.12 + next() * 0.72));
    const base = round(horizon + height * (0.08 + next() * 0.3));
    const tall = round(height * (0.1 + next() * 0.12));
    parts.push(
      `<circle cx="${x}" cy="${base - tall}" r="${round(tall * 0.18)}" />`,
      `<path d="M${x} ${round(base - tall + tall * 0.18)} L${x} ${round(base - tall * 0.35)}" />`,
      `<path d="M${round(x - tall * 0.22)} ${base} L${x} ${round(
        base - tall * 0.35,
      )} L${round(x + tall * 0.22)} ${base}" />`,
      `<path d="M${round(x - tall * 0.28)} ${round(base - tall * 0.62)} L${x} ${round(
        base - tall * 0.78,
      )} L${round(x + tall * 0.28)} ${round(base - tall * 0.62)}" />`,
    );
  }

  const hatches = 8 + Math.floor(next() * 10);
  for (let index = 0; index < hatches; index += 1) {
    const x = round(width * next());
    const y = round(horizon + (height - horizon) * next());
    const run = round(width * (0.02 + next() * 0.05));
    parts.push(`<path d="M${x} ${y} L${round(x + run)} ${round(y - run * 0.32)}" />`);
  }

  const caption =
    options.label === undefined
      ? ''
      : `<text x="24" y="${height - 24}" font-family="Libre Franklin, sans-serif" font-size="${round(
          height * 0.06,
        )}" font-weight="700" fill="#141414">${escapeXml(options.label)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Drawn storyboard frame"><rect width="${width}" height="${height}" fill="#ffffff"/><g fill="none" stroke="#141414" stroke-width="${round(
    Math.max(1.4, height / 420),
  )}" stroke-linecap="round" stroke-linejoin="round" opacity="0.88">${parts.join(
    '',
  )}</g>${caption}</svg>`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function escapeXml(text: string): string {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;');
}

/** A seed from a frame's file name, so `frame-7.svg` always draws frame 7. */
export function seedOfFileName(fileName: string): number {
  const digits = /(\d+)/.exec(fileName);
  return digits ? Number(digits[1]) : fileName.length;
}
