import * as PImage from "pureimage";
import { PassThrough } from "node:stream";
import type { SerializedView } from "../routes/exports.js";
import { valueTicks, categoricalColor } from "../../shared/chart.js";
import { displayNumber } from "../../shared/display.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface PngSheet {
  name: string;
  view: SerializedView;
  shape: { rows: unknown[]; columns: unknown[] };
}

let fontsReady: Promise<void> | null = null;

async function ensureFonts(): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../assets/fonts");
      const text = PImage.registerFont(path.join(dir, "lozenge-text-400.ttf"), "LozText");
      const head = PImage.registerFont(path.join(dir, "lozenge-head-700.ttf"), "LozHead");
      await Promise.all([text.loadPromise(), head.loadPromise()]);
    })();
  }
  await fontsReady;
}

/**
 * The PNG export: 1200 by 800 pixels, drawn on the server from the same marks.
 */
export async function renderPng(sheets: PngSheet[], targetName: string, filtersText: string[]): Promise<Buffer> {
  await ensureFonts();
  const img = PImage.make(1200, 800);
  const c = img.getContext("2d");
  c.fillStyle = "#fdf1f7";
  c.fillRect(0, 0, 1200, 800);
  c.fillStyle = "#1a0a14";
  c.font = "26px LozHead";
  c.fillText(targetName, 40, 50);
  c.font = "16px LozText";
  let y = 84;
  for (const f of filtersText.slice(0, 4)) {
    c.fillText(f, 40, y);
    y += 22;
  }
  const sheetsToDraw = sheets.slice(0, 2);
  const panelH = sheetsToDraw.length > 1 ? 320 : 560;
  for (let i = 0; i < sheetsToDraw.length; i++) {
    drawSheetPanel(c, sheetsToDraw[i], 40, 120 + i * (panelH + 20), 1120, panelH);
  }
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    out.on("data", (d: Buffer) => chunks.push(d));
    out.on("end", () => resolve());
    out.on("error", reject);
  });
  await PImage.encodePNGToStream(img, out);
  await done;
  return Buffer.concat(chunks);
}

type Ctx = ReturnType<ReturnType<typeof PImage.make>["getContext"]>;

function drawSheetPanel(
  c: Ctx,
  sheet: PngSheet,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  c.fillStyle = "#ffffff";
  c.fillRect(x, y, w, h);
  c.fillStyle = "#1a0a14";
  c.font = "20px LozHead";
  c.fillText(sheet.name, x + 16, y + 28);
  const v = sheet.view;
  const marks = v.marks;
  const values = marks.map((m) => m.values[0]).filter((val): val is number => val !== null && val !== undefined);
  const { ticks } = valueTicks(values);
  const first = ticks[0] ?? 0;
  const last = ticks[ticks.length - 1] ?? first + 1;
  const span = last - first || 1;
  const plotX = x + 90;
  const plotY = y + 44;
  const plotW = w - 120;
  const plotH = Math.max(40, h - 90);
  c.font = "13px LozText";
  for (const t of ticks) {
    const fy = plotY + plotH - ((t - first) / span) * plotH;
    c.fillStyle = "#1a0a14";
    c.fillText(displayNumber(t), x + 16, fy + 4);
    c.fillStyle = "#e9a0cd";
    c.fillRect(plotX, fy, plotW, 1);
  }
  if (marks.length === 0) return;
  const bandW = plotW / marks.length;
  const zero = plotY + plotH;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    const val = m.values[0];
    const [r, g, b] = categoricalColor(i).split(", ").map(Number);
    const frac = val === null ? 0 : Math.max(0, Math.min(1, (val - first) / span));
    const barH = Math.max(1, Math.abs(frac) * plotH);
    const top = val !== null && val >= 0 ? zero - barH : zero;
    c.fillStyle = `rgba(${r},${g},${b},1)`;
    c.fillRect(plotX + i * bandW + bandW * 0.15, top, bandW * 0.7, barH);
    c.fillStyle = "#1a0a14";
    const label = String(m.dimValues[0] ?? "").slice(0, 12);
    c.fillText(label, plotX + i * bandW + 4, plotY + plotH + 18);
  }
}
