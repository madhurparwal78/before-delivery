// Saves a file the server answers with, under the name its Content-Disposition publishes.
import { api } from "../api";

type Download = { ok: true; name: string } | { ok: false; message: string };

export async function downloadFile(path: string): Promise<Download> {
  const result = await api<undefined>("GET", path, { raw: true });
  if (!result.ok) return { ok: false, message: result.error.message };
  const disposition = result.response.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download";
  const url = URL.createObjectURL(await result.response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return { ok: true, name };
}
