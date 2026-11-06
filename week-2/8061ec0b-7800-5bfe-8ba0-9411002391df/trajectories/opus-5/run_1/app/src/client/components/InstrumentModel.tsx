import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { InstrumentType, Size } from '../../shared/types';
import { animateValue, SPEED } from '../lib/motion';

THREE.ColorManagement.enabled = false;

const PAPER = 0xfaf5ea;
const INK = 0x16202b;
const INK_TINT = 0x4a5560;
const BRASS = 0xb58a35;

const DEGREES_PER_100_PIXELS = 90;
const KEY_STEP_DEGREES = 15;

/** The share of the canvas height each size fills, so a larger size is always drawn taller. */
const HEIGHT_BY_SIZE: Record<Size, number> = {
  full: 0.8,
  '4/4': 0.8,
  '3/4': 0.75,
  '1/2': 0.7,
  '1/4': 0.65,
};

function brassMaterial(bottom: number, height: number, fraction: number | null): THREE.ShaderMaterial {
  const threshold = fraction === null || fraction <= 0 ? bottom - 1 : bottom + fraction * height;
  return new THREE.ShaderMaterial({
    uniforms: {
      uThreshold: { value: threshold },
      uInk: { value: new THREE.Color(INK_TINT) },
      uBrass: { value: new THREE.Color(BRASS) },
    },
    vertexShader: `
      varying float vWorldY;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldY = world.y;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uThreshold;
      uniform vec3 uInk;
      uniform vec3 uBrass;
      varying float vWorldY;
      void main() {
        gl_FragColor = vec4(vWorldY < uThreshold ? uBrass : uInk, 1.0);
      }
    `,
  });
}

function mesh(geometry: THREE.BufferGeometry, y: number, x = 0, z = 0): THREE.BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

/** One distinct procedural model per instrument, built from simple shapes and symmetric about its axis. */
function buildGeometry(type: InstrumentType): THREE.BufferGeometry[] {
  switch (type) {
    case 'flute': {
      const parts = [mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 24), 0)];
      for (const y of [-0.7, -0.2, 0.3, 0.8]) {
        parts.push(mesh(new THREE.TorusGeometry(0.075, 0.018, 8, 20).rotateX(Math.PI / 2), y));
      }
      parts.push(mesh(new THREE.CylinderGeometry(0.05, 0.065, 0.2, 20), 1.15));
      return parts;
    }
    case 'clarinet': {
      const parts = [
        mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.8, 24), 0),
        mesh(new THREE.CylinderGeometry(0.1, 0.24, 0.34, 24), -1.07),
        mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.3, 20), 1.05),
      ];
      for (const y of [-0.5, -0.1, 0.35]) {
        parts.push(mesh(new THREE.TorusGeometry(0.1, 0.022, 8, 20).rotateX(Math.PI / 2), y));
      }
      return parts;
    }
    case 'trumpet': {
      const parts = [
        mesh(new THREE.CylinderGeometry(0.065, 0.075, 1.3, 24), 0.15),
        mesh(new THREE.CylinderGeometry(0.09, 0.42, 0.55, 28), -0.78),
        mesh(new THREE.TorusGeometry(0.12, 0.03, 10, 24).rotateX(Math.PI / 2), 0.85),
        mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 16), 0.95),
      ];
      for (let index = 0; index < 3; index += 1) {
        const angle = (index * 2 * Math.PI) / 3;
        parts.push(
          mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.36, 14), 0.1, Math.cos(angle) * 0.1, Math.sin(angle) * 0.1),
        );
      }
      return parts;
    }
    case 'violin':
    case 'cello': {
      const lowerWidth = type === 'cello' ? 0.60 : 0.52;
      const upperWidth = lowerWidth * 0.82;
      const waistWidth = lowerWidth * 0.56;
      const depth = type === 'cello' ? 0.26 : 0.2;
      const neckHeight = type === 'cello' ? 0.95 : 0.8;
      const lower = new THREE.SphereGeometry(1, 28, 20);
      lower.scale(lowerWidth, 0.42, depth);
      const upper = new THREE.SphereGeometry(1, 28, 20);
      upper.scale(upperWidth, 0.34, depth * 0.95);
      const waist = new THREE.CylinderGeometry(waistWidth, waistWidth, 0.3, 24);
      waist.scale(1, 1, (depth * 0.9) / waistWidth);
      const parts = [
        mesh(lower, -0.5),
        mesh(waist, -0.12),
        mesh(upper, 0.24),
        mesh(new THREE.BoxGeometry(0.12, neckHeight, 0.09), 0.5 + neckHeight / 2),
        mesh(new THREE.BoxGeometry(0.09, neckHeight * 0.85, 0.04), 0.5 + neckHeight / 2, 0, 0.06),
        mesh(new THREE.SphereGeometry(0.1, 16, 12), 0.55 + neckHeight),
      ];
      if (type === 'cello') parts.push(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 12), -1.15));
      return parts;
    }
  }
}

