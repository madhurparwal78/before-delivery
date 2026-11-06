// Rich text allowlist, stored body, plain text, edit text, op application and
// the op transform with its conflict cases. Shared by the server merge and the
// browser rebase: this module is the single home of those rules.

export type Op = { retain: number } | { insert: string } | { delete: number };

export function isOp(x: unknown): x is Op {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  if (typeof r.retain === "number" && Number.isInteger(r.retain) && r.retain > 0) return true;
  if (typeof r.delete === "number" && Number.isInteger(r.delete) && r.delete > 0) return true;
  if (typeof r.insert === "string" && r.insert.length > 0) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Tolerant HTML tokenizer. The sanitiser filters this token stream; stray
// entity-encoded "<" must not smuggle a tag, so entities are decoded first.

type Token =
  | { t: "text"; text: string }
  | { t: "open"; name: string; attrs: Map<string, string> }
  | { t: "close"; name: string };

const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript"]);
const ALLOWED = new Set(["p", "br", "strong", "em", "code", "a", "ul", "ol", "li", "blockquote"]);
const CONTAINERS = new Set(["p", "li", "blockquote"]);

function decodeEntity(ref: string): string {
  if (ref.startsWith("&#x") || ref.startsWith("&#X")) {
    const n = parseInt(ref.slice(3).replace(/;$/, ""), 16);
    return safeChar(n);
  }
  if (ref.startsWith("&#")) {
    const n = parseInt(ref.slice(2).replace(/;$/, ""), 10);
    return safeChar(n);
  }
  const name = ref.slice(1).replace(/;$/, "");
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: "\u00a0" };
  return name in named ? named[name] : ref;
}

function safeChar(n: number): string {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "\uFFFD";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "\uFFFD";
  }
}

function decodeAttr(v: string): string {
  return v.replace(/&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/g, (all) => decodeEntity(all));
}

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text.length > 0) {
      out.push({ t: "text", text });
      text = "";
    }
  };
  while (i < html.length) {
    if (html[i] === "<") {
      if (html.startsWith("<!--", i)) {
        const end = html.indexOf("-->", i);
        i = end === -1 ? html.length : end + 3;
        continue;
      }
      const nextLt = html.indexOf("<", i + 1);
      const gt = html.indexOf(">", i + 1);
      const looksTag = /^[a-zA-Z/!?]/.test(html.slice(i + 1));
      if (!looksTag || gt === -1 || (nextLt !== -1 && nextLt < gt)) {
        // begins no tag: keep it as text
        text += html[i];
        i += 1;
        continue;
      }
      const inner = html.slice(i + 1, gt);
      if (inner.startsWith("!") || inner.startsWith("?")) {
        flush();
        i = gt + 1;
        continue;
      }
      flush();
      if (inner.startsWith("/")) {
        out.push({ t: "close", name: inner.slice(1).trim().toLowerCase() });
      } else {
        out.push({ t: "open", ...parseOpenTag(inner) });
      }
      i = gt + 1;
    } else if (html[i] === "&") {
      const m = /^&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[a-zA-Z][a-zA-Z0-9]*;)/.exec(html.slice(i));
      if (m) {
        text += decodeEntity(m[0]);
        i += m[0].length;
      } else {
        text += "&";
        i += 1;
      }
    } else {
      text += html[i];
      i += 1;
    }
  }
  flush();
  return out;
}

function parseOpenTag(inner: string): { name: string; attrs: Map<string, string> } {
  const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(inner);
  if (nameMatch === null) return { name: "", attrs: new Map() };
  const name = nameMatch[0].toLowerCase();
  const rest = inner.slice(nameMatch[0].length);
  const attrs = new Map<string, string>();
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(=\s*("[^"]*"|'[^']*'|[^\s"'>]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rest)) !== null) {
    if (m[1] === "/") continue;
    if (m[2] !== undefined) {
      const raw = m[3] ?? "";
      const v = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0]) ? raw.slice(1, -1) : raw;
      attrs.set(m[1].toLowerCase(), decodeAttr(v));
    } else {
      attrs.set(m[1].toLowerCase(), "");
    }
  }
  return { name, attrs };
}

