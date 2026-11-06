// The quote picker, the quote insertion and the Margin Tether motion.

import { api, type BlockJson, ApiFailure, NetworkFailure } from "./api.js";
import { h, openDialog, announce, alertMessage, reducedMotion, clearAlert } from "./dom.js";
import { MOTION, QUIRE_CURVE, SEARCH_DEBOUNCE } from "./constants.js";
import { blockById, currentObjectId, reloadCurrentObject, pushUndo } from "./object.js";
import { mainEl } from "./app.js";

interface PickerResult {
  block_id: string;
  object_id: string;
  object_title: string;
  excerpt: string;
}

/**
 * Typing two opening parentheses in a block opens the picker. `keptText` is
 * the block's text before the first paren.
 */
export function openQuotePicker(bs: ReturnType<typeof blockById>, box: HTMLTextAreaElement, keptText: string): void {
  if (bs === null) return;
  const searchBox = h("input", { type: "text", "aria-label": "Search blocks", class: "picker-search" });
  const listbox = h("ul", { role: "listbox", "aria-label": "Matching blocks", class: "picker-list" });
  const status = h("div", { role: "status", "aria-live": "polite", "aria-label": "Picker results", class: "picker-status" });
  let activeIndex = 0;
  let results: PickerResult[] = [];
  let searchToken = 0;
  let chosen = false;

  const renderResults = (): void => {
    listbox.replaceChildren();
    results.forEach((r, i) => {
      const option = h("li", { role: "option", "aria-selected": String(i === activeIndex), class: i === activeIndex ? "picker-option active" : "picker-option", tabindex: "-1" },
        h("span", { class: "picker-origin" }, r.object_title),
        h("span", { class: "picker-excerpt" }, r.excerpt)
      );
      option.addEventListener("click", () => {
        activeIndex = i;
        void confirmChoice();
      });
      listbox.append(option);
    });
    const n = results.length;
    status.textContent = n === 0 ? "No blocks match." : `${n} matching ${n === 1 ? "block" : "blocks"}`;
  };

  const runSearch = (): void => {
    const token = ++searchToken;
    const q = searchBox.value.trim();
    const exclude = currentObjectId();
    const url = `/api/blocks/search?q=${encodeURIComponent(q)}${exclude !== null ? `&exclude_object_id=${exclude}` : ""}`;
    void api<{ results: PickerResult[] }>("GET", url)
      .then((res) => {
        // only the answer for the text now in the box is ever shown
        if (token !== searchToken || searchBox.value.trim() !== q) return;
        results = res.results;
        activeIndex = 0;
        renderResults();
      })
      .catch(() => {
        if (token !== searchToken) return;
        results = [];
        activeIndex = 0;
        renderResults();
        status.textContent = "Search is unavailable right now.";
      });
  };

  const morph = (option: HTMLElement | null): void => {
    // the card morph: the picked row lifts out toward its slot in the column
    if (option === null || reducedMotion()) return;
    const rect = option.getBoundingClientRect();
    const card = h("div", { class: "morph-card", "aria-hidden": "true" }, option.textContent ?? "");
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.width = `${rect.width}px`;
    card.style.height = `${rect.height}px`;
    document.body.append(card);
    const slot = document.querySelector(`[data-block-id="${bs.id}"]`);
    if (slot !== null) {
      const target = slot.getBoundingClientRect();
      card.animate(
        [
          { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, opacity: 1 },
          { left: `${target.left}px`, top: `${target.bottom + 8}px`, width: `${target.width}px`, height: "48px", opacity: 0.85 },
        ],
        { duration: MOTION.morph, easing: QUIRE_CURVE }
      ).onfinish = () => {
        card.animate([{ opacity: 0.85 }, { opacity: 1 }], { duration: 60, easing: "linear" });
      };
    }
  };

  const confirmChoice = async (): Promise<void> => {
    if (chosen) return;
    const result = results[activeIndex];
    if (result === undefined) return;
    chosen = true;
    const optionEl = listbox.children[activeIndex] as HTMLElement | null;
    morph(optionEl);
    handle.close();
    const idem = `quote-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    let attempts = 0;
    let inserted = false;
    while (attempts < 2 && !inserted) {
      attempts += 1;
      try {
        const res = await api<{ block: BlockJson; origin_backlinks: number }>(
          "POST",
          `/api/objects/${currentObjectId()}/quotes`,
          { origin_block_id: result.block_id, after_block_id: null },
          { "Idempotency-Key": idem }
        );
        inserted = true;
        // the two parentheses leave the block
        box.value = keptText;
        pushUndo({ t: "quote", hostBlockId: res.block.id, originBlockId: result.block_id });
        const n = res.origin_backlinks;
        announce(`Quoted from ${result.object_title}. ${n} ${n === 1 ? "backlink" : "backlinks"}.`);
        await reloadCurrentObject();
        setTimeout(() => {
          const quoteEl = document.querySelector(`[data-block-id="${res.block.id}"] .block-render`) as HTMLElement | null;
          if (quoteEl !== null) quoteEl.focus();
        }, 150);
      } catch (e) {
        if (e instanceof ApiFailure || e instanceof NetworkFailure) {
          if (e instanceof NetworkFailure && attempts === 1) continue; // retry once with the same key
          // a refusal: the card collapses back, nothing is left behind
          document.querySelectorAll(".morph-card").forEach((c) => c.remove());
          alertMessage("That block couldn't be quoted.");
          box.value = keptText + "(";
          box.focus();
          box.selectionStart = keptText.length + 1;
          box.selectionEnd = box.selectionStart;
          return;
        }
        throw e;
      }
    }
  };

  const dialog = h("div", { role: "dialog", "aria-label": "Quote a block", class: "dialog picker-dialog" },
    h("h2", { text: "Quote a block" }),
    searchBox,
    status,
    listbox
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, box);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
    if (!chosen) {
      // Escape: the typed parentheses stay in place
      box.value = keptText + "((";
      box.focus();
      box.selectionStart = box.value.length;
      box.selectionEnd = box.selectionStart;
    }
  });

  let debounce = 0;
  searchBox.addEventListener("input", () => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(runSearch, SEARCH_DEBOUNCE);
  });
  searchBox.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length > 0) {
        activeIndex = (activeIndex + 1) % results.length;
        renderResults();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length > 0) {
        activeIndex = (activeIndex - 1 + results.length) % results.length;
        renderResults();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      void confirmChoice();
    }
  });
  searchBox.focus();
  runSearch();
}
