import type { Group, Object3D } from "three";
import type { DesignObject, Snapshot } from "../../shared/types";

export interface SnapshotStillProps {
  snapshot: Snapshot;
  className?: string;
}

export interface TurntableProps {
  snapshot: Snapshot;
  /** False pauses the turn (the camera holds still). */
  playing: boolean;
  /** Seconds for one full turn. Defaults to 12, the Glancet speed. */
  turnSeconds?: number;
  className?: string;
  /** Called once, after the first frame that shows the whole model (or at once when nothing needs resolving). */
  onReady?: () => void;
}

/** Three.js meshes for a list of design objects, shared by the 3D Workshop, the Block Lab viewer and the Turntable. */
export interface DesignMeshes {
  readonly root: Group;
  /**
   * Replaces the meshes. Group results resolve in a worker; `onUpdate` fires when each arrives (and after primitives are
   * placed), `onSettled` once every group of this call has arrived (or failed).
   */
  setObjects: (objects: DesignObject[], onUpdate?: () => void, onSettled?: () => void) => void;
  /** The mesh for a top-level object id; its `userData.objectId` is that id. */
  meshFor: (id: string) => Object3D | undefined;
  /** Scales the opacity of every material (0 to 1), for crossfades. Holes keep their stripes. */
  setOpacity: (opacity: number) => void;
  dispose: () => void;
}

