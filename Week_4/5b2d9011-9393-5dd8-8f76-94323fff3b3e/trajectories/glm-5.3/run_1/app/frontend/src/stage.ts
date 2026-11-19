// The siege field stage: a three.js low-poly teal block field behind every
// screen, with a still 2D fallback when WebGL is unavailable.
import * as THREE from "three";
import type { RoomState } from "./api";

export interface StageHandle {
  setMode: (mode: "title" | "siege" | "convoy") => void;
  applySnapshot: (state: RoomState) => void;
  setPlayerId: (id: string) => void;
  setReduceEffects: (reduce: boolean) => void;
  shake: () => void;
  stop: () => void;
  isWebGL: boolean;
}

const SIEGE_MAP = {
  width: 32, depth: 32,
  blocks: [
    [8, 14], [9, 14], [10, 14], [11, 14],
    [20, 14], [21, 14], [22, 14], [23, 14],
    [15, 22], [16, 22], [15, 23], [16, 23],
    [4, 8], [27, 8],
  ] as [number, number][],
};

const CONVOY_MAP = {
  width: 200, depth: 120,
  blocks: [[60, 40, 80, 40]] as [number, number, number, number][],
};

export function createStage(root: HTMLElement): StageHandle {
  let webgl = true;
  try {
    const c = document.createElement("canvas");
    webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { webgl = false; }

  if (!webgl) {
    return createFallback(root);
  }
  return createThree(root);
}

// ---------- WebGL stage ----------

function createThree(root: HTMLElement): StageHandle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x061312);
  scene.fog = new THREE.Fog(0x061312, 26, 64);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });

  // Streaks: a few faint vertical planes.
  const streakMat = new THREE.MeshBasicMaterial({ color: 0x1d5a4e, transparent: true, opacity: 0.08 });
  const streaks: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.PlaneGeometry(0.8, 40);
    const m = new THREE.Mesh(g, streakMat);
    m.position.set(-30 + i * 9, 10, -18 - (i % 3) * 4);
    scene.add(m);
    streaks.push(m);
  }

  // Vignette via a large dark ring is costly; a big dark plane behind works.
  const vignette = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshBasicMaterial({ color: 0x020907, transparent: true, opacity: 0.35 })
  );

  const blockMat = new THREE.MeshLambertMaterial({ color: 0x184f44 });
  const groundMat = new THREE.MeshLambertMaterial({ color: 0x0a211d });
  const grid = new THREE.GridHelper(64, 32, 0x1d3f39, 0x12302a);
  grid.position.set(32, 0, 32);

  const light = new THREE.DirectionalLight(0x9ff2d8, 1.1);
  light.position.set(20, 30, 10);
  const amb = new THREE.AmbientLight(0x25423c, 0.9);

  const playerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.4, 0.9), new THREE.MeshLambertMaterial({ color: 0x9ff2d8 }));
  const enemyMeshes = new Map<string, THREE.Mesh>();
  const barrelMeshes = new Map<string, THREE.Mesh>();
  const grenadeMeshes = new Map<string, THREE.Mesh>();
  const vehicleMeshes = new Map<string, THREE.Mesh>();

  let mode: "title" | "siege" | "convoy" = "title";
  let playerId = "";
  let reduce = matchReduce();
  let shakeUntil = 0;
  let bobPhase = 0;
  let driftAngle = 0;
  let running = true;
  let lastT = performance.now();

  function matchReduce(): boolean {
    return document.body.classList.contains("calm") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function buildSiege(): void {
    scene.add(grid);
    scene.add(light);
    scene.add(amb);
    for (const [x, z] of SIEGE_MAP.blocks) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1), blockMat);
      b.position.set(x + 0.5, 0.6, z + 0.5);
      scene.add(b);
    }
    scene.add(playerMesh);
  }

  function buildConvoy(): void {
    scene.add(grid);
    scene.add(light);
    scene.add(amb);
    const island = new THREE.Mesh(new THREE.BoxGeometry(80, 2, 40), blockMat);
    island.position.set(100, 1, 60);
    scene.add(island);
  }

  function setMode(m: "title" | "siege" | "convoy"): void {
    mode = m;
    scene.clear();
    enemyMeshes.clear(); barrelMeshes.clear(); grenadeMeshes.clear(); vehicleMeshes.clear();
    scene.fog = new THREE.Fog(0x061312, m === "convoy" ? 120 : 26, m === "convoy" ? 260 : 64);
    scene.add(vignette);
    for (const s of streaks) scene.add(s);
    if (m === "convoy") buildConvoy();
    else buildSiege();
  }

  function resize(): void {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function applySnapshot(state: RoomState): void {
    if (mode === "convoy") {
      syncVehicles(state);
    } else {
      syncSiege(state);
    }
  }

  function syncSiege(state: RoomState): void {
    const me = state.players.find((p) => p.id === playerId);
    if (me) {
      playerMesh.position.set(me.x, 0.7, me.z);
      playerMesh.rotation.y = -((me.aim * Math.PI) / 180);
      playerMesh.visible = me.status !== "out";
    }
    const seen = new Set<string>();
    for (const e of state.enemies) {
      seen.add(e.id);
      let m = enemyMeshes.get(e.id);
      if (!m) {
        const size = e.kind === "boss" ? 1.6 : e.kind === "brute" ? 1.1 : 0.8;
        const color = e.kind === "boss" ? 0xd88f4a : e.kind === "brute" ? 0xc46a5a : 0xb85c50;
        m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshLambertMaterial({ color }));
        scene.add(m);
        enemyMeshes.set(e.id, m);
      }
      m.visible = e.state !== "dead";
      m.position.set(e.x, 0.5, e.z);
    }
    for (const [id, m] of enemyMeshes) if (!seen.has(id)) { scene.remove(m); enemyMeshes.delete(id); }

    const seenB = new Set<string>();
    for (const b of state.barrels) {
      seenB.add(b.id);
      let m = barrelMeshes.get(b.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1, 8), new THREE.MeshLambertMaterial({ color: 0x7fae9e }));
        scene.add(m);
        barrelMeshes.set(b.id, m);
      }
      m.visible = !b.destroyed;
      m.position.set(b.x, 0.5, b.z);
    }
    for (const [id, m] of barrelMeshes) if (!seenB.has(id)) { scene.remove(m); barrelMeshes.delete(id); }

    const seenG = new Set<string>();
    for (const g of state.grenades) {
      seenG.add(g.id);
      let m = grenadeMeshes.get(g.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshLambertMaterial({ color: 0xe0d27a }));
        scene.add(m);
        grenadeMeshes.set(g.id, m);
      }
      m.position.set(g.x, 0.3, g.z);
    }
    for (const [id, m] of grenadeMeshes) if (!seenG.has(id)) { scene.remove(m); grenadeMeshes.delete(id); }
  }

  function syncVehicles(state: RoomState): void {
    const seen = new Set<string>();
    for (const v of state.vehicles) {
      seen.add(v.player);
      let m = vehicleMeshes.get(v.player);
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.1), new THREE.MeshLambertMaterial({ color: 0x9ff2d8 }));
        scene.add(m);
        vehicleMeshes.set(v.player, m);
      }
      m.visible = v.state !== "wrecked" || true;
      m.position.set(v.x, 0.5, v.z);
      m.rotation.y = -(v.heading * Math.PI) / 180;
    }
    for (const [id, m] of vehicleMeshes) if (!seen.has(id)) { scene.remove(m); vehicleMeshes.delete(id); }
  }

  function frame(t: number): void {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min((t - lastT) / 1000, 0.1);
    lastT = t;
    reduce = matchReduce();

    if (mode === "title") {
      if (!reduce) driftAngle += (dt * Math.PI * 2) / 60; // one loop per 60 s
      const r = 46;
      camera.position.set(32 + Math.cos(driftAngle) * r, 26, 32 + Math.sin(driftAngle) * r);
      camera.lookAt(32, 0, 32);
      vignette.position.set(camera.position.x, 0, camera.position.z - 50);
    } else if (mode === "convoy") {
      const me = vehicleMeshes.get(playerId);
      const cx = me ? me.position.x : 100;
      const cz = me ? me.position.z : 60;
      camera.position.set(cx - 14 * 0.6, 16, cz - 14 * 0.6);
      camera.lookAt(cx, 0, cz);
    } else {
      const me = playerMesh.position;
      camera.position.set(me.x - 6, 9, me.z - 6);
      if (!reduce) {
        bobPhase += dt * 4;
        camera.position.y += Math.sin(bobPhase) * 0.08;
      }
      if (performance.now() < shakeUntil && !reduce) {
        camera.position.x += (Math.random() - 0.5) * 0.25;
        camera.position.z += (Math.random() - 0.5) * 0.25;
      }
      camera.lookAt(me.x, 0.5, me.z);
    }
    renderer.render(scene, camera);
  }

  function shake(): void {
    shakeUntil = performance.now() + 300;
  }

  root.append(renderer.domElement);
  resize();
  window.addEventListener("resize", resize);
  setMode("title");
  requestAnimationFrame(frame);

  return {
    setMode,
    applySnapshot,
    setPlayerId(id: string) { playerId = id; },
    setReduceEffects() { /* read from body class each frame */ },
    shake,
    stop() { running = false; renderer.dispose(); root.innerHTML = ""; },
    isWebGL: true,
  };
}

