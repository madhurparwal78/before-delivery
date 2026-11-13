import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { hueForUserId } from '../../shared/hue.js';
import { buildCourse } from '../../shared/sim/course.js';
import type { RoundKind, TickBean } from '../../shared/types.js';
import {
  type BeanMesh,
  type CourseScene,
  createBeanMesh,
  createCourseScene,
  followFraming,
  overviewFraming,
} from './scene.js';

interface Props {
  kind: RoundKind;
  seed: number;
  starters: number[];
  beans: TickBean[];
  tick: number;
  followingUserId: number | null;
}

interface Live {
  beans: TickBean[];
  tick: number;
  following: number | null;
}

/** The live 3D course view. Every bean mesh is driven by the server's positions. */
export function MatchCanvas({ kind, seed, starters, beans, tick, followingUserId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const live = useRef<Live>({ beans, tick, following: followingUserId });
  live.current = { beans, tick, following: followingUserId };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const course = buildCourse(kind, seed);
    const view: CourseScene = createCourseScene(canvas, course);
    const meshes = new Map<number, BeanMesh>();
    for (const userId of starters) {
      const bean = createBeanMesh(hueForUserId(userId));
      meshes.set(userId, bean);
      view.scene.add(bean.group);
    }
    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    const target = new THREE.Vector3();
    let started = false;
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
      const snapshot = live.current;
      for (const bean of snapshot.beans) {
        const mesh = meshes.get(bean.userId);
        if (mesh === undefined) continue;
        target.set(bean.x, bean.y, bean.z);
        if (started) mesh.group.position.lerp(target, 0.35);
        else mesh.group.position.copy(target);
        mesh.group.visible = true;
        const material = mesh.body.material as THREE.MeshLambertMaterial;
        material.opacity = bean.state === 'eliminated' ? 0.45 : 1;
        material.transparent = bean.state === 'eliminated';
      }
      view.setTickMotion(snapshot.tick);
      const followed = snapshot.following === null ? null : meshes.get(snapshot.following);
      const framing =
        followed === undefined || followed === null
          ? overviewFraming(course)
          : followFraming(course, followed.group.position);
      if (started) {
        eye.lerp(framing.eye, 0.12);
        look.lerp(framing.look, 0.12);
      } else {
        eye.copy(framing.eye);
        look.copy(framing.look);
        started = true;
      }
      view.camera.position.copy(eye);
      view.camera.lookAt(look);
      view.render();
    };
    draw();

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      view.dispose();
    };
  }, [kind, seed, starters]);

  return <canvas ref={canvasRef} className="course-canvas" role="img" aria-label="3D course view" />;
}
