import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { PenSummary } from "../../shared/types.js";
import { api } from "../api.js";
import { CrossfadeStage } from "../components/crossfade-stage.js";
import { PenRowItem, StatePanel } from "../components/panels.js";
import { Shell } from "../components/shell.js";
import { useConfig } from "../config.js";
import { countLabel } from "../format.js";
import { replaceQuery } from "../router.js";

interface Found {
  total: number;
  pens: PenSummary[];
}

export function ExplorePage(): React.JSX.Element {
  const config = useConfig();
  const [text, setText] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [found, setFound] = useState<Found | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const latest = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);

  const search = (query: string): void => {
    const token = ++latest.current;
    inflight.current?.abort();
    replaceQuery(new URLSearchParams(query === "" ? {} : { q: query }));
    if (query.trim() === "") {
      setFound(null);
      return;
    }
    const controller = new AbortController();
    inflight.current = controller;
    const request = api.get<Found>(`/api/search?q=${encodeURIComponent(query)}`, controller.signal);
    flushSync(() => setSearching(true));
    request.then(
      (answer) => {
        if (token !== latest.current) return;
        setFound(answer);
        setSearching(false);
      },
      () => undefined,
    );
  };

  useEffect(() => {
    if (text !== "") search(text);
  }, []);

  const type = (value: string): void => {
    setText(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (config !== null) timer.current = window.setTimeout(() => search(value), config.search_debounce_ms);
  };

  const status = found === null ? "" : found.total === 0 ? "No pens match" : `${countLabel(found.total, "pen")} found`;
  const shown = previewing ?? found?.pens[0]?.id ?? null;

  return (
    <Shell>
      <div className="split">
        <div className="split-stage">
          <CrossfadeStage penId={shown} label="Preview of the highlighted pen" />
        </div>
        <section className="split-column">
          <h1>Explore</h1>
          <input
            type="search"
            aria-label="Search pens"
            className="search"
            value={text}
            placeholder="Search by title, handle or tag"
            onChange={(event) => type(event.target.value)}
          />
          <p role="status" aria-label="Search results" aria-busy={searching} className="status-line">
            {status}
          </p>
          {found === null ? (
            <StatePanel>Type to search public pens. Use tag:name to filter by tag.</StatePanel>
          ) : found.total === 0 ? (
            <StatePanel>No pens match</StatePanel>
          ) : (
            <ul aria-label="Results" className="rows">
              {found.pens.map((pen) => (
                <PenRowItem key={pen.id} pen={pen} showOwner onPreview={setPreviewing} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </Shell>
  );
}
