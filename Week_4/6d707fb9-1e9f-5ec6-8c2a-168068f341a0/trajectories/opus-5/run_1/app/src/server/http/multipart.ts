export interface MultipartPart {
  name: string;
  fileName: string | null;
  contentType: string | null;
  content: Buffer;
}

export function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return null;
  return (match[1] ?? match[2] ?? '').trim() || null;
}

/** The parts of a multipart body, each part's content kept byte for byte. */
export function readParts(body: Buffer, boundary: string): MultipartPart[] {
  const marker = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let at = body.indexOf(marker);
  while (at !== -1) {
    let start = at + marker.length;
    if (body.slice(start, start + 2).toString() === '--') break;
    if (body.slice(start, start + 2).toString() === '\r\n') start += 2;
    else if (body.slice(start, start + 1).toString() === '\n') start += 1;
    const headerEnd = body.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headerText = body.slice(start, headerEnd).toString('utf8');
    const next = body.indexOf(marker, headerEnd);
    if (next === -1) break;
    let contentEnd = next;
    if (body.slice(contentEnd - 2, contentEnd).toString() === '\r\n') contentEnd -= 2;
    const content = body.slice(headerEnd + 4, contentEnd);
    const nameMatch = /name="([^"]*)"/i.exec(headerText);
    const fileMatch = /filename="([^"]*)"/i.exec(headerText);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
    parts.push({
      name: nameMatch ? (nameMatch[1] as string) : '',
      fileName: fileMatch ? (fileMatch[1] as string) : null,
      contentType: typeMatch ? (typeMatch[1] as string).trim() : null,
      content,
    });
    at = next;
  }
  return parts;
}

const SIGNATURES: { contentType: string; bytes: number[] }[] = [
  { contentType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** An evidence file is judged by its content alone. */
export function contentTypeOfFile(content: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (content.length < signature.bytes.length) continue;
    if (signature.bytes.every((byte, index) => content[index] === byte)) return signature.contentType;
  }
  return null;
}
