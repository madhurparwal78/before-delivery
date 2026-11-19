/** Universal search in the top bar: recipients, then transactions; the answer always belongs to the text in the field. */
import { SEARCH_MAX, SEARCH_MIN } from "../../shared/rules.js";
import { formatDollars } from "../../shared/money.js";
import { Unreachable, SignedOut, api } from "../shared/api.js";
import { clear, h, query } from "../shared/dom.js";
import { methodLabel } from "../shared/format.js";
import { after } from "../shared/timers.js";
import { Latest } from "./latest.js";

const PAUSE_MS = 250;

interface SearchAnswer {
  recipients: Array<{ id: string; display_name: string; status: string }>;
  transactions: Array<{ id: string; account_id: string; direction: string; amount_cents: number; method: string; counterparty: string; memo: string | null }>;
}

export function codePoints(text: string): number {
  return [...text].length;
}

/** The server's answer for text within the length limits, or null when it could not be had. */
export async function searchFor(text: string): Promise<SearchAnswer | null> {
  try {
    const { data } = await api<SearchAnswer>("GET", `/api/search?q=${encodeURIComponent(text)}`);
    return data;
  } catch (error) {
    if (error instanceof SignedOut || error instanceof Unreachable) return null;
    throw error;
  }
}

export function mountSearch(): void {
  const input = query<HTMLInputElement>(document, "[data-search-input]");
  const region = query(document, "[data-search-results]");
  const latest = new Latest();
  let cancelPause: (() => void) | null = null;

  function close(): void {
    cancelPause?.();
    latest.invalidate();
    region.hidden = true;
    clear(region);
  }

  function show(answer: SearchAnswer): void {
    clear(region);
    if (answer.recipients.length === 0 && answer.transactions.length === 0) {
      region.append(h("p", { class: "search-empty" }, "No matches"));
      return;
    }
    if (answer.recipients.length > 0) {
      region.append(
        h("p", { class: "search-group" }, "Recipients"),
        h("ul", {}, ...answer.recipients.map((recipient) => h("li", {}, h("a", { class: "search-link", href: `/payments/new?recipient=${recipient.id}` }, recipient.display_name)))),
      );
    }
    if (answer.transactions.length > 0) {
      region.append(
        h("p", { class: "search-group" }, "Transactions"),
        h(
          "ul",
          {},
          ...answer.transactions.map((row) =>
            h(
              "li",
              {},
              h("a", { class: "search-link", href: `/app?account=${row.account_id}` }, h("span", {}, row.counterparty), h("span", { class: "search-meta mono" }, `${methodLabel(row.method)} ${row.direction === "credit" ? "+" : "−"}${formatDollars(row.amount_cents)}`)),
            ),
          ),
        ),
      );
    }
  }

  input.addEventListener("input", () => {
    cancelPause?.();
    latest.invalidate();
    const text = input.value.trim();
    const length = codePoints(text);
    if (length < SEARCH_MIN) {
      region.hidden = true;
      clear(region);
      return;
    }
    region.hidden = false;
    clear(region);
    if (length > SEARCH_MAX) return;
    const ticket = latest.begin();
    region.append(h("p", { class: "search-empty" }, "Searching…"));
    cancelPause = after(async () => {
      const answer = await searchFor(text);
      if (answer && latest.isCurrent(ticket) && input.value.trim() === text) show(answer);
    }, PAUSE_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    input.value = "";
    close();
  });
}
