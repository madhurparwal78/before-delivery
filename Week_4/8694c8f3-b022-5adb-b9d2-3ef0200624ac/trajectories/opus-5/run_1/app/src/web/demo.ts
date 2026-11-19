import { defaultBuses, defaultMaterial, defaultProps } from '../shared/defaults.js';
import type { LayerKind } from '../shared/domain.js';
import type { LayerDoc, SetDocument, Vec3 } from '../shared/types.js';

/** The 'Low Tide Tunnel' demo set, built in the browser and never stored. */

const TUNNEL_BANDS = `#version 300 es
precision highp float;
uniform float u_beat;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 centred = uv * 2.0 - 1.0;
  float radius = length(centred) + 0.0001;
  float ring = fract(1.6 / radius - u_beat);
  float band = smoothstep(0.42, 0.5, ring) * smoothstep(0.98, 0.72, ring);
  vec3 deep = vec3(0.02, 0.07, 0.11);
  vec3 tide = vec3(0.16, 0.52, 0.62);
  fragColor = vec4(deep + tide * band, 1.0);
}
`;

let counter = 0;

function layer(
  name: string,
  kind: LayerKind,
  parentId: string | null,
  index: number,
  extra: Partial<LayerDoc> = {},
): LayerDoc {
  counter += 1;
  return {
    id: `demo-${counter}`,
    parent_id: parentId,
    index,
    name,
    kind,
    version: 1,
    visible: true,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    props: defaultProps(kind),
    material: defaultMaterial(kind),
    model_asset_id: null,
    output_buses: defaultBuses(kind),
    shader_version: kind === 'shader' ? 1 : null,
    ...extra,
  };
}

export function buildDemoSet(): { doc: SetDocument; shaderSources: Map<string, string> } {
  counter = 0;
  const tunnel = layer('Tunnel', 'tube', null, 0, {
    props: { twist: 0.35, radius: 2 },
    rotation: [90, 0, 0],
    scale: [1, 4, 1],
  });
  const bands = layer('Tunnel bands', 'shader', tunnel.id, 0);
  const field = layer('Cube field', 'group', null, 1);
  const cubes: LayerDoc[] = [];
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2;
    const position: Vec3 = [Math.cos(angle) * 4.5, Math.sin(angle * 2) * 1.2, Math.sin(angle) * 4.5];
    cubes.push(
      layer(`Cube ${index + 1}`, 'cube', field.id, index, {
        position,
        scale: [0.5, 0.5, 0.5],
        rotation: [0, (angle * 180) / Math.PI, 0],
      }),
    );
  }
  const camera = layer('Demo camera', 'camera', null, 2, {
    position: [0, 1.5, 9],
    props: { fov: 60, near: 0.1, far: 200 },
  });
  const light = layer('Booth light', 'light', null, 3, { position: [4, 6, 4] });

  const doc: SetDocument = {
    set: {
      id: 'demo',
      name: 'Low Tide Tunnel',
      bpm: 120,
      head: 0,
      settings_version: 1,
      graph_version: 1,
      active_camera_id: camera.id,
      show_token: 'demo',
      role: 'owner',
    },
    layers: [tunnel, bands, field, ...cubes, camera, light],
    keys: [],
    graph: {
      version: 1,
      nodes: [
        { node_id: 'demo-beat', type: 'Beat clock', params: {}, x: 24, y: 24 },
        {
          node_id: 'demo-spin',
          type: 'Remap',
          params: { in_min: 0, in_max: 1, out_min: 0, out_max: 45 },
          x: 160,
          y: 24,
        },
        {
          node_id: 'demo-field',
          type: 'Layer property',
          params: { layer_id: field.id, property: 'rotation.y' },
          x: 300,
          y: 24,
        },
      ],
      wires: [
        {
          wire_id: 'demo-wire-1',
          from: { node_id: 'demo-beat', port: 'beat' },
          to: { node_id: 'demo-spin', port: 'in' },
        },
        {
          wire_id: 'demo-wire-2',
          from: { node_id: 'demo-spin', port: 'out' },
          to: { node_id: 'demo-field', port: 'value' },
        },
      ],
    },
    scripts: [],
  };
  return { doc, shaderSources: new Map([[bands.id, TUNNEL_BANDS]]) };
}
