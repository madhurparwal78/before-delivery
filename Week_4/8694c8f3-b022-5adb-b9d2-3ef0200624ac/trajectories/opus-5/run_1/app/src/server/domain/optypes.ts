import { asString } from '../input.js';
import { barsBeats, propertyLabel } from '../../shared/domain.js';

export const OP_TYPES = [
  'layer.add',
  'layer.set',
  'layer.reparent',
  'layer.remove',
  'shader.save',
  'shader.restore',
  'key.set',
  'key.remove',
  'set.update',
  'graph.node.add',
  'graph.node.update',
  'graph.node.remove',
  'graph.wire.add',
  'graph.wire.remove',
  'script.add',
  'script.save',
  'script.remove',
] as const;

export type OpType = (typeof OP_TYPES)[number];

export type TargetKind = 'layer' | 'set' | 'graph' | 'script';

export const NO_BASE_VERSION: readonly OpType[] = [
  'layer.add',
  'script.add',
  'graph.node.add',
  'graph.wire.add',
];

export function isOpType(value: string): value is OpType {
  return (OP_TYPES as readonly string[]).includes(value);
}

export function targetKindFor(type: OpType): TargetKind {
  if (type.startsWith('layer.') || type.startsWith('shader.') || type.startsWith('key.')) return 'layer';
  if (type.startsWith('graph.')) return 'graph';
  if (type.startsWith('script.')) return 'script';
  return 'set';
}

export { propertyLabel };

export const BUILTIN_PORTS: Record<string, { inputs: string[]; outputs: string[] }> = {
  'Beat clock': { inputs: [], outputs: ['beat', 'phase'] },
  LFO: { inputs: ['beat'], outputs: ['value'] },
  Remap: { inputs: ['in'], outputs: ['out'] },
  'Layer property': { inputs: ['value'], outputs: [] },
};

export function describeValue(value: unknown): string {
  if (typeof value === 'number') return value.toFixed(3);
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (value === null) return 'nothing';
  if (Array.isArray(value)) return value.map((entry) => describeValue(entry)).join(', ');
  const text = asString(value);
  return text ?? JSON.stringify(value);
}

export function keySummary(verb: string, label: string, layerName: string, tick: number): string {
  return `${verb} ${label} on ${layerName} at ${barsBeats(tick)}`;
}

