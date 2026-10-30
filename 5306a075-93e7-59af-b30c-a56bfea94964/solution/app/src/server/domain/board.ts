// Board order (brief: Business rules › Board order, Freeze and scope) and scope snapshots.
import type { ReleaseStatus } from "../../shared/lifecycles.js";
import type { Role } from "../../shared/api.js";
import { putObject } from "../services/storage.js";
import { iso } from "./time.js";

export interface BoardList { id: string; status: ReleaseStatus; orderVersion: number; featureIds: string[] }

/** The release lists a move leaves behind: the feature leaves its source and joins the target at `toIndex`. */
export function applyMove<L extends BoardList>(featureId: string, source: L | null, target: L | null, toIndex: number): L[] {
  const touched: L[] = [];
  if (source) touched.push({ ...source, featureIds: source.featureIds.filter((id) => id !== featureId) });
  if (target) {
    const base = touched.find((t) => t.id === target.id) ?? { ...target, featureIds: target.featureIds.filter((id) => id !== featureId) };
    base.featureIds.splice(toIndex, 0, featureId);
    if (!touched.includes(base)) touched.push(base);
  }
  return touched.map((t) => ({ ...t, orderVersion: t.orderVersion + 1 }));
}

/** The largest legal toIndex: the target's length once the feature has left it. */
export const maxIndex = (featureId: string, target: BoardList): number => target.featureIds.filter((id) => id !== featureId).length;

/** A membership change of a frozen release needs the head of product; reordering inside it does not. */
export function scopeChangeAllowed(role: Role, source: BoardList | null, target: BoardList | null): boolean {
  if (source?.id === target?.id) return true;
  const frozen = [source, target].some((list) => list?.status === "frozen");
  return !frozen || role === "head_of_product";
}

export interface ScopeRelease { id: string; name: string; targetDate: string }

/** Writes releases/<id>/scope-v<n>.json; throws StorageUnavailable when storage cannot confirm it. */
export async function writeScopeSnapshot(release: ScopeRelease, version: number, features: { id: string; name: string }[]): Promise<void> {
  const snapshot = {
    releaseId: release.id,
    name: release.name,
    targetDate: release.targetDate,
    snapshotVersion: version,
    frozenAt: iso(new Date()),
    features: features.map((f, i) => ({ id: f.id, name: f.name, position: i + 1 })),
  };
  await putObject(`releases/${release.id}/scope-v${version}.json`, Buffer.from(JSON.stringify(snapshot)), "application/json");
}
