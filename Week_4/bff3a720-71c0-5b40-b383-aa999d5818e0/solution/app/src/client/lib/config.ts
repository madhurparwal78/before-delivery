import type { PageConfig } from "../../shared/api";

function read(): PageConfig {
  const raw = document.querySelector('meta[name="longseat-config"]')?.getAttribute("content") ?? "";
  try {
    const parsed = JSON.parse(raw) as Partial<PageConfig>;
    return {
      toastSeconds: Number(parsed.toastSeconds) || 5,
      searchDebounceMs: Number(parsed.searchDebounceMs) || 300,
    };
  } catch {
    return { toastSeconds: 5, searchDebounceMs: 300 };
  }
}

export const pageConfig: PageConfig = read();
