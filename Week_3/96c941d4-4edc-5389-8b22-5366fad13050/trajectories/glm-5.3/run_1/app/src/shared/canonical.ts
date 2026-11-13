// Canonical JSON per API contract: recursive key sort by unsigned UTF-16 code units,
// decimal integers without plus/leading zeros/exponent, minimal escapes, UTF-8 text.

export function canonicalize(value: unknown): string {
  const out: string[] = [];
  writeCanonical(value, out);
  return out.join('');
}

function writeCanonical(value: unknown, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  if (typeof value === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Canonical JSON supports safe integers only');
    }
    if (Object.is(value, -0)) {
      out.push('0');
      return;
    }
    out.push(String(value));
    return;
  }
  if (typeof value === 'string') {
    writeString(value, out);
    return;
  }
  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      writeCanonical(value[i], out);
    }
    out.push(']');
    return;
  }
  if (typeof value === 'object') {
    out.push('{');
    const keys = Object.keys(value).sort((a, b) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        const ca = a.charCodeAt(i);
        const cb = b.charCodeAt(i);
        if (ca !== cb) return ca - cb;
      }
      return a.length - b.length;
    });
    let first = true;
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      if (!first) out.push(',');
      first = false;
      writeString(key, out);
      out.push(':');
      writeCanonical(v, out);
    }
    out.push('}');
    return;
  }
  throw new Error('Unsupported canonical value');
}

function writeString(value: string, out: string[]): void {
  out.push('"');
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x22) out.push('\\"');
    else if (c === 0x5c) out.push('\\\\');
    else if (c === 0x08) out.push('\\b');
    else if (c === 0x09) out.push('\\t');
    else if (c === 0x0a) out.push('\\n');
    else if (c === 0x0c) out.push('\\f');
    else if (c === 0x0d) out.push('\\r');
    else if (c < 0x20) {
      out.push('\\u00' + c.toString(16).padStart(2, '0'));
    } else {
      out.push(value[i]);
    }
  }
  out.push('"');
}

// Web-compatible SHA-256 of canonical JSON text (UTF-8), for browser use.
export async function canonicalDigest(value: unknown): Promise<string> {
  const text = canonicalize(value);
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return bufferToHex(hash);
}

export function bufferToHex(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  let hex = '';
  for (const byte of view) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export async function digestDefinition(definition: unknown): Promise<string> {
  return canonicalDigest(definition);
}
