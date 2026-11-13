// Maps lines of one version onto the latest version, reading file texts from the repository (cached per call).
import type { DiffOp } from "../../shared/diff.ts";
import type { Queryable } from "../db.ts";
import { readFile } from "../repo/index.ts";
import { diffTexts, mapRegion, type Mapped } from "./remap.ts";
import type { VersionRow } from "./store.ts";

export type Side = "old" | "new";

export class VersionMapper {
  readonly latest: number;
  private readonly q: Queryable;
  private readonly projectId: number;
  private readonly versions: ReadonlyMap<number, VersionRow>;
  private readonly texts = new Map<string, string | null>();
  private readonly diffs = new Map<string, DiffOp[] | null>();

  constructor(q: Queryable, projectId: number, versions: readonly VersionRow[]) {
    this.q = q;
    this.projectId = projectId;
    this.versions = new Map(versions.map((version) => [version.number, version]));
    this.latest = versions.reduce((highest, version) => Math.max(highest, version.number), 0);
  }

  hasVersion(number: number): boolean {
    return this.versions.has(number);
  }

  versionRow(number: number): VersionRow | undefined {
    return this.versions.get(number);
  }

  // New-side lines live in the head of a version, old-side lines in its base.
  private commitOf(number: number, side: Side): string | null {
    const version = this.versions.get(number);
    if (version === undefined) return null;
    return side === "new" ? version.head : version.base;
  }

  private async text(commit: string | null, path: string): Promise<string | null> {
    if (commit === null) return null;
    const key = `${commit}:${path}`;
    if (!this.texts.has(key)) this.texts.set(key, await readFile(this.q, this.projectId, commit, path));
    return this.texts.get(key) ?? null;
  }

  /** Where lines `start`..`end` of `path` on `side` of version `from` are in the latest version; null when they changed. */
  async map(from: number, side: Side, path: string, start: number, end: number): Promise<Mapped | null> {
    if (start < 1 || end < start) return null;
    const before = await this.text(this.commitOf(from, side), path);
    if (from === this.latest) {
      if (before === null) return null;
      const count = before === "" ? 0 : before.split("\n").length - (before.endsWith("\n") ? 1 : 0);
      return end <= count ? { start, end } : null;
    }
    const key = `${from}:${side}:${path}`;
    if (!this.diffs.has(key)) {
      const after = await this.text(this.commitOf(this.latest, side), path);
      this.diffs.set(key, before === null || after === null ? null : diffTexts(before, after));
    }
    const ops = this.diffs.get(key) ?? null;
    return ops === null ? null : mapRegion(ops, start, end);
  }
}
