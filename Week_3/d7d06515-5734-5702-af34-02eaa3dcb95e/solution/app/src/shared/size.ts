// File sizes use decimal units with one decimal (brief: Business rules > Formats): `512 B`, `12.4 KB`, `1.2 MB`.
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const kilobytes = Math.round(bytes / 100) / 10;
  if (kilobytes < 1000) return `${kilobytes.toFixed(1)} KB`;
  return `${(Math.round(bytes / 100_000) / 10).toFixed(1)} MB`;
}
