// The section desk: one card per work, cut confirms and bowing masters.

import { el, statusRegion } from "./dom.js";
import { api, apiRoutes, uploadWithProgress, type Client, type ApiError } from "./api.js";
import type { Shell } from "./main.js";
import { partLabel } from "../shared/domain.js";
import type {
  ProgrammeDetail, ProgrammeSummary, WorkDetail, Part, User, Scan,
} from "../shared/domain.js";

const OUTAGE_BANNER =
  "The score store is offline. Scans can't be uploaded or opened right now. Catalogue, counts and cuts still work.";

export async function renderSectionScreen(
  shell: Shell,
  client: Client,
  user: User
): Promise<void> {
  shell.main.replaceChildren();
  const sectionStatus = statusRegion("Section status");
  const page = el("div", { class: "page" });
  shell.main.append(page, sectionStatus);

  const activeStatuses = ["in_preparation", "published", "in_performance"];
  const chairKey = user.chair?.key ?? "";

  const loadCards = async (): Promise<{ programme: ProgrammeDetail; work: WorkDetail; part: Part }[]> => {
    const summaries = (await api<{ programmes: ProgrammeSummary[] }>("GET", apiRoutes.programmes())).programmes;
    const cards: { programme: ProgrammeDetail; work: WorkDetail; part: Part }[] = [];
    for (const summary of summaries) {
      if (!activeStatuses.includes(summary.status)) continue;
      const programme = await api<ProgrammeDetail>("GET", apiRoutes.programme(summary.id));
      for (const workSummary of programme.works) {
        const detail = await api<WorkDetail>("GET", apiRoutes.work(workSummary.id));
        const part = detail.parts.find((entry) => entry.chair_key === chairKey);
        if (part) cards.push({ programme, work: detail, part });
      }
    }
    return cards;
  };

  let cards = await loadCards();

  const uploadReason = (error: ApiError): string => {
    if (error.status === 503) return "the score store is offline";
    if (error.status === 415) return "only PDF, PNG or JPEG files can be filed";
    if (error.status === 413) return "the file is larger than 20,000,000 bytes";
    if (error.status === 422) return "the file is empty";
    return "the upload did not finish";
  };

  const render = (): void => {
    page.replaceChildren();
    const heading = el("h1", {}, `Section desk · ${user.chair?.label ?? ""}`);
    page.append(heading);
    if (cards.length === 0) {
      page.append(el("p", {}, "No works call for your section right now."));
      return;
    }
    let lastProgramme = "";
    for (const card of cards) {
      if (card.programme.id !== lastProgramme) {
        lastProgramme = card.programme.id;
        page.append(el("h2", {},
          `Programme ${card.programme.number} · ${card.programme.title}`));
      }
      page.append(buildCard(card));
    }
  };

  const buildCard = (card: {
    programme: ProgrammeDetail; work: WorkDetail; part: Part;
  }): HTMLElement => {
    const box = el("div", { class: "card" });
    box.append(el("h3", {}, card.work.title),
      el("p", {}, partLabel(card.work.title, card.part.name)));

    const cutsWrap = el("div", {});
    const renderCuts = (): void => {
      cutsWrap.replaceChildren();
      const marked = new Set(card.part.marks.map((mark) => mark.cut_id));
      for (const cut of card.work.cuts) {
        if (cut.from_bar > card.part.bars_to || cut.to_bar < card.part.bars_from) continue;
        if (marked.has(cut.id)) {
          const mark = card.part.marks.find((entry) => entry.cut_id === cut.id);
          if (mark) {
            cutsWrap.append(el("div", {},
              `Confirmed ${cut.from_bar}–${cut.to_bar} by ${mark.marked_by.name}`));
          }
        } else {
          const button = el("button", {},
            `Confirm cut ${cut.from_bar}–${cut.to_bar}`);
          button.addEventListener("click", async () => {
            sectionStatus.textContent = "Recording";
            const label = partLabel(card.work.title, card.part.name);
            try {
              const response = await api<{ part: Part }>(
                "POST", apiRoutes.marks(card.part.id), { cut_id: cut.id }
              );
              card.part = response.part;
              sectionStatus.textContent =
                `${label} carries cut ${cut.from_bar}–${cut.to_bar}.`;
              renderCuts();
            } catch (error) {
              const apiError = error as ApiError;
              if (apiError.status === 404) {
                sectionStatus.textContent =
                  "That cut was restored before the mark was recorded.";
              } else if (apiError.status === 422) {
                sectionStatus.textContent =
                  `${label} doesn't play in bars ${cut.from_bar}–${cut.to_bar}.`;
              } else {
                sectionStatus.textContent = String(apiError.body?.message ?? "Confirm failed.");
              }
            }
          });
          cutsWrap.append(button);
        }
      }
      if (card.work.cuts.length === 0) cutsWrap.append(el("p", {}, "No cuts."));
    };
    renderCuts();
    box.append(cutsWrap);

    const uploadButton = el("button", {},
      `Upload bowing master ${card.work.title}`);
    const statusLine = statusRegion(`Bowing master status: ${card.work.title}`, "bowing-status");
    const filedList = el("ul", { class: "dialog-list" });
    filedList.setAttribute("aria-label", `Filed bowing masters: ${card.work.title}`);
    const hiddenInput = el("input", { type: "file", hidden: "true", accept: ".pdf,.png,.jpg,.jpeg" }) as HTMLInputElement;
    uploadButton.append(hiddenInput);

    const renderFiled = (): void => {
      filedList.replaceChildren();
      void api<{ scans: Scan[] }>("GET", apiRoutes.scans(card.part.id)).then((response) => {
        for (const scan of response.scans.filter((entry) => entry.kind === "bowing_master")) {
          filedList.append(el("li", {},
            el("a", {
              href: apiRoutes.scanFile(scan.id),
              "aria-label": `Download ${scan.file_name}`,
            }, `Download ${scan.file_name}`)));
        }
      });
    };
    renderFiled();

    uploadButton.addEventListener("click", () => {
      if (uploadButton.getAttribute("aria-disabled") === "true") return;
      hiddenInput.click();
    });
    hiddenInput.addEventListener("change", () => {
      const file = hiddenInput.files?.[0];
      if (!file) return;
      statusLine.textContent = "Uploading";
      const formData = new FormData();
      formData.append("kind", "bowing_master");
      formData.append("file", file);
      const key = crypto.randomUUID();
      void uploadWithProgress(apiRoutes.scans(card.part.id), formData, key, () => undefined)
        .then(() => {
          statusLine.textContent = "Filed";
          renderFiled();
        })
        .catch((error: ApiError) => {
          const reason = uploadReason(error);
          const capitalised = reason.charAt(0).toUpperCase() + reason.slice(1);
          statusLine.textContent = `Not filed ${capitalised}.`;
        });
    });

    box.append(uploadButton, statusLine, filedList);
    return box;
  };

  const applyStorageState = (status: { storage: "up" | "down" } | null): void => {
    if (!status) return;
    const buttons = page.querySelectorAll<HTMLButtonElement>("button");
    buttons.forEach((button) => {
      if (!button.textContent?.startsWith("Upload bowing master")) return;
      if (status.storage === "down") {
        button.setAttribute("aria-disabled", "true");
        button.setAttribute("aria-description", OUTAGE_BANNER);
      } else {
        button.removeAttribute("aria-disabled");
        button.removeAttribute("aria-description");
      }
    });
  };

  const refresh = async (): Promise<void> => {
    try {
      const status = await client.readStatus();
      applyStorageState(status);
      cards = await loadCards();
      const focused = document.activeElement as HTMLElement | null;
      if (focused && page.contains(focused)) {
        render();
        return;
      }
      render();
    } catch {
      // A refresh that fails changes nothing.
    }
  };

  render();
  client.readStatus().then(applyStorageState);
  setInterval(() => void refresh(), 30000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  void shell;
}
