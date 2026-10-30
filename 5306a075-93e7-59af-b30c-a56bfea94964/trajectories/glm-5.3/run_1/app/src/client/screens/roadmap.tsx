import type { Roadmap, RoadmapRelease } from "../../shared/types.js";
import { api, ApiFailure, shipRelease } from "../api.js";
import { h, icon, monthLabel } from "../dom.js";
import { currentApp } from "../main.js";
import { feedback, openDialog, statusLabel } from "../ui.js";
import { statusIcon } from "./features.js";

interface Board {
  roadmap: Roadmap;
}

/** The roadmap board: month columns, keyboard and pointer moves (DP-21, DP-22). */
export async function renderRoadmap(
  _screen: HTMLElement,
  fail: (err: unknown) => void,
): Promise<HTMLElement> {
  const root = h("div", null);
  let board: Board | null = null;
  let picked: { featureId: string; releaseId: string | null; index: number; name: string } | null = null;

  const load = async (): Promise<void> => {
    board = { roadmap: await api.roadmap() };
    render();
  };

  const releaseById = (id: string | null): RoadmapRelease | null => {
    if (board === null || id === null) return null;
    for (const column of board.roadmap.columns) {
      for (const release of column.releases) {
        if (release.id === id) return release;
      }
    }
    return null;
  };

  interface BoardList {
    releaseId: string | null;
    label: string;
    featureIds: string[];
  }

  const lists = (): BoardList[] => {
    if (board === null) return [];
    const out: BoardList[] = [
      { releaseId: null, label: "Unscheduled", featureIds: board.roadmap.unscheduled.map((f) => f.id) },
    ];
    for (const column of board.roadmap.columns) {
      for (const release of column.releases) {
        out.push({
          releaseId: release.id,
          label: release.name,
          featureIds: release.featureIds,
        });
      }
    }
    return out.filter((list) => list.releaseId === null || releaseById(list.releaseId)?.status !== "shipped");
  };

  const featureName = (id: string): string => {
    if (board === null) return "";
    for (const u of board.roadmap.unscheduled) {
      if (u.id === id) return u.name;
    }
    for (const column of board.roadmap.columns) {
      for (const release of column.releases) {
        const found = release.features.find((f) => f.id === id);
        if (found !== undefined) return found.name;
      }
    }
    return "";
  };

  const render = (): void => {
    if (board === null) return;
    root.replaceChildren();
    root.appendChild(h("h2", null, "Roadmap board"));
    const region = h("div", { class: "board-region", role: "region", "aria-label": "Roadmap board" });
    const columns = h("div", { class: "board-columns" });

    // The Unscheduled lane comes first.
    const unscheduledList = h("ul", { class: "unscheduled-list", role: "list", "aria-label": "Unscheduled" });
    const unscheduledLane = h(
      "section",
      { class: "unscheduled-lane", "aria-label": "Unscheduled" },
      h("h3", null, "Unscheduled"),
      unscheduledList,
    );
    fillList(unscheduledList, null, board.roadmap.unscheduled.map((f) => f.id));
    region.appendChild(unscheduledLane);

    for (const column of board.roadmap.columns) {
      const columnEl = h("section", {
        class: "board-column",
        role: "group",
        "aria-label": monthLabel(column.month),
      });
      columnEl.appendChild(h("h3", null, monthLabel(column.month)));
      for (const release of column.releases) {
        const card = h("article", { class: "release-card" });
        const head = h("div", { class: "release-head" },
          h("h4", null, release.name),
          h("span", { class: "release-meta num" }, release.targetDate),
          h("span", { class: "status-chip" }, icon(statusIcon(release.status), 14), statusLabel(release.status)),
          h("span", { class: "public-tag" }, release.isPublic ? "Public" : "Internal"),
        );
        card.appendChild(head);
        const list = h("ul", { class: "release-features", role: "list", "aria-label": release.name });
        fillList(list, release.id, release.featureIds);
        card.appendChild(list);

        const actions = h("div", { class: "release-actions" });
        const isHead = currentApp()?.user.role === "head_of_product";
        if (release.status === "open") {
          if (isHead) {
            actions.appendChild(h("button", { onclick: () => void freeze(release) }, "Freeze scope"));
          }
        } else if (release.status === "frozen" && isHead) {
          actions.appendChild(h("button", { onclick: (event: MouseEvent) => openShipDialog(release, event.currentTarget as HTMLElement) }, "Ship release"));
        }
        card.appendChild(actions);
        columnEl.appendChild(card);
      }
      columns.appendChild(columnEl);
    }
    region.appendChild(columns);
    root.appendChild(region);
  };

  const fillList = (list: HTMLElement, releaseId: string | null, featureIds: string[]): void => {
    list.replaceChildren();
    featureIds.forEach((featureId, index) => {
      const card = h("li", null,
        h("button", {
          class: "feature-card",
          "data-feature-id": featureId,
          "data-release-id": releaseId ?? "",
          "data-index": String(index),
          draggable: "true",
          onclick: () => {
            history.pushState(null, "", `/features/${featureId}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          },
          onkeydown: (event: KeyboardEvent) => onCardKey(event, featureId, releaseId, index),
        },
          h("span", null, featureName(featureId)),
        ),
      );
      // Pointer drag between releases.
      const button = card.querySelector("button")!;
      button.addEventListener("dragstart", (event) => {
        const drag = event as DragEvent;
        drag.dataTransfer?.setData("text/plain", featureId);
        picked = { featureId, releaseId, index, name: featureName(featureId) };
      });
      button.addEventListener("dragend", () => {
        picked = null;
      });
      list.appendChild(card);
    });
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (picked === null) return;
      showDropSlot(list, releaseId, dropIndexFor(list, event as DragEvent));
    });
    list.addEventListener("drop", (event) => {
      event.preventDefault();
      if (picked === null) return;
      const index = dropIndexFor(list, event as DragEvent);
      void commitMove(picked.featureId, releaseId, index);
    });
  };

  /** Where in the list the pointer sits, for the drop slot. */
  const dropIndexFor = (list: HTMLElement, event: DragEvent): number => {
    const cards = [...list.querySelectorAll<HTMLElement>(".feature-card")];
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i]!.getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        break;
      }
    }
    return index;
  };

  const showDropSlot = (list: HTMLElement, releaseId: string | null, index?: number): void => {
    root.querySelectorAll(".drop-slot").forEach((slot) => slot.remove());
    const slot = h("li", { class: "drop-slot" });
    const cards = [...list.querySelectorAll<HTMLElement>("li:not(.drop-slot)")];
    const at = index === undefined ? cards.length : index;
    const before = cards[at];
    if (before !== undefined) list.insertBefore(slot, before);
    else list.appendChild(slot);
    void releaseId;
  };

  /** Keyboard board moves with announced positions (DP-22). */
  const onCardKey = (event: KeyboardEvent, featureId: string, releaseId: string | null, index: number): void => {
    const key = event.key;
    if (
      key !== " " &&
      key !== "Enter" &&
      key !== "ArrowUp" &&
      key !== "ArrowDown" &&
      key !== "ArrowLeft" &&
      key !== "ArrowRight" &&
      key !== "Escape"
    ) {
      return;
    }
    event.preventDefault();

    // Space or Enter picks the card up; with a card in hand they drop it.
    if (picked === null) {
      if (key !== " " && key !== "Enter") return;
      picked = { featureId, releaseId, index, name: featureName(featureId) };
      feedback?.board(announce(picked));
      markPicked(featureId);
      return;
    }

    if (key === "Escape") {
      const cancelled = picked;
      picked = null;
      feedback?.board(`Move cancelled. ${cancelled.name} is back at ${listPosition(cancelled.releaseId, cancelled.index)}.`);
      render();
      return;
    }
    if (key === "Enter" || key === " ") {
      const move = picked;
      picked = null;
      void commitMove(move.featureId, move.releaseId, move.index);
      return;
    }

    // Step within the picked card's current list.
    const inHand = picked;
    const current = lists().find((l) => l.releaseId === inHand.releaseId) ?? lists()[0]!;
    if (key === "ArrowUp" && inHand.index > 0) {
      inHand.index -= 1;
      previewWithin(current, inHand);
      feedback?.board(announce(inHand));
      return;
    }
    if (key === "ArrowDown" && inHand.index < current.featureIds.length - 1) {
      inHand.index += 1;
      previewWithin(current, inHand);
      feedback?.board(announce(inHand));
      return;
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const all = lists();
      const listIndex = all.findIndex((l) => l.releaseId === inHand.releaseId);
      const nextIndex = key === "ArrowLeft" ? listIndex - 1 : listIndex + 1;
      if (nextIndex < 0 || nextIndex >= all.length) return;
      movePreviewBetween(current, all[nextIndex]!, inHand);
      feedback?.board(announce(inHand));
    }
  };

  /** Where the picked card sits, for announcements. */
  const announce = (card: { name: string; releaseId: string | null; index: number }): string => {
    const list = lists().find((l) => l.releaseId === card.releaseId) ?? lists()[0]!;
    return `${card.name}, ${listPosition(list.releaseId, card.index)}`;
  };

  const listPosition = (releaseId: string | null, index: number): string => {
    const list = lists().find((l) => l.releaseId === releaseId) ?? lists()[0]!;
    return `position ${index + 1} of ${Math.max(list.featureIds.length, 1)} in ${list.label}`;
  };

  /** Reorder the model list and re-render; nothing is saved until the drop. */
  const previewWithin = (list: BoardList, card: { featureId: string; index: number }): void => {
    const without = list.featureIds.filter((id) => id !== card.featureId);
    without.splice(Math.min(card.index, without.length), 0, card.featureId);
    list.featureIds = without;
    render();
    markPicked(card.featureId);
  };

  /** Move the picked card between two lists in the model and re-render. */
  const movePreviewBetween = (from: BoardList, to: BoardList, card: { featureId: string; releaseId: string | null; index: number }): void => {
    from.featureIds = from.featureIds.filter((id) => id !== card.featureId);
    card.index = Math.min(card.index, to.featureIds.length);
    to.featureIds.splice(card.index, 0, card.featureId);
    card.releaseId = to.releaseId;
    render();
    markPicked(card.featureId);
  };

  const markPicked = (featureId: string): void => {
    root.querySelectorAll(".feature-card").forEach((card) => {
      card.classList.toggle("picked-up", (card as HTMLElement).dataset.featureId === featureId);
    });
    const card = root.querySelector<HTMLElement>(`[data-feature-id="${cssEscape(featureId)}"]`);
    card?.focus();
  };

  const commitMove = async (
    featureId: string,
    toReleaseId: string | null,
    toIndex: number,
    fallbackIndex?: number,
  ): Promise<void> => {
    if (board === null) return;
    const expected: Record<string, number> = {};
    const source = findCurrentRelease(featureId);
    if (source !== null) {
      expected[source] = releaseById(source)?.orderVersion ?? 1;
    }
    if (toReleaseId !== null) {
      expected[toReleaseId] = releaseById(toReleaseId)?.orderVersion ?? 1;
    }
    feedback?.saveStatus("Saving order…");
    try {
      await api.move({
        featureId,
        toReleaseId,
        toIndex: fallbackIndex === undefined ? toIndex : toIndex,
        expectedOrderVersions: expected,
      });
      const name = featureName(featureId);
      const target = toReleaseId === null ? "Unscheduled" : (releaseById(toReleaseId)?.name ?? "");
      const list = lists().find((l) => l.releaseId === toReleaseId);
      feedback?.board(`Dropped ${name}. Position ${(toIndex ?? 0) + 1} of ${Math.max(list?.featureIds.length ?? 1, 1)} in ${target}.`);
      picked = null;
      await load();
      root.querySelector<HTMLElement>(`[data-feature-id="${cssEscape(featureId)}"]`)?.focus();
    } catch (err) {
      if (err instanceof ApiFailure) {
        const failure = err.error.error as {
          message: string;
          code: string;
          current?: unknown;
        };
        if (failure.code === "order_conflict") {
          feedback?.board(`The board changed while you were moving ${featureName(featureId)}. It now shows the latest order.`);
        } else if (failure.code === "feature_not_planned") {
          feedback?.board(`${featureName(featureId)} must be planned before it joins a release.`);
        } else if (failure.code === "forbidden") {
          const target = toReleaseId === null ? "that release" : (releaseById(toReleaseId)?.name ?? "");
          feedback?.board(`${target} is frozen. Ask a head of product to change its scope.`);
        } else if (failure.code === "release_shipped") {
          const target = toReleaseId === null ? "that release" : (releaseById(toReleaseId)?.name ?? "");
          feedback?.board(`${target} has shipped and can't change.`);
        } else {
          feedback?.alert(failure.message);
        }
      } else {
        fail(err);
      }
      picked = null;
      await load();
    }
  };

  const findCurrentRelease = (featureId: string): string | null => {
    if (board === null) return null;
    if (board.roadmap.unscheduled.some((f) => f.id === featureId)) return null;
    for (const column of board.roadmap.columns) {
      for (const release of column.releases) {
        if (release.featureIds.includes(featureId)) return release.id;
      }
    }
    return null;
  };

  const freeze = async (release: RoadmapRelease): Promise<void> => {
    feedback?.saveStatus("Freezing scope…");
    try {
      await api.freeze(release.id);
      feedback?.saveStatus(`Scope frozen for ${release.name}.`);
      await load();
    } catch (err) {
      if (err instanceof ApiFailure) {
        const failure = err.error.error as { message: string; code: string };
        feedback?.alert(
          failure.code === "storage_unavailable"
            ? `Storage is unavailable, so ${release.name} was not frozen. Try again in a minute.`
            : failure.message,
        );
      }
      feedback?.saveStatus("");
    }
  };

  const openShipDialog = (release: RoadmapRelease, opener: HTMLElement | null): void => {
    openDialog((close) => {
      const wrap = h("div", { "aria-label": `Ship ${release.name}` });
      wrap.appendChild(h("h2", null, `Ship ${release.name}`));
      wrap.appendChild(h("p", null, "Each customer who asked for these features gets one email."));
      wrap.appendChild(
        h("div", { class: "dialog-actions" },
          h("button", {
            class: "primary",
            onclick: async (event: MouseEvent) => {
              const button = event.currentTarget as HTMLButtonElement;
              button.textContent = "Shipping…";
              const key = `ship-${release.id}-${Date.now()}`;
              try {
                const result = await shipRelease(release.id, key);
                feedback?.saveStatus(`${release.name} shipped. ${result.emailsQueued} customer emails queued for delivery.`);
                close();
                await load();
              } catch (err) {
                button.textContent = "Ship and notify customers";
                if (err instanceof ApiFailure) {
                  const failure = err.error.error as { message: string; code: string };
                  feedback?.alert(
                    failure.code === "invalid_transition"
                      ? `Freeze ${release.name} before shipping it.`
                      : failure.message,
                  );
                }
              }
            },
          }, "Ship and notify customers"),
          h("button", { onclick: close }, "Cancel"),
        ),
      );
      return wrap;
    }, opener);
  };

  try {
    await load();
  } catch (err) {
    fail(err);
  }
  return root;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
