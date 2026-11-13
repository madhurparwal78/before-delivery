// File types are decided by the file's first bytes, never by its name or declared type.

type Detected = { kind: "photo"; contentType: "image/jpeg" | "image/png" | "image/webp" } | { kind: "receipt"; contentType: "application/pdf" };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function detect(bytes: Buffer): Detected | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { kind: "photo", contentType: "image/jpeg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG)) return { kind: "photo", contentType: "image/png" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return { kind: "photo", contentType: "image/webp" };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-" && !activePdf(bytes)) return { kind: "receipt", contentType: "application/pdf" };
  return null;
}

/** A receipt PDF must not carry JavaScript, launch actions or embedded files. */
function activePdf(bytes: Buffer): boolean {
  return /\/(JavaScript|JS|EmbeddedFiles?|Launch|RichMedia)\b/.test(bytes.toString("latin1"));
}

/** Drops folder parts and control characters; keeps at most 120 characters. */
export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
}
