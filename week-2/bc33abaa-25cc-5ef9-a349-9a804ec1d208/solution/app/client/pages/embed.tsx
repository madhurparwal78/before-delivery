// The published embed: the scene fills the frame, turns slowly when idle, and runs its hover, click and scroll
// transitions. Without WebGL it shows the version's stored still.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { PublishedPayload } from "../../shared/api-types.js";
import { REST_STATE, type Graph, type Trigger } from "../../shared/graph.js";
import { get } from "../api.js";
import { prefersReducedMotion, stillImage } from "../ui.js";
import { SceneView } from "../three/view.js";

const IDLE_AFTER_MS = 3000;
const TURN_MS = 30_000;

export function Embed({ embedId }: { embedId: string }) {
  const [payload, setPayload] = useState<PublishedPayload | null | "gone">(null);
  useEffect(() => {
    document.body.classList.add("embed-page");
    get<PublishedPayload>(`/api/embed/${encodeURIComponent(embedId)}`).then(setPayload, () => setPayload("gone"));
  }, [embedId]);
  if (payload === "gone") return <div class="embed-message"><p>This scene is no longer available.</p></div>;
  if (!payload) return <div class="embed-message"><p class="muted">Loading scene…</p></div>;
  return <Player embedId={embedId} payload={payload} />;
}

/** Drives one embed: idle turn, pointer transitions and scroll blending, writing data-state and data-yaw. */
class EmbedPlayer {
  private state = REST_STATE;
  private yaw = 0;
  private lastPointer = performance.now();
  private inside = false;
  private lastTick = performance.now();
  private frame = 0;
  private down: { x: number; y: number } | null = null;
  private readonly reduced = prefersReducedMotion();
  private readonly scrollTarget: string | null;

  constructor(private view: SceneView, private graph: Graph, private frameEl: HTMLElement) {
    this.scrollTarget = graph.transitions.find((t) => t.from === REST_STATE && t.trigger === "scroll")?.to ?? null;
    view.setGraph(graph, REST_STATE);
    view.frame();
    this.write();
    view.renderNow();
    if (!this.reduced) this.frame = requestAnimationFrame(this.tick);
  }

  private write(): void {
    this.frameEl.dataset.state = this.state;
    this.frameEl.dataset.yaw = (((this.yaw % 360) + 360) % 360).toFixed(2);
  }

