/**
 * The signature light-pool room: a 3D room with a ceiling grid, where placing a
 * fitting grows its cone, expands its floor pool, tints it by colour temperature
 * and counts the readout up, in that order.
 *
 * The lighting dial changes the room's ambient brightness only; it never changes
 * the pool sizes, tints or numbers.
 */

import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { cctColour } from "./fittings.js";
import type { Placement } from "../../shared/types.js";

/** One scene unit is a metre. */
const MM_PER_UNIT = 1000;

export interface RoomViewerProps {
  widthMm: number;
  depthMm: number;
  ceilingHeightMm: number;
  placements: readonly Placement[];
  ambient: number;
  /** 0 to 1: how far each placement's entry sequence has run. */
  growth: Record<string, number>;
}

interface PlacementVisual {
  group: Group;
  cone: Mesh;
  pool: Mesh;
  coneMaterial: MeshStandardMaterial;
  poolMaterial: MeshStandardMaterial;
  beamDeg: number;
  poolDiameterMm: number;
}

export function RoomViewer(props: RoomViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<{
    renderer: WebGLRenderer;
    scene: Scene;
    camera: PerspectiveCamera;
    shell: Group;
    fittings: Map<string, PlacementVisual>;
    ambientLight: AmbientLight;
  } | null>(null);
  const growthRef = useRef(props.growth);
  growthRef.current = props.growth;

  // Scene, room shell and render loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    const scene = new Scene();
    const camera = new PerspectiveCamera(42, 4 / 3, 0.1, 200);
    const ambientLight = new AmbientLight(0xffffff, props.ambient);
    scene.add(ambientLight);
    const key = new DirectionalLight(0xffffff, 0.5);
    key.position.set(4, 7, 5);
    scene.add(key);

    const shell = new Group();
    scene.add(shell);

    const fittings = new Map<string, PlacementVisual>();
    sceneRef.current = { renderer, scene, camera, shell, fittings, ambientLight };

    const resize = (): void => {
      const width = canvas.clientWidth || 640;
      const height = canvas.clientHeight || 480;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    let frame = 0;
    const tick = (): void => {
      const current = sceneRef.current;
      if (current) {
        for (const [id, visual] of current.fittings) {
          const t = growthRef.current[id] ?? 1;
          applyGrowth(visual, t, props.ceilingHeightMm);
        }
        current.renderer.render(current.scene, current.camera);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      sceneRef.current = null;
    };
    // The scene itself is built once; the room and fittings are kept in step below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The room shell follows the room size and the ceiling height.
  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    const { shell, camera } = current;

    for (const child of [...shell.children]) {
      shell.remove(child);
      if (child instanceof Mesh) {
        child.geometry.dispose();
        (child.material as MeshStandardMaterial).dispose();
      }
    }

    const width = props.widthMm / MM_PER_UNIT;
    const depth = props.depthMm / MM_PER_UNIT;
    const ceiling = props.ceilingHeightMm / MM_PER_UNIT;

    // The plan's origin is the back-left corner seen from above, with x running to
    // the right and y towards the viewer, so the scene is centred on the room.
    shell.position.set(-width / 2, 0, -depth / 2);

    const floor = new Mesh(
      new BoxGeometry(width, 0.02, depth),
      new MeshStandardMaterial({ color: 0x1b1f27, roughness: 0.95 }),
    );
    floor.position.set(width / 2, -0.01, depth / 2);
    shell.add(floor);

    const back = new Mesh(
      new BoxGeometry(width, ceiling, 0.02),
      new MeshStandardMaterial({ color: 0x151920, roughness: 0.95 }),
    );
    back.position.set(width / 2, ceiling / 2, 0);
    shell.add(back);

    const left = new Mesh(
      new BoxGeometry(0.02, ceiling, depth),
      new MeshStandardMaterial({ color: 0x131720, roughness: 0.95 }),
    );
    left.position.set(0, ceiling / 2, depth / 2);
    shell.add(left);

    const grid = new GridHelper(Math.max(width, depth), Math.round(Math.max(width, depth) * 2), 0x3a4150, 0x262c36);
    grid.position.set(width / 2, ceiling, depth / 2);
    shell.add(grid);

    camera.position.set(0, ceiling * 1.5 + 1.1, depth * 1.15 + 2.2);
    camera.lookAt(0, ceiling * 0.3, 0);
  }, [props.widthMm, props.depthMm, props.ceilingHeightMm]);

  useEffect(() => {
    const current = sceneRef.current;
    if (current) current.ambientLight.intensity = props.ambient;
  }, [props.ambient]);

  // One cone and pool per placement, added, moved and removed with the data.
  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    const { shell, fittings } = current;
    const seen = new Set<string>();

    for (const placement of props.placements) {
      seen.add(placement.id);
      const existing = fittings.get(placement.id);
      const x = placement.x_mm / MM_PER_UNIT;
      const z = placement.y_mm / MM_PER_UNIT;

      if (
        existing &&
        existing.beamDeg === placement.beam_deg &&
        existing.poolDiameterMm === placement.pool_diameter_mm
      ) {
        existing.group.position.set(x, 0, z);
        continue;
      }
      if (existing) {
        shell.remove(existing.group);
        existing.cone.geometry.dispose();
        existing.pool.geometry.dispose();
        existing.coneMaterial.dispose();
        existing.poolMaterial.dispose();
      }

      const visual = makeVisual(placement, props.ceilingHeightMm);
      visual.group.position.set(x, 0, z);
      shell.add(visual.group);
      fittings.set(placement.id, visual);
    }

    for (const [id, visual] of [...fittings]) {
      if (seen.has(id)) continue;
      shell.remove(visual.group);
      visual.cone.geometry.dispose();
      visual.pool.geometry.dispose();
      visual.coneMaterial.dispose();
      visual.poolMaterial.dispose();
      fittings.delete(id);
    }
  }, [props.placements, props.ceilingHeightMm]);

  return <canvas ref={canvasRef} role="img" aria-label="Room 3D view" />;
}

