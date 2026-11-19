import { defaultLayer, STARTER_SHADER } from '../layers.js';
import { sha256Hex } from '../crypto.js';

export interface SetSummary {
  id: string;
  name: string;
  role: string;
  bpm: number;
  head: number;
  live_number: number | null;
}

export interface LayerDoc {
  id: string;
  parent_id: string | null;
  index: number;
  name: string;
  kind: 'group' | 'cube' | 'sphere' | 'plane' | 'torus' | 'tube' | 'camera' | 'light' | 'model' | 'shader';
  version: number;
  visible: boolean;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  props: Record<string, number>;
  material: { tint: [number, number, number]; tint_alpha: number; albedo_texture_id: string | null; emissive_texture_id: string | null } | null;
  model_asset_id: string | null;
  output_buses: string[];
  shader_version: number | null;
}

export interface SetDocument {
  set: {
    id: string;
    name: string;
    bpm: number;
    head: number;
    settings_version: number;
    graph_version: number;
    active_camera_id: string | null;
    show_token: string;
    role?: string;
  };
  layers: LayerDoc[];
  keys: { layer_id: string; property: string; tick: number; value: number }[];
  graph: { version: number; nodes: { node_id: string; type: string; params: Record<string, unknown>; x: number; y: number }[]; wires: { wire_id: string; from: { node_id: string; port: string }; to: { node_id: string; port: string } }[] };
  scripts: { id: string; name: string; version: number; source: string; asset_ids: string[] }[];
}

export const sha256Starter = sha256Hex(Buffer.from(STARTER_SHADER, 'utf8'));
export { defaultLayer };
