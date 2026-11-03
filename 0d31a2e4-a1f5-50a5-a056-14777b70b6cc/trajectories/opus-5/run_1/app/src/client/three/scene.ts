import * as THREE from 'three';
import { BEAN_LIGHTNESS, BEAN_SATURATION } from '../../shared/hue.js';
import {
  type ArenaBar,
  type Course,
  type LinearCourse,
  barAngle,
  platformX,
  sweeperAngle,
} from '../../shared/sim/course.js';

const CREAM = 0xfdf3e3;
const CREAM_DEEP = 0xeddcc0;
const CREAM_PALE = 0xf7ecd8;
const INK = 0x211d44;
const PINK = 0xf4397f;
const TEAL = 0x1f8a70;
const RED = 0xcf2f3f;

const inkLine = new THREE.LineBasicMaterial({ color: INK });

function flat(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function outlined(mesh: THREE.Mesh): THREE.Group {
  const group = new THREE.Group();
  group.add(mesh);
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), inkLine));
  return group;
}

export interface BeanMesh {
  group: THREE.Group;
  body: THREE.Mesh;
  ring: THREE.Mesh;
}

/** A low-poly bean: a jelly-bean body in the player's hue with two simple eyes. */
export function createBeanMesh(hue: number): BeanMesh {
  const group = new THREE.Group();
  const bodyGeometry = new THREE.SphereGeometry(0.42, 10, 8);
  bodyGeometry.scale(1, 1.35, 1);
  const body = new THREE.Mesh(
    bodyGeometry,
    new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(
        hue / 360,
        BEAN_SATURATION,
        BEAN_LIGHTNESS,
        THREE.SRGBColorSpace,
      ),
      flatShading: true,
    }),
  );
  body.position.y = 0.56;
  group.add(body);

  const eyeGeometry = new THREE.SphereGeometry(0.11, 6, 5);
  const eyeMaterial = flat(0xffffff);
  const pupilMaterial = flat(INK);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * 0.16, 0.78, 0.33);
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 4), pupilMaterial);
    pupil.position.set(side * 0.16, 0.78, 0.41);
    group.add(pupil);
  }

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.085, 6, 20), flat(TEAL));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.5;
  ring.visible = false;
  group.add(ring);

  return { group, body, ring };
}

export function setBeanMarker(bean: BeanMesh, marker: 'last_slot' | 'first_out' | null): void {
  bean.ring.visible = marker !== null;
  if (marker === null) return;
  const material = bean.ring.material as THREE.MeshLambertMaterial;
  material.color.setHex(marker === 'last_slot' ? TEAL : RED);
}

function addLinearCourse(scene: THREE.Scene, course: LinearCourse): THREE.Object3D[] {
  const movers: THREE.Object3D[] = [];
  const depth = course.endZ - course.startZ;
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(course.halfWidth * 2, 0.6, depth),
    flat(CREAM_DEEP),
  );
  floor.position.set(0, -0.3, course.startZ + depth / 2);
  scene.add(outlined(floor));

  for (const lane of [-2.5, 0, 2.5]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, depth), flat(CREAM_PALE));
    stripe.position.set(lane, 0.015, course.startZ + depth / 2);
    scene.add(stripe);
  }

  for (const checkpoint of course.checkpoints) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(course.halfWidth * 2, 0.04, 0.5),
      flat(CREAM_PALE),
    );
    stripe.position.set(0, 0.02, checkpoint);
    scene.add(stripe);
  }

  const finish = new THREE.Mesh(
    new THREE.BoxGeometry(course.halfWidth * 2, 0.1, 0.9),
    flat(PINK),
  );
  finish.position.set(0, 0.06, course.length);
  scene.add(finish);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.26, 3.6, 0.26), flat(PINK));
    post.position.set(side * course.halfWidth, 1.8, course.length);
    scene.add(outlined(post));
  }
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(course.halfWidth * 2, 0.6, 0.14),
    flat(PINK),
  );
  banner.position.set(0, 3.3, course.length);
  scene.add(outlined(banner));

  for (const sweeper of course.sweepers) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.5, 7), flat(CREAM_PALE));
    post.position.set(sweeper.x, 0.75, sweeper.z);
    scene.add(outlined(post));
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(sweeper.arm * 2, 0.3, 0.42),
      flat(CREAM_PALE),
    );
    const pivot = new THREE.Group();
    pivot.position.set(sweeper.x, 1.1, sweeper.z);
    pivot.add(outlined(arm));
    pivot.userData = { kind: 'sweeper', sweeper };
    scene.add(pivot);
    movers.push(pivot);
  }

  for (const bumper of course.bumpers) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(bumper.radius, bumper.radius * 0.8, bumper.height, 8),
      flat(CREAM_PALE),
    );
    post.position.set(bumper.x, bumper.height / 2, bumper.z);
    scene.add(outlined(post));
  }

  for (const platform of course.platforms) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(platform.halfX * 2, platform.top, platform.halfZ * 2),
      flat(CREAM_PALE),
    );
    const holder = new THREE.Group();
    holder.add(outlined(slab));
    slab.position.y = platform.top / 2;
    holder.position.set(0, 0, platform.z);
    holder.userData = { kind: 'platform', platform };
    scene.add(holder);
    movers.push(holder);
  }
  return movers;
}

