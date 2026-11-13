// RFC 6266 and RFC 8187 Content-Disposition parameters, written once.

function fallbackName(name: string): string {
  let out = "";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e || ch === '"' || ch === "\\" || ch === "%") {
      out += "_";
    } else {
      out += ch;
    }
  }
  return out;
}

export function contentDisposition(name: string): string {
  const fallback = fallbackName(name);
  let header = `attachment; filename="${fallback}"`;
  let needsExtended = false;
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code > 0x7e) {
      needsExtended = true;
      break;
    }
  }
  if (needsExtended) {
    const encoded = encodeURIComponent(name).replace(/[!'()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    header += `; filename*=UTF-8''${encoded}`;
  }
  return header;
}

export function percentDecodeFilename(raw: string): string | null {
  // The raw value holds only bytes 0x21 to 0x7E, and every % starts a valid
  // triplet; the decoded octets are valid UTF-8.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return null;
    if (raw[i] === "%") {
      if (i + 2 >= raw.length) return null;
      if (!/^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) return null;
      i += 2;
    }
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"), "latin1");
    // Decode percent triplets manually to catch invalid UTF-8.
    const bytes: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "%") {
        bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
        i += 2;
      } else {
        bytes.push(raw.charCodeAt(i));
      }
    }
    decoded = Buffer.from(bytes);
  } catch {
    return null;
  }
  const text = decoded.toString("utf8");
  // Reject invalid UTF-8: the decoded form must round-trip.
  const reencoded = Buffer.from(text, "utf8");
  if (reencoded.length !== decoded.length || !reencoded.equals(decoded)) {
    return null;
  }
  return text;
}
