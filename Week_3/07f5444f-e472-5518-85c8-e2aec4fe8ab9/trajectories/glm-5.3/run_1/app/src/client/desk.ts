// The programme desk: works rail, header, bar ruler and parts table.

import {
  el, statusRegion, openModal, prefersReducedMotion, LatestWins,
  type ModalHandle,
} from "./dom.js";
import { api, apiRoutes, uploadWithProgress, type Client, type ApiError } from "./api.js";
import type { Shell } from "./main.js";
import {
  formatDateTime, formatDateString, formatRunningTime, wallToInstant,
  formatDate,
} from "../shared/london.js";
import {
  SECTION_KEYS, SECTION_NAMES, SECTION_ROSTER, statusLabel, stringCountText,
  partLabel, plural,
} from "../shared/domain.js";
import type {
  ProgrammeDetail, ProgrammeStatus, ProgrammeSummary, WorkDetail, Part, User,
  CatalogueWork, ServiceStatus,
} from "../shared/domain.js";

interface CatalogueResponse {
  works: CatalogueWork[];
}

const OUTAGE_BANNER =
  "The score store is offline. Scans can't be uploaded or opened right now. Catalogue, counts and cuts still work.";

export async function renderDeskScreen(
  shell: Shell,
  client: Client,
  user: User,
  programmeId: string | undefined,
  workId: string | undefined
): Promise<void> {
  void user;
  shell.main.replaceChildren();
  const programmes = (await api<{ programmes: ProgrammeSummary[] }>("GET", apiRoutes.programmes())).programmes;
  let currentId = programmeId;
  if (!currentId) {
    const open = programmes.find((p) => p.status !== "closed") ?? programmes[0];
    currentId = open ? open.id : "";
  }
  if (!currentId) {
    shell.main.append(el("div", { class: "page" }, "No programmes yet."));
    return;
  }
  let detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
  let selectedWorkId =
    workId && detail.works.some((w) => w.id === workId)
      ? workId
      : detail.works[0]?.id;
  let work = selectedWorkId
    ? await api<WorkDetail>("GET", apiRoutes.work(selectedWorkId))
    : null;

  const deskStatus = statusRegion("Desk status");
  const grid = el("div", { class: "desk-grid" });

  // ------------------------------------------------------------- works rail

  const rail = el("aside", { class: "rail rail-column", role: "complementary" });
  rail.setAttribute("aria-label", "Programmes and works");
  const railInline = el("aside", { class: "rail rail-inline", role: "complementary" });
  railInline.setAttribute("aria-label", "Programmes and works");

  const buildRail = async (container: HTMLElement): Promise<void> => {
    container.replaceChildren();
    const summaries = (await api<{ programmes: ProgrammeSummary[] }>("GET", apiRoutes.programmes())).programmes;
    for (const summary of summaries) {
      const link = el(
        "a",
        {
          class: "rail-item",
          href: `/desk/${summary.id}`,
          "aria-label": `Programme ${summary.number} · ${summary.title}`,
        },
        el("span", { class: "numeral mono" }, summary.number),
        el("span", { class: "rail-title" }, summary.title),
        el("span", { class: "rail-status" }, statusLabel(summary.status))
      );
      container.append(link);
      if (summary.id === currentId) {
        const worksList = el("ul", { class: "rail-works" });
        worksList.setAttribute("aria-label", "Works in programme");
        const detailNow = await api<ProgrammeDetail>("GET", apiRoutes.programme(summary.id));
        for (const workSummary of detailNow.works) {
          const figures = el(
            "span",
            { class: "rail-figures mono" },
            `Needed ${workSummary.copies.needed}`,
            ` · On hand ${workSummary.copies.on_hand}`,
            ` · Short ${workSummary.copies.shortfall}`,
            ` · ${workSummary.parts_to_mark} to mark`
          );
          const item = el(
            "li",
            {},
            el("a", { href: `/desk/${summary.id}?work=${workSummary.id}` }, workSummary.title),
            figures
          );
          worksList.append(item);
        }
        container.append(worksList);
      }
    }
  };

  // --------------------------------------------------------------- header

  const header = el("section", { class: "programme-header" });
  header.setAttribute("aria-label", "Programme header");
  const statusActions = el("div", { class: "header-actions" });

  const spinbuttons: Record<string, HTMLInputElement> = {};
  const buildHeader = (): void => {
    header.replaceChildren();
    const title = el("h1", {}, detail.title);
    const heading = el("div", { class: "header-field" },
      title,
      el("span", { class: "header-status mono" },
        `${detail.number} · ${statusLabel(detail.status)}`),
      el("span", { class: "header-dates" },
        `First rehearsal ${formatDateTime(Date.parse(detail.first_rehearsal))}`,
        el("br"),
        `Final performance ${formatDateString(detail.final_performance_date)}`)
    );
    const running = el("div", { class: "header-field" },
      el("span", { class: "header-label" }, "Running time"),
      el("span", { class: "mono", "data-running-time": "true" }, detail.running_time)
    );
    running.setAttribute("role", "group");
    running.setAttribute("aria-label", "Running time");
    const copiesGroup = el("div", { class: "header-field" });
    copiesGroup.setAttribute("role", "group");
    copiesGroup.setAttribute("aria-label", "Programme copies");
    const copies = el("span", { class: "counts mono" },
      `Needed ${detail.copies.needed}`, `On hand ${detail.copies.on_hand}`);
    const shortMarker = el("span", { class: "short-marker" }, `Short ${detail.copies.shortfall}`);
    copies.append(shortMarker);
    copiesGroup.append(el("span", { class: "header-label" }, "Programme copies"), copies);

    const spinRow = el("div", { class: "spin-row" });
    for (const key of SECTION_KEYS) {
      const input = el("input", {
        type: "number", min: "0", max: String(SECTION_ROSTER[key]),
        value: String(detail.string_count[key]),
        id: `count-${key}`,
        "aria-label": SECTION_NAMES[key],
      }) as HTMLInputElement;
      spinbuttons[key] = input;
      spinRow.append(input);
    }
    const saveCount = el("button", { class: "primary" }, "Save string count");
    saveCount.addEventListener("click", () => void saveStringCount());
    spinRow.append(saveCount);
    const countField = el("div", { class: "header-field" },
      el("span", { class: "header-label" }, "String count"),
      spinRow
    );

    header.append(heading, running, copiesGroup, countField, statusActions);
    buildStatusActions();
  };

  let publishDialogRefresh: (() => void) | null = null;
  let savesInFlight = 0;

  const refreshProgrammeRead = async (): Promise<void> => {
    detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
    if (selectedWorkId) {
      work = await api<WorkDetail>("GET", apiRoutes.work(selectedWorkId));
    }
    if (publishDialogRefresh) publishDialogRefresh();
    if (savesInFlight > 0) return;
    if (focusOwner() === null) buildHeader();
    renderRailAndParts();
  };

  const refreshTicket = new LatestWins();
  const focusOwner = (): HTMLElement | null => {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) return active;
    return null;
  };

  // ------------------------------------------------------------ rail parts

  const partsPane = el("section", { class: "parts-pane" });
  const renderRailAndParts = (): void => {
    void buildRail(rail);
    void buildRail(railInline);
    buildPartsTable();
    if (focusOwner() === null) {
      const running = header.querySelector<HTMLElement>('[data-running-time]');
      if (running) running.textContent = detail.running_time;
      const copies = header.querySelector(".counts");
      if (copies) {
        copies.replaceChildren(
          `Needed ${detail.copies.needed}`, `On hand ${detail.copies.on_hand}`,
          el("span", { class: "short-marker" }, `Short ${detail.copies.shortfall}`)
        );
      }
      for (const key of SECTION_KEYS) {
        const input = spinbuttons[key];
        if (input && document.activeElement !== input && !input.dataset.dirty) {
          input.value = String(detail.string_count[key]);
        }
      }
    }
  };

  // ---------------------------------------------------------- status actions

  const buildStatusActions = (): void => {
    statusActions.replaceChildren();
    const newProgramme = el("button", {}, "New programme");
    newProgramme.addEventListener("click", () => openNewProgramme(newProgramme));
    statusActions.append(newProgramme);

    const addWork = el("button", {}, "Add work");
    addWork.addEventListener("click", () => openAddWork(addWork));
    if (detail.status === "draft" || detail.status === "in_preparation") {
      statusActions.append(addWork);
    }

    const edges: Record<string, { to: ProgrammeStatus; label: string }[]> = {
      draft: [{ to: "in_preparation", label: "Start preparation" }],
      in_preparation: [
        { to: "draft", label: "Return to draft" },
      ],
      published: [{ to: "in_performance", label: "Start performances" }],
      in_performance: [{ to: "closed", label: "Close programme" }],
      closed: [],
    };
    for (const edge of edges[detail.status]) {
      const button = el("button", {}, edge.label);
      button.addEventListener("click", () => void transitionProgramme(edge.to));
      statusActions.append(button);
    }
    if (detail.status === "in_preparation") {
      const publish = el("button", { class: "primary" }, "Publish folders");
      publish.addEventListener("click", () => openPublishDialog(publish));
      statusActions.append(publish);
    }
    const notices = el("a", { href: "#" }, "Player notices");
    notices.addEventListener("click", (event) => {
      event.preventDefault();
      void openNoticesDialog(notices);
    });
    statusActions.append(notices);
  };

  const transitionProgramme = async (to: ProgrammeStatus): Promise<void> => {
    deskStatus.textContent = "Updating programme";
    try {
      detail = await api<ProgrammeDetail>("POST", apiRoutes.transition(currentId), { to });
      deskStatus.textContent = `Programme ${detail.number} is now ${statusLabel(detail.status)}.`;
      buildHeader();
      renderRailAndParts();
    } catch (error) {
      const body = (error as ApiError).body;
      void body;
      deskStatus.textContent = `Programme ${detail.number} can't move from ${statusLabel(detail.status)} to ${statusLabel(to)}.`;
    }
  };

  // ------------------------------------------------------- string count save

  const saveStringCount = async (): Promise<void> => {
    const values: Record<string, number> = {};
    for (const key of SECTION_KEYS) {
      const input = spinbuttons[key];
      const value = Number(input.value);
      values[key] = Number.isNaN(value) ? NaN : value;
      delete input.dataset.dirty;
    }
    deskStatus.textContent = "Saving string count";
    const ticket = refreshTicket.begin();
    savesInFlight += 1;
    try {
      const response = await api<ProgrammeDetail>(
        "PUT", apiRoutes.stringCount(currentId), values
      );
      if (!refreshTicket.isLatest(ticket)) return;
      detail = response;
      deskStatus.textContent = `String count saved: ${stringCountText(detail.string_count)}. Short ${detail.copies.shortfall}.`;
      renderRailAndParts();
      buildHeader();
    } catch (error) {
      if (!refreshTicket.isLatest(ticket)) return;
      const body = (error as ApiError).body;
      const errors = (body?.errors ?? {}) as Record<string, string>;
      deskStatus.textContent = "String count not saved. Check the highlighted sections.";
      for (const key of SECTION_KEYS) {
        const input = spinbuttons[key];
        const message = errors[key] ?? errors[`string_count.${key}`];
        if (message) input.setAttribute("aria-describedby", `err-${key}`);
        else input.removeAttribute("aria-describedby");
        let helper = document.getElementById(`err-${key}`);
        if (message) {
          if (!helper) {
            helper = el("span", { id: `err-${key}`, class: "error" });
            input.after(helper);
          }
          helper.textContent = message;
        } else if (helper) {
          helper.remove();
        }
      }
    } finally {
      savesInFlight -= 1;
    }
  };

  // ------------------------------------------------------------ new programme

  const openNewProgramme = (opener: HTMLElement): void => {
    openModal("New programme", opener, (modal: ModalHandle) => {
      const errors: Record<string, HTMLSpanElement> = {
        performances: el("span", { class: "error" }),
      };
      const title = el("textarea", {
        class: "singleline", rows: "1", id: "np-title", name: "Title",
      }) as HTMLTextAreaElement;
      title.setAttribute("aria-label", "Title");
      const firstRehearsal = el("input", {
        type: "text", class: "datetime", id: "np-first",
        placeholder: "2026-12-01 10:00",
      }) as HTMLInputElement;
      firstRehearsal.setAttribute("aria-label", "First rehearsal (London time)");
      const performanceInputs: HTMLInputElement[] = [];
      const performancesWrap = el("div", {});
      const addPerformance = (): void => {
        const input = el("input", {
          type: "text", class: "datetime", placeholder: "2026-12-05 19:30",
        }) as HTMLInputElement;
        input.setAttribute("aria-label", `Performance ${performanceInputs.length + 1} (London time)`);
        performanceInputs.push(input);
        performancesWrap.append(input);
      };
      addPerformance();

      const defaultCounts: Record<string, number> = {
        violin_1: 8, violin_2: 7, viola: 6, cello: 5, bass: 4,
      };
      const spins: Record<string, HTMLInputElement> = {};
      const spinRow = el("div", { class: "spin-row" });
      for (const key of SECTION_KEYS) {
        const input = el("input", {
          type: "number", min: "0", max: String(SECTION_ROSTER[key]),
          value: String(defaultCounts[key]),
        }) as HTMLInputElement;
        input.setAttribute("aria-label", SECTION_NAMES[key]);
        spins[key] = input;
        spinRow.append(input);
      }

      const field = (label: string, control: HTMLElement, key: string): HTMLElement => {
        const errorSpan = el("span", { class: "error", id: `np-err-${key}` });
        errors[key] = errorSpan;
        control.setAttribute("aria-describedby", `np-err-${key}`);
        const wrap = el("div", { class: "field" }, el("label", {}, label), control, errorSpan);
        return wrap;
      };

      const addPerformanceButton = el("button", { type: "button" }, "Add performance");
      addPerformanceButton.addEventListener("click", () => {
        if (performanceInputs.length < 10) addPerformance();
      });

      const create = el("button", { class: "primary" }, "Create programme");
      const cancel = el("button", { type: "button" }, "Cancel");
      cancel.addEventListener("click", () => modal.close());

      const validateDateTime = (input: HTMLInputElement): string | null => {
        const text = input.value.trim();
        const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
        if (!match) return "Enter a date and time like 2026-12-01 10:00.";
        const wall = {
          year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
          hour: Number(match[4]), minute: Number(match[5]), second: 0,
        };
        const instant = wallToInstant(wall);
        if (instant.kind === "missing") {
          return `There is no ${match[4]}:${match[5]} on ${formatDate(Date.UTC(wall.year, wall.month - 1, wall.day, 12))} in London time.`;
        }
        return null;
      };

      create.addEventListener("click", async () => {
        for (const span of Object.values(errors)) span.textContent = "";
        const firstError = validateDateTime(firstRehearsal);
        if (firstError) errors.first_rehearsal.textContent = firstError;
        performanceInputs.forEach((input, index) => {
          const message = validateDateTime(input);
          if (message) {
            errors.performances.textContent = message;
            void index;
          }
        });
        const firstInvalid =
          firstError ? firstRehearsal :
          errors.performances.textContent ? performanceInputs.find(
            (input) => validateDateTime(input) !== null
          ) ?? null : null;
        if (firstInvalid) {
          firstInvalid.focus();
          return;
        }
        const wallFirst = wallToInstant(parseWall(firstRehearsal.value.trim()));
        const performances = performanceInputs
          .map((input) => {
            const wall = parseWall(input.value.trim());
            const instant = wallToInstant(wall);
            return instant.kind === "ok" ? wallClockTimestamp(wall, instant.offsetMinutes) : null;
          })
          .filter((value): value is string => value !== null);
        const payload = {
          title: title.value,
          first_rehearsal: wallFirst.kind === "ok"
            ? wallClockTimestamp(parseWall(firstRehearsal.value.trim()), wallFirst.offsetMinutes)
            : firstRehearsal.value.trim(),
          performances,
          string_count: Object.fromEntries(SECTION_KEYS.map((key) => [key, Number(spins[key].value)])),
        };
        deskStatus.textContent = "Creating programme";
        try {
          const created = await api<ProgrammeDetail>("POST", apiRoutes.createProgramme(), payload);
          deskStatus.textContent = `Programme ${created.number} created.`;
          modal.close();
          location.assign(`/desk/${created.id}`);
        } catch (error) {
          const body = (error as ApiError).body;
          const fieldErrors = (body?.errors ?? {}) as Record<string, string>;
          deskStatus.textContent = "Check the highlighted fields.";
          if (fieldErrors.title) errors.title.textContent = fieldErrors.title;
          if (fieldErrors.first_rehearsal) errors.first_rehearsal.textContent = fieldErrors.first_rehearsal;
          if (fieldErrors.performances) errors.performances.textContent = fieldErrors.performances;
          for (const key of SECTION_KEYS) {
            const message = fieldErrors[`string_count.${key}`];
            if (message) {
              const span = el("span", { class: "error" }, message);
              spins[key].after(span);
            }
          }
        }
      });

      const form = el("div", {},
        field("Title", title, "title"),
        field("First rehearsal (London time)", firstRehearsal, "first_rehearsal"),
        el("div", { class: "field" }, el("label", {}, "Performances"), performancesWrap, addPerformanceButton, errors.performances),
        el("div", { class: "field" }, el("label", {}, "String count"), spinRow),
        el("div", { class: "dialog-actions" }, cancel, create)
      );
      return form;
    });
  };

  // ------------------------------------------------------------------ add work

  const openAddWork = (opener: HTMLElement): void => {
    openModal("Add work", opener, (modal: ModalHandle) => {
      const container = el("div", {}, "Loading catalogue…");
      void api<CatalogueResponse>("GET", apiRoutes.catalogue()).then((catalogue) => {
        container.replaceChildren();
        const select = el("select", { "aria-label": "Catalogue work" }) as HTMLSelectElement;
        for (const work of catalogue.works) {
          select.append(el("option", { value: work.id }, `${work.title} · ${work.composer}`));
        }
        const add = el("button", { class: "primary" }, "Add");
        const cancel = el("button", { type: "button" }, "Cancel");
        cancel.addEventListener("click", () => modal.close());
        add.addEventListener("click", async () => {
          deskStatus.textContent = "Adding work";
          try {
            const added = await api<WorkDetail>("POST", apiRoutes.addWork(currentId), {
              catalogue_work_id: select.value,
            });
            deskStatus.textContent = `${added.title} added to Programme ${detail.number}.`;
            modal.close();
            selectedWorkId = added.id;
            work = added;
            detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
            buildHeader();
            renderRailAndParts();
            renderRuler();
            history.replaceState(null, "", `/desk/${currentId}?work=${added.id}`);
          } catch (error) {
            deskStatus.textContent = String((error as ApiError).body?.message ?? "Add failed.");
          }
        });
        container.append(
          el("div", { class: "field" }, el("label", {}, "Catalogue work"), select),
          el("div", { class: "dialog-actions" }, cancel, add)
        );
        select.focus();
      });
      return container;
    });
  };

  // -------------------------------------------------------------------- publish

  const openPublishDialog = (opener: HTMLElement): void => {
    void api<ProgrammeDetail>("GET", apiRoutes.programme(currentId)).then((fresh) => {
      detail = fresh;
      openModal("Publish folders", opener, (modal: ModalHandle) => {
        const seatedLine = el("p", { class: "mono" },
          `Seated players: ${detail.seated_players}`);
        const rehearsalLine = el("p", { class: "mono" },
          `First rehearsal ${formatDateTime(Date.parse(detail.first_rehearsal))}`);
        const list = el("ul", { class: "dialog-list" });
        list.setAttribute("aria-label", "Publish blockers");
        const noBlockers = el("p", {}, "Nothing blocks publishing.");
        const publish = el("button", { class: "primary" }, "Publish");
        const cancel = el("button", { type: "button" }, "Cancel");
        cancel.addEventListener("click", () => modal.close());

        const renderBlockers = (): void => {
          seatedLine.textContent = `Seated players: ${detail.seated_players}`;
          rehearsalLine.textContent =
            `First rehearsal ${formatDateTime(Date.parse(detail.first_rehearsal))}`;
          list.replaceChildren(
            ...detail.publish_blockers.map((blocker) => el("li", {}, blocker.message))
          );
          noBlockers.style.display = detail.publish_blockers.length === 0 ? "" : "none";
          if (detail.publish_blockers.length === 0) publish.removeAttribute("disabled");
          else publish.setAttribute("disabled", "true");
        };
        renderBlockers();
        publishDialogRefresh = renderBlockers;
        const originalClose = modal.close;
        modal.close = (): void => {
          publishDialogRefresh = null;
          originalClose();
        };

        let publishKey = crypto.randomUUID();
        publish.addEventListener("click", async () => {
          deskStatus.textContent = "Publishing folders";
          try {
            const response = await api<{
              programme: ProgrammeDetail;
              notices: { sent: number; queued: number };
            }>("POST", apiRoutes.publish(currentId), undefined, {
              headers: { "Idempotency-Key": publishKey },
            });
            deskStatus.textContent = `Folders published. Player notices: ${response.notices.sent} sent, ${response.notices.queued} queued.`;
            detail = response.programme;
            modal.close();
            buildHeader();
            renderRailAndParts();
          } catch (error) {
            const body = (error as ApiError).body;
            if (body?.error === "network") {
              return;
            }
            deskStatus.textContent = String(body?.message ?? "Publish failed.");
            detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
            renderBlockers();
          }
        });

        modal.root.dataset.publishDialog = "true";
        return el("div", {},
          seatedLine, rehearsalLine, list, noBlockers,
          el("div", { class: "dialog-actions" }, cancel, publish)
        );
      });
    });
  };

  const openNoticesDialog = async (opener: HTMLElement): Promise<void> => {
    const notices = await api<{ notices: { player_id: string; name: string; chair_label: string; status: string; sent_at: string | null }[] }>(
      "GET", apiRoutes.notices(currentId)
    );
    openModal("Player notices", opener, () => {
      const table = el("table", { class: "data" });
      table.setAttribute("aria-label", "Player notices");
      const head = el("thead", {}, el("tr", {},
        el("th", {}, "Player"), el("th", {}, "Chair"), el("th", {}, "Status")));
      const body = el("tbody");
      for (const notice of notices.notices) {
        body.append(el("tr", {},
          el("td", {}, notice.name),
          el("td", {}, notice.chair_label),
          el("td", { class: "num" }, notice.status === "sent" ? "Sent" : "Queued")));
      }
      table.append(head, body);
      return el("div", {}, table);
    });
  };

  // ---------------------------------------------------------------- bar ruler

  const rulerPane = el("section", { class: "ruler-pane" });
  const rulerWrap = el("div", { class: "ruler-wrap" });
  const slider = el("div", {
    class: "ruler-slider",
    role: "slider",
    tabindex: "0",
    "aria-label": "Bar ruler",
    "aria-valuemin": "1",
    "aria-valuemax": String(work ? work.bars : 1),
    "aria-valuenow": "1",
    "aria-valuetext": "Bar 1",
  });
  const ticks = el("div", { class: "ruler-ticks" });
  rulerWrap.append(slider, ticks);
  const rulerStatus = statusRegion("Ruler status", "ruler-status");
  const markCutButton = el("button", {}, "Mark cut");
  markCutButton.setAttribute("disabled", "true");
  const undoCutButton = el("button", {}, "Undo cut");
  rulerPane.append(
    el("div", { class: "ruler-toolbar" }, markCutButton, undoCutButton),
    rulerWrap,
    rulerStatus
  );

  let caret = 1;
  let selection: { from: number; to: number } | null = null;
  let sessionCuts: string[] = [];

  const cutRanges = (): [number, number][] =>
    (work?.cuts ?? []).map((cut) => [cut.from_bar, cut.to_bar] as [number, number]);

  const isCut = (bar: number): boolean =>
    cutRanges().some(([from, to]) => bar >= from && bar <= to);

  const clampBeforeCuts = (bar: number): number => {
    for (const [from, to] of cutRanges()) {
      if (bar >= from && bar <= to) return from - 1 < 1 ? to + 1 : from - 1;
    }
    return bar;
  };

  const updateSliderAria = (): void => {
    slider.setAttribute("aria-valuemin", "1");
    slider.setAttribute("aria-valuemax", String(work?.bars ?? 1));
    slider.setAttribute("aria-valuenow", String(caret));
    slider.setAttribute(
      "aria-valuetext",
      selection ? `Bars ${selection.from}–${selection.to} selected` : `Bar ${caret}`
    );
    if (selection) {
      markCutButton.removeAttribute("disabled");
      markCutButton.textContent = `Mark cut ${selection.from}–${selection.to}`;
    } else {
      markCutButton.setAttribute("disabled", "true");
      markCutButton.textContent = "Mark cut";
    }
  };

  const renderRuler = (): void => {
    ticks.replaceChildren();
    if (!work) return;
    const width = rulerWrap.clientWidth || 900;
    const bars = work.bars;
    const barWidth = Math.max(2, (width - 24) / bars);
    const interval = labelInterval();
    for (let bar = 1; bar <= bars; bar++) {
      if (isCut(bar)) continue;
      const left = 12 + (bar - 1) * barWidth;
      const numbered = bar === 1 || bar % interval === 0;
      ticks.append(el("div", {
        class: `ruler-bar${numbered ? " numbered" : ""}`,
        style: `left: ${left}px`,
      }));
      if (numbered) {
        ticks.append(el("span", {
          class: "ruler-number",
          style: `left: ${left}px`,
        }, String(bar)));
      }
    }
    for (const letter of work.rehearsal_letters) {
      if (letter.cut) continue;
      const left = 12 + (letter.bar - 1) * barWidth;
      ticks.append(el("span", {
        class: "ruler-letter",
        style: `left: ${left}px`,
      }, letter.letter));
    }
    let removed = 0;
    for (const cut of work.cuts) {
      const cutBars = cut.to_bar - cut.from_bar + 1;
      const left = 12 + (cut.from_bar - 1 - removed) * barWidth;
      const hit = el("button", {
        class: "splice-hit",
        style: `left: ${left + 2}px`,
        "aria-label": `Restore bars ${cut.from_bar}–${cut.to_bar}`,
      });
      hit.addEventListener("click", () => openRestoreDialog(hit, cut.id, cut.from_bar, cut.to_bar));
      ticks.append(
        el("div", { class: "splice-mark", style: `left: ${left}px` }),
        el("span", {
          class: "splice-label",
          style: `left: ${left + 2}px`,
        }, `vi–de ${cut.from_bar}–${cut.to_bar}`),
        hit
      );
      removed += cutBars;
    }
    if (selection) {
      const from = Math.min(selection.from, selection.to);
      const to = Math.max(selection.from, selection.to);
      ticks.append(el("div", {
        class: "ruler-selection",
        style: `left: ${12 + (from - 1) * barWidth}px; width: ${(to - from + 1) * barWidth}px`,
      }));
    }
    ticks.append(el("div", {
      class: "ruler-caret",
      style: `left: ${12 + (caret - 1) * barWidth}px`,
    }));
    updateSliderAria();
  };

  const labelInterval = (): number => {
    const width = window.innerWidth;
    if (width >= 1280) return 10;
    if (width >= 768) return 25;
    return 50;
  };

  const openRestoreDialog = (
    opener: HTMLElement, cutId: string, from: number, to: number
  ): void => {
    openModal(`Restore bars ${from}–${to}`, opener, (modal: ModalHandle) => {
      const restore = el("button", { class: "primary" }, "Restore bars");
      const keep = el("button", { type: "button" }, "Keep cut");
      keep.addEventListener("click", () => modal.close());
      restore.addEventListener("click", () => {
        void restoreCut(cutId, from, to);
        modal.close();
      });
      return el("div", {},
        el("p", {}, `Restore bars ${from}–${to} of ${work?.title ?? "the work"}?`),
        el("div", { class: "dialog-actions" }, keep, restore));
    });
  };

  const restoreCut = async (cutId: string, from: number, to: number): Promise<void> => {
    rulerStatus.textContent = `Restoring bars ${from}–${to}`;
    try {
      const oldSeconds = detail.running_time_seconds;
      await api("DELETE", apiRoutes.cut(cutId));
      work = await api<WorkDetail>("GET", apiRoutes.work(selectedWorkId ?? ""));
      detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
      const saved = savedOf(from, to);
      const restoreLabel = `Restored bars ${from}–${to} · +${saved}`;
      sessionCuts = sessionCuts.filter((id) => id !== cutId);
      if (prefersReducedMotion()) {
        rulerStatus.textContent = restoreLabel;
        renderRuler();
        renderRailAndParts();
      } else {
        animateCount(oldSeconds, detail.running_time_seconds, () => {
          rulerStatus.textContent = restoreLabel;
        });
        renderRuler();
        renderRailAndParts();
      }
      slider.focus();
    } catch (error) {
      rulerStatus.textContent = String((error as ApiError).body?.message ?? "Restore failed.");
    }
  };

  const savedOf = (from: number, to: number): string => {
    const barMap = work?.bar_map ?? [];
    let ms = 0;
    for (let bar = from; bar <= to; bar++) {
      for (const span of barMap) {
        if (bar >= span.from_bar && bar <= span.to_bar) ms += span.bar_ms;
      }
    }
    return formatRunningTime(Math.floor(ms / 1000 + 0.5));
  };

  const animateCount = (fromSeconds: number, toSeconds: number, done: () => void): void => {
    const running = header.querySelector<HTMLElement>("[data-running-time]");
    if (!running || prefersReducedMotion()) {
      done();
      return;
    }
    const start = performance.now();
    const duration = 300;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(fromSeconds + (toSeconds - fromSeconds) * eased);
      running.textContent = formatRunningTime(value);
      if (t < 1) requestAnimationFrame(step);
      else {
        running.textContent = formatRunningTime(toSeconds);
        done();
      }
    };
    requestAnimationFrame(step);
  };

  const commitCut = async (from: number, to: number): Promise<void> => {
    rulerStatus.textContent = `Marking cut ${from}–${to}`;
    try {
      const response = await api<{
        cut: { id: string; saved: string; parts_to_mark: number };
        work: WorkDetail;
        programme: ProgrammeSummary;
      }>("POST", apiRoutes.cuts(work?.id ?? ""), { from_bar: from, to_bar: to });
      sessionCuts.push(response.cut.id);
      const oldSeconds = detail.running_time_seconds;
      work = response.work;
      detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
      selection = null;
      const label = `Cut bars ${from}–${to} · −${response.cut.saved} · ${plural(response.programme.parts_to_mark, "1 part to mark", `${response.programme.parts_to_mark} parts to mark`)}`;
      if (prefersReducedMotion()) {
        rulerStatus.textContent = label;
        renderRuler();
        renderRailAndParts();
      } else {
        renderRailAndParts();
        animateCount(oldSeconds, detail.running_time_seconds, () => {
          rulerStatus.textContent = label;
        });
        renderRuler();
      }
    } catch (error) {
      rulerStatus.textContent = String((error as ApiError).body?.message ?? "Cut failed.");
      renderRuler();
    }
  };

  markCutButton.addEventListener("click", () => {
    if (!selection) return;
    const from = Math.min(selection.from, selection.to);
    const to = Math.max(selection.from, selection.to);
    void commitCut(from, to);
    setTimeout(() => slider.focus(), prefersReducedMotion() ? 0 : 380);
  });

  undoCutButton.addEventListener("click", () => {
    const last = sessionCuts[sessionCuts.length - 1];
    if (!last || !work) return;
    const cut = work.cuts.find((c) => c.id === last);
    if (!cut) return;
    void restoreCut(cut.id, cut.from_bar, cut.to_bar);
  });

  slider.addEventListener("keydown", (event: KeyboardEvent) => {
    if (!work) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey && selection) {
        const from = Math.min(selection.from, selection.to);
        const to = Math.max(selection.from, selection.to);
        if (direction === 1) {
          const next = clampBeforeCuts(to + 1);
          if (next > to && next <= work.bars) selection = { from, to: next };
        } else {
          const next = clampBeforeCuts(from - 1);
          if (next < from && next >= 1) selection = { from: next, to };
        }
      } else if (event.shiftKey) {
        selection = { from: caret, to: clampBeforeCuts(caret + direction) };
      } else {
        selection = null;
        caret = clampBeforeCuts(caret + direction);
        if (caret < 1) caret = 1;
        if (caret > work.bars) caret = work.bars;
      }
      renderRuler();
      updateSliderAria();
    } else if (event.key === "Home") {
      event.preventDefault();
      selection = null;
      caret = 1;
      renderRuler();
      updateSliderAria();
    } else if (event.key === "End") {
      event.preventDefault();
      selection = null;
      caret = work.bars;
      renderRuler();
      updateSliderAria();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (selection) {
        const from = Math.min(selection.from, selection.to);
        const to = Math.max(selection.from, selection.to);
        void commitCut(from, to);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      selection = null;
      renderRuler();
      updateSliderAria();
    }
  });

  let dragFrom = 0;
  slider.addEventListener("pointerdown", (event: PointerEvent) => {
    if (!work) return;
    const bar = barFromEvent(event);
    dragFrom = bar;
    selection = { from: bar, to: bar };
    renderRuler();
    updateSliderAria();
  });
  slider.addEventListener("pointermove", (event: PointerEvent) => {
    if (!work || dragFrom === 0) return;
    const bar = barFromEvent(event);
    const from = Math.min(dragFrom, bar);
    const to = clampBeforeCuts(Math.max(dragFrom, bar));
    selection = { from, to };
    renderRuler();
    updateSliderAria();
  });
  const endDrag = (): void => {
    dragFrom = 0;
  };
  slider.addEventListener("pointerup", endDrag);
  slider.addEventListener("pointercancel", endDrag);

  const barFromEvent = (event: PointerEvent): number => {
    if (!work) return 1;
    const rect = rulerWrap.getBoundingClientRect();
    const barWidth = Math.max(2, (rect.width - 24) / work.bars);
    const bar = Math.round((event.clientX - rect.left - 12) / barWidth) + 1;
    return Math.min(work.bars, Math.max(1, clampBeforeCuts(bar)));
  };

  // ------------------------------------------------------------- parts table

  const holdingsTickets = new Map<string, LatestWins>();

  const buildPartsTable = (): void => {
    partsPane.replaceChildren();
    if (!work) return;
    const heading = el("h2", {}, "Parts");
    if (work.parts_to_mark > 0) {
      heading.append(el("span", { class: "mark-flag" }, ` ${work.parts_to_mark} to mark`));
    }
    const table = el("table", { class: "data" });
    table.setAttribute("aria-label", "Parts");
    const head = el("thead", {}, el("tr", {},
      el("th", {}, "Part"), el("th", { class: "num" }, "Bars"),
      el("th", { class: "num" }, "Needed"), el("th", { class: "num" }, "On hand"),
      el("th", { class: "num" }, "Short"), el("th", {}, "Marking"), el("th", {}, "Scan")));
    const body = el("tbody");
    for (const part of work.parts) {
      body.append(buildPartRow(part));
    }
    table.append(head, body);
    partsPane.append(heading, table);
  };

  const buildPartRow = (part: Part): HTMLElement => {
    const label = partLabel(work!.title, part.name);
    const onHand = el("input", {
      type: "number", min: "0", max: "99",
      value: String(part.copies.on_hand),
      "aria-label": `Copies on hand ${part.name}`,
    }) as HTMLInputElement;
    const focusedValue = { value: part.copies.on_hand };
    onHand.addEventListener("focus", () => {
      focusedValue.value = Number(onHand.value);
    });
    onHand.addEventListener("input", () => {
      onHand.dataset.dirty = "true";
    });
    const saveHoldings = async (): Promise<void> => {
      delete onHand.dataset.dirty;
      const value = Number(onHand.value);
      if (!Number.isInteger(value) || value === focusedValue.value) return;
      deskStatus.textContent = `Saving copies for ${label}`;
      let ticket = holdingsTickets.get(part.id);
      if (!ticket) {
        ticket = new LatestWins();
        holdingsTickets.set(part.id, ticket);
      }
      const number = ticket.begin();
      savesInFlight += 1;
      try {
        const response = await api<{ part: Part; work: never; programme: ProgrammeSummary }>(
          "PUT", apiRoutes.holdings(part.id), { copies_on_hand: value }
        );
        if (!ticket.isLatest(number)) return;
        focusedValue.value = response.part.copies.on_hand;
        deskStatus.textContent = `Copies on hand saved for ${label}: ${response.part.copies.on_hand}.`;
        updateRowAndSurfaces(response.programme, part.id, response.part);
      } catch (error) {
        if (!ticket.isLatest(number)) return;
        deskStatus.textContent = "Copies on hand must be a whole number from 0 to 99.";
      } finally {
        savesInFlight -= 1;
      }
    };
    onHand.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void saveHoldings();
      }
    });
    onHand.addEventListener("blur", () => void saveHoldings());

    const markingCell = el("td", {});
    if (part.mark_cut) {
      const flag = el("span", { class: "mark-flag" }, "Mark cut");
      const record = el("button", {
        "aria-label": `Record marked ${part.name}`,
      }, "Record marked");
      record.addEventListener("click", async () => {
        deskStatus.textContent = "Recording";
        const label = partLabel(work!.title, part.name);
        const carried: string[] = [];
        try {
          for (const cutId of part.cuts_to_mark) {
            const cut = work!.cuts.find((entry) => entry.id === cutId);
            try {
              await api<{ part: Part }>("POST", apiRoutes.marks(part.id), { cut_id: cutId });
              if (cut) carried.push(`${label} carries cut ${cut.from_bar}–${cut.to_bar}.`);
            } catch (error) {
              const apiError = error as ApiError;
              if (apiError.status === 404) {
                carried.push(`${label} carries cut ${cut?.from_bar ?? ""}–${cut?.to_bar ?? ""}.`);
              } else if (apiError.status === 422 && cut) {
                carried.push(`${label} doesn't play in bars ${cut.from_bar}–${cut.to_bar}.`);
              } else {
                throw error;
              }
            }
          }
          deskStatus.textContent = carried.join(" ");
          await refreshPartRow();
        } catch (error) {
          const apiError = error as ApiError;
          if (apiError.status === 404) {
            deskStatus.textContent = "That cut was restored before the mark was recorded.";
          } else {
            deskStatus.textContent = String(apiError.body?.message ?? "Record failed.");
          }
        }
      });
      markingCell.append(el("div", {}, flag, record));
    }
    for (const mark of part.marks) {
      markingCell.append(el("span", { class: "mark-line mono" },
        `${mark.from_bar}–${mark.to_bar} · ${mark.marked_by.name}`));
    }

    const scanCell = el("td", { class: "scan-cell" });
    const uploadButton = el("button", {
      "aria-label": `Upload scan ${part.name}`,
    }, "Upload scan");
    const hiddenInput = el("input", { type: "file", hidden: "true", accept: ".pdf,.png,.jpg,.jpeg" }) as HTMLInputElement;
    uploadButton.append(hiddenInput);
    uploadButton.addEventListener("click", () => {
      if (uploadButton.getAttribute("aria-disabled") === "true") return;
      hiddenInput.click();
    });
    hiddenInput.addEventListener("change", () => {
      const file = hiddenInput.files?.[0];
      if (!file) return;
      void uploadScan(part, file, scanCell);
    });

    if (part.latest_marked_scan) {
      const link = el("a", {
        href: apiRoutes.scanFile(part.latest_marked_scan.id),
        "aria-label": `Download ${part.latest_marked_scan.file_name}`,
      }, `Download ${part.latest_marked_scan.file_name}`);
      scanCell.append(link);
    }
    scanCell.append(uploadButton);
    const progress = el("div", {
      class: "upload-progress", hidden: "true", role: "progressbar",
      "aria-label": "Upload progress",
    });
    const bar = el("div", {});
    progress.append(bar);
    const uploadStatus = statusRegion("Upload status", "upload-status-line");
    progress.setAttribute("aria-hidden", "false");
    uploadStatus.hidden = true;
    scanCell.append(progress, uploadStatus);

    const row = el("tr", { "data-part-id": part.id },
      el("td", { "data-label": "Part" }, part.name),
      el("td", { class: "num", "data-label": "Bars" }, `${part.bars_from}–${part.bars_to}`),
      el("td", { class: "num", "data-label": "Needed" }, String(part.copies.needed)),
      el("td", { class: "num", "data-label": "On hand" }, onHand),
      el("td", { class: "num", "data-label": "Short" }, String(part.copies.shortfall)),
      el("td", { "data-label": "Marking" }, markingCell),
      el("td", { "data-label": "Scan" }, scanCell)
    );
    return row;
  };

  const updateRowAndSurfaces = (
    programme: ProgrammeSummary, partId: string, part: Part
  ): void => {
    detail = { ...detail, copies: programme.copies, running_time: programme.running_time, running_time_seconds: programme.running_time_seconds };
    const row = Array.from(partsPane.querySelectorAll<HTMLTableRowElement>("tr"))
      .find((tr) => tr.dataset.partId === partId);
    if (row) {
      const cells = row.querySelectorAll("td");
      cells[2].textContent = String(part.copies.needed);
      cells[3].querySelector("input")?.setAttribute("value", String(part.copies.on_hand));
      cells[4].textContent = String(part.copies.shortfall);
    }
    renderRailAndPartsExceptTable();
  };

  const renderRailAndPartsPreservingInputs = (): void => {
    const active = document.activeElement as HTMLElement | null;
    const dirty = new Map<string, string>();
    partsPane.querySelectorAll<HTMLInputElement>("input[data-dirty]").forEach((input) => {
      const label = input.getAttribute("aria-label");
      if (label) dirty.set(label, input.value);
    });
    buildPartsTable();
    for (const [name, value] of dirty) {
      const input = Array.from(partsPane.querySelectorAll<HTMLInputElement>("input")).find(
        (node) => node.getAttribute("aria-label") === name
      );
      if (input) {
        input.value = value;
        input.dataset.dirty = "true";
      }
    }
    if (active) {
      const label = active.getAttribute("aria-label");
      if (label) {
        const target = Array.from(partsPane.querySelectorAll<HTMLElement>("input, button, a")).find(
          (node) => node.getAttribute("aria-label") === label
        );
        if (target) target.focus();
      }
    }
    renderRailAndPartsExceptTable();
  };

  const renderRailAndPartsExceptTable = (): void => {
    void buildRail(rail);
    void buildRail(railInline);
    const running = header.querySelector<HTMLElement>("[data-running-time]");
    if (running) running.textContent = detail.running_time;
    const copies = header.querySelector(".counts");
    if (copies) {
      copies.replaceChildren(
        `Needed ${detail.copies.needed}`, `On hand ${detail.copies.on_hand}`,
        el("span", { class: "short-marker" }, `Short ${detail.copies.shortfall}`)
      );
    }
  };

  const refreshPartRow = async (): Promise<void> => {
    if (!selectedWorkId) return;
    work = await api<WorkDetail>("GET", apiRoutes.work(selectedWorkId));
    detail = await api<ProgrammeDetail>("GET", apiRoutes.programme(currentId));
    renderRailAndPartsPreservingInputs();
  };

  const uploadScan = async (
    part: Part, file: File, cell: HTMLElement
  ): Promise<void> => {
    void uploadReason;
    const label = partLabel(work!.title, part.name);
    const status = cell.querySelector<HTMLElement>(".upload-status-line") ??
      statusRegion("Upload status", "upload-status-line");
    const progress = cell.querySelector<HTMLElement>(".upload-progress");
    const bar = progress?.querySelector<HTMLElement>("div");
    status.hidden = false;
    status.textContent = `Uploading scan for ${label}`;
    if (progress && bar) {
      progress.hidden = false;
      bar.style.width = "0%";
    }
    const formData = new FormData();
    formData.append("kind", "marked_part");
    formData.append("file", file);
    const key = crypto.randomUUID();
    try {
      await uploadWithProgress(apiRoutes.scans(part.id), formData, key, (sent, total) => {
        if (bar) bar.style.width = `${Math.round((sent / total) * 100)}%`;
      });
      status.textContent = `Scan filed for ${label}.`;
      await refreshPartRow();
    } catch (error) {
      status.textContent = `Scan not filed for ${label}: ${uploadReason(error as ApiError)}.`;
    } finally {
      if (progress) progress.hidden = true;
    }
  };

  const uploadReason = (error: ApiError): string => {
    if (error.status === 503) return "the score store is offline";
    if (error.status === 415) return "only PDF, PNG or JPEG files can be filed";
    if (error.status === 413) return "the file is larger than 20,000,000 bytes";
    if (error.status === 422) return "the file is empty";
    return "the upload did not finish";
  };

  // ------------------------------------------------------------- refresh loop

  const applyStorageState = (status: ServiceStatus | null): void => {
    if (!status) return;
    const uploadButtons = partsPane.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Upload scan"]'
    );
    if (status.storage === "down") {
      uploadButtons.forEach((button) => {
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("aria-description", OUTAGE_BANNER);
        button.title = OUTAGE_BANNER;
      });
    } else {
      uploadButtons.forEach((button) => {
        button.removeAttribute("aria-disabled");
        button.removeAttribute("aria-description");
        button.removeAttribute("title");
      });
    }
  };

  client.readStatus().then((status) => {
    applyStorageState(status);
    if (status) {
      shell.banners.replaceChildren();
    }
  });

  const deskRefresh = async (): Promise<void> => {
    try {
      const status = await client.readStatus();
      applyStorageState(status);
      await refreshProgrammeRead();
    } catch {
      // A refresh that fails changes nothing.
    }
  };

  setInterval(() => void deskRefresh(), 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void deskRefresh();
  });
  window.addEventListener("resize", () => renderRuler());

  // ------------------------------------------------------------------ layout

  const drawerButton = el("button", { class: "rail-drawer-button primary" }, "Programmes and works");
  drawerButton.addEventListener("click", () => {
    const backdrop = el("div", { class: "drawer-backdrop" });
    const drawer = el("div", { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": "Programmes and works" });
    const closeDrawer = (): void => {
      backdrop.classList.add("leaving");
      setTimeout(() => {
        backdrop.remove();
        document.body.classList.remove("modal-open");
        drawerButton.focus();
      }, 250);
    };
    document.body.classList.add("modal-open");
    document.body.append(backdrop);
    backdrop.append(drawer);
    requestAnimationFrame(() => backdrop.classList.add("settled"));
    const inner = el("div", {});
    drawer.append(inner);
    void buildRail(inner);
    inner.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("a")) closeDrawer();
    });
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) closeDrawer();
    });
    const keyHandler = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeDrawer();
        document.removeEventListener("keydown", keyHandler, true);
      } else if (event.key === "Tab") {
        const focusables = Array.from(drawer.querySelectorAll<HTMLElement>("a[href]")).filter(
          (node) => node.offsetParent !== null
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyHandler, true);
    setTimeout(() => {
      const first = drawer.querySelector<HTMLElement>("a, button");
      first?.focus();
    }, 260);
  });

  const main = el("div", { class: "desk-main" },
    drawerButton, header, deskStatus, railInline, rulerPane, partsPane);
  grid.append(rail, main);
  shell.main.append(grid);

  buildHeader();
  renderRailAndParts();
  renderRuler();
}

function parseWall(text: string): {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) {
    return { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  }
  return {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: 0,
  };
}

/** A typed London wall-clock time as the exact timestamp the API expects. */
function wallClockTimestamp(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  offsetMinutes: number
): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return (
    `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}` +
    `T${pad(wall.hour)}:${pad(wall.minute)}:00` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
