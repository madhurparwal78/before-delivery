import * as THREE from 'three';

/**
 * The sightline scene: procedural shards that float in a loose cloud and line
 * up into the chapter's numeral and title only from the sightline viewpoint.
 */

export interface SceneHandle {
  setYaw(yawDeg: number): void;
  getYaw(): number;
  dispose(): void;
  resize(): void;
  hasWebGl(): boolean;
}

const SHARD_COUNT = 42;

/** Points spelling the numeral, used as the shards' target positions. */
function numeralTargets(numeral: string, height: number): Array<{ x: number; y: number }> {
  const targets: Array<{ x: number; y: number }> = [];
  const glyphs: Record<string, Array<[number, number]>> = {
    I: [[0, 0], [0, 1], [0, 2], [0, 3]],
    V: [[-0.6, 3], [-0.3, 2], [0, 1], [0.3, 1], [0.6, 2], [0.9, 3]],
    X: [[-0.7, 0.4], [-0.4, 1.2], [0, 2], [0.4, 1.2], [0.7, 0.4], [-0.4, 0.4], [0.4, 0.4], [-0.7, 2], [0.7, 2]],
  };
  const letters: Array<[number, number]> = [];
  let offset = 0;
  for (const ch of numeral.split('')) {
    const glyph = glyphs[ch] ?? glyphs['I']!;
    for (const [gx, gy] of glyph) {
      letters.push([gx + offset, gy]);
    }
    offset += 1.5;
  }
  const centerX = letters.reduce((sum, [x]) => sum + x, 0) / Math.max(1, letters.length);
  for (const [x, y] of letters) {
    targets.push({ x: (x - centerX) * 0.95, y: (y - 1.5) * (height / 3.4) });
  }
  while (targets.length < SHARD_COUNT) {
    targets.push({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4 });
  }
  return targets.slice(0, SHARD_COUNT);
}

