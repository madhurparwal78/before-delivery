export const SCENARIO_IDS = [
  "on-work", "on-sports", "on-hobby", "on-housework",
  "off-break", "off-holiday", "off-relax", "off-rest",
] as const;

export type ScenarioId = (typeof SCENARIO_IDS)[number];
export type Mode = "on" | "off";

export function isScenarioId(value: string): value is ScenarioId {
  return SCENARIO_IDS.some((id) => id === value);
}

export function modeOf(id: ScenarioId): Mode {
  return id.startsWith("on-") ? "on" : "off";
}

export function scenariosOfMode(mode: Mode): ScenarioId[] {
  return SCENARIO_IDS.filter((id) => modeOf(id) === mode);
}

export function scenarioPosition(id: ScenarioId): number {
  return SCENARIO_IDS.indexOf(id);
}
