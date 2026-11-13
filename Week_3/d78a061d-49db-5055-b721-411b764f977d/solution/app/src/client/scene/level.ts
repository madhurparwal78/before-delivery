import {
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import { checkpointRing, COBALT, inked, PAPER } from './hero.js';
import { CHECKPOINT, GATE, GROUND_LIMIT, PUDDLE } from '../../shared/constants.js';

/** An ink mote: a small cobalt droplet with its graphite outline. */
export function inkMote(): Mesh {
  const mote = inked(new OctahedronGeometry(0.28, 1), COBALT);
  mote.position.y = 0.55;
  return mote;
}

/** The chapter layout every story shares: paper ground, ink puddle, checkpoint ring and gate. */
export function levelProps(): { group: Group; ground: Mesh } {
  const group = new Group();
  // Unlit paper with a pencilled metre grid, so the ground reads as the sketchbook page.
  const ground = new Mesh(
    new PlaneGeometry(GROUND_LIMIT * 2, GROUND_LIMIT * 2),
    new MeshBasicMaterial({ color: PAPER }),
  );
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const grid = new GridHelper(GROUND_LIMIT * 2, GROUND_LIMIT * 2, 0x1d1d1f, 0x1d1d1f);
  grid.position.y = 0.005;
  for (const material of [grid.material].flat()) {
    material.transparent = true;
    material.opacity = 0.12;
  }
  group.add(grid);

  const puddle = new Mesh(new CircleGeometry(PUDDLE.radius, 40), new MeshBasicMaterial({ color: 0x2a2f4a }));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(PUDDLE.x, 0.01, PUDDLE.z);
  group.add(puddle);
  // Flat props get their graphite outline as a pencilled rim.
  const rim = new Mesh(new RingGeometry(PUDDLE.radius, PUDDLE.radius + 0.08, 48), new MeshBasicMaterial({ color: 0x1d1d1f }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(PUDDLE.x, 0.012, PUDDLE.z);
  group.add(rim);

  const ring = checkpointRing();
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(CHECKPOINT.x, 0.02, CHECKPOINT.z);
  group.add(ring);

  const gate = new Group();
  for (const side of [-1, 1]) {
    const post = inked(new CylinderGeometry(0.14, 0.17, 2.6, 10), PAPER, 0.03);
    post.position.set(side * 1.3, 1.3, 0);
    gate.add(post);
  }
  const lintel = inked(new BoxGeometry(3.2, 0.3, 0.32), PAPER, 0.03);
  lintel.position.y = 2.65;
  gate.add(lintel);
  gate.position.set(GATE.x, 0, GATE.z);
  group.add(gate);

  return { group, ground };
}
