// Sniffs a file's type from its first bytes. Names and declared types are
// never trusted (DP-03).

export type SniffedType = "application/pdf" | "image/png" | "image/jpeg" | null;

export const sniffType = (buffer: Buffer): SniffedType => {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  return null;
};

export const extensionFor = (type: SniffedType): "pdf" | "png" | "jpg" => {
  if (type === "application/pdf") return "pdf";
  if (type === "image/png") return "png";
  return "jpg";
};

export const sanitizeOriginalName = (name: string): string => {
  const stripped = name.replace(/^(.*[\\/])/, "").replace(/\.\./g, "").replace(/[\u0000-\u001f\u007f]/g, "");
  const trimmed = stripped.replace(/^\.+/, "");
  return trimmed.slice(0, 120);
};