interface ModelProps {
  type: InstrumentType;
  size: Size;
  label: string;
  fraction: number | null;
}

/** The turnable WebGL model, with the flat drawing as its fallback when WebGL is unavailable. */
export function InstrumentModel({ type, size, label, fraction }: ModelProps): ReactNode {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const [describedAngle, setDescribedAngle] = useState(0);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const scene = useRef<THREE.Scene | null>(null);
  const camera = useRef<THREE.OrthographicCamera | null>(null);
  const group = useRef<THREE.Group | null>(null);
  const materials = useRef<THREE.ShaderMaterial[]>([]);
  const modelBox = useRef<{ bottom: number; height: number }>({ bottom: -0.8, height: 1.6 });
  const angle = useRef(0);
  const targetAngle = useRef(0);
  const stopAngle = useRef<() => void>(() => undefined);
  const stopBrass = useRef<() => void>(() => undefined);
  const brassFraction = useRef(fraction ?? 0);
  const hasBand = fraction !== null;

  const draw = (): void => {
    if (renderer.current === null || scene.current === null || camera.current === null) return;
    renderer.current.render(scene.current, camera.current);
  };

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    let context: THREE.WebGLRenderer;
    try {
      const gl = element.getContext('webgl2', { preserveDrawingBuffer: true }) ??
        element.getContext('webgl', { preserveDrawingBuffer: true });
      if (gl === null) throw new Error('no webgl');
      context = new THREE.WebGLRenderer({
        canvas: element,
        context: gl as WebGLRenderingContext,
        preserveDrawingBuffer: true,
        antialias: true,
        alpha: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }
    context.outputColorSpace = THREE.LinearSRGBColorSpace;
    context.setClearColor(new THREE.Color(PAPER), 1);
    renderer.current = context;
    const nextScene = new THREE.Scene();
    scene.current = nextScene;

    const targetHeight = 2 * (HEIGHT_BY_SIZE[size] ?? 0.8);
    const bottom = -0.9;
    const container = new THREE.Group();
    const parts = buildGeometry(type);
    const merged = new THREE.Box3();
    const meshes: THREE.Mesh[] = [];
    for (const geometry of parts) {
      geometry.computeBoundingBox();
      if (geometry.boundingBox !== null) merged.union(geometry.boundingBox);
      meshes.push(new THREE.Mesh(geometry));
    }
    const rawHeight = merged.max.y - merged.min.y;
    const scale = targetHeight / rawHeight;
    const centreX = (merged.max.x + merged.min.x) / 2;
    const centreZ = (merged.max.z + merged.min.z) / 2;
    materials.current = [];
    for (const item of meshes) {
      item.position.set(-centreX, -merged.min.y, -centreZ);
      const material = brassMaterial(bottom, targetHeight, fraction);
      materials.current.push(material);
      item.material = material;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(item.geometry, 24),
        new THREE.LineBasicMaterial({ color: INK }),
      );
      edges.position.copy(item.position);
      const holder = new THREE.Group();
      holder.add(item);
      holder.add(edges);
      holder.scale.setScalar(scale);
      holder.position.y = bottom;
      container.add(holder);
    }
    modelBox.current = { bottom, height: targetHeight };
    nextScene.add(container);
    group.current = container;

    const resize = (): void => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (width === 0 || height === 0) return;
      context.setPixelRatio(1);
      context.setSize(width, height, false);
      const aspect = width / height;
      const next = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 50);
      next.position.set(0, 0, 5);
      next.lookAt(0, 0, 0);
      camera.current = next;
      draw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      context.dispose();
      renderer.current = null;
    };
  }, [type, size, hasBand]);

  useEffect(() => {
    const target = fraction ?? 0;
    const from = brassFraction.current;
    if (from === target) return;
    stopBrass.current();
    stopBrass.current = animateValue(from, target, SPEED.long, (value) => {
      brassFraction.current = value;
      const { bottom, height } = modelBox.current;
      for (const material of materials.current) {
        material.uniforms.uThreshold!.value = fraction === null || value <= 0 ? bottom - 1 : bottom + value * height;
      }
      draw();
    });
    return () => stopBrass.current();
  }, [fraction]);

  const turnTo = (next: number): void => {
    const wrapped = ((next % 360) + 360) % 360;
    targetAngle.current = wrapped;
    setDescribedAngle(Math.round(wrapped) % 360);
    stopAngle.current();
    const from = angle.current;
    const delta = ((wrapped - from + 540) % 360) - 180;
    stopAngle.current = animateValue(from, from + delta, SPEED.medium, (value) => {
      angle.current = value;
      if (group.current !== null) group.current.rotation.y = (value * Math.PI) / 180;
      draw();
    });
  };

  const setAngleDirect = (next: number): void => {
    stopAngle.current();
    const wrapped = ((next % 360) + 360) % 360;
    angle.current = wrapped;
    targetAngle.current = wrapped;
    if (group.current !== null) group.current.rotation.y = (wrapped * Math.PI) / 180;
    const rounded = Math.round(wrapped / KEY_STEP_DEGREES) * KEY_STEP_DEGREES;
    setDescribedAngle(rounded % 360);
    draw();
  };

  const drag = useRef<{ x: number; y: number; start: number; active: boolean } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    drag.current = { x: event.clientX, y: event.clientY, start: angle.current, active: event.pointerType !== 'touch' };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const state = drag.current;
    if (state === null) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current = null;
        return;
      }
      state.active = true;
    }
    setAngleDirect(state.start + (dx * DEGREES_PER_100_PIXELS) / 100);
  };

  const onPointerUp = (): void => {
    const state = drag.current;
    drag.current = null;
    if (state === null || !state.active) return;
    turnTo(Math.round(angle.current / KEY_STEP_DEGREES) * KEY_STEP_DEGREES);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      turnTo(targetAngle.current + KEY_STEP_DEGREES);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      turnTo(targetAngle.current - KEY_STEP_DEGREES);
    }
  };

  if (webglFailed) {
    return <FlatDrawing type={type} size={size} label={label} fraction={fraction} />;
  }

  const descriptionId = `model-description-${type}`;
  return (
    <>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`${label} model`}
        aria-describedby={descriptionId}
        tabIndex={0}
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      />
      <span id={descriptionId} className="visually-hidden">
        {`Turned ${describedAngle} degrees. Left and Right arrow keys turn it.`}
      </span>
    </>
  );
}

