import { type Disposables, queryAll } from "../Disposables";

const HEADING = /^H[1-6]$/;

/**
 * Splits an element's text into word and letter spans (each letter carries its index as --i) so CSS can
 * move them. A heading keeps its full text as its accessible name through aria-label; any other element
 * keeps a visually hidden copy of the text and hides the letters from assistive technology.
 */
function split(element: HTMLElement) {
  const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
  const letters = document.createElement("span");
  letters.className = "sh-letters";
  let index = 0;
  text.split(" ").forEach((word, position) => {
    if (position > 0) letters.append(" ");
    const wrap = document.createElement("span");
    wrap.className = "sh-word";
    for (const char of word) {
      const letter = document.createElement("span");
      letter.className = "sh-char";
      letter.style.setProperty("--i", String(index++));
      letter.textContent = char;
      wrap.append(letter);
    }
    letters.append(wrap);
  });
  if (HEADING.test(element.tagName)) {
    element.setAttribute("aria-label", text);
    element.replaceChildren(letters);
    return;
  }
  if (element.closest("h1, h2, h3, h4, h5, h6")?.hasAttribute("aria-label")) {
    element.replaceChildren(letters);
    return;
  }
  const spoken = document.createElement("span");
  spoken.className = "sh-visually-hidden";
  spoken.textContent = text;
  letters.setAttribute("aria-hidden", "true");
  element.replaceChildren(spoken, letters);
}

/** Splits every `[data-split]` and `[data-settle]` element once its fonts are ready. */
export function splitLetters(root: ParentNode = document) {
  queryAll("[data-split], [data-settle]", root).forEach(split);
}

/**
 * Chapter titles, paragraphs and dials gain `is-in` just before they first come into view; CSS fades them
 * up in about two thirds of a second. The hero title waits for the gate (`revealHero`). Under reduced
 * motion everything shows at once.
 */
export function initReveals(disposables: Disposables, reduced: boolean) {
  const targets = queryAll("[data-reveal], .sh-dial-index");
  if (reduced) {
    targets.forEach((element) => element.classList.add("is-in"));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px 10% 0px" },
  );
  targets.forEach((element) => observer.observe(element));
  disposables.add(() => observer.disconnect());
}

export function revealHero(reduced: boolean) {
  queryAll(".sh-hero [data-split]").forEach((element, line) => {
    if (reduced) element.classList.add("is-in");
    else window.setTimeout(() => element.classList.add("is-in"), 120 + line * 160);
  });
}
