/**
 * The product viewer. It shows a model of the selected fitting built from shapes in
 * code, turns slowly on its own, rotates under mouse or one-finger drag, and stops
 * turning on its own under reduced motion. Without WebGL it falls back to a still
 * side-view line drawing.
 */

import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  PointLight,
  Scene,
  WebGLRenderer,
} from "three";
import { buildCone, buildFitting, cctColour, shapeFor, type FittingShape } from "./fittings.js";
import { FittingDrawing } from "./FittingDrawing.js";
import { usePrefersReducedMotion } from "../state/app.js";
import type { FinishCode } from "../../shared/types.js";

/** The idle turn takes between 30 and 40 seconds for one revolution. */
const IDLE_SECONDS_PER_TURN = 34;
/** Dragging pauses the idle turn, which resumes three seconds after release. */
const IDLE_RESUME_MS = 3_000;
/** Dragging across the full canvas width turns the model half a turn. */
const DRAG_TURN_FRACTION = 0.5;

export function hasWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface ProductViewerProps {
  productName: string;
  family: string;
  slug: string;
  finish: FinishCode;
  beamDeg: number;
  cctK: number;
  ambient: number;
}

export function ProductViewer(props: ProductViewerProps) {
  const { productName, family, slug, finish, beamDeg, cctK, ambient } = props;
  const reduced = usePrefersReducedMotion();
  const [webgl] = useState(hasWebGl);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [yaw, setYaw] = useState(0);

  // The published data attributes are written from the live scene state.
  const yawRef = useRef(0);
  const idleRef = useRef(!reduced);
  const draggingRef = useRef(false);
  const resumeAtRef = useRef(0);

  const shape: FittingShape = shapeFor(family, slug);

  useEffect(() => {
    if (!webgl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    const scene = new Scene();
    const camera = new PerspectiveCamera(34, 4 / 3, 0.1, 100);
    camera.position.set(0, 1.25, 5.1);
    camera.lookAt(0, 0.35, 0);

    const ambientLight = new AmbientLight(0xffffff, ambient);
    scene.add(ambientLight);
    const key = new DirectionalLight(0xffffff, 0.75);
    key.position.set(2.4, 3.4, 2.8);
    scene.add(key);
    const lamp = new PointLight(cctColour(cctK), 1.5, 9);
    scene.add(lamp);

    const turntable = new Group();
    scene.add(turntable);

    const fitting = buildFitting(shape, finish);
    turntable.add(fitting.group);
    lamp.position.set(0, fitting.emitterY - 0.25, 0);

    const coneHeight = 2.5;
    const cone = buildCone(beamDeg, cctK, coneHeight);
    cone.mesh.position.y = fitting.emitterY - coneHeight / 2;
    turntable.add(cone.mesh);

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
    let previous = performance.now();
    let publishedYaw = -1;

    const tick = (now: number): void => {
      const delta = (now - previous) / 1000;
      previous = now;

      const idling = !draggingRef.current && !reduced && now >= resumeAtRef.current;
      idleRef.current = idling;
      if (idling) {
        yawRef.current = (yawRef.current + (360 / IDLE_SECONDS_PER_TURN) * delta) % 360;
      }

      turntable.rotation.y = (yawRef.current * Math.PI) / 180;
      renderer.render(scene, camera);

      const whole = Math.floor(((yawRef.current % 360) + 360) % 360);
      if (whole !== publishedYaw) {
        publishedYaw = whole;
        setYaw(whole);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      for (const material of fitting.materials) material.dispose();
      cone.material.dispose();
    };
  }, [webgl, shape, finish, beamDeg, cctK, ambient, reduced]);

  // Reduced motion stops the idle turn outright.
  useEffect(() => {
    if (reduced) idleRef.current = false;
  }, [reduced]);

  /**
   * A mostly sideways drag turns the model; a vertical swipe that starts on the
   * canvas still scrolls the page.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startYaw = 0;
    let decided = false;

    const onPointerDown = (event: PointerEvent): void => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startYaw = yawRef.current;
      decided = event.pointerType === "mouse";
      if (decided) {
        draggingRef.current = true;
        canvas.setPointerCapture(event.pointerId);
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        if (Math.abs(dx) <= Math.abs(dy)) {
          // A vertical swipe is a page scroll, so the viewer lets it go.
          pointerId = null;
          return;
        }
        decided = true;
        draggingRef.current = true;
        canvas.setPointerCapture(event.pointerId);
      }

      event.preventDefault();
      const width = canvas.clientWidth || 1;
      yawRef.current = startYaw + (dx / width) * 360 * DRAG_TURN_FRACTION;
      setYaw(Math.floor(((yawRef.current % 360) + 360) % 360));
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (draggingRef.current) {
        draggingRef.current = false;
        resumeAtRef.current = performance.now() + IDLE_RESUME_MS;
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove, { passive: false });
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, [webgl]);

  if (!webgl) {
    return (
      <FittingDrawing
        shape={shape}
        finish={finish}
        beamDeg={beamDeg}
        cctK={cctK}
        label={`${productName} drawing`}
        className="viewer"
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="viewer"
      role="img"
      aria-label={`${productName} 3D model`}
      data-yaw={yaw}
      data-beam={beamDeg}
      data-cct={cctK}
      data-idle={reduced ? "off" : "on"}
    />
  );
}

/** The ambient brightness each lighting state gives the 3D scenes. */
export function sceneAmbient(lightState: string): number {
  switch (lightState) {
    case "day":
      return 0.8;
    case "morning":
      return 0.62;
    case "gallery":
      return 1;
    case "evening":
      return 0.3;
    default:
      return 0.18;
  }
}
