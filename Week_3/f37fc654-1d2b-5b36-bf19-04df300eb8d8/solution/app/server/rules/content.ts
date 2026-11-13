// Content checks judged by the bytes, never by the name or declared type (brief: Uploads, Render callbacks).

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function imageKind(bytes: Buffer): "image/jpeg" | "image/png" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

export type FileKind = "brief_pdf" | "venue_photo" | "installation_glb";

export const FILE_KINDS: Record<FileKind, { label: string; limitBytes: number }> = {
  brief_pdf: { label: "brief PDF", limitBytes: 10_485_760 },
  venue_photo: { label: "venue photo", limitBytes: 12_582_912 },
  installation_glb: { label: "GLB model", limitBytes: 26_214_400 },
};

/** The stored content type when the bytes are a file of `kind`, else null. */
export function contentTypeFor(kind: FileKind, bytes: Buffer): string | null {
  if (kind === "venue_photo") return imageKind(bytes);
  if (kind === "brief_pdf") return bytes.subarray(0, 5).toString("latin1") === "%PDF-" ? "application/pdf" : null;
  const glb = bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "glTF"
    && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length;
  return glb ? "model/gltf-binary" : null;
}

