import { radians } from '../../shared/dmath.js';
import type { SceneDocument, SceneObject } from '../../shared/scene.js';
import type { Body } from '../../shared/sim.js';
import { compose, identity, quaternionMatrix, rotationZ, type Box, type Vec3 } from './math.js';
import type { DrawItem } from './renderer.js';

const COLOURS = {
  ramp: [0.58, 0.44, 0.3],
  cart: [0.9, 0.58, 0.42],
  frame: [0.48, 0.5, 0.62],
  rod: [0.72, 0.74, 0.84],
  bob: [0.78, 0.72, 0.96],
  base: [0.45, 0.5, 0.63],
  barrel: [0.6, 0.66, 0.78],
  ball: [0.96, 0.82, 0.5],
  crate: [0.82, 0.66, 0.42],
  model: [0.76, 0.76, 0.88],
  collider: [0.99, 0.7, 0.78],
  selected: [0.62, 0.71, 1],
} as const;

function tint(colour: readonly number[], selected: boolean): [number, number, number] {
  if (!selected) return [colour[0], colour[1], colour[2]];
  return [
    colour[0] * 0.45 + COLOURS.selected[0] * 0.55,
    colour[1] * 0.45 + COLOURS.selected[1] * 0.55,
    colour[2] * 0.45 + COLOURS.selected[2] * 0.55,
  ];
}

export interface SceneVisualOptions {
  selectedId: string | null;
  hiddenIds: ReadonlySet<string>;
  colliders: boolean;
  /** Each model asset's measured size in metres. */
  extents: ReadonlyMap<string, number>;
  bodies: ReadonlyMap<string, Body>;
}

export interface SceneVisual {
  items: DrawItem[];
  boxes: { objectId: string; box: Box }[];
}

function bodyPosition(object: SceneObject, options: SceneVisualOptions): Vec3 {
  const body = options.bodies.get(object.id);
  if (!body) return [...object.position] as Vec3;
  return [body.position[0], body.position[1], body.position[2]];
}

function boxAround(centre: Vec3, size: Vec3): Box {
  return {
    min: [centre[0] - size[0] / 2, centre[1] - size[1] / 2, centre[2] - size[2] / 2],
    max: [centre[0] + size[0] / 2, centre[1] + size[1] / 2, centre[2] + size[2] / 2],
  };
}

