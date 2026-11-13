/** Download links that fetch in place and announce a refusal. */

import { downloadCopy } from "../shared/copy.js";
import { el } from "./dom.js";

type DownloadOptions = {
  name: string;
  text: string;
  href: () => string;
  filename: () => string;
  status: (message: string) => void;
  refusal: (code: string, retryAfter: number | null) => string;
};

export function downloadLink(options: DownloadOptions): HTMLAnchorElement {
  const link = el("a", {
    href: options.href(),
    class: "download",
    "aria-label": options.name,
    text: options.text,
    download: "",
  });
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void run();
  });
  const run = async (): Promise<void> => {
    link.href = options.href();
    let response: Response;
    try {
      response = await fetch(link.href);
    } catch {
      options.status(options.refusal("network", null));
      return;
    }
    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const body: unknown = await response.json().catch(() => null);
      const code = (body as { error?: string } | null)?.error ?? "error";
      options.status(options.refusal(code, retryAfter === null ? null : Number(retryAfter)));
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = el("a", { href: url, download: options.filename() });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };
  return link;
}

export function captureRefusal(filename: string) {
  return (code: string, retryAfter: number | null): string => {
    if (code === "storage_unavailable") {
      return downloadCopy.captureStorageOffline(filename);
    }
    if (code === "rate_limited") {
      return downloadCopy.rateLimited(retryAfter ?? 60);
    }
    return downloadCopy.gone(filename);
  };
}

export function dossierRefusal(code: string, retryAfter: number | null): string {
  if (code === "renderer_unavailable") {
    return downloadCopy.dossierOffline;
  }
  if (code === "rate_limited") {
    return downloadCopy.rateLimited(retryAfter ?? 60);
  }
  return downloadCopy.dossierOffline;
}

export function eventListRefusal(_code: string, retryAfter: number | null): string {
  return downloadCopy.rateLimited(retryAfter ?? 60);
}
