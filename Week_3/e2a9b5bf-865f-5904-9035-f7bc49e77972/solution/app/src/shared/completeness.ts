import type { ObjectKind, Pair, ProgramEdition } from "./types";

/** The newest edition whose effective date is on or before the observation's evening date. */
function editionFor(editions: readonly ProgramEdition[], eveningDate: string): ProgramEdition {
  const sorted = [...editions].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  let chosen = sorted[0];
  for (const edition of sorted) if (edition.effective_from <= eveningDate) chosen = edition;
  if (!chosen) throw new Error("a program has at least one edition");
  return chosen;
}

interface Judgeable {
  object_id: string;
  kind: ObjectKind;
  evening_date: string;
  observed_at: string | null;
  seeing: number | null;
  transparency_nelm: number | null;
  description: string;
  concentration_class: string | null;
  pair: Pair | null;
  has_sketch: boolean;
}

export type ProblemCode =
  | "not_on_program"
  | "missing_ut_time"
  | "missing_seeing"
  | "missing_transparency"
  | "missing_concentration"
  | "missing_pair"
  | "short_description"
  | "missing_sketch";

/** What an observation still lacks for a program, in the published order. Empty means it qualifies. */
export function problems(
  obs: Judgeable,
  program: { object_ids: readonly string[]; editions: readonly ProgramEdition[] },
): { edition: ProgramEdition; codes: ProblemCode[] } {
  const edition = editionFor(program.editions, obs.evening_date);
  if (!program.object_ids.includes(obs.object_id)) return { edition, codes: ["not_on_program"] };
  const codes: ProblemCode[] = [];
  if (!obs.observed_at) codes.push("missing_ut_time");
  if (obs.seeing === null || obs.seeing < 1 || obs.seeing > 10) codes.push("missing_seeing");
  if (obs.transparency_nelm === null) codes.push("missing_transparency");
  if (edition.concentration_required && obs.kind === "globular" && !obs.concentration_class) codes.push("missing_concentration");
  if (edition.pair_required && obs.kind === "double_star" && !obs.pair) codes.push("missing_pair");
  if (obs.description.trim().length < edition.min_description) codes.push("short_description");
  if (edition.sketch_required && !obs.has_sketch) codes.push("missing_sketch");
  return { edition, codes };
}

function qualifies(
  obs: Judgeable,
  program: { object_ids: readonly string[]; editions: readonly ProgramEdition[] },
): boolean {
  return problems(obs, program).codes.length === 0;
}

export interface Ranked extends Judgeable {
  id: string;
  created_seq: number;
}

/** Newest observed_at first; observations with no time last; the later-created one wins a tie. */
export function newestFirst<T extends { observed_at: string | null; created_seq: number }>(a: T, b: T): number {
  if (a.observed_at === b.observed_at) return b.created_seq - a.created_seq;
  if (a.observed_at === null) return 1;
  if (b.observed_at === null) return -1;
  return a.observed_at < b.observed_at ? 1 : -1;
}

/**
 * The checklist's representative for one program object: the newest qualifying observation,
 * otherwise the newest observation of any kind. `qualifying` says which one it is.
 */
export function representative<T extends Ranked>(
  observations: readonly T[],
  program: { object_ids: readonly string[]; editions: readonly ProgramEdition[] },
): { observation: T | null; qualifying: boolean } {
  const ordered = [...observations].sort(newestFirst);
  const good = ordered.find((o) => qualifies(o, program));
  if (good) return { observation: good, qualifying: true };
  return { observation: ordered[0] ?? null, qualifying: false };
}
