import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EMPTY, NOTICE, PAGES } from "../../shared/copy";
import { findObject, type SceneDocument, type SceneObject } from "../../shared/doc";
import { paramDefs, formatSi, type RigKind } from "../../shared/params";
import { readoutsFor, type Effective } from "../../shared/readouts";
import { ApiFailure, get } from "../api";
import { Link } from "../router";
import { DockPanel, Muted, Screen, useMe } from "../ui";
import { Runner, type RunSnapshot } from "../stage/runner";
import { loadModel, type LoadedModel } from "../stage/models";
import { createStage, type SceneView } from "../stage/scene";
import { TelemetryView } from "../editor/StageHost";
import { Glyph, type GlyphName } from "../ui";

const reduced = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useViewport(): "floating" | "docked" | "phone" {
  const compute = (): "floating" | "docked" | "phone" => (window.innerWidth >= 1000 ? "floating" : window.innerWidth >= 600 ? "docked" : "phone");
  const [layout, setLayout] = useState(compute);
  useEffect(() => {
    const on = (): void => setLayout(compute());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return layout;
}

interface ReadStageProps {
  doc: SceneDocument;
  models: ReadonlyMap<string, LoadedModel>;
  runner: Runner | null;
  selection: string | null;
  onPick?: (id: string | null) => void;
  onReady: (stage: SceneView | null) => void;
}

/** The stage of the lab and the read-only scene: orbit, optional picking, and the run poses. */
function ReadStage({ doc, models, runner, selection, onPick, onReady }: ReadStageProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<SceneView | null>(null);
  const [failed, setFailed] = useState(false);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const created = createStage(host.current as HTMLDivElement, true, reduced());
    if (!created) {
      setFailed(true);
      onReady(null);
      return;
    }
    created.events = { onPick: (id) => pick.current?.(id) };
    setView(created);
    onReady(created);
    return () => {
      created.dispose();
      onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!view || !runner) return;
    view.events = { ...view.events, onFrame: runner.frame };
    view.setOptions({ grid: true, colliders: false, tool: "move", snap: false }, []);
  }, [view, runner]);
  useEffect(() => {
    if (!view || !runner) return;
    view.setDocument(doc, models);
    view.setPoses(runner.currentPoses());
  }, [view, doc, models, runner]);
  useEffect(() => {
    view?.setSelection(selection, false);
  }, [view, selection]);
  return (
    <div className="stage-host" ref={host} role="application" aria-label="Stage" tabIndex={0}>
      {failed ? <p className="no-webgl">{PAGES.noWebgl}</p> : null}
    </div>
  );
}

interface ShellProps {
  title: string | null;
  label: "Lab panels" | "Panels";
  tabs: Array<{ name: string; node: ReactNode }>;
  floating: ReactNode;
  runner: Runner;
  snapshot: RunSnapshot;
  disabled: boolean;
  stage: ReactNode;
  extraTool?: ReactNode;
}

