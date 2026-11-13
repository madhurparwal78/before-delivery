// Programs: the list with Follow/Unfollow, computed offline too (DP-72, DP-89).
import { app, navigate, persist } from "../app.js";
import { el } from "../dom.js";
import { apiGet, apiPost } from "../api.js";
import { shell } from "./shell.js";
import { programSentences } from "../../shared/sentences.js";
import type { ProgramSummary } from "../../shared/api.js";

export async function renderPrograms(root: HTMLElement): Promise<void> {
  const parts = shell("Programs", []);
  const column = parts.column;
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null);
  const store = accountId ? app.state.stores[accountId] : null;
  const journal = accountId ? (app.state.journals[accountId] ?? []) : [];

  const statusRegion = el("div", { class: "status", role: "status", "aria-label": "Programs status" });
  const inFlight = new Set<string>();

  type MutableProgram = { id: string; name: string; following: boolean; progress: { qualifying: number; total: number; required: number } };

  const renderLists = (programs: MutableProgram[]): void => {
    lists.textContent = "";
    const followed = programs.filter((p) => p.following);
    const yours = el("ul", { class: "rows", role: "list", "aria-label": "Your programs" });
    if (followed.length === 0) {
      yours.append(el("li", { class: "empty-sentence", text: programSentences.empty }));
    }
    for (const program of followed) {
      yours.append(programRow(program));
    }
    const all = el("ul", { class: "rows", role: "list", "aria-label": "All programs" });
    for (const program of programs) {
      all.append(programRow(program));
    }
    lists.append(
      el("h2", { class: "subheading", text: "Your programs" }),
      yours,
      el("h2", { class: "subheading", text: "All programs" }),
      all,
    );
  };

  const programRow = (program: MutableProgram): HTMLElement => {
    const button = el("button", { class: "button", text: program.following ? `Unfollow ${program.name}` : `Follow ${program.name}` });
    button.addEventListener("click", async () => {
      const programId = program.id;
      if (inFlight.has(programId)) return;
      inFlight.add(programId);
      const wanted = !program.following;
      program.following = wanted;
      button.textContent = wanted ? `Unfollow ${program.name}` : `Follow ${program.name}`;
      statusRegion.textContent = wanted ? programSentences.followed(program.name) : programSentences.unfollowed(program.name);
      try {
        const answer = wanted ? await apiPost.follow(programId) : await apiPost.unfollow(programId);
        program.following = answer.following;
        if (program.following !== wanted) {
          // Only the newest press stands; the server answered the older one.
          program.following = wanted;
          const answer2 = wanted ? await apiPost.follow(programId) : await apiPost.unfollow(programId);
          program.following = answer2.following;
        }
        persist();
      } catch {
        if (!navigator.onLine) {
          program.following = !wanted;
          statusRegion.textContent = programSentences.noSignal(program.name);
        } else {
          program.following = !wanted;
          statusRegion.textContent = "Something went wrong on our side. Nothing was lost; try again.";
        }
      } finally {
        inFlight.delete(programId);
        button.textContent = program.following ? `Unfollow ${program.name}` : `Follow ${program.name}`;
        renderLists(store?.programs ?? []);
      }
    });
    return el("li", { class: "row program-row" },
      el("div", { class: "row-main" },
        el("a", {
          class: "row-ink link", text: program.name, href: `/programs/${program.id}`,
          onclick: (event: MouseEvent) => {
            event.preventDefault();
            navigate(`/programs/${program.id}`);
          },
        }),
        el("span", { class: "row-muted", text: programSentences.counts(program.progress.qualifying, program.progress.total, program.progress.required) }),
      ),
      button,
    );
  };

  const lists = el("div");
  const programs: MutableProgram[] = offlinePrograms(store, journal);
  renderLists(programs);
  column.append(statusRegion, lists);
  root.append(column);

  if (app.account && navigator.onLine) {
    void refresh();
  }

  async function refresh(): Promise<void> {
    try {
      const answer = await apiGet.programs();
      const store = app.state.stores[app.state.signedInAccountId!] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      store.programs = answer.programs;
      persist();
      renderLists(answer.programs.map((program) => ({ ...program, following: program.following, progress: { ...program.progress } })));
    } catch {
      // Offline: keep the device copy.
    }
  }
}

// While offline or with changes queued, counts come from the device copy;
// the Program screen recomputes its own checklist and counts with the same
// rule as the server (DP-89), so this list only needs the stored summaries.
export function offlinePrograms(
  store: { programs: ProgramSummary[] } | null | undefined,
  journal: readonly { kind: string }[],
): { id: string; name: string; following: boolean; progress: { qualifying: number; total: number; required: number } }[] {
  if (!store) return [];
  void journal;
  return store.programs.map((p) => ({ ...p, following: p.following, progress: { ...p.progress } }));
}
