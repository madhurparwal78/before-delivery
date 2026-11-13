export type SniffResult =
  | { kind: 'image'; contentType: string }
  | { kind: 'pdf'; contentType: 'application/pdf' }
  | { kind: 'text'; contentType: 'text/plain; charset=utf-8' }
  | { kind: 'refused' };

export function sniff(data: Buffer): SniffResult {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: 'image', contentType: 'image/png' };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { kind: 'image', contentType: 'image/jpeg' };
  }
  if (data.length >= 6 && (data.subarray(0, 6).toString('ascii') === 'GIF87a' || data.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { kind: 'image', contentType: 'image/gif' };
  }
  if (data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { kind: 'image', contentType: 'image/webp' };
  }
  if (data.length >= 4 && data.subarray(0, 4).toString('ascii') === '%PDF') {
    return { kind: 'pdf', contentType: 'application/pdf' };
  }
  if (data.includes(0)) {
    return { kind: 'refused' };
  }
  const head = data.subarray(0, 512).toString('utf8');
  if (/^\s*<\s*[\x41-\x5a\x61-\x7a]/.test(head) && /<(svg|html|script|xml)\b/i.test(head)) {
    return { kind: 'refused' };
  }
  const decoded = new TextDecoder('utf-8', { fatal: true });
  try {
    decoded.decode(data);
  } catch {
    return { kind: 'refused' };
  }
  return { kind: 'text', contentType: 'text/plain; charset=utf-8' };
}

export function isImage(contentType: string): boolean {
  return contentType.startsWith('image/');
}

export function cleanFileName(raw: string | undefined): string {
  if (!raw) return 'file';
  const last = raw.split(/[/\\]/).pop() ?? '';
  const withoutControl = last.replace(/[\x00-\x1f\x7f]/g, '');
  const sliced = Array.from(withoutControl).slice(0, 120).join('');
  return sliced.length > 0 ? sliced : 'file';
}
