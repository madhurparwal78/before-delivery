import { useEffect, useRef } from "react";
import { prefersReducedMotion, settle } from "../lib/motion";
import { StillDrawing } from "./StillDrawings";

// The studio scene: one WebGL stage of procedural geometry behind the home page. Each section pins
// one object; the camera's target is a function of the scroll position only, it catches up within
// about a third of a second, and it retraces the same path on the way back. The monolith turns once
// every 36 seconds while the hero is pinned. Without WebGL each section shows a still drawing.

export const SECTIONS = ["hero", "work", "process", "pricing", "contact"] as const;
export type Section = (typeof SECTIONS)[number];

const TURN_SECONDS = 36;
const CATCH_UP_MS = 320;

interface View {
  pos: [number, number, number];
  look: [number, number, number];
}

const ANCHORS: Record<Exclude<Section, "contact">, [number, number, number]> = {
  hero: [0, 0, 0],
  work: [7, 0, -5],
  process: [14, 0, -10],
  pricing: [21, 0, -15],
};

function stations(wide: boolean): View[] {
  const lookOffset = wide ? -2.4 : 0;
  const views = (Object.keys(ANCHORS) as (keyof typeof ANCHORS)[]).map((key): View => {
    const [x, y, z] = ANCHORS[key];
    return { pos: [x + lookOffset, y + 2.1, z + 9.6], look: [x + lookOffset, y + 1.45, z] };
  });
  views.push({ pos: [10.5, 10, 15], look: [10.5, 0, -7.5] });
  return views;
}

function mix(a: View, b: View, t: number): View {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  return {
    pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1]), lerp(a.pos[2], b.pos[2])],
    look: [lerp(a.look[0], b.look[0]), lerp(a.look[1], b.look[1]), lerp(a.look[2], b.look[2])],
  };
}

function same(a: View, b: View): boolean {
  return a.pos.every((v, i) => Math.abs(v - b.pos[i]!) < 1e-6) && a.look.every((v, i) => Math.abs(v - b.look[i]!) < 1e-6);
}

/** Where the page is: the pinned section (under the viewport's middle line) and the path between sections. */
function readScroll(fixed: Section | null): { section: Section; index: number; path: number } {
  if (fixed) return { section: fixed, index: SECTIONS.indexOf(fixed), path: SECTIONS.indexOf(fixed) };
  const middle = window.scrollY + window.innerHeight / 2;
  const centers: number[] = [];
  let index = 0;
  SECTIONS.forEach((name, i) => {
    const element = document.querySelector<HTMLElement>(`[data-section="${name}"]`);
    if (!element) return;
    const top = element.getBoundingClientRect().top + window.scrollY;
    centers[i] = top + element.offsetHeight / 2;
    if (top <= middle) index = i;
  });
  const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  if (atBottom) index = SECTIONS.length - 1;
  let path = index;
  for (let i = 0; i < centers.length - 1; i++) {
    const a = centers[i];
    const b = centers[i + 1];
    if (a === undefined || b === undefined || middle < a || middle >= b) continue;
    const t = (middle - a) / (b - a);
    path = i + settle(Math.min(1, Math.max(0, (t - 0.3) / 0.4)));
  }
  if (centers.length && centers[centers.length - 1] !== undefined && middle >= centers[centers.length - 1]!) path = SECTIONS.length - 1;
  if (atBottom) path = SECTIONS.length - 1;
  return { section: SECTIONS[index]!, index, path };
}