// ---------- 2D fallback ----------

function createFallback(root: HTMLElement): StageHandle {
  const canvas = document.createElement("canvas");
  root.append(canvas);
  const ctx2d = canvas.getContext("2d")!;
  let mode: "title" | "siege" | "convoy" = "title";
  let last: RoomState | null = null;

  function resize(): void {
    canvas.width = root.clientWidth || window.innerWidth;
    canvas.height = root.clientHeight || window.innerHeight;
    draw();
  }

  function draw(): void {
    if (!ctx2d) return;
    const w = canvas.width, h = canvas.height;
    ctx2d.fillStyle = "#061312";
    ctx2d.fillRect(0, 0, w, h);
    ctx2d.strokeStyle = "#12302a";
    for (let i = 0; i < 40; i++) {
      ctx2d.beginPath();
      ctx2d.moveTo(0, (i * h) / 40);
      ctx2d.lineTo(w, (i * h) / 40);
      ctx2d.stroke();
    }
    const s = mode === "convoy" ? 2.4 : 14;
    const ox = mode === "convoy" ? 20 : 40;
    const oy = mode === "convoy" ? 40 : 60;
    ctx2d.fillStyle = "#184f44";
    if (mode === "convoy") {
      ctx2d.fillRect(60 * s - ox, 40 * s - oy, 80 * s, 40 * s);
    } else {
      for (const [x, z] of SIEGE_MAP.blocks) {
        ctx2d.fillRect(x * s - ox, z * s - oy, s, s);
      }
    }
    if (last) {
      if (mode !== "convoy") {
        ctx2d.fillStyle = "#b85c50";
        for (const e of last.enemies) {
          if (e.state === "dead") continue;
          ctx2d.fillRect(e.x * s - ox - 3, e.z * s - oy - 3, 6, 6);
        }
        ctx2d.fillStyle = "#7fae9e";
        for (const b of last.barrels) {
          if (b.destroyed) continue;
          ctx2d.beginPath();
          ctx2d.arc(b.x * s - ox, b.z * s - oy, 4, 0, 7);
          ctx2d.fill();
        }
      }
      ctx2d.fillStyle = "#9ff2d8";
      for (const p of last.players) {
        if (p.status === "out") continue;
        ctx2d.fillRect(p.x * s - ox - 4, p.z * s - oy - 4, 8, 8);
      }
      ctx2d.fillStyle = "#9ff2d8";
      for (const v of last.vehicles) {
        ctx2d.fillRect(v.x * s - ox - 5, v.z * s - oy - 3, 10, 6);
      }
    }
  }

  function applySnapshot(state: RoomState): void {
    last = state;
    draw();
  }

  window.addEventListener("resize", resize);
  resize();

  return {
    setMode(m: "title" | "siege" | "convoy") { mode = m; draw(); },
    applySnapshot,
    setPlayerId() {},
    setReduceEffects() {},
    shake() {},
    stop() { root.innerHTML = ""; },
    isWebGL: false,
  };
}
