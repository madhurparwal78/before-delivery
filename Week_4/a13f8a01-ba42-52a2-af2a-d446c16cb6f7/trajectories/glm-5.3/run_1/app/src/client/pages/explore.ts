import { el, button, link, navigate } from "../lib/dom.js";
import { Api, type PenSummary } from "../lib/api.js";
import { buildHeader } from "../lib/header.js";
import { PreviewStage } from "../lib/preview.js";

export async function explorePage(root: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
  root.innerHTML = "";
  buildHeader(root);

  const wrap = el("div", { class: "split" });
  const stage = el("div", { class: "stage with-inset" });
  const stageInner = el("div", { class: "stage-inner" });
  stage.appendChild(stageInner);
  const preview = new PreviewStage(stageInner);

  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });

  const searchStatus = el("div", { role: "status", "aria-label": "Search results", class: "status" });
  const input = el("input", { type: "search", placeholder: "Search pens", class: "searchbox" });
  input.setAttribute("aria-label", "Search pens");

  const restPanel = el("div", { class: "panel", role: "region", id: "explore-rest" });
  restPanel.textContent = "Type to search public pens. Use tag:name to filter by tag.";

  const results = el("ul", { "aria-label": "Results", class: "list", role: "list", hidden: "true" });

  body.appendChild(input);
  body.appendChild(searchStatus);
  body.appendChild(restPanel);
  body.appendChild(results);
  col.appendChild(body);
  wrap.appendChild(stage);
  wrap.appendChild(col);
  root.appendChild(wrap);

  const config = await (await import("../lib/api.js")).getConfig();
  let querySeq = 0;
  let debounceTimer: number | null = null;

  const runSearch = async (q: string, seq: number) => {
    try {
      const res = await Api.get<{ query: string; total: number; pens: PenSummary[] }>(`/api/search?q=${encodeURIComponent(q)}`);
      // A response to any earlier query is discarded, even if it arrives last.
      if (seq !== querySeq) return;
      if (res.total === 0) {
        results.setAttribute("hidden", "true");
        results.innerHTML = "";
        restPanel.removeAttribute("hidden");
        restPanel.textContent = "No pens match";
        searchStatus.textContent = "No pens match";
        return;
      }
      restPanel.setAttribute("hidden", "true");
      results.removeAttribute("hidden");
      results.innerHTML = "";
      for (const pen of res.pens) {
        const onFocus = () => {
          void preview.renderPen(pen.id, pen.head, []);
        };
        const row = (await import("./dashboard.js")).penRow(pen, onFocus, { withOwner: true });
        results.appendChild(row);
      }
      const first = res.pens[0]!;
      void preview.renderPen(first.id, first.head, []);
      searchStatus.textContent = res.total === 1 ? "1 pen found" : `${res.total} pens found`;
    } catch {
      // keep the last good list
    }
  };

  input.addEventListener("input", () => {
    const q = input.value.trim();
    querySeq++;
    if (debounceTimer !== null) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void runSearch(q, querySeq);
      const target = q === "" ? "/explore" : `/explore?q=${encodeURIComponent(q)}`;
      history.replaceState(null, "", target);
    }, config.search_debounce_ms);
  });

  const initial = params.get("q") ?? new URLSearchParams(location.search).get("q") ?? "";
  if (initial) {
    input.value = initial;
    querySeq++;
    void runSearch(initial, querySeq);
    void path;
  } else {
    void runSearch("", ++querySeq);
  }
}