// ---------------------------------------------------------------------------
// Document model: blocks of inline runs.

export type Mark = "strong" | "em" | "code" | "a";
export interface MarkSpec {
  mark: Mark;
  href?: string;
}
export type Inline =
  | { t: "text"; text: string }
  | { t: "br" }
  | { t: "mark"; mark: Mark; href?: string; children: Inline[] };

export type BlockKind = "p" | "li" | "blockquote";
export interface Block {
  kind: BlockKind;
  list: "ul" | "ol" | null;
  listSeq: number;
  inlines: Inline[];
}
export interface Doc {
  blocks: Block[];
}

function normalizeName(name: string): string {
  if (name === "b") return "strong";
  if (name === "i") return "em";
  return name;
}

/** Parse input HTML into a document with only the allowed structure. Stray
 * top-level whitespace between blocks is dropped; marks never nest across a
 * block boundary; lists close when their parent closes. */
export function parseDoc(html: string): Doc {
  const doc: Doc = { blocks: [] };
  let dropName: string | null = null;
  let dropDepth = 0;
  const stack: Array<{ block: Block }> = [];
  const marks: MarkSpec[] = [];
  let listKind: "ul" | "ol" | null = null;
  let listSeq = 0;
  let listDepth = 0;

  const pushText = (s: string) => {
    if (s.length === 0) return;
    if (stack.length > 0) {
      appendInline(stack[stack.length - 1].block.inlines, marks, { t: "text", text: s });
    } else {
      // top-level inline: wrap in a p run
      const block: Block = { kind: "p", list: null, listSeq: 0, inlines: [] };
      doc.blocks.push(block);
      stack.push({ block });
      appendInline(block.inlines, marks, { t: "text", text: s });
    }
  };

  for (const tok of tokenize(html)) {
    if (dropDepth > 0) {
      if (tok.t === "open" && tok.name === dropName) dropDepth += 1;
      else if (tok.t === "close" && tok.name === dropName) dropDepth -= 1;
      continue;
    }
    if (tok.t === "text") {
      if (stack.length === 0 && tok.text.trim().length === 0) continue;
      pushText(tok.text);
      continue;
    }
    const name = normalizeName(tok.name);
    if (tok.t === "open") {
      if (DROP_WITH_CONTENT.has(name)) {
        dropName = name;
        dropDepth = 1;
        continue;
      }
      if (!ALLOWED.has(name)) continue; // unwrap: text of the element is kept
      if (name === "br") {
        const block = stack.length > 0 ? stack[stack.length - 1].block : null;
        if (block) appendInline(block.inlines, marks, { t: "br" });
        else {
          const b: Block = { kind: "p", list: null, listSeq: 0, inlines: [] };
          doc.blocks.push(b);
          stack.push({ block: b });
          appendInline(b.inlines, marks, { t: "br" });
        }
        continue;
      }
      if (name === "ul" || name === "ol") {
        listDepth += 1;
        if (listDepth === 1) {
          listSeq += 1;
          listKind = name;
        }
        continue;
      }
      if (CONTAINERS.has(name)) {
        const block: Block = { kind: name as BlockKind, list: name === "li" && listKind ? listKind : null, listSeq, inlines: [] };
        doc.blocks.push(block);
        stack.push({ block });
        continue;
      }
      // inline mark
      let href: string | undefined;
      if (name === "a") {
        const raw = (tok.attrs.get("href") ?? "").trim();
        const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
        const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;
        if (raw.length > 0 && (scheme === "http" || scheme === "https" || scheme === "mailto")) href = raw;
        // any other link is replaced by its text: push a dummy href-less mark
      }
      marks.push({ mark: name as Mark, href });
      continue;
    }
    // close tag
    if (name === "strong" || name === "em" || name === "code" || name === "a") {
      for (let k = marks.length - 1; k >= 0; k -= 1) {
        if (marks[k].mark === name) {
          marks.splice(k, 1);
          break;
        }
      }
      continue;
    }
    if (name === "ul" || name === "ol") {
      listDepth -= 1;
      if (listDepth <= 0) {
        listDepth = 0;
        listKind = null;
      }
      continue;
    }
    if (CONTAINERS.has(name)) {
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].block.kind === name) {
          stack.splice(k);
          break;
        }
      }
      continue;
    }
  }
  return doc;
}

