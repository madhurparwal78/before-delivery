// The citation page: one figure as of the end of a New York day, with the
// trace restorable from the URL's step parameter.

import { COPY, FIGURE_LABELS, apiJson, nyDate, type Computation } from "./app.js";
import { UnspoolTrace } from "./trace.js";

const REFRESH_MS = 4_000;

interface CitationResponse {
  citation: { figure: string; date: string; provisional: boolean };
  computation: Computation;
}

export function mountCitation(root: HTMLElement, figure: string, date: string): void {
  const figureValid = Object.keys(FIGURE_LABELS).includes(figure);
  const updatesRegion = root.querySelector<HTMLElement>("[data-region='board-updates']");

  if (!figureValid) {
    mountNotFound(root);
    return;
  }

  const trace = new UnspoolTrace(root, {
    citeHref: (fig, step) => `/cite/${fig}/${date}?step=${encodeURIComponent(step)}`,
    showCiteLink: false,
    onClose: () => {
      const url = new URL(window.location.href);
      if (url.searchParams.has("step")) {
        url.searchParams.delete("step");
        window.history.replaceState(null, "", url);
      }
      // The tile catches up to the newest resolved computation right away.
      if (lastResolved) applyComputation(lastResolved);
    },
    onStep: (step) => {
      const url = new URL(window.location.href);
      url.searchParams.set("step", step);
      window.history.replaceState(null, "", url);
    },
  });

  let provisional = false;
  let finalized = false;
  let lastRequestAt = 0;
  let lastResolved: CitationResponse | null = null;
  let fetchSeq = 0;
  let pendingStep: string | null = null;

  const marker = root.querySelector<HTMLElement>("[data-marker]");
  const tile = root.querySelector<HTMLElement>("[data-tile]");

  function applyComputation(response: CitationResponse): void {
    if (finalized && !response.citation.provisional && lastResolved) {
      // A later provisional response never wins over a final one.
      if (lastResolved.citation.provisional) return;
    }
    if (marker) {
      const text = response.citation.provisional ? COPY.provisional(response.citation.date) : response.computation.restated ? COPY.restated : "";
      if (marker.textContent !== text) marker.textContent = text;
      marker.dataset.marker = response.citation.provisional ? "provisional" : response.computation.restated ? "restated" : "none";
      marker.hidden = text === "";
    }
    if (marker && response.computation.restated && !response.citation.provisional) {
      const restatedLine = root.querySelector<HTMLElement>("[data-restated-line]");
      if (restatedLine) restatedLine.textContent = COPY.restatedLine(response.computation.restated.on, response.computation.restated.reason);
    }

    if (!trace.isOpen() && tile) {
      setTileFields(tile, response.computation);
    }

    lastResolved = response;

    if (pendingStep !== null && !trace.isOpen()) {
      const computation = response.computation;
      const input = computation.inputs.find((entry) => entry.key === pendingStep);
      if (input && tile) {
        const openStep = pendingStep;
        pendingStep = null;
        trace.open(computation, openStep, tile);
      } else if (!input) {
        pendingStep = null;
      }
    }
    provisional = response.citation.provisional;
    if (!provisional) {
      finalized = true;
    }
  }

  function setTileFields(tile: HTMLElement, computation: Computation): void {
    setField(tile, "numeral", computation.display);
    setField(tile, "asof", COPY.asOfLine(nyDate(computation.as_of), nyTimeOf(computation.as_of)));
    const exhibitInput = computation.inputs.find((input) => input.source.kind === "exhibit");
    setField(
      tile,
      "citation",
      exhibitInput && exhibitInput.source.kind === "exhibit" ? COPY.citation(exhibitInput.source.accession, exhibitInput.source.page) : "",
    );
    const setsInput = computation.inputs.find((input) => input.sets_as_of) ?? computation.inputs[0];
    setField(tile, "badge", setsInput ? clockText(setsInput.clock) : "");
  }

  function clockText(clock: string): string {
    if (clock === "holdings") return "Holdings week";
    if (clock === "equity") return "Equity";
    return "ETH live";
  }

  function nyTimeOf(iso: string): string {
    return iso.slice(11, 19);
  }

  async function poll(): Promise<void> {
    if (finalized) return;
    const seq = ++fetchSeq;
    lastRequestAt = Date.now();
    try {
      const response = await apiJson<CitationResponse>("GET", `/api/citations/${figure}/${date}`);
      if (seq !== fetchSeq) return;
      if (lastRequestAt !== 0 && finalized && !response.citation.provisional) return;
      applyComputation(response);
    } catch {
      if (seq !== fetchSeq) return;
      if (updatesRegion && !trace.isOpen()) updatesRegion.textContent = COPY.refreshFailed;
    }
  }

  void poll();
  window.setInterval(() => void poll(), REFRESH_MS);

  // A valid step in the URL opens the trace at its end state once the first
  // response lands; an unknown step is ignored.
  const step = new URL(window.location.href).searchParams.get("step");
  if (step) pendingStep = step;
}

function setField(host: ParentNode, field: string, text: string): void {
  const el = host.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

function mountNotFound(root: HTMLElement): void {
  const main = root.querySelector("[data-citation-main]");
  if (main) {
    main.textContent = "";
    const heading = document.createElement("h1");
    heading.textContent = COPY.notFound;
    main.appendChild(heading);
    const link = document.createElement("a");
    link.href = "/";
    link.textContent = "Back to the board";
    main.appendChild(link);
  }
}
