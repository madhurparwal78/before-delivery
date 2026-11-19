// Terrain re-resolution: when a terrain tile finer than a draft finding's recorded level arrives and
// contains its point, the page samples the new ground height and sends it once for that level. One
// request per finding is in flight at a time; a finer level that arrives meanwhile goes next.
import { isFinerTerrain } from "../../shared/terrainLevel";
import { api, ApiFailure, type Finding } from "./api";
import type { TerrainTile } from "./globe/scene";

interface Candidate {
  level: number;
  heightM: number;
}

interface RefinementOptions {
  findings: () => Finding[];
  active: () => boolean;
  onRefined: (finding: Finding) => void;
  onStale: () => void;
}

export class TerrainRefinement {
  private readonly sent = new Map<string, Set<number>>();
  private readonly busy = new Set<string>();
  private readonly queued = new Map<string, Candidate>();

  constructor(private readonly options: RefinementOptions) {}

  tileArrived(tile: TerrainTile): void {
    if (!this.options.active()) return;
    for (const finding of this.options.findings()) {
      if (!isFinerTerrain(tile.level, finding.terrain_level) || !tile.contains(finding.lon_deg, finding.lat_deg)) continue;
      this.offer(finding.id, { level: tile.level, heightM: tile.heightAt(finding.lon_deg, finding.lat_deg) });
    }
  }

  private offer(id: string, candidate: Candidate): void {
    if (this.sent.get(id)?.has(candidate.level) === true) return;
    if (this.busy.has(id)) {
      const waiting = this.queued.get(id);
      if (isFinerTerrain(candidate.level, waiting?.level ?? null)) this.queued.set(id, candidate);
      return;
    }
    void this.send(id, candidate);
  }

  private async send(id: string, candidate: Candidate): Promise<void> {
    this.busy.add(id);
    const levels = this.sent.get(id) ?? new Set<number>();
    levels.add(candidate.level);
    this.sent.set(id, levels);
    let stored: number | null = candidate.level;
    try {
      const result = await api<{ finding: Finding }>("POST", `/api/findings/${id}/terrain`, {
        body: { ground_height_m: candidate.heightM, terrain_level: candidate.level },
      });
      stored = result.finding.terrain_level;
      this.options.onRefined(result.finding);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) this.options.onStale();
    } finally {
      this.busy.delete(id);
      const next = this.queued.get(id);
      this.queued.delete(id);
      if (next !== undefined && isFinerTerrain(next.level, stored)) this.offer(id, next);
    }
  }
}
