import { defaultBuses, defaultMaterial, defaultProps } from '../shared/defaults.js';
import type { LayerKind, OutputBus } from '../shared/domain.js';
import type {
  GraphNodeDoc,
  GraphWireDoc,
  KeyDoc,
  LayerDoc,
  ScriptDoc,
  SetDocument,
  Vec3,
} from '../shared/types.js';

export interface AppliedOp {
  target: string;
  type: string;
  payload: Record<string, unknown>;
}

export function children(doc: SetDocument, parentId: string | null): LayerDoc[] {
  return doc.layers.filter((layer) => layer.parent_id === parentId).sort((a, b) => a.index - b.index);
}

export function treeRows(doc: SetDocument): LayerDoc[] {
  const ordered: LayerDoc[] = [];
  const walk = (parentId: string | null): void => {
    for (const layer of children(doc, parentId)) {
      ordered.push(layer);
      walk(layer.id);
    }
  };
  walk(null);
  return ordered;
}

export function descendants(doc: SetDocument, layerId: string): string[] {
  const found: string[] = [];
  const walk = (id: string): void => {
    for (const child of children(doc, id)) {
      found.push(child.id);
      walk(child.id);
    }
  };
  walk(layerId);
  return found;
}

export function findLayer(doc: SetDocument | null, layerId: string | null): LayerDoc | null {
  if (doc === null || layerId === null) return null;
  return doc.layers.find((layer) => layer.id === layerId) ?? null;
}

/** A live preview changes the drawn stage without committing an op. */
export function previewPath(doc: SetDocument, layerId: string, path: string, value: unknown): SetDocument {
  return {
    ...doc,
    layers: doc.layers.map((layer) => (layer.id === layerId ? writePath(layer, path, value) : layer)),
  };
}

export function hasChildren(doc: SetDocument, layerId: string): boolean {
  return doc.layers.some((layer) => layer.parent_id === layerId);
}

/** Reads a settable or keyable numeric path from a layer. */
export function readPath(layer: LayerDoc, path: string): number {
  if (path.startsWith('position.') || path.startsWith('rotation.') || path.startsWith('scale.')) {
    const [group, axis] = path.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    return layer[group][index];
  }
  if (path.startsWith('props.')) return layer.props[path.slice('props.'.length)] ?? 0;
  if (path === 'material.tint_alpha') return layer.material?.tint_alpha ?? 1;
  return 0;
}

function writePath(layer: LayerDoc, path: string, value: unknown): LayerDoc {
  const next: LayerDoc = { ...layer };
  if (path === 'name' && typeof value === 'string') next.name = value;
  else if (path === 'visible' && typeof value === 'boolean') next.visible = value;
  else if ((path === 'position' || path === 'rotation' || path === 'scale') && Array.isArray(value)) {
    next[path] = [Number(value[0]), Number(value[1]), Number(value[2])] as Vec3;
  } else if (/^(position|rotation|scale)\.[xyz]$/.test(path)) {
    const [group, axis] = path.split('.') as ['position' | 'rotation' | 'scale', 'x' | 'y' | 'z'];
    const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
    const copy = [...layer[group]] as Vec3;
    copy[index] = Number(value);
    next[group] = copy;
  } else if (path.startsWith('props.')) {
    next.props = { ...layer.props, [path.slice('props.'.length)]: Number(value) };
  } else if (path === 'material.tint' && layer.material !== null && Array.isArray(value)) {
    next.material = { ...layer.material, tint: [Number(value[0]), Number(value[1]), Number(value[2])] };
  } else if (path === 'material.tint_alpha' && layer.material !== null) {
    next.material = { ...layer.material, tint_alpha: Number(value) };
  } else if (path === 'material.albedo_texture_id' && layer.material !== null) {
    next.material = { ...layer.material, albedo_texture_id: value === null ? null : String(value) };
  } else if (path === 'material.emissive_texture_id' && layer.material !== null) {
    next.material = { ...layer.material, emissive_texture_id: value === null ? null : String(value) };
  } else if (path === 'model_asset_id') {
    next.model_asset_id = value === null ? null : String(value);
  } else if (path === 'output_buses' && Array.isArray(value)) {
    next.output_buses = value.map((bus) => String(bus) as OutputBus);
  }
  return next;
}

