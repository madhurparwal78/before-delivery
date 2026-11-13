// The home and case study scenes as components: each registers a stage view and writes its data-* values every frame.
import type { ComponentChildren, RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import * as THREE from "three";
import type { Accent, CaseStudy, Primitive } from "../api";
import { easeOutLong, easeOutQuad, fixed3, reducedMotion } from "../motion";
import { buildSubject, camera, EMBER, geometryFor, INK, rakeLights, surface } from "../three/kit";
import { addView, type Rect } from "../three/stage";

const TURN_MS = 30_000;
const MORPH_MS = 600;
const TILT_MAX = 12;

// ---------- still posters for the no-WebGL path ----------

const SHAPE_FILL: Record<Accent, string> = { ember: "#8f8b86", cobalt: "#3a3f4c", violet: "#4a4458" };

function Poster({ kinds, accent = "ember", label }: { kinds: Primitive[]; accent?: Accent; label: string }) {
  const step = 170 / Math.max(kinds.length, 1);
  return (
    <svg class="poster" viewBox="0 0 200 240" preserveAspectRatio="xMidYMid meet" {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}>
      <ellipse cx="100" cy="222" rx="70" ry="8" fill="#14171e" />
      {kinds.map((kind, index) => {
        const y = 205 - index * step;
        const fill = index % 2 ? SHAPE_FILL[accent] : "#2a2c33";
        const stroke = "#f3eee6";
        switch (kind) {
          case "box":
            return <rect key={index} x="62" y={y - step * 0.7} width="76" height={step * 0.65} fill={fill} stroke={stroke} stroke-width="0.6" />;
          case "cylinder":
            return <rect key={index} x="58" y={y - step * 0.7} width="84" height={step * 0.65} rx="10" fill={fill} stroke={stroke} stroke-width="0.6" />;
          case "sphere":
            return <circle key={index} cx="100" cy={y - step * 0.4} r={step * 0.42} fill={fill} stroke={stroke} stroke-width="0.6" />;
          case "torus":
            return <ellipse key={index} cx="100" cy={y - step * 0.35} rx="46" ry={step * 0.2} fill="none" stroke={fill === "#2a2c33" ? stroke : fill} stroke-width="5" />;
          case "capsule":
            return <rect key={index} x="84" y={y - step * 0.8} width="32" height={step * 0.75} rx="16" fill={fill} stroke={stroke} stroke-width="0.6" />;
        }
      })}
    </svg>
  );
}

// ---------- hero: the scroll-scrubbed assembly ----------

const HERO_PARTS: Primitive[] = ["cylinder", "torus", "cylinder", "box", "sphere", "capsule"];

export function HeroScene({ region }: { region: RefObject<HTMLElement> }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const scene = new THREE.Scene();
    const subject = buildSubject(HERO_PARTS, "ember", 0.9);
    scene.add(subject.group);
    const sweep = rakeLights(scene, 3.5);
    const cam = camera(30);
    cam.position.set(0, 0.4, 7.2);
    cam.lookAt(0, 0, 0);
    const progress = (): number => (reducedMotion() ? 1 : Math.min(1, Math.max(0, window.scrollY / 2400)));
    const write = (): void => region.current?.setAttribute("data-scrub-progress", fixed3(progress()));
    window.addEventListener("scroll", write, { passive: true });
    write();
    const remove = addView({
      el: box,
      scene,
      camera: cam,
      tick: () => {
        const p = progress();
        region.current?.setAttribute("data-scrub-progress", fixed3(p));
        subject.setExplode(p * 1.7);
        subject.group.rotation.set(0.15 + p * 0.35, -0.5 + p * 1.1, 0);
        sweep(p);
      },
    });
    return () => {
      remove();
      window.removeEventListener("scroll", write);
    };
  }, []);
  return (
    <div class="hero-scene" data-scene ref={el}>
      <Poster kinds={HERO_PARTS} label="An exploded product assembly" />
    </div>
  );
}

// ---------- case study subjects and the shared-element morph ----------

type Handoff = { slug: string; from: Rect; back: boolean };
let handoff: Handoff | null = null;

/** Whether Back is returning from a case study, so the home page opens at the grid. */
export const isReturning = (): boolean => handoff?.back === true;

/** Records the tile's subject box as the start of the morph into the detail page. */
export function startHandoff(slug: string, from: DOMRect): void {
  handoff = { slug, from: { left: from.left, top: from.top, width: from.width, height: from.height }, back: false };
}

type SubjectProps = {
  study: CaseStudy;
  kind: "tile" | "detail" | "plain";
  clay?: boolean;
  class?: string;
  label?: string;
  children?: ComponentChildren;
};

