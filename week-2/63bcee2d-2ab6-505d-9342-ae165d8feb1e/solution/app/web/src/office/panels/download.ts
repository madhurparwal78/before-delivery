import type { ErrorBody } from "../../api";
import type { useOffice } from "../context";

// Downloads a stored file through its API route, so a storage outage shows its copy instead of a raw error page.

const STORAGE_DOWN = "File storage is unreachable. Try the download again in a few minutes.";

export async function downloadFile(office: ReturnType<typeof useOffice>, path: string, filename: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    office.refused({ ok: false, status: 0, body: { error: "network" } });
    return;
  }
  if (response.status === 503) {
    office.alert(STORAGE_DOWN);
    return;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({ error: `http_${response.status}` }))) as ErrorBody;
    office.refused({ ok: false, status: response.status, body });
    return;
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
