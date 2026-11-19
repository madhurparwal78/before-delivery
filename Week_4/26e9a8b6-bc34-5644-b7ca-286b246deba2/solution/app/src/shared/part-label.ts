import type { Part } from './types';

/** The part name alone when no other part has it, otherwise the name and its full node path in round brackets. */
export function partLabels(parts: readonly Pick<Part, 'id' | 'name' | 'node_path'>[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const part of parts) counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
  return new Map(parts.map((part) => [part.id, counts.get(part.name)! > 1 ? `${part.name} (${part.node_path})` : part.name]));
}
