import { useState, type RefObject } from "react";
import type { LatestProject, Snapshot } from "../../shared/types";
import { useSnapshot } from "../projects/useSnapshot";

interface KeptSnapshot {
  ref: RefObject<HTMLDivElement | null>;
  /** The newest snapshot loaded for this project; the previous revision stays until the next one arrives. */
  snapshot: Snapshot | null;
  /** The revision `snapshot` belongs to. */
  revision: number | null;
}

interface Loaded {
  projectId: string;
  revision: number;
  snapshot: Snapshot;
}

/** A Student's latest project snapshot that never blanks while a newer revision loads. */
export function useKeptSnapshot(project: LatestProject): KeptSnapshot {
  const { ref, snapshot } = useSnapshot(project.id, project.revision);
  const [kept, setKept] = useState<Loaded | null>(null);
  if (snapshot && kept?.snapshot !== snapshot) setKept({ projectId: project.id, revision: project.revision, snapshot });
  const current = kept && kept.projectId === project.id ? kept : null;
  return { ref, snapshot: current?.snapshot ?? null, revision: current?.revision ?? null };
}
