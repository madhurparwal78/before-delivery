import { connectionEdges, adjacencyFor, degree } from '../graph.js';
import { getMemberById } from '../profile.js';
import { findPair, stateBetween } from '../connections.js';

export { getMemberById } from '../profile.js';
export { blockedWith } from '../graph.js';

export const connectionStateFor = async (viewerId: string, otherId: string): Promise<string> => {
  const row = await findPair(viewerId, otherId);
  return stateBetween(viewerId, row, false);
};

export const degreeTo = async (viewerId: string, targetId: string, blocked: Set<string>): Promise<number | null> => {
  const edges = await connectionEdges();
  const adj = adjacencyFor(edges, blocked);
  return degree(viewerId, targetId, adj);
};

export const memberName = async (id: string): Promise<string> => {
  const m = await getMemberById(id);
  return m?.name ?? '';
};