  private tick = (now: number): void => {
    const dt = Math.min(100, now - this.lastTick);
    this.lastTick = now;
    if (!this.inside && now - this.lastPointer >= IDLE_AFTER_MS) {
      this.yaw = (this.yaw + (dt * 360) / TURN_MS) % 360;
      this.view.content.rotation.y = (this.yaw * Math.PI) / 180;
      this.write();
      this.view.renderNow();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Runs the transition the trigger names from the current state; its target shows in data-state at once. */
  private run(trigger: Trigger, from = this.state): boolean {
    const link = this.graph.transitions.find((t) => t.from === from && t.trigger === trigger);
    if (!link) return false;
    this.state = link.to;
    this.write();
    this.view.animateToState(link.to, this.reduced ? 0 : link.durationMs);
    return true;
  }

  enter(): void {
    if (this.inside) return;
    this.inside = true;
    this.lastPointer = performance.now();
    this.run("hover");
  }

  leave(): void {
    this.inside = false;
    this.lastPointer = performance.now();
    const back = this.graph.transitions.find((t) => t.from === REST_STATE && t.trigger === "hover" && t.to === this.state);
    if (!back) return;
    this.state = REST_STATE;
    this.write();
    this.view.animateToState(REST_STATE, this.reduced ? 0 : back.durationMs);
  }

  pointerDown(e: PointerEvent): void { this.down = { x: e.clientX, y: e.clientY }; this.lastPointer = performance.now(); }

  pointerUp(e: PointerEvent): void {
    const start = this.down;
    this.down = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) this.run("click");
  }

  scrolled(): void {
    if (!this.scrollTarget) return;
    const span = document.documentElement.scrollHeight - window.innerHeight;
    const progress = span > 0 ? Math.max(0, Math.min(1, window.scrollY / span)) : 0;
    this.state = progress < 0.5 ? REST_STATE : this.scrollTarget;
    this.write();
    this.view.showBlend(REST_STATE, this.scrollTarget, progress);
  }

  choose(stateId: string): void {
    const link = this.graph.transitions.find((t) => t.from === this.state && t.to === stateId);
    this.state = stateId;
    this.write();
    this.view.animateToState(stateId, this.reduced ? 0 : link?.durationMs ?? 250);
  }

  get current(): string { return this.state; }

  dispose(): void { cancelAnimationFrame(this.frame); this.view.dispose(); }
}

function Player({ embedId, payload }: { embedId: string; payload: PublishedPayload }) {
  const frame = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<EmbedPlayer | null>(null);
  const [webgl, setWebgl] = useState(true);
  const [state, setState] = useState(REST_STATE);
  const still = useRef(stillImage()).current;
  const scrolls = payload.graph.transitions.some((t) => t.from === REST_STATE && t.trigger === "scroll");

  useLayoutEffect(() => {
    if (!canvas.current || !frame.current) return;
    const view = SceneView.create(canvas.current, { drafting: false, assetUrl: (id) => `/api/embed/${encodeURIComponent(embedId)}/assets/${encodeURIComponent(id)}` });
    setWebgl(view !== null);
    if (!view) return;
    const p = new EmbedPlayer(view, payload.graph, frame.current);
    player.current = p;
    const detach = view.attachPointer(null);
    const el = canvas.current;
    const sync = () => setState(p.current);
    // Hover starts on real pointer movement: browsers send boundary events for a pointer that never moved
    // (at load, after layout), and touch has no hover; a tap runs the click transition instead.
    const enter = (e: PointerEvent) => { if (e.pointerType === "touch") return; p.enter(); sync(); };
    const leave = () => { p.leave(); sync(); };
    const down = (e: PointerEvent) => p.pointerDown(e);
    const up = (e: PointerEvent) => { p.pointerUp(e); sync(); };
    const scroll = () => { p.scrolled(); sync(); };
    el.addEventListener("pointermove", enter);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    window.addEventListener("scroll", scroll, { passive: true });
    const observer = new ResizeObserver(() => view.requestRender());
    observer.observe(el);
    return () => {
      detach();
      observer.disconnect();
      el.removeEventListener("pointermove", enter);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      window.removeEventListener("scroll", scroll);
      p.dispose();
    };
  }, [payload]);

  if (!webgl) {
    return (
      <div class="embed-message">
        {still ? <img src={still} alt={payload.scene.name} /> : (
          <svg role="img" aria-label={payload.scene.name} viewBox="0 0 320 200" width="320" height="200">
            <rect x="1" y="1" width="318" height="198" fill="none" stroke="var(--putty)" />
            <ellipse cx="160" cy="110" rx="70" ry="44" fill="none" stroke="var(--ink)" stroke-width="1.5" />
            <path d="M90 110h140M160 66v88" stroke="var(--putty)" />
          </svg>
        )}
        <p>Interactive 3D needs WebGL.</p>
      </div>
    );
  }
  return (
    <div style={{ height: scrolls ? "200vh" : "100vh" }}>
      <section ref={frame} class="embed-frame" role="region" aria-label="3D scene">
        <canvas ref={canvas} aria-label={`${payload.scene.name}, interactive 3D. Drag to orbit.`} />
        {payload.graph.states.length > 1 ? (
          <div class="embed-states">
            <ul role="listbox" aria-label="States" tabIndex={0}>
              {payload.graph.states.map((s) => (
                <li key={s.id} role="option" aria-selected={s.id === state ? "true" : "false"}
                  onClick={() => { player.current?.choose(s.id); setState(s.id); }}>{s.name}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
