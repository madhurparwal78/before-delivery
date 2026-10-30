import { el, label } from "../dom";
import { api, errorText, type Graph } from "../api";
import { Viewport } from "../viewport";
import { applyState, cloneGraph } from "../../shared/graph";
import type { NodeT } from "../api";

interface PublishedPayload {
  scene: { name: string };
  version: { number: number; label: string; publishedAt: string };
  graph: Graph;
}

function statesBar(graph: Graph, onState: (stateId: string) => void, initial = "rest"): HTMLElement {
  const select = el("select", { className: "compact" }) as HTMLSelectElement;
  select.setAttribute("role", "listbox");
  label(select, "States");
  for (const st of graph.states) {
    const opt = el("option", { value: st.id, text: st.name }) as HTMLOptionElement;
    if (st.id === initial) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener("change", () => onState(select.value));
  return select;
}

function renderInto(viewport: Viewport, graph: Graph, stateId: string, region: HTMLElement): void {
  const shown = stateId === "rest" ? graph : applyState(graph, stateId);
  viewport.render(shown);
  region.dataset.graphHash = "";
  void region;
}

export async function reviewView(root: HTMLElement, token: string): Promise<void> {
  root.textContent = "";
  let data: { scene: { name: string }; version: { number: number; label: string; state: string }; graph: Graph };
  try {
    const res = await fetch(`/api/review/${token}`);
    if (res.status === 410) {
      root.append(el("div", { className: "page" }, el("h1", { text: "This review link has expired." }), el("p", { text: "Ask the editor for a new one." })));
      return;
    }
    if (!res.ok) {
      root.append(el("div", { className: "page" }, el("h1", { text: "This review link is not valid." })));
      return;
    }
    data = (await res.json()) as typeof data;
  } catch {
    root.append(el("div", { className: "page" }, el("h1", { text: "This review link is not valid." })));
    return;
  }
  const head = el("div", { className: "topbar" });
  head.append(
    el("h2", { text: `${data.scene.name} · v${data.version.number}` }),
    el("span", { className: "status", text: "Review copy · read only" }),
  );
  root.append(head);
  const frame = el("div", { className: "editor-viewport", style: { height: "calc(100vh - 90px)", position: "relative", background: "#1d1c18" } });
  const canvas = el("canvas") as HTMLCanvasElement;
  const region = el("div", { style: { position: "absolute", inset: "0" } });
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "Viewport");
  region.append(canvas);
  frame.append(region);
  const viewport = new Viewport(canvas);
  if (!viewport.ok) {
    region.append(el("div", { className: "viewport-fallback", text: "3D preview needs WebGL." }));
  }
  let current = "rest";
  const bar = el("div", { className: "states-row", style: { padding: "10px 16px" } });
  const select = statesBar(data.graph, (stateId) => {
    current = stateId;
    if (viewport.ok) viewport.render(current === "rest" ? data.graph : applyState(data.graph, current));
  });
  if (data.graph.states.length > 1) bar.append(select);
  root.append(frame, bar);
  if (viewport.ok) viewport.render(data.graph);
  void renderInto;
}

