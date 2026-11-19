import type { ProjectKind, Snapshot } from "../../shared/types";

export const DEFAULT_NAMES: Record<ProjectKind, string> = {
  "3d": "Untitled 3D design",
  circuit: "Untitled circuit",
  blocks: "Untitled block program",
};

export function isProjectKind(value: string | null): value is ProjectKind {
  return value === "3d" || value === "circuit" || value === "blocks";
}

/** The empty document a new project of this kind starts from. */
export function blankSnapshot(kind: ProjectKind): Snapshot {
  if (kind === "3d") return { kind, objects: [], workplane: { origin: [0, 0, 0], normal: [0, 0, 1] } };
  if (kind === "circuit") return { kind, components: [], wires: [] };
  return { kind, program: [], objects: [] };
}
