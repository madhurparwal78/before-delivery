import { renderPage, measurePages } from "./pdf.js";

export { renderPage, measurePages };

export async function loadPdfBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "storage_unavailable" }));
    const code = (body as { error?: string }).error;
    throw new Error(code === "storage_unavailable" ? "storage_unavailable" : "load_failed");
  }
  return res.arrayBuffer();
}

/** Renders one page to a canvas inside the given group at the page's aspect ratio. */
export async function renderPageInto(
  bytes: ArrayBuffer,
  pageNumber: number,
  container: HTMLElement,
): Promise<void> {
  const width = container.clientWidth || 800;
  const canvas = await renderPage(bytes, pageNumber, width);
  canvas.setAttribute("role", "presentation");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  container.prepend(canvas);
}
