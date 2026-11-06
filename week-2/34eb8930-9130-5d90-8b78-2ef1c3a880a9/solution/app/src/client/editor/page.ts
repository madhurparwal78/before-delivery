import { blocksOf, type ProposalState } from "../../shared/model.js";
import type { Range } from "../../shared/types.js";

/** One highlighted range drawn on the page: a suggestion half or a comment anchor. */
export interface Cover { id: string; range: Range; kind: "ins" | "del" | "cmt"; colour: string }

interface PageDecor {
  covers: Cover[];
  focused: string | null;
  hits: number[];
  hitLength: number;
  currentHit: number;
  chips: { id: string; at: number; n: number; colour: string }[];
  ink: { range: Range; colour: string }[];
}

const end = (r: Range): number => r.at + r.length;

/**
 * Renders the proposal into the page element. Blocks are direct children; every highlighted range
 * is wrapped in `data-anchor-for` spans (nested when ranges overlap); marker chips follow ranges.
 */
export function renderPage(el: HTMLElement, proposal: ProposalState, decor: PageDecor): number[] {
  const blocks = blocksOf(proposal);
  const out: HTMLElement[] = [];
  for (const b of blocks) {
    const node = document.createElement("div");
    node.className = "blk";
    node.dataset.style = b.style;
    const stop = b.at + b.length;
    const edges = new Set<number>([b.at, stop]);
    const add = (p: number): void => { if (p > b.at && p < stop) edges.add(p); };
    for (const m of proposal.marks) { add(m.at); add(end(m)); }
    for (const c of decor.covers) { add(c.range.at); add(end(c.range)); }
    for (const p of decor.hits) { add(p); add(p + decor.hitLength); }
    for (const k of decor.ink) { add(k.range.at); add(end(k.range)); }
    for (const c of decor.chips) add(c.at);
    const cuts = [...edges].sort((x, y) => x - y);
    const chipsAt = (p: number): void => {
      for (const c of decor.chips) {
        if (c.at !== p) continue;
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "chip";
        chip.contentEditable = "false";
        chip.dataset.markerFor = c.id;
        chip.dataset.skip = "";
        chip.setAttribute("aria-label", `Card ${c.n}`);
        chip.textContent = String(c.n);
        chip.style.setProperty("--ac", c.colour);
        node.append(chip);
      }
    };
    for (let i = 0; i + 1 < cuts.length; i++) {
      const s = cuts[i];
      const e = cuts[i + 1];
      if (e > s) node.append(run(proposal, decor, s, e));
      chipsAt(e);
    }
    if (b.length === 0) node.append(document.createElement("br"));
    out.push(node);
  }
  el.replaceChildren(...out);
  return blocks.map((b) => b.at);
}

function run(proposal: ProposalState, decor: PageDecor, s: number, e: number): Node {
  const inside = (r: Range): boolean => r.at <= s && end(r) >= e && r.length > 0;
  const classes: string[] = [];
  let href = "";
  for (const m of proposal.marks) {
    if (!inside(m)) continue;
    classes.push(`m-${m.type}`);
    if (m.type === "link") href = m.href ?? "";
  }
  const covers = decor.covers.filter((c) => inside(c.range));
  let accent = "";
  for (const c of covers) {
    if (c.kind === "cmt") continue;
    classes.push(c.kind === "ins" ? "s-ins" : "s-del");
    accent = c.colour;
  }
  const hit = decor.hits.findIndex((p) => p <= s && p + decor.hitLength >= e);
  if (hit >= 0) classes.push(hit === decor.currentHit ? "find-hit find-current" : "find-hit");
  const ink = decor.ink.find((k) => inside(k.range));
  if (ink) { classes.push("ink-settle"); accent = ink.colour; }
  let node: Node = document.createTextNode(proposal.text.slice(s, e));
  if (classes.length) {
    const span = document.createElement("span");
    span.className = [...new Set(classes)].join(" ");
    if (accent) span.style.setProperty("--ac", accent);
    if (href) span.title = href;
    span.append(node);
    node = span;
  }
  for (const c of [...covers].reverse()) {
    const wrap = document.createElement("span");
    wrap.className = c.id === decor.focused ? "anc anc-focus" : "anc";
    wrap.dataset.anchorFor = c.id;
    wrap.style.setProperty("--wash", c.colour);
    wrap.append(node);
    node = wrap;
  }
  return node;
}

function textNodes(block: Element): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("[data-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** Model offset of a DOM point inside the page, or null when the point is outside it. */
export function offsetOf(page: HTMLElement, starts: number[], textLength: number, node: Node, offset: number): number | null {
  if (node === page) return offset >= starts.length ? textLength : starts[offset];
  if (!page.contains(node)) return null;
  let block: Node | null = node;
  while (block && block.parentNode !== page) block = block.parentNode;
  if (!block) return null;
  const index = [...page.children].indexOf(block as Element);
  if (index < 0) return null;
  const range = document.createRange();
  range.setStart(block, 0);
  range.setEnd(node, offset);
  let n = 0;
  for (const t of textNodes(block as Element)) {
    if (t === node) return starts[index] + n + offset;
    if (range.comparePoint(t, t.length) <= 0) n += t.length;
    else break;
  }
  return starts[index] + n;
}

/** DOM point for a model offset (the end of a run wins over the start of the next). */
export function pointAt(page: HTMLElement, starts: number[], p: number): { node: Node; offset: number } {
  let index = 0;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= p) index = i;
  const block = page.children[index] as HTMLElement | undefined;
  if (!block) return { node: page, offset: 0 };
  const local = p - starts[index];
  let acc = 0;
  const nodes = textNodes(block);
  for (const t of nodes) {
    if (local <= acc + t.length) return { node: t, offset: local - acc };
    acc += t.length;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.length } : { node: block, offset: 0 };
}

/** A caret rectangle for a model offset (for remote carets). */
export function caretRect(page: HTMLElement, starts: number[], p: number): DOMRect | null {
  const pt = pointAt(page, starts, p);
  const r = document.createRange();
  r.setStart(pt.node, pt.offset);
  r.collapse(true);
  const rects = r.getClientRects();
  if (rects.length) return rects[rects.length - 1];
  const host = pt.node instanceof Element ? pt.node : pt.node.parentElement;
  return host ? host.getBoundingClientRect() : null;
}

/** Selection keys (Interactions): a word is a run of letters or digits. */
const isWord = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

export function wordRight(text: string, p: number): number {
  while (p < text.length && !isWord(text[p])) p++;
  while (p < text.length && isWord(text[p])) p++;
  return p;
}

export function wordLeft(text: string, p: number): number {
  while (p > 0 && !isWord(text[p - 1])) p--;
  while (p > 0 && isWord(text[p - 1])) p--;
  return p;
}
