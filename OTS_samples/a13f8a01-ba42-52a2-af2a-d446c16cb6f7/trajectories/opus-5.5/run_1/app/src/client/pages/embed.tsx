import { useEffect, useState } from "preact/hooks";
import type { Pen } from "../../shared/types";
import { api } from "../api";
import { StatePanel, TabList, tabPanelProps } from "../components";
import { PreviewRegion, PreviewStatus, usePreview } from "../preview";
import { NotFound } from "./simple";

const embedTabs = [
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "js", label: "JS" },
  { id: "result", label: "Result" },
];

export function startingTab(raw: string | null): string {
  return embedTabs.some((tab) => tab.id === raw) ? (raw as string) : "result";
}

export function Embed({ penId, tab }: { penId: string; tab: string }) {
  const [pen, setPen] = useState<Pen | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState(tab);
  const preview = usePreview();
  useEffect(() => {
    void api<Pen>("GET", `/api/pens/${penId}`).then((result) => {
      if (result.ok && result.data.visibility !== "private") {
        setPen(result.data);
        preview.render({ penId });
      } else {
        setMissing(true);
      }
    });
  }, [penId]);
  if (missing) return <NotFound />;
  if (!pen) return <StatePanel>Opening the pen…</StatePanel>;
  const files = pen.version?.files ?? { html: "", css: "", js: "" };
  return (
    <main class="embed">
      <header class="embed-bar">
        <span class="embed-title">{pen.title}</span>
        <span class="embed-owner">{pen.owner}</span>
        <a href={`/pen/${pen.id}`} target="_blank" rel="noopener">
          Open on Ashlar
        </a>
      </header>
      <TabList label="Embed" tabs={embedTabs} selected={selected} onSelect={setSelected} idPrefix="embed" />
      {(["html", "css", "js"] as const).map((pane) => (
        <div key={pane} class="embed-panel" {...tabPanelProps("embed", pane, selected)}>
          <pre class="code-view" tabIndex={0}>
            {files[pane]}
          </pre>
        </div>
      ))}
      <div class="embed-panel embed-result" {...tabPanelProps("embed", "result", selected)}>
        <PreviewRegion preview={preview} />
        <div class="embed-result-bar">
          <button type="button" onClick={() => preview.render({ penId })}>
            Rerun
          </button>
          <PreviewStatus preview={preview} />
        </div>
      </div>
    </main>
  );
}
