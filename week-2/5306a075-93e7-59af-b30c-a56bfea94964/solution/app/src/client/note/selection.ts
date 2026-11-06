// Turning a browser selection inside the note body into offsets of the note's plain text, and back.
import { splitsSurrogatePair } from "../../shared/noteText.js";
import type { Pending } from "./NoteBody.js";

const pieces = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>("[data-start]"));
const startOf = (el: HTMLElement): number => Number(el.dataset.start);
const endOf = (el: HTMLElement): number => Number(el.dataset.end);

/** The text offset of a DOM point: inside a piece it is exact; between pieces it snaps forward (start) or back (end). */
function offsetOf(root: HTMLElement, node: Node, offset: number, edge: "start" | "end"): number | null {
  let previous: HTMLElement | null = null;
  for (const piece of pieces(root)) {
    const range = document.createRange();
    range.selectNodeContents(piece);
    const where = range.comparePoint(node, offset);
    if (where === 0) {
      if (node.nodeType === Node.TEXT_NODE && piece.contains(node)) return startOf(piece) + offset;
      return edge === "start" ? startOf(piece) : endOf(piece);
    }
    if (where < 0) return edge === "start" ? startOf(piece) : previous ? endOf(previous) : null;
    previous = piece;
  }
  return previous && edge === "end" ? endOf(previous) : null;
}

/** The pending span for the current selection, or null when it is empty, blank or reaches outside the body. */
export function selectionSpan(root: HTMLElement, text: string): Pending | null {
  const selection = getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  let start = offsetOf(root, range.startContainer, range.startOffset, "start");
  let end = offsetOf(root, range.endContainer, range.endOffset, "end");
  if (start === null || end === null || start >= end) return null;
  if (splitsSurrogatePair(text, start)) start -= 1;
  if (splitsSurrogatePair(text, end)) end += 1;
  return text.slice(start, end).trim() === "" ? null : { start, end };
}

/** Puts the browser selection back over a span after the body re-rendered (keyboard selection keeps extending). */
export function restoreSelection(root: HTMLElement, span: Pending): void {
  const locate = (at: number, edge: "start" | "end"): [Node, number] | null => {
    for (const piece of pieces(root)) {
      const inside = edge === "start" ? at >= startOf(piece) && at < endOf(piece) : at > startOf(piece) && at <= endOf(piece);
      if (inside && piece.firstChild) return [piece.firstChild, at - startOf(piece)];
    }
    return null;
  };
  const from = locate(span.start, "start");
  const to = locate(span.end, "end");
  const selection = getSelection();
  if (!from || !to || !selection) return;
  const range = document.createRange();
  range.setStart(from[0], from[1]);
  range.setEnd(to[0], to[1]);
  selection.removeAllRanges();
  selection.addRange(range);
}
