import { COPY } from "./copy";
import { getRoundAnswers, postMarked, putMark } from "./api";
import { DeskMessages, el } from "./shell";
import type { Answer, Round } from "./util";

export class MarkerDesk {
  private readonly main: HTMLElement;
  private readonly messages: DeskMessages;
  private rounds: readonly Round[] = [];
  private paneRound: number | null = null;
  private currentIndex = 0;

  constructor(main: HTMLElement, messages: DeskMessages) {
    this.main = main;
    this.messages = messages;
  }

  start(): void {
    this.renderShell();
    void this.poll();
    window.setInterval(() => void this.poll(), 3000);
  }

  private renderShell(): void {
    this.main.textContent = "";
    const heading = el("h1", { id: "marking-heading" }, "Marking");
    const headingWrap = el("div", {});
    headingWrap.appendChild(heading);
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
    const roundList = el("section", { id: "round-list" });
    this.main.appendChild(roundList);
    const archiveLink = el("a", { href: "/archive", id: "archive-link" }, "Answer archive");
    this.main.appendChild(archiveLink);
  }

  private async poll(): Promise<void> {
    const { getRounds } = await import("./api");
    const result = await getRounds();
    if (result.status === 401) {
      window.location.assign("/sign-in?signed-out=1");
      return;
    }
    if (result.status !== 200) {
      this.messages.show(COPY.unreachable);
      return;
    }
    this.rounds = (result.body as { rounds: Round[] }).rounds;
    this.renderRounds();
    if (this.paneRound !== null) {
      await this.refreshPane(this.paneRound);
    }
  }

  private renderRounds(): void {
    const list = this.main.querySelector<HTMLElement>("#round-list");
    if (list === null) return;
    list.textContent = "";
    for (const round of this.rounds) {
      const card = el("section", { class: "card", "data-round": String(round.number) });
      card.appendChild(el("h3", {}, `Round ${round.number}: ${round.title}`));
      card.appendChild(el("span", {}, round.status));
      if (round.status === "closed") {
        const button = el("button", {}, `Mark round ${round.number}`);
        button.addEventListener("click", () => void this.openPane(round.number));
        card.appendChild(button);
      }
      list.appendChild(card);
    }
  }

  private async openPane(round: number): Promise<void> {
    const result = await getRoundAnswers(round);
    if (result.status !== 200) return;
    const answers = (result.body as { answers: Answer[] }).answers;
    this.paneRound = round;
    this.currentIndex = answers.findIndex((a) => a.mark === null);
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.renderPane(round, answers);
  }

  private async refreshPane(round: number): Promise<void> {
    const result = await getRoundAnswers(round);
    if (result.status !== 200) return;
    const answers = (result.body as { answers: Answer[] }).answers;
    this.updatePaneRows(answers);
  }

