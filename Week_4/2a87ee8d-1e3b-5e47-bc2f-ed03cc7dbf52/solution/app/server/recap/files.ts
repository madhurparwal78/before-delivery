// The recap copies: board PDF, one PNG per frame and the notes CSV. None of them carries author names or
// facilitator-only notes.
import { PdfDocument, type Rgb } from "./pdf.js";
import { Raster } from "./raster.js";
import { wrap } from "./fonts.js";
import { CLUSTER_GAP, CLUSTER_HEADER, NOTE_HEIGHT, NOTE_WIDTH } from "../../shared/layout.js";

export interface RecapNote {
  id: string;
  kind: "text" | "image";
  text: string | null;
  x: number;
  y: number;
}

interface RecapCluster {
  id: string;
  title: string;
  x: number;
  y: number;
  dots: number;
  notes: RecapNote[];
}

export interface RecapFrame {
  id: string;
  title: string;
  width: number;
  height: number;
  clusters: RecapCluster[];
  loose: RecapNote[];
}

export interface RecapContent {
  title: string;
  when: string;
  frames: RecapFrame[];
  ranking: { frame: string; title: string; dots: number; notes: string[] }[];
}

export function noteText(n: RecapNote): string {
  return n.kind === "image" ? "[image]" : (n.text ?? "");
}

const INK: Rgb = [42, 36, 32];
const MUTED: Rgb = [103, 93, 82];
const PAPER: Rgb = [246, 241, 231];
const STICKY: Rgb = [251, 228, 140];
const EDGE: Rgb = [217, 185, 78];
const LEDGE: Rgb = [199, 162, 59];
const RULE: Rgb = [207, 197, 182];

/** The CSV cell rule (adapted from kit/modules/csv_safe): formula starts made inert, RFC 4180 quoting. */
function csvCell(value: string | number): string {
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function notesCsv(content: RecapContent): Buffer {
  const rows: (string | number)[][] = [["frame", "cluster", "note", "cluster_dots"]];
  for (const frame of content.frames) {
    for (const cluster of frame.clusters) for (const note of cluster.notes) rows.push([frame.title, cluster.title, noteText(note), cluster.dots]);
    for (const note of frame.loose) rows.push([frame.title, "", noteText(note), ""]);
  }
  return Buffer.from(rows.map((r) => `${r.map(csvCell).join(",")}\r\n`).join(""), "utf8");
}

export function boardPdf(content: RecapContent): Buffer {
  const doc = new PdfDocument(842, 595);
  const margin = 56;
  let y = 0;
  const ensure = (needed: number) => {
    if (y + needed > doc.height - margin) {
      doc.addPage();
      y = margin;
    }
  };
  y = margin + 30;
  doc.text(`Recap: ${content.title}`, margin, y, 30, "serif", INK);
  y += 22;
  doc.text(content.when, margin, y, 11, "sans", MUTED);
  y += 30;
  doc.line(margin, y, doc.width - margin, y, RULE);
  y += 30;
  doc.text("Cluster ranking", margin, y, 20, "serif", INK);
  y += 24;
  content.ranking.forEach((row, index) => {
    ensure(40);
    doc.text(`${index + 1}. ${row.title}`, margin, y, 13, "sansBold", INK);
    doc.text(`${row.dots} ${row.dots === 1 ? "dot" : "dots"} · ${row.frame}`, doc.width - margin - 180, y, 11, "sans", MUTED);
    y += 18;
    for (const note of row.notes) {
      for (const line of wrap("sans", note, 11, doc.width - 2 * margin - 24)) {
        ensure(16);
        doc.text(line, margin + 24, y, 11, "sans", INK);
        y += 15;
      }
    }
    y += 8;
    doc.line(margin, y, doc.width - margin, y, RULE);
    y += 18;
  });
  if (content.ranking.length === 0) {
    doc.text("No clusters were made in this workshop.", margin, y, 11, "sans", MUTED);
  }
  for (const frame of content.frames) {
    doc.addPage();
    y = margin + 26;
    doc.text(frame.title, margin, y, 26, "serif", INK);
    y += 16;
    doc.line(margin, y, doc.width - margin, y, RULE);
    y += 26;
    const block = (heading: string | null, notes: RecapNote[]) => {
      if (heading) {
        ensure(30);
        doc.text(heading, margin, y, 14, "sansBold", INK);
        y += 20;
      }
      for (const note of notes) {
        const lines = wrap("sans", noteText(note), 11, 300);
        ensure(lines.length * 15 + 20);
        doc.rect(margin, y - 12, 324, lines.length * 15 + 12, STICKY, EDGE, 0.75);
        for (const line of lines) {
          doc.text(line, margin + 12, y + 2, 11, "sans", INK);
          y += 15;
        }
        y += 14;
      }
      y += 6;
    };
    for (const cluster of frame.clusters) block(`${cluster.title} — ${cluster.dots} ${cluster.dots === 1 ? "dot" : "dots"}`, cluster.notes);
    if (frame.loose.length) block(frame.clusters.length ? "Not clustered" : null, frame.loose);
    if (!frame.clusters.length && !frame.loose.length) doc.text("No notes in this frame.", margin, y, 11, "sans", MUTED);
  }
  return doc.render({ title: `Recap: ${content.title}`, author: "Lanternfold Rooms" });
}

function sticky(r: Raster, note: RecapNote, x: number, y: number, s: number) {
  r.fillRect(x + 3 * s, y + 3 * s, NOTE_WIDTH * s, NOTE_HEIGHT * s, LEDGE);
  r.fillRect(x, y, NOTE_WIDTH * s, NOTE_HEIGHT * s, STICKY);
  r.strokeRect(x, y, NOTE_WIDTH * s, NOTE_HEIGHT * s, EDGE, Math.max(1, s));
  const lines = wrap("sans", noteText(note), 13 * s, (NOTE_WIDTH - 24) * s).slice(0, 4);
  lines.forEach((line, i) => r.text(line, x + 12 * s, y + (26 + i * 18) * s, 13 * s, "sans", INK));
}

export function framePng(frame: RecapFrame, scale: number): Buffer {
  const r = new Raster(Math.round(frame.width * scale), Math.round(frame.height * scale), PAPER);
  for (let gy = 12; gy < frame.height; gy += 24) for (let gx = 12; gx < frame.width; gx += 24) r.fillRect(gx * scale, gy * scale, 1.5 * scale, 1.5 * scale, RULE);
  r.strokeRect(0, 0, r.width, r.height, MUTED, Math.max(1, scale));
  r.text(frame.title, 20 * scale, 44 * scale, 28 * scale, "serif", INK);
  for (const note of frame.loose) sticky(r, note, note.x * scale, note.y * scale, scale);
  for (const cluster of frame.clusters) {
    const height = CLUSTER_HEADER + cluster.notes.length * (NOTE_HEIGHT + CLUSTER_GAP) + 12;
    r.fillRect(cluster.x * scale, cluster.y * scale, (NOTE_WIDTH + 24) * scale, height * scale, [239, 232, 218]);
    r.strokeRect(cluster.x * scale, cluster.y * scale, (NOTE_WIDTH + 24) * scale, height * scale, RULE, Math.max(1, scale));
    r.text(`${cluster.title} · ${cluster.notes.length}`, (cluster.x + 12) * scale, (cluster.y + 28) * scale, 14 * scale, "sansBold", INK);
    cluster.notes.forEach((note, i) => sticky(r, note, (cluster.x + 12) * scale, (cluster.y + CLUSTER_HEADER + i * (NOTE_HEIGHT + CLUSTER_GAP)) * scale, scale));
  }
  return r.png();
}
