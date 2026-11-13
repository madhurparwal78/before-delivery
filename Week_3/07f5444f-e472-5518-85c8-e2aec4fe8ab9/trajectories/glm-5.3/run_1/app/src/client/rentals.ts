// The Rentals screen: sets table, check-in dialog with expected counts.

import { el, statusRegion, openModal, type ModalHandle } from "./dom.js";
import { api, apiRoutes, type Client, type ApiError } from "./api.js";
import type { Shell } from "./main.js";
import { formatDateString, formatDate } from "../shared/london.js";
import { rentalStatusLabel } from "../shared/domain.js";
import type { RentalSet, User, ProgrammeDetail, ProgrammeSummary, WorkDetail, Part } from "../shared/domain.js";

export async function renderRentalsScreen(
  shell: Shell,
  client: Client,
  user: User
): Promise<void> {
  shell.main.replaceChildren();
  const rentalStatus = statusRegion("Rental status");
  const page = el("div", { class: "page" });
  shell.main.append(page);

  const loadSets = async (): Promise<RentalSet[]> => {
    const response = await api<{ rental_sets: RentalSet[] }>("GET", apiRoutes.rentalSets());
    return response.rental_sets;
  };

  let sets: RentalSet[] = await loadSets();
  let dialogRefresh: (() => Promise<void>) | null = null;

  const render = (): void => {
    page.replaceChildren();
    const heading = el("h1", {}, "Rentals");
    const newButton = el("button", { class: "primary" }, "New rental set");
    if (user.role === "principal_librarian") {
      newButton.addEventListener("click", () => openNewRentalSet(newButton));
    } else {
      newButton.setAttribute("aria-disabled", "true");
    }
    const table = el("table", { class: "data" });
    table.setAttribute("aria-label", "Rental sets");
    const head = el("thead", {}, el("tr", {},
      el("th", {}, "Work"), el("th", {}, "Publisher"), el("th", {}, "Programme"),
      el("th", { class: "num" }, "Due"), el("th", {}, "Status"),
      el("th", { class: "num" }, "Copies"), el("th", {}, "Reminder"), el("th", {}, "Actions")));
    const body = el("tbody");
    for (const set of sets) {
      body.append(buildSetRow(set));
    }
    table.append(head, body);
    page.append(
      el("div", { class: "page-title-row" }, heading, newButton),
      table,
      el("div", { class: "rentals-status" }, rentalStatus)
    );
  };

  const reminderCell = (set: RentalSet): string => {
    if (set.reminder.status === "sent" && set.reminder.sent_at) {
      return `Reminder sent ${formatDate(Date.parse(set.reminder.sent_at))}`;
    }
    if (set.reminder.status === "queued") return "Reminder queued";
    return "No reminder yet";
  };

  const buildSetRow = (set: RentalSet): HTMLElement => {
    const dueText = formatDateString(set.due_date);
    const copies = `${set.copies_checked_in} of ${set.copies_on_slip}`;
    const statusCell = el("td", { class: "num" },
      set.overdue ? el("span", { class: "short-marker" }, "Overdue") : set.display_status);
    const actions = el("td", {});

    const edgeButton = (to: string, label: string): HTMLElement => {
      const button = el("button", {}, label);
      button.setAttribute("aria-label", `${label} ${set.work_title}`);
      button.addEventListener("click", () => void transitionSet(set.id, to, set.work_title));
      return button;
    };
    if (user.role === "principal_librarian") {
      if (set.status === "requested") actions.append(edgeButton("received", "Mark received"));
      if (set.status === "received") actions.append(edgeButton("in_use", "Mark in use"));
    }
    if (set.status === "in_use") {
      const checkIn = el("button", {}, "Check in");
      checkIn.setAttribute("aria-label", `Check in ${set.work_title}`);
      checkIn.addEventListener("click", () => openCheckInDialog(checkIn, set));
      actions.append(checkIn);
    }
    if (user.role === "principal_librarian" && set.status === "returned") {
      actions.append(edgeButton("checked_in", "Confirm publisher receipt"));
    }

    return el("tr", { "data-set-id": set.id },
      el("td", {}, set.work_title),
      el("td", {}, set.publisher),
      el("td", { class: "num" }, set.programme_number),
      el("td", { class: "num", "data-label": "Due" }, dueText),
      statusCell,
      el("td", { class: "num" }, copies),
      el("td", {}, reminderCell(set)),
      actions
    );
  };

  const transitionSet = async (setId: string, to: string, workTitle: string): Promise<void> => {
    rentalStatus.textContent = "Updating rental set";
    try {
      const fresh = await api<RentalSet>("POST", apiRoutes.rentalTransition(setId), { to });
      rentalStatus.textContent = `${workTitle} set is now ${rentalStatusLabel(fresh.status)}.`;
      sets = await loadSets();
      render();
    } catch (error) {
      rentalStatus.textContent = String((error as ApiError).body?.message ?? "Update failed.");
    }
  };

  // ------------------------------------------------------------ check-in dialog

  const openCheckInDialog = (opener: HTMLElement, set: RentalSet): void => {
    interface Line {
      partId: string;
      partName: string;
      expected: number;
      changed: boolean;
    }
    const lines = new Map<string, Line>();
    for (const line of set.slip) {
      lines.set(line.part_id, {
        partId: line.part_id,
        partName: line.part_name,
        expected: line.checked_in,
        changed: false,
      });
    }

    openModal(`Check in ${set.work_title}`, opener, (modal: ModalHandle) => {
      const inputs = new Map<string, HTMLInputElement>();
      const wrap = el("div", {});
      const buildInputs = (current: RentalSet): void => {
        wrap.replaceChildren();
        inputs.clear();
        for (const line of current.slip) {
          const input = el("input", {
            type: "number", min: "0", max: String(line.copies),
            value: String(inputValueFor(line.part_id, line.checked_in)),
          }) as HTMLInputElement;
          input.setAttribute("aria-label", `Returned ${line.part_name}`);
          const entry = lines.get(line.part_id);
          if (entry) {
            input.addEventListener("input", () => {
              entry.changed = true;
            });
          }
          inputs.set(line.part_id, input);
          wrap.append(
            el("div", { class: "field" },
              el("label", {}, `${line.part_name} (slip ${line.copies})`),
              input)
          );
        }
      };

      const inputValueFor = (partId: string, stored: number): number => {
        const previous = inputs.get(partId);
        if (previous && previous.dataset.typed) return Number(previous.value);
        void partId;
        return stored;
      };

      const saveButton = el("button", { class: "primary" }, "Save counts");
      const markReturned = el("button", {}, "Mark returned");
      const closeButton = el("button", { type: "button" }, "Close");
      closeButton.addEventListener("click", () => modal.close());

      const saveCounts = async (): Promise<void> => {
        const counts: { part_id: string; copies: number; expected: number }[] = [];
        for (const [partId, entry] of lines) {
          if (!entry.changed) continue;
          const input = inputs.get(partId);
          if (!input) continue;
          counts.push({
            part_id: partId,
            copies: Number(input.value),
            expected: entry.expected,
          });
        }
        if (counts.length === 0) {
          rentalStatus.textContent = "Saving counts";
          rentalStatus.textContent = `Check-in counts saved for ${set.work_title}.`;
          return;
        }
        rentalStatus.textContent = "Saving counts";
        try {
          const fresh = await api<RentalSet>("PUT", apiRoutes.checkIn(set.id), { counts });
          rentalStatus.textContent = `Check-in counts saved for ${fresh.work_title}.`;
          sets = await loadSets();
          for (const line of fresh.slip) {
            const entry = lines.get(line.part_id);
            if (entry && !entry.changed) entry.expected = line.checked_in;
          }
          set = fresh;
          buildInputs(fresh);
          render();
        } catch (error) {
          const apiError = error as ApiError;
          if (apiError.body?.error === "count_changed") {
            const changed = (apiError.body.lines ?? []) as {
              part_id: string; part_name: string; checked_in: number;
            }[];
            const clauses = changed.map((line) => `${line.part_name} is now ${line.checked_in}`);
            rentalStatus.textContent = `Counts changed while you were typing: ${clauses.join("; ")}.`;
            for (const line of changed) {
              const entry = lines.get(line.part_id);
              if (entry) {
                entry.expected = line.checked_in;
                entry.changed = false;
              }
              const input = inputs.get(line.part_id);
              if (input) {
                input.value = String(line.checked_in);
                delete input.dataset.typed;
              }
            }
          } else {
            rentalStatus.textContent = String(apiError.body?.message ?? "Save failed.");
          }
        }
      };
      saveButton.addEventListener("click", () => void saveCounts());

      markReturned.addEventListener("click", async () => {
        rentalStatus.textContent = "Marking returned";
        try {
          const fresh = await api<RentalSet>(
            "POST", apiRoutes.rentalTransition(set.id), { to: "returned" }
          );
          rentalStatus.textContent = `${fresh.work_title} set is now Returned.`;
          dialogRefresh = null;
          modal.close();
          sets = await loadSets();
          render();
        } catch (error) {
          const apiError = error as ApiError;
          rentalStatus.textContent = String(apiError.body?.message ?? "Mark returned failed.");
        }
      });

      buildInputs(set);
      dialogRefresh = async (): Promise<void> => {
        try {
          const fresh = (await api<{ rental_sets: RentalSet[] }>("GET", apiRoutes.rentalSets()))
            .rental_sets.find((entry) => entry.id === set.id);
          if (!fresh) return;
          set = fresh;
          for (const line of fresh.slip) {
            const entry = lines.get(line.part_id);
            if (entry && !entry.changed) entry.expected = line.checked_in;
          }
          for (const line of fresh.slip) {
            const entry = lines.get(line.part_id);
            if (entry && entry.changed) continue;
            const input = inputs.get(line.part_id);
            if (input && document.activeElement !== input) {
              input.value = String(line.checked_in);
              delete input.dataset.typed;
            }
          }
        } catch {
          // A refresh that fails changes nothing.
        }
      };
      const originalClose = modal.close;
      modal.close = (): void => {
        dialogRefresh = null;
        originalClose();
      };
      return el("div", {},
        wrap,
        el("div", { class: "dialog-actions" }, closeButton, markReturned, saveButton)
      );
    });
  };

  // ---------------------------------------------------------- new rental set

  const openNewRentalSet = (opener: HTMLElement): void => {
    openModal("New rental set", opener, (modal: ModalHandle) => {
      const container = el("div", {}, "Loading works…");
      void api<{ programmes: ProgrammeSummary[] }>("GET", apiRoutes.programmes()).then(
        async (programmes) => {
          container.replaceChildren();
          const select = el("select", { "aria-label": "Work" }) as HTMLSelectElement;
          const workParts = new Map<string, Part[]>();
          for (const summary of programmes.programmes) {
            const programme = await api<ProgrammeDetail>("GET", apiRoutes.programme(summary.id));
            for (const workSummary of programme.works) {
              const detail = await api<WorkDetail>("GET", apiRoutes.work(workSummary.id));
              workParts.set(workSummary.id, detail.parts);
              select.append(el("option", { value: workSummary.id },
                `${workSummary.title} · Programme ${summary.number}`));
            }
          }
          const publisher = el("textarea", {
            class: "singleline", rows: "1",
          }) as HTMLTextAreaElement;
          publisher.setAttribute("aria-label", "Publisher");
          const publisherError = el("span", { class: "error" });
          publisher.setAttribute("aria-describedby", "rs-err-publisher");
          publisherError.id = "rs-err-publisher";

          const slipWrap = el("div", {});
          const buildSlip = (): void => {
            slipWrap.replaceChildren();
            const parts = workParts.get(select.value) ?? [];
            for (const part of parts) {
              const input = el("input", {
                type: "number", min: "0", max: "99", value: "0",
              }) as HTMLInputElement;
              input.setAttribute("aria-label", `Slip copies ${part.name}`);
              slipWrap.append(
                el("div", { class: "field" },
                  el("label", {}, part.name),
                  input)
              );
            }
          };
          select.addEventListener("change", buildSlip);
          buildSlip();

          const create = el("button", { class: "primary" }, "Create rental set");
          const cancel = el("button", { type: "button" }, "Cancel");
          cancel.addEventListener("click", () => modal.close());
          create.addEventListener("click", async () => {
            publisherError.textContent = "";
            const slip: { part_id: string; copies: number }[] = [];
            const parts = workParts.get(select.value) ?? [];
            for (const part of parts) {
              const input = Array.from(slipWrap.querySelectorAll<HTMLInputElement>("input"))
                .find((node) => node.getAttribute("aria-label") === `Slip copies ${part.name}`);
              if (!input) continue;
              const copies = Number(input.value);
              if (copies > 0) slip.push({ part_id: part.id, copies });
            }
            rentalStatus.textContent = "Creating rental set";
            try {
              const fresh = await api<RentalSet>("POST", apiRoutes.rentalSets(), {
                work_id: select.value,
                publisher: publisher.value,
                slip,
              });
              rentalStatus.textContent = `Rental set created for ${fresh.work_title}.`;
              modal.close();
              sets = await loadSets();
              render();
            } catch (error) {
              const apiError = error as ApiError;
              const fieldErrors = (apiError.body?.errors ?? {}) as Record<string, string>;
              if (fieldErrors.publisher) publisherError.textContent = fieldErrors.publisher;
              rentalStatus.textContent = String(apiError.body?.message ?? "Create failed.");
            }
          });

          container.append(
            el("div", { class: "field" }, el("label", {}, "Work"), select),
            el("div", { class: "field" },
              el("label", {}, "Publisher"), publisher, publisherError),
            el("div", { class: "field" }, el("label", {}, "Slip copies"), slipWrap),
            el("div", { class: "dialog-actions" }, cancel, create)
          );
        }
      );
      return container;
    });
  };

  const refresh = async (): Promise<void> => {
    try {
      if (dialogRefresh) await dialogRefresh();
      sets = await loadSets();
      render();
    } catch {
      // A refresh that fails changes nothing.
    }
  };

  render();
  setInterval(() => void refresh(), 60000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  void client;
}

