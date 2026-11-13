import { get } from "../api.js";
import { h, deskError, deskErrorFrom, deskStatus } from "../ui.js";
import { setBand } from "../band.js";
import { cutShuffle, renderRows, type RowData, type RowState, type ShuffleOptions } from "../shuffle.js";

interface LeaderRow {
  rank: number;
  entryNumber: number;
  title: string;
  studioName: string;
  score: string | null;
  previousRank: number | null;
  previousScore: string | null;
  award: string | null;
  cut: "above" | "below";
}

interface LeaderboardCategory {
  id: string;
  name: string;
  state: "pending" | "embargoed" | "revealed";
  revealsAt: string | null;
  revealsLabel: string | null;
  cut: number;
  rows: LeaderRow[];
}

interface LeaderboardResponse {
  program: { id: string; name: string; year: number; timeZone: string } | null;
  categories: LeaderboardCategory[];
}

interface ProgramSummary {
  id: string;
  name: string;
  year: number;
  deadlineAt: string;
}

const revealed = new Set<string>();

export async function renderLeaderboard(main: HTMLElement): Promise<void> {
  main.textContent = "";
  const programs = (await get<{ programs: ProgramSummary[] }>("/api/programs")).programs;
  // The default program comes from the API, matching the Leaderboard screen rule.
  const data = await load("");
  let selected = data.program?.id ?? programs[0]?.id ?? "";
  applyBand(data);

  const picker = h("select", { "aria-label": "Program", id: "program-picker" }) as HTMLSelectElement;
  for (const program of programs) {
    picker.append(h("option", { value: program.id, text: `${program.name} ${program.year}` }));
  }
  picker.value = selected;
  picker.addEventListener("change", async () => {
    selected = picker.value;
    revealed.clear();
    await render();
  });

  const container = h("div");
  main.append(
    h("div", { class: "filters" },
      h("label", { for: "program-picker" }, "Program"),
      picker,
    ),
    container,
  );

  async function render(): Promise<void> {
    const fresh = await load(selected === data.program?.id ? "" : selected);
    applyBand(fresh);
    container.textContent = "";
    for (const category of fresh.categories) {
      container.append(await categorySection(category));
    }
  }

  await render();

  // Live refresh: check for newly revealed categories every 5 seconds.
  const token = { cancelled: false };
  const interval = window.setInterval(async () => {
    if (token.cancelled) {
      return;
    }
    try {
      const fresh = await load(selected);
      applyBand(fresh);
      let changed = false;
      for (const category of fresh.categories) {
        if (category.state === "revealed" && !revealed.has(category.id)) {
          changed = true;
        }
        if (category.state !== "revealed" && revealed.has(category.id)) {
          changed = true;
        }
      }
      if (changed) {
        revealed.clear();
        await render();
      }
    } catch (error) {
      deskError(deskErrorFrom(error));
    }
  }, 5000);
  registerCleanup(main, () => {
    token.cancelled = true;
    window.clearInterval(interval);
  });
}

async function load(programId: string): Promise<LeaderboardResponse> {
  const query = programId ? `?programId=${encodeURIComponent(programId)}` : "";
  return get<LeaderboardResponse>(`/api/public/leaderboard${query}`);
}

function applyBand(data: LeaderboardResponse): void {
  const program = data.program;
  if (!program) {
    setBand({ contextName: "Cutline Jury Desk", countdownIso: null });
    return;
  }
  const soonest = data.categories
    .filter((c) => c.state === "embargoed" && c.revealsAt)
    .map((c) => new Date(c.revealsAt as string).getTime())
    .sort((a, b) => a - b)[0];
  if (soonest) {
    setBand({ contextName: program.name, countdownIso: new Date(soonest).toISOString() });
  } else {
    const anyRevealed = data.categories.some((c) => c.state === "revealed");
    setBand({ contextName: program.name, countdownIso: null, fallback: anyRevealed ? "Results published" : "" });
  }
}

async function categorySection(category: LeaderboardCategory): Promise<HTMLElement> {
  const section = h("section", { class: "leaderboard-section", "aria-label": category.name });
  section.append(h("h2", { class: "category-header", text: category.name }));
  if (category.state !== "revealed") {
    if (category.state === "embargoed") {
      section.append(h("p", { class: "embargo-note", text: `Reveals at ${category.revealsLabel}` }));
    } else {
      section.append(h("p", { class: "no-results", text: "No results yet." }));
    }
    return section;
  }

  const status = h("p", { class: "standings-status", role: "status", "aria-live": "polite" });
  const table = h("table", { class: "ranked", "aria-label": `${category.name} standings`, "data-standings": "" }) as HTMLTableElement;
  const thead = h("thead", {},
    h("tr", {},
      h("th", { scope: "col", text: "Rank" }),
      h("th", { scope: "col", text: "Entry" }),
      h("th", { scope: "col", text: "Category" }),
      h("th", { scope: "col", text: "Score" }),
      h("th", { scope: "col", text: "Status" }),
    ),
  );
  const tbody = h("tbody");
  table.append(thead, tbody);
  section.append(status, table);

  const rows: { data: RowData; start: RowState; end: RowState }[] = category.rows.map((row) => ({
    data: {
      entryId: `${category.id}-${row.entryNumber}`,
      entryNumber: row.entryNumber,
      title: row.title,
      categoryName: category.name,
      studioName: row.studioName,
    },
    start: {
      rank: row.previousRank ?? row.rank,
      score: row.previousScore ?? row.score,
      cut: (row.previousRank ?? row.rank) <= category.cut ? "above" : "below",
    },
    end: {
      rank: row.rank,
      score: row.score,
      cut: row.cut,
      award: row.award,
    },
  }));
  const opts: ShuffleOptions = {
    cutPosition: category.cut,
    cutLabel: "Finalist cut",
    showAwards: true,
    showStudio: true,
    statusElement: status,
  };
  if (revealed.has(category.id)) {
    // A visitor who opens after the reveal sees it already settled.
    renderRows(tbody, rows.map((r) => ({ data: r.data, state: r.end })), opts);
  } else {
    revealed.add(category.id);
    await cutShuffle(tbody, rows, opts);
  }

  const replay = h("button", { type: "button", text: `Replay reveal for ${category.name}`, class: "linkish" });
  replay.addEventListener("click", () => {
    deskStatus(`Replaying the reveal for ${category.name}.`);
    void cutShuffle(tbody, rows, opts);
  });
  section.append(replay);
  return section;
}

function registerCleanup(element: HTMLElement, fn: () => void): void {
  const observer = new MutationObserver(() => {
    if (!document.body.contains(element)) {
      fn();
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById("main") as HTMLElement, { childList: true });
}
