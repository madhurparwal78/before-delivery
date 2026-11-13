import { get, patch, post } from "../api.js";
import { h, deskError, deskErrorFrom, deskStatusAuto, openDialog, withPending } from "../ui.js";
import { setBand } from "../band.js";
import { navigate } from "../main.js";
import { cutShuffle, renderRows, renderStatic, type RowData, type RowState, type ShuffleOptions } from "../shuffle.js";

interface ProgramView {
  id: string;
  name: string;
  year: number;
  timeZone: string;
  earlyBirdDate: string;
  deadlineDate: string;
  earlyBirdLabel: string;
  deadlineLabel: string;
  deadlineAt: string;
  entriesOpen: boolean;
  currentFeeCents: number;
  currentTier: string;
  categories: { id: string; name: string; rounds: { id: string; name: string; kind: string; state: string }[] }[];
}

interface RoundView {
  id: string;
  categoryId: string;
  name: string;
  kind: string;
  state: string;
  ballotDeadline: string | null;
  ballotDeadlineLabel: string | null;
  ballotDeadlineAt: string | null;
}

interface PanelRowView {
  jurorId: string;
  name: string;
  assigned: number;
  scored: number;
  remaining: number;
  ballotSubmitted: boolean;
}

interface StandingsRow {
  rank: number;
  entryId: string;
  entryNumber: number;
  title: string;
  categoryName: string;
  score: string | null;
  cut: "above" | "below";
  award: string | null;
}

interface StandingsView {
  provisional: boolean;
  cut: number;
  cutLabel: string;
  rows: StandingsRow[];
}

const ZONES = [
  "UTC",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export async function renderDirectorHome(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Director", countdownIso: null });
  main.textContent = "";
  main.append(h("h1", { class: "page-title", text: "Director" }));
  const programs = (await get<{ programs: ProgramView[] }>("/api/programs")).programs;

  const list = h("ul");
  for (const program of programs) {
    list.append(h("li", {}, h("a", { href: `/director/programs/${program.id}`, text: `${program.name} ${program.year}` })));
  }
  main.append(h("h2", { class: "section-title", text: "Programs" }), list);

  const name = h("input", { type: "text", name: "name", id: "program-name" }) as HTMLInputElement;
  const year = h("input", { type: "number", name: "year", id: "program-year", class: "score-input", min: "2000", max: "2100" }) as HTMLInputElement;
  const zone = h("select", { name: "timeZone", id: "program-zone" }) as HTMLSelectElement;
  for (const z of ZONES) {
    zone.append(h("option", { value: z, text: z }));
  }
  const earlyBird = h("input", { type: "date", name: "earlyBirdDate", id: "program-early" }) as HTMLInputElement;
  const deadline = h("input", { type: "date", name: "deadlineDate", id: "program-deadline" }) as HTMLInputElement;
  const earlyFee = h("input", { type: "text", name: "earlyBirdFee", id: "program-early-fee" }) as HTMLInputElement;
  const standardFee = h("input", { type: "text", name: "standardFee", id: "program-standard-fee" }) as HTMLInputElement;
  const create = h("button", { class: "primary", type: "submit", text: "Create program" }) as HTMLButtonElement;
  const form = h("form", { class: "panel", "aria-label": "New program" },
    h("h2", { class: "section-title", text: "New program" }),
    h("label", { class: "field", for: "program-name" }, h("span", { text: "Program name" }), name),
    h("label", { class: "field", for: "program-year" }, h("span", { text: "Year" }), year),
    h("label", { class: "field", for: "program-zone" }, h("span", { text: "Time zone" }), zone),
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "program-early" }, h("span", { text: "Early-bird ends" }), earlyBird),
      h("label", { class: "field", for: "program-deadline" }, h("span", { text: "Entries close" }), deadline),
    ),
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "program-early-fee" }, h("span", { text: "Early-bird fee" }), earlyFee),
      h("label", { class: "field", for: "program-standard-fee" }, h("span", { text: "Standard fee" }), standardFee),
    ),
    create,
  ) as HTMLFormElement;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(create, "Creating program…", async () => {
        const result = await post<{ program: ProgramView }>("/api/programs", {
          name: name.value,
          year: Number(year.value),
          timeZone: zone.value,
          earlyBirdDate: earlyBird.value,
          deadlineDate: deadline.value,
          earlyBirdFeeCents: Math.round(Number(earlyFee.value) * 100),
          standardFeeCents: Math.round(Number(standardFee.value) * 100),
        });
        deskStatusAuto("Program created.");
        await navigate(`/director/programs/${result.program.id}`);
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
      const first = error instanceof Error && "errors" in error ? Object.values((error as unknown as { errors: Record<string, string> }).errors)[0] : null;
      if (first) {
        deskError(String(first));
      }
    }
  });
  main.append(form);
  main.append(h("p", {}, h("a", { href: "/director/audit", text: "Director actions" })));
}

