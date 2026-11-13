import { COPY } from "./copy";
import { getArchive, searchAnswers } from "./api";
import { DeskMessages, el, fieldCounter } from "./shell";
import { LIMITS, countText, timeSent, type Answer } from "./util";

export class ArchiveScreen {
  private readonly main: HTMLElement;
  private readonly messages: DeskMessages;
  private readonly loadedIds = new Set<number>();
  private cursor: string | null = null;
  private hasMore = true;
  private searched = false;
  private queryValue = "";
  private roundValue = "";

  constructor(main: HTMLElement, messages: DeskMessages) {
    this.main = main;
    this.messages = messages;
  }

  start(): void {
    this.renderShell();
    void this.loadPage();
    window.setInterval(() => undefined, 3000);
  }

  private renderShell(): void {
    this.main.textContent = "";
    const headingWrap = el("div", {});
    headingWrap.appendChild(el("h1", {}, "Answer archive"));
    this.main.appendChild(headingWrap);
    const signOut = el("button", { class: "secondary", id: "sign-out" }, "Sign out");
    signOut.addEventListener("click", () => {
      void (async () => {
        const { deleteSession } = await import("./api");
        await deleteSession();
        window.location.assign("/sign-in");
      })();
    });
    this.main.appendChild(signOut);

    const bar = el("div", { class: "search-bar", id: "search-bar" });
    const search = el("input", { type: "search", id: "search-answers", "aria-label": "Search answers" }) as HTMLInputElement;
    const wrapped = fieldCounter(search, LIMITS.query);
    const round = el("select", { id: "round-filter", "aria-label": "Round" }) as HTMLSelectElement;
    round.appendChild(el("option", { value: "" }, "All rounds"));
    for (let n = 1; n <= 8; n++) {
      round.appendChild(el("option", { value: String(n) }, `Round ${n}`));
    }
    const button = el("button", { id: "search-button" }, "Search");
    bar.appendChild(wrapped);
    bar.appendChild(round);
    bar.appendChild(button);
    this.main.appendChild(bar);

    const results = el("section", { id: "search-results" });
    const resultsTable = el("table", { id: "search-results-table", "aria-label": "Search results", class: "archive-table" });
    results.appendChild(resultsTable);
    results.style.display = "none";
    this.main.appendChild(results);

    const archive = el("section", { id: "archive" });
    const table = el("table", { id: "archive-table", "aria-label": "Answer archive", class: "archive-table" });
    archive.appendChild(table);
    const more = el("button", { class: "secondary", id: "more-answers" }, "More answers");
    more.addEventListener("click", () => void this.loadPage());
    archive.appendChild(more);
    this.main.appendChild(archive);

    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.queryValue = search.value;
        this.roundValue = round.value;
        void this.runSearch(search, resultsTable);
      } else if (event.key === "ArrowDown") {
        const firstRow = resultsTable.querySelector<HTMLElement>("tbody tr");
        if (firstRow !== null) {
          event.preventDefault();
          firstRow.focus();
        }
      }
    });
    button.addEventListener("click", () => {
      this.queryValue = search.value;
      this.roundValue = round.value;
      void this.runSearch(search, resultsTable);
    });
    resultsTable.addEventListener("keydown", (event) => {
      const rows = Array.from(resultsTable.querySelectorAll<HTMLElement>("tbody tr"));
      const active = document.activeElement as HTMLElement | null;
      const index = active === null ? -1 : rows.indexOf(active);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        rows[Math.min(index + 1, rows.length - 1)]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        rows[Math.max(index - 1, 0)]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        rows[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        rows[rows.length - 1]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        search.focus();
      }
    });
  }

  private async loadPage(): Promise<void> {
    const more = this.main.querySelector<HTMLElement>("#more-answers");
    this.messages.show(COPY.loadingAnswers, true);
    const result = await getArchive(25, this.cursor);
    if (result.status !== 200) {
      this.messages.show(COPY.unreachable);
      return;
    }
    const body = result.body as { answers: Answer[]; next_cursor: string | null; has_more: boolean };
    const fresh = body.answers.filter((a) => !this.loadedIds.has(a.id));
    for (const answer of fresh) this.loadedIds.add(answer.id);
    if (body.answers.length === 0) {
      this.messages.show(COPY.noNewerAnswers);
      more?.focus();
      return;
    }
    this.messages.show(COPY.loadingAnswers, true);
    const table = this.main.querySelector<HTMLElement>("#archive-table");
    if (table !== null) {
      if (table.querySelector("thead") === null) {
        const head = el("thead", {});
        const headRow = el("tr", {});
        for (const label of ["Round", "Question", "Team", "Answer", "Time sent", "Mark"]) {
          headRow.appendChild(el("th", { scope: "col", class: label === "Time sent" ? "archive-time-head" : "" }, label));
        }
        head.appendChild(headRow);
        table.appendChild(head);
      }
      if (table.querySelector("tbody") === null) {
        table.appendChild(el("tbody", {}));
      }
      const tbody = table.querySelector<HTMLElement>("tbody");
      for (const answer of fresh) {
        tbody?.appendChild(this.answerRow(answer));
      }
    }
    this.cursor = body.next_cursor;
    this.hasMore = body.has_more;
    const firstFresh = this.main.querySelector<HTMLElement>(`#archive-table tbody tr[data-id='${fresh[0]?.id}']`);
    firstFresh?.focus();
    this.messages.show(COPY.loadingAnswers, true);
  }

  private answerRow(answer: Answer): HTMLElement {
    const row = el("tr", { tabindex: "0", "data-id": String(answer.id), role: "row" });
    row.appendChild(el("td", { class: "num" }, String(answer.round)));
    row.appendChild(el("td", { class: "num" }, String(answer.question)));
    row.appendChild(el("td", {}, answer.team_name));
    const answerCell = el("td", {}, answer.text);
    const timeLine = el("span", { class: "archive-time num" }, timeSent(answer.submitted_at));
    answerCell.appendChild(el("br"));
    answerCell.appendChild(timeLine);
    row.appendChild(answerCell);
    const timeCell = el("td", { class: "archive-time num" }, timeSent(answer.submitted_at));
    row.appendChild(timeCell);
    row.appendChild(el("td", { class: "num" }, answer.mark === null ? "" : String(answer.mark)));
    return row;
  }

  private async runSearch(search: HTMLInputElement, resultsTable: HTMLElement): Promise<void> {
    const query = this.queryValue;
    if (query.trim() === "") {
      this.messages.show(COPY.emptySearch);
      search.focus();
      return;
    }
    if (countText(query) > LIMITS.query) {
      this.messages.show(COPY.searchTooLong);
      search.focus();
      return;
    }
    this.messages.show(COPY.searching, true);
    const round = this.roundValue === "" ? undefined : Number(this.roundValue);
    const result = await searchAnswers(query, round);
    if (result.status !== 200) {
      const error = result.body as import("./api").ApiError;
      if (error.code === "search_timeout") {
        this.messages.show(COPY.searchTimeout);
      } else if (result.status === 422) {
        this.messages.show(COPY.searchTooLong);
      } else {
        this.messages.show(COPY.unreachable);
      }
      search.focus();
      return;
    }
    const body = result.body as { answers: Answer[]; count: number };
    this.searched = true;
    const section = this.main.querySelector<HTMLElement>("#search-results");
    if (section !== null) section.style.display = "block";
    resultsTable.textContent = "";
    const head = el("thead", {});
    const headRow = el("tr", {});
    for (const label of ["Round", "Question", "Team", "Answer", "Time sent", "Mark"]) {
      headRow.appendChild(el("th", { scope: "col" }, label));
    }
    head.appendChild(headRow);
    resultsTable.appendChild(head);
    const tbody = el("tbody", {});
    for (const answer of body.answers) {
      tbody.appendChild(this.answerRow(answer));
    }
    resultsTable.appendChild(tbody);
    if (body.count === 0) {
      this.messages.show(COPY.noMatches(query));
    } else {
      this.messages.show(COPY.answersMatching(body.count));
    }
    search.focus();
  }
}
