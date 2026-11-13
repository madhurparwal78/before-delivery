import { type PdfValue, serialize } from "./objects.js";

export class PdfWriter {
  private readonly bodies: (Buffer | null)[] = [];

  allocate(): number {
    this.bodies.push(null);
    return this.bodies.length;
  }

  set(num: number, value: PdfValue, mapRef: (old: number) => number = (n) => n): void {
    this.bodies[num - 1] = serialize(value, mapRef);
  }

  add(value: PdfValue): number {
    const num = this.allocate();
    this.set(num, value);
    return num;
  }

  build(rootNum: number): Buffer {
    const chunks: Buffer[] = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")];
    const offsets: number[] = [];
    let length = chunks[0]?.length ?? 0;
    this.bodies.forEach((body, index) => {
      const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), body ?? Buffer.from("null"), Buffer.from("\nendobj\n")]);
      offsets.push(length);
      length += chunk.length;
      chunks.push(chunk);
    });
    const xref = [`xref\n0 ${this.bodies.length + 1}\n`, "0000000000 65535 f \n"];
    for (const offset of offsets) xref.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${this.bodies.length + 1} /Root ${rootNum} 0 R >>\nstartxref\n${length}\n%%EOF\n`);
    chunks.push(Buffer.from(xref.join("")));
    return Buffer.concat(chunks);
  }
}