/** A turning case study subject. The detail figure carries data-morph/idle/transition; tiles carry data-transition. */
export function SubjectView({ study, kind, clay = false, class: className, label, children }: SubjectProps) {
  const el = useRef<HTMLElement>(null);
  const clayTarget = useRef(clay);
  clayTarget.current = clay;
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const scene = new THREE.Scene();
    const subject = buildSubject(study.scene.primitives, study.scene.accent, 1);
    scene.add(subject.group);
    rakeLights(scene, 3.2);
    const cam = camera(30);
    cam.position.set(0, 0.6, 6);
    cam.lookAt(0, 0, 0);
    const reduced = reducedMotion();
    const born = performance.now();
    let morph = clayTarget.current ? 1 : 0;
    let morphFrom = morph;
    let morphAt = born - MORPH_MS;
    let lastTarget = clayTarget.current;
    let lastRect: Rect | null = null;
    const mine = handoff && handoff.slug === study.slug && (kind === "detail" ? !handoff.back : handoff.back) ? handoff : null;
    if (mine) handoff = null;
    const morphing = mine !== null && !reduced;
    box.dataset.transition = morphing ? "morphing" : "done";
    box.dataset.idle = reduced ? "still" : "turning";
    if (kind === "detail") box.dataset.morph = fixed3(morph);
    const travel = (): number => (morphing ? Math.min(1, (performance.now() - born) / MORPH_MS) : 1);
    const remove = addView({
      el: box,
      scene,
      camera: cam,
      rect: () => {
        const own = box.getBoundingClientRect();
        lastRect = { left: own.left, top: own.top, width: own.width, height: own.height };
        const t = travel();
        if (!mine || t >= 1) return null;
        const e = easeOutLong(t);
        const lerp = (a: number, b: number): number => a + (b - a) * e;
        return { left: lerp(mine.from.left, own.left), top: lerp(mine.from.top, own.top), width: lerp(mine.from.width, own.width), height: lerp(mine.from.height, own.height) };
      },
      tick: (now) => {
        if (box.dataset.transition === "morphing" && travel() >= 1) box.dataset.transition = "done";
        subject.group.rotation.y = reduced ? -0.5 : -0.5 + ((now % TURN_MS) / TURN_MS) * Math.PI * 2;
        if (kind !== "detail") return;
        if (clayTarget.current !== lastTarget) {
          lastTarget = clayTarget.current;
          morphFrom = morph;
          morphAt = now;
        }
        const goal = clayTarget.current ? 1 : 0;
        morph = reduced ? goal : morphFrom + (goal - morphFrom) * easeOutLong((now - morphAt) / MORPH_MS);
        if ((now - morphAt) / MORPH_MS >= 1) morph = goal;
        box.dataset.morph = fixed3(morph);
        subject.setMorph(morph);
      },
    });
    return () => {
      remove();
      if (kind === "detail" && lastRect) handoff = { slug: study.slug, from: lastRect, back: true };
    };
  }, [study.slug]);
  const poster = <Poster kinds={study.scene.primitives} accent={study.scene.accent} label={`${study.title} still`} />;
  if (kind === "detail") {
    return (
      <figure class={className} aria-label={label} data-scene ref={el as RefObject<HTMLElement>} data-transition="done" data-idle="turning" data-morph="0.000">
        <div class="subject">{poster}</div>
        {children}
      </figure>
    );
  }
  return (
    <div class={className} data-scene ref={el as RefObject<HTMLDivElement>} data-transition="done" data-idle="turning">
      {poster}
    </div>
  );
}

// ---------- services: a turning object per shot that tilts toward the pointer ----------

const SHOT_SHAPES: Record<string, Primitive> = {
  hero_front: "box",
  three_quarter: "capsule",
  top_down: "cylinder",
  detail_macro: "sphere",
  turntable_360: "torus",
  exploded_view: "box",
};

