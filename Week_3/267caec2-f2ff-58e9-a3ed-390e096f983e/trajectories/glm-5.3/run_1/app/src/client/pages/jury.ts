import { get, post, put } from "../api.js";
import { h, deskError, deskErrorFrom, deskStatusAuto, openDialog, withPending } from "../ui.js";
import { setBand } from "../band.js";
import { navigate } from "../main.js";

interface JurorRound {
  id: string;
  name: string;
  categoryName: string;
  ballotDeadlineLabel: string | null;
  assigned: number;
  remaining: number;
  ballotSubmitted: boolean;
}

export async function renderJury(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Jury", countdownIso: null });
  main.textContent = "";
  main.append(h("h1", { class: "page-title", text: "Jury" }));
  const rounds = (await get<{ rounds: JurorRound[] }>("/api/juror/rounds")).rounds;
  main.append(h("p", {}, h("a", { href: "/jury/conflicts", text: "Conflicts" })));
  if (rounds.length === 0) {
    main.append(h("p", { class: "no-results", text: "No open rounds on your desk right now." }));
    return;
  }
  for (const round of rounds) {
    main.append(
      h("p", {},
        h("a", { href: `/jury/rounds/${round.id}`, text: `${round.categoryName} — ${round.name}` }),
        h("span", { class: "mono", text: `   ${round.ballotDeadlineLabel ?? ""} — ${round.ballotSubmitted ? "Ballot submitted" : `${round.remaining} left to score`}` }),
      ),
    );
  }
}

export async function renderConflicts(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Jury", countdownIso: null });
  main.textContent = "";
  main.append(h("h1", { class: "page-title", text: "Conflicts" }));
  const studios = (await get<{ studios: { id: string; name: string }[] }>("/api/studios")).studios;
  const conflicts = (await get<{ conflicts: { studioId: string; studioName: string; note: string | null; declaredAt: string }[] }>("/api/conflicts")).conflicts;

  const studioSelect = h("select", { name: "studioId", "aria-label": "Studio", id: "conflict-studio" }) as HTMLSelectElement;
  for (const studio of studios) {
    studioSelect.append(h("option", { value: studio.id, text: studio.name }));
  }
  const note = h("input", { type: "text", name: "note", "aria-label": "Note", id: "conflict-note" }) as HTMLInputElement;
  const declare = h("button", { class: "primary", type: "submit", text: "Declare conflict" }) as HTMLButtonElement;
  const form = h("form", { class: "panel", "aria-label": "Declare a conflict" },
    h("label", { class: "field", for: "conflict-studio" }, h("span", { text: "Studio" }), studioSelect),
    h("label", { class: "field", for: "conflict-note" }, h("span", { text: "Note" }), note),
    declare,
  ) as HTMLFormElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(declare, "Recording conflict…", async () => {
        const result = await post<{ conflict: { studioName: string }; removedAssignments: number }>("/api/conflicts", {
          studioId: studioSelect.value,
          note: note.value || undefined,
        }, undefined);
        deskStatusAuto(`Conflict with ${result.conflict.studioName} recorded. ${result.removedAssignments} assignments removed.`);
        await navigate("/jury/conflicts", true);
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  });

  const list = h("ul", { "aria-label": "Declared conflicts" });
  for (const conflict of conflicts) {
    list.append(h("li", { text: `${conflict.studioName}${conflict.note ? ` — ${conflict.note}` : ""}` }));
  }
  main.append(form, h("h2", { class: "section-title", text: "Declared conflicts" }), list);
}

interface BlindEntry {
  entryId: string;
  entryNumber: number;
  title: string;
  summary: string;
  images: { url: string; width: number; height: number }[];
  scores: { craft: number; clarity: number; idea: number; story: number } | null;
}

interface BallotResponse {
  round: { id: string; name: string; categoryName: string; ballotDeadlineLabel: string | null; ballotDeadlineAt?: string | null; state: string };
  entries: BlindEntry[];
  assigned: number;
  scored: number;
  remaining: number;
  submitted: boolean;
}

export async function renderBallot(main: HTMLElement, roundId: string): Promise<void> {
  main.textContent = "";
  const ballot = await get<BallotResponse>(`/api/rounds/${roundId}/ballot`);
  setBand({
    contextName: `${ballot.round.categoryName} — ${ballot.round.name}`,
    countdownIso: ballot.round.state === "open" ? (ballot.round as { ballotDeadlineAt?: string | null }).ballotDeadlineAt ?? null : null,
  });
  // The ballot deadline label already carries the program's zone.
  main.append(h("h1", { class: "page-title", text: `${ballot.round.categoryName} — ${ballot.round.name}` }));
  if (ballot.round.ballotDeadlineLabel) {
    main.append(h("p", { class: "mono", text: `Ballot deadline: ${ballot.round.ballotDeadlineLabel}` }));
  }
  if (ballot.submitted) {
    main.append(h("p", { class: "notice", text: "Ballot submitted" }));
  }

  const summary = h("span", { class: "summary mono", "aria-live": "polite", text: `${ballot.scored} of ${ballot.assigned} scored` });
  const submit = h("button", { class: "primary", type: "button", text: "Submit final ballot" }) as HTMLButtonElement;
  submit.disabled = ballot.remaining > 0 || ballot.submitted;

  let state = { remaining: ballot.remaining, scored: ballot.scored, submitted: ballot.submitted };

  const updateSummary = () => {
    summary.textContent = `${state.scored} of ${ballot.assigned} scored`;
    submit.disabled = state.submitted || state.remaining > 0;
  };

  for (const entry of ballot.entries) {
    main.append(await ballotEntry(ballot.submitted || ballot.round.state !== "open", entry, () => updateSummary(), () => state, (patch) => {
      state = { ...state, ...patch };
      updateSummary();
    }, roundId));
  }

  const bar = h("div", { class: "ballot-bar" }, summary, submit);
  main.append(bar);

  submit.addEventListener("click", () => {
    openDialog({
      title: "Submit final ballot?",
      body: "You can't change scores after submitting.",
      actions: [
        { label: "Keep scoring", value: "keep", kind: "plain" },
        { label: "Submit ballot", value: "submit", kind: "primary" },
      ],
      safeValue: "keep",
      onChoose: async (value) => {
        if (value !== "submit") {
          return;
        }
        try {
          await withPending(submit, "Submitting your ballot…", async () => {
            const result = await post<{ counted: number }>(`/api/rounds/${roundId}/ballot/submit`);
            state = { ...state, submitted: true, remaining: 0 };
            updateSummary();
            deskStatusAuto(`Ballot submitted. ${result.counted} entries scored.`);
            await navigate(`/jury/rounds/${roundId}`, true);
          });
        } catch (error) {
          deskError(deskErrorFrom(error));
        }
      },
    });
  });
}

