import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clusterDotTotal, clusterNoteIds, rankClusters } from '../domain/counts.js';
import { renderCsv } from '../domain/csv.js';
import { formatAmountForDisplay } from '../domain/money.js';
import type { StoredCluster, StoredFrame, StoredNote } from '../domain/views.js';
import type { BoardData } from '../board/repository.js';
import { renderPdf, wrapText, type PdfPage, type RectangleRun, type TextRun } from './pdf.js';
import { Raster, wrapForRaster, type Rgb } from './png.js';
import { TrueTypeFont } from './truetype.js';

const FONT_DIRECTORY = resolve(fileURLToPath(new URL('../../../assets/fonts', import.meta.url)));

export interface RecapFonts {
  readonly sans: TrueTypeFont;
  readonly sansBold: TrueTypeFont;
  readonly serif: TrueTypeFont;
}

let cachedFonts: RecapFonts | null = null;

export async function recapFonts(): Promise<RecapFonts> {
  if (cachedFonts !== null) return cachedFonts;
  const [sans, sansBold, serif] = await Promise.all([
    readFile(resolve(FONT_DIRECTORY, 'IBMPlexSans.ttf')),
    readFile(resolve(FONT_DIRECTORY, 'IBMPlexSans-SemiBold.ttf')),
    readFile(resolve(FONT_DIRECTORY, 'InstrumentSerif.ttf')),
  ]);
  cachedFonts = {
    sans: new TrueTypeFont(sans, 'IBMPlexSans'),
    sansBold: new TrueTypeFont(sansBold, 'IBMPlexSans-SemiBold'),
    serif: new TrueTypeFont(serif, 'InstrumentSerif'),
  };
  return cachedFonts;
}

/**
 * The recap covers frames that are not in trash and notes that are revealed and not
 * facilitator-only. It never includes author names.
 */
export interface RecapBoard {
  readonly frames: readonly StoredFrame[];
  readonly clusters: readonly StoredCluster[];
  readonly notes: readonly StoredNote[];
  readonly dotTotals: ReadonlyMap<string, number>;
}

export function recapBoardOf(board: BoardData): RecapBoard {
  const notes = board.notes.filter((note) => note.revealed && !note.facilitatorOnly);
  const dotTotals = new Map(
    board.clusters.map((cluster) => [cluster.id, clusterDotTotal(cluster.id, board.ledger)]),
  );
  return { frames: [...board.frames].sort((a, b) => a.position - b.position), clusters: board.clusters, notes, dotTotals };
}

export interface RankedRecapCluster {
  readonly cluster: StoredCluster;
  readonly frame: StoredFrame;
  readonly dotTotal: number;
  readonly noteTexts: readonly string[];
}

export function rankRecapClusters(board: RecapBoard): RankedRecapCluster[] {
  const framesById = new Map(board.frames.map((frame) => [frame.id, frame]));
  const notesById = new Map(board.notes.map((note) => [note.id, note]));
  const rankable = board.clusters.flatMap((cluster) => {
    const frame = framesById.get(cluster.frameId);
    if (!frame) return [];
    return [{ cluster, frame, dotTotal: board.dotTotals.get(cluster.id) ?? 0 }];
  });
  return rankClusters(rankable).map((entry) => ({
    ...entry,
    noteTexts: clusterNoteIds(entry.cluster.id, board.notes).flatMap((noteId) => {
      const note = notesById.get(noteId);
      return note ? [noteText(note)] : [];
    }),
  }));
}

function noteText(note: StoredNote): string {
  return note.kind === 'image' ? '[image]' : (note.text ?? '');
}

