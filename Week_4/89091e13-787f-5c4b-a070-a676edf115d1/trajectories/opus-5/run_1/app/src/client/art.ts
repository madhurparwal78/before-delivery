import { fromHex } from '../shared/hex.js';
import { PADDING_NAMESPACE, PARITY_NAMESPACE } from '../shared/namespace.js';

/** Strand light hues stay inside the violet and lavender family. */
function namespaceSeed(namespace: string): number {
  let seed = 0;
  for (const byte of fromHex(namespace)) seed = (seed * 31 + byte) % 1021;
  return seed;
}

export function namespaceHue(namespace: string): number {
  if (namespace === PARITY_NAMESPACE) return 225;
  if (namespace === PADDING_NAMESPACE) return 258;
  return 236 + (namespaceSeed(namespace) % 56);
}

/** Namespace also carries a stroke pattern, so it never depends on hue alone. */
export function namespacePattern(namespace: string): number {
  return namespaceSeed(namespace) % 6;
}

function sized(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth || Number(canvas.getAttribute('width')) || 44;
  const height = canvas.clientHeight || Number(canvas.getAttribute('height')) || 44;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

export interface CellArt {
  namespace: string;
  kind: 'blob' | 'padding' | 'parity' | 'withheld';
  share: string | null;
}

/** One share cell of the square: strand light plus its namespace pattern. */
export function drawCell(canvas: HTMLCanvasElement, cell: CellArt): void {
  const context = sized(canvas);
  if (!context) return;
  const width = canvas.clientWidth || 44;
  const height = canvas.clientHeight || 44;
  if (cell.kind === 'withheld') {
    context.strokeStyle = 'rgba(199, 184, 253, 0.25)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(4, 4);
    context.lineTo(width - 4, height - 4);
    context.moveTo(width - 4, 4);
    context.lineTo(4, height - 4);
    context.stroke();
    return;
  }
  const hue = namespaceHue(cell.namespace);
  const parity = cell.kind === 'parity';
  const bytes = cell.share ? fromHex(cell.share) : new Uint8Array(64);
  const glow = context.createLinearGradient(0, 0, width, height);
  glow.addColorStop(0, `hsla(${hue}, ${parity ? 46 : 84}%, ${parity ? 56 : 66}%, ${parity ? 0.14 : 0.3})`);
  glow.addColorStop(1, `hsla(${hue + 14}, ${parity ? 40 : 78}%, ${parity ? 40 : 52}%, 0.05)`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);

  context.lineWidth = parity ? 0.7 : 1.4;
  context.strokeStyle = `hsla(${hue}, ${parity ? 48 : 88}%, ${parity ? 62 : 76}%, ${parity ? 0.4 : 0.72})`;
  const pattern = namespacePattern(cell.namespace);
  const strands = 4;
  context.beginPath();
  for (let i = 0; i < strands; i++) {
    const offset = ((i + 1) / (strands + 1)) * width;
    const jitter = ((bytes[(i * 7) % bytes.length] ?? 0) / 255 - 0.5) * 5;
    if (pattern === 0) {
      context.moveTo(offset, 3);
      context.lineTo(offset + jitter, height - 3);
    } else if (pattern === 1) {
      context.moveTo(3, offset);
      context.lineTo(width - 3, offset + jitter);
    } else if (pattern === 2) {
      context.moveTo(3, offset);
      context.lineTo(offset, 3);
    } else if (pattern === 3) {
      context.moveTo(offset, 3);
      context.lineTo(offset + jitter, height - 3);
      context.moveTo(3, offset);
      context.lineTo(width - 3, offset + jitter);
    } else if (pattern === 4) {
      context.moveTo(offset, height / 2 - 1);
      context.arc(offset, height / 2, 1.6, 0, Math.PI * 2);
    } else {
      context.moveTo(3, offset);
      context.lineTo(width / 2, offset - 5);
      context.lineTo(width - 3, offset);
    }
  }
  context.stroke();
}

/** Showcase card art drawn from real shares of real blocks. */
export function drawShowcase(canvas: HTMLCanvasElement, namespace: string, shares: string[]): void {
  const context = sized(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const hue = namespaceHue(namespace);
  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, `hsla(${hue}, 70%, 24%, 0.6)`);
  background.addColorStop(1, 'rgba(10, 8, 18, 0.9)');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  const bytes = shares.length > 0 ? fromHex(shares[0]) : new Uint8Array(64);
  context.lineWidth = 1.2;
  for (let strand = 0; strand < 14; strand++) {
    context.strokeStyle = `hsla(${hue + strand}, 88%, ${60 + (strand % 4) * 6}%, 0.5)`;
    context.beginPath();
    const base = (strand / 14) * height;
    context.moveTo(0, base);
    for (let x = 0; x <= width; x += 16) {
      const byte = bytes[(strand * 5 + x / 16) % bytes.length] ?? 0;
      context.lineTo(x, base + ((byte / 255) - 0.5) * 26);
    }
    context.stroke();
  }
}

/** The light node spotlight ring, filled to the node's confidence. */
export function drawRing(canvas: HTMLCanvasElement, confidence: number): void {
  const context = sized(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const radius = Math.min(width, height) / 2 - 14;
  const centreX = width / 2;
  const centreY = height / 2;
  for (let ring = 0; ring < 3; ring++) {
    context.beginPath();
    context.strokeStyle = `hsla(${250 + ring * 8}, 80%, 70%, ${0.12 + ring * 0.05})`;
    context.lineWidth = 1;
    context.arc(centreX, centreY, radius - ring * 7, 0, Math.PI * 2);
    context.stroke();
  }
  const sweep = (Math.max(0, Math.min(100, confidence)) / 100) * Math.PI * 2;
  const glow = context.createLinearGradient(0, 0, width, height);
  glow.addColorStop(0, 'hsla(258, 92%, 74%, 0.95)');
  glow.addColorStop(1, 'hsla(236, 86%, 62%, 0.5)');
  context.strokeStyle = glow;
  context.lineWidth = 4;
  context.beginPath();
  context.arc(centreX, centreY, radius, -Math.PI / 2, -Math.PI / 2 + sweep);
  context.stroke();
}

/** The footer share strand wave, drawn from real share bytes. */
export function drawWave(canvas: HTMLCanvasElement, shares: string[]): void {
  const context = sized(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const bytes = shares.length > 0 ? fromHex(shares.join('')) : new Uint8Array(64);
  for (let strand = 0; strand < 18; strand++) {
    context.strokeStyle = `hsla(${238 + strand * 3}, 86%, ${56 + (strand % 5) * 5}%, ${0.1 + (strand % 6) * 0.05})`;
    context.lineWidth = strand % 3 === 0 ? 1.4 : 0.8;
    context.beginPath();
    const base = height * 0.35 + strand * 4;
    context.moveTo(0, base);
    for (let x = 0; x <= width; x += 12) {
      const byte = bytes[(strand * 13 + x / 12) % bytes.length] ?? 0;
      context.lineTo(x, base + Math.sin(x / 90 + strand) * 16 + ((byte / 255) - 0.5) * 18);
    }
    context.stroke();
  }
}

export type StageKind = 'lay-out' | 'extend' | 'commit';

export interface StageArt {
  kind: StageKind;
  k: number;
  mine: Set<string>;
  dataRoot: string;
  namespaces: string[][];
}

/** One stage of the square walk: lay out, extend, or commit. */
export function drawStage(canvas: HTMLCanvasElement, art: StageArt): void {
  const context = sized(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const cells = art.kind === 'lay-out' ? art.k : 2 * art.k;
  const inset = art.kind === 'commit' ? 18 : 10;
  const size = Math.min(width, height) - inset * 2;
  const step = size / cells;
  const originX = (width - size) / 2;
  const originY = (height - size) / 2;

  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const original = row < art.k && col < art.k;
      const namespace = original ? art.namespaces[row]?.[col] ?? PADDING_NAMESPACE : PARITY_NAMESPACE;
      const hue = namespaceHue(namespace);
      const x = originX + col * step;
      const y = originY + row * step;
      context.fillStyle = original
        ? `hsla(${hue}, 84%, 66%, 0.26)`
        : `hsla(${hue}, 44%, 58%, 0.12)`;
      context.fillRect(x + 1, y + 1, step - 2, step - 2);
      context.strokeStyle = original
        ? `hsla(${hue}, 88%, 74%, 0.5)`
        : `hsla(${hue}, 46%, 64%, 0.26)`;
      context.lineWidth = original ? 1 : 0.6;
      context.strokeRect(x + 1, y + 1, step - 2, step - 2);
      if (art.mine.has(`${row},${col}`)) {
        context.strokeStyle = 'hsla(258, 92%, 82%, 0.95)';
        context.lineWidth = 1.6;
        context.strokeRect(x + 1, y + 1, step - 2, step - 2);
      }
    }
  }

  if (art.kind === 'commit') {
    context.strokeStyle = 'hsla(252, 88%, 80%, 0.8)';
    context.lineWidth = 1.6;
    context.beginPath();
    for (let i = 0; i < 2 * art.k; i++) {
      const y = originY + i * step + step / 2;
      context.moveTo(originX + size + 4, y);
      context.lineTo(originX + size + 13, y);
      const x = originX + i * step + step / 2;
      context.moveTo(x, originY + size + 4);
      context.lineTo(x, originY + size + 13);
    }
    context.stroke();
  }
}

/** The faint strand canvas shown while a panel is loading. */
export function drawFaint(canvas: HTMLCanvasElement): void {
  const context = sized(canvas);
  if (!context) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  context.strokeStyle = 'hsla(252, 80%, 76%, 0.5)';
  context.lineWidth = 1;
  for (let strand = 0; strand < 8; strand++) {
    context.beginPath();
    const base = (strand / 8) * height;
    context.moveTo(0, base);
    for (let x = 0; x <= width; x += 20) {
      context.lineTo(x, base + Math.sin(x / 60 + strand) * 8);
    }
    context.stroke();
  }
}

const canvases = new Set<{ canvas: HTMLCanvasElement; paint: () => void }>();

/** Strand canvases render once, and again on resize. */
export function registerCanvas(canvas: HTMLCanvasElement, paint: () => void): void {
  const entry = { canvas, paint };
  canvases.add(entry);
  requestAnimationFrame(() => {
    if (!canvas.isConnected) {
      canvases.delete(entry);
      return;
    }
    paint();
  });
}

export function repaintCanvases(): void {
  for (const entry of [...canvases]) {
    if (!entry.canvas.isConnected) {
      canvases.delete(entry);
      continue;
    }
    entry.paint();
  }
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(repaintCanvases, 160);
});
