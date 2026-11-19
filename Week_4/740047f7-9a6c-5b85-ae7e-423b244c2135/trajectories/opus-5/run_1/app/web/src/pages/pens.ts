import { ApiFailure, del, get } from "../api";
import { copy } from "../copy";
import { openDialog } from "../dialog";
import { clear, h, icon, setText } from "../dom";
import { LiveEvent, onLive } from "../live";
import { PageHandle } from "../router";
import { drawCardStill } from "../scene/still";
import { announce, buildFooter, rememberPenNames } from "../shell";
import { openPenId } from "../state";
import { Farm, Pen, penShape } from "../types";

/// The Pens page: one full-width card for the open pen, then one square card
/// per pen, each with a procedural still of its own twin.
export async function pensPage(container: HTMLElement): Promise<PageHandle> {
  let pens: Pen[] = [];
  let farms: Farm[] = [];

  const openSlot = h("div", { class: "page" });
  const grid = h("div", { class: "card-grid" });
  const farmsList = h("div", {});
  const farmsBand = h("section", { class: "band farms-band", "aria-label": "Farms" }, [
    h("div", { class: "label" }, "Farms"),
    farmsList,
  ]);
  container.appendChild(h("main", {}, [openSlot, grid, farmsBand]));
  container.appendChild(buildFooter());

  const cards = new Map<string, { root: HTMLElement; grade: HTMLElement; canvas: HTMLCanvasElement }>();
  const farmRows = new Map<string, HTMLElement>();

  function card(pen: Pen, open: boolean): HTMLElement {
    const canvas = h("canvas", {
      role: "img",
      "aria-label": `${pen.name} twin still`,
    });
    const grade = h("div", { class: "card-grade num" }, cardGrade(pen));
    const arrow = h("span", { class: "card-arrow", "aria-hidden": "true" }, icon("arrow"));
    const root = h(
      "a",
      {
        href: `/pens/${pen.id}`,
        class: open ? "pen-card open-pen" : "pen-card",
        "aria-label": open ? `Open pen ${pen.name}` : pen.name,
      },
      [
        canvas,
        h("div", { class: "scrim", "aria-hidden": "true" }),
        h("div", { class: "card-body" }, [
          h("div", {}, [h("div", { class: "card-name" }, pen.name), grade]),
          arrow,
        ]),
      ],
    );
    cards.set(open ? `open:${pen.id}` : pen.id, { root, grade, canvas });
    window.requestAnimationFrame(() => paint(pen, canvas));
    return root;
  }

  function paint(pen: Pen, canvas: HTMLCanvasElement): void {
    const marks = (pen.defects ?? [])
      .filter((defect) => !defect.removed)
      .map((defect) => ({
        bearing_deg: defect.bearing_deg ?? 0,
        depth_m: defect.depth_m ?? 0,
        chart_x_m: defect.chart_x_m ?? 0,
        chart_y_m: defect.chart_y_m ?? 0,
      }));
    drawCardStill(canvas, penShape(pen), marks);
  }

  function cardGrade(pen: Pen): string {
    return copy.gradeLine(pen.grade.letter, pen.grade.label, pen.open_defects);
  }

  function farmRow(farm: Farm): HTMLElement {
    const details = h(
      "button",
      { type: "button", class: "text-button" },
      `Farm details: ${farm.name}`,
    );
    details.addEventListener("click", () => openFarmDetails(farm));
    const row = h("div", { class: "farm-row", id: `farm-${farm.id}` }, [
      h("span", {}, farm.name),
      h(
        "span",
        { class: "label" },
        farm.sites.map((site) => `${site.name} (${site.code})`).join(", "),
      ),
      details,
    ]);
    farmRows.set(farm.id, row);
    return row;
  }

  function openFarmDetails(farm: Farm): void {
    openDialog({
      name: "Farm details",
      build: (handle) => {
        const erase = h("button", { type: "button", class: "text-button" }, "Erase farm");
        erase.addEventListener("click", () => openEraseDialog(farm, handle.close));
        return h("div", {}, [
          h("h2", {}, farm.name),
          h(
            "ul",
            { class: "list" },
            farm.sites.map((site) =>
              h("li", { class: "num" }, [
                h("div", {}, `${site.name} \u00b7 ${site.code}`),
                h(
                  "div",
                  { class: "label num" },
                  `${site.latitude.toFixed(4)}\u00b0, ${site.longitude.toFixed(4)}\u00b0`,
                ),
              ]),
            ),
          ),
          h("p", { class: "num" }, copy.dayRate(farm.day_rate.amount, farm.day_rate.currency)),
          h("div", { class: "actions" }, [erase]),
        ]);
      },
    });
  }

  function openEraseDialog(farm: Farm, closeParent: () => void): void {
    const status = h("div", { class: "field-error hidden" });
    openDialog({
      name: "Erase farm",
      build: (handle) => {
        const box = h("input", {
          type: "text",
          "aria-label": "Type the farm name to confirm",
        });
        const cancel = h("button", { type: "button", class: "text-button" }, "Cancel");
        cancel.addEventListener("click", () => handle.close());
        const erase = h("button", { type: "button", class: "text-button" }, "Erase");
        erase.addEventListener("click", async () => {
          announce(copy.erasing);
          erase.setAttribute("disabled", "");
          try {
            await del(`/api/farms/${farm.id}`, { confirm_name: box.value });
            announce(copy.erased(farm.name));
            handle.close();
            closeParent();
            dropFarm(farm.id);
          } catch (failure) {
            erase.removeAttribute("disabled");
            status.classList.remove("hidden");
            clear(status);
            status.appendChild(icon("alert"));
            status.appendChild(
              document.createTextNode(
                failure instanceof ApiFailure ? failure.message : copy.unreachable,
              ),
            );
          }
        });
        return h("div", {}, [
          h("h2", {}, "Erase farm"),
          h("label", { class: "field" }, [
            h("span", {}, "Type the farm name to confirm"),
            box,
          ]),
          status,
          h("div", { class: "actions" }, [cancel, erase]),
        ]);
      },
      initialFocus: (root) => root.querySelector("button"),
    });
  }

  /// An erased farm's row in the Farms band and its pens' cards leave the page
  /// in place, and focus falls back to the item before it.
  function dropFarm(farmId: string): void {
    const farm = farms.find((entry) => entry.id === farmId);
    const penIds = farm ? farm.pen_ids : [];
    const active = document.activeElement as HTMLElement | null;
    let fallback: HTMLElement | null = null;
    const order = [...grid.children].filter((node): node is HTMLElement => node instanceof HTMLElement);
    for (const penId of penIds) {
      const entry = cards.get(penId);
      if (entry) {
        if (entry.root === active || entry.root.contains(active)) {
          const index = order.indexOf(entry.root);
          fallback = index > 0 ? order[index - 1] : null;
        }
        entry.root.remove();
        cards.delete(penId);
      }
      const openEntry = cards.get(`open:${penId}`);
      if (openEntry) {
        openEntry.root.remove();
        cards.delete(`open:${penId}`);
      }
    }
    const row = farmRows.get(farmId);
    if (row) {
      const rows = [...farmsList.children].filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      if (row.contains(active)) {
        const index = rows.indexOf(row);
        fallback =
          index > 0
            ? rows[index - 1].querySelector<HTMLElement>("button")
            : null;
      }
      row.remove();
      farmRows.delete(farmId);
    }
    pens = pens.filter((pen) => !penIds.includes(pen.id));
    farms = farms.filter((entry) => entry.id !== farmId);
    fallback?.focus();
    if (!cards.has(`open:${openPenId(pens.map((pen) => pen.id))}`)) refreshOpenCard();
  }

  function refreshOpenCard(): void {
    const id = openPenId(pens.map((pen) => pen.id));
    const pen = pens.find((entry) => entry.id === id);
    clear(openSlot);
    for (const key of [...cards.keys()]) {
      if (key.startsWith("open:")) cards.delete(key);
    }
    if (pen) openSlot.appendChild(card(pen, true));
  }

  async function load(): Promise<void> {
    const [penPayload, farmPayload] = await Promise.all([
      get("/api/pens"),
      get("/api/farms"),
    ]);
    pens = penPayload.pens as Pen[];
    farms = farmPayload.farms as Farm[];
    rememberPenNames(pens);
    const detailed = await Promise.all(pens.map((pen) => get(`/api/pens/${pen.id}`)));
    pens = detailed.map((payload) => payload.pen as Pen);
    cards.clear();
    farmRows.clear();
    refreshOpenCard();
    clear(grid);
    for (const pen of pens) grid.appendChild(card(pen, false));
    clear(farmsList);
    for (const farm of farms) farmsList.appendChild(farmRow(farm));
    const anchor = window.location.hash.slice(1);
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
  }

  await load();

  /// Cards change in place when the other device changes a pen, and the card or
  /// button with keyboard focus keeps it.
  function applyPen(updated: Pen): void {
    const index = pens.findIndex((pen) => pen.id === updated.id);
    if (index === -1) return;
    pens[index] = { ...pens[index], ...updated };
    for (const key of [updated.id, `open:${updated.id}`]) {
      const entry = cards.get(key);
      if (!entry) continue;
      setText(entry.grade, cardGrade(pens[index]));
      paint(pens[index], entry.canvas);
    }
  }

  const unsubscribe = onLive((event: LiveEvent) => {
    if (event.type === "farm.erased") {
      dropFarm(String(event.farm_id));
      return;
    }
    if (event.pen && typeof event.pen === "object") {
      applyPen(event.pen as Pen);
    }
    if (event.pens && typeof event.pens === "object") {
      for (const pen of Object.values(event.pens as Record<string, Pen>)) applyPen(pen);
    }
  });

  return {
    destroy(): void {
      unsubscribe();
    },
  };
}