function addArenaCourse(
  scene: THREE.Scene,
  radius: number,
  bars: readonly ArenaBar[],
): THREE.Object3D[] {
  const movers: THREE.Object3D[] = [];
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.6, 24), flat(CREAM_DEEP));
  floor.position.y = -0.3;
  scene.add(outlined(floor));
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 6, 32), flat(CREAM_PALE));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.02;
  scene.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.4, 1.2, 8), flat(CREAM_PALE));
  hub.position.y = 0.6;
  scene.add(outlined(hub));
  for (const bar of bars) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(bar.outer - bar.inner, 0.34, 0.5),
      flat(CREAM_PALE),
    );
    arm.position.x = (bar.outer + bar.inner) / 2;
    const pivot = new THREE.Group();
    pivot.position.y = 0.9;
    pivot.add(outlined(arm));
    pivot.userData = { kind: 'bar', bar };
    scene.add(pivot);
    movers.push(pivot);
  }
  return movers;
}

export interface CourseScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  course: Course;
  setTickMotion(tick: number): void;
  resize(width: number, height: number): void;
  render(): void;
  dispose(): void;
}

export function createCourseScene(canvas: HTMLCanvasElement, course: Course): CourseScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CREAM);
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, CREAM_DEEP, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(8, 16, -10);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 1.1);
  fill.position.set(-10, 8, 14);
  scene.add(fill);

  const movers =
    course.shape === 'linear'
      ? addLinearCourse(scene, course)
      : addArenaCourse(scene, course.radius, course.bars);

  return {
    scene,
    camera,
    renderer,
    course,
    setTickMotion(tick: number): void {
      for (const mover of movers) {
        const data = mover.userData as {
          kind: string;
          sweeper?: Parameters<typeof sweeperAngle>[0];
          platform?: Parameters<typeof platformX>[0];
          bar?: Parameters<typeof barAngle>[0];
        };
        if (data.kind === 'sweeper' && data.sweeper) {
          mover.rotation.y = -sweeperAngle(data.sweeper, tick);
        } else if (data.kind === 'platform' && data.platform) {
          mover.position.x = platformX(data.platform, tick);
        } else if (data.kind === 'bar' && data.bar) {
          mover.rotation.y = -barAngle(data.bar, tick);
        }
      }
    },
    resize(width: number, height: number): void {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    render(): void {
      renderer.render(scene, camera);
    },
    dispose(): void {
      renderer.dispose();
    },
  };
}

/** The follow framing used live and as the replay's resting pose. */
export function followFraming(
  course: Course,
  position: THREE.Vector3,
): { eye: THREE.Vector3; look: THREE.Vector3 } {
  if (course.shape === 'arena') {
    return {
      eye: new THREE.Vector3(position.x * 0.45, position.y + 9, position.z * 0.45 - 13),
      look: new THREE.Vector3(position.x * 0.5, 0.8, position.z * 0.5),
    };
  }
  return {
    eye: new THREE.Vector3(position.x * 0.8, position.y + 4.2, position.z - 8),
    look: new THREE.Vector3(position.x * 0.8, position.y + 1.1, position.z + 6),
  };
}

/** The resting overview that frames the whole course and its finish line. */
export function overviewFraming(course: Course): {
  eye: THREE.Vector3;
  look: THREE.Vector3;
} {
  if (course.shape === 'arena') {
    return {
      eye: new THREE.Vector3(0, 26, -26),
      look: new THREE.Vector3(0, 0, 0),
    };
  }
  return {
    eye: new THREE.Vector3(0, course.length * 0.38 + 14, -24),
    look: new THREE.Vector3(0, 0, course.length * 0.55),
  };
}

/** The replay framing: the leading bean with the finish line behind it. */
export function replayFraming(
  course: Course,
  leader: THREE.Vector3,
): { eye: THREE.Vector3; look: THREE.Vector3 } {
  if (course.shape === 'arena') {
    return {
      eye: new THREE.Vector3(leader.x * 0.35 + 5, 13, leader.z * 0.35 - 17),
      look: new THREE.Vector3(leader.x * 0.3, 0.5, leader.z * 0.3),
    };
  }
  const finishZ = course.length;
  const framed = Math.min(finishZ, Math.max(leader.z, 6));
  const centre = Math.max(-2, Math.min(2, leader.x));
  return {
    eye: new THREE.Vector3(centre + 2.1, 2.1, framed + 4.6),
    look: new THREE.Vector3(centre - 0.2, 0.8, framed - 1),
  };
}
