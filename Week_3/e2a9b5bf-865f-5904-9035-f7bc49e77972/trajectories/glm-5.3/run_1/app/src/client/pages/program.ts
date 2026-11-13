// Program detail: progress bar, counts, edition line and checklist (DP-31, DP-64, DP-89).
import { app, navigate, persist } from "../app.js";
import { el } from "../dom.js";
import { apiGet, apiPost } from "../api.js";
import { shell } from "./shell.js";
import { programSentences } from "../../shared/sentences.js";
import type { ProgramDetail, Observation, ObjectHistory } from "../../shared/api.js";
import { editionForDate, qualifies, type RuleEdition } from "../../shared/completeness.js";
import type { SyncChange } from "../../shared/api.js";

export async function renderProgram(root: HTMLElement, programId: string): Promise<void> {
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null);
  let store = accountId ? app.state.stores[accountId] : null;
  const journal = accountId ? (app.state.journals[accountId] ?? []) : [];

  let detail = store?.programDetails[programId] ?? null;
  if (!detail && navigator.onLine && accountId) {
    try {
      detail = await apiGet.program(programId);
      const programStore = app.state.stores[accountId] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      programStore.programDetails[programId] = detail;
      store = programStore;
      persist();
    } catch {
      detail = null;
    }
  }

  const heading = detail ? detail.name : "Program";
  const parts = shell(heading, []);
  const column = parts.column;
  if (!detail) {
    column.append(el("p", { class: "empty-sentence", text: "This isn't on this device yet. It needs signal." }));
    root.append(column);
    return;
  }

  // While offline or with changes queued, recompute the checklist and counts
  // from the device's copy plus queued changes (DP-89). While online with an
  // empty journal, the server's answer shows as it stands.
  const offline = !navigator.onLine || journal.length > 0;
  // The whole account lands on the device within 10 seconds of the first online
  // visit (DP-88); the Program screen also waits for the histories its rows
  // need so the checklist shows values at once.
  if (navigator.onLine && store) {
    const missing = detail.objects.filter((row) => row.qualifying_observation_id && !findObservationInStore(store, row.qualifying_observation_id));
    if (missing.length > 0) {
      await ensureHistories(store, missing.map((row) => row.object_id));
    }
  }
  // Objects the observer never observed are left out of the draft; when none
  // of an object's observations qualifies, Build packet uses the newest one.
  if (store) {
    await ensureHistories(store, detail.objects.filter((row) => !row.qualifying_observation_id).map((row) => row.object_id));
  }
  const recomputed = offline && store
    ? recomputeDetail(detail, { histories: store.histories }, journal)
    : {
        progress: detail.progress,
        following: recomputedFollowing(detail, store),
        objects: detail.objects.map((row) => {
          const found = row.qualifying_observation_id
            ? findObservationInStore(store, row.qualifying_observation_id)
            : null;
          // The fallback observation for a row whose observations do not
          // qualify: the newest of the object's observations.
          const fallback = !row.qualifying_observation_id
            ? newestObservationInStore(store, row.object_id)
            : null;
          return {
            designation: row.designation,
            name: row.name,
            observationId: row.qualifying_observation_id ?? (fallback ? fallback.id : null),
            qualifying: found
              ? { evening_date: found.evening_date, apertureMm: found.derived.aperture_mm, magnification: found.derived.magnification }
              : null,
          };
        }),
      };

  const bar = el("div", {
    class: "progressbar",
    role: "progressbar",
    "aria-label": `Progress toward ${detail.name}`,
    "aria-valuenow": String(recomputed.progress.qualifying),
    "aria-valuemax": String(recomputed.progress.total),
    "aria-valuemin": "0",
  }, el("div", { class: "progressbar-fill", style: `width:${Math.round((recomputed.progress.qualifying / Math.max(recomputed.progress.total, 1)) * 100)}%` }));

  const counts = el("p", { class: "counts", text: programSentences.counts(recomputed.progress.qualifying, recomputed.progress.total, recomputed.progress.required) });
  column.append(bar, counts);

  if (detail.editions.length > 1) {
    const newest = detail.editions[detail.editions.length - 1]!;
    column.append(el("div", { class: "status", role: "status", "aria-label": "Program rules", text: programSentences.edition(newest.edition, newest.effective_from) }));
  }

  const checklist = el("ul", { class: "rows checklist", role: "list", "aria-label": "Checklist" });
  for (const row of recomputed.objects) {
    const muted = row.qualifying
      ? `${row.qualifying.evening_date} · ${apertureDisplay(row.qualifying.apertureMm)} mm · ${row.qualifying.magnification}×`
      : "not yet";
    checklist.append(el("li", { class: "row" },
      el("span", { class: "row-ink", text: `${row.designation}, ${row.name}` }),
      el("span", { class: "row-muted", text: muted }),
    ));
  }

  const buildPacket = el("button", {
    class: "button",
    text: "Build packet",
    onclick: async () => {
      try {
        const packet = await apiPost.createPacket({ program_id: programId, observation_ids: recomputed.objects.filter((row) => row.observationId).map((row) => row.observationId!) });
        if (store) {
          store.packets[packet.id] = packet;
          persist();
        }
        navigate(`/packets/${packet.id}`);
      } catch {
        // Offline or a server error: the packet needs signal.
        column.append(el("p", { class: "banner", text: "That needs signal. Nothing was changed." }));
      }
    },
  });

  const followButton = el("button", {
    class: "button",
    text: recomputed.following ? `Unfollow ${detail.name}` : `Follow ${detail.name}`,
    onclick: async () => {
      const wanted = !recomputed.following;
      recomputed.following = wanted;
      followButton.textContent = wanted ? `Unfollow ${detail.name}` : `Follow ${detail.name}`;
      try {
        const answer = wanted ? await apiPost.follow(programId) : await apiPost.unfollow(programId);
        recomputed.following = answer.following;
        persist();
      } catch {
        recomputed.following = !wanted;
        followButton.textContent = wanted ? `Follow ${detail.name}` : `Unfollow ${detail.name}`;
      }
    },
  });

  column.append(checklist, buildPacket, followButton);
  root.append(column);
}

