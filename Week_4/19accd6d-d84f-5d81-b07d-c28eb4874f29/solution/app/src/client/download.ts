let lastUrl: string | null = null;

/** Saves bytes as a file under the given name. */
export function downloadBytes(bytes: Uint8Array, filename: string): void {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = lastUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