/** Append an inline into the mark nesting given by `marks`, reusing
 * consecutive mark nodes so serialization is compact and canonical. */
function appendInline(target: Inline[], marks: MarkSpec[], leaf: { t: "text"; text: string } | { t: "br" }): void {
  if (marks.length === 0) {
    if (leaf.t === "text" && target.length > 0) {
      const last = target[target.length - 1];
      if (last.t === "text") {
        last.text += leaf.text;
        return;
      }
    }
    target.push(leaf);
    return;
  }
  const top = marks[0];
  let node: Inline | undefined;
  for (const child of target) {
    if (child.t === "mark" && child.mark === top.mark && (top.mark !== "a" || (top.href ?? undefined) === (child as { href?: string }).href)) {
      node = child;
      break;
    }
  }
  if (!node) {
    node = { t: "mark", mark: top.mark, href: top.href, children: [] };
    target.push(node);
  }
  appendInline((node as { children: Inline[] }).children, marks.slice(1), leaf);
}

// ---------------------------------------------------------------------------
// Canonical serialization.

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHref(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function serializeInline(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += escapeText(n.text);
    else if (n.t === "br") out += "<br>";
    else if (n.mark === "a") {
      if (n.href === undefined) out += serializeInline(n.children);
      else out += `<a href="${escapeHref(n.href)}">` + serializeInline(n.children) + "</a>";
    } else out += `<${n.mark}>` + serializeInline(n.children) + `</${n.mark}>`;
  }
  return out;
}

export function serializeDoc(doc: Doc): string {
  let out = "";
  let openList: "ul" | "ol" | null = null;
  let openListSeq = -1;
  for (const block of doc.blocks) {
    if (block.kind === "li") {
      if (openList !== block.list || openListSeq !== block.listSeq) {
        if (openList !== null) out += `</${openList}>`;
        openList = block.list ?? "ul";
        openListSeq = block.listSeq;
        out += `<${openList}>`;
      }
      out += `<li>${serializeInline(block.inlines)}</li>`;
    } else {
      if (openList !== null) {
        out += `</${openList}>`;
        openList = null;
      }
      out += `<${block.kind}>${serializeInline(block.inlines)}</${block.kind}>`;
    }
  }
  if (openList !== null) out += `</${openList}>`;
  return out;
}

/** Sanitise HTML input to the canonical stored body. Empty input gives "". */
export function sanitizeBody(html: string): string {
  if (typeof html !== "string") return "";
  return serializeDoc(parseDoc(html));
}

/** Plain text of a stored body: tags removed, br and block boundaries become
 * one space, the three entities decoded, trimmed. */
export function plainText(body: string): string {
  const doc = parseDoc(body);
  const parts: string[] = [];
  for (const block of doc.blocks) {
    let s = "";
    blockInlines(block, (ch, kind) => {
      s += kind === "br" ? " " : ch;
    });
    parts.push(s);
  }
  return parts.join(" ").trim();
}

// ---------------------------------------------------------------------------
// Edit text and the atom model. Offsets count UTF-16 code units.

export interface Atom {
  ch: string; // one UTF-16 code unit
  key: string; // serialized mark context
  href: string | null;
  block: number;
  kind: "text" | "br" | "boundary";
}

export function markKey(marks: MarkSpec[]): string {
  const parts = marks.map((m) => (m.mark === "a" ? `a\x00${m.href ?? ""}` : m.mark));
  parts.sort();
  return parts.join("\x01");
}

function keyToMarks(key: string): MarkSpec[] {
  if (key.length === 0) return [];
  const out: MarkSpec[] = [];
  for (const part of key.split("\x01")) {
    if (part === "a") out.push({ mark: "a" });
    else if (part.startsWith("a\x00")) out.push({ mark: "a", href: part.slice(2) });
    else out.push({ mark: part as Mark });
  }
  return out;
}

