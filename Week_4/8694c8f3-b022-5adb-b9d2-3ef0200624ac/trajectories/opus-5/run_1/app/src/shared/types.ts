import type { LayerKind, OutputBus } from './domain.js';

export type Role = 'owner' | 'editor' | 'viewer';

export type Vec3 = [number, number, number];

export interface MaterialDoc {
  tint: Vec3;
  tint_alpha: number;
  albedo_texture_id: string | null;
  emissive_texture_id: string | null;
}

export interface LayerDoc {
  id: string;
  parent_id: string | null;
  index: number;
  name: string;
  kind: LayerKind;
  version: number;
  visible: boolean;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  props: Record<string, number>;
  material: MaterialDoc | null;
  model_asset_id: string | null;
  output_buses: OutputBus[];
  shader_version: number | null;
}

export interface KeyDoc {
  layer_id: string;
  property: string;
  tick: number;
  value: number;
}

export interface ScriptDoc {
  id: string;
  name: string;
  version: number;
  source: string;
  asset_ids: string[];
}

export interface GraphNodeDoc {
  node_id: string;
  type: string;
  params: Record<string, string | number>;
  x: number;
  y: number;
}

export interface GraphPort {
  node_id: string;
  port: string;
}

export interface GraphWireDoc {
  wire_id: string;
  from: GraphPort;
  to: GraphPort;
}

export interface GraphDoc {
  version: number;
  nodes: GraphNodeDoc[];
  wires: GraphWireDoc[];
}

export interface SetHeader {
  id: string;
  name: string;
  bpm: number;
  head: number;
  settings_version: number;
  graph_version: number;
  active_camera_id: string | null;
  show_token: string;
  role: Role;
}

export interface SetDocument {
  set: SetHeader;
  layers: LayerDoc[];
  keys: KeyDoc[];
  graph: GraphDoc;
  scripts: ScriptDoc[];
}

export interface SetSummary {
  id: string;
  name: string;
  role: Role;
  bpm: number;
  head: number;
  live_number: number | null;
}

export interface UserDoc {
  id: string;
  email: string;
  display_name: string;
}

export interface Actor {
  user_id: string;
  display_name: string;
}

export type AssetKind = 'model' | 'texture';
export type AssetStatus = 'uploading' | 'ready' | 'upload failed';

export interface Dependents {
  count: number;
  layers: { id: string; name: string }[];
  materials: { layer_id: string; name: string }[];
  scripts: { id: string; name: string }[];
}

export interface AssetDoc {
  id: string;
  name: string;
  kind: AssetKind;
  size: number;
  sha256: string;
  status: AssetStatus;
  created_at: string;
  dependents: Dependents;
}

export interface ShaderVersionSummary {
  number: number;
  sha256: string;
  size: number;
  author: Actor;
  created_at: string;
  restored_from: number | null;
}

export type ShowStatus = 'storing' | 'published' | 'store failed';

export interface ShowVersionDoc {
  number: number;
  status: ShowStatus;
  live: boolean;
  sha256: string | null;
  size: number | null;
  published_at: string | null;
  published_by: Actor;
  note: string;
}

export interface OpDoc {
  seq: number;
  client_op_id: string;
  actor: Actor;
  target: string;
  type: string;
  payload: Record<string, unknown>;
  committed_at: string;
}

export interface OpResult {
  seq: number;
  target: string;
  version: number;
  replayed: boolean;
}

export interface PresenceMember {
  user_id: string;
  display_name: string;
  colour: string;
  selection: string | null;
}

export interface LockDoc {
  layer_id: string;
  holder: Actor | null;
  expires_at: string | null;
}

export interface ActivityEntry {
  id: string;
  at: string;
  actor: Actor;
  action: string;
  target: string;
  summary: string;
}

export interface ShowBundle {
  format: string;
  set: { name: string; bpm: number; active_camera_id: string | null };
  layers: LayerDoc[];
  keys: KeyDoc[];
  graph: GraphDoc;
  shaders: { layer_id: string; version: number; source: string }[];
  scripts: ScriptDoc[];
  assets: { id: string; name: string; kind: AssetKind; size: number; sha256: string }[];
}

export interface ExportBundle extends Omit<ShowBundle, 'shaders'> {
  shaders: { layer_id: string; version: number; source: string; restored_from: number | null }[];
}