const FLAT_PATHS: Record<InstrumentType, string> = {
  flute: 'M48 6 h4 v88 h-4 Z M44 24 h12 v3 h-12 Z M44 48 h12 v3 h-12 Z M44 72 h12 v3 h-12 Z',
  clarinet: 'M46 6 h8 l3 74 l9 14 h-32 l9 -14 Z',
  trumpet: 'M46 6 h8 v62 l18 26 h-44 l18 -26 Z',
  violin: 'M50 4 l5 6 v18 h6 c10 10 12 30 4 42 c-6 10 -24 10 -30 0 c-8 -12 -6 -32 4 -42 h6 v-18 Z',
  cello: 'M50 2 l5 6 v22 h8 c12 12 14 38 5 52 c-8 12 -28 12 -36 0 c-9 -14 -7 -40 5 -52 h8 v-22 Z',
};

/** The flat ink line drawing, with the same brass fill rule, for browsers without WebGL. */
export function FlatDrawing({ type, size, label, fraction }: ModelProps): ReactNode {
  const height = (HEIGHT_BY_SIZE[size] ?? 0.8) * 100;
  const top = 100 - height;
  const fill = fraction === null ? 0 : Math.max(0, Math.min(1, fraction));
  return (
    <svg className="flat-drawing" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <title>{`${label} drawing`}</title>
      <defs>
        <clipPath id={`flat-clip-${type}`}>
          <path d={FLAT_PATHS[type]} />
        </clipPath>
      </defs>
      <g transform={`translate(0 ${top}) scale(1 ${height / 100})`}>
        <path d={FLAT_PATHS[type]} fill="#4a5560" stroke="#16202b" strokeWidth="1.5" />
        <rect
          x="0"
          y={100 - fill * 100}
          width="100"
          height={fill * 100}
          fill="#b58a35"
          clipPath={`url(#flat-clip-${type})`}
        />
      </g>
    </svg>
  );
}
