import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { EMBED_TABS, PANES, PANE_LABEL, type EmbedTab, type Pen, type PaneKey } from "../../shared/types.js";
import { ApiFailure, api } from "../api.js";
import { PreviewRegion, type Renderer } from "../components/render-frame.js";
import { Icon } from "../components/icons.js";
import { NotFoundBody } from "./not-found.js";

const TAB_LABEL: Record<EmbedTab, string> = { html: "HTML", css: "CSS", js: "JS", result: "Result" };

function startingTab(): EmbedTab {
  const asked = new URLSearchParams(location.search).get("tab");
  return EMBED_TABS.find((tab) => tab === asked) ?? "result";
}

export function EmbedPage({ id }: { id: string }): React.JSX.Element {
  const [pen, setPen] = useState<Pen | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<EmbedTab>(startingTab);
  const renderer = useRef<Renderer>(null);
  const started = useRef(false);
  const buttons = useRef(new Map<EmbedTab, HTMLButtonElement>());

  useEffect(() => {
    api.get<Pen>(`/api/pens/${id}`).then(setPen, (error: unknown) => {
      if (error instanceof ApiFailure && error.status === 404) setMissing(true);
    });
  }, [id]);

  const run = (): void => {
    started.current = true;
    renderer.current?.start({ kind: "pen", penId: id });
  };

  useEffect(() => {
    if (pen !== null && tab === "result" && !started.current) run();
  }, [pen]);

  const walk = (event: KeyboardEvent<HTMLButtonElement>, here: number): void => {
    const target: Record<string, number> = {
      ArrowRight: (here + 1) % EMBED_TABS.length,
      ArrowLeft: (here - 1 + EMBED_TABS.length) % EMBED_TABS.length,
      Home: 0,
      End: EMBED_TABS.length - 1,
    };
    const next = target[event.key];
    if (next === undefined) return;
    event.preventDefault();
    buttons.current.get(EMBED_TABS[next] as EmbedTab)?.focus();
  };

  if (missing) return <NotFoundBody />;
  if (pen === null) return <p className="panel loading">Loading the pen…</p>;
  const files = pen.version?.files;

  return (
    <div className="embed">
      <header className="embed-bar">
        <h1>{pen.title}</h1>
        <span className="embed-owner">{pen.owner}</span>
        <a href={`/pen/${pen.id}`} target="_blank" rel="noopener" className="button">
          Open on Ashlar
        </a>
      </header>
      <div role="tablist" aria-label="Embed" className="embed-tabs">
        {EMBED_TABS.map((name, position) => (
          <button
            key={name}
            ref={(element) => {
              if (element) buttons.current.set(name, element);
            }}
            type="button"
            role="tab"
            id={`embed-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`embed-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => {
              setTab(name);
              if (name === "result" && !started.current) run();
            }}
            onKeyDown={(event) => walk(event, position)}
          >
            {TAB_LABEL[name]}
          </button>
        ))}
      </div>
      {PANES.map((pane: PaneKey) => (
        <div key={pane} role="tabpanel" id={`embed-panel-${pane}`} aria-labelledby={`embed-tab-${pane}`} hidden={tab !== pane} className="embed-panel embed-source">
          <pre className="embed-code" role="region" tabIndex={0} aria-label={`${PANE_LABEL[pane]} source`}>
            {files?.[pane] ?? ""}
          </pre>
        </div>
      ))}
      <div role="tabpanel" id="embed-panel-result" aria-labelledby="embed-tab-result" hidden={tab !== "result"} className="embed-panel embed-result">
        <PreviewRegion
          ref={renderer}
          initial={null}
          onStart={() => undefined}
          onMessage={() => undefined}
        />
        <button type="button" className="button" onClick={run}>
          <Icon name="rerun" />
          Rerun
        </button>
      </div>
    </div>
  );
}
