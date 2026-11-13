// RFC 8785 (JCS) canonical JSON. Written once and used by both the audit
// append and the verify route.

function numberToEcma262(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("cannot canonicalise non-finite number");
  }
  if (value === 0) return "0";
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return value.toString();
  }
  const a = Math.abs(value);
  if (a >= 1e21 || a < 1e-6) {
    // Exponential form.
    let s = value.toExponential();
    // ECMAScript uses the shortest round-trip form; strip "+" and trailing
    // exponent zeros per JCS.
    s = s.replace("e+", "e");
    // Remove leading zeros in the exponent.
    const [m, e] = s.split("e");
    let exp = e.replace(/^[-+]?0+/, (z) => (e.startsWith("-") ? "-" : ""));
    exp = e.startsWith("-") ? "-" + e.slice(1).replace(/^0+/, "") : e.replace(/^\+?0+/, "");
    let mant = m;
    if (mant.includes(".")) mant = mant.replace(/0+$/, "");
    if (mant.endsWith(".")) mant = mant.slice(0, -1);
    return `${mant}e${exp}`;
  }
  let s = value.toString();
  if (s.includes("e")) {
    s = value.toFixed(20).replace(/0+$/, "");
  }
  return s;
}

function canonicalNumberToString(value: number): string {
  // Fast path: JSON.stringify matches JCS for the vast majority of doubles.
  const json = JSON.stringify(value);
  const parsed = JSON.parse(json) as number;
  if (parsed === value) {
    // Check that stringify is minimal round-trip: JCS requires shortest.
    return json;
  }
  return numberToEcma262(value);
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export function canonicalJson(value: JsonValue): string {
  return serialise(value);
}

function serialise(value: JsonValue): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return jsonStringifyString(value);
    case "number":
      return canonicalNumberToString(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) {
        const parts = value.map((v) => serialise(v === undefined ? null : v));
        return `[${parts.join(",")}]`;
      }
      const entries = Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${jsonStringifyString(k)}:${serialise(v as JsonValue)}`)
        .sort((a, b) => sortCompare(a.slice(0, a.indexOf(":")), b.slice(0, b.indexOf(":"))));
      return `{${entries.join(",")}}`;
    }
    default:
      throw new Error("cannot canonicalise value");
  }
}

// UTF-16 code-unit ordering of the encoded key (JCS 3.2.2.3).
function sortCompare(a: string, b: string): number {
  const ea = Buffer.from(a, "utf8");
  const eb = Buffer.from(b, "utf8");
  const len = Math.min(ea.length, eb.length);
  for (let i = 0; i < len; i++) {
    if (ea[i] !== eb[i]) return ea[i] - eb[i];
  }
  return ea.length - eb.length;
}

const HEX = "0123456789abcdef";

function jsonStringifyString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x22) {
      out += '\\"';
    } else if (ch === 0x5c) {
      out += "\\\\";
    } else if (ch >= 0x20) {
      if (ch < 0x7f) {
        out += String.fromCharCode(ch);
      } else {
        // Non-ASCII: emit raw UTF-16 units (JCS requires UTF-8 output; Node
        // will encode the final string).
        out += s[i];
      }
    } else {
      switch (ch) {
        case 0x08:
          out += "\\b";
          break;
        case 0x09:
          out += "\\t";
          break;
        case 0x0a:
          out += "\\n";
          break;
        case 0x0c:
          out += "\\f";
          break;
        case 0x0d:
          out += "\\r";
          break;
        default:
          out += "\\u00";
          out += HEX[(ch >> 4) & 0xf];
          out += HEX[ch & 0xf];
      }
    }
  }
  return `${out}"`;
}
