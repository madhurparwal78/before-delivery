import type { CiJson } from "../../../server/cis.js";
import type { ProposalJson } from "../../../server/major.js";
import type { Status } from "../../../server/map.js";
import { get } from "../../lib/api.js";

export type MapNode = { name: string; class: string; status: Status; layer: number; x: number; y: number };
export type MapEdge = { source: string; type: string; target: string };

export type MapData = { nodes: MapNode[]; edges: MapEdge[]; cis: CiJson[]; proposals: ProposalJson[] };

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 64;

export const STATUS_LABELS: Record<Status, string> = { healthy: "Healthy", degraded: "Degraded", down: "Down", maintenance: "In maintenance" };

export const RELATIONSHIP_TYPES = ["depends on", "runs on", "hosted by", "member of", "connects to", "backs up"];

export async function loadMap(): Promise<MapData> {
  const [map, cis, proposals] = await Promise.all([
    get<{ nodes: MapNode[]; edges: MapEdge[] }>("/api/service-map"),
    get<{ cis: CiJson[] }>("/api/cis"),
    get<{ proposals: ProposalJson[] }>("/api/major-proposals"),
  ]);
  return { nodes: map.nodes, edges: map.edges, cis: cis.cis, proposals: proposals.proposals };
}

export function sentence(name: string): string {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
