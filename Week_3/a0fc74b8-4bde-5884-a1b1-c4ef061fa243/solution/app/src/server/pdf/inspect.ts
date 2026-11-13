import { PdfFile, collectPages } from "./reader.js";
import { isArray, isName, type PdfValue } from "./objects.js";
import type { PageSize } from "../../shared/types.js";

export const PAGE_LIMIT = 60;

type UploadRefusal = "not_a_pdf" | "pdf_encrypted" | "pdf_has_scripts" | "pdf_rotated" | "too_many_pages";

interface InspectedPdf {
  pageCount: number;
  pageSizes: PageSize[];
}

export class UploadRefused extends Error {
  constructor(readonly code: UploadRefusal) {
    super(code);
  }
}

const SCRIPT_NAMES = /\/(?:JavaScript|JS)(?![A-Za-z0-9#])/;

function numbers(file: PdfFile, value: PdfValue | undefined): number[] | null {
  const resolved = file.resolve(value ?? null);
  if (!isArray(resolved)) return null;
  const items = resolved.items.map((item) => file.resolve(item));
  return items.length === 4 && items.every((n) => typeof n === "number") ? (items as number[]) : null;
}

interface PageGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function pageGeometry(file: PdfFile, inherited: Map<string, PdfValue>, own: Map<string, PdfValue>): PageGeometry {
  const box = numbers(file, own.get("CropBox") ?? inherited.get("CropBox")) ?? numbers(file, own.get("MediaBox") ?? inherited.get("MediaBox")) ?? [0, 0, 612, 792];
  const [x0, y0, x1, y1] = box as [number, number, number, number];
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  return w > 0 && h > 0 ? { x: Math.min(x0, x1), y: Math.min(y0, y1), w, h } : { x: 0, y: 0, w: 612, h: 792 };
}

export function inspectPdf(bytes: Buffer): InspectedPdf {
  if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new UploadRefused("not_a_pdf");
  let file: PdfFile;
  try {
    file = new PdfFile(bytes);
  } catch {
    throw new UploadRefused("not_a_pdf");
  }
  if (file.trailer.map.has("Encrypt")) throw new UploadRefused("pdf_encrypted");
  let scripted = SCRIPT_NAMES.test(bytes.toString("latin1"));
  if (!scripted) {
    for (const num of file.objectNumbers()) {
      let object: PdfValue;
      try {
        object = file.get(num);
      } catch {
        continue;
      }
      if (typeof object === "object" && object !== null && object.kind === "stream" && isName(object.dict.map.get("Type"), "ObjStm")) {
        try {
          if (SCRIPT_NAMES.test(file.decodeStream(object).toString("latin1"))) scripted = true;
        } catch {
          continue;
        }
      }
    }
  }
  if (scripted) throw new UploadRefused("pdf_has_scripts");
  let pages;
  try {
    pages = collectPages(file);
  } catch {
    throw new UploadRefused("not_a_pdf");
  }
  if (pages.length === 0) throw new UploadRefused("not_a_pdf");
  for (const page of pages) {
    const rotate = file.resolve(page.dict.map.get("Rotate") ?? page.inherited.get("Rotate") ?? 0);
    if (typeof rotate === "number" && rotate % 360 !== 0) throw new UploadRefused("pdf_rotated");
  }
  if (pages.length > PAGE_LIMIT) throw new UploadRefused("too_many_pages");
  return {
    pageCount: pages.length,
    pageSizes: pages.map((page) => {
      const { w, h } = pageGeometry(file, page.inherited, page.dict.map);
      return { w, h };
    }),
  };
}

