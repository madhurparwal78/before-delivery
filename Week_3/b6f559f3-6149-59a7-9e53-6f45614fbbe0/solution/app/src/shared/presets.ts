import { extrusionMesh, primitiveMesh, type Mesh } from './geometry';
import { summariseModel, type ParsedModel } from './gltf';
import type { ModelNode, ModelPreset, OutlinePoint } from './types';

const node = (name: string, mesh: number, translation: [number, number, number], scale: [number, number, number]): ModelNode => ({
  name,
  parent: null,
  translation,
  rotation: [0, 0, 0, 1],
  scale,
  mesh,
});

function pebble(): ParsedModel {
  const meshes = [primitiveMesh('Sphere')];
  return { summary: summariseModel([node('Pebble', 0, [0, 0, 0], [1.1, 0.7, 0.85])], meshes, []), meshes };
}

function arch(): ParsedModel {
  const outline: OutlinePoint[] = [[0.6, -0.5]];
  for (let i = 0; i <= 16; i++) outline.push([0.6 * Math.cos((i / 16) * Math.PI), 0.6 * Math.sin((i / 16) * Math.PI)]);
  outline.push([-0.6, -0.5], [-0.3, -0.5]);
  for (let i = 16; i >= 0; i--) outline.push([0.3 * Math.cos((i / 16) * Math.PI), 0.3 * Math.sin((i / 16) * Math.PI)]);
  outline.push([0.3, -0.5]);
  const meshes = [extrusionMesh({ outlines: [outline], depth: 0.4, bevelSize: 0, bevelSegments: 1 })];
  return { summary: summariseModel([node('Arch', 0, [0, 0, 0], [1, 1, 1])], meshes, []), meshes };
}

function lattice(): ParsedModel {
  const meshes: Mesh[] = [primitiveMesh('Cube')];
  const nodes: ModelNode[] = [];
  const beam = 0.06;
  for (const a of [-0.5, 0.5]) {
    for (const b of [-0.5, 0.5]) {
      nodes.push(node(`Beam x ${nodes.length}`, 0, [0, a, b], [1, beam, beam]));
      nodes.push(node(`Beam y ${nodes.length}`, 0, [a, 0, b], [beam, 1, beam]));
      nodes.push(node(`Beam z ${nodes.length}`, 0, [a, b, 0], [beam, beam, 1]));
    }
  }
  return { summary: summariseModel(nodes, meshes, []), meshes };
}

const cache = new Map<ModelPreset, ParsedModel>();

/** The preset models Pebble, Arch and Lattice, generated in code. */
export function presetModel(preset: ModelPreset): ParsedModel {
  let model = cache.get(preset);
  if (!model) {
    model = { Pebble: pebble, Arch: arch, Lattice: lattice }[preset]();
    cache.set(preset, model);
  }
  return model;
}
