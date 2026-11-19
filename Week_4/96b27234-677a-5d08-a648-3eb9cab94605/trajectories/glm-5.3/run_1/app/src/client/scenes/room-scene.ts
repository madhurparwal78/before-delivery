// The 3D paper-cut room: a WebGL view through three.js, from a fixed
// three-quarter angle above, with a visible tile floor, cut-paper walls,
// folded stools, lantern exit tiles and avatars on paper bases.
import * as THREE from 'three';
import type { LayoutJson, PersonMirror } from '../room';

export interface RoomScene {
  update: (people: PersonMirror[], layout: LayoutJson, meId: string) => void;
  ripple: (radius: number, mode: 'growing' | 'outline' | 'none') => void;
  dispose: () => void;
}

const CREAM_A = 0xf3e6cc;
const CREAM_B = 0xe8d9ba;
const LANTERN = 0xe8a317;
const TEAL = 0x7fc4c6;

export function setupScene(canvas: HTMLCanvasElement, reducedMotion: boolean): RoomScene {
  let renderer: THREE.WebGLRenderer | null = null;
  let failed = false;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let avatarMeshes = new Map<string, THREE.Group>();
  let rippleTiles: THREE.Mesh[] = [];
  let tileFloor: THREE.Group | null = null;

  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0xf6efe2, 1);
  } catch {
    failed = true;
  }
  const fallbackText = document.createElement('p');
  fallbackText.textContent = '3D view unavailable. Everything else still works.';
  fallbackText.setAttribute('role', 'status');
  fallbackText.id = 'fallback';

  if (failed) showFallback();
  if (!failed && renderer) {
    // Match the drawing buffer to the on-screen size so the scene is visible.
    const width = Math.max(1, Math.floor(canvas.clientWidth || 800));
    const height = Math.max(1, Math.floor(canvas.clientHeight || 500));
    renderer.setSize(width, height, false);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.1, 200);
    const light = new THREE.DirectionalLight(0xfff6e0, 1.1);
    light.position.set(6, 12, 8);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  }

  function showFallback(): void {
    if (canvas.parentNode) {
      canvas.replaceWith(fallbackText);
    }
  }


  const update = (people: PersonMirror[], layout: LayoutJson, meId: string): void => {
    if (!scene || !camera || !renderer) return;
    // Keep the drawing buffer matched to the on-screen size as layout settles.
    const width = Math.max(1, Math.floor(canvas.clientWidth || 800));
    const height = Math.max(1, Math.floor(canvas.clientHeight || 500));
    const size = renderer.getSize(new THREE.Vector2());
    if (Math.abs(size.x - width) > 1 || Math.abs(size.y - height) > 1) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    if (tileFloor) scene.remove(tileFloor);
    tileFloor = new THREE.Group();
    const tileGeo = new THREE.BoxGeometry(0.9, 0.06, 0.9);
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        const shade = (x + y) % 2 === 0 ? CREAM_A : CREAM_B;
        const mat = new THREE.MeshLambertMaterial({ color: shade });
        const tile = new THREE.Mesh(tileGeo, mat);
        tile.position.set(x, 0, y);
        tileFloor.add(tile);
      }
    }
    for (const w of layout.walls) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.9, 0.92), new THREE.MeshLambertMaterial({ color: 0xcbb99a }));
      wall.position.set(w.x, 0.45, w.y);
      tileFloor.add(wall);
    }
    for (const s of layout.seats) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.32, 0.7), new THREE.MeshLambertMaterial({ color: 0xd9b23c }));
      seat.position.set(s.x, 0.16, s.y);
      tileFloor.add(seat);
    }
    for (const e of layout.exits) {
      const exitTile = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.9), new THREE.MeshLambertMaterial({ color: LANTERN }));
      exitTile.position.set(e.x, 0.05, e.y);
      tileFloor.add(exitTile);
    }
    scene.add(tileFloor);

    // Avatars on paper bases
    for (const group of avatarMeshes.values()) scene.remove(group);
    avatarMeshes = new Map();
    for (const p of people) {
      if (p.avatar === 'hidden') continue;
      const group = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.8), new THREE.MeshLambertMaterial({ color: p.personId === meId ? LANTERN : 0xfdf8ee }));
      base.position.y = 0.04;
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.62, 6),
        new THREE.MeshLambertMaterial({ color: p.avatar === 'fallback' ? 0x9aa3b2 : 0xe8a317 })
      );
      body.position.y = 0.42;
      group.add(base, body);
      group.position.set(p.x, 0, p.y);
      scene.add(group);
      avatarMeshes.set(p.personId, group);
    }

    // Camera follows your avatar from a fixed three-quarter angle above.
    const me = people.find((p) => p.personId === meId);
    const cx = me ? me.x : layout.width / 2;
    const cy = me ? me.y : layout.height / 2;
    camera.position.set(cx + 4, 7.5, cy + 6);
    camera.lookAt(cx, 0, cy);
    if (renderer && camera) renderer.render(scene, camera);
  };

  const ripple = (radius: number, mode: 'growing' | 'outline' | 'none'): void => {
    if (!scene || !renderer) return;
    for (const t of rippleTiles) scene.remove(t);
    rippleTiles = [];
    if (mode === 'none') {
      if (camera) renderer.render(scene, camera);
      return;
    }
    const me = [...avatarMeshes.keys()][0];
    void me;
    const mat = new THREE.MeshLambertMaterial({ color: mode === 'outline' ? TEAL : 0x7fc4c6, transparent: true, opacity: mode === 'outline' ? 0.35 : 0.45 });
    const size = radius * 2 + 1;
    const tile = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(currentMe.x, 0.09, currentMe.y);
    rippleTiles.push(tile);
    scene.add(tile);
    if (camera) renderer.render(scene, camera);
  };

  let currentMe: { x: number; y: number } = { x: 0, y: 0 };
  const origUpdate = update;

  const wrappedUpdate = (people: PersonMirror[], layout: LayoutJson, meId: string): void => {
    const me = people.find((p) => p.personId === meId);
    if (me) currentMe = { x: me.x, y: me.y };
    origUpdate(people, layout, meId);
  };

  return {
    update: wrappedUpdate,
    ripple,
    dispose: (): void => {
      renderer?.dispose();
      renderer = null;
    },
  };
}

export function detectWebGL(canvas: HTMLCanvasElement, onMissing: () => void): boolean {
  try {
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
    if (!gl) {
      onMissing();
      return false;
    }
    return true;
  } catch {
    onMissing();
    return false;
  }
}

export function prefersReduced(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
