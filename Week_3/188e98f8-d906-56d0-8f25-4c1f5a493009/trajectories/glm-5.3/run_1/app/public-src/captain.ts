import { COPY } from "./copy";
import {
  deleteSession,
  getDisputes,
  getRoundAnswers,
  patchTeam,
  postDispute,
  submitRoundAnswers,
} from "./api";
import { DeskMessages, TableNews, el, fieldCounter, renderTileContainer } from "./shell";
import { LIMITS, countText, type Answer, type Dispute, type Round } from "./util";

interface CaptainState {
  readonly teamId: number;
  readonly teamName: string;
}

interface FormState {
  readonly round: number;
  readonly idempotencyKey: string;
}

function newKey(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export class CaptainDesk {
  private readonly main: HTMLElement;
  private readonly messages: DeskMessages;
  private readonly tableNews: TableNews;
  private readonly state: CaptainState;
  private form: FormState | null = null;
  private answers: readonly Answer[] = [];
  private disputes: readonly Dispute[] = [];
  private rounds: readonly Round[] = [];
  private closedAnnounced = new Set<number>();
  private openRoundSeen: number | null = null;
  private secondsLeft = 0;
  private countdownTimer: number | undefined;

  constructor(main: HTMLElement, messages: DeskMessages, tableNews: TableNews, state: CaptainState) {
    this.main = main;
    this.messages = messages;
    this.tableNews = tableNews;
    this.state = state;
  }

  start(): void {
    this.renderShell();
    void this.poll();
    window.setInterval(() => void this.poll(), 3000);
    window.setInterval(() => this.tickCountdown(), 1000);
  }

  private renderShell(): void {
    this.main.textContent = "";
    const heading = el("h1", {}, "Answer desk");
    const headingWrap = el("div", {});
    headingWrap.appendChild(heading);
    this.main.appendChild(headingWrap);
    const signOut = el("button", { class: "secondary", id: "sign-out" }, "Sign out");
    signOut.addEventListener("click", () => {
      void (async () => {
        await deleteSession();
        window.location.assign("/sign-in");
      })();
    });
    this.main.appendChild(signOut);

    const teamRow = el("div", { class: "team-row" });
    const teamName = el("span", { id: "team-name" }, this.state.teamName);
    const rename = el("button", { id: "rename-team" }, "Rename team");
    rename.addEventListener("click", () => this.openRename());
    teamRow.appendChild(teamName);
    teamRow.appendChild(rename);
    this.main.appendChild(teamRow);

    const formSlot = el("div", { id: "answer-form-slot" });
    this.main.appendChild(formSlot);

    const marks = el("section", { id: "your-marks", role: "region", "aria-label": "Your marks" });
    const marksHeading = el("h2", {}, "Your marks");
    marks.appendChild(marksHeading);
    const marksBody = el("div", { id: "marks-body" });
    marks.appendChild(marksBody);
    this.main.appendChild(marks);

    renderTileContainer(this.main);
  }

  private async poll(): Promise<void> {
    const [roundsResult, tableResult, answersResult, disputesResult] = await Promise.all([
      import("./api").then((m) => m.getRounds()),
      import("./api").then((m) => m.getTable()),
      import("./api").then((m) => m.getSession()),
      getDisputes(),
    ]);
    if (roundsResult.status === 401) {
      window.location.assign("/sign-in?signed-out=1");
      return;
    }
    if (roundsResult.status !== 200 || tableResult.status !== 200) {
      this.messages.show(COPY.unreachable);
      return;
    }
    const rounds = (roundsResult.body as { rounds: Round[] }).rounds;
    const table = tableResult.body as import("./util").LeagueTable;
    this.rounds = rounds;
    this.disputes = disputesResult.status === 200 ? (disputesResult.body as { disputes: Dispute[] }).disputes : [];
    const open = rounds.find((r) => r.status === "open");
    this.renderForm(open ?? null);
    this.syncCountdown(open ?? null);
    await this.renderMarks();
    const { renderTileGrid } = await import("./shell");
    const grid = this.main.querySelector<HTMLElement>("#tile-grid");
    if (grid !== null) {
      renderTileGrid(this.main, table, this.tableNews, undefined);
    }
    const session = answersResult.status === 200 ? (answersResult.body as { team_name: string | null }) : null;
    if (session !== null && session.team_name !== null) {
      const nameNode = this.main.querySelector<HTMLElement>("#team-name");
      if (nameNode !== null) nameNode.textContent = session.team_name;
    }
  }

  private syncCountdown(open: Round | null): void {
    if (open === null) {
      this.secondsLeft = 0;
      return;
    }
    this.secondsLeft = open.seconds_left ?? 0;
  }

  private tickCountdown(): void {
    if (this.secondsLeft > 0) {
      this.secondsLeft -= 1;
    }
    const node = this.main.querySelector<HTMLElement>("#countdown");
    if (node !== null) {
      node.textContent = countFormat(this.secondsLeft);
    }
  }

  private renderForm(open: Round | null): void {
    const slot = this.main.querySelector<HTMLElement>("#answer-form-slot");
    if (slot === null) return;
    const closedRound = this.rounds.find((r) => r.number === this.form?.round && r.status !== "open" && r.status !== "drafted");
    if (open === null && this.form === null) {
      if (this.openRoundSeen === null) {
        slot.textContent = "";
        const waiting = el("section", { class: "card", id: "waiting-card" }, COPY.waiting);
        slot.appendChild(waiting);
      }
      return;
    }
    if (open !== null && this.form !== null && open.number !== this.form.round) {
      this.form = null;
      this.closedAnnounced.clear();
    }
    if (open !== null && this.form === null) {
      this.openRoundSeen = open.number;
      this.buildForm(open);
      return;
    }
    if (open === null && this.form !== null) {
      this.lockForm();
      if (closedRound !== undefined && !this.closedAnnounced.has(closedRound.number)) {
        this.closedAnnounced.add(closedRound.number);
        this.messages.show(COPY.roundClosed(this.form.round));
      }
      const node = this.main.querySelector<HTMLElement>("#countdown");
      if (node !== null) node.textContent = countFormat(0);
      this.secondsLeft = 0;
    }
  }

  private buildForm(round: Round): void {
    const slot = this.main.querySelector<HTMLElement>("#answer-form-slot");
    if (slot === null) return;
    slot.textContent = "";
    const form = el("form", { id: "answer-form", "aria-label": `Round ${round.number} answers` }) as HTMLFormElement;
    const countdown = el("div", {
      id: "countdown",
      class: "countdown num",
      role: "timer",
      "aria-label": "Time left",
    }, countFormat(round.seconds_left ?? 0));
    form.appendChild(countdown);
    const fields = el("div", { class: "answer-fields", id: "answer-fields" });
    for (let q = 1; q <= 8; q++) {
      const label = el("label", { for: `q${q}` }, `Question ${q}`);
      const input = el("input", { type: "text", id: `q${q}`, name: `q${q}`, "aria-label": `Question ${q}` }) as HTMLInputElement;
      const wrapped = fieldCounter(input, LIMITS.answer);
      fields.appendChild(label);
      fields.appendChild(wrapped);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (q < 8) {
            this.main.querySelector<HTMLInputElement>(`#q${q + 1}`)?.focus();
          } else {
            form.requestSubmit();
          }
        }
      });
    }
    form.appendChild(fields);
    if (round.kind === "picture") {
      const image = el("img", { src: `/api/rounds/${round.number}/sheet`, alt: `Picture sheet for round ${round.number}`, class: "picture-sheet" });
      const wrap = el("div", { class: "picture-sheet" });
      wrap.appendChild(image);
      form.appendChild(wrap);
    }
    const submit = el("button", { type: "submit", id: "submit-answers" }, "Submit answers");
    form.appendChild(submit);
    const accepted = el("ul", { id: "accepted-answers", "aria-label": "Accepted answers", class: "fade-in" });
    accepted.style.display = "none";
    const acceptedWrap = el("div", {});
    acceptedWrap.appendChild(accepted);
    slot.appendChild(form);
    slot.appendChild(acceptedWrap);

    this.form = { round: round.number, idempotencyKey: newKey() };
    this.answers = [];

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submit(form, accepted);
    });
    const first = this.main.querySelector<HTMLInputElement>("#q1");
    if (first !== null) first.focus();
  }

  private async submit(form: HTMLFormElement, acceptedList: HTMLElement): Promise<void> {
    if (this.form === null) return;
    if (form.dataset["closed"] === "1") return;
    const items: { question: number; text: string }[] = [];
    for (let q = 1; q <= 8; q++) {
      const input = form.querySelector<HTMLInputElement>(`#q${q}`);
      if (input === null) continue;
      const value = input.value;
      if (value.trim() === "") continue;
      items.push({ question: q, text: value });
    }
    this.messages.show(COPY.sendingAnswers, true);
    const key = this.form.idempotencyKey;
    const result = await submitRoundAnswers(this.form.round, items, key);
    if (result.status === 201) {
      const body = result.body as { round: number; accepted: Answer[] };
      this.answers = body.accepted;
      this.messages.show(COPY.answersIn(body.round));
      acceptedList.textContent = "";
      for (const answer of body.accepted) {
        acceptedList.appendChild(el("li", {}, `Question ${answer.question}: ${answer.text}`));
      }
      acceptedList.style.display = "block";
      this.form = { round: this.form.round, idempotencyKey: newKey() };
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (result.status === 429) {
      this.messages.show(COPY.tooManySubmits(error.retryAfter ?? 1));
      return;
    }
    if (error.code === "round_closed") {
      this.messages.show(COPY.roundClosed(this.form.round));
      this.lockForm();
      return;
    }
    if (error.code === "round_not_open") {
      this.messages.show(COPY.roundClosed(this.form.round));
      this.lockForm();
      return;
    }
    if (result.status === 422) {
      this.messages.show(COPY.answersOverLimit);
      return;
    }
    this.messages.show(COPY.unreachable);
  }

  private lockForm(): void {
    const form = this.main.querySelector<HTMLFormElement>("#answer-form");
    if (form === null) return;
    form.dataset["closed"] = "1";
    for (let q = 1; q <= 8; q++) {
      const input = form.querySelector<HTMLInputElement>(`#q${q}`);
      if (input !== null) input.readOnly = true;
    }
  }

  private async renderMarks(): Promise<void> {
    const body = this.main.querySelector<HTMLElement>("#marks-body");
    if (body === null) return;
    const marked = this.rounds.filter((r) => r.status === "marked" || r.status === "published");
    const focusTarget = document.activeElement;
    body.textContent = "";
    if (marked.length === 0) {
      body.appendChild(el("p", {}, "No rounds are marked yet."));
      void focusTarget;
      return;
    }
    for (const round of marked) {
      const group = el("div", { role: "group", "aria-label": `Round ${round.number}` });
      group.appendChild(el("h3", {}, `Round ${round.number}`));
      const answersResult = await getRoundAnswers(round.number);
      if (answersResult.status !== 200) continue;
      const answers = (answersResult.body as { answers: Answer[] }).answers;
      const detailed = await getRoundAnswers(round.number);
      void detailed;
      for (const answer of answers) {
        const row = el("div", { class: "mark-row", "data-answer-id": String(answer.id) });
        row.appendChild(el("span", {}, `Question ${answer.question}: ${answer.text}`));
        const status = el("span", {}, "");
        const dispute = this.disputes.find((d) => d.answer_id === answer.id);
        if (round.status === "marked" && dispute === undefined && answer.mark === 0) {
          const button = el("button", { class: "secondary" }, `Dispute question ${answer.question}`);
          button.addEventListener("click", () => this.openDispute(answer, button));
          row.appendChild(button);
        } else if (dispute !== undefined) {
          status.textContent = dispute.status === "raised" ? "Raised" : dispute.status === "upheld" ? "Upheld" : "Dismissed";
          row.appendChild(status);
        } else {
          status.textContent = `Mark ${answer.mark ?? 0}`;
          row.appendChild(status);
        }
        group.appendChild(row);
      }
      body.appendChild(group);
    }
    if (focusTarget instanceof HTMLElement && body.contains(focusTarget)) {
      focusTarget.focus();
    }
  }

  private openRename(): void {
    const dialog = el("div", { role: "dialog", "aria-label": "Rename team", class: "pane" }) as HTMLElement;
    const backdrop = el("div", { class: "pane-backdrop" });
    const panel = el("div", { class: "pane-panel" });
    const title = el("h2", {}, "Rename team");
    const input = el("input", { type: "text", id: "team-name-field", "aria-label": "Team name" }) as HTMLInputElement;
    input.value = this.state.teamName ?? "";
    const wrapped = fieldCounter(input, LIMITS.name);
    const save = el("button", { id: "save-name" }, "Save name");
    const cancel = el("button", { class: "secondary", id: "cancel-rename" }, "Cancel");
    const actions = el("div", { class: "pane-actions" });
    actions.appendChild(save);
    actions.appendChild(cancel);
    panel.appendChild(title);
    panel.appendChild(wrapped);
    panel.appendChild(actions);
    dialog.appendChild(backdrop);
    dialog.appendChild(panel);
    document.getElementById("modal-root")?.appendChild(dialog);

    const close = (): void => {
      dialog.remove();
      this.main.querySelector<HTMLElement>("#rename-team")?.focus();
    };
    save.addEventListener("click", () => void this.saveName(input));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.saveName(input);
      }
    });
    cancel.addEventListener("click", close);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") {
        const stops = [input, save, cancel];
        trapTab(event, stops);
      }
    });
    input.focus();
  }

  private async saveName(input: HTMLInputElement): Promise<void> {
    const value = input.value;
    if (value.trim() === "") {
      this.messages.show(COPY.nameEmpty);
      return;
    }
    if (countText(value) > LIMITS.name) {
      this.messages.show(COPY.nameTooLong);
      return;
    }
    this.messages.show(COPY.savingName, true);
    const result = await patchTeam(this.state.teamId, value);
    if (result.status === 200) {
      this.messages.show(COPY.nameSaved);
      document.getElementById("modal-root")?.querySelector<HTMLElement>("[role=dialog]")?.remove();
      const nameNode = this.main.querySelector<HTMLElement>("#team-name");
      if (nameNode !== null) {
        nameNode.textContent = (result.body as { team: { name: string } }).team.name;
      }
      this.main.querySelector<HTMLElement>("#rename-team")?.focus();
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (error.code === "name_taken") {
      this.messages.show(COPY.nameTaken);
      return;
    }
    this.messages.show(COPY.nameTooLong);
  }

  private openDispute(answer: Answer, opener: HTMLElement): void {
    const dialog = el("div", { role: "dialog", "aria-label": "Raise a dispute", class: "pane" });
    const backdrop = el("div", { class: "pane-backdrop" });
    const panel = el("div", { class: "pane-panel" });
    const title = el("h2", {}, `Raise a dispute`);
    const detail = el("p", {}, `Question ${answer.question}: ${answer.text}`);
    const input = el("textarea", { id: "dispute-reason", "aria-label": "Reason", rows: "4" }) as HTMLTextAreaElement;
    const wrapped = fieldCounter(input, LIMITS.reason);
    const send = el("button", { id: "send-dispute" }, "Send dispute");
    const cancel = el("button", { class: "secondary", id: "cancel-dispute" }, "Cancel");
    const actions = el("div", { class: "pane-actions" });
    actions.appendChild(send);
    actions.appendChild(cancel);
    panel.appendChild(title);
    panel.appendChild(detail);
    panel.appendChild(wrapped);
    panel.appendChild(actions);
    dialog.appendChild(backdrop);
    dialog.appendChild(panel);
    document.getElementById("modal-root")?.appendChild(dialog);

    const close = (): void => {
      dialog.remove();
      const next = this.main.querySelector<HTMLElement>(`[data-answer-id="${answer.id}"] button`);
      (next ?? this.main.querySelector<HTMLElement>("#your-marks"))?.focus();
    };
    send.addEventListener("click", () => void this.sendDispute(answer, input, send));
    cancel.addEventListener("click", close);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
      if (event.key === "Tab") trapTab(event, [input, send, cancel]);
    });
    input.focus();
    void opener;
  }

  private async sendDispute(answer: Answer, input: HTMLTextAreaElement, send: HTMLElement): Promise<void> {
    const value = input.value;
    if (value.trim() === "") {
      this.messages.show(COPY.disputeReasonEmpty);
      return;
    }
    if (countText(value) > LIMITS.reason) {
      this.messages.show(COPY.disputeReasonTooLong);
      return;
    }
    this.messages.show(COPY.sendingDispute, true);
    const result = await postDispute(answer.id, value);
    if (result.status === 201) {
      this.messages.show(COPY.disputeSent);
      document.getElementById("modal-root")?.querySelector<HTMLElement>("[role=dialog]")?.remove();
      await this.renderMarks();
      const rows = Array.from(this.main.querySelectorAll<HTMLElement>("[data-answer-id]"));
      const index = rows.findIndex((row) => row.dataset["answerId"] === String(answer.id));
      const nextButton = rows.slice(index + 1).find((row) => row.querySelector("button") !== null)?.querySelector<HTMLElement>("button");
      (nextButton ?? this.main.querySelector<HTMLElement>("#your-marks"))?.focus();
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (error.code === "dispute_window_closed") {
      this.messages.show(COPY.disputesClosed(answer.round));
      send.focus();
      return;
    }
    this.messages.show(COPY.disputeReasonEmpty);
    send.focus();
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

function countFormat(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")} left`;
}