function apertureDisplay(mm: number): string {
  return Number.isInteger(mm) ? String(mm) : mm.toFixed(1);
}

function recomputedFollowing(detail: ProgramDetail, store: { programs: { id: string; following: boolean }[] } | null | undefined): boolean {
  const summary = store?.programs.find((entry) => entry.id === detail.id);
  return summary ? summary.following : detail.following;
}

async function ensureHistories(store: { histories: Record<string, ObjectHistory> }, objectIds: readonly string[]): Promise<void> {
  for (const objectId of objectIds) {
    if (store.histories[objectId]) continue;
    try {
      store.histories[objectId] = await apiGet.history(objectId);
    } catch {
      // One object failing must not stop the rest.
    }
  }
}

function newestObservationInStore(
  store: { histories: Record<string, { observations: readonly Observation[] }> } | null | undefined,
  objectId: string,
): Observation | null {
  if (!store) return null;
  const history = store.histories[objectId];
  if (!history || history.observations.length === 0) return null;
  // Newest means the latest observed_at; ties go to the one created later, and
  // observations without a time count last.
  const sorted = [...history.observations].sort((a, b) => {
    const at = a.observed_at ?? "";
    const bt = b.observed_at ?? "";
    if (at !== bt) return at < bt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
  return sorted[sorted.length - 1] ?? null;
}

function findObservationInStore(
  store: { histories: Record<string, { observations: readonly Observation[] }> } | null | undefined,
  observationId: string,
): Observation | null {
  if (!store) return null;
  for (const history of Object.values(store.histories)) {
    for (const observation of history.observations) {
      if (observation.id === observationId) return observation;
    }
  }
  return null;
}

interface RecomputedRow {
  readonly designation: string;
  readonly name: string;
  readonly observationId: string | null;
  readonly qualifying: { evening_date: string; apertureMm: number; magnification: number } | null;
}

function recomputeDetail(
  detail: ProgramDetail,
  store: { histories: Record<string, { observations: readonly Observation[] }> } | null | undefined,
  journal: readonly { kind: string; change: SyncChange }[],
): { progress: { qualifying: number; total: number; required: number }; objects: RecomputedRow[]; following: boolean } {
  const editions = detail.editions as readonly RuleEdition[];
  const following = detail.following;
  if (!store || journal.length === 0) {
    return {
      progress: detail.progress,
      following,
      objects: detail.objects.map((row) => ({
        designation: row.designation,
        name: row.name,
        observationId: row.qualifying_observation_id,
        qualifying: row.qualifying_observation_id
          ? qualifyingDisplay(store, row.qualifying_observation_id)
          : null,
      })),
    };
  }
  // Apply queued changes onto the device copy, then re-run the rule.
  const observations = new Map<string, Observation>();
  for (const history of Object.values(store.histories)) {
    for (const observation of history.observations) {
      observations.set(observation.id, { ...observation });
    }
  }
  const deletedIds = new Set<string>();
  for (const entry of journal) {
    const change = entry.change;
    if (entry.kind === "observation.delete" && change.observation_id) deletedIds.add(change.observation_id);
    else if (entry.kind === "observation.update" && change.observation_id) {
      const observation = observations.get(change.observation_id);
      if (observation && change.fields) {
        observations.set(change.observation_id, applyQueued(observation, change.fields));
      }
    } else if (entry.kind === "observation.create" && change.observation_id) {
      const objectRow = detail.objects.find((row) => row.object_id === change.object_id);
      if (objectRow) {
        observations.set(change.observation_id, {
          id: change.observation_id,
          session_id: change.session_id ?? "",
          object_id: change.object_id ?? "",
          designation: objectRow.designation,
          kind: "globular",
          observed_at: (change.fields?.["observed_at"] as string | null | undefined) ?? null,
          local_time: null,
          local_offset: null,
          evening_date: "",
          site: { id: "", name: "", time_zone: "" },
          seeing: (change.fields?.["seeing"] as number | null | undefined) ?? null,
          transparency_nelm: (change.fields?.["transparency_nelm"] as number | null | undefined) ?? null,
          concentration_class: (change.fields?.["concentration_class"] as string | null | undefined) ?? null,
          pair: null,
          description: (change.fields?.["description"] as string | undefined) ?? "",
          optics: { telescope_id: "", eyepiece_id: "", barlow_id: null, train: "straight" },
          derived: { aperture_mm: 0, magnification: 0, true_field_arcmin: 0, exit_pupil_mm: 0, orientation: { train: "straight", rotation_deg: 0, mirrored: false, sentence: "" } },
          sketch: null,
          version: 0,
        });
      }
    }
  }
  const byObject = new Map<string, Observation[]>();
  for (const observation of observations.values()) {
    if (deletedIds.has(observation.id)) continue;
    if (!observation.evening_date) continue;
    const list = byObject.get(observation.object_id) ?? [];
    list.push(observation);
    byObject.set(observation.object_id, list);
  }
  const rows: RecomputedRow[] = detail.objects.map((row) => {
    const candidates = byObject.get(row.object_id) ?? [];
    let best: Observation | null = null;
    for (const candidate of candidates) {
      const edition = editionForDate(editions, candidate.evening_date);
      const ok = observationQualifies(candidate, edition);
      if (!ok) continue;
      if (!best || (candidate.observed_at ?? "") > (best.observed_at ?? "")) best = candidate;
    }
    // When none qualifies, Build packet uses the newest observation of the
    // object, with observations that have no time counted last.
    let fallback: Observation | null = null;
    if (!best && candidates.length > 0) {
      fallback = candidates.reduce((newest: Observation, candidate: Observation) => {
        const newestTime = newest.observed_at ?? "";
        const candidateTime = candidate.observed_at ?? "";
        if (candidateTime !== "" && (newestTime === "" || candidateTime > newestTime)) return candidate;
        return newest;
      });
    }
    return {
      designation: row.designation,
      name: row.name,
      observationId: best ? best.id : (fallback ? fallback.id : null),
      qualifying: best ? { evening_date: best.evening_date, apertureMm: best.derived.aperture_mm, magnification: best.derived.magnification } : null,
    };
  });
  const qualifying = rows.filter((row) => row.qualifying).length;
  return { progress: { qualifying, total: detail.progress.total, required: detail.progress.required }, objects: rows, following };
}

function observationQualifies(observation: Observation, edition: RuleEdition): boolean {
  return qualifies({
    hasUtTime: observation.observed_at !== null,
    seeing: observation.seeing,
    transparencyNelm: observation.transparency_nelm,
    description: observation.description,
    hasSketch: observation.sketch !== null,
    concentrationClass: observation.concentration_class,
    hasPair: observation.pair !== null,
    kind: observation.kind,
  }, [edition], observation.evening_date);
}

function qualifyingDisplay(
  store: { histories: Record<string, { observations: readonly Observation[] }> } | null | undefined,
  observationId: string,
): { evening_date: string; apertureMm: number; magnification: number } | null {
  if (!store) return null;
  for (const history of Object.values(store.histories)) {
    for (const observation of history.observations) {
      if (observation.id === observationId) {
        return { evening_date: observation.evening_date, apertureMm: observation.derived.aperture_mm, magnification: observation.derived.magnification };
      }
    }
  }
  return null;
}

function applyQueued(observation: Observation, fields: Record<string, unknown>): Observation {
  const next = { ...observation };
  if ("observed_at" in fields) next.observed_at = (fields["observed_at"] as string | null) ?? null;
  if ("seeing" in fields) next.seeing = (fields["seeing"] as number | null) ?? null;
  if ("transparency_nelm" in fields) next.transparency_nelm = (fields["transparency_nelm"] as number | null) ?? null;
  if ("description" in fields) next.description = (fields["description"] as string) ?? "";
  if ("concentration_class" in fields) next.concentration_class = (fields["concentration_class"] as string | null) ?? null;
  if ("pair" in fields) next.pair = (fields["pair"] as Observation["pair"]) ?? null;
  return next;
}
