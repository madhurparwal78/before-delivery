/** One variant's spec sheet, laid out with the same hairline rules as the site. */

import { PAGE, PdfDocument } from "./document.js";
import { PRODUCT_PAGE_CEILING_MM, soloPool } from "../../shared/lightpool.js";
import { formatMoney } from "../../shared/money.js";
import type { VariantRecord } from "../domain/catalogue.js";

const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

export function buildSpecSheet(variant: VariantRecord): Buffer {
  const doc = new PdfDocument();
  const pool = soloPool(variant.beam_deg, variant.candela, PRODUCT_PAGE_CEILING_MM);
  let y = PAGE.height - PAGE.margin;

  doc.text("Lightfall", { x: PAGE.margin, y, family: "display", size: 14, grey: 0.45 });
  y -= 30;
  doc.text(variant.product_name, { x: PAGE.margin, y, family: "display", size: 26 });
  y -= 18;
  doc.text(variant.code, { x: PAGE.margin, y, family: "mono", size: 11, grey: 0.4 });
  y -= 14;
  doc.rule({ x: PAGE.margin, y, width: CONTENT_WIDTH });
  y -= 24;

  const specs: ReadonlyArray<readonly [string, string]> = [
    ["Finish", variant.finish_name],
    ["Beam angle", `${variant.beam_deg}\u00b0`],
    ["Colour temperature", `${variant.cct_k}K`],
    ["Lumens", `${variant.lumens} lumens`],
    ["Candela", `${variant.candela} cd`],
    ["Power", `${variant.watts} W`],
    ["CRI", String(variant.cri)],
    ["IP rating", variant.ip_rating],
    ["Pool at 2.7 m", `${pool.pool_diameter_mm} mm`],
    ["Centre at 2.7 m", `${pool.centre_lux} lux`],
    ["Retail price", `${formatMoney(variant.retail_price_cents)} + GST`],
  ];

  doc.text("Specification", { x: PAGE.margin, y, family: "bodyStrong", size: 12 });
  y -= 18;
  for (const [label, value] of specs) {
    doc.text(label, { x: PAGE.margin, y, family: "body", size: 10, grey: 0.35 });
    doc.text(value, { x: PAGE.width - PAGE.margin, y, family: "mono", size: 10, align: "right" });
    y -= 6;
    doc.rule({ x: PAGE.margin, y, width: CONTENT_WIDTH, grey: 0.88 });
    y -= 13;
  }

  y -= 12;
  doc.text("Photometrics are measured at a 2.7 m ceiling height.", {
    x: PAGE.margin,
    y,
    family: "body",
    size: 9,
    grey: 0.45,
  });
  y -= 14;
  doc.text("Southerly Light Works \u00b7 \u014ctautahi Christchurch", {
    x: PAGE.margin,
    y,
    family: "body",
    size: 9,
    grey: 0.45,
  });

  return doc.build();
}
