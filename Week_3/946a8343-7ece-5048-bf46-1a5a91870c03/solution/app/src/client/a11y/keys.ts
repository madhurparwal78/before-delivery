// Keyboard helpers.
//   isTypingTarget(el)       true for text fields, selects, textareas, contenteditable and ARIA text widgets: letter shortcuts
//                            must never fire there.
//   shortcutKey(event)       the pressed key when it may act as a letter shortcut (no Ctrl/Alt/Meta, not typing), else null.
const NON_TEXT_INPUTS = new Set(["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"]);

export function isTypingTarget(target: EventTarget | Element | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  const role = target.getAttribute("role");
  return role === "textbox" || role === "searchbox" || role === "combobox";
}
