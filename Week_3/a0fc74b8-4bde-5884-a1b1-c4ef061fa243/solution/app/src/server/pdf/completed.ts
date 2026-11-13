import { PdfWriter } from "./writer.js";
import { PdfFile, collectPages } from "./reader.js";
import { pageGeometry } from "./inspect.js";
import { type PdfDict, type PdfValue, array, dict, isArray, isDict, isRef, name, ref } from "./objects.js";
import { ascii, fitSize } from "./text.js";
import { escapeText } from "./objects.js";
import type { FieldKind, Stroke } from "../../shared/types.js";
import { SIGNATURE_PAD_ASPECT } from "../../shared/limits.js";

export interface SealField {
  kind: FieldKind;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
  strokes: Stroke[] | null;
}

interface CertificateData {
  title: string;
  documentId: string;
  originalSha256: string;
  pageCount: number;
  signers: { order: number; name: string; email: string; signedAt: Date }[];
  chainHead: string;
}

const INK = "0.09 0.13 0.20";
const DROPPED_PAGE_KEYS = ["Parent", "Annots", "B", "Thumb", "StructParents", "PieceInfo", "Metadata", "LastModified", "Rotate"];
const FONT_RESOURCE = "UsHelv";

function shownText(field: SealField): string | null {
  if (field.value === null) return null;
  return field.kind === "signature" || field.kind === "initials" ? field.value.replace(/^typed:/, "") : field.value;
}

function strokesContent(strokes: Stroke[], left: number, bottom: number, width: number, height: number): string {
  const scale = Math.min(width / SIGNATURE_PAD_ASPECT, height);
  const offsetX = left + (width - scale * SIGNATURE_PAD_ASPECT) / 2;
  const offsetY = bottom + (height - scale) / 2;
  const lines = [`${INK} RG ${Math.max(0.6, scale * 0.025).toFixed(2)} w 1 J 1 j`];
  for (const stroke of strokes) {
    stroke.forEach(([sx, sy], index) => {
      const px = offsetX + sx * SIGNATURE_PAD_ASPECT * scale;
      const py = offsetY + (1 - sy) * scale;
      lines.push(`${px.toFixed(2)} ${py.toFixed(2)} ${index === 0 ? "m" : "l"}`);
    });
    if (stroke.length === 1) lines.push("h");
    lines.push("S");
  }
  return lines.join("\n");
}

