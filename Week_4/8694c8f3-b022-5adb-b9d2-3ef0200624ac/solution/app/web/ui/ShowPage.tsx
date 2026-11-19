import { Info } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, ApiFailure } from "../api.ts";
import { Transport } from "../engine/clock.ts";
import { ScriptHost } from "../engine/scripts.ts";
import type { StageSource } from "../engine/stage-source.ts";
import type { EffectiveLayer } from "../engine/evaluate.ts";
import type { GizmoMode } from "../engine/renderer.ts";
import type { OutputBus, SetDocument, ShowBundle, ShowInfo } from "../../shared/types.ts";
import { NO_WEBGL, useStage } from "./StageView.tsx";

class ShowSource implements StageSource {
  readonly doc: SetDocument;
  readonly transport = new Transport();
  readonly scripts: ScriptHost;
  readonly selection = null;
  readonly gizmoMode: GizmoMode = "move";
  readonly gridSnap = false;
  readonly angleSnap = false;
  readonly scrubbing = null;
  readonly editorChrome = false;
  readonly animate: ((beat: number, effective: Map<string, EffectiveLayer>) => void) | null = null;
  readonly bus: OutputBus | null;
  private readonly shaders: Map<string, string>;
  private readonly listeners = new Set<() => void>();

  constructor(bundle: ShowBundle, bus: OutputBus | null) {
    this.bus = bus;
    this.doc = {
      set: {
        id: "show", name: bundle.set.name, bpm: bundle.set.bpm, head: 0, settings_version: 1, graph_version: 1,
        active_camera_id: bundle.set.active_camera_id, show_token: "", role: "viewer",
      },
      layers: bundle.layers, keys: bundle.keys, graph: bundle.graph, scripts: bundle.scripts,
    };
    this.shaders = new Map(bundle.shaders.map((shader) => [`${shader.layer_id}:${shader.version}`, shader.source]));
    this.transport.setBpm(bundle.set.bpm);
    this.scripts = new ScriptHost({ console: () => undefined, problem: () => undefined, nodesChanged: () => undefined });
    this.scripts.sync(bundle.scripts);
    this.transport.play();
  }

  shaderText(layerId: string, version: number): string | undefined {
    return this.shaders.get(`${layerId}:${version}`);
  }

  onDraw(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  requestDraw(): void {
    for (const listener of this.listeners) listener();
  }

  preview(): void {}

  setLayerValue(): void {}

  frameDone(): void {}

  dispose(): void {
    this.scripts.dispose();
  }
}

interface Loaded {
  info: ShowInfo;
  source: ShowSource;
}

function busOf(): OutputBus | null {
  const requested = new URLSearchParams(location.search).get("bus");
  return requested === "side" || requested === "led" ? requested : null;
}

export function ShowPage({ token }: { token: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    let current = -1;
    let previous: ShowSource | null = null;
    const refresh = async (): Promise<void> => {
      try {
        const info = await api.showInfo(token);
        if (!alive || info.version.number === current) return;
        const bundle = JSON.parse(await api.showBundle(token)) as ShowBundle;
        if (!alive) return;
        current = info.version.number;
        previous?.dispose();
        previous = new ShowSource(bundle, busOf());
        setLoaded({ info, source: previous });
        setMissing(false);
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "not_published" && alive) {
          current = -1;
          setMissing(true);
          setLoaded(null);
        }
      }
    };
    void refresh();
    const stream = new EventSource(`/api/show/${token}/events`);
    stream.addEventListener("show", () => void refresh());
    const poll = setInterval(() => void refresh(), 4000);
    return () => {
      alive = false;
      stream.close();
      clearInterval(poll);
      previous?.dispose();
    };
  }, [token]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === "i" && !event.ctrlKey && !event.metaKey && !event.altKey) setOpen((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!loaded) {
    return (
      <main className="show-page">
        <p className="show-empty">{missing ? "Nothing is live yet" : "Loading the show"}</p>
      </main>
    );
  }
  return <LiveShow key={loaded.info.version.number} loaded={loaded} token={token} open={open} setOpen={setOpen} />;
}

function LiveShow({ loaded, token, open, setOpen }: { loaded: Loaded; token: string; open: boolean; setOpen: (value: boolean) => void }) {
  const { source, info } = loaded;
  const assetUrl = useMemo(() => (id: string) => `/api/show/${token}/assets/${id}`, [token]);
  const { canvas, failed } = useStage(source, assetUrl);
  return (
    <main className="show-page">
      {failed ? <p className="stage-fallback">{NO_WEBGL}</p> : <canvas ref={canvas} role="img" aria-label="Show stage" className="show-canvas" />}
      <button type="button" className="show-info-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Info size={14} aria-hidden="true" />
        Show info
      </button>
      {open ? (
        <section className="show-info" role="region" aria-label="Show info">
          <h1>{info.set_name}</h1>
          <p>Version {info.version.number}</p>
          <p className="mono">SHA-256 {info.version.sha256}</p>
          <p>Published {new Date(info.version.published_at).toLocaleString()}</p>
        </section>
      ) : null}
    </main>
  );
}
