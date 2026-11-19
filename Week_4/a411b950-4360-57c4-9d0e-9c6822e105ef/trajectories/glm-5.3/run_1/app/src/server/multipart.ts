/**
 * Multipart/form-data parsing with no third-party dependency. Only what the
 * brief needs: text fields, a single file field, and the raw bytes of each
 * part. The boundary never enters idempotency fingerprints (DP: Brief
 * idempotency).
 */

export interface ParsedPart {
  name: string;
  filename: string | null;
  contentType: string | null;
  value: Buffer;
}

export interface ParsedMultipart {
  fields: Map<string, string>;
  files: Map<string, { filename: string; contentType: string; bytes: Buffer }>;
}

export function parseMultipart(body: Buffer, contentTypeHeader: string): ParsedMultipart {
  const match = /boundary="?([^";]+)"?/i.exec(contentTypeHeader);
  if (!match) {
    throw new Error("Missing multipart boundary");
  }
  const boundary = Buffer.from(`--${match[1]}`);
  const parts = splitByBoundary(body, boundary);
  const result: ParsedMultipart = { fields: new Map(), files: new Map() };
  for (const part of parts) {
    const parsed = parsePart(part);
    if (!parsed) continue;
    if (parsed.filename !== null) {
      if (!result.files.has(parsed.name)) {
        result.files.set(parsed.name, {
          filename: parsed.filename,
          contentType: parsed.contentType || "application/octet-stream",
          bytes: parsed.value,
        });
      }
    } else if (!result.fields.has(parsed.name)) {
      result.fields.set(parsed.name, parsed.value.toString("utf-8"));
    }
  }
  return result;
}

function splitByBoundary(body: Buffer, boundary: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const after = start + boundary.length;
    // Skip the boundary line's CRLF and check for the terminating dash.
    if (body[after] === 0x2d && body[after + 1] === 0x2d) break;
    const next = body.indexOf(boundary, after);
    const end = next === -1 ? body.length : next;
    let slice = body.subarray(after, end);
    // Trim the leading CRLF of the part and the trailing CRLF before boundary.
    if (slice[0] === 0x0d && slice[1] === 0x0a) slice = slice.subarray(2);
    if (slice[slice.length - 2] === 0x0d && slice[slice.length - 1] === 0x0a) {
      slice = slice.subarray(0, slice.length - 2);
    }
    if (slice.length > 0) parts.push(slice);
    start = next;
  }
  return parts;
}

function parsePart(part: Buffer): ParsedPart | null {
  const separator = part.indexOf("\r\n\r\n");
  if (separator < 0) return null;
  const headerText = part.subarray(0, separator).toString("utf-8");
  const value = part.subarray(separator + 4);
  let name = "";
  let filename: string | null = null;
  let contentType: string | null = null;
  for (const line of headerText.split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const valueText = line.slice(colon + 1).trim();
    if (key === "content-disposition") {
      name = attributeOf(valueText, "name") || "";
      const rawFilename = attributeOf(valueText, "filename");
      if (rawFilename !== null) filename = rawFilename;
    } else if (key === "content-type") {
      contentType = valueText;
    }
  }
  if (!name) return null;
  return { name, filename, contentType, value };
}

function attributeOf(value: string, attribute: string): string | null {
  const regex = new RegExp(`${attribute}="([^"]*)"`, "i");
  const match = regex.exec(value);
  if (match) return match[1];
  const bare = new RegExp(`${attribute}=([^;\\s]+)`, "i");
  const bareMatch = bare.exec(value);
  return bareMatch ? bareMatch[1] : null;
}
