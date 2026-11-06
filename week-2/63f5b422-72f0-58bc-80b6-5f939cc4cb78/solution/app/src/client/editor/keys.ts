/** Where focus is, as the editor key table names it (Interactions: Editor keys). */
type FocusLocation = "dialog" | "menu" | "text" | "row" | "canvas" | "control" | "other";

const TEXT_INPUTS = new Set(["text", "search", "email", "url", "number", "password", "tel"]);

export function classifyFocus(target: Element | null): FocusLocation {
  if (!target || !(target instanceof HTMLElement)) return "other";
  if (target.closest("dialog, [role='dialog']")) return "dialog";
  if (target.closest("[role='menu']")) return "menu";
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) return "text";
  if (target instanceof HTMLInputElement) {
    if (TEXT_INPUTS.has(target.type)) return "text";
    return target.type === "radio" || target.type === "range" ? "control" : "other";
  }
  if (target.getAttribute("role") === "treeitem") return "row";
  if (target.id === "canvas" || target.hasAttribute("data-frame")) return "canvas";
  if (target instanceof HTMLButtonElement && target.closest(".pl-editor")) return "control";
  return "other";
}