export function createSightlineScene(
  container: HTMLElement,
  opts: {
    numeral: string;
    sightlineDeg: number;
    onYawChange: (yawDeg: number) => void;
    reducedMotion: () => boolean;
  },
): SceneHandle {
  let yaw = -60;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.domElement.classList.add('scene-canvas');
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, container.clientWidth / container.clientHeight, 0.1, 100);
  camera.position.set(0, 0, 11);

  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xfff2e0, 1.1);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff7a1a, 0.5);
  rim.position.set(-6, -2, -4);
  scene.add(rim);

  const targets = numeralTargets(opts.numeral, 3.6);
  const group = new THREE.Group();
  scene.add(group);

  const shardGeometry = new THREE.BoxGeometry(0.22, 0.62, 0.1);
  const shardMaterial = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.55, metalness: 0.15 });
  const shards: Array<{ mesh: THREE.Mesh; home: THREE.Vector3; target: THREE.Vector3 }> = [];
  for (let i = 0; i < SHARD_COUNT; i++) {
    const mesh = new THREE.Mesh(shardGeometry, shardMaterial);
    const angle = (i / SHARD_COUNT) * Math.PI * 2;
    const radius = 4.4 + Math.random() * 1.6;
    const home = new THREE.Vector3(Math.cos(angle) * radius, (Math.random() - 0.5) * 5, Math.sin(angle) * radius);
    const target = new THREE.Vector3(targets[i]!.x, targets[i]!.y, (Math.random() - 0.5) * 0.25);
    mesh.position.copy(home);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    group.add(mesh);
    shards.push({ mesh, home, target });
  }

  // A faint rule of dust for depth.
  const dustCount = 160;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 18;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 9;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 10 - 3;
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x8d8878, size: 0.045, transparent: true, opacity: 0.6 }));
  scene.add(dust);

  let swayT = 0;
  let settleStart = -1;
  let resolveRatio = 0;

  /** Position each shard between its cloud home and its target by closeness to the sightline. */
  function layout(): void {
    const d = Math.abs(yaw - opts.sightlineDeg);
    const closeness = Math.max(0, 1 - d / 40);
    resolveRatio = d <= 2.5 ? 1 : closeness * closeness * 0.6;
    for (const s of shards) {
      s.mesh.position.lerpVectors(s.home, s.target, resolveRatio);
    }
  }

  /** Input: drag across the full canvas width moves the full 120 degrees. */
  let dragging = false;
  let lastX = 0;
  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';

  const roundYaw = (v: number): number => (v >= 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5));
  const clamp = (v: number): number => Math.min(60, Math.max(-60, v));

  el.addEventListener('pointerdown', (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    el.setPointerCapture(event.pointerId);
  });
  el.addEventListener('pointermove', (event: PointerEvent) => {
    if (!dragging) return;
    const width = el.clientWidth || 1;
    const dx = event.clientX - lastX;
    lastX = event.clientX;
    if (Math.abs(dx) < 0.5) return;
    const next = clamp(roundYaw(yaw + (dx / width) * 120));
    if (next !== yaw) {
      yaw = next;
      opts.onYawChange(yaw);
    }
  });
  const endDrag = (): void => {
    dragging = false;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('pointerleave', endDrag);

  /** Scroll: each 100 pixels of wheel movement turns the yaw by 3 degrees. */
  let wheelAccum = 0;
  let atLimit = false;
  el.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      if (atLimit) return;
      event.preventDefault();
      wheelAccum += event.deltaY;
      let next = yaw;
      while (Math.abs(wheelAccum) >= 100) {
        const direction = wheelAccum > 0 ? 3 : -3;
        next = clamp(next + direction);
        wheelAccum -= Math.sign(wheelAccum) * 100;
      }
      if (next !== yaw) {
        yaw = next;
        opts.onYawChange(yaw);
      }
      if ((yaw >= 60 && event.deltaY > 0) || (yaw <= -60 && event.deltaY < 0)) {
        atLimit = true;
        window.setTimeout(() => {
          atLimit = false;
        }, 400);
      }
    },
    { passive: false },
  );

  function animate(): void {
    const reduce = opts.reducedMotion();
    if (!reduce) {
      // Idle sway: at most 2 degrees over 12-20 seconds, never changing yaw.
      const dt = 1 / 60;
      swayT += dt * (2 * Math.PI / 16);
      const sway = Math.sin(swayT) * THREE.MathUtils.degToRad(2);
      group.rotation.y = THREE.MathUtils.degToRad(yaw) + sway;
      dust.rotation.y = sway * 0.4;
    } else {
      group.rotation.y = THREE.MathUtils.degToRad(yaw);
    }
    if (settleStart >= 0 && !reduce) {
      const t = Math.min(1, (performance.now() - settleStart) / 900);
      const overshoot = 1 + 0.12 * Math.sin(t * Math.PI) * (1 - t);
      for (const s of shards) {
        s.mesh.position.lerpVectors(s.home, s.target, Math.min(1, resolveRatio * overshoot));
      }
    } else {
      layout();
    }
    renderer.render(scene, camera);
    raf = window.requestAnimationFrame(animate);
  }
  let raf = window.requestAnimationFrame(animate);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.cancelAnimationFrame(raf);
    } else {
      raf = window.requestAnimationFrame(animate);
    }
  });

  return {
    setYaw(next: number) {
      yaw = clamp(roundYaw(next));
      if (Math.abs(yaw - opts.sightlineDeg) <= 2.5 && settleStart < 0) settleStart = performance.now();
    },
    getYaw() {
      return yaw;
    },
    dispose() {
      window.cancelAnimationFrame(raf);
      renderer.dispose();
      shardGeometry.dispose();
      shardMaterial.dispose();
      dustGeometry.dispose();
      el.remove();
    },
    resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    hasWebGl() {
      return true;
    },
  };
}

/** Do we have WebGL at all? */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** A still image of the sculpture from one angle, for the viewpoints radio. */
export function renderViewpointImage(
  numeral: string,
  sightlineDeg: number,
  angleDeg: number,
  width = 180,
  height = 120,
): string {
  const targets = numeralTargets(numeral, 3.6);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = '#131410';
  ctx.fillRect(0, 0, width, height);
  const d = Math.abs(angleDeg - sightlineDeg);
  const closeness = d <= 2.5 ? 1 : Math.max(0, 1 - d / 40);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.fillStyle = closeness > 0.85 ? '#ff7a1a' : '#e8e2d4';
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const home = {
      x: Math.cos((i / targets.length) * Math.PI * 2) * (4.4 + (i % 5) * 0.3),
      y: ((i * 37) % 100) / 100 * 5 - 2.5,
    };
    const x = home.x + (t.x * 18 - home.x) * closeness;
    const y = -home.y + (-t.y * 14 + home.y) * closeness;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((1 - closeness) * (i % 7) * 0.5);
    ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();
  }
  ctx.restore();
  return canvas.toDataURL('image/png');
}
