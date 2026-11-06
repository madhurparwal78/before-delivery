import { Graph, Layer, SceneNode, SceneState, Vec3 } from '../../shared/graph';
import { formatVec, shortNumber } from '../../shared/format';

export interface ChangeItem {
  key: string;
  nodeId: string | null;
  nodeName: string;
  property: string;
  oldValue: string;
  newValue: string;
}

const NONE = 'none';

function nodeById(graph: Graph, id: string): SceneNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function parentName(graph: Graph, node: SceneNode | undefined): string {
  if (!node || node.parentId === null) return NONE;
  const parent = nodeById(graph, node.parentId);
  return parent ? parent.name : NONE;
}

function layerValue(layer: Layer | undefined, field: 'type' | 'color' | 'roughness' | 'metalness'): string {
  if (!layer) return NONE;
  if (field === 'type') return layer.type;
  if (field === 'color') return formatVec(layer.color);
  return shortNumber(layer[field]);
}

function overrideValue(state: SceneState | undefined, nodeId: string, field: string): string {
  if (!state) return NONE;
  const override = state.overrides.find(
    (candidate) => candidate.nodeId === nodeId && candidate.field === field,
  );
  if (!override) return NONE;
  return typeof override.value === 'boolean' ? String(override.value) : formatVec(override.value as Vec3);
}

function byCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Lists each property that differs between two graphs, in the brief's order. */
export function graphChanges(previous: Graph, next: Graph): ChangeItem[] {
  const items: ChangeItem[] = [];
  const nodeIds = [
    ...new Set([...previous.nodes.map((node) => node.id), ...next.nodes.map((node) => node.id)]),
  ].sort(byCodePoint);

  for (const nodeId of nodeIds) {
    const before = nodeById(previous, nodeId);
    const after = nodeById(next, nodeId);
    const name = (after ?? before)?.name ?? nodeId;
    if (!before || !after) {
      items.push({
        key: `${nodeId}:node`,
        nodeId,
        nodeName: name,
        property: 'node',
        oldValue: before ? 'present' : NONE,
        newValue: after ? 'present' : NONE,
      });
      continue;
    }
    if (before.name !== after.name) {
      items.push({
        key: `${nodeId}:name`,
        nodeId,
        nodeName: name,
        property: 'name',
        oldValue: before.name,
        newValue: after.name,
      });
    }
    const beforeParent = parentName(previous, before);
    const afterParent = parentName(next, after);
    if (beforeParent !== afterParent) {
      items.push({
        key: `${nodeId}:parent`,
        nodeId,
        nodeName: name,
        property: 'parent',
        oldValue: beforeParent,
        newValue: afterParent,
      });
    }
    for (const field of ['position', 'rotation', 'scale'] as const) {
      const oldValue = formatVec(before[field]);
      const newValue = formatVec(after[field]);
      if (oldValue !== newValue) {
        items.push({ key: `${nodeId}:${field}`, nodeId, nodeName: name, property: field, oldValue, newValue });
      }
    }
    if (before.visible !== after.visible) {
      items.push({
        key: `${nodeId}:visible`,
        nodeId,
        nodeName: name,
        property: 'visible',
        oldValue: String(before.visible),
        newValue: String(after.visible),
      });
    }
    const layerIds = [
      ...new Set([
        ...after.materialLayers.map((layer) => layer.id),
        ...before.materialLayers.map((layer) => layer.id),
      ]),
    ];
    const numbered = layerIds
      .map((layerId) => {
        const afterIndex = after.materialLayers.findIndex((layer) => layer.id === layerId);
        const beforeIndex = before.materialLayers.findIndex((layer) => layer.id === layerId);
        const place = afterIndex >= 0 ? afterIndex + 1 : beforeIndex + 1;
        return { layerId, place };
      })
      .sort((a, b) => a.place - b.place || byCodePoint(a.layerId, b.layerId));
    for (const entry of numbered) {
      const beforeLayer = before.materialLayers.find((layer) => layer.id === entry.layerId);
      const afterLayer = after.materialLayers.find((layer) => layer.id === entry.layerId);
      for (const fieldName of ['type', 'color', 'roughness', 'metalness'] as const) {
        const oldValue = layerValue(beforeLayer, fieldName);
        const newValue = layerValue(afterLayer, fieldName);
        if (oldValue === newValue) continue;
        items.push({
          key: `${nodeId}:layer:${entry.layerId}:${fieldName}`,
          nodeId,
          nodeName: name,
          property: `layer ${entry.place} ${fieldName}`,
          oldValue,
          newValue,
        });
      }
    }
    const stateNames = [
      ...new Set([...previous.states, ...next.states].map((state) => state.name)),
    ].sort(byCodePoint);
    for (const stateName of stateNames) {
      const beforeState = previous.states.find((state) => state.name === stateName);
      const afterState = next.states.find((state) => state.name === stateName);
      for (const fieldName of ['position', 'rotation', 'scale', 'visible'] as const) {
        const oldValue = overrideValue(beforeState, nodeId, fieldName);
        const newValue = overrideValue(afterState, nodeId, fieldName);
        if (oldValue === newValue) continue;
        items.push({
          key: `${nodeId}:override:${stateName}:${fieldName}`,
          nodeId,
          nodeName: name,
          property: `${fieldName} in ${stateName}`,
          oldValue,
          newValue,
        });
      }
    }
  }

  const sceneName = 'Scene graph';
  const stateNames = [
    ...new Set([...previous.states, ...next.states].map((state) => state.name)),
  ].sort(byCodePoint);
  for (const stateName of stateNames) {
    const before = previous.states.some((state) => state.name === stateName);
    const after = next.states.some((state) => state.name === stateName);
    if (before === after) continue;
    items.push({
      key: `scene:state:${stateName}`,
      nodeId: null,
      nodeName: sceneName,
      property: `state ${stateName}`,
      oldValue: before ? 'present' : NONE,
      newValue: after ? 'present' : NONE,
    });
  }

  const stateNameOf = (graph: Graph, stateId: string): string =>
    graph.states.find((state) => state.id === stateId)?.name ?? stateId;
  const transitionKeys = [
    ...new Set([
      ...previous.transitions.map((transition) => `${stateNameOf(previous, transition.from)}|${transition.trigger}`),
      ...next.transitions.map((transition) => `${stateNameOf(next, transition.from)}|${transition.trigger}`),
    ]),
  ];
  const triggerOrder = ['hover', 'click', 'scroll'];
  transitionKeys.sort((a, b) => {
    const [fromA, triggerA] = a.split('|');
    const [fromB, triggerB] = b.split('|');
    return (
      byCodePoint(fromA ?? '', fromB ?? '') ||
      triggerOrder.indexOf(triggerA ?? '') - triggerOrder.indexOf(triggerB ?? '')
    );
  });
  for (const key of transitionKeys) {
    const [fromName, trigger] = key.split('|');
    const before = previous.transitions.find(
      (transition) => stateNameOf(previous, transition.from) === fromName && transition.trigger === trigger,
    );
    const after = next.transitions.find(
      (transition) => stateNameOf(next, transition.from) === fromName && transition.trigger === trigger,
    );
    const oldValue = before ? `${shortNumber(before.durationMs)} ms` : NONE;
    const newValue = after ? `${shortNumber(after.durationMs)} ms` : NONE;
    if (oldValue === newValue) continue;
    items.push({
      key: `scene:transition:${key}`,
      nodeId: null,
      nodeName: sceneName,
      property: `transition ${fromName} ${trigger}`,
      oldValue,
      newValue,
    });
  }

  const viewNames = [
    ...new Set([
      ...previous.cameraViews.map((view) => view.name),
      ...next.cameraViews.map((view) => view.name),
    ]),
  ].sort(byCodePoint);
  for (const viewName of viewNames) {
    const before = previous.cameraViews.some((view) => view.name === viewName);
    const after = next.cameraViews.some((view) => view.name === viewName);
    if (before === after) continue;
    items.push({
      key: `scene:view:${viewName}`,
      nodeId: null,
      nodeName: sceneName,
      property: `camera view ${viewName}`,
      oldValue: before ? 'present' : NONE,
      newValue: after ? 'present' : NONE,
    });
  }

  return items;
}

export function changedNodeIds(previous: Graph, next: Graph): string[] {
  const ids = new Set<string>();
  for (const item of graphChanges(previous, next)) {
    if (item.nodeId !== null) ids.add(item.nodeId);
  }
  return [...ids];
}

export function changeItemText(item: ChangeItem, author: string): string {
  return `${item.nodeName} ${item.property}: ${item.oldValue} → ${item.newValue} by ${author}`;
}
