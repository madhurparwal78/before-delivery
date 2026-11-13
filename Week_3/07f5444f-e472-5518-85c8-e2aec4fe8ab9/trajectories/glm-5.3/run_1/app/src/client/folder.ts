// The folder screens: list, page carousel, empty and unavailable states.

import { el, prefersReducedMotion } from "./dom.js";
import { api, apiRoutes, type Client, type ApiError } from "./api.js";
import type { Shell } from "./main.js";
import type {
  FolderSummary, FolderDetail, FolderPage, User,
} from "../shared/domain.js";

const NOT_IN_FOLDER = "That part isn't in your folder.";
const EMPTY_FOLDER_LIST = "No folders are published for your chair yet.";
const SCANS_UNAVAILABLE =
  "This marked part can't be opened right now. Its cuts and rehearsal letters are shown below.";
const NO_SCAN_FILED = "No marked part has been filed yet.";

export async function renderFolderListScreen(
  shell: Shell,
  client: Client,
  user: User
): Promise<void> {
  shell.main.replaceChildren();
  const page = el("div", { class: "page" });
  shell.main.append(page);
  const list = el("ul", { class: "dialog-list" });
  list.setAttribute("aria-label", "Your folders");

  const render = (): void => {
    void api<{ folders: FolderSummary[] }>("GET", apiRoutes.folders()).then((response) => {
      list.replaceChildren();
      if (response.folders.length === 0) {
        page.replaceChildren(el("h1", {}, "Your folders"), el("p", {}, EMPTY_FOLDER_LIST));
        return;
      }
      page.replaceChildren(el("h1", {}, "Your folders"), list);
      for (const folder of response.folders) {
        list.append(el("li", {},
          el("a", { href: `/folder/${folder.programme_id}` },
            `Programme ${folder.number} · ${folder.title}`)));
      }
    }).catch(() => undefined);
  };

  render();
  const refresh = async (): Promise<void> => {
    try {
      render();
    } catch {
      // A refresh that fails changes nothing.
    }
  };
  setInterval(() => void refresh(), 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  void client;
  void user;
}

export async function renderFolderScreen(
  shell: Shell,
  client: Client,
  user: User,
  programmeId: string,
  partId: string | undefined
): Promise<void> {
  shell.main.replaceChildren();
  const page = el("div", { class: "page folder-page-wrap" });
  shell.main.append(page);
  page.append(el("p", {}, "Opening your folder"));

  let folder: FolderDetail | null = null;
  let index = 0;
  let scansAvailable = true;
  let storageUp = true;

  const notInFolder = (): void => {
    page.replaceChildren(
      el("h1", {}, NOT_IN_FOLDER),
      el("p", {}, el("a", { href: "/folder" }, "Your folders"))
    );
  };

  const load = async (): Promise<void> => {
    try {
      folder = await api<FolderDetail>("GET", apiRoutes.folder(programmeId));
      scansAvailable = folder.scans_available && storageUp;
      if (partId) {
        const found = folder.pages.findIndex((entry) => entry.part_id === partId);
        if (found === -1) {
          notInFolder();
          return;
        }
        index = found;
      }
      render();
    } catch (error) {
      const status = (error as ApiError).status;
      if (status === 404) {
        notInFolder();
      }
      // Any other failure leaves the current page as it is.
    }
  };

  const carousel = el("div", { class: "carousel" });
  carousel.setAttribute("role", "region");
  carousel.setAttribute("aria-label", "Folder pages");
  const position = el("span", { class: "mono" });
  position.setAttribute("role", "status");
  position.setAttribute("aria-label", "Page position");

  const render = (): void => {
    if (!folder) return;
    const currentPage = folder.pages[index];
    if (!currentPage) {
      notInFolder();
      return;
    }
    carousel.replaceChildren();
    carousel.append(...folder.pages.map((entry, position_) =>
      buildPage(entry, position_ === index)
    ));
    position.textContent = `Part ${index + 1} of ${folder.pages.length}`;
    page.replaceChildren(
      el("div", { class: "page-title-row" },
        el("h1", {}, `Programme ${folder.programme.number} · ${folder.programme.title}`),
        el("span", { class: "mono" }, user.chair?.label ?? "")),
      carousel,
      el("div", { class: "folder-nav" },
        prevButton(), nextButton(), position)
    );
    applyScanState();
    const openPart = folder.pages[index];
    if (openPart && partId !== openPart.part_id) {
      partId = openPart.part_id;
      history.replaceState(null, "", `/folder/${programmeId}/${partId}`);
    }
  };

  const buildPage = (entry: FolderPage, visible: boolean): HTMLElement => {
    const group = el("div", {
      class: "folder-page",
      hidden: visible ? undefined : "true",
    });
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${entry.work_title} — ${entry.part_name}`);
    group.append(
      el("h2", {}, `${entry.work_title} — ${entry.part_name}`),
      el("p", { class: "mono" }, `${entry.composer} · bars ${entry.bars_from}–${entry.bars_to}`),
      el("p", {}, "Cuts:"),
      entry.cuts.length > 0
        ? el("ul", {}, ...entry.cuts.map((cut) =>
            el("li", { class: "mono" }, `vi–de ${cut.from_bar}–${cut.to_bar}`)))
        : el("p", {}, "None"),
      el("p", {}, "Rehearsal letters:"),
      el("div", { class: "folder-strip" },
        ...entry.rehearsal_letters.map((letter) =>
          el("span", { class: "letter" }, letter.letter,
            el("span", { class: "num" }, String(letter.bar))))),
      scanArea(entry)
    );
    return group;
  };

  const scanArea = (entry: FolderPage): HTMLElement => {
    const area = el("p", { class: "scan-state" });
    area.dataset.partId = entry.part_id;
    return area;
  };

  const applyScanState = (): void => {
    if (!folder) return;
    for (const area of Array.from(page.querySelectorAll<HTMLElement>("p.scan-state"))) {
      const entry = folder.pages.find((candidate) => candidate.part_id === area.dataset.partId);
      if (!entry) continue;
      if (!scansAvailable) {
        area.replaceChildren(SCANS_UNAVAILABLE);
      } else if (entry.marked_scan) {
        const link = el("a", { href: apiRoutes.scanFile(entry.marked_scan.id) }, "Open marked part");
        link.addEventListener("click", (event) => {
          // Downloads continue without leaving the folder.
          void event;
        });
        area.replaceChildren(link);
      } else {
        area.replaceChildren(NO_SCAN_FILED);
      }
    }
  };

  const go = (delta: number): void => {
    if (!folder || folder.pages.length === 0) return;
    const next = (index + delta + folder.pages.length) % folder.pages.length;
    changePage(next);
  };

  const changePage = (next: number): void => {
    index = next;
    render();
    const target = folder?.pages[index];
    if (target) {
      void api<FolderPage>("GET", apiRoutes.folderPage(programmeId, target.part_id))
        .then((fresh) => {
          if (!folder) return;
          const at = folder.pages.findIndex((entry) => entry.part_id === fresh.part_id);
          if (at >= 0) folder.pages[at] = fresh;
          if (folder.pages[index] && folder.pages[index].part_id === fresh.part_id) {
            render();
          }
        })
        .catch((error: ApiError) => {
          if (error.status === 404) notInFolder();
        });
    }
  };

  const prevButton = (): HTMLButtonElement => {
    const button = el("button", {}, "Previous part") as HTMLButtonElement;
    button.addEventListener("click", () => go(-1));
    return button;
  };
  const nextButton = (): HTMLButtonElement => {
    const button = el("button", {}, "Next part") as HTMLButtonElement;
    button.addEventListener("click", () => go(1));
    return button;
  };

  carousel.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    }
  });
  carousel.setAttribute("tabindex", "0");

  let touchStart: { x: number; y: number; time: number } | null = null;
  let touchOffset = 0;
  const pageWidth = (): number => carousel.clientWidth || 375;

  carousel.addEventListener("touchstart", (event: TouchEvent) => {
    const touch = event.touches[0];
    touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    touchOffset = 0;
  });
  carousel.addEventListener("touchmove", (event: TouchEvent) => {
    if (!touchStart) return;
    const touch = event.touches[0];
    const dx = touch.clientX - touchStart.x;
    const dy = touch.clientY - touchStart.y;
    if (Math.abs(dx) > Math.abs(dy)) {
      touchOffset = dx;
      if (!prefersReducedMotion()) {
        for (const element of Array.from(carousel.children) as HTMLElement[]) {
          if (!element.hasAttribute("hidden")) {
            element.style.transform = `translateX(${dx}px)`;
            element.style.transition = "none";
          }
        }
      }
    }
  });
  carousel.addEventListener("touchend", (event: TouchEvent) => {
    if (!touchStart) return;
    const dx = touchOffset;
    const quick = Date.now() - touchStart.time < 400;
    const threshold = pageWidth() / 4;
    touchStart = null;
    touchOffset = 0;
    for (const element of Array.from(carousel.children) as HTMLElement[]) {
      element.style.transform = "";
      element.style.transition = "";
    }
    if (dx < -threshold || (quick && dx < -30)) go(1);
    else if (dx > threshold || (quick && dx > 30)) go(-1);
    void event;
  });

  const refresh = async (): Promise<void> => {
    try {
      const status = await client.readStatus();
      storageUp = status ? status.storage === "up" : true;
      const target = folder?.pages[index];
      if (target) {
        try {
          const fresh = await api<FolderPage>(
            "GET", apiRoutes.folderPage(programmeId, target.part_id)
          );
          if (folder) {
            const at = folder.pages.findIndex((entry) => entry.part_id === fresh.part_id);
            if (at >= 0) folder.pages[at] = fresh;
          }
          scansAvailable = storageUp;
          render();
        } catch (error) {
          if ((error as ApiError).status === 404) notInFolder();
        }
      } else {
        await load();
      }
    } catch {
      // A refresh that fails changes nothing.
    }
  };

  await load();
  setInterval(() => void refresh(), 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
}
