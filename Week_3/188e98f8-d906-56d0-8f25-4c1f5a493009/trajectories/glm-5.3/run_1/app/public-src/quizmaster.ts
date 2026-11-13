import { COPY } from "./copy";
import { closeRound, getDisputes, openRound, postRuling, publishRound, uploadSheet } from "./api";
import { DeskMessages, TableNews, el, renderTileContainer } from "./shell";
import type { Dispute, LeagueTable, Round } from "./util";

export class QuizmasterDesk {
  private readonly main: HTMLElement;
  private readonly messages: DeskMessages;
  private readonly tableNews: TableNews;
  private rounds: readonly Round[] = [];
  private table: LeagueTable | null = null;
  private disputes: readonly Dispute[] = [];
  private outageShown = new Set<number>();

  constructor(main: HTMLElement, messages: DeskMessages, tableNews: TableNews) {
    this.main = main;
    this.messages = messages;
    this.tableNews = tableNews;
  }

  start(): void {
    this.renderShell();
    void this.poll();
    window.setInterval(() => void this.poll(), 3000);
  }

  private renderShell(): void {
    this.main.textContent = "";
    const headingWrap = el("div", {});
    const heading = el("h1", { id: "quizmaster-heading" }, "Quizmaster's desk");
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
    const cards = el("section", { id: "round-cards", class: "round-cards" });
    this.main.appendChild(cards);
    const disputesRegion = el("section", { id: "disputes", class: "disputes", role: "region", "aria-label": "Disputes" });
    const disputesHeading = el("h2", {}, "Disputes");
    disputesRegion.appendChild(disputesHeading);
    const disputesBody = el("div", { id: "disputes-body" });
    disputesRegion.appendChild(disputesBody);
    this.main.appendChild(disputesRegion);
    renderTileContainer(this.main);
  }

