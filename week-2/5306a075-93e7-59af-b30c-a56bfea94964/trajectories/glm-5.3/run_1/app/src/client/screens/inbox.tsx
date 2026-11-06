import type { Note, NoteListItem } from "../../shared/types.js";
import { api, ApiFailure } from "../api.js";
import { h, icon, formatInstant } from "../dom.js";
import { currentApp } from "../main.js";
import { feedback, statusLabel, countUp, prefersReducedMotion } from "../ui.js";
import { renderNoteView } from "./noteview.js";

const PAGE_SIZE = 20;

interface Counts {
  unprocessed: number;
  snoozed: number;
  processed: number;
}

/** The inbox: list, reading column and hierarchy rail (DP-01, DP-40, DP-45). */
export async function renderInbox(
  _screen: HTMLElement,
  noteId: string | null,
  fail: (err: unknown) => void,
): Promise<HTMLElement> {
  const app = currentApp()!;
  const timeZone = app.workspace.timeZone;
  const root = h("div", null) as HTMLElement;

  let filter: "unprocessed" | "snoozed" | "processed" = "unprocessed";
  let notes: NoteListItem[] = [];
  let counts: Counts = { unprocessed: 0, snoozed: 0, processed: 0 };
  let cursor: string | null = null;
  let currentNoteId = noteId;
  let refreshTimer: number | undefined;
  let attachmentTimer: number | undefined;

  const paneTabs = h("div", { class: "pane-tabs", role: "tablist", "aria-label": "Panes" }) as HTMLElement;
  const listPane = h("section", { class: "inbox-list-pane", "aria-label": "Inbox" }) as HTMLElement;
  const readingPane = h("section", { class: "reading-pane", "aria-label": "Note" }) as HTMLElement;
  const railPane = h("aside", {
    class: "rail-pane",
    role: "complementary",
    "aria-label": "Product hierarchy",
  }) as HTMLElement;

  const panes: Array<[string, HTMLElement]> = [
    ["Inbox", listPane],
    ["Note", readingPane],
    ["Hierarchy", railPane],
  ];
  const isNarrow = (): boolean => window.innerWidth < 900;

  panes.forEach(([label, pane], index) => {
    const tab = h("button", {
      role: "tab",
      "aria-selected": String(index === 0),
      onclick: () => showPane(index),
    }, label) as HTMLElement;
    paneTabs.appendChild(tab);
    if (index !== 0 && isNarrow()) pane.setAttribute("hidden", "");
  });

  const showPane = (index: number): void => {
    panes.forEach((_entry, i) => {
      const pane = panes[i]![1];
      if (i === index) pane.removeAttribute("hidden");
      else if (isNarrow()) pane.setAttribute("hidden", "");
      const tab = paneTabs.children[i] as HTMLElement;
      tab.setAttribute("aria-selected", String(i === index));
    });
  };

  const switchToNotePane = (): void => {
    if (isNarrow()) showPane(1);
  };

  const renderTabs = (): void => {
    const tabs = h("div", { class: "filter-tabs", role: "tablist", "aria-label": "Inbox filter" });
    const entries: Array<["unprocessed" | "snoozed" | "processed", string]> = [
      ["unprocessed", "Unprocessed"],
      ["snoozed", "Snoozed"],
      ["processed", "Processed"],
    ];
    for (const [value, label] of entries) {
      tabs.appendChild(
        h("button", {
          role: "tab",
          "aria-selected": String(filter === value),
          onclick: () => {
            filter = value;
            void loadFirstPage();
          },
        }, `${label} (${counts[value]})`),
      );
    }
    listPane.replaceChildren(tabs);
  };

  const renderList = (): void => {
    renderTabs();
    const listbox = h("ul", { class: "notes-list", role: "listbox", "aria-label": "Notes" });
    if (notes.length === 0) {
      listbox.appendChild(h("li", { class: "empty-note" }, "No notes in this filter."));
    }
    for (const item of notes) {
      const selected = item.id === currentNoteId;
      const option = h(
        "li",
        { role: "option", "aria-selected": String(selected), "data-note-id": item.id },
        h(
          "button",
          {
            class: "note-option",
            onclick: () => openNote(item.id),
          },
          h("span", { class: "note-title" }, item.title),
          h(
            "span",
            { class: "note-meta" },
            `${item.contactName ?? "No contact"} · ${statusLabel(item.source)} · ${formatInstant(item.createdAt, timeZone)}`,
          ),
        ),
      );
      listbox.appendChild(option);
    }
    listPane.appendChild(listbox);

    if (cursor !== null) {
      const more = h("button", { class: "load-more", onclick: () => void loadMore() }, "Load more notes") as HTMLElement;
      listPane.appendChild(more);
    }

    const logNote = h("button", { onclick: (event: MouseEvent) => openLogDialog(event.target as HTMLElement) }, "Log note");
    listPane.appendChild(logNote);

    // Keyboard navigation through the Notes listbox.
    listbox.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      event.preventDefault();
      const currentIndex = notes.findIndex((n) => n.id === currentNoteId);
      if (event.key === "ArrowDown" && currentIndex < notes.length - 1) {
        void openNote(notes[currentIndex + 1]!.id);
      } else if (event.key === "ArrowUp" && currentIndex > 0) {
        void openNote(notes[currentIndex - 1]!.id);
      } else if (event.key === "Enter" && currentIndex >= 0) {
        void openNote(notes[currentIndex]!.id);
      }
    });
  };

  const loadFirstPage = async (): Promise<void> => {
    try {
      const page = await api.notes(filter, PAGE_SIZE, null);
      notes = page.notes;
      counts = page.counts;
      cursor = page.nextCursor;
      renderList();
      await renderRail();
    } catch (err) {
      fail(err);
    }
  };

  const loadMore = async (): Promise<void> => {
    try {
      const moreButton = listPane.querySelector(".load-more");
      if (moreButton !== null) (moreButton as HTMLElement).textContent = "Loading notes…";
      const page = await api.notes(filter, PAGE_SIZE, cursor);
      const existing = new Set(notes.map((n) => n.id));
      for (const item of page.notes) {
        if (!existing.has(item.id)) notes.push(item);
      }
      counts = page.counts;
      cursor = page.nextCursor;
      renderList();
      await renderRail();
      if (cursor === null) {
        const firstNew = listPane.querySelector<HTMLElement>(".notes-list li");
        firstNew?.focus();
      } else {
        listPane.querySelector<HTMLElement>(".load-more")?.focus();
      }
    } catch (err) {
      if (err instanceof ApiFailure) {
        feedback?.alert("The inbox changed filter. Showing the first page again.");
      }
      await loadFirstPage();
    }
  };

  const openNote = async (id: string): Promise<void> => {
    currentNoteId = id;
    history.replaceState(null, "", `/inbox/${id}`);
    await renderReading();
    renderList();
    switchToNotePane();
  };

  const linkedNames = (note: Note): Set<string> =>
    new Set(note.insights.map((i) => i.featureName));

  const renderReading = async (): Promise<void> => {
    if (currentNoteId === null) {
      readingPane.replaceChildren(h("p", { class: "empty-note" }, "Choose a note to read."));
      await renderRail();
      return;
    }
    try {
      const result = await api.note(currentNoteId);
      await renderRail(linkedNames(result.note));
      const view = renderNoteView({
        note: result.note,
        timeZone,
        isHeadOfProduct: app.user.role === "head_of_product",
        isProductManager: app.user.role === "product_manager",
        onChanged: async () => {
          await refreshAll();
          await renderReading();
        },
        onDeleted: () => {
          currentNoteId = null;
          history.replaceState(null, "", "/inbox");
          void loadFirstPage();
          readingPane.replaceChildren(h("p", { class: "empty-note" }, "Choose a note to read."));
        },
        onClose: () => {
          const index = notes.findIndex((n) => n.id === currentNoteId);
          currentNoteId = null;
          history.replaceState(null, "", "/inbox");
          void loadFirstPage();
          readingPane.replaceChildren(h("p", { class: "empty-note" }, "Choose a note to read."));
          void index;
        },
      });
      readingPane.replaceChildren(view);
      watchAttachments(result.note.id);
    } catch (err) {
      fail(err);
    }
  };

  /** Pending attachments check again every 5 seconds (DP-13). */
  const watchAttachments = (noteId: string): void => {
    window.clearInterval(attachmentTimer);
    attachmentTimer = window.setInterval(async () => {
      if (currentNoteId !== noteId) {
        window.clearInterval(attachmentTimer);
        return;
      }
      try {
        const result = await api.note(noteId);
        if (result.note.attachments.every((a) => a.status === "available")) {
          window.clearInterval(attachmentTimer);
        }
        await renderReading();
      } catch {
        window.clearInterval(attachmentTimer);
      }
    }, 5000);
  };

  /** The rail: product → component → feature with live counters (DP-08). */
  const railFigures = new Map<string, { insightCount: number; companyCount: number; impact: number; rank: number }>();
  let railCollapsed = false;

  const renderRail = async (linkedNames: Set<string> = new Set()): Promise<void> => {
    const toggle = h(
      "button",
      {
        class: "rail-toggle",
        title: railCollapsed ? "Expand hierarchy" : "Collapse hierarchy",
        onclick: (event: MouseEvent) => {
          railCollapsed = !railCollapsed;
          const button = event.currentTarget as HTMLElement;
          button.title = railCollapsed ? "Expand hierarchy" : "Collapse hierarchy";
          railPane.classList.toggle("collapsed", railCollapsed);
          void renderRail();
        },
      },
      icon(railCollapsed ? "PanelRightOpen" : "PanelRightClose", 16),
      railCollapsed ? "Expand hierarchy" : "Collapse hierarchy",
    );
    railPane.replaceChildren(toggle);
    if (railCollapsed) return;

    try {
      const hierarchy = await api.hierarchy();
      const inner = h("div", { class: "rail-inner" });
      inner.appendChild(h("h3", null, "Product hierarchy"));
      const tree = h("ul", { class: "hierarchy-tree", role: "tree", "aria-label": "Product hierarchy" });

      // FLIP: remember where each row sits before the re-render (DP-06).
      const oldRows = new Map<string, DOMRect>();
      for (const row of railPane.querySelectorAll<HTMLElement>(".feature-row")) {
        const name = row.dataset.featureRow;
        if (name !== undefined) oldRows.set(name, row.getBoundingClientRect());
      }

      for (const product of hierarchy.products) {
        const productNode = h("li", { role: "treeitem", "aria-expanded": "true" },
          h("span", { class: "node-name" }, product.name));
        const componentList = h("ul", { role: "group" });
        for (const component of product.components) {
          const componentNode = h("li", { role: "treeitem", "aria-expanded": "true" },
            h("span", { class: "node-name" }, component.name));
          const featureList = h("ul", { role: "group" });
          for (const feature of component.features) {
            const row = h("div", {
              class: "feature-row",
              "data-feature-row": feature.name,
              role: "treeitem",
              tabindex: "0",
              onclick: () => {
                history.pushState(null, "", `/features/${feature.id}`);
                dispatchEvent(new PopStateEvent("popstate"));
              },
            });
            row.appendChild(h("span", { class: "node-name" }, feature.name));
            const figures = h("span", { class: "figures num" });
            const before = railFigures.get(feature.id);
            const insightFigure = h("span", { "data-figure": "insightCount" });
            const companyFigure = h("span", { "data-figure": "companyCount" });
            const impactFigure = h("span", { "data-figure": "impact" });
            const rankFigure = h("span", { "data-figure": "rank" });
            if (before === undefined) {
              insightFigure.textContent = String(feature.insightCount);
              companyFigure.textContent = String(feature.companyCount);
              impactFigure.textContent = String(feature.impact);
              rankFigure.textContent = String(feature.rank);
            } else {
              countUp(insightFigure as HTMLElement, before.insightCount, feature.insightCount, 280);
              countUp(companyFigure as HTMLElement, before.companyCount, feature.companyCount, 280);
              countUp(impactFigure as HTMLElement, before.impact, feature.impact, 280);
              countUp(rankFigure as HTMLElement, before.rank, feature.rank, 280);
            }
            figures.appendChild(insightFigure);
            figures.appendChild(companyFigure);
            figures.appendChild(impactFigure);
            figures.appendChild(rankFigure);
            row.appendChild(figures);
            if (prefersReducedMotion() && linkedNames.has(feature.name)) {
              row.appendChild(h("span", { class: "linked-badge" }, "Linked"));
            }
            featureList.appendChild(h("li", { role: "none" }, row));
            railFigures.set(feature.id, {
              insightCount: feature.insightCount,
              companyCount: feature.companyCount,
              impact: feature.impact,
              rank: feature.rank,
            });
          }
          componentNode.appendChild(featureList);
          componentList.appendChild(componentNode);
        }
        productNode.appendChild(componentList);
        tree.appendChild(productNode);
      }
      inner.appendChild(tree);
      railPane.appendChild(inner);

      // FLIP: slide each row from its old position to its new one.
      if (!prefersReducedMotion()) {
        for (const row of railPane.querySelectorAll<HTMLElement>(".feature-row")) {
          const name = row.dataset.featureRow;
          const oldRect = name === undefined ? undefined : oldRows.get(name);
          if (oldRect === undefined) continue;
          const newRect = row.getBoundingClientRect();
          const delta = oldRect.top - newRect.top;
          if (Math.abs(delta) < 1) continue;
          row.style.transform = `translateY(${delta}px)`;
          row.style.transition = "none";
          requestAnimationFrame(() => {
            row.style.transition = `transform 280ms ease`;
            row.style.transform = "translateY(0)";
          });
        }
      }
    } catch (err) {
      fail(err);
    }
  };

  /** Every 30 seconds the inbox reloads its first page (DP-45). */
  const refreshAll = async (): Promise<void> => {
    try {
      const page = await api.notes(filter, PAGE_SIZE, null);
      const known = new Set(notes.map((n) => n.id));
      for (const item of page.notes) {
        if (!known.has(item.id)) notes.unshift(item);
      }
      for (const item of page.notes) {
        const existing = notes.find((n) => n.id === item.id);
        if (existing !== undefined) {
          notes[notes.indexOf(existing)] = item;
        }
      }
      counts = page.counts;
      renderList();
      await renderRail();
    } catch (err) {
      fail(err);
    }
  };

  const openLogDialog = (opener: HTMLElement | null): void => {
    import("../lognote.js").then(({ openLogNoteDialog }) => {
      openLogNoteDialog(opener, () => void loadFirstPage());
    }).catch((err) => {
      fail(err);
    });
  };

  root.appendChild(paneTabs);
  root.appendChild(h("div", { class: "inbox-layout" }, listPane, readingPane, railPane));

  await loadFirstPage();
  await renderReading();

  refreshTimer = window.setInterval(() => void refreshAll(), 30_000);
  window.addEventListener("popstate", () => {
    window.clearInterval(refreshTimer);
    window.clearInterval(attachmentTimer);
  });
  window.addEventListener("beforeunload", () => {
    window.clearInterval(refreshTimer);
    window.clearInterval(attachmentTimer);
  });

  return root;
}
