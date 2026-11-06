// The two generated documents: a variant's spec sheet and a project quote at a price display.
import { dollars, MONEY_LABELS, type Totals } from "../shared/money.js";
import { ownLux, poolDiameterMm, REFERENCE_CEILING_MM } from "../shared/lightpool.js";
import type { PriceDisplay } from "../shared/types.js";
import type { VariantRow } from "./catalogue.js";
import { Page, PAGE_HEIGHT, PAGE_WIDTH, renderPdf, type Rgb } from "./pdf.js";

const INK: Rgb = [20, 24, 33];
const MUTED: Rgb = [88, 94, 107];
const RULE: Rgb = [201, 194, 180];
const AMBER: Rgb = [201, 122, 18];
const AMBER_SOFT: Rgb = [250, 226, 186];
const MARGIN = 48;
const FOOTER = "Southerly Light Works · Ōtautahi Christchurch";

function frame(page: Page, eyebrow: string): void {
  page.text(MARGIN, PAGE_HEIGHT - 56, "Lightfall", { font: "serif", size: 20 });
  page.text(PAGE_WIDTH - MARGIN - 160, PAGE_HEIGHT - 52, eyebrow, { size: 8, color: MUTED });
  page.line(MARGIN, PAGE_HEIGHT - 70, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 70, { color: AMBER, width: 1 });
  page.line(MARGIN, 60, PAGE_WIDTH - MARGIN, 60);
  page.text(MARGIN, 44, FOOTER, { size: 8, color: MUTED });
}

interface SpecSheetInput {
  variant: VariantRow;
  family: string;
  watts: number;
  cri: number;
  ipRating: string;
}

export function specSheetPdf({ variant, family, watts, cri, ipRating }: SpecSheetInput): Buffer {
  const page = new Page();
  frame(page, "SPECIFICATION SHEET");
  let y = PAGE_HEIGHT - 120;
  page.text(MARGIN, y, variant.product_name, { font: "serif", size: 30 });
  y -= 22;
  page.text(MARGIN, y, variant.code, { font: "mono", size: 12, color: AMBER });
  y -= 36;

  const rows: [string, string][] = [
    ["Family", family],
    ["Finish", variant.finish_name],
    ["Beam", `${variant.beam_deg}°`],
    ["Colour temperature", `${variant.cct_k}K`],
    ["Lumens", String(variant.lumens)],
    ["Candela", String(variant.candela)],
    ["Power", `${watts} W`],
    ["CRI", String(cri)],
    ["IP rating", ipRating],
  ];
  page.line(MARGIN, y + 12, 300, y + 12);
  for (const [label, value] of rows) {
    page.text(MARGIN, y, label, { size: 10, color: MUTED });
    page.text(170, y, value, { font: "mono", size: 10 });
    page.line(MARGIN, y - 8, 300, y - 8);
    y -= 24;
  }

  // Light-pool diagram: the beam from a 2.7 m ceiling to the floor, drawn to scale.
  const left = 330;
  const right = PAGE_WIDTH - MARGIN;
  const top = PAGE_HEIGHT - 170;
  const floor = top - 220;
  const scale = (floor - top) / -REFERENCE_CEILING_MM;
  const centre = (left + right) / 2;
  const half = (poolDiameterMm(REFERENCE_CEILING_MM, variant.beam_deg) / 2) * scale;
  page.polygon([[centre - 6, top], [centre + 6, top], [centre + half, floor], [centre - half, floor]], AMBER_SOFT);
  page.line(left, top, right, top, { color: INK, width: 1 });
  page.line(left, floor, right, floor, { color: INK, width: 1 });
  page.rect(centre - 10, top - 4, 20, 6, INK);
  page.line(centre - half, floor - 10, centre + half, floor - 10, { color: AMBER, width: 1 });
  page.text(left, top + 8, "Ceiling 2.7 m", { size: 8, color: MUTED });
  page.text(centre - 40, floor - 24, `Pool ${poolDiameterMm(REFERENCE_CEILING_MM, variant.beam_deg)} mm`, { font: "mono", size: 9 });

  y = Math.min(y, floor - 60);
  page.text(MARGIN, y, "Photometrics by ceiling height", { font: "serif", size: 16 });
  y -= 24;
  page.text(MARGIN, y, "Ceiling", { size: 9, color: MUTED });
  page.text(200, y, "Pool diameter", { size: 9, color: MUTED });
  page.text(360, y, "Centre lux", { size: 9, color: MUTED });
  y -= 8;
  page.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  for (const ceiling of [2400, 2700, 3000, 3600, 4000]) {
    y -= 18;
    page.text(MARGIN, y, `${(ceiling / 1000).toFixed(1)} m`, { font: "mono", size: 10 });
    page.text(200, y, `${poolDiameterMm(ceiling, variant.beam_deg)} mm`, { font: "mono", size: 10 });
    page.text(360, y, `${ownLux(variant.candela, ceiling)} lux`, { font: "mono", size: 10 });
    page.line(MARGIN, y - 7, PAGE_WIDTH - MARGIN, y - 7);
  }
  return renderPdf([page], `${variant.product_name} ${variant.code}`);
}