export async function renderDirectorProgram(main: HTMLElement, programId: string): Promise<void> {
  main.textContent = "";
  const programs = (await get<{ programs: ProgramView[] }>("/api/programs")).programs;
  const program = programs.find((p) => p.id === programId);
  if (!program) {
    deskError("We couldn't find that.");
    await navigate("/director");
    return;
  }
  setBand({
    contextName: program.name,
    countdownIso: program.entriesOpen ? program.deadlineAt : null,
  });
  main.append(h("h1", { class: "page-title", text: program.name }));

  const earlyBird = h("input", { type: "date", value: program.earlyBirdDate, id: "edit-early", "aria-label": "Early-bird ends" }) as HTMLInputElement;
  const deadline = h("input", { type: "date", value: program.deadlineDate, id: "edit-deadline", "aria-label": "Entries close" }) as HTMLInputElement;
  const updateDates = h("button", { class: "primary", type: "submit", text: "Update dates" }) as HTMLButtonElement;
  const dateForm = h("form", { class: "panel", "aria-label": "Program dates" },
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "edit-early" }, h("span", { text: "Early-bird ends" }), earlyBird),
      h("label", { class: "field", for: "edit-deadline" }, h("span", { text: "Entries close" }), deadline),
    ),
    updateDates,
  ) as HTMLFormElement;
  dateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(updateDates, "Updating dates…", async () => {
        await patch(`/api/programs/${programId}`, { earlyBirdDate: earlyBird.value, deadlineDate: deadline.value });
        deskStatusAuto("Dates updated.");
        await navigate(`/director/programs/${programId}`, true);
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  });
  main.append(dateForm);

  // Add category.
  const categoryName = h("input", { type: "text", id: "category-name", "aria-label": "Category name" }) as HTMLInputElement;
  const shortlist = h("input", { type: "number", class: "score-input", id: "category-shortlist", min: "1", max: "50", "aria-label": "Shortlist size" }) as HTMLInputElement;
  const finalists = h("input", { type: "number", class: "score-input", id: "category-finalists", min: "1", max: "50", "aria-label": "Finalists" }) as HTMLInputElement;
  const addCategory = h("button", { class: "primary", type: "submit", text: "Add category" }) as HTMLButtonElement;
  const categoryForm = h("form", { class: "panel", "aria-label": "Add category" },
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "category-name" }, h("span", { text: "Category name" }), categoryName),
      h("label", { class: "field", for: "category-shortlist" }, h("span", { text: "Shortlist size" }), shortlist),
      h("label", { class: "field", for: "category-finalists" }, h("span", { text: "Finalists" }), finalists),
    ),
    addCategory,
  ) as HTMLFormElement;
  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(addCategory, "Adding category…", async () => {
        await post(`/api/programs/${programId}/categories`, {
          name: categoryName.value,
          shortlistSize: Number(shortlist.value),
          finalistCount: Number(finalists.value),
        });
        deskStatusAuto("Category added.");
        await navigate(`/director/programs/${programId}`, true);
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  });
  main.append(categoryForm);

  // Categories and their rounds.
  main.append(h("h2", { class: "section-title", text: "Categories" }));
  const summary = await get<{ categories: { id: string; name: string; counts: Record<string, number>; rounds: { id: string; name: string; state: string; panel: PanelRowView[] }[] }[] }>(`/api/programs/${programId}/summary`);
  for (const category of summary.categories) {
    main.append(h("h3", {}, h("a", { href: `/director/categories/${category.id}`, text: category.name })));
    const stateCounts = h("table", { class: "ranked", "aria-label": "Entries by state" });
    stateCounts.append(h("thead", {}, h("tr", {}, h("th", { text: "State" }), h("th", { text: "Count" }))));
    const stateBody = h("tbody");
    for (const [state, count] of Object.entries(category.counts)) {
      stateBody.append(h("tr", {}, h("td", { text: state }), h("td", { class: "cell-rank", text: String(count) })));
    }
    stateCounts.append(stateBody);
    main.append(stateCounts);
    for (const round of category.rounds) {
      const panelRows = round.panel.map((p) => `${p.name} ${p.assigned}/${p.scored}`).join(", ");
      main.append(h("p", {}, h("a", { href: `/director/rounds/${round.id}`, text: `${category.name} — ${round.name}` }), h("span", { class: "mono", text: `   ${round.state}${panelRows ? ` · ${panelRows}` : ""}` })));
    }
  }

  // New juror form.
  const jurors = (await get<{ jurors: { id: string; name: string; email: string }[] }>("/api/jurors")).jurors;
  const studios = (await get<{ studios: { id: string; name: string }[] }>("/api/studios")).studios;
  const jurorName = h("input", { type: "text", id: "juror-name", "aria-label": "Juror name" }) as HTMLInputElement;
  const jurorEmail = h("input", { type: "email", id: "juror-email", "aria-label": "Juror email" }) as HTMLInputElement;
  const jurorPassword = h("input", { type: "password", id: "juror-password", "aria-label": "Juror password" }) as HTMLInputElement;
  const homeStudio = h("select", { id: "juror-studio", "aria-label": "Home studio" }) as HTMLSelectElement;
  homeStudio.append(h("option", { value: "", text: "None" }));
  for (const studio of studios) {
    homeStudio.append(h("option", { value: studio.id, text: studio.name }));
  }
  const createJuror = h("button", { class: "primary", type: "submit", text: "Create juror" }) as HTMLButtonElement;
  const jurorForm = h("form", { class: "panel", "aria-label": "New juror" },
    h("h2", { class: "section-title", text: "New juror" }),
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "juror-name" }, h("span", { text: "Juror name" }), jurorName),
      h("label", { class: "field", for: "juror-email" }, h("span", { text: "Juror email" }), jurorEmail),
    ),
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "juror-password" }, h("span", { text: "Juror password" }), jurorPassword),
      h("label", { class: "field", for: "juror-studio" }, h("span", { text: "Home studio" }), homeStudio),
    ),
    createJuror,
  ) as HTMLFormElement;
  jurorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(createJuror, "Creating juror…", async () => {
        await post("/api/jurors", {
          name: jurorName.value,
          email: jurorEmail.value,
          password: jurorPassword.value,
          studioId: homeStudio.value || null,
        });
        deskStatusAuto("Juror account created.");
        jurorName.value = "";
        jurorEmail.value = "";
        jurorPassword.value = "";
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  });
  main.append(jurorForm);

  const jurorList = h("ul");
  for (const juror of jurors) {
    jurorList.append(h("li", { text: `${juror.name} — ${juror.email}` }));
  }
  main.append(jurorList);
}

