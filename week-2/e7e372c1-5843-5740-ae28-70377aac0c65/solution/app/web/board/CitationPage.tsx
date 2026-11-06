import { useCallback, useMemo, useRef, useState } from "react";
import { request } from "../api.ts";
import { usePolling } from "../hooks.ts";
import { Figures } from "./Figures.tsx";
import { Masthead } from "./Masthead.tsx";
import { FIGURE_KEYS, FIGURE_LABELS, type CitationResponse, type FigureKey } from "../../shared/domain.ts";

type Resolved = { kind: "loading" } | { kind: "missing" } | { kind: "found"; citation: CitationResponse };

function figureOf(value: string): FigureKey | null {
  return FIGURE_KEYS.find((candidate) => candidate === value) ?? null;
}

function replaceStep(step: string | null): void {
  const url = new URL(window.location.href);
  if (step === null) url.searchParams.delete("step");
  else url.searchParams.set("step", step);
  window.history.replaceState(null, "", url.pathname + url.search);
}

export function CitationPage({ figureText, date }: { figureText: string; date: string }) {
  const figure = figureOf(figureText);
  const [resolved, setResolved] = useState<Resolved>({ kind: "loading" });
  const applied = useRef(0);
  const final = useRef(false);
  const wanted = useMemo(() => new URLSearchParams(window.location.search).get("step"), []);

  usePolling(async (sequence) => {
    if (final.current || !figure) return;
    const answer = await request<CitationResponse>("GET", `/api/citations/${figure}/${date}`);
    if (final.current || sequence < applied.current) return;
    if (answer.kind === "refused" && answer.status === 404) {
      applied.current = sequence;
      final.current = true;
      setResolved({ kind: "missing" });
      return;
    }
    if (answer.kind !== "ok") return;
    applied.current = sequence;
    final.current = !answer.body.citation.provisional;
    setResolved({ kind: "found", citation: answer.body });
  }, figure !== null);

  const onStep = useCallback((_figure: FigureKey, step: string | null) => replaceStep(step), []);
  const found = resolved.kind === "found" ? resolved.citation : null;
  const computation = found?.computation ?? null;
  const restore = useMemo(() => (figure && wanted ? { figure, step: wanted } : null), [figure, wanted]);

  if (!figure || resolved.kind === "missing") {
    return (
      <>
        <Masthead />
        <main className="page">
          <div className="blank-page">
            <h1>No published figure for that date.</h1>
            <a href="/">Back to the board</a>
            <div className="blank-lines" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          </div>
        </main>
      </>
    );
  }
  const restated = computation?.restated ?? null;
  return (
    <>
      <Masthead />
      <main className="page">
        <div className="cite-head">
          <h1>{FIGURE_LABELS[figure]} as of the end of {date}</h1>
          <div className="cite-markers">
            {restated && (
              <div className="marker">
                <span className="badge">Restated</span>
                <p>Restated on {restated.on}: {restated.reason}</p>
                <a href={`/#history-${restated.superseded_by}`}>View superseding entry</a>
              </div>
            )}
            {found?.citation.provisional && <p className="marker">Provisional — {date} has not ended; this figure may still change.</p>}
          </div>
        </div>
        <div className="cite-figure">
          <Figures figures={computation ? [computation] : null} marketDate={null} restore={restore} onStep={onStep} only={figure} />
        </div>
      </main>
    </>
  );
}