async function ballotEntry(
  locked: boolean,
  entry: BlindEntry,
  refresh: () => void,
  getState: () => { remaining: number; scored: number },
  patchState: (patch: { remaining?: number; scored?: number }) => void,
  roundId: string,
): Promise<HTMLElement> {
  const article = h("article", { class: "ballot-entry", "aria-label": `Entry ${entry.entryNumber}` },
    h("h3", { text: `Entry ${entry.entryNumber}` }),
    h("p", { text: entry.title }),
    h("p", { text: entry.summary }),
  );
  const images = h("div", { class: "entry-images" });
  for (const image of entry.images) {
    images.append(h("img", { src: image.url, alt: `Entry ${entry.entryNumber} image`, width: String(image.width), height: String(image.height) }));
  }
  article.append(images);

  const group = h("div", { class: "score-group", role: "group", "aria-label": `Scores for Entry ${entry.entryNumber}` });
  const inputs: Record<string, HTMLInputElement> = {};
  for (const criterion of ["Craft", "Clarity", "Idea", "Story"]) {
    const key = criterion.toLowerCase();
    const input = h("input", {
      type: "number",
      class: "score-input",
      min: "1",
      max: "10",
      step: "1",
      value: entry.scores ? String(entry.scores[key as keyof typeof entry.scores]) : "",
      "aria-label": criterion,
      name: `${key}-${entry.entryId}`,
      disabled: locked ? true : undefined,
      readOnly: locked ? true : undefined,
    }) as HTMLInputElement;
    // Arrow Up and Down change by 1; Home sets 1, End sets 10.
    input.addEventListener("keydown", (event) => {
      const current = Number(input.value || "5");
      if (event.key === "ArrowUp") {
        event.preventDefault();
        input.value = String(Math.min(10, current + 1));
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        input.value = String(Math.max(1, current - 1));
      } else if (event.key === "Home") {
        event.preventDefault();
        input.value = "1";
      } else if (event.key === "End") {
        event.preventDefault();
        input.value = "10";
      }
    });
    inputs[key] = input;
    group.append(h("label", { class: "field" }, h("span", { text: criterion }), input));
  }
  article.append(group);

  function ballotScored(): number {
    return state.scored;
  }

  const save = h("button", { type: "button", text: `Save scores for Entry ${entry.entryNumber}` }) as HTMLButtonElement;
  save.addEventListener("click", async () => {
    try {
      await withPending(save, "Saving scores…", async () => {
        const result = await put<{ remaining: number }>(`/api/rounds/${roundId}/scores/${entry.entryId}`, {
          craft: Number(inputs.craft.value),
          clarity: Number(inputs.clarity.value),
          idea: Number(inputs.idea.value),
          story: Number(inputs.story.value),
        });
        entry.scores = { craft: Number(inputs.craft.value), clarity: Number(inputs.clarity.value), idea: Number(inputs.idea.value), story: Number(inputs.story.value) };
        const scored = ballotScored();
        patchState({ remaining: result.remaining, scored });
        deskStatusAuto(`Scores saved for Entry ${entry.entryNumber}. ${result.remaining} left to score.`);
        refresh();
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  });

  const recuse = h("button", { type: "button", class: "danger", text: `Recuse from Entry ${entry.entryNumber}` }) as HTMLButtonElement;
  recuse.addEventListener("click", () => {
    openDialog({
      title: `Recuse from Entry ${entry.entryNumber}?`,
      body: "Your scores for this entry will not count.",
      fields: [{ name: "note", label: "Note" }],
      actions: [
        { label: "Cancel", value: "cancel", kind: "plain" },
        { label: "Recuse", value: "recuse", kind: "danger" },
      ],
      safeValue: "cancel",
      onChoose: async (value, fields) => {
        if (value !== "recuse") {
          return;
        }
        try {
          await withPending(recuse, "Recusing…", async () => {
            const result = await post<{ remaining: number }>(`/api/rounds/${roundId}/entries/${entry.entryId}/recuse`, { note: fields.note || undefined });
            patchState({ remaining: result.remaining, scored: ballotScored() });
            deskStatusAuto(`You've recused from Entry ${entry.entryNumber}.`);
            await navigate(`/jury/rounds/${roundId}`, true);
          });
        } catch (error) {
          deskError(deskErrorFrom(error));
        }
      },
    });
  });

  const state = getState();

  article.append(h("div", { class: "actions-row" }, save, recuse));
  return article;
}
