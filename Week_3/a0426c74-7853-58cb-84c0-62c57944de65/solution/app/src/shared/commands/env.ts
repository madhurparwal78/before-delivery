import type { Scene, View } from '../geometry/index.ts';
import type { DrawingListing, DrawingState, Role } from '../types.ts';

/** Everything the command line needs to know about the page at the moment an input arrives. */
export interface CommandEnv {
  /** the model as this page shows it (confirmed state plus its optimistic groups) */
  state: DrawingState;
  /** the scene built from `state`: picking and cutting edges use it */
  scene: Scene;
  /** the aperture is 10 screen px, so only `zoom` matters here */
  view: View;
  /** author of the groups made here: the engine dry-runs a TRIM or EXTEND run with it */
  username: string;
  role: Role;
  phone: boolean;
  /** the current layer: new entities go there */
  layer: string;
  selection: readonly string[];
  /** the host drawing's folder: XATTACH matches drawing names exactly and refuses a loop at the name stage */
  drawings: readonly Pick<DrawingListing, 'id' | 'name' | 'xref_sources'>[];
  host: Pick<DrawingListing, 'id' | 'name'>;
  newOpId(): string;
}
