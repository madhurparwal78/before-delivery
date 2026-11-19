import { createLayer } from "../../shared/layers.ts";
import type { LayerDoc, SetDocument } from "../../shared/types.ts";
import type { EffectiveLayer } from "../engine/evaluate.ts";

const DEMO_SET_ID = "demo";
const CUBE_COUNT = 24;
const CUBES_ID = "demo-cube-field";

const TINTS: [number, number, number][] = [[0.2, 0.85, 0.8], [0.95, 0.45, 0.4], [0.5, 0.6, 0.95], [0.95, 0.85, 0.5]];

export function demoDocument(): SetDocument {
  const tunnel = createLayer({
    id: "demo-tunnel", parent_id: null, index: 0, name: "Tunnel", kind: "tube", scale: [1, 6, 1],
    props: { twist: 0.35, radius: 2, bands: 12 },
  });
  tunnel.rotation = [90, 0, 0];
  if (tunnel.material) tunnel.material.tint = [0.55, 0.75, 0.8];
  const field = createLayer({ id: CUBES_ID, parent_id: null, index: 1, name: "Cube field", kind: "group" });
  const cubes: LayerDoc[] = Array.from({ length: CUBE_COUNT }, (_value, i) => {
    const angle = (i / CUBE_COUNT) * Math.PI * 2;
    const cube = createLayer({
      id: `demo-cube-${i + 1}`, parent_id: CUBES_ID, index: i, name: `Cube ${i + 1}`, kind: "cube",
      position: [Math.cos(angle) * 3.4, Math.sin(angle) * 3.4, ((i * 7) % 5 - 2) * 0.7], scale: [0.6, 0.6, 0.6],
    });
    if (cube.material) cube.material.tint = TINTS[i % TINTS.length] ?? [1, 1, 1];
    return cube;
  });
  const camera = createLayer({ id: "demo-camera", parent_id: null, index: 2, name: "Demo camera", kind: "camera", position: [0, 1.6, 11], props: { fov: 60 } });
  camera.rotation = [-8.3, 0, 0];
  return {
    set: {
      id: DEMO_SET_ID, name: "Low Tide Tunnel", bpm: 120, head: 0, settings_version: 1, graph_version: 1,
      active_camera_id: camera.id, show_token: "", role: "owner",
    },
    layers: [tunnel, field, ...cubes, camera],
    keys: [],
    graph: { version: 1, nodes: [], wires: [] },
    scripts: [],
  };
}

/** The cube field completes one orbit every 8 beats; the tunnel's bands advance by one ring per beat in the shader. */
export function animateDemo(beat: number, effective: Map<string, EffectiveLayer>): void {
  const field = effective.get(CUBES_ID);
  if (field) field.rotation[2] = (beat / 8) * 360;
}