export function Stage({ deckCount, fixed }: { deckCount: number; fixed: Section | null }) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cards = useRef(deckCount);
  cards.current = deckCount;
  const pinned = useRef(fixed);
  pinned.current = fixed;

  useEffect(() => {
    const element = host.current!;
    const reduced = prefersReducedMotion();
    let stopped = false;
    let teardown = () => undefined as void;
    element.dataset.sceneTurn = "0.0";
    element.dataset.sceneSection = readScroll(pinned.current).section;

    const followSections = () => {
      element.dataset.sceneSection = readScroll(pinned.current).section;
    };

    const fallback = () => {
      element.dataset.sceneMode = "still";
      window.addEventListener("scroll", followSections, { passive: true });
      window.addEventListener("resize", followSections);
      teardown = () => {
        window.removeEventListener("scroll", followSections);
        window.removeEventListener("resize", followSections);
      };
    };

    void import("three")
      .then((THREE) => {
        if (stopped) return;
        let renderer: InstanceType<typeof THREE.WebGLRenderer>;
        try {
          renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: window.devicePixelRatio < 2, alpha: true, powerPreference: "low-power" });
        } catch {
          fallback();
          return;
        }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000, 0);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
        const color = (hex: string) => new THREE.Color(hex);
        // Paper-coloured fog: the ground fades into the page instead of ending at a horizon.
        scene.fog = new THREE.Fog(color("#F3EDE1"), 16, 44);
        const INK = "#1A1D26";
        const COBALT = "#1E44C2";
        const SEAM = "#E0522B";
        const PAPER = "#FAF6EE";
        const STONE = "#8C7F6E";

        scene.add(new THREE.HemisphereLight(color("#FFF6E8"), color("#CFC3AE"), 1.25));
        const key = new THREE.DirectionalLight(color("#FFFFFF"), 1.7);
        key.position.set(6, 9, 7);
        scene.add(key);

        // Soft contact shadows drawn into a canvas texture: radial ink falloff on transparent paper.
        const shadowCanvas = document.createElement("canvas");
        shadowCanvas.width = shadowCanvas.height = 128;
        const g = shadowCanvas.getContext("2d")!;
        const gradient = g.createRadialGradient(64, 64, 4, 64, 64, 62);
        gradient.addColorStop(0, "rgba(26,29,38,0.32)");
        gradient.addColorStop(1, "rgba(26,29,38,0)");
        g.fillStyle = gradient;
        g.fillRect(0, 0, 128, 128);
        const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
        const shadow = (x: number, z: number, size: number) => {
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size * 0.7), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(x, 0.002, z);
          scene.add(plane);
        };

        // Hero: the monolith, a tall faceted slab.
        const monolith = new THREE.Group();
        const slabGeometry = new THREE.CylinderGeometry(0.62, 0.78, 3.4, 6, 1);
        slabGeometry.scale(1.25, 1, 0.46);
        const slab = new THREE.Mesh(slabGeometry, new THREE.MeshStandardMaterial({ color: color(INK), roughness: 0.58, metalness: 0.12, flatShading: true }));
        slab.position.y = 1.7;
        const seamInset = new THREE.Mesh(new THREE.BoxGeometry(0.05, 2.7, 0.02), new THREE.MeshStandardMaterial({ color: color(COBALT), roughness: 0.4 }));
        seamInset.position.set(0, 1.75, 0.37);
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.03, 0.42), new THREE.MeshStandardMaterial({ color: color(SEAM), roughness: 0.5 }));
        base.position.y = 0.015;
        monolith.add(slab, seamInset, base);
        monolith.position.set(...ANCHORS.hero);
        scene.add(monolith);
        shadow(ANCHORS.hero[0], ANCHORS.hero[2], 3.2);

        // Work: the card deck, one thin card per published case study.
        const deck = new THREE.Group();
        const paper = new THREE.MeshStandardMaterial({ color: color(PAPER), roughness: 0.9 });
        const edge = new THREE.MeshStandardMaterial({ color: color(STONE), roughness: 0.9 });
        const band = new THREE.MeshStandardMaterial({ color: color(COBALT), roughness: 0.6 });
        const buildDeck = (count: number) => {
          deck.clear();
          const n = Math.max(1, count);
          for (let i = 0; i < n; i++) {
            const card = new THREE.Group();
            const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.96, 0.025), [edge, edge, edge, edge, paper, paper]);
            const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.13), band);
            stripe.position.set(0, 0.415, 0.0135);
            card.add(sheet, stripe);
            const spread = (i - (n - 1) / 2) * 0.32;
            card.position.set(spread * 1.4, 1.2 + i * 0.03, -i * 0.12);
            card.rotation.set(-0.08, -0.25 + i * 0.07, spread * -0.18);
            deck.add(card);
          }
        };
        buildDeck(cards.current);
        deck.position.set(...ANCHORS.work);
        scene.add(deck);
        shadow(ANCHORS.work[0], ANCHORS.work[2], 3.6);

        // Process: four beads on a bent rail.
        const rail = new THREE.Group();
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(-1.9, 0.5, 0.6),
          new THREE.Vector3(-0.8, 1.6, -0.2),
          new THREE.Vector3(0.6, 0.9, 0.3),
          new THREE.Vector3(1.9, 2.1, -0.4),
        ]);
        rail.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.035, 10, false), new THREE.MeshStandardMaterial({ color: color(STONE), roughness: 0.5, metalness: 0.2 })));
        const bead = new THREE.SphereGeometry(0.17, 28, 18);
        const beadMaterial = new THREE.MeshStandardMaterial({ color: color(COBALT), roughness: 0.35, metalness: 0.1 });
        for (const t of [0.08, 0.36, 0.64, 0.92]) {
          const mesh = new THREE.Mesh(bead, beadMaterial);
          mesh.position.copy(curve.getPointAt(t));
          rail.add(mesh);
        }
        rail.position.set(...ANCHORS.process);
        scene.add(rail);
        shadow(ANCHORS.process[0], ANCHORS.process[2], 4);

        // Pricing: the folding sheet, two panels open at the seam-coloured crease.
        const fold = new THREE.Group();
        const panelGeometry = new THREE.PlaneGeometry(1.3, 1.8);
        panelGeometry.translate(0.65, 0, 0);
        const panelMaterial = new THREE.MeshStandardMaterial({ color: color(PAPER), roughness: 0.95, side: THREE.DoubleSide });
        const left = new THREE.Mesh(panelGeometry, panelMaterial);
        left.rotation.y = Math.PI - (18 * Math.PI) / 180;
        const right = new THREE.Mesh(panelGeometry, panelMaterial);
        right.rotation.y = (18 * Math.PI) / 180;
        const crease = new THREE.Mesh(new THREE.BoxGeometry(0.025, 1.8, 0.025), new THREE.MeshStandardMaterial({ color: color(SEAM), roughness: 0.5 }));
        fold.add(left, right, crease);
        fold.position.set(ANCHORS.pricing[0], 1.15, ANCHORS.pricing[2]);
        fold.rotation.x = -0.18;
        scene.add(fold);
        shadow(ANCHORS.pricing[0], ANCHORS.pricing[2], 3.4);

        const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshBasicMaterial({ color: color("#EAE2D2") }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(10.5, 0, -7.5);
        scene.add(ground);

        let wide = window.innerWidth >= 1024;
        let views = stations(wide);
        const targetView = (): View => {
          const { index, path } = readScroll(pinned.current);
          if (reduced) return views[index]!;
          const i = Math.floor(path);
          const next = Math.min(views.length - 1, i + 1);
          return mix(views[i]!, views[next]!, path - i);
        };
        let shownView = targetView();
        let from = shownView;
        let to = shownView;
        let tweenStart = -1;
        let turn = 0;
        let last = -1;
        let dirty = true;
        let deckBuilt = cards.current;

        const resize = () => {
          wide = window.innerWidth >= 1024;
          views = stations(wide);
          renderer.setSize(window.innerWidth, window.innerHeight, false);
          camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
          camera.updateProjectionMatrix();
          dirty = true;
        };
        resize();
        element.dataset.sceneMode = "webgl";

        let handle = 0;
        const frame = (now: number) => {
          handle = requestAnimationFrame(frame);
          if (document.hidden) return;
          const dt = last < 0 ? 0 : Math.min(100, now - last);
          last = now;
          const { section } = readScroll(pinned.current);
          element.dataset.sceneSection = section;
          if (deckBuilt !== cards.current) {
            deckBuilt = cards.current;
            buildDeck(deckBuilt);
            dirty = true;
          }
          if (!reduced && section === "hero") {
            turn = (turn + (dt * 360) / (TURN_SECONDS * 1000)) % 360;
            monolith.rotation.y = (turn * Math.PI) / 180;
            element.dataset.sceneTurn = turn.toFixed(2);
            dirty = true;
          }
          const goal = targetView();
          if (!same(goal, to)) {
            from = shownView;
            to = goal;
            tweenStart = reduced ? -1 : now;
            if (reduced) shownView = goal;
          }
          if (tweenStart >= 0) {
            const progress = Math.min(1, (now - tweenStart) / CATCH_UP_MS);
            shownView = progress >= 1 ? to : mix(from, to, settle(progress));
            if (progress >= 1) tweenStart = -1;
            dirty = true;
          } else if (!same(shownView, to)) {
            shownView = to;
            dirty = true;
          }
          if (!dirty) return;
          dirty = false;
          // The stage is a handful of meshes: every one is drawn each frame, none culled, so a
          // settled frame always carries the whole settled view.
          scene.traverse((object) => {
            object.frustumCulled = false;
          });
          camera.position.set(...shownView.pos);
          camera.lookAt(...shownView.look);
          renderer.render(scene, camera);
        };
        handle = requestAnimationFrame(frame);
        window.addEventListener("resize", resize);
        teardown = () => {
          cancelAnimationFrame(handle);
          window.removeEventListener("resize", resize);
          renderer.dispose();
        };
      })
      .catch(fallback);

    return () => {
      stopped = true;
      teardown();
    };
  }, []);

  return (
    <div ref={host} className="stage" aria-hidden="true">
      <canvas ref={canvas} className="stage__canvas" />
      <div className="stage__stills">
        {SECTIONS.map((section) => (
          <StillDrawing key={section} section={section} />
        ))}
      </div>
    </div>
  );
}