export interface QuoteLine {
  code: string;
  productName: string;
  finishName: string;
  beamDeg: number;
  cctK: number;
  quantity: number;
  unitCents: number;
  lineCents: number;
}

interface QuoteInput {
  projectName: string;
  clientName: string | null;
  senderName: string;
  date: string;
  display: PriceDisplay;
  lines: QuoteLine[];
  totals: Totals;
}

const DISPLAY_LABEL: Record<PriceDisplay, string> = {
  trade: "Trade prices",
  retail: "Retail prices",
  none: "Specification only",
};

export function quotePdf(input: QuoteInput): Buffer {
  const priced = input.display !== "none";
  const page = new Page();
  frame(page, "QUOTE");
  let y = PAGE_HEIGHT - 120;
  page.text(MARGIN, y, input.projectName, { font: "serif", size: 28 });
  y -= 26;
  const meta: [string, string][] = [
    ["Client", input.clientName ?? "—"],
    ["Prepared by", input.senderName],
    ["Date", input.date],
    ["Showing", DISPLAY_LABEL[input.display]],
  ];
  for (const [label, value] of meta) {
    page.text(MARGIN, y, label, { size: 9, color: MUTED });
    page.text(140, y, value, { size: 10 });
    y -= 16;
  }
  y -= 18;
  const columns = priced
    ? { code: MARGIN, spec: 170, qty: 380, unit: 470, total: PAGE_WIDTH - MARGIN }
    : { code: MARGIN, spec: 200, qty: PAGE_WIDTH - MARGIN, unit: 0, total: 0 };
  page.text(columns.code, y, "Code", { size: 9, color: MUTED });
  page.text(columns.spec, y, "Fitting", { size: 9, color: MUTED });
  page.textRight(columns.qty, y, "Qty", { size: 9, color: MUTED });
  if (priced) {
    page.textRight(columns.unit, y, "Unit", { size: 9, color: MUTED });
    page.textRight(columns.total, y, "Line", { size: 9, color: MUTED });
  }
  y -= 8;
  page.line(MARGIN, y, PAGE_WIDTH - MARGIN, y, { color: INK });
  for (const line of input.lines) {
    y -= 18;
    page.text(columns.code, y, line.code, { font: "mono", size: 9 });
    page.text(columns.spec, y, line.productName, { size: 10 });
    page.textRight(columns.qty, y, String(line.quantity), { size: 10 });
    if (priced) {
      page.textRight(columns.unit, y, dollars(line.unitCents), { size: 10 });
      page.textRight(columns.total, y, dollars(line.lineCents), { size: 10 });
    }
    y -= 13;
    page.text(columns.spec, y, `${line.finishName} · ${line.beamDeg}° · ${line.cctK}K`, { size: 8, color: MUTED });
    page.line(MARGIN, y - 7, PAGE_WIDTH - MARGIN, y - 7, { color: RULE });
  }
  if (priced) {
    y -= 30;
    for (const [label, cents] of [
      [MONEY_LABELS.subtotal, input.totals.subtotal_cents],
      [MONEY_LABELS.gst, input.totals.gst_cents],
      [MONEY_LABELS.total, input.totals.total_cents],
    ] as const) {
      page.text(330, y, label, { size: label === MONEY_LABELS.total ? 11 : 10, font: label === MONEY_LABELS.total ? "sansBold" : "sans" });
      page.textRight(PAGE_WIDTH - MARGIN, y, dollars(cents), { size: 11 });
      y -= 20;
    }
  }
  return renderPdf([page], `Quote ${input.projectName}`);
}