function blockInlines(block: Block, emit: (ch: string, kind: "text" | "br", key: string, href: string | null) => void): void {
  const walk = (nodes: Inline[], marks: MarkSpec[]) => {
    for (const n of nodes) {
      if (n.t === "text") {
        const key = markKey(marks);
        const href = marks.find((m) => m.mark === "a")?.href ?? null;
        for (let i = 0; i < n.text.length; i += 1) emit(n.text[i], "text", key, href);
      } else if (n.t === "br") {
        emit("\n", "br", markKey(marks), null);
      } else {
        walk(n.children, [...marks, { mark: n.mark, href: n.href }]);
      }
    }
  };
  walk(block.inlines, []);
}

/** The edit text of a stored body (UTF-16 code units, not trimmed). */
export function editText(body: string): string {
  const doc = parseDoc(body);
  let out = "";
  for (let i = 0; i < doc.blocks.length; i += 1) {
    if (i > 0) out += "\n";
    blockInlines(doc.blocks[i], (ch) => {
      out += ch;
    });
  }
  return out;
}

function atomsFromBody(body: string): { atoms: Atom[]; blocks: Block[] } {
  const doc = parseDoc(body);
  const atoms: Atom[] = [];
  for (let i = 0; i < doc.blocks.length; i += 1) {
    if (i > 0) {
      atoms.push({ ch: "\n", key: "", href: null, block: i - 1, kind: "boundary" });
    }
    blockInlines(doc.blocks[i], (ch, kind, key, href) => {
      atoms.push({ ch, key, href, block: i, kind });
    });
  }
  return { atoms, blocks: doc.blocks };
}

/** Serialize an atom list back to a stored body. */
export function bodyFromAtoms(atoms: Atom[], blocks: Block[]): string {
  // dense remap of block indices
  const order: number[] = [];
  for (const a of atoms) {
    if (!order.includes(a.block)) order.push(a.block);
  }
  const remap = new Map<number, number>();
  order.forEach((b, i) => remap.set(b, i));
  const doc: Doc = { blocks: [] };
  for (const b of order) {
    // an empty source body has no blocks; inserts into it start a paragraph
    const src = blocks[b] ?? { kind: "p" as BlockKind, list: null, listSeq: 0, inlines: [] };
    const block: Block = { kind: src.kind, list: src.list, listSeq: src.listSeq, inlines: [] };
    doc.blocks.push(block);
  }
  const currentMark: { block: number; marks: MarkSpec[]; target: Inline[] } = { block: -1, marks: [], target: [] };
  const settle = (blockIdx: number) => {
    if (currentMark.block === blockIdx) return;
    currentMark.block = blockIdx;
    currentMark.marks = [];
    currentMark.target = doc.blocks[remap.get(blockIdx) as number].inlines;
  };
  for (const a of atoms) {
    if (a.kind === "boundary") continue;
    const key = a.kind === "br" ? "" : a.key;
    if (currentMark.block !== a.block) settle(a.block);
    const want = keyToMarks(key);
    if (markKey(want) !== markKey(currentMark.marks)) {
      currentMark.marks = want;
      currentMark.target = doc.blocks[remap.get(a.block) as number].inlines;
    }
    appendInline(currentMark.target, currentMark.marks, a.kind === "br" ? { t: "br" } : { t: "text", text: a.ch });
  }
  return serializeDoc(doc);
}

/** Apply op list (aligned to the current version) to a stored body. */
export function applyOps(body: string, ops: Op[]): string {
  const { atoms, blocks } = atomsFromBody(body);
  const result: Atom[] = [];
  let pos = 0;
  for (const op of ops) {
    if ("retain" in op) {
      for (let i = 0; i < op.retain; i += 1) {
        const a = atoms[pos + i];
        if (a === undefined) break;
        result.push(a);
      }
      pos += op.retain;
    } else if ("delete" in op) {
      for (let i = 0; i < op.delete; i += 1) {
        const a = atoms[pos + i];
        if (a === undefined) break;
        if (a.kind === "boundary") {
          const left = a.block;
          const right = atoms[pos + i + 1] !== undefined ? atoms[pos + i + 1].block : left;
          if (right !== left) {
            for (let k = pos + i + 1; k < atoms.length; k += 1) if (atoms[k].block === right) atoms[k].block = left;
            for (const r of result) if (r.block === right) r.block = left;
          }
        }
        // br and text characters drop
      }
      pos += op.delete;
    } else {
      const text = op.insert;
      const before = pos > 0 ? atoms[pos - 1] : null;
      const after = pos < atoms.length ? atoms[pos] : null;
      const ref = before ?? after;
      const key = ref ? ref.key : "";
      const href = ref ? ref.href : null;
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === "\n") {
          result.push({ ch: "\n", key, href, block: ref ? ref.block : 0, kind: "br" });
        } else {
          result.push({ ch, key, href, block: ref ? ref.block : 0, kind: "text" });
        }
      }
    }
  }
  return bodyFromAtoms(result, blocks);
}

