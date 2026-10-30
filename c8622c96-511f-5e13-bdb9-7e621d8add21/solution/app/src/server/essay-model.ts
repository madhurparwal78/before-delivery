// Essay records: loading, who may see them, and the bodies sent to each audience.
import { coopTime, isoInstant } from "../shared/coop-time.js";
import { isNewsroomRole, type Person } from "./auth.js";
import { query, one, type Client } from "./db.js";
import { notFound, takenDown } from "./http.js";
import { effectiveEnd, isStanding, type LicenceRow } from "./licence-state.js";
import { isOnSheet, type EssayState } from "./lifecycle.js";

export interface EssayRow {
  id: string;
  version: number;
  title: string;
  caption: string;
  lift_local: string;
  lift_at: Date;
  lift_resolution: string;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  state: EssayState;
  withdrawal_requested: boolean;
  created_at: Date;
  submitted_at: Date | null;
}

export interface CreditRow {
  essay_id: string;
  position: number;
  handle: string;
  name: string;
  split_bp: number;
}

export interface FrameRow {
  id: string;
  essay_id: string;
  position: number;
  caption: string;
  filename: string;
  bytes: number;
  type: string;
  width: number;
  height: number;
}

export async function loadEssay(id: string, client?: Client, lock = false): Promise<EssayRow | undefined> {
  return one<EssayRow>(`SELECT * FROM essays WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], client);
}

export async function creditsOf(ids: string[], client?: Client): Promise<CreditRow[]> {
  if (!ids.length) return [];
  return query<CreditRow>(
    `SELECT c.essay_id, c.position, c.handle, p.name, c.split_bp FROM credits c JOIN people p ON p.handle = c.handle
     WHERE c.essay_id = ANY($1) ORDER BY c.essay_id, c.position`, [ids], client);
}

async function framesOf(ids: string[], client?: Client): Promise<FrameRow[]> {
  if (!ids.length) return [];
  return query<FrameRow>("SELECT * FROM frames WHERE essay_id = ANY($1) ORDER BY essay_id, position", [ids], client);
}

export async function licencesOnEssays(ids: string[], client?: Client): Promise<LicenceRow[]> {
  if (!ids.length) return [];
  return query<LicenceRow>("SELECT * FROM licences WHERE essay_id = ANY($1) AND status <> 'removed'", [ids], client);
}

/** "Photographs by A", "Photographs by A and B", "Photographs by A, B and C". */
export function creditLine(names: string[]): string {
  const joined = names.length <= 1 ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Photographs by ${joined}`;
}

export const isCredited = (person: Person, credits: CreditRow[]): boolean =>
  person.handle !== null && credits.some((c) => c.handle === person.handle);

async function newsroomLicensed(newsroom: string, essayId: string, client?: Client): Promise<boolean> {
  return (await one(`SELECT 1 FROM licences WHERE essay_id = $1 AND newsroom = $2 AND status <> 'removed'`,
    [essayId, newsroom], client)) !== undefined;
}

/**
 * Loads an essay the caller may see, or answers 404 (unknown or not visible) or 410 (taken down, except for
 * the desk editor). Newsrooms see embargoed and live essays, and withdrawn ones their newsroom licensed.
 */
export async function visibleEssay(person: Person, id: string, client?: Client, lock = false): Promise<EssayRow> {
  const essay = await loadEssay(id, client, lock);
  if (!essay) throw notFound();
  if (person.role === "desk_editor") return essay;
  if (essay.state === "taken_down") throw takenDown();
  if (isOnSheet(essay.state)) return essay;
  if (person.role === "contributor") {
    if (isCredited(person, await creditsOf([essay.id], client))) return essay;
  } else if (essay.state === "withdrawn" && person.newsroom
    && await newsroomLicensed(person.newsroom.slug, essay.id, client)) {
    return essay;
  }
  throw notFound();
}

interface WindowBody {
  state: "open" | "claimed";
  held_by: "you" | "your_newsroom" | "another_newsroom" | null;
  held_until: string | null;
  held_until_display: string | null;
  standard_running_until: string | null;
  standard_running_until_display: string | null;
}

/** The exclusive window as the caller sees it at `now`. */
export function windowBody(person: Person, licences: LicenceRow[], now: Date): WindowBody {
  const standing = licences.filter((l) => isStanding(l, now));
  const exclusive = standing.find((l) => l.kind === "exclusive");
  const ownRoom = person.newsroom?.slug ?? null;
  const rivalsStandard = standing.filter((l) => l.kind === "standard" && l.newsroom !== ownRoom);
  const latest = rivalsStandard.map(effectiveEnd).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const heldUntil = exclusive ? effectiveEnd(exclusive) : null;
  return {
    state: exclusive ? "claimed" : "open",
    held_by: !exclusive ? null : exclusive.licensed_by === person.id ? "you"
      : exclusive.newsroom === ownRoom ? "your_newsroom" : "another_newsroom",
    held_until: heldUntil ? isoInstant(heldUntil) : null,
    held_until_display: heldUntil ? coopTime(heldUntil) : null,
    standard_running_until: latest ? isoInstant(latest) : null,
    standard_running_until_display: latest ? coopTime(latest) : null,
  };
}

export const mediaUrl = (frameId: string, variant: "grid" | "story" | "preview"): string =>
  `/media/frames/${encodeURIComponent(frameId)}/${variant}`;

/** Builds essay bodies for several essays with batched lookups. */
export async function essayBodies(person: Person, essays: EssayRow[], now: Date, client?: Client):
  Promise<Record<string, unknown>[]> {
  const ids = essays.map((e) => e.id);
  const [credits, frames, licences] = await Promise.all([
    creditsOf(ids, client), framesOf(ids, client), licencesOnEssays(ids, client)]);
  const notes = person.role === "contributor" || person.role === "desk_editor" || person.role === "treasurer"
    ? await query<{ essay_id: string; note: string; at: Date }>(
      "SELECT essay_id, note, at FROM desk_notes WHERE essay_id = ANY($1) ORDER BY at, id", [ids], client)
    : [];
  return essays.map((essay) => {
    const own = credits.filter((c) => c.essay_id === essay.id);
    // Contributors and co-op staff get the full body; picture editors and licensing managers the newsroom view.
    const full = !isNewsroomRole(person);
    const imagery = essay.state !== "taken_down";
    const body: Record<string, unknown> = {
      id: essay.id,
      version: essay.version,
      title: essay.title,
      caption: essay.caption,
      credit_line: creditLine(own.map((c) => c.name)),
      credits: own.map((c) => full
        ? { handle: c.handle, name: c.name, position: c.position, split_bp: c.split_bp }
        : { handle: c.handle, name: c.name, position: c.position }),
      state: essay.state,
      lift_local: essay.lift_local,
      lift_at: isoInstant(essay.lift_at),
      lift_display: coopTime(essay.lift_at),
      lift_resolution: essay.lift_resolution,
      exclusive_days: essay.exclusive_days,
      standard_days: essay.standard_days,
      exclusive_price_minor: essay.exclusive_price_minor,
      standard_price_minor: essay.standard_price_minor,
      frames: frames.filter((f) => f.essay_id === essay.id).map((f) => {
        const frame: Record<string, unknown> = {
          id: f.id, position: f.position, caption: f.caption,
          grid_url: imagery ? mediaUrl(f.id, "grid") : null,
        };
        if (full) frame.story_url = imagery ? mediaUrl(f.id, "story") : null;
        frame.preview_url = imagery ? mediaUrl(f.id, "preview") : null;
        return frame;
      }),
      window: windowBody(person, licences.filter((l) => l.essay_id === essay.id), now),
    };
    if (full) {
      body.desk_notes = notes.filter((n) => n.essay_id === essay.id)
        .map((n) => ({ note: n.note, at: isoInstant(n.at), at_display: coopTime(n.at) }));
      body.withdrawal_requested = essay.withdrawal_requested;
    }
    return body;
  });
}

export async function essayBody(person: Person, essay: EssayRow, now: Date, client?: Client):
  Promise<Record<string, unknown>> {
  return (await essayBodies(person, [essay], now, client))[0] as Record<string, unknown>;
}

