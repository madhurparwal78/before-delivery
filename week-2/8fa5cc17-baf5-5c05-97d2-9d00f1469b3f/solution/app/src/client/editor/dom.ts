// A block's edit text read from its editable element, and offsets mapped between the DOM and the
// edit text (one line feed per br and per boundary between p, li or blockquote leaves).

const LEAF_PARENTS = new Set(['P', 'LI', 'BLOCKQUOTE', 'DIV', 'UL', 'OL']);

type Piece =
  | { kind: 'text'; node: Text; start: number }
  | { kind: 'br'; node: HTMLElement; start: number }
  | { kind: 'sep'; start: number; before: Node };

/** The element whose children form the leaf a node belongs to. */
function leafOf(node: Node, root: HTMLElement): Node {
  let el: Node | null = node.parentNode;
  while (el && el !== root) {
    if (el instanceof HTMLElement && LEAF_PARENTS.has(el.tagName)) return el;
    el = el.parentNode;
  }
  return root;
}

/** A br the browser keeps only to hold an empty line open is not part of the text. */
function isFiller(br: HTMLElement): boolean {
  if (br.dataset.filler !== undefined) return true;
  const parent = br.parentNode;
  return !!parent && parent.lastChild === br && (parent.textContent ?? '') === '' && parent.childNodes.length === 1;
}

function pieces(root: HTMLElement): { pieces: Piece[]; text: string } {
  const out: Piece[] = [];
  let text = '';
  let leaf: Node | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const isText = n.nodeType === Node.TEXT_NODE;
    const isBr = n instanceof HTMLElement && n.tagName === 'BR' && !isFiller(n);
    if (!isText && !isBr) continue;
    if (isText && (n as Text).data === '') continue;
    const here = leafOf(n, root);
    if (leaf !== null && here !== leaf) {
      out.push({ kind: 'sep', start: text.length, before: n });
      text += '\n';
    }
    leaf = here;
    if (isText) {
      out.push({ kind: 'text', node: n as Text, start: text.length });
      text += (n as Text).data;
    } else {
      out.push({ kind: 'br', node: n as HTMLElement, start: text.length });
      text += '\n';
    }
  }
  return { pieces: out, text };
}

export function editTextOf(root: HTMLElement): string {
  return pieces(root).text;
}

/** The edit-text offset of a DOM position inside the element. */
export function offsetOf(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  let total = 0;
  for (const p of pieces(root).pieces) {
    const len = p.kind === 'text' ? p.node.data.length : 1;
    if (p.kind === 'text') {
      if (p.node === node) return p.start + Math.min(offset, len);
      if (range.comparePoint(p.node, 0) > 0) return p.start;
      total = p.start + len;
    } else {
      const ref = p.kind === 'br' ? p.node : p.before;
      if (range.comparePoint(ref, 0) > 0) return p.start;
      total = p.start + 1;
    }
  }
  return total;
}

/** The caret (anchor and head) as edit-text offsets, or null when the selection is elsewhere. */
export function selectionOffsets(root: HTMLElement): { anchor: number; head: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode || !root.contains(sel.anchorNode) || !root.contains(sel.focusNode)) return null;
  return { anchor: offsetOf(root, sel.anchorNode, sel.anchorOffset), head: offsetOf(root, sel.focusNode, sel.focusOffset) };
}

/** The DOM position of an edit-text offset. */
export function positionOf(root: HTMLElement, offset: number): { node: Node; offset: number } {
  const { pieces: list } = pieces(root);
  for (const p of list) {
    if (p.kind === 'text') {
      if (offset <= p.start + p.node.data.length) return { node: p.node, offset: Math.max(0, offset - p.start) };
    } else if (offset <= p.start) {
      const ref = p.kind === 'br' ? p.node : p.before;
      const parent = ref.parentNode ?? root;
      return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, ref) };
    }
  }
  const last = list[list.length - 1];
  if (last && last.kind === 'text') return { node: last.node, offset: last.node.data.length };
  if (last && last.kind === 'br') {
    const parent = last.node.parentNode ?? root;
    return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, last.node) + 1 };
  }
  const deepest = root.lastElementChild && LEAF_PARENTS.has(root.lastElementChild.tagName) ? root.lastElementChild : root;
  return { node: deepest, offset: deepest.childNodes.length };
}

export function setSelection(root: HTMLElement, anchor: number, head: number = anchor): void {
  const sel = window.getSelection();
  if (!sel) return;
  const a = positionOf(root, anchor);
  const h = positionOf(root, head);
  sel.setBaseAndExtent(a.node, a.offset, h.node, h.offset);
}

/** The left edge of the character at `offset` (or the right edge of the one before it), in viewport pixels. */
export function caretRect(root: HTMLElement, offset: number): { left: number; top: number; height: number } | null {
  const { pieces: list } = pieces(root);
  for (const p of list) {
    if (p.kind !== 'text') continue;
    const len = p.node.data.length;
    if (offset < p.start || offset > p.start + len) continue;
    const o = offset - p.start;
    const range = document.createRange();
    if (o < len) {
      range.setStart(p.node, o);
      range.setEnd(p.node, o + 1);
      const r = range.getBoundingClientRect();
      return { left: r.left, top: r.top, height: r.height };
    }
    if (o > 0) {
      range.setStart(p.node, o - 1);
      range.setEnd(p.node, o);
      const r = range.getBoundingClientRect();
      return { left: r.right, top: r.top, height: r.height };
    }
  }
  const box = root.getBoundingClientRect();
  return list.length ? null : { left: box.left + parseFloat(getComputedStyle(root).paddingLeft || '0'), top: box.top, height: parseFloat(getComputedStyle(root).lineHeight) || 24 };
}
