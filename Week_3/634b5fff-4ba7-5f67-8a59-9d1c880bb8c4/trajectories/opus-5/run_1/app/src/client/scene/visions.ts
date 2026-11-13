import {
  BoxGeometry,
  CapsuleGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Chapter } from '../../shared/copy.js';

const iron = new MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.7, metalness: 0.5 });
const brass = new MeshStandardMaterial({ color: 0xb98a3a, roughness: 0.35, metalness: 0.9 });
const linen = new MeshStandardMaterial({ color: 0xdfe6ef, roughness: 0.95 });
const roast = new MeshStandardMaterial({ color: 0xa5672c, roughness: 0.6 });
const needle = new MeshStandardMaterial({ color: 0x24402f, roughness: 0.9 });
const taper = new MeshStandardMaterial({ color: 0xf4c63c, roughness: 0.3, emissive: 0x6a4f06 });
const emberStar = new MeshStandardMaterial({ color: 0xfff1c0, roughness: 0.2, emissive: 0xf4c63c });
const wool = new MeshStandardMaterial({ color: 0x4a5160, roughness: 0.95 });
const skin = new MeshStandardMaterial({ color: 0xd8c3ad, roughness: 0.85 });

function stove(): Group {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(1.4, 1.6, 1), iron);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);
  const pipe = new Mesh(new CylinderGeometry(0.16, 0.16, 1.6, 16), iron);
  pipe.position.set(0, 2.55, 0);
  group.add(pipe);
  const ornament = new Mesh(new TorusGeometry(0.3, 0.06, 10, 24), brass);
  ornament.position.set(0, 1.25, 0.52);
  group.add(ornament);
  for (const x of [-0.55, 0.55]) {
    for (const z of [-0.38, 0.38]) {
      const foot = new Mesh(new CylinderGeometry(0.09, 0.12, 0.3, 12), brass);
      foot.position.set(x, 0.15, z);
      group.add(foot);
    }
  }
  return group;
}

function goose(): Group {
  const group = new Group();
  const top = new Mesh(new BoxGeometry(2.4, 0.1, 1.5), linen);
  top.position.y = 1;
  top.receiveShadow = true;
  group.add(top);
  const cloth = new Mesh(new BoxGeometry(2.5, 0.5, 1.6), linen);
  cloth.position.y = 0.78;
  group.add(cloth);
  for (const x of [-1, 1]) {
    for (const z of [-0.55, 0.55]) {
      const leg = new Mesh(new BoxGeometry(0.12, 1, 0.12), iron);
      leg.position.set(x, 0.5, z);
      group.add(leg);
    }
  }
  const dish = new Mesh(new CircleGeometry(0.6, 24), linen);
  dish.rotation.x = -Math.PI / 2;
  dish.position.set(0, 1.06, 0);
  group.add(dish);
  const bird = new Mesh(new CapsuleGeometry(0.3, 0.45, 8, 16), roast);
  bird.rotation.z = Math.PI / 2;
  bird.position.set(0, 1.3, 0);
  bird.castShadow = true;
  group.add(bird);
  const knife = new Mesh(new BoxGeometry(0.04, 0.5, 0.1), brass);
  knife.position.set(0.1, 1.6, 0);
  group.add(knife);
  const fork = new Mesh(new BoxGeometry(0.04, 0.5, 0.1), brass);
  fork.position.set(-0.1, 1.6, 0);
  group.add(fork);
  return group;
}

function tree(): Group {
  const group = new Group();
  const trunk = new Mesh(new CylinderGeometry(0.1, 0.14, 0.5, 10), roast);
  trunk.position.y = 0.25;
  group.add(trunk);
  for (let tier = 0; tier < 4; tier += 1) {
    const radius = 1.1 - tier * 0.24;
    const cone = new Mesh(new ConeGeometry(radius, 0.9, 18), needle);
    cone.position.y = 0.6 + tier * 0.62;
    cone.castShadow = true;
    group.add(cone);
  }
  for (let light = 0; light < 24; light += 1) {
    const angle = light * 1.7;
    const height = 0.6 + (light % 4) * 0.62;
    const radius = (1.1 - (light % 4) * 0.24) * 0.72;
    const bead = new Mesh(new SphereGeometry(0.05, 8, 8), taper);
    bead.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    group.add(bead);
  }
  return group;
}

function star(): Group {
  const group = new Group();
  const core = new Mesh(new SphereGeometry(0.22, 16, 16), emberStar);
  core.position.set(0, 3, 0);
  group.add(core);
  const streak = new Mesh(new CylinderGeometry(0.02, 0.12, 3.2, 8), emberStar);
  streak.position.set(0.9, 4.3, 0);
  streak.rotation.z = Math.PI / 3.2;
  group.add(streak);
  return group;
}

function grandmother(): Group {
  const group = new Group();
  const gown = new Mesh(new ConeGeometry(0.75, 2.2, 20), wool);
  gown.position.y = 1.1;
  gown.castShadow = true;
  group.add(gown);
  const shoulders = new Mesh(new SphereGeometry(0.42, 16, 16), wool);
  shoulders.position.y = 2.2;
  group.add(shoulders);
  const head = new Mesh(new SphereGeometry(0.26, 16, 16), skin);
  head.position.y = 2.68;
  group.add(head);
  const shawl = new Mesh(new TorusGeometry(0.4, 0.08, 8, 20), linen);
  shawl.rotation.x = Math.PI / 2;
  shawl.position.y = 2.32;
  group.add(shawl);
  for (const side of [-1, 1]) {
    const arm = new Mesh(new CapsuleGeometry(0.1, 0.8, 6, 10), wool);
    arm.position.set(side * 0.44, 1.85, 0.2);
    arm.rotation.z = side * 0.5;
    group.add(arm);
  }
  return group;
}

const builders: Record<Exclude<Chapter, 'alley' | 'shelf'>, () => Group> = {
  stove,
  goose,
  tree,
  star,
  grandmother,
};

/** Each chapter's vision, built from procedural geometry only. */
export function buildVision(chapter: Chapter): Group | null {
  if (chapter === 'alley' || chapter === 'shelf') return null;
  return builders[chapter]();
}