export async function renderDirectorCategory(main: HTMLElement, categoryId: string): Promise<void> {
  main.textContent = "";
  const programs = (await get<{ programs: ProgramView[] }>("/api/programs")).programs;
  const entries = (await get<{ entries: (EntryDirectorView & { studioName: string })[] }>(`/api/categories/${categoryId}/entries`)).entries;
  const category = findCategory(programs, categoryId);
  setBand({ contextName: category?.name ?? "Director", countdownIso: null });
  main.append(h("h1", { class: "category-header", text: category?.name ?? "Category" }));

  const table = h("table", { class: "ranked", "aria-label": "Entries" }) as HTMLTableElement;
  table.append(h("thead", {}, h("tr", {},
    h("th", { text: "Entry" }),
    h("th", { text: "Studio" }),
    h("th", { text: "Status" }),
    h("th", { text: "Actions" }),
  )));
  const tbody = h("tbody");
  for (const entry of entries) {
    const actions = h("td");
    if (entry.state === "submitted") {
      actions.append(h("button", { type: "button", text: `Pass Entry ${entry.entryNumber}`, onclick: async (event: MouseEvent) => {
        await screenEntry(entry.id, "pass", event);
      } }));
      actions.append(document.createTextNode(" "));
      actions.append(disqualifyButton(entry, categoryId));
    } else if (entry.state === "screened" || entry.state === "disqualified") {
      if (entry.state === "screened") {
        actions.append(disqualifyButton(entry, categoryId));
      }
      if (entry.state === "disqualified") {
        actions.append(h("button", { type: "button", text: `Reinstate Entry ${entry.entryNumber}`, onclick: async (event: MouseEvent) => {
          const button = event.currentTarget as HTMLButtonElement;
          try {
            await withPending(button, "Reinstating…", async () => {
              await post(`/api/entries/${entry.id}/reinstate`);
              deskStatusAuto(`Entry ${entry.entryNumber} reinstated.`);
              await navigate(`/director/categories/${categoryId}`, true);
            });
          } catch (error) {
            deskError(deskErrorFrom(error));
          }
        } }));
      }
    }
    tbody.append(h("tr", {},
      h("td", { class: "cell-title" }, h("a", { href: `/studio/entries/${entry.id}`, text: `${entry.entryNumber}. ${entry.title}` }), h("span", { class: "cell-sub", style: "display:block", text: `${entry.studioName} · ${entry.studioEmail}` })),
      h("td", { text: entry.studioName }),
      h("td", {}, entry.state === "disqualified" ? disqualifiedMarker(entry.disqualifyReason ?? "") : h("span", { text: entry.statusLabel })),
      actions,
    ));
  }
  table.append(tbody);
  main.append(table);

  // Publish form.
  const zone = category ? programs.find((p) => p.id === category.programId)?.timeZone : "UTC";
  const embargo = h("input", { type: "text", id: "embargo-time", "aria-label": `Embargo time (${zone})`, placeholder: "2026-11-02T18:30:00+01:00" }) as HTMLInputElement;
  const publish = h("button", { class: "primary", type: "button", text: "Publish results" }) as HTMLButtonElement;
  publish.addEventListener("click", () => {
    openDialog({
      title: `Publish ${category?.name ?? ""} results?`,
      actions: [
        { label: "Cancel", value: "cancel", kind: "plain" },
        { label: "Publish", value: "publish", kind: "primary" },
      ],
      safeValue: "cancel",
      onChoose: async (value) => {
        if (value !== "publish") {
          return;
        }
        try {
          await withPending(publish, "Publishing…", async () => {
            const result = await post<{ category: { embargoLabel: string } }>(`/api/categories/${categoryId}/publish`, { embargoAt: embargo.value });
            deskStatusAuto(`Results scheduled for ${result.category.embargoLabel}.`);
            await navigate(`/director/categories/${categoryId}`, true);
          });
        } catch (error) {
          deskError(deskErrorFrom(error));
        }
      },
    });
  });
  main.append(h("div", { class: "panel" },
    h("h2", { class: "section-title", text: "Publish" }),
    h("label", { class: "field", for: "embargo-time" }, h("span", { text: `Embargo time (${zone})` }), embargo),
    publish,
  ));

  async function screenEntry(entryId: string, decision: "pass", event: MouseEvent): Promise<void> {
    const button = event.currentTarget as HTMLButtonElement;
    try {
      await withPending(button, "Passing…", async () => {
        await post(`/api/entries/${entryId}/screen`, { decision });
        deskStatusAuto(`Entry screened.`);
        await navigate(`/director/categories/${categoryId}`, true);
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  }
}

interface EntryDirectorView {
  id: string;
  entryNumber: number;
  title: string;
  state: string;
  statusLabel: string;
  disqualifyReason: string | null;
  studioEmail: string;
}

function disqualifyButton(entry: EntryDirectorView, categoryId: string): HTMLElement {
  const button = h("button", { type: "button", class: "danger", text: `Disqualify Entry ${entry.entryNumber}` }) as HTMLButtonElement;
  button.addEventListener("click", () => {
    openDialog({
      title: `Disqualify Entry ${entry.entryNumber}`,
      fields: [{ name: "reason", label: "Reason" }],
      actions: [
        { label: "Cancel", value: "cancel", kind: "plain" },
        { label: "Disqualify", value: "disqualify", kind: "danger" },
      ],
      safeValue: "cancel",
      onChoose: async (value, fields) => {
        if (value !== "disqualify") {
          return;
        }
        try {
          await withPending(button, "Disqualifying…", async () => {
            await post(`/api/entries/${entry.id}/screen`, { decision: "disqualify", reason: fields.reason });
            deskStatusAuto(`Entry ${entry.entryNumber} disqualified.`);
            await navigate(`/director/categories/${categoryId}`, true);
          });
        } catch (error) {
          deskError(deskErrorFrom(error));
        }
      },
    });
  });
  return button;
}

function disqualifiedMarker(reason: string): HTMLElement {
  const holder = h("span", { class: "status-marker marker-disqualified" });
  holder.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  holder.append(`Disqualified${reason ? ` — ${reason}` : ""}`);
  return holder;
}

function findCategory(programs: ProgramView[], categoryId: string): { id: string; name: string; programId: string } | null {
  for (const program of programs) {
    for (const category of program.categories) {
      if (category.id === categoryId) {
        return { id: category.id, name: category.name, programId: program.id };
      }
    }
  }
  return null;
}

export async function renderDirectorRound(main: HTMLElement, roundId: string): Promise<void> {
  main.textContent = "";
  const programs = (await get<{ programs: ProgramView[] }>("/api/programs")).programs;
  const roundDetail = await get<{ round: RoundView; panel: PanelRowView[] }>(`/api/rounds/${roundId}`);
  const round = roundDetail.round;
  setBand({
    contextName: `${categoryFor(programs, round.categoryId)} — ${round.name}`,
    countdownIso: round.state === "open" && round.ballotDeadlineAt ? round.ballotDeadlineAt : null,
  });
  main.append(h("h1", { class: "page-title", text: `${categoryFor(programs, round.categoryId)} — ${round.name}` }));

  // Panel table.
  const addJurorSelect = h("select", { "aria-label": "Add juror", id: "add-juror" }) as HTMLSelectElement;
  const jurors = (await get<{ jurors: { id: string; name: string }[] }>("/api/jurors")).jurors;
  for (const juror of jurors) {
    addJurorSelect.append(h("option", { value: juror.id, text: juror.name }));
  }
  const addToPanel = h("button", { class: "primary", type: "button", text: "Add to panel" }) as HTMLButtonElement;
  addToPanel.addEventListener("click", async () => {
    try {
      await withPending(addToPanel, "Adding juror…", async () => {
        const result = await post<{ panel: PanelRowView[] }>(`/api/rounds/${roundId}/jurors`, { jurorId: addJurorSelect.value });
        const juror = result.panel.find((p) => p.jurorId === addJurorSelect.value);
        deskStatusAuto(`${juror?.name ?? "Juror"} added to the panel with ${juror?.assigned ?? 0} entries.`);
        await navigate(`/director/rounds/${roundId}`, true);
      });
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  });
  main.append(h("div", { class: "panel" },
    h("div", { class: "form-row" },
      h("label", { class: "field", for: "add-juror" }, h("span", { text: "Add juror" }), addJurorSelect),
      addToPanel,
    ),
  ));

  const panelTable = h("table", { class: "ranked", "aria-label": "Panel" });
  panelTable.append(h("thead", {}, h("tr", {},
    h("th", { text: "Juror" }), h("th", { text: "Assigned" }), h("th", { text: "Scored" }), h("th", { text: "Remaining" }), h("th", { text: "Ballot" }),
  )));
  const panelBody = h("tbody");
  for (const member of roundDetail.panel) {
    panelBody.append(h("tr", {},
      h("td", { class: "cell-title", text: member.name }),
      h("td", { class: "cell-rank", text: String(member.assigned) }),
      h("td", { class: "cell-rank", text: String(member.scored) }),
      h("td", { class: "cell-rank", text: String(member.remaining) }),
      h("td", { text: member.ballotSubmitted ? "Submitted" : "In progress" }),
    ));
  }
  panelTable.append(panelBody);
  main.append(panelTable);

  // Round actions.
  const actions = h("div", { class: "actions-row" });
  const deadlineInput = h("input", { type: "date", "aria-label": "Ballot deadline", id: "ballot-deadline" }) as HTMLInputElement;
  if (round.state === "scheduled") {
    actions.append(h("label", { class: "field", for: "ballot-deadline" }, h("span", { text: "Ballot deadline" }), deadlineInput));
    const openRound = h("button", { class: "primary", type: "button", text: "Open round" }) as HTMLButtonElement;
    openRound.addEventListener("click", async () => {
      try {
        await withPending(openRound, "Opening round…", async () => {
          await post<{ round: RoundView }>(`/api/rounds/${roundId}/open`, { ballotDeadline: deadlineInput.value });
          deskStatusAuto(`Round opened.`);
          await navigate(`/director/rounds/${roundId}`, true);
        });
      } catch (error) {
        deskError(deskErrorFrom(error));
      }
    });
    actions.append(openRound);
  }
  if (round.state === "open") {
    const closeRound = h("button", { class: "danger", type: "button", text: "Close round" }) as HTMLButtonElement;
    closeRound.addEventListener("click", () => {
      openDialog({
        title: `Close ${round.name}?`,
        actions: [
          { label: "Cancel", value: "cancel", kind: "plain" },
          { label: "Close round", value: "close", kind: "danger" },
        ],
        safeValue: "cancel",
        onChoose: async (value) => {
          if (value !== "close") {
            return;
          }
          try {
            await withPending(closeRound, "Closing round…", async () => {
              const result = await post<{ standings: StandingsView }>(`/api/rounds/${roundId}/close`);
              deskStatusAuto(`Round closed. Scores stored for ${result.standings.rows.length} entries.`);
              await navigate(`/director/rounds/${roundId}`, true);
            });
          } catch (error) {
            deskError(deskErrorFrom(error));
          }
        },
      });
    });
    actions.append(closeRound);
  }
  if (round.state === "closed") {
    const confirmStandings = h("button", { class: "primary", type: "button", text: "Confirm standings" }) as HTMLButtonElement;
    confirmStandings.addEventListener("click", async () => {
      try {
        await withPending(confirmStandings, "Confirming…", async () => {
          const standings = await get<StandingsView>(`/api/rounds/${roundId}/standings`);
          const above = standings.rows.filter((r) => r.cut === "above").length;
          const below = standings.rows.length - above;
          await post(`/api/rounds/${roundId}/confirm`);
          deskStatusAuto(`Standings confirmed: ${above} above the cut, ${below} below.`);
          await navigate(`/director/rounds/${roundId}`, true);
        });
      } catch (error) {
        deskError(deskErrorFrom(error));
      }
    });
    actions.append(confirmStandings);
  }
  main.append(actions);

  // Standings.
  const status = h("p", { class: "standings-status", role: "status", "aria-live": "polite" });
  const standingsTable = h("table", { class: "ranked", "aria-label": "Standings", "data-standings": "" }) as HTMLTableElement;
  standingsTable.append(h("thead", {}, h("tr", {},
    h("th", { text: "Rank" }), h("th", { text: "Entry" }), h("th", { text: "Category" }), h("th", { text: "Score" }), h("th", { text: "Status" }),
  )));
  const standingsBody = h("tbody");
  standingsTable.append(standingsBody);
  const rowsById = new Map<string, RowState>();

  const renderStandings = async (animate: boolean) => {
    const standings = await get<StandingsView>(`/api/rounds/${roundId}/standings`);
    const cutPosition = standings.cut;
    const opts: ShuffleOptions = {
      cutPosition,
      cutLabel: standings.cutLabel,
      showAwards: round.kind === "final" && round.state !== "closed",
      showStudio: false,
      statusElement: status,
    };
    const rows = standings.rows.map((row) => ({
      data: {
        entryId: row.entryId,
        entryNumber: row.entryNumber,
        title: row.title,
        categoryName: row.categoryName,
      } as RowData,
      start: rowsById.get(row.entryId) ?? { rank: row.rank, score: row.score, cut: row.cut },
      end: { rank: row.rank, score: row.score, cut: row.cut, award: row.award },
    }));
    for (const row of rows) {
      rowsById.set(row.data.entryId, row.end);
    }
    const provisionalTag = main.querySelector<HTMLElement>(".provisional-tag");
    if (provisionalTag) {
      provisionalTag.textContent = standings.provisional ? "Provisional" : "";
    }
    if (animate && (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? true : false)) {
      renderStatic(standingsBody, rows, opts);
    } else if (animate) {
      await cutShuffle(standingsBody, rows, opts);
    } else {
      renderRows(standingsBody, rows.map((r) => ({ data: r.data, state: r.end })), opts);
    }
  };

  const provisionalTag = h("p", { class: "provisional-tag" });
  main.append(provisionalTag, status, standingsTable);
  await renderStandings(false);

  // Live refresh while the round is open: standings and panel every 5 seconds.
  if (round.state === "open") {
    const interval = window.setInterval(async () => {
      try {
        const detail = await get<{ round: RoundView; panel: PanelRowView[] }>(`/api/rounds/${roundId}`);
        const body = panelTable.querySelector("tbody");
        if (body) {
          body.textContent = "";
          for (const member of detail.panel) {
            body.append(h("tr", {},
              h("td", { class: "cell-title", text: member.name }),
              h("td", { class: "cell-rank", text: String(member.assigned) }),
              h("td", { class: "cell-rank", text: String(member.scored) }),
              h("td", { class: "cell-rank", text: String(member.remaining) }),
              h("td", { text: member.ballotSubmitted ? "Submitted" : "In progress" }),
            ));
          }
        }
        await renderStandings(true);
      } catch {
        // the round moved on; the next navigation refreshes everything
      }
    }, 5000);
    registerRoundCleanup(main, () => window.clearInterval(interval));
  }
}

function registerRoundCleanup(element: HTMLElement, fn: () => void): void {
  const observer = new MutationObserver(() => {
    if (!document.body.contains(element)) {
      fn();
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById("main") as HTMLElement, { childList: true });
}

function categoryFor(programs: ProgramView[], categoryId: string): string {
  for (const program of programs) {
    for (const category of program.categories) {
      if (category.id === categoryId) {
        return category.name;
      }
    }
  }
  return "Category";
}

export async function renderDirectorAudit(main: HTMLElement): Promise<void> {
  setBand({ contextName: "Director actions", countdownIso: null });
  main.textContent = "";
  main.append(h("h1", { class: "page-title", text: "Director actions" }));
  const events = (await get<{ events: { id: string; action: string; targetType: string; targetId: string; at: string; detail: string }[] }>("/api/audit")).events;
  const table = h("table", { class: "ranked audit-table", "aria-label": "Director actions" });
  table.append(h("thead", {}, h("tr", {}, h("th", { text: "Time" }), h("th", { text: "Action" }), h("th", { text: "Target" }))));
  const body = h("tbody");
  for (const event of events) {
    body.append(h("tr", {},
      h("td", { text: new Date(event.at).toLocaleString("en-GB", { timeZone: "UTC" }) }),
      h("td", { text: event.action }),
      h("td", { text: `${event.targetType} ${event.detail}` }),
    ));
  }
  table.append(body);
  main.append(table);
}
