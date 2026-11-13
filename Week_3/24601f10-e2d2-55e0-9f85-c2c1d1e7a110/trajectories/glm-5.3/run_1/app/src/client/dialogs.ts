import { api, el, state, clear, ApiFailure } from "./app.js";
import type { EditPreviewResponse, Match, Tournament } from "../shared/types.js";
import { slotName } from "../shared/types.js";
import {
  openSheet,
  closeSheetFor,
  closeSheetsToCard,
  sheetStatus,
  busy,
  scoreFields,
  scoreValues,
  fieldError,
  countdownText,
  clearSheetErrors,
} from "./sheet.js";
import { runShutterTrace, clearShutterTrace } from "./shutter.js";

interface PageData {
  tournament: Tournament;
  entrants: import("../shared/types.js").Entrant[];
  matches: Match[];
}

export function focusCard(id: string): void {
  const card = document.querySelector<HTMLElement>(`[data-match-id="${id}"]`);
  if (card) {
    card.setAttribute("tabindex", "0");
    card.focus();
    card.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

export function openDialogFor(
  m: Match,
  data: PageData,
  isOrganizer: boolean,
  card: HTMLElement,
  onDone: () => void
): void {
  const myEntrant = data.entrants.find(
    (e) => e.username !== null && e.username === state.username
  );
  const iAmEntrant = myEntrant !== undefined &&
    ((m.upper && "entrant_id" in m.upper && m.upper.entrant_id === myEntrant.id) ||
      (m.lower && "entrant_id" in m.lower && m.lower.entrant_id === myEntrant.id));
  if (m.state === "reported") {
    if (iAmEntrant && m.report?.by === myEntrant.name) {
      // the reporter already reported; they only watch now
      return openDetailsDialog(m, isOrganizer, card, onDone);
    }
    if (iAmEntrant) return openConfirmDialog(m, card, onDone);
  }
  if (m.state === "disputed") {
    if (isOrganizer) return openResolveDialog(m, card, onDone);
    return openDetailsDialog(m, isOrganizer, card, onDone);
  }
  if (m.state === "pending" || m.state === "called") {
    if (iAmEntrant || isOrganizer) return openReportDialog(m, data, isOrganizer, card, onDone);
    return openDetailsDialog(m, isOrganizer, card, onDone);
  }
  if (m.state === "reported") {
    if (isOrganizer) return openReportDialog(m, data, isOrganizer, card, onDone);
    return openDetailsDialog(m, isOrganizer, card, onDone);
  }
  return openDetailsDialog(m, isOrganizer, card, onDone);
}

function actionStatus(text: string): void {
  const node = document.getElementById("your-action");
  if (node) node.textContent = text;
}

function openReportDialog(m: Match, data: PageData, isOrganizer: boolean, card: HTMLElement, onDone: () => void): void {
  const fields = scoreFields(m);
  const actions: HTMLElement[] = [];
  const submitLabel = isOrganizer ? "Save result" : "Submit score";
  const submit = el("button", {
    class: "btn",
    on: {
      click: async () => {
        const values = scoreValues(fields.upper, fields.lower);
        const dlg = card.ownerDocument.querySelector<HTMLDialogElement>("dialog[open]");
        clearSheetErrors(dlg ?? ({} as HTMLDialogElement));
        if (!values) {
          dlg?.appendChild(fieldError("Enter a whole number from 0 to 99."));
          return;
        }
        if (values.upper_games === 0 && values.lower_games === 0) {
          dlg?.appendChild(fieldError("A score needs at least one game."));
          return;
        }
        if ((data.tournament.format === "single_elimination" || data.tournament.format === "double_elimination") && values.upper_games === values.lower_games) {
          dlg?.appendChild(fieldError("Elimination matches need a winner."));
          return;
        }
        busy(true);
        try {
          const path = isOrganizer ? `/api/matches/${m.id}/result` : `/api/matches/${m.id}/report`;
          const res = await api<{ match: Match; outcome?: string }>("POST", path, {
            upper_games: values.upper_games,
            lower_games: values.lower_games,
            version: m.version,
          });
          closeSheetsToCard(card);
          actionStatus(isOrganizer ? "Result saved" : `Score reported, awaiting ${awaitedName(res.match)}`);
          onDone();
        } catch (e) {
          busy(false);
          if (e instanceof ApiFailure) {
            if (e.body.fields) {
              for (const msg of Object.values(e.body.fields)) dlg?.appendChild(fieldError(msg));
            } else if (e.body.match) {
              dlg?.appendChild(fieldError(e.body.message));
              focusFirstInput(dlg);
            } else {
              dlg?.appendChild(fieldError(e.body.message));
            }
          }
        }
      },
    },
  }, [submitLabel]);
  actions.push(submit);
  if (isOrganizer && (m.state === "pending" || m.state === "called")) {
    actions.push(el("button", {
      class: "btn btn--secondary",
      on: {
        click: async () => {
          busy(true);
          try {
            await api("POST", `/api/matches/${m.id}/call`, { version: m.version });
            closeSheetsToCard(card);
            actionStatus("Match called");
            onDone();
          } catch (e) {
            busy(false);
            if (e instanceof ApiFailure) {
              const dlg = card.ownerDocument.querySelector<HTMLDialogElement>("dialog[open]");
              dlg?.appendChild(fieldError(e.body.message));
            }
          }
        },
      },
    }, ["Call match"]));
  }
  openSheet({ title: "Report score", fields: [fields.host], actions, onClose: () => {} }, card);
}

function focusFirstInput(dlg: Element | null): void {
  const input = (dlg as HTMLElement | null)?.querySelector<HTMLInputElement>("input");
  input?.focus();
}

async function awaitedName(m: Match): Promise<string> {
  return m.report?.by === slotName(m.upper) ? slotName(m.lower) : slotName(m.upper);
}

function openConfirmDialog(m: Match, card: HTMLElement, onDone: () => void): void {
  const report = m.report!;
  const fields = scoreFields(m, report.upper_games, report.lower_games);
  const countdown = el("div", { class: "small muted", attrs: { role: "status" } }, [countdownText(report.auto_confirm_at)]);
  const timer = window.setInterval(() => {
    countdown.textContent = countdownText(report.auto_confirm_at);
  }, 1000);
  const actions = [
    el("button", {
      class: "btn",
      on: {
        click: async () => {
          busy(true);
          try {
            await api("POST", `/api/matches/${m.id}/confirm`, { version: m.version });
            window.clearInterval(timer);
            closeSheetsToCard(card);
            actionStatus("Score confirmed");
            onDone();
          } catch (e) {
            busy(false);
            if (e instanceof ApiFailure) {
              const dlg = card.ownerDocument.querySelector<HTMLDialogElement>("dialog[open]");
              dlg?.appendChild(fieldError(e.body.message));
              focusFirstInput(dlg);
            }
          }
        },
      },
    }, ["Confirm score"]),
    el("button", {
      class: "btn btn--secondary",
      on: {
        click: async () => {
          const values = scoreValues(fields.upper, fields.lower);
          const dlg = card.ownerDocument.querySelector<HTMLDialogElement>("dialog[open]");
          clearSheetErrors(dlg ?? ({} as HTMLDialogElement));
          if (!values) {
            dlg?.appendChild(fieldError("Enter a whole number from 0 to 99."));
            return;
          }
          if (values.upper_games === report.upper_games && values.lower_games === report.lower_games) {
            dlg?.appendChild(fieldError("Change the score to dispute it."));
            return;
          }
          busy(true);
          try {
            await api("POST", `/api/matches/${m.id}/dispute`, {
              upper_games: values.upper_games,
              lower_games: values.lower_games,
              version: m.version,
            });
            window.clearInterval(timer);
            closeSheetsToCard(card);
            actionStatus("Score disputed");
            onDone();
          } catch (e) {
            busy(false);
            if (e instanceof ApiFailure) {
              if (e.body.fields) {
                for (const msg of Object.values(e.body.fields)) dlg?.appendChild(fieldError(msg));
              } else {
                dlg?.appendChild(fieldError(e.body.message));
                focusFirstInput(dlg);
              }
            }
          }
        },
      },
    }, ["Dispute score"]),
  ];
  openSheet(
    {
      title: "Confirm score",
      fields: [el("p", {}, [`${report.by} reported ${report.upper_games}-${report.lower_games}`]), countdown, fields.host],
      actions,
      onClose: () => window.clearInterval(timer),
    },
    card
  );
}

function openResolveDialog(m: Match, card: HTMLElement, onDone: () => void): void {
  const fields = scoreFields(m);
  const claims: HTMLElement[] = [];
  if (m.report) {
    claims.push(el("p", { class: "small" }, [`${m.report.by} says ${m.report.upper_games}-${m.report.lower_games}`]));
  }
  if (m.dispute) {
    claims.push(el("p", { class: "small" }, [`${m.dispute.by} says ${m.dispute.upper_games}-${m.dispute.lower_games}`]));
  }
  const actions = [
    el("button", {
      class: "btn",
      on: {
        click: async () => {
          const values = scoreValues(fields.upper, fields.lower);
          const dlg = card.ownerDocument.querySelector<HTMLDialogElement>("dialog[open]");
          clearSheetErrors(dlg ?? ({} as HTMLDialogElement));
          if (!values) {
            dlg?.appendChild(fieldError("Enter a whole number from 0 to 99."));
            return;
          }
          busy(true);
          try {
            await api("POST", `/api/matches/${m.id}/resolve`, {
              upper_games: values.upper_games,
              lower_games: values.lower_games,
              version: m.version,
            });
            closeSheetsToCard(card);
            actionStatus("Dispute resolved");
            onDone();
          } catch (e) {
            busy(false);
            if (e instanceof ApiFailure) {
              dlg?.appendChild(fieldError(e.body.message));
              focusFirstInput(dlg);
            }
          }
        },
      },
    }, ["Resolve"]),
  ];
  openSheet({ title: "Resolve dispute", fields: [...claims, fields.host], actions, onClose: () => {} }, card);
}

function openDetailsDialog(m: Match, isOrganizer: boolean, card: HTMLElement, onDone: () => void): void {
  const bits: HTMLElement[] = [
    el("p", {}, [m.label]),
    el("p", { class: "small" }, [`${slotName(m.upper)} vs ${slotName(m.lower)}`]),
    el("p", { class: "small" }, [
      `Status: ${m.state.replace("_", " ")}` +
        (m.upper_games !== null ? ` · Score ${m.upper_games}-${m.lower_games}` : ""),
    ]),
  ];
  const actions: HTMLElement[] = [el("button", { class: "btn btn--secondary", on: { click: () => closeTop() } }, ["Close"])];
  if (isOrganizer && (m.state === "confirmed" || m.state === "resolved")) {
    actions.unshift(el("button", {
      class: "btn",
      on: { click: () => openEditDialog(m, card, onDone) },
    }, ["Edit result"]));
  }
  const dlg = openSheet({ title: "Match details", fields: bits, actions, onClose: () => {} }, card);
  void dlg;
  // the Close button is not the auto Cancel; wire it to close both sheets
  const closeBtn = dlg.querySelector("button");
  void closeBtn;
}

function closeTop(): void {
  const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (dlg) closeSheetFor(dlg);
}

function openEditDialog(m: Match, card: HTMLElement, onDone: () => void): void {
  const fields = scoreFields(m, m.upper_games ?? 0, m.lower_games ?? 0);
  const resetCountStatus = el("div", { class: "small", attrs: { role: "status", id: "reset-count", "aria-label": "Reset count" } }, []);
  const resetList = el("ul", { class: "list-plain small", attrs: { role: "list", "aria-label": "Matches that will reset" } });
  let confirmBtn: HTMLButtonElement | null = null;
  let token: string | null = null;
  const dialog = openSheet(
    {
      title: "Edit result",
      fields: [fields.host, resetCountStatus, resetList],
      actions: [
        el("button", {
          class: "btn",
          on: {
            click: async () => {
              const values = scoreValues(fields.upper, fields.lower);
              clearSheetErrors(document.querySelector<HTMLDialogElement>("dialog[open]"));
              if (!values) {
                document.querySelector<HTMLDialogElement>("dialog[open]")?.appendChild(fieldError("Enter a whole number from 0 to 99."));
                return;
              }
              busy(true);
              try {
                const res = await api<EditPreviewResponse>("POST", `/api/matches/${m.id}/edit-preview`, {
                  upper_games: values.upper_games,
                  lower_games: values.lower_games,
                  version: m.version,
                });
                token = res.preview_token;
                busy(false);
                sheetStatus("");
                await runShutterTrace(res, card);
                drawResetCount(resetCountStatus, resetList, res);
                if (!confirmBtn) {
                  confirmBtn = el("button", {
                    class: "btn",
                    on: { click: () => commitEdit() },
                  }, ["Confirm edit"]);
                  const sheets = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
                  (sheets[sheets.length - 1]?.querySelector(".sheet-actions") as HTMLElement | undefined)?.prepend(confirmBtn);
                } else {
                  confirmBtn.hidden = false;
                }
              } catch (e) {
                busy(false);
                if (e instanceof ApiFailure) {
                  document.querySelector<HTMLDialogElement>("dialog[open]")?.appendChild(fieldError(e.body.message));
                }
              }
            },
          },
        }, ["Review edit"]),
      ],
      onClose: () => {
        clearShutterTrace();
      },
    },
    card
  );
  // changing a spinbutton afterwards hides Confirm edit and reverses the trace until reviewed again
  const onChange = (): void => {
    if (confirmBtn) confirmBtn.hidden = true;
    if (token) {
      token = null;
      clearShutterTrace();
      resetCountStatus.textContent = "";
      clear(resetList);
    }
  };
  fields.upper.addEventListener("input", onChange);
  fields.lower.addEventListener("input", onChange);

  async function commitEdit(): Promise<void> {
    if (!token) return;
    const values = scoreValues(fields.upper, fields.lower);
    if (!values) return;
    busy(true);
    try {
      await api("POST", `/api/matches/${m.id}/edit`, {
        upper_games: values.upper_games,
        lower_games: values.lower_games,
        preview_token: token,
      });
      // both dialogs close and focus returns to the edited card
      const details = card.ownerDocument.querySelectorAll("dialog[open]");
      details.forEach((d) => {
        closeSheetFor(d as HTMLDialogElement);
      });
      focusCard(m.id);
      actionStatus("Result edited");
      onDone();
    } catch (e) {
      busy(false);
      if (e instanceof ApiFailure) {
        document.querySelector<HTMLDialogElement>("dialog[open]")?.appendChild(fieldError(e.body.message));
        focusFirstInput(document.querySelector("dialog[open]"));
      }
    }
  }
  void dialog;
}

function drawResetCount(status: HTMLElement, list: HTMLElement, res: EditPreviewResponse): void {
  const sentence =
    res.count === 0
      ? "No later matches will reset."
      : res.count === 1
        ? res.confirmed_count === 1
          ? "1 match will reset, it is confirmed"
          : "1 match will reset, it is not confirmed"
        : `${res.count} matches will reset, ${res.confirmed_count} of them confirmed`;
  status.textContent = sentence;
  clear(list);
  for (const d of res.dependents) {
    list.appendChild(el("li", { class: "small" }, [d.label]));
  }
}
