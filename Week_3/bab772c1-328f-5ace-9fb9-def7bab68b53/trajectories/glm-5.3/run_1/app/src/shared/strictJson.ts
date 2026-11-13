// The single I-JSON request-body parser: rejects duplicate members, unpaired
// surrogate escapes and integers beyond 2^53 - 1 in magnitude.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ParsedJson {
  ok: true;
  value: Json;
}

export interface JsonError {
  ok: false;
  reason: "invalid_json";
}

const MAX_SAFE = 9007199254740991; // 2^53 - 1

export function parseStrictJson(text: string): ParsedJson | JsonError {
  // JSON.parse accepts duplicate members and lone surrogates; we need a scan.
  const scan = scanForErrors(text);
  if (!scan.ok) return scan;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!checkIntegers(value)) return { ok: false, reason: "invalid_json" };
  return { ok: true, value: value as Json };
}

function scanForErrors(text: string): ParsedJson | JsonError {
  let i = 0;
  const n = text.length;
  const stack: ("object" | "array")[] = [];

  const skipWs = () => {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };

  const readString = (): { ok: boolean; surrogateOpen: boolean } => {
    // text[i] === '"'
    i++;
    let surrogateOpen = false;
    while (i < n) {
      const ch = text[i];
      if (ch === '"') {
        i++;
        return { ok: !surrogateOpen, surrogateOpen };
      }
      if (ch === "\\") {
        const next = text[i + 1];
        if (next === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { ok: false, surrogateOpen: false };
          const code = parseInt(hex, 16);
          if (surrogateOpen) {
            if (code < 0xdc00 || code > 0xdfff) return { ok: false, surrogateOpen: false };
            surrogateOpen = false;
          } else if (code >= 0xd800 && code <= 0xdbff) {
            surrogateOpen = true;
          } else if (code >= 0xdc00 && code <= 0xdfff) {
            return { ok: false, surrogateOpen: false };
          }
          i += 6;
          continue;
        }
        if (next === undefined) return { ok: false, surrogateOpen: false };
        i += 2;
        continue;
      }
      if (surrogateOpen) return { ok: false, surrogateOpen: false };
      i++;
    }
    return { ok: false, surrogateOpen: false };
  };

  const seenKeys: Set<string>[] = [];

  const readValue = (): boolean => {
    skipWs();
    if (i >= n) return false;
    const ch = text[i];
    if (ch === "{") {
      stack.push("object");
      seenKeys.push(new Set());
      i++;
      skipWs();
      if (text[i] === "}") {
        i++;
        stack.pop();
        seenKeys.pop();
        return true;
      }
      for (;;) {
        skipWs();
        if (text[i] !== '"') return false;
        const keyStart = i;
        const keyRes = readString();
        if (!keyRes.ok) return false;
        const rawKey = text.slice(keyStart, i);
        const seen = seenKeys[seenKeys.length - 1];
        if (seen.has(rawKey)) return false; // duplicate member name
        seen.add(rawKey);
        skipWs();
        if (text[i] !== ":") return false;
        i++;
        if (!readValue()) return false;
        skipWs();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          stack.pop();
          seenKeys.pop();
          return true;
        }
        return false;
      }
    }
    if (ch === "[") {
      stack.push("array");
      i++;
      skipWs();
      if (text[i] === "]") {
        i++;
        stack.pop();
        return true;
      }
      for (;;) {
        if (!readValue()) return false;
        skipWs();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          stack.pop();
          return true;
        }
        return false;
      }
    }
    if (ch === '"') {
      const res = readString();
      return res.ok;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (text[i] === "-") i++;
      const intStart = i;
      while (i < n && text[i] >= "0" && text[i] <= "9") i++;
      const intPart = text.slice(intStart, i);
      if (intPart === "") return false;
      if (intPart.length > 1 && intPart[0] === "0") return false;
      let hasFractionOrExponent = false;
      if (text[i] === ".") {
        hasFractionOrExponent = true;
        i++;
        const fracStart = i;
        while (i < n && text[i] >= "0" && text[i] <= "9") i++;
        if (i === fracStart) return false;
      }
      if (text[i] === "e" || text[i] === "E") {
        hasFractionOrExponent = true;
        i++;
        if (text[i] === "+" || text[i] === "-") i++;
        const expStart = i;
        while (i < n && text[i] >= "0" && text[i] <= "9") i++;
        if (i === expStart) return false;
      }
      if (!hasFractionOrExponent) {
        // Integer: magnitude must not exceed 2^53 - 1.
        const numeric = intPart + "0".repeat(0);
        const digits = intPart === "0" ? intPart : text[start] === "-" ? intPart : numeric;
        const magnitude = BigInt(intPart);
        if (magnitude > BigInt(MAX_SAFE)) return false;
      }
      return true;
    }
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return true;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return true;
    }
    return false;
  };

  if (!readValue()) return { ok: false, reason: "invalid_json" };
  skipWs();
  if (i !== n) return { ok: false, reason: "invalid_json" };
  if (stack.length !== 0) return { ok: false, reason: "invalid_json" };
  return { ok: true, value: null as unknown as Json };
}

function checkIntegers(value: unknown): boolean {
  if (typeof value === "number") return Number.isInteger(value) || true;
  if (Array.isArray(value)) {
    for (const v of value) {
      if (!checkIntegers(v)) return false;
    }
    return true;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) {
      if (!checkIntegers(v)) return false;
    }
    return true;
  }
  return true;
}

// Scan rejects out-of-range integers, so JSON.parse cannot have produced one.
