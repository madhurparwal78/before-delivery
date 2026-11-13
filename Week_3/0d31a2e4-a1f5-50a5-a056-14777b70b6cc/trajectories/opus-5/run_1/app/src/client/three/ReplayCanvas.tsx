import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { buildCourse } from '../../shared/sim/course.js';
import type { FrameBean, RoundKind } from '../../shared/types.js';
import {
  type BeanMesh,
  type CourseScene,
  createBeanMesh,
  createCourseScene,
  overviewFraming,
  replayFraming,
  setBeanMarker,
} from './scene.js';

/** Published glide and camera flight times. */
const BEAN_GLIDE_MS = 150;
const CAMERA_FLIGHT_MS = 500;

interface Props {
  kind: RoundKind;
  seed: number;
  beans: FrameBean[];
  tick: number;
  jumped: boolean;
  /** Bumped when a flight must run even though the tick did not change. */
  flightKey: number;
  reducedMotion: boolean;
  onBeansMoving: (moving: boolean) => void;
  onCameraMoving: (moving: boolean) => void;
}

interface Glide {
  from: Map<number, THREE.Vector3>;
  to: Map<number, THREE.Vector3>;
  start: number;
}

interface Flight {
  fromEye: THREE.Vector3;
  fromLook: THREE.Vector3;
  toEye: THREE.Vector3;
  toLook: THREE.Vector3;
  start: number;
  duration: number;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

/** The 3D photo-finish: beans glide and the camera flies to the leader on jumps. */
export function ReplayCanvas({
  kind,
  seed,
  beans,
  tick,
  jumped,
  flightKey,
  reducedMotion,
  onBeansMoving,
  onCameraMoving,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<CourseScene | null>(null);
  const meshesRef = useRef(new Map<number, BeanMesh>());
  const glideRef = useRef<Glide | null>(null);
  const flightRef = useRef<Flight | null>(null);
  const eyeRef = useRef(new THREE.Vector3());
  const lookRef = useRef(new THREE.Vector3());
  const jumpedRef = useRef(jumped);
  jumpedRef.current = jumped;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const course = buildCourse(kind, seed);
    const view = createCourseScene(canvas, course);
    viewRef.current = view;
    const framing = overviewFraming(course);
    eyeRef.current.copy(framing.eye);
    lookRef.current.copy(framing.look);
    let frame = 0;

    const resize = (): void => {
      const parent = canvas.parentElement;
      if (parent === null) return;
      view.resize(parent.clientWidth, parent.clientHeight);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = (): void => {
      frame = window.requestAnimationFrame(draw);
      const now = performance.now();
      const glide = glideRef.current;
      if (glide !== null) {
        const t = Math.min(1, (now - glide.start) / BEAN_GLIDE_MS);
        for (const [userId, to] of glide.to) {
          const mesh = meshesRef.current.get(userId);
          const from = glide.from.get(userId);
          if (mesh === undefined || from === undefined) continue;
          mesh.group.position.lerpVectors(from, to, easeOut(t));
        }
        if (t >= 1) {
          glideRef.current = null;
          onBeansMoving(false);
        }
      }
      const flight = flightRef.current;
      if (flight !== null) {
        const t = Math.min(1, (now - flight.start) / flight.duration);
        const eased = easeOut(t);
        eyeRef.current.lerpVectors(flight.fromEye, flight.toEye, eased);
        lookRef.current.lerpVectors(flight.fromLook, flight.toLook, eased);
        if (t >= 1) {
          flightRef.current = null;
          onCameraMoving(false);
        }
      }
      view.camera.position.copy(eyeRef.current);
      view.camera.lookAt(lookRef.current);
      view.render();
    };
    draw();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      for (const mesh of meshesRef.current.values()) view.scene.remove(mesh.group);
      meshesRef.current.clear();
      view.dispose();
      viewRef.current = null;
    };
  }, [kind, seed, onBeansMoving, onCameraMoving]);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null || beans.length === 0) return;
    const from = new Map<number, THREE.Vector3>();
    const to = new Map<number, THREE.Vector3>();
    for (const bean of beans) {
      let mesh = meshesRef.current.get(bean.userId);
      if (mesh === undefined) {
        mesh = createBeanMesh(bean.hue);
        mesh.group.position.set(bean.x, bean.y, bean.z);
        meshesRef.current.set(bean.userId, mesh);
        view.scene.add(mesh.group);
      }
      setBeanMarker(mesh, bean.marker);
      const material = mesh.body.material as THREE.MeshLambertMaterial;
      material.opacity = bean.state === 'eliminated' ? 0.5 : 1;
      material.transparent = bean.state === 'eliminated';
      from.set(bean.userId, mesh.group.position.clone());
      to.set(bean.userId, new THREE.Vector3(bean.x, bean.y, bean.z));
    }
    view.setTickMotion(tick);

    const leader = beans[0];
    const leaderPosition = new THREE.Vector3(leader.x, leader.y, leader.z);
    const framing = replayFraming(view.course, leaderPosition);

    if (reducedMotion) {
      for (const [userId, position] of to) {
        meshesRef.current.get(userId)?.group.position.copy(position);
      }
      glideRef.current = null;
      flightRef.current = null;
      eyeRef.current.copy(framing.eye);
      lookRef.current.copy(framing.look);
      onBeansMoving(false);
      onCameraMoving(false);
      return;
    }

    glideRef.current = { from, to, start: performance.now() };
    onBeansMoving(true);
    flightRef.current = {
      fromEye: eyeRef.current.clone(),
      fromLook: lookRef.current.clone(),
      toEye: framing.eye,
      toLook: framing.look,
      start: performance.now(),
      duration: jumpedRef.current ? CAMERA_FLIGHT_MS : BEAN_GLIDE_MS,
    };
    if (jumpedRef.current) onCameraMoving(true);
  }, [beans, flightKey, reducedMotion, onBeansMoving, onCameraMoving]);

  return (
    <canvas ref={canvasRef} className="replay-canvas" role="img" aria-label="3D photo-finish view" />
  );
}
