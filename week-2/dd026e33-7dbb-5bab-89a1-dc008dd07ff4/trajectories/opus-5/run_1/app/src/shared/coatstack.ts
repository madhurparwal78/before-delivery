import { PANELS, type PanelId } from './panels';

export type Band = 'thin' | 'factory' | 'refinished' | 'filler_suspected';

export const BAND_LABEL: Record<Band, string> = {
  thin: 'Thin',
  factory: 'Factory',
  refinished: 'Refinished',
  filler_suspected: 'Filler suspected',
};

export function bandOf(filmUm: number): Band {
  if (filmUm < 80) return 'thin';
  if (filmUm <= 180) return 'factory';
  if (filmUm <= 300) return 'refinished';
  return 'filler_suspected';
}

export interface CoatLayer {
  readonly stage: string;
  readonly um: number;
}

export interface PanelAtStage {
  readonly panel: PanelId;
  readonly film_um: number | null;
  readonly band: Band | null;
  readonly layers: readonly CoatLayer[];
}

export interface StageSlice {
  readonly index: number;
  readonly name: string;
  readonly logged_at: string;
  readonly panels: readonly PanelAtStage[];
}

export interface CoatStack {
  readonly job_id: string;
  readonly panels: readonly { id: PanelId; name: string; order: number }[];
  readonly stages: readonly StageSlice[];
}

/** A logged stage with, for each panel, its latest reading at that stage. */
export interface LoggedStageReadings {
  readonly name: string;
  readonly logged_at: string;
  readonly values: ReadonlyMap<PanelId, number>;
}

/** A value below this empties a panel's coat stack. */
const EMPTY_BELOW_UM = 20;

/** Derives every panel's film build, band and layers at every logged stage. */
export function deriveCoatStack(jobId: string, stages: readonly LoggedStageReadings[]): CoatStack {
  const carried = new Map<PanelId, number>();
  const stacks = new Map<PanelId, CoatLayer[]>();
  const current = new Map<PanelId, number>();
  const slices: StageSlice[] = [];

  for (const [index, stage] of stages.entries()) {
    for (const panel of PANELS) {
      const value = stage.values.get(panel.id);
      if (value === undefined) continue;
      carried.set(panel.id, value);
      applyStageValue(stacks, current, panel.id, stage.name, value);
    }
    slices.push({
      index,
      name: stage.name,
      logged_at: stage.logged_at,
      panels: PANELS.map((panel) => {
        const film = carried.get(panel.id);
        return {
          panel: panel.id,
          film_um: film ?? null,
          band: film === undefined ? null : bandOf(film),
          layers: (stacks.get(panel.id) ?? []).map((layer) => ({ ...layer })),
        };
      }),
    });
  }

  return {
    job_id: jobId,
    panels: PANELS.map((panel) => ({ id: panel.id, name: panel.name, order: panel.order })),
    stages: slices,
  };
}

function applyStageValue(
  stacks: Map<PanelId, CoatLayer[]>,
  current: Map<PanelId, number>,
  panel: PanelId,
  stageName: string,
  value: number,
): void {
  if (value < EMPTY_BELOW_UM) {
    stacks.set(panel, []);
    current.set(panel, value);
    return;
  }
  const previous = current.get(panel);
  const stack = stacks.get(panel) ?? [];
  if (previous === undefined) {
    stacks.set(panel, [{ stage: stageName, um: value }]);
    current.set(panel, value);
    return;
  }
  if (value > previous) {
    stack.push({ stage: stageName, um: value - previous });
  } else if (value < previous) {
    let remove = previous - value;
    while (remove > 0 && stack.length > 0) {
      const top = stack[stack.length - 1] as CoatLayer;
      if (top.um > remove) {
        stack[stack.length - 1] = { stage: top.stage, um: top.um - remove };
        remove = 0;
      } else {
        remove -= top.um;
        stack.pop();
      }
    }
  }
  stacks.set(panel, stack);
  current.set(panel, value);
}