export async function embedView(root: HTMLElement, embedId: string): Promise<void> {
  root.textContent = "";
  let data: PublishedPayload;
  const res = await fetch(`/api/embed/${embedId}`);
  if (res.status === 410) {
    root.append(el("div", { className: "embed-frame" }, el("div", { className: "viewport-fallback", text: "This scene is no longer available." })));
    return;
  }
  if (!res.ok) {
    root.append(el("div", { className: "embed-frame" }, el("div", { className: "viewport-fallback", text: "This scene is no longer available." })));
    return;
  }
  data = (await res.json()) as PublishedPayload;

  const scrollTransition = data.graph.transitions.find((t) => t.from === "rest" && t.trigger === "scroll");
  const hoverTransition = data.graph.transitions.find((t) => t.from === "rest" && t.trigger === "hover");
  const clickTransition = data.graph.transitions.find((t) => t.from === "rest" && t.trigger === "click");

  const frame = el("div", { className: "embed-frame" });
  const canvas = el("canvas") as HTMLCanvasElement;
  const region = el("div", { style: { position: "absolute", inset: "0" } });
  region.setAttribute("role", "region");
  region.setAttribute("aria-label", "3D scene");
  region.append(canvas);
  frame.append(region);
  root.append(frame);
  const viewport = new Viewport(canvas);
  if (!viewport.ok) {
    const fallbackImg = el("img", { alt: data.scene.name, src: `/api/embed/${embedId}/thumbnail-fallback.png`, style: { position: "absolute", inset: "0", margin: "auto" } }) as HTMLImageElement;
    region.append(fallbackImg, el("div", { className: "viewport-fallback", text: "Interactive 3D needs WebGL." }));
    return;
  }

  let currentState = "rest";
  region.dataset.state = "rest";
  region.dataset.yaw = "0";

  // Idle turn: 360 degrees over 25-35 seconds after 3 idle seconds.
  let idleFor = 0;
  let lastPointerAt = Date.now();
  region.addEventListener("pointermove", () => {
    lastPointerAt = Date.now();
  });
  region.addEventListener("pointerdown", () => {
    lastPointerAt = Date.now();
  });
  const turnPeriodMs = 30000;
  let lastFrame = performance.now();
  let lastYawUpdate = 0;

  function render(): void {
    const now = performance.now();
    const dt = now - lastFrame;
    lastFrame = now;
    const idle = now - lastPointerAt > 3000;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (idle && !reduce) {
      viewport.camera.yaw = (viewport.camera.yaw + (dt / turnPeriodMs) * 360) % 360;
    }
    let graph = data.graph;
    if (currentState !== "rest") {
      graph = applyState(data.graph, currentState);
    } else if (scrollProgress > 0 && scrollTransition) {
      graph = blendState(data.graph, scrollTransition.to, scrollProgress);
    }
    viewport.render(graph);
    const yaw = ((viewport.camera.yaw % 360) + 360) % 360;
    if (yaw !== lastYawUpdate) {
      lastYawUpdate = yaw;
      region.dataset.yaw = String(Math.round(yaw * 100) / 100);
    }
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  // Hover and click transitions.
  region.addEventListener("pointerenter", () => {
    if (!hoverTransition) return;
    transitionTo(hoverTransition.to, hoverTransition.durationMs);
  });
  region.addEventListener("pointerleave", () => {
    if (!hoverTransition) return;
    const back = data.graph.transitions.find((t) => t.from === hoverTransition.to && t.trigger === "hover");
    transitionTo("rest", back?.durationMs ?? hoverTransition.durationMs);
  });
  region.addEventListener("click", () => {
    if (!clickTransition) return;
    transitionTo(clickTransition.to, clickTransition.durationMs);
  });

  function transitionTo(target: string, durationMs: number): void {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    region.dataset.state = target;
    if (reduce || durationMs === 0) {
      currentState = target;
      return;
    }
    const from = cloneGraph(currentState === "rest" ? data.graph : applyState(data.graph, currentState));
    const to = applyState(data.graph, target);
    const start = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      viewport.render(blendGraphs(from, to, t));
      if (t < 1) requestAnimationFrame(step);
      else currentState = target;
    };
    step();
  }

  function blendState(graph: Graph, stateId: string, progress: number): Graph {
    return blendGraphs(graph, applyState(graph, stateId), progress);
  }

  function blendGraphs(a: Graph, b: Graph, t: number): Graph {
    const out = cloneGraph(a);
    for (const node of out.nodes) {
      const other = b.nodes.find((n) => n.id === node.id);
      if (!other) continue;
      for (const field of ["position", "rotation", "scale"] as const) {
        for (let i = 0; i < 3; i++) {
          const av = node[field][i]!;
          const bv = other[field][i]!;
          (node[field] as unknown as number[])[i] = av + (bv - av) * t;
        }
      }
    }
    return out;
  }

  // Scroll transition: the page is two frame heights tall and the scene stays pinned.
  let scrollProgress = 0;
  if (scrollTransition) {
    frame.classList.remove("embed-frame");
    const scrollRoot = el("div", { className: "embed-scroll" });
    const sticky = el("div", { className: "sticky" }, frame);
    scrollRoot.append(sticky, el("div", { className: "embed-spacer" }));
    root.append(scrollRoot);
    const onScroll = (): void => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      region.dataset.state = scrollProgress < 0.5 ? "rest" : scrollTransition.to;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // State switcher when more than one state exists.
  if (data.graph.states.length > 1) {
    const bar = el("div", { className: "embed-statebar" });
    const select = el("select", { className: "compact" }) as HTMLSelectElement;
    select.setAttribute("role", "listbox");
    label(select, "States");
    for (const st of data.graph.states) {
      const opt = el("option", { value: st.id, text: st.name }) as HTMLOptionElement;
      if (st.id === "rest") opt.selected = true;
      select.append(opt);
    }
    select.addEventListener("change", () => {
      currentState = select.value;
      region.dataset.state = select.value;
    });
    bar.append(select);
    frame.append(bar);
  }
  void api;
  void errorText;
  void ({} as NodeT);
}
