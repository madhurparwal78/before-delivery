// The coat stack (brief: Business rules › Coat stack derivation): film build, reading band and
// cross-section layers per panel at every logged stage. Bands and layers are decided here only.
import type { CoatStack, CoatStackPanel } from "../shared/api.js";
import { BAND_LIMIT_UM, PANELS, type Band, type PanelId } from "../shared/domain.js";

function bandOf(um: number): Band {
  if (um < BAND_LIMIT_UM.thinBelow) return "thin";
  if (um <= BAND_LIMIT_UM.factoryUpTo) return "factory";
  if (um <= BAND_LIMIT_UM.refinishedUpTo) return "refinished";
  return "filler_suspected";
}

const EMPTIES_BELOW_UM = 20;

export interface LoggedStage {
  index: number;
  name: string;
  loggedAt: string;
  /** The latest reading per panel logged at this stage. */
  values: Partial<Record<PanelId, number>>;
}

export function deriveCoatStack(jobId: string, stages: LoggedStage[]): CoatStack {
  const current = new Map<PanelId, number>();
  const layers = new Map<PanelId, { stage: string; um: number }[]>();
  return {
    job_id: jobId,
    panels: PANELS.map((p, i) => ({ id: p.id, name: p.name, order: i + 1 })),
    stages: stages.map((stage) => {
      const panels: CoatStackPanel[] = PANELS.map(({ id }) => {
        const value = stage.values[id];
        if (value !== undefined) {
          const previous = current.get(id);
          let stack = layers.get(id) ?? [];
          if (value < EMPTIES_BELOW_UM) {
            stack = [];
          } else if (previous === undefined || value > previous) {
            stack = [...stack, { stage: stage.name, um: value - (previous ?? 0) }];
          } else if (value < previous) {
            let remove = previous - value;
            stack = stack.map((layer) => ({ ...layer }));
            while (remove > 0 && stack.length > 0) {
              const top = stack[stack.length - 1];
              if (!top) break;
              if (top.um <= remove) {
                remove -= top.um;
                stack.pop();
              } else {
                top.um -= remove;
                remove = 0;
              }
            }
          }
          layers.set(id, stack);
          current.set(id, value);
        }
        const film = current.get(id);
        return {
          panel: id,
          film_um: film ?? null,
          band: film === undefined ? null : bandOf(film),
          layers: (layers.get(id) ?? []).map((layer) => ({ ...layer })),
        };
      });
      return { index: stage.index, name: stage.name, logged_at: stage.loggedAt, panels };
    }),
  };
}
