// Template syntax: {{trigger.x}}, {{steps.s1.y}}, {{loop.item.z}},
// {{loop.index}}, {{run.id}}. One whole expression keeps the type; other
// fields stringify. Unknown paths resolve to empty text and log a line.

export interface TplCtx {
  trigger: Record<string, unknown>;
  steps: Record<string, unknown>;
  loop: { index: number; item: unknown } | null;
  run: { id: string };
  log: string[];
}

export interface TplResult { value: unknown; whole: boolean }

const EXPR = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/;

export function resolveTemplate(text: string, ctx: TplCtx): unknown {
  const m = EXPR.exec(text);
  if (m) {
    const r = lookupPath(m[1], ctx);
    return r.value;
  }
  return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_whole, path: string) => {
    const r = lookupPath(path, ctx);
    return stringify(r.value);
  });
}

export function lookupPath(path: string, ctx: TplCtx): { value: unknown; known: boolean } {
  const parts = path.split(".");
  const head = parts[0];
  if (head === "trigger") return { value: walk(ctx.trigger, parts.slice(1)), known: pathKnown(ctx.trigger, parts.slice(1)) };
  if (head === "run") return { value: walk(ctx.run, parts.slice(1)), known: pathKnown(ctx.run, parts.slice(1)) };
  if (head === "steps") {
    const sid = parts[1];
    if (sid === undefined) return { value: undefined, known: false };
    const out = ctx.steps[sid];
    if (out === undefined) return { value: undefined, known: false };
    return { value: walk(out, parts.slice(2)), known: pathKnown(out, parts.slice(2)) };
  }
  if (head === "loop") {
    if (!ctx.loop) return { value: undefined, known: false };
    const sub = parts[1];
    if (sub === "index" && parts.length === 2) return { value: ctx.loop.index, known: true };
    if (sub === "item") return { value: walk(ctx.loop.item, parts.slice(2)), known: pathKnown(ctx.loop.item, parts.slice(2)) };
    return { value: undefined, known: false };
  }
  return { value: undefined, known: false };
}

function walk(v: unknown, parts: string[]): unknown {
  let cur: unknown = v;
  for (const p of parts) {
    if (cur && typeof cur === "object") {
      cur = (cur as Record<string, unknown>)[p];
    } else if (Array.isArray(cur) && /^\d+$/.test(p)) {
      cur = (cur as unknown[])[Number(p)];
    } else {
      return undefined;
    }
  }
  return cur;
}

function pathKnown(root: unknown, parts: string[]): boolean {
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return false;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(p)) return false;
      cur = cur[Number(p)];
    } else if (typeof cur === "object") {
      if (!(p in (cur as Record<string, unknown>))) return false;
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return false;
    }
  }
  return true;
}

export function stringify(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export function resolveField(text: string, ctx: TplCtx): { value: unknown; isWhole: boolean } {
  const m = EXPR.exec(text);
  if (m) {
    const r = lookupPath(m[1], ctx);
    if (!r.known) ctx.log.push("Unknown template path: " + m[1]);
    return { value: r.value ?? "", isWhole: true };
  }
  let unknown: string | null = null;
  const value = text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_w, path: string) => {
    const r = lookupPath(path, ctx);
    if (!r.known && unknown === null) unknown = path;
    return stringify(r.value);
  });
  // "Hi {{trigger.nope}}!" adds the log line for each unknown path used.
  for (const mm of text.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g)) {
    const r = lookupPath(mm[1], ctx);
    if (!r.known) ctx.log.push("Unknown template path: " + mm[1]);
  }
  return { value, isWhole: false };
}
