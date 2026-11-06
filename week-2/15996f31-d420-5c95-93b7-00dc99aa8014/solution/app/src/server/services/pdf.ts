// A small text PDF writer for the signed inspection report: Letter pages, the PDF base fonts
// (Helvetica, Helvetica-Bold, Courier) in WinAnsi encoding, simple pagination.

export type Font = "regular" | "bold" | "mono";

export interface Line {
  text: string;
  font?: Font;
  size?: number;
  gap?: number;
}

const FONTS: Record<Font, string> = { regular: "F1", bold: "F2", mono: "F3" };
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

// WinAnsi bytes for the few non-Latin-1 characters the report uses; anything else outside Latin-1 becomes "?".
const WIN_ANSI: Record<string, number> = { "·": 0xb7, "—": 0x97, "–": 0x96, "→": 0x3e, "…": 0x85, "’": 0x92 };

function encode(text: string): string {
  let out = "";
  for (const char of text) {
    const code = WIN_ANSI[char] ?? char.codePointAt(0) ?? 63;
    const byte = code > 255 ? 63 : code;
    const literal = String.fromCharCode(byte);
    out += literal === "(" || literal === ")" || literal === "\\" ? `\\${literal}` : byte < 32 || byte > 126 ? `\\${byte.toString(8).padStart(3, "0")}` : literal;
  }
  return out;
}

export function renderPdf(lines: readonly Line[]): Buffer {
  const pages: string[] = [];
  let content = "";
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const size = line.size ?? 10;
    const step = size * 1.45 + (line.gap ?? 0);
    if (y - step < MARGIN) {
      pages.push(content);
      content = "";
      y = PAGE_HEIGHT - MARGIN;
    }
    y -= step;
    content += `BT /${FONTS[line.font ?? "regular"]} ${size} Tf ${MARGIN} ${y.toFixed(2)} Td (${encode(line.text)}) Tj ET\n`;
  }
  pages.push(content);

  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add("");
  const pagesRoot = add("");
  const fonts = (["Helvetica", "Helvetica-Bold", "Courier"] as const).map((name) =>
    add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`),
  );
  const kids: number[] = [];
  for (const page of pages) {
    const stream = add(`<< /Length ${Buffer.byteLength(page, "latin1")} >>\nstream\n${page}endstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
  objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${kids.map((kid) => `${kid} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let output = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "latin1");
}
