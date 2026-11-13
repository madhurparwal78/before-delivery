/** The built-in demo scenes the landing page draws with the stage renderer (generated in code, no files). */
import { completeDocument, type LayerDraft } from '../../../shared/document';
import type { JsonObject, Seeds } from '../../../shared/types';
import type { SceneDocument } from '../../../shared/types';

const SEEDS: Seeds = { particle: 7, cloth: 3, grain: 11 };

const solid = (id: string, name: string, kind: LayerDraft['kind'], order: number, props: JsonObject): LayerDraft => ({
  id,
  name,
  kind,
  order,
  parentId: null,
  props,
});

const pose = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): JsonObject => ({
  position: { x, y, z },
  rotation: { x: rx, y: ry, z: rz },
});

function demo(name: string, layers: LayerDraft[]): SceneDocument {
  return completeDocument({ name, scenes: [{ id: `${name}-main`, name: 'Main', background: '#0B0B0E', durationMs: 5000, layers }] }, SEEDS);
}

/** The extruded numeral of the version export card. */
export const numeralScene = (version: number): SceneDocument =>
  demo('numeral', [
    solid('numeral', 'Numeral', 'Extrusion', 0, {
      source: 'text',
      text: String(version),
      letterHeight: 6.4,
      depth: 1.2,
      bevelSize: 0.06,
      bevelSegments: 2,
      ...pose(0, 0, 0, -10, 24, 0),
      material: { kind: 'Matcap', matcap: 'Chrome' },
    }),
  ]);

/** The cube of the variables demo: spin turns it, boost scales it, tint colours it. */
export const cubeScene = (spin: number, boost: number, tint: string): SceneDocument =>
  demo('variables-cube', [
    solid('cube', 'Cube', 'Primitive', 0, {
      primitive: 'Cube',
      ...pose(0, 0, 0, -18, spin, 0),
      scale: { x: 2.4 * (0.6 + boost / 160), y: 2.4 * (0.6 + boost / 160), z: 2.4 * (0.6 + boost / 160) },
      material: { kind: 'Matcap', matcap: 'Clay', color: tint },
    }),
  ]);


export const MOSAIC_SCENES: { name: string; document: SceneDocument }[] = [
  {
    name: 'Ring and orb',
    document: demo('ring', [
      solid('ring', 'Ring', 'Primitive', 0, { primitive: 'Torus', ...pose(0, 0, 0, 62, 18, 0), scale: { x: 3.4, y: 3.4, z: 3.4 }, material: { kind: 'Matcap', matcap: 'Chrome' } }),
      solid('orb', 'Orb', 'Primitive', 1, { primitive: 'Sphere', ...pose(0, 0, 0), scale: { x: 1.6, y: 1.6, z: 1.6 }, material: { kind: 'Glass' } }),
    ]),
  },
  {
    name: 'Spark field',
    document: demo('sparks', [
      solid('spark', 'Sparks', 'Particles', 0, { mode: 'emit', rate: 90, speed: 3, gravity: 2, lifetime: 2.5, ...pose(0, -2, 0), material: { kind: 'Matcap', matcap: 'Ember' } }),
      solid('block', 'Block', 'Primitive', 1, { primitive: 'Cube', ...pose(0, -1, 0, 24, 36, 0), scale: { x: 2, y: 2, z: 2 }, material: { kind: 'Matcap', matcap: 'Jade' } }),
    ]),
  },
  {
    name: 'Banner and pillar',
    document: demo('banner', [
      solid('banner', 'Banner', 'Cloth', 0, { columns: 12, rows: 10, pinned: 'Top', windStrength: 3, ...pose(-1.5, 3, 0), scale: { x: 9, y: 9, z: 9 }, material: { kind: 'Matcap', matcap: 'Clay' } }),
      solid('pillar', 'Pillar', 'Primitive', 1, { primitive: 'Cylinder', ...pose(3.2, -1, 0, 0, 0, 0), scale: { x: 1.2, y: 4, z: 1.2 }, material: { kind: 'Matcap', matcap: 'Chrome' } }),
    ]),
  },
];

/** A cube, the word HALO and a cube past the far plane, evaluated by the shared evaluator for the readout panel demo. */
export const readoutScene = (): SceneDocument =>
  demo('readouts', [
    solid('cube', 'Halo cube', 'Primitive', 0, { primitive: 'Cube', ...pose(1, 2, 0, 0, 45, 0), scale: { x: 2, y: 1, z: 1 } }),
    solid('word', 'Wordmark', 'Extrusion', 1, { source: 'text', text: 'HALO', letterHeight: 1, depth: 0.2, bevelSize: 0.02, bevelSegments: 1 }),
    solid('probe', 'Far probe', 'Primitive', 2, { primitive: 'Cube', ...pose(0, 0, -100) }),
  ]);