/** Every object's drawing and its pick box, in metres. */
export function buildScene(
  document: SceneDocument,
  options: SceneVisualOptions,
): SceneVisual {
  const items: DrawItem[] = [];
  const boxes: { objectId: string; box: Box }[] = [];

  for (const object of document.objects) {
    const selected = options.selectedId === object.id;
    const hidden = options.hiddenIds.has(object.id);
    const rotation = quaternionMatrix(object.rotation);
    const origin = [...object.position] as Vec3;
    const moving = bodyPosition(object, options);

    if (object.kind === 'ramp') {
      const angle = radians(object.params.angle_deg);
      const length = object.params.length_m;
      const run = length * Math.cos(angle);
      const rise = length * Math.sin(angle);
      if (!hidden) {
        items.push({
          mesh: 'wedge',
          model: compose(origin, rotation, [run, rise, 1]),
          colour: tint(COLOURS.ramp, selected),
        });
        items.push({
          mesh: 'capsule',
          model: compose(
            [moving[0], moving[1] + 0.18, moving[2]],
            rotationZ(-angle),
            [0.5, 0.3, 0.3],
          ),
          colour: tint(COLOURS.cart, selected),
        });
        if (options.colliders)
          items.push({
            mesh: 'cube',
            model: compose([moving[0], moving[1] + 0.18, moving[2]], identity(), [0.52, 0.32, 0.32]),
            colour: COLOURS.collider,
          });
      }
      boxes.push({
        objectId: object.id,
        box: {
          min: [origin[0] - 0.2, origin[1] - 0.1, origin[2] - 0.6],
          max: [origin[0] + run + 0.2, origin[1] + rise + 0.4, origin[2] + 0.6],
        },
      });
      continue;
    }

    if (object.kind === 'pendulum') {
      const length = object.params.length_m;
      const bob = moving;
      const dx = bob[0] - origin[0];
      const dy = bob[1] - origin[1];
      const angle = Math.atan2(dx, -dy);
      if (!hidden) {
        items.push({
          mesh: 'cube',
          model: compose([origin[0], origin[1] / 2, origin[2]], identity(), [0.06, origin[1], 0.06]),
          colour: tint(COLOURS.frame, selected),
        });
        items.push({
          mesh: 'cube',
          model: compose([origin[0], origin[1], origin[2]], identity(), [0.5, 0.06, 0.06]),
          colour: tint(COLOURS.frame, selected),
        });
        items.push({
          mesh: 'cylinder',
          model: compose(
            [(origin[0] + bob[0]) / 2, (origin[1] + bob[1]) / 2, origin[2]],
            rotationZ(angle),
            [0.03, length, 0.03],
          ),
          colour: tint(COLOURS.rod, selected),
        });
        items.push({
          mesh: 'sphere',
          model: compose(bob, identity(), [0.26, 0.26, 0.26]),
          colour: tint(COLOURS.bob, selected),
        });
        if (options.colliders)
          items.push({
            mesh: 'cube',
            model: compose(bob, identity(), [0.28, 0.28, 0.28]),
            colour: COLOURS.collider,
          });
      }
      boxes.push({
        objectId: object.id,
        box: {
          min: [
            Math.min(origin[0], bob[0]) - 0.3,
            Math.min(origin[1], bob[1]) - 0.2,
            origin[2] - 0.3,
          ],
          max: [
            Math.max(origin[0], bob[0]) + 0.3,
            Math.max(origin[1], bob[1]) + 0.2,
            origin[2] + 0.3,
          ],
        },
      });
      continue;
    }

    if (object.kind === 'launcher') {
      const angle = radians(object.params.launch_angle_deg);
      const height = object.params.height_m;
      if (!hidden) {
        items.push({
          mesh: 'cube',
          model: compose(
            [origin[0], origin[1] + height / 2, origin[2]],
            identity(),
            [0.3, Math.max(height, 0.1), 0.3],
          ),
          colour: tint(COLOURS.base, selected),
        });
        items.push({
          mesh: 'cylinder',
          model: compose(
            [
              origin[0] + 0.3 * Math.cos(angle),
              origin[1] + height + 0.3 * Math.sin(angle),
              origin[2],
            ],
            rotationZ(angle - Math.PI / 2),
            [0.12, 0.6, 0.12],
          ),
          colour: tint(COLOURS.barrel, selected),
        });
        items.push({
          mesh: 'sphere',
          model: compose(moving, identity(), [0.16, 0.16, 0.16]),
          colour: tint(COLOURS.ball, selected),
        });
        if (options.colliders)
          items.push({
            mesh: 'cube',
            model: compose(moving, identity(), [0.18, 0.18, 0.18]),
            colour: COLOURS.collider,
          });
      }
      boxes.push({
        objectId: object.id,
        box: boxAround(
          [origin[0], origin[1] + height / 2 + 0.1, origin[2]],
          [0.8, Math.max(height, 0.3) + 0.5, 0.5],
        ),
      });
      continue;
    }

    const extent = object.kind === 'model' ? options.extents.get(object.assetId ?? '') ?? 1 : 1;
    const size: Vec3 = [
      extent * object.scale[0],
      extent * object.scale[1],
      extent * object.scale[2],
    ];
    const centre: Vec3 = [moving[0], moving[1] + size[1] / 2, moving[2]];
    if (!hidden) {
      items.push({
        mesh: 'cube',
        model: compose(centre, rotation, size),
        colour: tint(object.kind === 'model' ? COLOURS.model : COLOURS.crate, selected),
      });
      if (options.colliders)
        items.push({
          mesh: 'cube',
          model: compose(centre, rotation, [size[0] * 1.04, size[1] * 1.04, size[2] * 1.04]),
          colour: COLOURS.collider,
        });
    }
    boxes.push({ objectId: object.id, box: boxAround(centre, size) });
  }

  return { items, boxes };
}