/** Clusters of one frame, ordered by dot total descending then title ignoring case. */
function frameClustersInOrder(board: RecapBoard, frame: StoredFrame): StoredCluster[] {
  return board.clusters
    .filter((cluster) => cluster.frameId === frame.id)
    .sort((a, b) => {
      const left = board.dotTotals.get(a.id) ?? 0;
      const right = board.dotTotals.get(b.id) ?? 0;
      if (left !== right) return right - left;
      const leftTitle = a.title.toLocaleLowerCase();
      const rightTitle = b.title.toLocaleLowerCase();
      if (leftTitle !== rightTitle) return leftTitle < rightTitle ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
}

/**
 * Rows ordered by frame rail position, then by cluster, then by order within the cluster.
 * Unclustered notes come last in each frame, by creation time.
 */
export function recapCsv(board: RecapBoard): Buffer {
  const notesById = new Map(board.notes.map((note) => [note.id, note]));
  const rows: string[][] = [];
  for (const frame of board.frames) {
    for (const cluster of frameClustersInOrder(board, frame)) {
      const dots = String(board.dotTotals.get(cluster.id) ?? 0);
      for (const noteId of clusterNoteIds(cluster.id, board.notes)) {
        const note = notesById.get(noteId);
        if (!note) continue;
        rows.push([frame.title, cluster.title, noteText(note), dots]);
      }
    }
    const unclustered = board.notes
      .filter((note) => note.frameId === frame.id && note.clusterId === null)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const note of unclustered) {
      // `cluster` and `cluster_dots` are empty for unclustered notes.
      rows.push([frame.title, '', noteText(note), '']);
    }
  }
  return renderCsv(rows);
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;

const PDF_INK: readonly [number, number, number] = [0.09, 0.08, 0.07];
const PDF_STICKY: readonly [number, number, number] = [0.969, 0.878, 0.486];
const PDF_STICKY_EDGE: readonly [number, number, number] = [0.839, 0.737, 0.337];

export interface RecapPdfInput {
  readonly title: string;
  readonly board: RecapBoard;
  readonly invoice: { readonly number: string; readonly amount: string } | null;
}

/** A cover page with the cluster ranking, then one page per frame in rail order. */
export async function recapPdf(input: RecapPdfInput): Promise<Buffer> {
  const fonts = await recapFonts();
  const ranking = rankRecapClusters(input.board);
  const pages: PdfPage[] = [coverPage(input, ranking, fonts)];
  for (const frame of input.board.frames) pages.push(framePage(input.board, frame, fonts));
  return renderPdf({
    title: `Recap: ${input.title}`,
    pages,
    fonts: [
      { resourceName: 'FSans', font: fonts.sans },
      { resourceName: 'FSerif', font: fonts.serif },
    ],
  });
}

function coverPage(input: RecapPdfInput, ranking: readonly RankedRecapCluster[], fonts: RecapFonts): PdfPage {
  const texts: TextRun[] = [];
  let y = PAGE_HEIGHT - MARGIN - 18;
  for (const line of wrapText(fonts.serif, `Recap: ${input.title}`, 26, PAGE_WIDTH - MARGIN * 2, 3)) {
    texts.push({ text: line, x: MARGIN, y, size: 26, fontName: 'FSerif' });
    y -= 32;
  }
  if (input.invoice !== null) {
    y -= 8;
    texts.push({
      text: `Invoice ${input.invoice.number} — €${formatAmountForDisplay(input.invoice.amount)}`,
      x: MARGIN,
      y,
      size: 11,
      fontName: 'FSans',
    });
    y -= 24;
  }
  y -= 12;
  texts.push({ text: 'Cluster ranking', x: MARGIN, y, size: 16, fontName: 'FSerif' });
  y -= 26;
  for (const entry of ranking) {
    if (y < MARGIN + 40) break;
    texts.push({
      text: `${entry.cluster.title} — ${entry.dotTotal} dots`,
      x: MARGIN,
      y,
      size: 12,
      fontName: 'FSans',
    });
    y -= 16;
    texts.push({ text: entry.frame.title, x: MARGIN + 12, y, size: 9, fontName: 'FSans' });
    y -= 15;
    for (const text of entry.noteTexts) {
      if (y < MARGIN + 20) break;
      for (const line of wrapText(fonts.sans, text, 10, PAGE_WIDTH - MARGIN * 2 - 24, 2)) {
        texts.push({ text: line, x: MARGIN + 24, y, size: 10, fontName: 'FSans' });
        y -= 13;
      }
    }
    y -= 10;
  }
  return { width: PAGE_WIDTH, height: PAGE_HEIGHT, rectangles: [], texts };
}

function framePage(board: RecapBoard, frame: StoredFrame, fonts: RecapFonts): PdfPage {
  const texts: TextRun[] = [];
  const rectangles: RectangleRun[] = [];
  let y = PAGE_HEIGHT - MARGIN - 16;
  texts.push({ text: frame.title, x: MARGIN, y, size: 22, fontName: 'FSerif' });
  y -= 20;
  const count = board.notes.filter((note) => note.frameId === frame.id).length;
  texts.push({
    text: count === 1 ? '1 note' : `${count} notes`,
    x: MARGIN,
    y,
    size: 10,
    fontName: 'FSans',
  });
  y -= 28;

  const notesById = new Map(board.notes.map((note) => [note.id, note]));
  const render = (label: string | null, notes: readonly StoredNote[], dots: number | null): void => {
    if (notes.length === 0) return;
    if (y < MARGIN + 60) return;
    if (label !== null) {
      texts.push({
        text: dots === null ? label : `${label} — ${dots} dots`,
        x: MARGIN,
        y,
        size: 12,
        fontName: 'FSerif',
      });
      y -= 18;
    }
    for (const note of notes) {
      const lines = wrapText(fonts.sans, noteText(note), 10, PAGE_WIDTH - MARGIN * 2 - 20, 4);
      const height = Math.max(28, lines.length * 13 + 14);
      if (y - height < MARGIN) return;
      rectangles.push({
        x: MARGIN,
        y: y - height + 10,
        width: PAGE_WIDTH - MARGIN * 2,
        height,
        fill: PDF_STICKY,
        stroke: PDF_STICKY_EDGE,
      });
      let lineY = y;
      for (const line of lines) {
        texts.push({ text: line, x: MARGIN + 10, y: lineY, size: 10, fontName: 'FSans' });
        lineY -= 13;
      }
      y -= height + 8;
    }
    y -= 8;
  };

  for (const cluster of frameClustersInOrder(board, frame)) {
    const notes = clusterNoteIds(cluster.id, board.notes).flatMap((noteId) => {
      const note = notesById.get(noteId);
      return note ? [note] : [];
    });
    render(cluster.title, notes, board.dotTotals.get(cluster.id) ?? 0);
  }
  render(
    null,
    board.notes
      .filter((note) => note.frameId === frame.id && note.clusterId === null)
      .sort((a, b) => a.createdAt - b.createdAt),
    null,
  );
  return { width: PAGE_WIDTH, height: PAGE_HEIGHT, rectangles, texts };
}

const PNG_PAPER: Rgb = [250, 248, 243];
const PNG_INK: Rgb = [26, 22, 18];
const PNG_MUTED: Rgb = [122, 115, 106];
const PNG_STICKY: Rgb = [247, 224, 124];
const PNG_STICKY_EDGE: Rgb = [214, 188, 86];

/**
 * Each frame's PNG shows the frame title, its clusters and its notes as stickies, at
 * `width × scale` by `height × scale` pixels.
 */
export async function recapFramePng(
  board: RecapBoard,
  frame: StoredFrame,
  scale: 1 | 2,
): Promise<Buffer> {
  const fonts = await recapFonts();
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const raster = new Raster(width, height, PNG_PAPER);
  raster.strokeRect(2, 2, width - 4, height - 4, PNG_MUTED, Math.max(1, scale));

  const pad = 24 * scale;
  raster.drawText(fonts.serif, frame.title, pad, pad + 22 * scale, 26 * scale, PNG_INK);
  const count = board.notes.filter((note) => note.frameId === frame.id).length;
  raster.drawText(
    fonts.sans,
    count === 1 ? '1 note' : `${count} notes`,
    pad,
    pad + 42 * scale,
    12 * scale,
    PNG_MUTED,
  );

  const notesById = new Map(board.notes.map((note) => [note.id, note]));
  const columnWidth = 210 * scale;
  let columnX = pad;
  let y = pad + 70 * scale;

  const place = (lines: readonly string[], heading: string | null): void => {
    const blockHeight = (heading === null ? 0 : 20 * scale) + lines.length * 15 * scale + 20 * scale;
    if (y + blockHeight > height - pad) {
      columnX += columnWidth + 20 * scale;
      y = pad + 70 * scale;
    }
    if (columnX + columnWidth > width - pad) return;
    if (heading !== null) {
      raster.drawText(fonts.serif, heading, columnX, y, 15 * scale, PNG_INK);
      y += 20 * scale;
    }
    const boxHeight = lines.length * 15 * scale + 18 * scale;
    raster.fillRect(columnX, y - 12 * scale, columnWidth, boxHeight, PNG_STICKY);
    raster.strokeRect(columnX, y - 12 * scale, columnWidth, boxHeight, PNG_STICKY_EDGE, Math.max(1, scale));
    let lineY = y;
    for (const line of lines) {
      raster.drawText(fonts.sans, line, columnX + 8 * scale, lineY, 11 * scale, PNG_INK);
      lineY += 15 * scale;
    }
    y += boxHeight + 10 * scale;
  };

  for (const cluster of frameClustersInOrder(board, frame)) {
    let heading: string | null = `${cluster.title} — ${board.dotTotals.get(cluster.id) ?? 0} dots`;
    for (const noteId of clusterNoteIds(cluster.id, board.notes)) {
      const note = notesById.get(noteId);
      if (!note) continue;
      place(wrapForRaster(fonts.sans, noteText(note), 11 * scale, columnWidth - 16 * scale, 4), heading);
      heading = null;
    }
  }
  for (const note of board.notes
    .filter((note) => note.frameId === frame.id && note.clusterId === null)
    .sort((a, b) => a.createdAt - b.createdAt)) {
    place(wrapForRaster(fonts.sans, noteText(note), 11 * scale, columnWidth - 16 * scale, 4), null);
  }

  return raster.toPng();
}
