/** The Transcript region: search, results, speakers and the transcript lines. */

import { searchCopy } from "../shared/copy.js";
import type { SearchResponse } from "../shared/model.js";
import { announce, clear, el, liveRegion, prefersReducedMotion } from "./dom.js";
import { getJsonRetrying } from "./api.js";
import type { Host, Panel } from "./host.js";

const DEBOUNCE_MS = 250;

export type TranscriptPanel = Panel & {
  setCurrentMet: (met: number) => void;
  refresh: () => void;
  openQuery: (query: string) => void;
  query: () => string;
};

export function transcriptPanel(
  host: Host,
  callbacks: { onQuery: (query: string) => void; onPick: (met: number) => void },
): TranscriptPanel {
  const search = el("input", {
    id: "search-transcript",
    type: "search",
    class: "text",
    placeholder: "Search lines and events",
    "aria-label": "Search transcript",
  });
  const results = el("ul", { class: "results", "aria-label": "Search results" });
  const noResults = el("p", { text: "No results", hidden: true });
  const status = liveRegion("Search status");
  const speakers = el("ul", { class: "speakers", "aria-label": "Speakers" });
  const noSpeakers = el("p", { text: "No speakers" });
  const lines = el("ul", { class: "lines", "aria-label": "Transcript lines" });
  const element = el("section", { class: "region transcript", "aria-label": "Transcript" }, [
    el("h2", { text: "Transcript" }),
    el("label", { for: "search-transcript", text: "Search transcript" }),
    search,
    results,
    noResults,
    status,
    el("h3", { text: "Speakers" }),
    speakers,
    noSpeakers,
    el("h3", { text: "Lines" }),
    lines,
  ]);

  let timer = 0;
  let latest = 0;
  let shownQuery = "";

  const runSearch = (query: string, announcePending: boolean): void => {
    const token = ++latest;
    if (query.length === 0) {
      clear(results);
      noResults.hidden = true;
      announce(status, "");
      shownQuery = "";
      return;
    }
    if (announcePending) {
      announce(status, searchCopy.pending);
    }
    void getJsonRetrying<SearchResponse>(`${host.apiBase}/search?q=${encodeURIComponent(query)}`).then(
      (result) => {
        if (token !== latest || search.value.trim() !== query) {
          return;
        }
        if (!result.ok) {
          if (result.code === "search_unavailable") {
            announce(status, searchCopy.offline);
          }
          return;
        }
        shownQuery = query;
        const focusedIndex = [...results.children].findIndex((item) =>
          item.contains(document.activeElement),
        );
        clear(results);
        for (const hit of result.data.hits) {
          const name =
            hit.kind === "line"
              ? `${hit.met_label} ${hit.speaker}: ${hit.text}`
              : `${hit.met_label} ${hit.text}`;
          const button = el("button", { type: "button", class: "line-button", text: name });
          button.addEventListener("click", () => callbacks.onPick(hit.met));
          results.append(el("li", {}, [button]));
        }
        noResults.hidden = result.data.count > 0;
        announce(status, searchCopy.results(result.data.count, query));
        if (focusedIndex >= 0 && results.children.length <= focusedIndex) {
          results.setAttribute("tabindex", "-1");
          (results as HTMLElement).focus();
        }
      },
    );
  };

  search.addEventListener("input", () => {
    const query = search.value.trim();
    window.clearTimeout(timer);
    if (query.length === 0) {
      runSearch("", false);
      callbacks.onQuery("");
      return;
    }
    timer = window.setTimeout(() => {
      callbacks.onQuery(query);
      runSearch(query, true);
    }, DEBOUNCE_MS);
  });

  const update = (): void => {
    clear(speakers);
    const speakerList = host.speakers();
    noSpeakers.hidden = speakerList.length > 0;
    for (const speaker of speakerList) {
      speakers.append(
        el("li", { class: "mono", text: `${speaker.name} ${speaker.lines}` }),
      );
    }
    clear(lines);
    for (const line of host.lines()) {
      const button = el("button", {
        type: "button",
        class: "line-button",
        text: `${line.met_label} ${line.speaker}: ${line.text}`,
      });
      button.addEventListener("click", () => callbacks.onPick(line.met));
      lines.append(el("li", { "data-met": String(line.met) }, [button]));
    }
  };

  const setCurrentMet = (met: number): void => {
    const items = [...lines.children] as HTMLElement[];
    let current: HTMLElement | null = null;
    for (const item of items) {
      const lineMet = Number(item.dataset.met);
      item.removeAttribute("aria-current");
      item.classList.remove("current");
      if (lineMet <= met) {
        current = item;
      }
    }
    if (current) {
      current.setAttribute("aria-current", "true");
      current.classList.add("current");
      current.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  };

  return {
    element,
    update,
    setCurrentMet,
    refresh: () => {
      const query = search.value.trim();
      if (query.length > 0) {
        runSearch(query, false);
      }
    },
    openQuery: (query: string) => {
      search.value = query;
      runSearch(query, false);
    },
    query: () => shownQuery,
  };
}
