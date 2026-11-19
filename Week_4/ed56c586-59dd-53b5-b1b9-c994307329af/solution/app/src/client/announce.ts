import { must } from "./dom.js";

/** `Site updates`: the one polite live region for results visitors cause. The text is replaced for each announcement. */

export function announce(message: string): void {
  must<HTMLElement>(document, "[data-site-updates]").replaceChildren(document.createTextNode(message));
}
