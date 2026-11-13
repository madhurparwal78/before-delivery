import { pdfArray, pdfDict, pdfName, pdfNum, pdfRef, serialize, type PdfValue } from './model.ts';
import type { ObjectSink, Rect } from './reader.ts';

export interface PageSpec {
  box: Rect;
  resources: PdfValue;
  contents: PdfValue;
}

/**
 * Writes a fresh PDF. Every object is written plainly, so page objects can be
 * counted by reading the file.
 */
export class PdfBuilder implements ObjectSink {
  private readonly objects = new Map<number, PdfValue>();
  private next = 1;

  reserve(): number {
    const num = this.next;
    this.next += 1;
    this.objects.set(num, { kind: 'null' });
    return num;
  }

  set(num: number, value: PdfValue): void {
    this.objects.set(num, value);
  }

  add(value: PdfValue): number {
    const num = this.reserve();
    this.objects.set(num, value);
    return num;
  }

  build(pages: PageSpec[]): Buffer {
    const pagesNum = this.reserve();
    const pageNums = pages.map((page) =>
      this.add(
        pdfDict({
          Type: pdfName('Page'),
          Parent: pdfRef(pagesNum),
          MediaBox: pdfArray([
            pdfNum(page.box[0]),
            pdfNum(page.box[1]),
            pdfNum(page.box[2]),
            pdfNum(page.box[3]),
          ]),
          Resources: page.resources,
          Contents: page.contents,
        }),
      ),
    );
    this.set(
      pagesNum,
      pdfDict({
        Type: pdfName('Pages'),
        Count: pdfNum(pageNums.length),
        Kids: pdfArray(pageNums.map((num) => pdfRef(num))),
      }),
    );
    const catalogNum = this.add(
      pdfDict({ Type: pdfName('Catalog'), Pages: pdfRef(pagesNum) }),
    );

    const parts: Buffer[] = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = parts[0]?.byteLength ?? 0;
    const offsets = new Map<number, number>();
    for (let num = 1; num < this.next; num += 1) {
      const value = this.objects.get(num) ?? { kind: 'null' as const };
      const body = Buffer.concat([
        Buffer.from(`${num} 0 obj\n`),
        serialize(value),
        Buffer.from('\nendobj\n'),
      ]);
      offsets.set(num, offset);
      offset += body.byteLength;
      parts.push(body);
    }

    const size = this.next;
    const xrefLines = ['xref', `0 ${size}`, '0000000000 65535 f '];
    for (let num = 1; num < size; num += 1) {
      xrefLines.push(`${String(offsets.get(num) ?? 0).padStart(10, '0')} 00000 n `);
    }
    const trailer = Buffer.concat([
      Buffer.from(`${xrefLines.join('\n')}\n`),
      Buffer.from('trailer\n'),
      serialize(pdfDict({ Size: pdfNum(size), Root: pdfRef(catalogNum) })),
      Buffer.from(`\nstartxref\n${offset}\n%%EOF\n`),
    ]);
    parts.push(trailer);
    return Buffer.concat(parts);
  }
}
