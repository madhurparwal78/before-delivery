// Text rules shared by every string the API reads. Counts are Unicode code
// points; control and direction characters are refused per field kind.

export function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // A high surrogate must be followed by a low surrogate.
      if (i + 1 >= s.length) return true;
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++; // skip the pair's low half
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // a low surrogate with no high surrogate before it
    }
  }
  return false;
}

// Shared "everywhere" refusals: NUL and lone surrogates. JSON.parse turns an
// unescaped lone surrogate into a lone surrogate code unit.
export function baseStringRefusal(s) {
  if (s.includes('\u0000')) return 'nul';
  if (hasLoneSurrogate(s)) return 'surrogate';
  return null;
}

// Single-line fields refuse C0, DEL and the bidi embedding/override/isolate controls.
export function singleLineRefusal(s) {
  const base = baseStringRefusal(s);
  if (base) return base;
  for (let i = 0; i < s.length; i++) {
    const code = s.codePointAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) return 'control';
    if (code >= 0x01 && code <= 0x1f) return 'control';
    if (code === 0x7f) return 'control';
    if (code >= 0x202a && code <= 0x202e) return 'direction';
    if (code >= 0x2066 && code <= 0x2069) return 'direction';
  }
  return null;
}

// Multi-line fields allow tab, LF, CR and refuse the rest of C0 and DEL.
export function multiLineRefusal(s) {
  const base = baseStringRefusal(s);
  if (base) return base;
  for (let i = 0; i < s.length; i++) {
    const code = s.codePointAt(i);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code >= 0x01 && code <= 0x1f) return 'control';
    if (code === 0x7f) return 'control';
  }
  return null;
}

export function codePoints(s) {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function trim(s) {
  // Trim Unicode whitespace like the platform's String.prototype.trim.
  return String(s).trim();
}

export function normalizeNfc(s) {
  return s.normalize('NFC');
}