// ---------------------------------------------------------------------------
// The op transform and its conflict cases, in commit order.

export interface Change {
  kind: "insert" | "delete";
  pos: number;
  len: number;
  text: string; // for inserts
}

export function opsToChanges(ops: Op[]): Change[] {
  const changes: Change[] = [];
  let pos = 0;
  for (const op of ops) {
    if ("retain" in op) pos += op.retain;
    else if ("insert" in op) changes.push({ kind: "insert", pos, len: op.insert.length, text: op.insert });
    else {
      changes.push({ kind: "delete", pos, len: op.delete, text: "" });
      pos += op.delete;
    }
  }
  return changes;
}

export function changesToOps(changes: Change[], totalLen: number): Op[] {
  const ops: Op[] = [];
  let pos = 0;
  for (const c of changes) {
    if (c.pos > pos) ops.push({ retain: c.pos - pos });
    if (c.kind === "insert") ops.push({ insert: c.text });
    else ops.push({ delete: c.len });
    pos = c.kind === "insert" ? c.pos : c.pos + c.len;
  }
  if (pos < totalLen) ops.push({ retain: totalLen - pos });
  return ops;
}

export interface TransformResult {
  ops: Op[];
  conflict: boolean;
}

/**
 * Transform the incoming ops over the ops of the revision committed just
 * before them, in commit order. Returns the incoming ops rewritten for the
 * text after the committed revision, and whether a conflict case holds.
 * On conflict the incoming ops are returned unchanged.
 */
export function transformOps(incoming: Op[], committed: Op[]): TransformResult {
  const inc = opsToChanges(incoming);
  const com = opsToChanges(committed);
  // the incoming ops cover their base text: retains plus deletes
  const baseLen = incoming.reduce((n, op) => n + ("retain" in op ? op.retain : "delete" in op ? op.delete : 0), 0);
  // map committed change positions over the committed changes before them,
  // so each is expressed in the text produced by its predecessors
  const comMapped: Change[] = [];
  for (const c of com) {
    let p = c.pos;
    for (const d of comMapped) {
      if (d.kind === "insert" && d.pos <= p) p += d.len;
      else if (d.kind === "delete" && d.pos + d.len <= p) p -= d.len;
    }
    comMapped.push({ ...c, pos: p });
  }
  let conflict = false;
  for (const com of comMapped) {
    for (const m of inc) {
      if (com.kind === "insert") {
        if (com.pos < m.pos) m.pos += com.len;
        else if (com.pos < m.pos + m.len && m.kind === "delete") {
          conflict = true; // committed insert strictly inside incoming delete
          break;
        }
      } else {
        const s = com.pos;
        const e = com.pos + com.len;
        if (m.kind === "insert") {
          if (s < m.pos && m.pos < e) {
            conflict = true; // incoming insert strictly inside committed delete
            break;
          }
          if (m.pos >= e) m.pos -= com.len;
        } else {
          const ms = m.pos;
          const me = m.pos + m.len;
          if (Math.max(ms, s) < Math.min(me, e)) {
            conflict = true;
            break;
          }
          if (e <= ms) m.pos -= com.len;
        }
      }
    }
    if (conflict) break;
  }
  if (conflict) return { ops: incoming, conflict: true };
  // the transformed ops must cover the text the committed revision produced
  const delta = comMapped.reduce((n, c) => n + (c.kind === "insert" ? c.len : -c.len), 0);
  return { ops: changesToOps(inc, baseLen + delta), conflict: false };
}
