// Requests: send, re-address, end, read answers with evidence.

import { announce, api, el, withWorking } from "./api.js";
import type { RouteCtx } from "./app.js";
import { handleSessionEnd } from "./app.js";
import { STATE_NAMES, TOWN_NAMES, UI } from "./copy.js";
import { overlayClose, overlayOpen } from "./overlay.js";

interface RequestRow {
  id: string;
  styleId: string;
  lineId: string;
  styleName: string;
  supplierName: string;
  contactName: string;
  contactEmail: string;
  town: string;
  townName: string;
  language: string;
  questions: string[];
  dueDate: string;
  state: string;
  sentAt: string;
  endsAt: string;
  remindedAt: string | null;
  answeredAt: string | null;
  answer: { energyMjPerKg: string | null; waterLitresPerKg: string | null; fibreOrigin: string | null; evidenceIds: string[] } | null;
  answerAddress: string | null;
}

export function registerRequestsScreen(ctx: RouteCtx): () => void {
  const main = ctx.main;
  const h1 = el("h1", {}, "Requests");
  const refreshLine = el("p", { class: "refresh-line", "data-part": "refresh-line", hidden: "true" }, UI.refreshFailed);
  const frame = el("div", { class: "table-frame", role: "region", "aria-label": "Requests table", tabindex: "0" });
  const table = el("table");
  const tbody = el("tbody");
  table.append(el("thead", {}, el("tr", {}, ...["Supplier", "Style", "Language", "Town", "Due", "State", "Controls"].map((x) => el("th", {}, x)))), tbody);
  frame.append(table);
  const newBtn = el("button", { class: "btn btn-primary" }, "New request");
  newBtn.addEventListener("click", () => void openNew(newBtn));
  const bar = el("div", { class: "bottom-bar" });
  bar.append(newBtn.cloneNode(true));
  main.append(h1, refreshLine, frame, newBtn, bar);

  async function load(): Promise<void> {
    try {
      const out = await api<{ requests: RequestRow[] }>("/api/requests");
      refreshLine.hidden = true;
      render(out.requests);
    } catch (err) {
      const failure = err as { status?: number };
      if (failure.status === 401) handleSessionEnd();
      else refreshLine.hidden = false;
    }
  }

  function render(requests: RequestRow[]): void {
    tbody.textContent = "";
    for (const request of requests) {
      const tr = el("tr", { "data-request-id": request.id });
      const showAnswer = el("button", { class: "btn" }, `Show answer for ${request.supplierName}`);
      const newAddress = el("button", { class: "btn" }, `New address for ${request.supplierName}`);
      const endPage = el("button", { class: "btn" }, `End page for ${request.supplierName}`);
      showAnswer.addEventListener("click", () => void expand(tr, request));
      newAddress.addEventListener("click", () => void readdress(newAddress, request));
      endPage.addEventListener("click", () => void end(endPage, request));
      tr.append(
        el("td", {}, request.supplierName),
        el("td", {}, request.styleName),
        el("td", {}, request.language),
        el("td", {}, TOWN_NAMES[request.town] ?? request.town),
        el("td", {}, request.dueDate),
        el("td", {}, STATE_NAMES[request.state] ?? request.state),
        el("td", {}, el("div", { class: "line-controls" }, showAnswer, newAddress, endPage)),
      );
      tbody.append(tr);
    }
  }

  async function expand(tr: HTMLElement, request: RequestRow): Promise<void> {
    const existing = tr.nextElementSibling as HTMLElement | null;
    if (existing?.dataset.expanded === "true") {
      existing.remove();
      return;
    }
    const detail = await api<RequestRow>(`/api/requests/${request.id}`);
    const row = el("tr", { "data-expanded": "true" });
    const cell = el("td", { colspan: "7" });
    const answer = detail.answer;
    if (answer) {
      cell.append(el("p", {}, `Answered at ${detail.answeredAt ?? ""}`));
      cell.append(el("p", { class: "num" }, `Energy ${answer.energyMjPerKg ?? "\u2014"} MJ/kg \u00B7 Water ${answer.waterLitresPerKg ?? "\u2014"} L/kg \u00B7 Origin ${answer.fibreOrigin ?? "\u2014"}`));
      for (const [i, evId] of (answer.evidenceIds ?? []).entries()) {
        const a = el("a", { href: `/api/evidence/${evId}/file` }, `Download evidence ${i + 1} for ${detail.supplierName}`);
        a.addEventListener("click", () => announce(UI.evidenceDownloaded));
        cell.append(el("p", {}, a));
      }
    } else {
      cell.append(el("p", {}, `No answer yet.`));
    }
    row.append(cell);
    tr.after(row);
  }

  async function readdress(button: HTMLElement, request: RequestRow): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        await api(`/api/requests/${request.id}/new-address`, { method: "POST" });
        announce(UI.newAddress(request.supplierName));
        await load();
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  async function end(button: HTMLElement, request: RequestRow): Promise<void> {
    await withWorking(button, UI.working, async () => {
      try {
        await api(`/api/requests/${request.id}/end`, { method: "POST" });
        announce(UI.pageEnded(request.supplierName));
        await load();
      } catch (err) {
        const failure = err as { message?: string; status?: number };
        if (failure.status === 401) handleSessionEnd();
        else announce(failure.message ?? `Something went wrong.`);
      }
    });
  }

  async function openNew(opener: HTMLElement): Promise<void> {
    const body = overlayOpen({ label: "New request", opener });
    const dialog = body.closest("dialog") as HTMLDialogElement;
    const styles = await api<{ styles: { id: string; name: string }[] }>("/api/styles");
    const styleSel = el("select", { "aria-label": "Style" });
    for (const style of styles.styles) styleSel.append(el("option", { value: style.id }, style.name));
    const lineSel = el("select", { "aria-label": "Material line" });
    const fillLines = async (): Promise<void> => {
      lineSel.textContent = "";
      const out = await api<{ lines: { id: string; position: number; materialName: string }[] }>(`/api/styles/${styleSel.value}/lines`);
      for (const line of out.lines) lineSel.append(el("option", { value: line.id }, `${line.materialName} (line ${line.position})`));
    };
    await fillLines();
    styleSel.addEventListener("change", () => void fillLines());
    const supplier = el("input", { type: "text", "aria-label": "Supplier" });
    const contact = el("input", { type: "text", "aria-label": "Contact name" });
    const email = el("input", { type: "email", "aria-label": "Contact email" });
    const townSel = el("select", { "aria-label": "Town" });
    for (const [id, name] of [["porto", "Porto"], ["izmir", "Izmir"], ["hoChiMinhCity", "Ho Chi Minh City"], ["cairo", "Cairo"]] as [string, string][]) {
      townSel.append(el("option", { value: id }, name));
    }
    const langSel = el("select", { "aria-label": "Language" });
    for (const [id, name] of [["en", "English"], ["fr", "French"], ["tr", "Turkish"], ["ar", "Arabic"]] as [string, string][]) {
      langSel.append(el("option", { value: id }, name));
    }
    const dueDate = el("input", { type: "text", "aria-label": "Due date", placeholder: "YYYY-MM-DD" });
    const checks = el("fieldset");
    checks.append(el("legend", {}, "Questions"));
    const questionChecks: HTMLInputElement[] = [];
    for (const [id, name] of [["energy", "Energy"], ["water", "Water"], ["fibreOrigin", "Fibre origin"]] as [string, string][]) {
      const label = el("label", { class: "checkbox" });
      const input = el("input", { type: "checkbox", value: id });
      input.checked = true;
      questionChecks.push(input);
      label.append(input, name);
      checks.append(label);
    }
    const send = el("button", { class: "btn btn-primary" }, "Send request");
    const close = el("button", { class: "btn" }, "Close");
    close.addEventListener("click", () => overlayClose(dialog, opener));
    body.append(
      el("label", { class: "field" }, el("span", {}, "Style"), styleSel),
      el("label", { class: "field" }, el("span", {}, "Material line"), lineSel),
      el("label", { class: "field" }, el("span", {}, "Supplier"), supplier),
      el("label", { class: "field" }, el("span", {}, "Contact name"), contact),
      el("label", { class: "field" }, el("span", {}, "Contact email"), email),
      el("label", { class: "field" }, el("span", {}, "Town"), townSel),
      el("label", { class: "field" }, el("span", {}, "Language"), langSel),
      el("label", { class: "field" }, el("span", {}, "Due date"), dueDate),
      checks,
      el("div", { class: "dialog-foot" }, send, close),
    );
    send.addEventListener("click", async () => {
      await withWorking(send, UI.working, async () => {
        try {
          await api("/api/requests", {
            method: "POST",
            body: JSON.stringify({
              styleId: styleSel.value,
              lineId: lineSel.value,
              supplierName: supplier.value,
              contactName: contact.value,
              contactEmail: email.value,
              town: townSel.value,
              language: langSel.value,
              questions: questionChecks.filter((c) => c.checked).map((c) => c.value),
              dueDate: dueDate.value,
            }),
          });
          announce(UI.requestSent(supplier.value));
          overlayClose(dialog, opener);
          await load();
        } catch (err) {
          const failure = err as { message?: string; status?: number };
          if (failure.status === 401) handleSessionEnd();
          else announce(failure.message ?? `Give a value here.`);
        }
      });
    });
  }

  void load();
  const timer = window.setInterval(() => void load(), 5000);
  return () => window.clearInterval(timer);
}
