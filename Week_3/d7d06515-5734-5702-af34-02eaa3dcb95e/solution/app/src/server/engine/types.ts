// Contract between the command engine (pure) and the server (persistence, versions, events).
import type { Layer, Layout, PlotStyle, StoredObject, Units } from '../../shared/types.ts';

/** In-memory drawing state a base command works on. Pure data. */
export interface DrawingModel {
  units: Units;
  plot_style: PlotStyle;
  /** Display order; exactly one layer is current. */
  layers: Layer[];
  /** Every base object including those on frozen layers, in creation order. */
  objects: StoredObject[];
  layouts: Layout[];
  /** Numeric value of the next handle to allocate (largest handle used since the last replace, plus one). */
  next_handle: number;
}

/** Before/after image of what a base edit touched. Applying `before` undoes it; applying `after` replays it. */
export interface Patch {
  /** handle -> the object's state in this image; null means the object does not exist. */
  objects: Record<string, StoredObject | null>;
  layers?: Layer[];
  layouts?: Layout[];
  units?: Units;
  plot_style?: PlotStyle;
}

export interface CommandOutcome {
  created: string[];
  modified: string[];
  erased: string[];
  /** Handles left untouched because they are on a locked layer. */
  locked: string[];
  /** Feedback-states history line for the result (for example the locked line) or null. */
  history: string | null;
  /** False when nothing changed (every target locked): the version must not be raised. */
  changed: boolean;
  next: DrawingModel;
  before: Patch;
  after: Patch;
}

export type Refusal =
  | { status: 409; body: { error: 'layer_zero' | 'layer_current' | 'layer_locked' } }
  | { status: 409; body: { error: 'layer_in_use'; objects: number } }
  | { status: 422; body: { errors: Record<string, string> } };

export type CommandResult = { ok: true; outcome: CommandOutcome } | { ok: false; refusal: Refusal };
