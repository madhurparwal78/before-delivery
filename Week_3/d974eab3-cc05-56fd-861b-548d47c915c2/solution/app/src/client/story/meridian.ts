import { modeOf, scenariosOfMode, type Mode, type ScenarioId } from "../../shared/scenarios.js";

export interface ScenarioRequest { token: number; id: ScenarioId }

/**
 * The Lifestyle choice rules, decided here only: the visitor's choice is `selected` at once, the panel shows `shown`
 * when the answer for the latest choice arrives, and each mode remembers the scenario last chosen in it.
 */
export class Meridian {
  private readonly lastByMode = new Map<Mode, ScenarioId>();
  private token = 0;
  private chosen: ScenarioId;
  private displayed: ScenarioId;

  constructor(start: ScenarioId) {
    this.chosen = start;
    this.displayed = start;
    this.lastByMode.set(modeOf(start), start);
  }

  get selected(): ScenarioId {
    return this.chosen;
  }

  get loading(): boolean {
    return this.chosen !== this.displayed;
  }

  /** The request that loads the scenario shown at page start. */
  start(): ScenarioRequest {
    return { token: this.token, id: this.displayed };
  }

  /** The request to make for a choice, or null when nothing needs fetching. */
  chooseScenario(id: ScenarioId): ScenarioRequest | null {
    if (id === this.chosen) return null;
    this.chosen = id;
    this.lastByMode.set(modeOf(id), id);
    this.token += 1;
    return id === this.displayed ? null : { token: this.token, id };
  }

  /** A mode shows the scenario last chosen in it, or its first. */
  chooseMode(mode: Mode): ScenarioRequest | null {
    return this.chooseScenario(this.lastByMode.get(mode) ?? scenariosOfMode(mode)[0]);
  }

  /** The neighbour of the chosen scenario inside its mode, or null past either end. */
  neighbour(step: -1 | 1): ScenarioId | null {
    const row = scenariosOfMode(modeOf(this.chosen));
    return row[row.indexOf(this.chosen) + step] ?? null;
  }

  /** An answer arrived: it counts only when it is for the latest choice. */
  arrived(token: number): boolean {
    if (token !== this.token) return false;
    this.displayed = this.chosen;
    return true;
  }

  /** An answer failed: only the latest choice falls back to the scenario still shown. */
  failed(token: number): boolean {
    if (token !== this.token) return false;
    this.chosen = this.displayed;
    this.lastByMode.set(modeOf(this.displayed), this.displayed);
    return true;
  }
}