function reindex(layers: LayerDoc[], parentId: string | null): LayerDoc[] {
  const siblings = layers
    .filter((layer) => layer.parent_id === parentId)
    .sort((a, b) => a.index - b.index);
  const order = new Map(siblings.map((layer, index) => [layer.id, index]));
  return layers.map((layer) => (order.has(layer.id) ? { ...layer, index: order.get(layer.id) ?? 0 } : layer));
}

function insertAt(layers: LayerDoc[], layer: LayerDoc): LayerDoc[] {
  const shifted = layers.map((other) =>
    other.parent_id === layer.parent_id && other.index >= layer.index
      ? { ...other, index: other.index + 1 }
      : other,
  );
  return reindex([...shifted, layer], layer.parent_id);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Applies one committed op to the document, the same way the server did. */
export function applyOpToDocument(doc: SetDocument, op: AppliedOp): SetDocument {
  const payload = op.payload;
  switch (op.type) {
    case 'layer.add': {
      const kind = text(payload['kind'], 'group') as LayerKind;
      const layer: LayerDoc = {
        id: op.target,
        parent_id: payload['parent_id'] === null ? null : text(payload['parent_id']),
        index: num(payload['index']),
        name: text(payload['name'], 'Layer'),
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
      };
      const next = { ...doc, layers: insertAt(doc.layers, layer) };
      if (kind === 'camera' && next.set.active_camera_id === null) {
        next.set = { ...next.set, active_camera_id: layer.id };
      }
      return next;
    }
    case 'layer.set': {
      return {
        ...doc,
        layers: doc.layers.map((layer) =>
          layer.id === op.target
            ? { ...writePath(layer, text(payload['path']), payload['value']), version: layer.version + 1 }
            : layer,
        ),
      };
    }
    case 'layer.reparent': {
      const moving = findLayer(doc, op.target);
      if (moving === null) return doc;
      const parentId = payload['parent_id'] === null ? null : text(payload['parent_id']);
      const index = num(payload['index']);
      const without = reindex(
        doc.layers.filter((layer) => layer.id !== moving.id),
        moving.parent_id,
      );
      const moved: LayerDoc = { ...moving, parent_id: parentId, index, version: moving.version + 1 };
      return { ...doc, layers: insertAt(without, moved) };
    }
    case 'layer.remove': {
      const removing = findLayer(doc, op.target);
      if (removing === null) return doc;
      const removed = new Set([removing.id, ...descendants(doc, removing.id)]);
      const layers = reindex(
        doc.layers.filter((layer) => !removed.has(layer.id)),
        removing.parent_id,
      );
      const nodes = doc.graph.nodes.filter(
        (node) => !(node.type === 'Layer property' && removed.has(String(node.params['layer_id']))),
      );
      const nodeIds = new Set(nodes.map((node) => node.node_id));
      const activeCamera = doc.set.active_camera_id;
      const nextCamera =
        activeCamera !== null && removed.has(activeCamera)
          ? layers.find((layer) => layer.kind === 'camera')?.id ?? null
          : activeCamera;
      return {
        ...doc,
        set: { ...doc.set, active_camera_id: nextCamera },
        layers,
        keys: doc.keys.filter((key) => !removed.has(key.layer_id)),
        graph: {
          ...doc.graph,
          nodes,
          wires: doc.graph.wires.filter(
            (wire) => nodeIds.has(wire.from.node_id) && nodeIds.has(wire.to.node_id),
          ),
        },
      };
    }
    case 'shader.save':
    case 'shader.restore': {
      return {
        ...doc,
        layers: doc.layers.map((layer) =>
          layer.id === op.target
            ? {
                ...layer,
                version: layer.version + 1,
                shader_version: (layer.shader_version ?? 0) + 1,
              }
            : layer,
        ),
      };
    }
    case 'key.set': {
      const key: KeyDoc = {
        layer_id: op.target,
        property: text(payload['property']),
        tick: num(payload['tick']),
        value: num(payload['value']),
      };
      const kept = doc.keys.filter(
        (existing) =>
          !(
            existing.layer_id === key.layer_id &&
            existing.property === key.property &&
            existing.tick === key.tick
          ),
      );
      return {
        ...doc,
        keys: [...kept, key],
        layers: doc.layers.map((layer) =>
          layer.id === op.target ? { ...layer, version: layer.version + 1 } : layer,
        ),
      };
    }
    case 'key.remove': {
      return {
        ...doc,
        keys: doc.keys.filter(
          (existing) =>
            !(
              existing.layer_id === op.target &&
              existing.property === text(payload['property']) &&
              existing.tick === num(payload['tick'])
            ),
        ),
        layers: doc.layers.map((layer) =>
          layer.id === op.target ? { ...layer, version: layer.version + 1 } : layer,
        ),
      };
    }
    case 'set.update': {
      const set = { ...doc.set, settings_version: doc.set.settings_version + 1 };
      if (typeof payload['name'] === 'string') set.name = payload['name'];
      if (typeof payload['bpm'] === 'number') set.bpm = payload['bpm'];
      if ('active_camera_id' in payload) {
        set.active_camera_id = payload['active_camera_id'] === null ? null : text(payload['active_camera_id']);
      }
      return { ...doc, set };
    }
    case 'graph.node.add': {
      const node: GraphNodeDoc = {
        node_id: text(payload['node_id']),
        type: text(payload['type']),
        params: (payload['params'] as Record<string, string | number>) ?? {},
        x: num(payload['x']),
        y: num(payload['y']),
      };
      return bumpGraph({ ...doc, graph: { ...doc.graph, nodes: [...doc.graph.nodes, node] } });
    }
    case 'graph.node.update': {
      const nodeId = text(payload['node_id']);
      return bumpGraph({
        ...doc,
        graph: {
          ...doc.graph,
          nodes: doc.graph.nodes.map((node) =>
            node.node_id === nodeId
              ? {
                  ...node,
                  params:
                    'params' in payload
                      ? ((payload['params'] as Record<string, string | number>) ?? {})
                      : node.params,
                  x: 'x' in payload ? num(payload['x']) : node.x,
                  y: 'y' in payload ? num(payload['y']) : node.y,
                }
              : node,
          ),
        },
      });
    }
    case 'graph.node.remove': {
      const nodeId = text(payload['node_id']);
      return bumpGraph({
        ...doc,
        graph: {
          ...doc.graph,
          nodes: doc.graph.nodes.filter((node) => node.node_id !== nodeId),
          wires: doc.graph.wires.filter(
            (wire) => wire.from.node_id !== nodeId && wire.to.node_id !== nodeId,
          ),
        },
      });
    }
    case 'graph.wire.add': {
      const wire = {
        wire_id: text(payload['wire_id']),
        from: payload['from'],
        to: payload['to'],
      } as GraphWireDoc;
      return bumpGraph({ ...doc, graph: { ...doc.graph, wires: [...doc.graph.wires, wire] } });
    }
    case 'graph.wire.remove': {
      const wireId = text(payload['wire_id']);
      return bumpGraph({
        ...doc,
        graph: { ...doc.graph, wires: doc.graph.wires.filter((wire) => wire.wire_id !== wireId) },
      });
    }
    case 'script.add': {
      const script: ScriptDoc = {
        id: op.target,
        name: text(payload['name'], 'Script'),
        version: 1,
        source: text(payload['source']),
        asset_ids: [],
      };
      return { ...doc, scripts: [...doc.scripts, script] };
    }
    case 'script.save': {
      return {
        ...doc,
        scripts: doc.scripts.map((script) =>
          script.id === op.target
            ? {
                ...script,
                source: text(payload['source']),
                asset_ids: Array.isArray(payload['asset_ids'])
                  ? payload['asset_ids'].map((id) => String(id))
                  : script.asset_ids,
                version: script.version + 1,
              }
            : script,
        ),
      };
    }
    case 'script.remove': {
      return { ...doc, scripts: doc.scripts.filter((script) => script.id !== op.target) };
    }
    default:
      return doc;
  }
}

function bumpGraph(doc: SetDocument): SetDocument {
  return { ...doc, graph: { ...doc.graph, version: doc.graph.version + 1 } };
}

