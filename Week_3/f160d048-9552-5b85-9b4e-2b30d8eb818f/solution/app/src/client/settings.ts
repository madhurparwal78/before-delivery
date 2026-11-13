type Settings = { toastSeconds: number; minPayReports: number; searchPageSize: number };

function read(): Settings {
  const meta = document.querySelector('meta[name="cb-config"]')?.getAttribute("content");
  const parsed: Partial<Settings> = meta ? JSON.parse(meta) : {};
  return {
    toastSeconds: parsed.toastSeconds ?? 5,
    minPayReports: parsed.minPayReports ?? 5,
    searchPageSize: parsed.searchPageSize ?? 20,
  };
}

/** The only configuration the server hands to the page. */
export const settings = read();

export const initialStatus = Number(document.querySelector('meta[name="cb-status"]')?.getAttribute("content") ?? 200);
