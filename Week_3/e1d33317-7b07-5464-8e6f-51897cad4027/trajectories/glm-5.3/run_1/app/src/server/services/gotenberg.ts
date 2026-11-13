import http from 'node:http';

/** Turns engraved SVG pages into a PDF through Gotenberg. */
export class Gotenberg {
  private url = '';

  configure(url: string): void {
    this.url = url;
  }

  async renderPdf(html: string): Promise<Buffer | null> {
    if (!this.url) return null;
    return new Promise((resolve) => {
      const boundary = 'fairline' + Math.random().toString(16).slice(2);
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="part.html"\r\nContent-Type: text/html\r\n\r\n`),
        Buffer.from(html, 'utf8'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const u = new URL(this.url);
      const req = http.request(
        {
          host: u.hostname,
          port: Number(u.port || 80),
          method: 'POST',
          path: '/forms/libreoffice/convert',
          headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const pdf = Buffer.concat(chunks);
            resolve(res.statusCode && res.statusCode < 300 && pdf.length > 4 && pdf.subarray(0, 4).toString() === '%PDF' ? pdf : null);
          });
        },
      );
      req.setTimeout(60000, () => {
        req.destroy();
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.write(body);
      req.end();
    });
  }
}

export const GOTENBERG = new Gotenberg();
