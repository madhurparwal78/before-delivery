import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

const CHALK = new Color('#f4efe3');
const BRASS = new Color('#c9a227');
const SLATE = new Color('#6e8378');
const GROUND = new Color('#0b1a14');

const PILLAR_STAGGER_MS = 90;
const PILLAR_RISE_MS = 600;
const PILLAR_MAX_HEIGHT = 3.2;
const PODIUM_DOLLY_MS = 1400;
const SPRING_RATE = 10 / (PILLAR_RISE_MS / 1000);

const WIDE_POSITION = new Vector3(0, 3.4, 9.2);
const WIDE_TARGET = new Vector3(0, 1.1, 0);
const PODIUM_POSITION = new Vector3(0, 2.1, 4.6);
const PODIUM_TARGET = new Vector3(0, 1, 0);

export interface PillarLabel {
  x: number;
  y: number;
  count: number;
  correct: boolean;
}

export interface RevealShape {
  counts: number[];
  correct: number[];
  band: number[];
}

export interface StageScene {
  showReveal(shape: RevealShape, animate: boolean): void;
  clearReveal(): void;
  moveToPodium(animate: boolean): void;
  moveToStage(): void;
  resize(): void;
  dispose(): void;
}

/** Null when the browser cannot give us WebGL; the stage then draws the still list. */
export function createStageScene(
  canvas: HTMLCanvasElement,
  onLabels: (labels: PillarLabel[]) => void,
  onRevealSettled: () => void,
): StageScene | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.copy(WIDE_POSITION);
  camera.lookAt(WIDE_TARGET);

  const floor = new Mesh(
    new PlaneGeometry(40, 30),
    new MeshStandardMaterial({ color: GROUND.clone().offsetHSL(0, 0, 0.04), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const backWall = new Mesh(
    new PlaneGeometry(40, 14),
    new MeshStandardMaterial({ color: GROUND, roughness: 1 }),
  );
  backWall.position.set(0, 7, -9);
  scene.add(backWall);

  scene.add(new AmbientLight(CHALK, 0.55));
  const key = new DirectionalLight(CHALK, 0.9);
  key.position.set(4, 9, 7);
  scene.add(key);

  const pillarGroup = new Group();
  scene.add(pillarGroup);
  const bandGroup = new Group();
  scene.add(bandGroup);

  const podiumGroup = new Group();
  podiumGroup.visible = false;
  scene.add(podiumGroup);
  const plinthHeights = [1.5, 1.1, 0.85];
  plinthHeights.forEach((height, index) => {
    const offset = index === 0 ? 0 : index === 1 ? -1.9 : 1.9;
    const plinth = new Mesh(
      new BoxGeometry(1.5, height, 1.5),
      new MeshStandardMaterial({ color: BRASS, roughness: 0.4, metalness: 0.55 }),
    );
    plinth.position.set(offset, height / 2, 0);
    podiumGroup.add(plinth);
  });

  interface Pillar {
    mesh: Mesh<BoxGeometry, MeshStandardMaterial>;
    finalHeight: number;
    count: number;
    startAt: number;
    correct: boolean;
  }
  let pillars: Pillar[] = [];
  let settled = true;
  let dolly: { from: Vector3; to: Vector3; fromTarget: Vector3; toTarget: Vector3; start: number } | null =
    null;
  let frame = 0;

  const resize = (): void => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };

  const projectLabels = (progressByPillar: number[]): void => {
    if (pillars.length === 0) {
      onLabels([]);
      return;
    }
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const labels = pillars.map((pillar, index) => {
      const progress = progressByPillar[index] ?? 1;
      const top = new Vector3(
        pillar.mesh.position.x,
        pillar.finalHeight * progress + 0.15,
        pillar.mesh.position.z,
      ).project(camera);
      return {
        x: ((top.x + 1) / 2) * width,
        y: ((1 - top.y) / 2) * height,
        count: Math.min(pillar.count, Math.round(pillar.count * progress)),
        correct: pillar.correct,
      };
    });
    onLabels(labels);
  };

  /** Critically damped rise: quick at first, easing into place without overshoot. */
  const rise = (seconds: number): number => {
    if (seconds <= 0) return 0;
    if (seconds >= PILLAR_RISE_MS / 1000) return 1;
    const value = 1 - Math.exp(-SPRING_RATE * seconds) * (1 + SPRING_RATE * seconds);
    return Math.min(1, Math.max(0, value));
  };

  const draw = (): void => {
    const now = performance.now();
    let busy = false;

    if (dolly) {
      const progress = Math.min(1, (now - dolly.start) / PODIUM_DOLLY_MS);
      const eased = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(dolly.from, dolly.to, eased);
      const target = new Vector3().lerpVectors(dolly.fromTarget, dolly.toTarget, eased);
      camera.lookAt(target);
      if (progress < 1) busy = true;
      else dolly = null;
    }

    const progressByPillar = pillars.map((pillar) => {
      const elapsed = (now - pillar.startAt) / 1000;
      const progress = rise(elapsed);
      pillar.mesh.scale.y = Math.max(progress, 0.0001);
      pillar.mesh.position.y = (pillar.finalHeight * pillar.mesh.scale.y) / 2;
      if (progress < 1) busy = true;
      return progress;
    });
    if (pillars.length > 0) {
      const done = progressByPillar.every((progress) => progress >= 1);
      projectLabels(progressByPillar);
      if (done && !settled) {
        settled = true;
        for (const pillar of pillars) {
          pillar.mesh.material.color.copy(pillar.correct ? BRASS : SLATE);
          pillar.mesh.material.metalness = pillar.correct ? 0.6 : 0.1;
        }
        onRevealSettled();
      }
    }

    renderer.render(scene, camera);
    frame = busy ? requestAnimationFrame(draw) : 0;
  };

  const kick = (): void => {
    if (frame === 0) frame = requestAnimationFrame(draw);
  };

  resize();
  renderer.render(scene, camera);

  return {
    showReveal(shape, animate) {
      for (const pillar of pillars) {
        pillarGroup.remove(pillar.mesh);
        pillar.mesh.geometry.dispose();
        pillar.mesh.material.dispose();
      }
      bandGroup.clear();
      const largest = Math.max(...shape.counts, 0);
      const spread = Math.min(1.7, 11 / Math.max(shape.counts.length, 1));
      const start = (-(shape.counts.length - 1) * spread) / 2;
      const now = performance.now();
      pillars = shape.counts.map((count, index) => {
        const finalHeight = largest > 0 ? (count / largest) * PILLAR_MAX_HEIGHT : 0.0001;
        const correct = shape.correct.includes(index);
        const mesh = new Mesh(
          new BoxGeometry(spread * 0.62, finalHeight, 0.9),
          new MeshStandardMaterial({
            color: animate ? CHALK : correct ? BRASS : SLATE,
            roughness: 0.6,
            metalness: correct && !animate ? 0.6 : 0.1,
          }),
        );
        mesh.position.set(start + index * spread, finalHeight / 2, 0);
        pillarGroup.add(mesh);
        return {
          mesh,
          finalHeight,
          count,
          startAt: animate ? now + index * PILLAR_STAGGER_MS : now - PILLAR_RISE_MS * 4,
          correct,
        };
      });
      for (const index of shape.band) {
        const plate = new Mesh(
          new PlaneGeometry(spread * 0.95, 1.6),
          new MeshStandardMaterial({ color: BRASS, emissive: BRASS, emissiveIntensity: 0.4 }),
        );
        plate.rotation.x = -Math.PI / 2;
        plate.position.set(start + index * spread, 0.02, 0.9);
        bandGroup.add(plate);
      }
      settled = !animate;
      if (!animate) {
        for (const pillar of pillars) pillar.mesh.scale.y = 1;
      }
      kick();
    },
    clearReveal() {
      for (const pillar of pillars) {
        pillarGroup.remove(pillar.mesh);
        pillar.mesh.geometry.dispose();
        pillar.mesh.material.dispose();
      }
      pillars = [];
      bandGroup.clear();
      settled = true;
      onLabels([]);
      kick();
    },
    moveToPodium(animate) {
      podiumGroup.visible = true;
      if (animate) {
        dolly = {
          from: camera.position.clone(),
          to: PODIUM_POSITION.clone(),
          fromTarget: WIDE_TARGET.clone(),
          toTarget: PODIUM_TARGET.clone(),
          start: performance.now(),
        };
      } else {
        camera.position.copy(PODIUM_POSITION);
        camera.lookAt(PODIUM_TARGET);
      }
      kick();
    },
    moveToStage() {
      podiumGroup.visible = false;
      dolly = null;
      camera.position.copy(WIDE_POSITION);
      camera.lookAt(WIDE_TARGET);
      kick();
    },
    resize() {
      resize();
      kick();
    },
    dispose() {
      if (frame !== 0) cancelAnimationFrame(frame);
      renderer.dispose();
    },
  };
}