  private async poll(): Promise<void> {
    const { getRounds, getTable } = await import("./api");
    const [roundsResult, tableResult, disputesResult] = await Promise.all([
      getRounds(),
      getTable(),
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
    this.rounds = (roundsResult.body as { rounds: Round[] }).rounds;
    this.table = tableResult.body as LeagueTable;
    this.disputes = disputesResult.status === 200 ? (disputesResult.body as { disputes: Dispute[] }).disputes : [];
    this.renderCards();
    this.renderDisputes();
    const { renderTileGrid } = await import("./shell");
    renderTileGrid(this.main, this.table, this.tableNews, undefined);
  }

  private renderCards(): void {
    const cards = this.main.querySelector<HTMLElement>("#round-cards");
    if (cards === null) return;
    const focusActive = document.activeElement;
    const chosenFiles = new Map<number, File>();
    for (const card of Array.from(cards.children) as HTMLElement[]) {
      const round = Number(card.dataset["round"]);
      const input = card.querySelector<HTMLInputElement>("input[type=file]");
      if (input?.files?.[0] !== undefined) chosenFiles.set(round, input.files[0]);
    }
    cards.textContent = "";
    for (const round of this.rounds) {
      const card = el("article", { class: "round-card", "data-round": String(round.number), "aria-label": `Round ${round.number}`, tabindex: "0" });
      const title = el("h3", {}, `Round ${round.number}: ${round.title}`);
      card.appendChild(title);
      card.appendChild(el("span", { class: "status" }, round.status));
      if (round.kind === "picture") {
        const sheetStatus = round.sheet?.status === "stored" ? "Sheet stored" : "Sheet not stored";
        card.appendChild(el("span", { class: "sheet-status" }, sheetStatus));
        if (this.outageShown.has(round.number)) {
          card.appendChild(el("span", { class: "field-error outage-line" }, COPY.sheetOutage));
        }
      }
      if (round.status === "drafted") {
        const openButton = el("button", {}, `Open round ${round.number}`);
        openButton.addEventListener("click", () => void this.openRound(round, card));
        card.appendChild(openButton);
        if (round.kind === "picture") {
          const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg", id: `sheet-${round.number}`, "aria-label": `Picture sheet for round ${round.number}` }) as HTMLInputElement;
          const upload = el("button", { class: "secondary" }, `Upload sheet for round ${round.number}`);
          upload.addEventListener("click", () => void this.upload(round, fileInput, card));
          card.appendChild(fileInput);
          card.appendChild(upload);
          const chosen = chosenFiles.get(round.number);
          if (chosen !== undefined) {
            const transfer = new DataTransfer();
            transfer.items.add(chosen);
            fileInput.files = transfer.files;
          }
        }
      } else if (round.status === "open") {
        const closeButton = el("button", {}, `Close round ${round.number}`);
        closeButton.addEventListener("click", () => void this.closeRound(round, card));
        card.appendChild(closeButton);
      } else if (round.status === "marked") {
        const publish = el("button", {}, `Publish round ${round.number}`);
        publish.addEventListener("click", () => void this.publish(round));
        card.appendChild(publish);
      }
      cards.appendChild(card);
    }
    if (focusActive instanceof HTMLElement && cards.contains(focusActive)) {
      const selector = focusActive.getAttribute("aria-label") ?? focusActive.textContent ?? "";
      void selector;
    }
  }

  private async openRound(round: Round, card: HTMLElement): Promise<void> {
    this.messages.show(COPY.opening(round.number), true);
    const result = await openRound(round.number);
    if (result.status === 200) {
      this.messages.show(COPY.roundOpen(round.number));
      this.outageShown.delete(round.number);
      await this.poll();
      const close = this.main.querySelector<HTMLElement>(`[data-round='${round.number}'] button`);
      close?.focus();
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (error.code === "sheet_not_stored") {
      this.messages.show(COPY.sheetMissing(round.number));
      card.querySelector<HTMLElement>("[aria-label^='Picture sheet']")?.focus();
      return;
    }
    if (error.code === "another_round_open") {
      this.messages.show(COPY.anotherOpen);
      return;
    }
    if (error.code === "storage_unavailable") {
      this.messages.show(COPY.sheetOutage);
      this.outageShown.add(round.number);
      this.renderCards();
      return;
    }
    if (error.code === "round_not_drafted") {
      await this.poll();
      return;
    }
    this.messages.show(COPY.unreachable);
  }

  private async closeRound(round: Round, card: HTMLElement): Promise<void> {
    this.messages.show(COPY.closing(round.number), true);
    const result = await closeRound(round.number);
    if (result.status === 200) {
      this.messages.show(COPY.roundClosedByQuizmaster(round.number));
      await this.poll();
      card.focus();
      return;
    }
    this.messages.show(COPY.unreachable);
  }

  private async publish(round: Round): Promise<void> {
    this.messages.show(COPY.publishing(round.number), true);
    const result = await publishRound(round.number);
    if (result.status === 200) {
      const body = result.body as { round: Round; table: LeagueTable };
      const leader = body.table.teams[0];
      this.messages.show(COPY.publishedNews(round.number, leader.name, leader.total));
      this.tableNews.announce(COPY.publishedNews(round.number, leader.name, leader.total));
      await this.poll();
      const card = this.main.querySelector<HTMLElement>(`[data-round='${round.number}']`);
      card?.focus();
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (error.code === "disputes_pending") {
      this.messages.show(COPY.disputesOpen(round.number, error.count ?? 0));
      return;
    }
    this.messages.show(COPY.unreachable);
  }

  private async upload(round: Round, input: HTMLInputElement, card: HTMLElement): Promise<void> {
    const file = input.files?.[0];
    if (file === undefined) {
      this.messages.show(COPY.noFile);
      input.focus();
      return;
    }
    this.messages.show(COPY.storingSheet, true);
    const result = await uploadSheet(round.number, file);
    if (result.status === 201) {
      this.messages.show(COPY.sheetStored(round.number));
      this.outageShown.delete(round.number);
      await this.poll();
      this.main.querySelector<HTMLElement>(`[data-round='${round.number}'] .upload`)?.focus();
      void card;
      return;
    }
    const error = result.body as import("./api").ApiError;
    if (result.status === 413) {
      this.messages.show(COPY.sheetTooLarge);
      input.focus();
      return;
    }
    if (result.status === 415) {
      this.messages.show(COPY.sheetType);
      input.focus();
      return;
    }
    if (result.status === 422) {
      this.messages.show(COPY.sheetDimensions);
      input.focus();
      return;
    }
    if (error.code === "storage_unavailable") {
      this.messages.show(COPY.sheetOutage);
      this.outageShown.add(round.number);
      this.renderCards();
      this.main.querySelector<HTMLElement>(`[data-round='${round.number}'] .upload`)?.focus();
      return;
    }
    if (error.code === "not_picture_round" || error.code === "round_not_drafted") {
      await this.poll();
      return;
    }
    this.messages.show(COPY.unreachable);
  }

  private renderDisputes(): void {
    const body = this.main.querySelector<HTMLElement>("#disputes-body");
    if (body === null) return;
    body.textContent = "";
    const raised = this.disputes.filter((d) => d.status === "raised");
    if (raised.length === 0) {
      body.appendChild(el("p", {}, "No open disputes."));
      return;
    }
    for (const dispute of raised) {
      const row = el("div", { class: "card", "data-dispute-id": String(dispute.id) });
      row.appendChild(el("span", {}, `Round ${dispute.round}, question ${dispute.question}: ${dispute.answer_text}`));
      row.appendChild(el("span", {}, dispute.reason));
      const button = el("button", {}, `Rule on ${dispute.team_id}, round ${dispute.round}, question ${dispute.question}`);
      button.addEventListener("click", () => void this.openRuling(dispute, button));
      row.appendChild(button);
      body.appendChild(row);
    }
  }

  private async openRuling(dispute: Dispute, opener: HTMLElement): Promise<void> {
    const dialog = el("div", { role: "dialog", "aria-label": "Rule on dispute", class: "pane", id: "ruling-pane" });
    const backdrop = el("div", { class: "pane-backdrop" });
    const panel = el("div", { class: "pane-panel" });
    const title = el("h2", {}, "Rule on dispute");
    const detail = el("p", {}, `Answer: ${dispute.answer_text}`);
    const reason = el("p", {}, `Reason: ${dispute.reason}`);
    const radios = el("div", { class: "radios", role: "radiogroup", "aria-label": "Ruling" });
    const upholdLabel = el("label", {}, "Uphold");
    const uphold = el("input", { type: "radio", name: "ruling", value: "uphold" }) as HTMLInputElement;
    const dismissLabel = el("label", {}, "Dismiss");
    const dismiss = el("input", { type: "radio", name: "ruling", value: "dismiss" }) as HTMLInputElement;
    uphold.checked = true;
    upholdLabel.prepend(uphold);
    dismissLabel.prepend(dismiss);
    radios.appendChild(upholdLabel);
    radios.appendChild(dismissLabel);
    const save = el("button", { id: "save-ruling" }, "Save ruling");
    const cancel = el("button", { class: "secondary", id: "cancel-ruling" }, "Cancel");
    const actions = el("div", { class: "pane-actions" });
    actions.appendChild(save);
    actions.appendChild(cancel);
    panel.appendChild(title);
    panel.appendChild(detail);
    panel.appendChild(reason);
    panel.appendChild(radios);
    panel.appendChild(actions);
    dialog.appendChild(backdrop);
    dialog.appendChild(panel);
    document.getElementById("modal-root")?.appendChild(dialog);

    const close = (): void => {
      dialog.remove();
      opener.focus();
    };
    const saveRuling = (): void => {
      void (async () => {
        this.messages.show(COPY.savingRuling, true);
        const ruling = uphold.checked ? "upheld" : "dismissed";
        const result = await postRuling(dispute.id, ruling);
        if (result.status === 200) {
          this.messages.show(COPY.rulingSaved);
          await this.poll();
          dialog.remove();
          const buttons = Array.from(this.main.querySelectorAll<HTMLElement>("[data-dispute-id] button"));
          const index = buttons.findIndex((b) => b === opener);
          const next = buttons[index + 1] ?? buttons[0];
          (next ?? this.main.querySelector<HTMLElement>("#disputes"))?.focus();
          return;
        }
        const error = result.body as import("./api").ApiError;
        if (error.code === "dispute_already_ruled") {
          this.messages.show(COPY.alreadyRuled);
          dialog.remove();
          const buttons = Array.from(this.main.querySelectorAll<HTMLElement>("[data-dispute-id] button"));
          const index = buttons.findIndex((b) => b === opener);
          const next = buttons[index + 1] ?? buttons[0];
          (next ?? this.main.querySelector<HTMLElement>("#disputes"))?.focus();
          return;
        }
        this.messages.show(COPY.unreachable);
      })();
    };
    save.addEventListener("click", saveRuling);
    cancel.addEventListener("click", close);
    dialog.addEventListener("keydown", (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "u") {
        event.preventDefault();
        uphold.checked = true;
      } else if (key === "d") {
        event.preventDefault();
        dismiss.checked = true;
      } else if (event.key === "Enter" && document.activeElement === save) {
        saveRuling();
      } else if (event.key === "Escape") {
        close();
      } else if (event.key === "Tab") {
        trapTab(event, [radios, save, cancel]);
      }
    });
    uphold.focus();
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