function overlayContent(fields: SealField[], geometry: { x: number; y: number; w: number; h: number }): string {
  const parts = ["q"];
  for (const field of fields) {
    const left = geometry.x + field.x * geometry.w;
    const width = field.w * geometry.w;
    const height = field.h * geometry.h;
    const bottom = geometry.y + geometry.h - (field.y + field.h) * geometry.h;
    if (field.value === "drawn" && field.strokes) {
      parts.push("q", strokesContent(field.strokes, left, bottom, width, height), "Q");
      continue;
    }
    const text = shownText(field);
    if (!text) continue;
    const size = fitSize(text, width - 4, Math.min(height * 0.62, field.kind === "signature" ? 20 : 12), 4);
    const baseline = bottom + (height - size) / 2 + size * 0.22;
    parts.push(
      "q",
      `${left.toFixed(2)} ${bottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re W n`,
      `BT /${FONT_RESOURCE} ${size.toFixed(2)} Tf ${INK} rg ${(left + 2).toFixed(2)} ${baseline.toFixed(2)} Td (${escapeText(text)}) Tj ET`,
      "Q",
    );
  }
  parts.push("Q");
  return parts.join("\n");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function certificateLines(data: CertificateData): string[] {
  const stamp = (date: Date) =>
    `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  return [
    `Document: ${data.title}`,
    `Document ID: ${data.documentId}`,
    `Original SHA-256: ${data.originalSha256}`,
    `Pages in original: ${data.pageCount}`,
    ...data.signers.map((s) => `Signer ${s.order}: ${s.name} <${s.email}> signed ${stamp(s.signedAt)} UTC`),
    `Audit chain head: ${data.chainHead}`,
  ];
}

function certificateContent(data: CertificateData): string {
  const left = 56;
  const parts = [
    `BT /${FONT_RESOURCE} 22 Tf ${INK} rg ${left} 712 Td (Certificate of completion) Tj ET`,
    `0.86 0.80 0.70 RG 0.75 w ${left} 696 m 556 696 l S`,
  ];
  let y = 668;
  for (const line of certificateLines(data)) {
    const size = fitSize(line, 500, 10.5, 5);
    parts.push(`BT /${FONT_RESOURCE} ${size.toFixed(2)} Tf ${INK} rg ${left} ${y} Td (${escapeText(ascii(line))}) Tj ET`);
    y -= 20;
  }
  y -= 12;
  parts.push(
    `BT /${FONT_RESOURCE} 9 Tf 0.35 0.38 0.45 rg ${left} ${y} Td (This record is tamper-evident. It is not a certificate-based digital signature.) Tj ET`,
  );
  return parts.join("\n");
}

function clonedResources(file: PdfFile, resources: PdfValue | undefined, fontNum: number): PdfDict {
  const base = file.resolve(resources ?? null);
  const map = new Map<string, PdfValue>(isDict(base) ? base.map : []);
  const fonts = file.resolve(map.get("Font") ?? null);
  const fontMap = new Map<string, PdfValue>(isDict(fonts) ? fonts.map : []);
  fontMap.set(FONT_RESOURCE, ref(-fontNum));
  map.set("Font", { kind: "dict", map: fontMap });
  return { kind: "dict", map };
}

export function buildCompletedPdf(original: Buffer, fields: SealField[], certificate: CertificateData): Buffer {
  const file = new PdfFile(original);
  const pages = collectPages(file);
  const writer = new PdfWriter();
  const catalog = writer.allocate();
  const tree = writer.allocate();
  const font = writer.add(dict({ Type: name("Font"), Subtype: name("Type1"), BaseFont: name("Helvetica") }));
  const copies = new Map<number, number>();
  const queue: number[] = [];
  const mapRef = (num: number): number => {
    if (num < 0) return -num;
    const known = copies.get(num);
    if (known !== undefined) return known;
    const created = writer.allocate();
    copies.set(num, created);
    queue.push(num);
    return created;
  };
  const stream = (content: string) => writer.add({ kind: "stream", dict: dict({}), raw: Buffer.from(content, "latin1") });
  const pushState = stream("q");
  const popState = stream("Q");
  const kids: number[] = [];

  pages.forEach((node, index) => {
    const geometry = pageGeometry(file, node.inherited, node.dict.map);
    const map = new Map(node.dict.map);
    for (const key of DROPPED_PAGE_KEYS) map.delete(key);
    for (const [key, value] of node.inherited) if (!map.has(key) && key !== "Rotate") map.set(key, value);
    const contents = file.resolve(map.get("Contents") ?? null);
    const originalContents: PdfValue[] = isArray(contents) ? contents.items : isRef(map.get("Contents")) ? [map.get("Contents") ?? null] : [];
    const overlay = stream(overlayContent(fields.filter((f) => f.page === index + 1), geometry));
    map.set("Contents", array([ref(-pushState), ...originalContents, ref(-popState), ref(-overlay)]));
    map.set("Resources", clonedResources(file, map.get("Resources"), font));
    map.set("Parent", ref(-tree));
    const pageNum = writer.allocate();
    writer.set(pageNum, { kind: "dict", map }, mapRef);
    kids.push(pageNum);
  });

  const certificatePage = writer.add(
    dict({
      Type: name("Page"),
      Parent: ref(tree),
      MediaBox: array([0, 0, 612, 792]),
      Resources: dict({ Font: dict({ [FONT_RESOURCE]: ref(font) }) }),
      Contents: ref(stream(certificateContent(certificate))),
    }),
  );
  kids.push(certificatePage);

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const target = copies.get(next);
    if (target !== undefined) writer.set(target, file.get(next), mapRef);
  }
  writer.set(tree, dict({ Type: name("Pages"), Kids: array(kids.map(ref)), Count: kids.length }));
  writer.set(catalog, dict({ Type: name("Catalog"), Pages: ref(tree) }));
  return writer.build(catalog);
}
