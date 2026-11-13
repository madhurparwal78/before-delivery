// Gotenberg: renders each sheet from one self-contained HTML page through its
// Chromium HTML conversion. Every photo is a display crop embedded inline; the
// printing service is never asked to fetch a URL. The HTML contains no notes,
// source links or where-found notes, and display crops carry no metadata.

export interface SheetStopView {
  position: number;
  title: string;
  maker: string | null;
  year: number | null;
  sizeText: string;
  swatch: string;
  photoDataUrl: string; // display crop, base64
}

export interface SheetPageInput {
  reelName: string;
  paper: "a4" | "letter";
  stops: SheetStopView[];
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

// The announcer's dropping rule for the `<maker>, <year>` line.
export function makerYear(maker: string | null, year: number | null): string {
  if (maker && year !== null) return `${maker}, ${year}`;
  if (maker) return maker;
  if (year !== null) return String(year);
  return "";
}

export function sheetHtml(input: SheetPageInput): string {
  // Six stops per page, in two columns of three rows.
  const pages: SheetStopView[][] = [];
  for (let i = 0; i < input.stops.length; i += 6) pages.push(input.stops.slice(i, i + 6));
  const pageHtml = (stops: SheetStopView[]) => {
    const cells = stops.map((s) => {
      const my = makerYear(s.maker, s.year);
      return `
      <div class="stop">
        <div class="photo"><img src="${s.photoDataUrl}" alt="${esc(s.title)}"/></div>
        <div class="stop-text">
          <div class="swatch" style="background:${esc(s.swatch)}"></div>
          <p class="pos-title">${s.position}. ${esc(s.title)}</p>
          <p class="maker-year">${esc(my)}</p>
          <p class="size">${esc(s.sizeText)}</p>
          <p class="swatchline">Swatch ${esc(s.swatch)}</p>
        </div>
      </div>`;
    }).join("\n");
    return `<div class="stops">${cells}</div>`;
  };
  const pageSize = input.paper === "a4" ? "A4" : "letter";
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: ${pageSize}; margin: 0; }
  html, body { font-family: Arial, Helvetica, sans-serif; }
  body { margin: 0 14mm; color: #1a1a1a; }
  .page { break-after: page; }
  .page:last-child { break-after: auto; }
  .sheet-first { display: flex; justify-content: space-between; align-items: baseline; padding: 10mm 0 5mm; }
  .sheet-head { display: flex; justify-content: space-between; align-items: baseline; padding: 10mm 0 5mm; visibility: hidden; }
  h1 { font-size: 15pt; margin: 0; }
  .count { font-size: 10pt; color: #444; }
  .stops { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm 10mm; }
  .stop { display: flex; gap: 4mm; break-inside: avoid; }
  .photo { flex: 0 0 32mm; }
  .photo img { width: 32mm; height: 32mm; object-fit: cover; display: block; }
  .stop-text { flex: 1; }
  .swatch { width: 14mm; height: 5mm; margin: 1.5mm 0; }
  p { margin: 0.8mm 0; font-size: 8.5pt; line-height: 1.3; }
  .pos-title { font-weight: bold; }
</style>
</head>
<body>
${pages.map((stops, i) => `
<div class="page">
  <div class="${i === 0 ? "sheet-first" : "sheet-head"}"><h1>${i === 0 ? esc(input.reelName) : ""}</h1><span class="count">${i === 0 ? `${input.stops.length} references` : ""}</span></div>
  ${pageHtml(stops)}
</div>`).join("\n")}
</body></html>`;
}

// The page footer template: `Stowdeck · <reel name> · Page <p> of <n>`, made with
// the printing service's own page-number and page-count spans.
export function footerHtml(reelName: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #333; }
    .footer { width: 100%; text-align: center; }
  </style></head><body><div class="footer">Stowdeck &#183; ${esc(reelName)} &#183; Page <span class="pageNumber"></span> of <span class="totalPages"></span></div></body></html>`;
}

// One self-contained multipart request to Gotenberg's Chromium HTML conversion.
// The footer is a companion footer.html file; the printing service is never
// asked to fetch a URL.
export async function renderPdf(gotenbergUrl: string, html: string, footer: string, paper: "a4" | "letter"): Promise<Buffer> {
  const fd = new FormData();
  fd.append("files", new Blob([html], { type: "text/html" }), "index.html");
  fd.append("files", new Blob([footer], { type: "text/html" }), "footer.html");
  // Page size in inches: A4 is 210 × 297 mm, US Letter is 8.5 × 11 in, portrait.
  const [width, height] = paper === "a4" ? ["8.27", "11.69"] : ["8.5", "11"];
  fd.append("paperWidth", width);
  fd.append("paperHeight", height);
  fd.append("marginTop", "0.55");
  fd.append("marginBottom", "0.75");
  fd.append("marginLeft", "0.55");
  fd.append("marginRight", "0.55");
  const res = await fetch(`${gotenbergUrl}/forms/chromium/convert/html`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) throw new Error(`gotenberg ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function gotenbergUp(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
