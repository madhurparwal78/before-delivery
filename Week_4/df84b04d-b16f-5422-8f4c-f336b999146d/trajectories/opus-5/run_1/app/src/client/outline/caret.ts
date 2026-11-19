/** Caret reading and placing inside a row's editable text. */

export function textOf(element: HTMLElement): string {
  return element.textContent ?? '';
}

export function caretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return textOf(element).length;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return textOf(element).length;
  const measure = range.cloneRange();
  measure.selectNodeContents(element);
  measure.setEnd(range.startContainer, range.startOffset);
  return measure.toString().length;
}

export function placeCaret(element: HTMLElement, offset: number): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const range = document.createRange();
  let remaining = offset;
  let placed = false;
  const walk = (node: Node): void => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? '').length;
      if (remaining <= length) {
        range.setStart(node, remaining);
        placed = true;
        return;
      }
      remaining -= length;
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(element);
  if (!placed) {
    range.selectNodeContents(element);
    range.collapse(false);
  } else {
    range.collapse(true);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function caretToEnd(element: HTMLElement): void {
  placeCaret(element, textOf(element).length);
}

export function selectionIsCollapsed(): boolean {
  const selection = window.getSelection();
  return selection === null || selection.isCollapsed;
}
