import { type Screen } from "../app.js";
import { el } from "../dom.js";

/** emptyState is one Anton line at display size with one sentence under it. */
export const emptyState = (line: string, sentence: string): HTMLElement =>
  el("section", { class: "empty" }, [
    el("p", { class: "empty-line", text: line }),
    el("p", { class: "empty-sentence", text: sentence }),
  ]);

/**
 * staticScreen leaves the page as the server wrote it. The not-found,
 * not-your-desk and sign-in pages arrive complete in the first response.
 */
export const staticScreen: Screen = () => undefined;
