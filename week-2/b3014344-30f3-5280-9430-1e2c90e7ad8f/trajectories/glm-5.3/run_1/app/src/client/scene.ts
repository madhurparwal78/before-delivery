import * as THREE from 'three';

interface SceneSection {
  id: string;
  cameraZ: number;
  cameraY: number;
  objectY: number;
}

/** The five pinned sections, one object each, all procedural geometry. */
const SECTIONS: SceneSection[] = [
  { id: 'hero', cameraZ: 9, cameraY: 2.2, objectY: 2.4 },
  { id: 'work', cameraZ: 8, cameraY: 1.4, objectY: 0.9 },
  { id: 'process', cameraZ: 8, cameraY: 1.2, objectY: 0.6 },
  { id: 'pricing', cameraZ: 7, cameraY: 1.0, objectY: 0.4 },
  { id: 'contact', cameraZ: 7, cameraY: 1.0, objectY: 0.4 },
];

const INK = 0x1d2430;
const COBALT = 0x1b4965;
const SEAM = 0xd1490b;
const PAPER = 0xf6f1e7;

export interface SceneHandle {
  update(scrollFraction: number, sectionId: string): void;
  dispose(): void;
}

export function createScene(container: HTMLElement, options: { cardCount: number }): SceneHandle | null {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  renderer.domElement.tabIndex = -1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 100);

  scene.add(new THREE.AmbientLight(PAPER, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(4, 6, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(COBALT, 0.5);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  const monolith = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.8, 3.4, 6, 1),
    new THREE.MeshStandardMaterial({ color: COBALT, roughness: 0.55, metalness: 0.12 }),
  );
  monolith.position.set(2.6, SECTIONS[0]!.objectY, -1.5);
  scene.add(monolith);

  const deck = new THREE.Group();
  for (let i = 0; i < options.cardCount; i++) {
    const card = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.035, 1.25),
      new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? PAPER : SEAM, roughness: 0.7 }),
    );
    card.position.set(-2.8 + (i % 3) * 0.95, 0.2 + Math.floor(i / 3) * 0.16, -1.2 - Math.floor(i / 3) * 0.5);
    card.rotation.y = (i % 3) * 0.14 - 0.14;
    deck.add(card);
  }
  deck.position.set(0, SECTIONS[1]!.objectY, 0);
  scene.add(deck);

  const rail = new THREE.Group();
  const curvePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    curvePoints.push(new THREE.Vector3(-2.4 + t * 4.8, Math.sin(t * Math.PI * 1.2) * 0.4, -1.6 + Math.cos(t * Math.PI * 0.9) * 0.7));
  }
  const railLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(curvePoints),
    new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.5 }),
  );
  rail.add(railLine);
  const beadGeometry = new THREE.SphereGeometry(0.13, 18, 18);
  for (let i = 0; i < 4; i++) {
    const bead = new THREE.Mesh(beadGeometry, new THREE.MeshStandardMaterial({ color: i === 1 ? SEAM : COBALT, roughness: 0.4 }));
    bead.position.copy(curvePoints[i * 4] ?? curvePoints[0]!);
    rail.add(bead);
  }
  rail.position.set(0, SECTIONS[2]!.objectY, 0);
  scene.add(rail);

  const sheet = new THREE.Group();
  const sheetLeft = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.4),
    new THREE.MeshStandardMaterial({ color: PAPER, roughness: 0.65, side: THREE.DoubleSide }),
  );
  sheetLeft.position.x = -0.58;
  const sheetRight = sheetLeft.clone();
  sheetRight.position.x = 0.58;
  const crease = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 1.44, 0.03),
    new THREE.MeshStandardMaterial({ color: SEAM, roughness: 0.5 }),
  );
  sheet.add(sheetLeft, sheetRight, crease);
  sheet.position.set(-2.2, SECTIONS[3]!.objectY, -0.4);
  scene.add(sheet);

  let lastScroll = -1;
  let turn = 0;
  let targetTurn = 0;
  let running = true;

  function currentSectionId(fraction: number): number {
    const index = Math.min(SECTIONS.length - 1, Math.floor(fraction * SECTIONS.length));
    return Math.max(0, index);
  }

  function update(scrollFraction: number, _sectionId: string): void {
    const index = currentSectionId(scrollFraction);
    const sectionStart = index / SECTIONS.length;
    const sectionEnd = (index + 1) / SECTIONS.length;
    const local = (scrollFraction - sectionStart) / (sectionEnd - sectionStart);
    const from = SECTIONS[index]!;
    const to = SECTIONS[Math.min(SECTIONS.length - 1, index + 1)]!;
    const eased = smooth(local);
    camera.position.z = lerp(from.cameraZ, to.cameraZ, eased) - 0.001;
    camera.position.y = lerp(from.cameraY, to.cameraY, eased);
    camera.lookAt(0, lerp(from.objectY, to.objectY, eased) * 0.5, 0);
  }

  function renderLoop(): void {
    if (!running) return;
    const doc = document.documentElement;
    const max = Math.max(1, doc.scrollHeight - window.innerHeight);
    const fraction = window.scrollY / max;
    if (fraction !== lastScroll) {
      lastScroll = fraction;
      update(fraction, '');
    }
    const heroVisible = fraction < 1 / SECTIONS.length + 0.05;
    if (heroVisible) {
      targetTurn = (targetTurn + (2 * Math.PI) / (38 * 60)) % (2 * Math.PI);
    }
    turn = lerp(turn, targetTurn, 0.08);
    monolith.rotation.y = turn;
    container.dataset.sceneTurn = String(Math.round((turn * 180) / Math.PI));
    renderer.render(scene, camera);
    requestAnimationFrame(renderLoop);
  }

  requestAnimationFrame(renderLoop);

  const onResize = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  return {
    update,
    dispose(): void {
      running = false;
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A still drawing of the pinned object for the no-WebGL path. */
export function stillMarkupFor(sectionId: string): string {
  switch (sectionId) {
    case 'hero':
      return '<span class="still-object" aria-hidden="true">▮</span>';
    case 'work':
      return '<span class="still-object" aria-hidden="true">▤</span>';
    case 'process':
      return '<span class="still-object" aria-hidden="true">⌇</span>';
    case 'pricing':
      return '<span class="still-object" aria-hidden="true">◧</span>';
    default:
      return '<span class="still-object" aria-hidden="true">✳</span>';
  }
}