  private renderPane(round: number, answers: readonly Answer[]): void {
    document.getElementById("modal-root")?.querySelector<HTMLElement>("#mark-pane")?.remove();
    const dialog = el("div", { role: "dialog", "aria-label": `Mark round ${round}`, class: "pane", id: "mark-pane" });
    const backdrop = el("div", { class: "pane-backdrop" });
    const panel = el("div", { class: "pane-panel" });
    const title = el("h2", {}, `Mark round ${round}`);
    const rows = el("div", { class: "mark-pane-rows", id: "mark-rows" });
    panel.appendChild(title);
    panel.appendChild(rows);
    const finish = el("button", { id: "finish-marking" }, "Finish marking");
    const close = el("button", { class: "secondary", id: "close-marking" }, "Close");
    const actions = el("div", { class: "pane-actions" });
    actions.appendChild(finish);
    actions.appendChild(close);
    panel.appendChild(actions);
    dialog.appendChild(backdrop);
    dialog.appendChild(panel);
    document.getElementById("modal-root")?.appendChild(dialog);
    this.updatePaneRows(answers);

    const stops = (): HTMLElement[] => {
      const list: HTMLElement[] = [];
      for (const group of Array.from(rows.querySelectorAll<HTMLElement>(".radios"))) {
        const checked = group.querySelector<HTMLInputElement>("input:checked") ?? group.querySelector<HTMLInputElement>("input");
        if (checked !== null) list.push(checked);
      }
      list.push(finish);
      list.push(close);
      return list;
    };
    dialog.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        void this.markCurrent(1);
      } else if (key === "x") {
        event.preventDefault();
        void this.markCurrent(0);
      } else if (key === "j") {
        event.preventDefault();
        this.moveRow(1, stops().length - 2);
      } else if (key === "k") {
        event.preventDefault();
        this.moveRow(-1, stops().length - 2);
      } else if (event.key === "Escape") {
        this.closePane(round);
      } else if (event.key === "Tab") {
        trapTab(event, stops());
      }
    });
    finish.addEventListener("click", () => void this.finishMarking(round, finish));
    close.addEventListener("click", () => this.closePane(round));
    const first = stops()[0];
    first?.focus();
  }

  private updatePaneRows(answers: readonly Answer[]): void {
    const rows = document.getElementById("mark-rows");
    if (rows === null) return;
    const existing = Array.from(rows.querySelectorAll<HTMLElement>(".mark-row"));
    for (let index = 0; index < answers.length; index++) {
      const answer = answers[index]!;
      const row = existing[index];
      if (row === undefined) {
        this.appendRow(rows, answer);
        continue;
      }
      const mark = answer.mark ?? null;
      const correct = row.querySelector<HTMLInputElement>("input[value='1']");
      const wrong = row.querySelector<HTMLInputElement>("input[value='0']");
      if (correct !== null) correct.checked = mark === 1;
      if (wrong !== null) wrong.checked = mark === 0;
      row.classList.toggle("current", index === this.currentIndex);
    }
  }

  private appendRow(rows: HTMLElement, answer: Answer): void {
    const row = el("div", { class: "mark-row", "data-answer-id": String(answer.id) });
    const text = el("span", {}, answer.text);
    const radios = el("div", { class: "radios", role: "radiogroup", "aria-label": `${answer.team_name}, question ${answer.question}` });
    const correctLabel = el("label", {}, "Correct");
    const correct = el("input", { type: "radio", name: `mark-${answer.id}`, value: "1" }) as HTMLInputElement;
    const wrongLabel = el("label", {}, "Wrong");
    const wrong = el("input", { type: "radio", name: `mark-${answer.id}`, value: "0" }) as HTMLInputElement;
    if (answer.mark === 1) correct.checked = true;
    if (answer.mark === 0) wrong.checked = true;
    correctLabel.prepend(correct);
    wrongLabel.prepend(wrong);
    radios.appendChild(correctLabel);
    radios.appendChild(wrongLabel);
    row.appendChild(text);
    row.appendChild(radios);
    const answerId = answer.id;
    const round = answer.round;
    const index = rows.children.length;
    const save = (points: 0 | 1): void => {
      void (async () => {
        const result = await putMark(round, answerId, points);
        if (result.status === 200) {
          const team = answer.team_name;
          const q = answer.question;
          this.messages.show(points === 1 ? COPY.markCorrect(team, q) : COPY.markWrong(team, q));
        } else {
          this.messages.show(COPY.unreachable);
        }
      })();
    };
    correct.addEventListener("change", () => {
      this.currentIndex = index;
      save(1);
    });
    wrong.addEventListener("change", () => {
      this.currentIndex = index;
      save(0);
    });
    radios.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        correct.checked = true;
        correct.dispatchEvent(new Event("change"));
      } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        wrong.checked = true;
        wrong.dispatchEvent(new Event("change"));
      }
    });
    row.classList.toggle("current", index === this.currentIndex);
    rows.appendChild(row);
  }

  private async markCurrent(points: 0 | 1): Promise<void> {
    if (this.paneRound === null) return;
    const rows = document.getElementById("mark-rows");
    if (rows === null) return;
    const row = rows.children[this.currentIndex];
    if (row === undefined) return;
    const answerId = Number((row as HTMLElement).dataset["answerId"]);
    const result = await putMark(this.paneRound, answerId, points);
    if (result.status === 200) {
      const input = row.querySelector<HTMLInputElement>(`input[value='${points}']`);
      if (input !== null) input.checked = true;
      const rowsAll = Array.from(rows.children);
      const next = rowsAll.findIndex((r, i) => i > this.currentIndex && r.querySelector<HTMLInputElement>("input:checked") === null);
      if (next > 0) this.currentIndex = next;
      const answer = (result.body as { answer: Answer }).answer;
      this.messages.show(points === 1 ? COPY.markCorrect(answer.team_name, answer.question) : COPY.markWrong(answer.team_name, answer.question));
    } else {
      this.messages.show(COPY.unreachable);
    }
  }

  private moveRow(delta: number, maxRows: number): void {
    const next = this.currentIndex + delta;
    if (next < 0 || next >= maxRows) return;
    this.currentIndex = next;
    const rows = document.getElementById("mark-rows");
    if (rows === null) return;
    Array.from(rows.children).forEach((row, index) => {
      (row as HTMLElement).classList.toggle("current", index === this.currentIndex);
    });
    const target = rows.children[this.currentIndex] as HTMLElement | undefined;
    target?.querySelector<HTMLElement>(".radios input")?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }

  private async finishMarking(round: number, finish: HTMLElement): Promise<void> {
    this.messages.show(COPY.finishing(round), true);
    const result = await postMarked(round);
    if (result.status === 200) {
      this.messages.show(COPY.roundMarked(round));
      this.closePane(round, true);
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (error.code === "unmarked_answers") {
      this.messages.show(COPY.unmarkedLeft(round, error.count ?? 0));
      finish.focus();
      return;
    }
    this.messages.show(COPY.unreachable);
    finish.focus();
  }

  private closePane(round: number, focusHeading = false): void {
    document.getElementById("mark-pane")?.remove();
    this.paneRound = null;
    if (focusHeading) {
      this.main.querySelector<HTMLElement>("#marking-heading")?.focus();
    } else {
      this.main.querySelector<HTMLElement>(`[data-round='${round}'] button`)?.focus();
    }
  }
}

function trapTab(event: KeyboardEvent, stops: readonly HTMLElement[]): void {
  const active = document.activeElement;
  const index = stops.indexOf(active as HTMLElement);
  if (index < 0) {
    event.preventDefault();
    stops[0]?.focus();
    return;
  }
  if (!event.shiftKey && index === stops.length - 1) {
    event.preventDefault();
    stops[0]?.focus();
  }
  if (event.shiftKey && index === 0) {
    event.preventDefault();
    stops[stops.length - 1]?.focus();
  }
}
