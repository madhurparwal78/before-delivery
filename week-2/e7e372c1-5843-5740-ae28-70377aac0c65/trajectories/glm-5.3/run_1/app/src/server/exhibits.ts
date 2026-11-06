// Exhibit access and downloads. Whether a hash may be served is decided from
// the database alone, before and without contacting the vault.

import type { Request, Response } from "express";
import { pool } from "./db.js";
import { errors } from "./errors.js";
import { readExhibitBytes } from "./vault.js";

const SHA_PATTERN = /^[0-9a-f]{64}$/;

interface VisibleExhibit {
  accession: string;
  publiclyCited: boolean;
}

/** The single decision point for who may download an exhibit hash. */
async function findVisibleExhibit(sha256: string, staffSession: boolean): Promise<VisibleExhibit | null> {
  const { rows } = await pool.query<{ accession: string; state: string }>(
    `SELECT accession, state FROM restatements
      WHERE exhibit_sha256 = $1 AND exhibit_status = 'verified' AND accession IS NOT NULL`,
    [sha256],
  );
  if (rows.length === 0) return null;
  const publiclyCited = rows.some((r) => r.state === "published" || r.state === "superseded");
  if (publiclyCited) return { accession: rows[0]?.accession as string, publiclyCited: true };
  if (staffSession) return { accession: rows[0]?.accession as string, publiclyCited: false };
  return null;
}

/** Serves an exhibit with conditional and range support, or the fixed refusals. */
export async function serveExhibit(req: Request, res: Response, staffSession: boolean): Promise<void> {
  const sha256 = (req.params.sha256 ?? "").toLowerCase();
  if (!SHA_PATTERN.test(sha256)) {
    res.status(404).json(errors.notFound().body());
    return;
  }

  const visible = await findVisibleExhibit(sha256, staffSession);
  if (!visible) {
    // Identical to an unknown hash: no exhibit headers, no vault contact.
    res.status(404).json(errors.notFound().body());
    return;
  }

  const etag = `"${sha256}"`;
  res.set("ETag", etag);
  res.set("Accept-Ranges", "bytes");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Cache-Control", visible.publiclyCited ? "public, max-age=31536000, immutable" : "private, no-store");

  // Conditional requests are decided from the database alone, so they answer
  // even while the vault is unreachable.
  const ifNoneMatch = req.header("if-none-match");
  if (ifNoneMatch !== undefined) {
    const candidates = ifNoneMatch.split(",").map((v) => v.trim());
    if (ifNoneMatch === "*" || candidates.includes(etag)) {
      res.status(304).end();
      return;
    }
  }

  const bytes = await readExhibitBytes(visible.accession, sha256);
  if (bytes === null) {
    res.status(503).json(errors.vaultUnavailable().body());
    return;
  }

  const rangeHeader = req.header("range");
  const range = rangeHeader === undefined ? null : parseSingleRange(rangeHeader, bytes.length);
  if (range === "unparseable" || range === null) {
    // A multi-range or malformed Range header is ignored: the full 200.
    sendFull(res, bytes, visible.accession, sha256);
    return;
  }
  if (range.empty) {
    res.status(416);
    res.set("Content-Range", `bytes */${bytes.length}`);
    res.json({ error: { code: "range_not_satisfiable", message: "The requested range is not satisfiable." } });
    return;
  }
  const slice = bytes.subarray(range.first, range.last + 1);
  res.status(206);
  res.set("Content-Type", "application/pdf");
  res.set("Content-Length", String(slice.length));
  res.set("Content-Range", `bytes ${range.first}-${range.last}/${bytes.length}`);
  res.set("X-Exhibit-SHA256", sha256);
  res.set("Content-Disposition", `attachment; filename="${visible.accession}.pdf"`);
  res.send(slice);
}

function sendFull(res: Response, bytes: Buffer, accession: string, sha256: string): void {
  res.status(200);
  res.set("Content-Type", "application/pdf");
  res.set("Content-Length", String(bytes.length));
  res.set("X-Exhibit-SHA256", sha256);
  res.set("Content-Disposition", `attachment; filename="${accession}.pdf"`);
  res.send(bytes);
}

interface ParsedRange {
  first: number;
  last: number;
  empty: boolean;
}

/** One parseable bytes range, or null for none, or "unparseable" to ignore. */
function parseSingleRange(header: string, size: number): ParsedRange | "unparseable" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "unparseable";
  const startStr = match[1] ?? "";
  const endStr = match[2] ?? "";
  if (startStr === "" && endStr === "") return "unparseable";
  if (startStr === "") {
    const suffix = Number(endStr);
    if (!Number.isInteger(suffix) || suffix < 0) return "unparseable";
    if (suffix === 0) return { first: 0, last: -1, empty: true };
    const first = Math.max(0, size - suffix);
    if (first >= size) return { first: 0, last: -1, empty: true };
    return { first, last: size - 1, empty: false };
  }
  const start = Number(startStr);
  if (!Number.isInteger(start) || start < 0) return "unparseable";
  if (start >= size) return { first: start, last: start, empty: true };
  if (endStr === "") return { first: start, last: size - 1, empty: false };
  const end = Number(endStr);
  if (!Number.isInteger(end) || end < start) return "unparseable";
  return { first: start, last: Math.min(end, size - 1), empty: false };
}
