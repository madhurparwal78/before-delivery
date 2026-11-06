/** Conditional and range request evaluation for evidence downloads (DP-52, DP-53). */

type RangePlan =
  | { kind: "full" }
  | { kind: "unsatisfiable" }
  | { kind: "partial"; ranges: [number, number][] };

/** Weak comparison: a W/ prefix is ignored on both sides. */
export function noneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  if (header.trim() === "*") return true;
  const bare = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => bare(tag) === bare(etag));
}

type Spec = { first: number; last: number | null } | { suffix: number };

function parseSpecs(header: string): Spec[] | null {
  const m = /^bytes=(.*)$/i.exec(header.trim());
  if (!m) return null;
  const parts = m[1].split(",").map((p) => p.trim());
  if (parts.length < 1 || parts.length > 10) return null;
  const specs: Spec[] = [];
  for (const part of parts) {
    let s: RegExpExecArray | null;
    if ((s = /^(\d+)-(\d*)$/.exec(part))) {
      const first = Number(s[1]);
      const last = s[2] === "" ? null : Number(s[2]);
      if (last !== null && first > last) return null;
      specs.push({ first, last });
    } else if ((s = /^-(\d+)$/.exec(part))) {
      specs.push({ suffix: Number(s[1]) });
    } else {
      return null;
    }
  }
  return specs;
}

export function planRange(rangeHeader: string | undefined, ifRange: string | undefined, etag: string, size: number): RangePlan {
  if (rangeHeader === undefined) return { kind: "full" };
  const specs = parseSpecs(rangeHeader);
  if (!specs) return { kind: "full" };
  if (ifRange !== undefined && ifRange.trim() !== etag) return { kind: "full" };
  const resolved: [number, number][] = [];
  for (const spec of specs) {
    if ("suffix" in spec) {
      if (spec.suffix === 0 || size === 0) continue;
      resolved.push([Math.max(0, size - spec.suffix), size - 1]);
    } else {
      if (spec.first >= size) continue;
      resolved.push([spec.first, Math.min(spec.last ?? size - 1, size - 1)]);
    }
  }
  if (!resolved.length) return { kind: "unsatisfiable" };
  resolved.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of resolved) {
    const prev = merged[merged.length - 1];
    if (prev && a <= prev[1] + 1) prev[1] = Math.max(prev[1], b);
    else merged.push([a, b]);
  }
  return { kind: "partial", ranges: merged };
}

const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

export function contentDisposition(filename: string): string {
  const fallback = [...filename].map((c) => (c.codePointAt(0)! > 127 || c === '"' || c === "\\" ? "_" : c)).join("");
  const encoded = [...Buffer.from(filename, "utf8")]
    .map((b) => (b < 128 && ATTR_CHAR.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, "0")}`))
    .join("");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