export function ShotObject({ code, row }: { code: string; row: RefObject<HTMLElement> }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current;
    const tr = row.current;
    if (!box || !tr) return;
    const reduced = reducedMotion();
    const scene = new THREE.Scene();
    const kind = SHOT_SHAPES[code] ?? "box";
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(geometryFor(kind, 1.3), surface(code === "exploded_view" ? EMBER.clone().multiplyScalar(0.6) : undefined));
    if (kind === "torus") mesh.rotation.x = Math.PI / 2;
    pivot.add(mesh);
    if (code === "exploded_view") {
      const lid = new THREE.Mesh(geometryFor("cylinder", 0.9), surface(INK.clone().multiplyScalar(0.25)));
      lid.position.y = 0.75;
      pivot.add(lid);
    }
    scene.add(pivot);
    rakeLights(scene, 2.6);
    const cam = camera(32);
    cam.position.set(0, 0.5, 3.6);
    cam.lookAt(0, 0, 0);
    box.dataset.idle = reduced ? "still" : "turning";
    box.dataset.tilt = "0";
    let tilt = 0;
    let from = 0;
    let target = 0;
    let startedAt = performance.now();
    let duration = 300;
    const axis = new THREE.Vector3(1, 0, 0);
    const aim = (next: number, ms: number, dx = 0, dy = -1): void => {
      if (reduced) return;
      if (next > 0) axis.set(dy, dx, 0).normalize();
      if (next === target) return;
      from = tilt;
      target = next;
      startedAt = performance.now();
      duration = ms;
    };
    const onMove = (event: PointerEvent): void => {
      const r = box.getBoundingClientRect();
      const dx = event.clientX - (r.left + r.width / 2);
      const dy = event.clientY - (r.top + r.height / 2);
      aim(Math.min(TILT_MAX, Math.round((TILT_MAX * Math.hypot(dx, dy)) / (r.width / 2))), 300, dx, dy);
    };
    const onLeave = (): void => aim(0, 450);
    const onFocus = (): void => aim(TILT_MAX, 300, 0, -1);
    tr.addEventListener("pointermove", onMove);
    tr.addEventListener("pointerleave", onLeave);
    tr.addEventListener("focusin", onFocus);
    tr.addEventListener("focusout", onLeave);
    const remove = addView({
      el: box,
      scene,
      camera: cam,
      tick: (now) => {
        tilt = from + (target - from) * easeOutQuad((now - startedAt) / duration);
        const shown = Math.round(tilt);
        if (box.dataset.tilt !== String(shown)) box.dataset.tilt = String(shown);
        mesh.rotation.y = reduced ? 0.6 : ((now % TURN_MS) / TURN_MS) * Math.PI * 2;
        pivot.quaternion.setFromAxisAngle(axis, THREE.MathUtils.degToRad(tilt));
      },
    });
    return () => {
      remove();
      tr.removeEventListener("pointermove", onMove);
      tr.removeEventListener("pointerleave", onLeave);
      tr.removeEventListener("focusin", onFocus);
      tr.removeEventListener("focusout", onLeave);
    };
  }, [code]);
  return (
    <div class="shot-object" data-scene ref={el} data-tilt="0" data-idle="turning">
      <Poster kinds={[SHOT_SHAPES[code] ?? "box"]} label="" />
    </div>
  );
}

// ---------- process: one camera through five stations ----------

const STATION_SHAPES: Primitive[] = ["box", "cylinder", "sphere", "torus", "capsule"];

function stationScene(): { scene: THREE.Scene; spots: THREE.Vector3[]; sweep: (p: number) => void } {
  const scene = new THREE.Scene();
  const spots: THREE.Vector3[] = [];
  STATION_SHAPES.forEach((kind, i) => {
    const angle = -0.9 + (i / 4) * 1.8;
    const spot = new THREE.Vector3(Math.sin(angle) * 6, 0, -Math.cos(angle) * 6 + 6);
    spots.push(spot);
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.3, 48), surface(new THREE.Color(0x1a1c22), 0.1, 0.9));
    plinth.position.copy(spot).setY(-0.6);
    const object = new THREE.Mesh(geometryFor(kind, 1), surface(i === 4 ? EMBER.clone().multiplyScalar(0.7) : undefined));
    object.position.copy(spot).setY(0.15);
    if (kind === "torus") object.rotation.x = Math.PI / 2.4;
    scene.add(plinth, object);
  });
  return { scene, spots, sweep: rakeLights(scene, 7) };
}

/** Puts a camera in front of the station at `position` (0..4, fractional between stations). */
function placeCamera(cam: THREE.PerspectiveCamera, spots: THREE.Vector3[], position: number): void {
  const i = Math.min(3, Math.floor(position));
  const t = position - i;
  const a = spots[i] ?? new THREE.Vector3();
  const b = spots[i + 1] ?? a;
  const focus = a.clone().lerp(b, t);
  cam.position.set(focus.x * 0.82, 1.4, focus.z + 3.6);
  cam.lookAt(focus.x, 0, focus.z);
}

/** The pinned five-station scene; `progress` (0..1) is read each frame. */
export function ProcessScene({ progress }: { progress: () => number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const { scene, spots, sweep } = stationScene();
    const cam = camera(40);
    return addView({
      el: box,
      scene,
      camera: cam,
      tick: () => {
        const p = progress();
        placeCamera(cam, spots, p * 4);
        sweep(p);
      },
    });
  }, []);
  return (
    <div class="process-scene" data-scene ref={el}>
      <Poster kinds={STATION_SHAPES} label="Five studio stations in an arc" />
    </div>
  );
}

/** A still view of one station, for the reduced-motion list. */
export function StationStill({ index, label }: { index: number; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const { scene, spots } = stationScene();
    const cam = camera(40);
    placeCamera(cam, spots, index);
    return addView({ el: box, scene, camera: cam, tick: () => undefined });
  }, [index]);
  return (
    <div class="station-still" data-scene ref={el}>
      <Poster kinds={[STATION_SHAPES[index] ?? "box"]} label={label} />
    </div>
  );
}
