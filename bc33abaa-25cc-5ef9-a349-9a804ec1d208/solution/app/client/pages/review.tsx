// The outside reviewer's page: one version's snapshot, read only, with its states.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { ReviewPayload } from "../../shared/api-types.js";
import { REST_STATE } from "../../shared/graph.js";
import { ApiError, get } from "../api.js";
import { Mark, prefersReducedMotion, stillImage } from "../ui.js";
import { SceneView } from "../three/view.js";

export function Review({ token }: { token: string }) {
  const [payload, setPayload] = useState<ReviewPayload | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    get<ReviewPayload>(`/api/review/${encodeURIComponent(token)}`).then(setPayload, (error: unknown) => {
      setProblem(error instanceof ApiError && error.status === 410
        ? "This review link has expired. Ask the editor for a new one."
        : "This review link is not valid.");
    });
  }, [token]);
  if (problem) return <div class="embed-message"><Mark /><p>{problem}</p></div>;
  if (!payload) return <div class="embed-message"><p class="muted">Opening the review copy…</p></div>;
  return <ReviewStage payload={payload} />;
}

function ReviewStage({ payload }: { payload: ReviewPayload }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<SceneView | null>(null);
  const [state, setState] = useState(REST_STATE);
  const [webgl, setWebgl] = useState(true);
  const still = useRef(stillImage()).current;
  useLayoutEffect(() => {
    if (!canvas.current) return;
    const created = SceneView.create(canvas.current, { drafting: true, assetUrl: () => null });
    view.current = created;
    setWebgl(created !== null);
    if (!created) return;
    created.setGraph(payload.graph, REST_STATE);
    created.frame();
    created.renderNow();
    const detach = created.attachPointer(null);
    const observer = new ResizeObserver(() => created.requestRender());
    observer.observe(canvas.current);
    return () => { detach(); observer.disconnect(); created.dispose(); };
  }, [payload]);
  const choose = (id: string) => {
    const link = payload.graph.transitions.find((t) => t.from === state && t.to === id);
    setState(id);
    view.current?.animateToState(id, prefersReducedMotion() ? 0 : link?.durationMs ?? 250);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const states = payload.graph.states;
    const index = states.findIndex((s) => s.id === state);
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = states[(index + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : states.length - 1)) % states.length];
    if (next) choose(next.id);
  };
  return (
    <div class="review">
      <header>
        <div>
          <h1 style={{ fontSize: "var(--h3)" }}>{payload.scene.name}</h1>
          <p class="muted"><span class="num">{`v${payload.version.number}`}</span>{` · ${payload.version.label} · Review copy · read only`}</p>
        </div>
        <span class="brand small"><Mark />Orrery Studio</span>
      </header>
      <div class="state-strip">
        <ul role="listbox" aria-label="States" tabIndex={0} onKeyDown={onKeyDown} aria-activedescendant={`review-state-${state}`}>
          {payload.graph.states.map((s) => (
            <li key={s.id} id={`review-state-${s.id}`} role="option" aria-selected={s.id === state ? "true" : "false"} onClick={() => choose(s.id)}>{s.name}</li>
          ))}
        </ul>
      </div>
      <section class="stage" role="region" aria-label="Viewport">
        <canvas ref={canvas} class="viewport-canvas" aria-label={`3D view of ${payload.scene.name}. Drag to orbit.`} hidden={!webgl} />
        {!webgl ? (
          <div class="viewport-fallback">
            {still ? <img src={still} alt={payload.scene.name} /> : null}
            <p>3D preview needs WebGL. The hierarchy, inspector and operation log still work.</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
