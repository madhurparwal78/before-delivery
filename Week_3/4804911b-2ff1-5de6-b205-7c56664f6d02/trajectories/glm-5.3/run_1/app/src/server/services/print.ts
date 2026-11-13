import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export interface NoticeRowForPrint {
  name: string;
  oldMrpRupees: string;
  revisedMrpRupees: string;
}

/** Gotenberg renders each notice version from HTML into A4 PDF bytes. */
export class PrintService {
  private lastContactOk = true;

  constructor(private gotenbergUrl: string) {}

  get reachable(): boolean {
    return this.lastContactOk;
  }

  private fonts: { bebas: string; garamond: string; garamondItalic: string } | null = null;

  private loadFonts(): { bebas: string; garamond: string; garamondItalic: string } {
    if (!this.fonts) {
      const dir = join(__dirname, '..', '..', 'client', 'assets');
      this.fonts = {
        bebas: readFileSync(join(dir, 'bebas-neue-latin-400-normal.woff2')).toString('base64'),
        garamond: readFileSync(join(dir, 'eb-garamond-latin-400-normal.woff2')).toString('base64'),
        garamondItalic: readFileSync(join(dir, 'eb-garamond-latin-400-italic.woff2')).toString('base64'),
      };
    }
    return this.fonts;
  }

  /** HTML for one notice version. Names are literal text; no markup runs and nothing is fetched. */
  buildHtml(title: string, number: string, version: number, effectiveDate: string, publishedDate: string, rows: NoticeRowForPrint[]): string {
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const f = this.loadFonts();
    const rowLines = rows
      .map((r) => `<div class="row"><span class="n">${esc(r.name)}</span><span class="p">Rs ${esc(r.oldMrpRupees)} to Rs ${esc(r.revisedMrpRupees)}</span></div>`)
      .join('\n');
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Notice ${number}, version ${version}</title>
<style>
@font-face{font-family:'Bebas Neue';src:url(data:font/woff2;base64,${f.bebas}) format('woff2');font-weight:400;}
@font-face{font-family:'EB Garamond';src:url(data:font/woff2;base64,${f.garamond}) format('woff2');font-weight:400;}
@font-face{font-family:'EB Garamond';src:url(data:font/woff2;base64,${f.garamondItalic}) format('woff2');font-weight:400;font-style:italic;}
body{font-family:'EB Garamond',serif;font-size:12pt;margin:0;color:#000;}
h1{font-family:'Bebas Neue',sans-serif;font-size:44pt;margin:0 0 6pt 0;letter-spacing:2pt;}
.line{font-size:12pt;margin:2pt 0;}
.row{display:flex;justify-content:space-between;font-size:12pt;margin:3pt 0;page-break-inside:avoid;}
.row .n{padding-right:12pt;}
.it{font-style:italic;font-size:11pt;margin-top:14pt;}
</style></head>
<body>
<h1>PRICE NOTICE</h1>
<div class="line">Vasant Talkies Drinks</div>
<div class="line">Notice ${esc(number)}, version ${version}</div>
<div class="line">Effective ${esc(effectiveDate)}</div>
<div class="line">Published ${esc(publishedDate)}</div>
${rowLines}
<div class="it">The original MRP stays readable on every stickered pack.</div>
</body></html>`;
  }

  /** Render, or return null when the service is down or the body is not a PDF. */
  async render(html: string): Promise<Buffer | null> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    // An A4 document, 595 by 842 points, with the published margins.
    form.append('paperWidth', '8.27');
    form.append('paperHeight', '11.69');
    form.append('marginTop', '0.5');
    form.append('marginBottom', '0.5');
    form.append('marginLeft', '0.55');
    form.append('marginRight', '0.55');
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const res = await Promise.race([
        fetch(`${this.gotenbergUrl}/forms/chromium/convert/html`, { method: 'POST', body: form }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 25000);
        }),
      ]);
      if (!res || !(res instanceof Response)) {
        this.lastContactOk = false;
        return null;
      }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!res.ok || bytes.length < 4 || bytes.subarray(0, 4).toString('latin1') !== '%PDF') {
        this.lastContactOk = false;
        return null;
      }
      this.lastContactOk = true;
      return bytes;
    } catch {
      this.lastContactOk = false;
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
