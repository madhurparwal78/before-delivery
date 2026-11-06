/** An import's file name: the last path segment of the uploaded name, control characters removed, cut to 70 characters. */
export function importFileName(raw: string): string {
  const last = raw.split(/[/\\]/).pop() ?? "";
  return Array.from(last.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")).slice(0, 70).join("");
}