/** The lab layout shared by the public lab and the read-only scene: bench toolbar, stage, panels. */
function LabShell({ title, label, tabs, floating, runner, snapshot, disabled, stage, extraTool }: ShellProps): JSX.Element {
  const layout = useViewport();
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState(tabs[0].name);
  const running = snapshot.running;
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || target.closest("input[type=text], input[type=search], textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "r") (running ? runner.stop() : runner.start());
      else if (key === "p") runner.togglePause();
      else if (key === "n") runner.stepOnce();
      else if (event.key === "Escape" && running) runner.stop();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runner, running]);
  return (
    <div className={`editor lab layout-${layout}${running ? " running" : ""}`}>
      <div className="toolbar editor-toolbar" role="toolbar" aria-label="Bench tools">
        <button type="button" className={`chip run${running ? " go" : ""}`} disabled={disabled} onClick={() => (running ? runner.stop() : runner.start())}>
          {running ? "Stop" : "Run"}
        </button>
        <button type="button" className="chip" disabled={!running} onClick={() => runner.togglePause()}>
          {snapshot.paused ? "Resume" : "Pause"}
        </button>
        <button type="button" className="chip" disabled={!running} onClick={() => runner.stepOnce()}>
          Step
        </button>
        {extraTool}
        <span className="spacer" />
        <span className="wordmark">Rampwright</span>
      </div>
      <div className="workarea">
        <div className="stage-area">
          {stage}
          {title ? <h1 className="stage-title">{title}</h1> : null}
          <TelemetryView telemetry={snapshot.telemetry} more={more} onMore={() => setMore((m) => !m)} fullHash={more ? runner.fullHash() : null} />
          {running ? (
            <div role="status" aria-label="Mode" className="mode-pill">
              {snapshot.paused ? "PAUSED" : "RUNNING"}
            </div>
          ) : null}
          {layout === "floating" ? (
            <div className="lab-floating">
              {floating}
            </div>
          ) : null}
        </div>
        {layout === "docked" ? (
          <div className="dock-column">
            {floating}
          </div>
        ) : null}
      </div>
      {layout === "phone" ? (
        <div className="sheet">
          <div role="tablist" aria-label={label} className="tabs">
            {tabs.map((t) => (
              <button key={t.name} type="button" role="tab" aria-selected={tab === t.name} className={`tab${tab === t.name ? " on" : ""}`} onClick={() => setTab(t.name)}>
                {t.name}
              </button>
            ))}
          </div>
          {tabs.filter((t) => t.name === tab).map((t) => (
            <div key={t.name}>{t.node}</div>
          ))}
        </div>
      ) : null}
      {running ? (
        <svg className="centre-mark" role="img" aria-label="Centre mark" width="14" height="14" viewBox="0 0 14 14">
          <path d="M7 0V14M0 7H14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      ) : null}
    </div>
  );
}

function Panel({ title, children, aria }: { title: string; children: ReactNode; aria?: { live?: boolean; label: string } }): JSX.Element {
  return (
    <section role="region" aria-label={aria?.label ?? title} aria-live={aria?.live ? "polite" : undefined} className="dock panel lab-panel">
      <div className="dock-head">
        <h2 className="dock-title">{title}</h2>
      </div>
      <div className="dock-body">{children}</div>
    </section>
  );
}

function MissingPage({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <Screen me={null} workspaceId={null}>
      <DockPanel title="Rampwright lab">
        <h2 className="page-heading">{title}</h2>
        <p className="empty-line">{body}</p>
      </DockPanel>
    </Screen>
  );
}

interface LabData {
  lab: { sceneName: string; bundleHash: string; exposed: Array<{ key: string; label: string; min: number; max: number; step: number; unit: string; value: number }> };
  bundle: { document: SceneDocument; assets: Array<{ assetId: string; sha256: string }> };
}

async function loadModels(fetchBytes: (sha: string) => string, assets: Array<{ assetId: string; sha256: string }>): Promise<Map<string, LoadedModel>> {
  const models = new Map<string, LoadedModel>();
  for (const asset of assets) {
    try {
      const response = await fetch(fetchBytes(asset.sha256), { credentials: "same-origin" });
      if (!response.ok) continue;
      const model = await loadModel(new Uint8Array(await response.arrayBuffer()));
      if (model) models.set(asset.assetId, model);
    } catch {
      /* the scene shows without that model */
    }
  }
  return models;
}

function effective(object: SceneObject, overrides: Record<string, number>): Effective {
  const out: Effective = {};
  for (const def of paramDefs(object.kind)) out[def.key] = overrides[`${object.id}.${def.key}`] ?? object.params[def.key];
  return out;
}

function ReadoutRows({ objects, doc, overrides }: { objects: SceneObject[]; doc: SceneDocument; overrides: Record<string, number> }): JSX.Element {
  return (
    <>
      {objects.map((o) => (
        <div key={o.id} className="readout-group">
          <h3 className="sub-title">{o.name}</h3>
          {readoutsFor(o.kind as RigKind, effective(o, overrides), doc.gravity).map((row) => (
            <div key={row.label}>
              {row.label}: {row.value}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export function LabScreen({ token }: { token: string }): JSX.Element {
  const [data, setData] = useState<LabData | null>(null);
  const [problem, setProblem] = useState<"missing" | "storage" | null>(null);
  const [models, setModels] = useState<ReadonlyMap<string, LoadedModel>>(new Map());
  const [values, setValues] = useState<Record<string, number>>({});
  const [snapshot, setSnapshot] = useState<RunSnapshot>({ running: false, paused: false, telemetry: { fps: 0, ms: 0, step: 0, hash: "" } });
  const [stage, setStage] = useState<SceneView | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const dataRef = useRef(data);
  dataRef.current = data;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const stageRef = useRef<SceneView | null>(null);
  stageRef.current = stage;

  const runner = useMemo(
    () =>
      new Runner({
        doc: () => dataRef.current?.bundle.document ?? { gravity: 9.81, name: "", objects: [], solver: { iterations: 4, step: "1/120" } },
        overrides: () => valuesRef.current,
        bounds: (id) => modelsRef.current.get(id)?.bounds ?? null,
        changed: setSnapshot,
        poses: (poses) => stageRef.current?.setPoses(poses),
      }),
    [],
  );

  useEffect(() => {
    get<LabData>(`/api/labs/${token}`, { quiet: true }).then(
      async (loaded) => {
        setData(loaded);
        setValues(Object.fromEntries(loaded.lab.exposed.map((e) => [e.key, e.value])));
        setModels(await loadModels((sha) => `/api/labs/${token}/assets/${sha}`, loaded.bundle.assets));
      },
      (error: unknown) => setProblem(error instanceof ApiFailure && error.status === 503 ? "storage" : "missing"),
    );
  }, [token]);
  useEffect(() => {
    if (data) runner.refreshResting();
  }, [runner, data, values, models]);

  if (problem === "missing") return <MissingPage title={PAGES.missingLabTitle} body={PAGES.missingLabBody} />;
  if (problem === "storage") return <MissingPage title={PAGES.labDownTitle} body={PAGES.labDownBody} />;
  if (!data) return <Muted>{NOTICE.loading}</Muted>;
  const doc = data.bundle.document;
  const exposedObjects = [...new Set(data.lab.exposed.map((e) => e.key.slice(0, e.key.indexOf("."))))].map((id) => findObject(doc, id)).filter((o): o is SceneObject => o !== undefined);
  const params = (
    <Panel title="Lab parameters" aria={{ label: "Lab parameters" }}>
      {data.lab.exposed.map((e) => (
        <div key={e.key} className="slider-row">
          <label htmlFor={`slider-${e.key}`}>{e.label}</label>
          <input
            id={`slider-${e.key}`}
            type="range"
            min={e.min}
            max={e.max}
            step={e.step}
            value={values[e.key] ?? e.value}
            disabled={snapshot.running}
            onChange={(event) => setValues({ ...values, [e.key]: Number(event.target.value) })}
          />
          <output className="num">
            {formatSi(values[e.key] ?? e.value)} {e.unit}
          </output>
        </div>
      ))}
    </Panel>
  );
  const readouts = (
    <Panel title="Derived readouts" aria={{ label: "Derived readouts", live: true }}>
      <ReadoutRows objects={exposedObjects.filter((o) => o.kind !== "model" && o.kind !== "crate")} doc={doc} overrides={values} />
    </Panel>
  );
  return (
    <LabShell
      title={data.lab.sceneName}
      label="Lab panels"
      tabs={[
        { name: "Parameters", node: params },
        { name: "Readouts", node: readouts },
      ]}
      floating={
        <>
          {params}
          {readouts}
        </>
      }
      runner={runner}
      snapshot={snapshot}
      disabled={!stage}
      stage={<ReadStage doc={doc} models={models} runner={runner} selection={null} onReady={setStage} />}
    />
  );
}

function DeadLink(): JSX.Element {
  return (
    <Screen me={null} workspaceId={null}>
      <DockPanel title="Read-only link">
        <h1 className="page-heading">{PAGES.deadLink}</h1>
      </DockPanel>
    </Screen>
  );
}

interface ViewScene {
  scene: { id: string; name: string; revision: number };
  document: SceneDocument;
  assets: Array<{ id: string; sha256: string }>;
}

const KIND_GLYPH: Record<string, GlyphName> = { ramp: "ramp", pendulum: "pendulum", launcher: "launcher", crate: "crate", model: "model" };

export function ViewSceneScreen({ token, sid }: { token: string; sid: string }): JSX.Element {
  const [data, setData] = useState<ViewScene | null>(null);
  const [dead, setDead] = useState(false);
  const [models, setModels] = useState<ReadonlyMap<string, LoadedModel>>(new Map());
  const [selection, setSelection] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot>({ running: false, paused: false, telemetry: { fps: 0, ms: 0, step: 0, hash: "" } });
  const [stage, setStage] = useState<SceneView | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const modelsRef = useRef(models);
  modelsRef.current = models;
  const stageRef = useRef<SceneView | null>(null);
  stageRef.current = stage;
  const known = useRef(0);

  const runner = useMemo(
    () =>
      new Runner({
        doc: () => dataRef.current?.document ?? { gravity: 9.81, name: "", objects: [], solver: { iterations: 4, step: "1/120" } },
        overrides: () => ({}),
        bounds: (id) => modelsRef.current.get(id)?.bounds ?? null,
        changed: setSnapshot,
        poses: (poses) => stageRef.current?.setPoses(poses),
      }),
    [],
  );

  const load = async (): Promise<void> => {
    try {
      const next = await get<ViewScene>(`/api/view/${token}/scenes/${sid}`, { quiet: true });
      if (next.scene.revision < known.current) return;
      known.current = next.scene.revision;
      setData(next);
      const wanted = next.document.objects.flatMap((o) => (o.assetId ? [o.assetId] : []));
      if (wanted.some((id) => !modelsRef.current.has(id))) {
        const loaded = await loadModels((sha) => `/api/view/${token}/assets/${sha}`, next.assets.map((a) => ({ assetId: a.id, sha256: a.sha256 })));
        setModels(loaded);
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) setDead(true);
    }
  };
  useEffect(() => {
    void load();
    const source = new EventSource(`/api/view/${token}/scenes/${sid}/live`);
    source.addEventListener("revision", () => void load());
    source.addEventListener("link_dead", () => setDead(true));
    const poll = window.setInterval(() => void load(), 4000);
    return () => {
      source.close();
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, sid]);
  useEffect(() => {
    if (data && !snapshot.running) runner.refreshResting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner, data, models]);

  if (dead) return <DeadLink />;
  if (!data) return <Muted>{NOTICE.loading}</Muted>;
  const doc = data.document;
  const selected = selection ? findObject(doc, selection) : undefined;
  const outline = (
    <Panel title="Outline" aria={{ label: "Outline" }}>
      <div className="subbar">
        <span className="muted count">{doc.objects.length} objects</span>
      </div>
      {doc.objects.length === 0 ? <p className="empty-line">{EMPTY.outline}</p> : null}
      <div role="tree" aria-label="Scene outline" className="tree">
        {doc.objects.map((o) => (
          <div
            key={o.id}
            role="treeitem"
            aria-label={o.name}
            aria-selected={selection === o.id}
            tabIndex={0}
            className={`tree-row${selection === o.id ? " selected" : ""}`}
            onClick={() => setSelection(o.id)}
            onKeyDown={(e) => e.key === "Enter" && setSelection(o.id)}
          >
            <Glyph name={KIND_GLYPH[o.kind]} size={13} />
            <span className="row-name">{o.name}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
  const inspector = (
    <Panel title="Inspector" aria={{ label: "Inspector" }}>
      <div className="values">
        {selected ? (
          <>
            {(["x", "y", "z"] as const).map((axis, i) => (
              <div key={axis}>
                Position {axis.toUpperCase()} (m): {selected.position[i]}
              </div>
            ))}
            {paramDefs(selected.kind).map((def) => (
              <div key={def.key}>
                {def.label}: {selected.params[def.key]}
              </div>
            ))}
          </>
        ) : (
          <>
            <div>Scene name: {doc.name}</div>
            <div>Gravity (m/s²): {doc.gravity}</div>
          </>
        )}
      </div>
    </Panel>
  );
  return (
    <LabShell
      title={doc.name}
      label="Panels"
      tabs={[
        { name: "Outline", node: outline },
        { name: "Inspector", node: inspector },
      ]}
      floating={
        <>
          {outline}
          {inspector}
        </>
      }
      runner={runner}
      snapshot={snapshot}
      disabled={!stage}
      extraTool={
        <span role="status" aria-label="View only" className="pill view-only">
          View only
        </span>
      }
      stage={<ReadStage doc={doc} models={models} runner={runner} selection={selection} onPick={setSelection} onReady={setStage} />}
    />
  );
}

export function ViewProjectScreen({ token }: { token: string }): JSX.Element {
  const [data, setData] = useState<{ project: { name: string }; scenes: Array<{ id: string; name: string }> } | null>(null);
  const [dead, setDead] = useState(false);
  useEffect(() => {
    const load = (): void => {
      get<{ project: { name: string }; scenes: Array<{ id: string; name: string }> }>(`/api/view/${token}`, { quiet: true }).then(setData, (e: unknown) => e instanceof ApiFailure && e.status === 404 && setDead(true));
    };
    load();
    const poll = window.setInterval(load, 3000);
    return () => clearInterval(poll);
  }, [token]);
  const me = useMe(true);
  if (dead) return <DeadLink />;
  return (
    <Screen me={me} workspaceId={null}>
      <DockPanel title={data?.project.name ?? "Project"} label="Scenes" actions={<span role="status" aria-label="View only" className="pill view-only">View only</span>}>
        {!data ? <Muted>{NOTICE.loading}</Muted> : data.scenes.length === 0 ? <Muted>{EMPTY.scenes}</Muted> : null}
        <ul className="rows">
          {(data?.scenes ?? []).map((s) => (
            <li key={s.id}>
              <Link href={`/view/${token}/s/${s.id}`} className="row-link">
                <span>{s.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </DockPanel>
    </Screen>
  );
}