function makeVisual(placement: Placement, ceilingHeightMm: number): PlacementVisual {
  const group = new Group();
  const ceiling = ceilingHeightMm / MM_PER_UNIT;
  const tint = cctColour(placement.cct_k);

  const coneMaterial = new MeshStandardMaterial({
    color: tint,
    emissive: tint,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  const radius = placement.pool_diameter_mm / 2 / MM_PER_UNIT;
  const cone = new Mesh(new CylinderGeometry(0.02, radius, ceiling, 40, 1, true), coneMaterial);
  cone.position.y = ceiling / 2;
  group.add(cone);

  const poolMaterial = new MeshStandardMaterial({
    color: tint,
    emissive: tint,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const pool = new Mesh(new CylinderGeometry(radius, radius, 0.006, 48), poolMaterial);
  pool.position.y = 0.006;
  group.add(pool);

  const fixture = new Mesh(
    new CylinderGeometry(0.06, 0.06, 0.05, 20),
    new MeshStandardMaterial({ color: 0xd8d4cc, metalness: 0.3, roughness: 0.6 }),
  );
  fixture.position.y = ceiling - 0.02;
  group.add(fixture);

  return {
    group,
    cone,
    pool,
    coneMaterial,
    poolMaterial,
    beamDeg: placement.beam_deg,
    poolDiameterMm: placement.pool_diameter_mm,
  };
}

/**
 * Drives the four steps from one progress value: the cone grows down, the pool
 * expands with a slight spring past its size, and the tint fades in during the
 * last part of the pool step.
 */
function applyGrowth(visual: PlacementVisual, t: number, ceilingHeightMm: number): void {
  const ceiling = ceilingHeightMm / MM_PER_UNIT;

  // cone: 0 to 0.35 of the sequence.
  const coneT = clamp01(t / 0.35);
  visual.cone.scale.y = Math.max(0.001, coneT);
  visual.cone.position.y = (ceiling * coneT) / 2 + ceiling * (1 - coneT);
  visual.coneMaterial.opacity = 0.14 * coneT;

  // pool: 0.35 to 0.75, springing very slightly past its diameter and back.
  const poolT = clamp01((t - 0.35) / 0.4);
  const spring = poolT >= 1 ? 1 : 1 - (1 - poolT) ** 3 + Math.sin(poolT * Math.PI) * 0.07;
  visual.pool.scale.set(Math.max(0.001, spring), 1, Math.max(0.001, spring));

  // tint: fades in during the last part of the pool step.
  const tintT = clamp01((t - 0.55) / 0.3);
  visual.poolMaterial.opacity = 0.42 * tintT;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export { MM_PER_UNIT };
