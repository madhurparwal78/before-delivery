import { ApiFailure, get, post } from "../api";
import { copy, stampLine } from "../copy";
import { confirmDialog, openDialog } from "../dialog";
import { clear, h, icon, setAttr, setText } from "../dom";
import { fromOtherDevice, LiveEvent, onLive } from "../live";
import { PageHandle } from "../router";
import { drawFlatChart } from "../scene/still";
import { announce, buildFooter } from "../shell";
import { Pen, penShape, ReportLink, Revision } from "../types";

interface LinkRow {
  root: HTMLElement;
  url: HTMLInputElement;
  status: HTMLElement;
  regenerate: HTMLButtonElement;
}

/// The Reports page: the latest report row, the grade and open-defect counter
/// panels, one band per revision, and the pen's report links.
export async function reportsPage(container: HTMLElement): Promise<PageHandle> {
  let pens: Pen[] = [];
  let pen: Pen | null = null;
  let revisions: Revision[] = [];
  let links: ReportLink[] = [];
  let penSequence = 0;
  let destroyed = false;

  const penSelect = h("select", { "aria-label": "Pen" });
  const publishButton = h("button", { type: "button", class: "text-button" }, "Publish revision");
  const reportStatus = h("div", { role: "status", "aria-label": "Report status" });
  const latest = h("section", { class: "latest-report light", "aria-label": "Latest report" });
  const counters = h("div", { class: "counters" });
  const bands = h("div", {});
  const linksRegion = h("section", { class: "band", "aria-label": "Report links" });

  const main = h("main", {}, [
    h("div", { class: "band" }, [
      h("label", { class: "field" }, [h("span", {}, "Pen"), penSelect]),
      h("div", { class: "actions" }, [publishButton]),
      reportStatus,
    ]),
    latest,
    counters,
    bands,
    linksRegion,
  ]);
  container.appendChild(main);
  container.appendChild(buildFooter());

  const reveal = new IntersectionObserver(
    (entries) => {
      let delay = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const node = entry.target as HTMLElement;
        window.setTimeout(() => node.classList.add("shown"), delay);
        delay += 80;
        reveal.unobserve(node);
      }
    },
    { threshold: 0.2 },
  );

  function chartFrame(classes: string, theme: "dark" | "light"): HTMLElement {
    const canvas = h("canvas", {
      role: "img",
      "aria-label": `${pen?.name ?? "Pen"} flat chart`,
    });
    const frame = h("div", { class: `chart-frame ${classes}` }, canvas);
    window.requestAnimationFrame(() => {
      if (!pen) return;
      drawFlatChart(
        canvas,
        penShape(pen),
        (pen.defects ?? [])
          .filter((defect) => !defect.removed)
          .map((defect) => ({
            bearing_deg: defect.bearing_deg ?? 0,
            depth_m: defect.depth_m ?? 0,
            chart_x_m: defect.chart_x_m ?? 0,
            chart_y_m: defect.chart_y_m ?? 0,
          })),
        theme,
      );
    });
    return frame;
  }

  function renderLatest(): void {
    clear(latest);
    if (!pen) return;
    const newest = revisions[0];
    const story = h("div", {}, [
        h(
          "div",
          { class: "label num" },
          newest ? stampLine(newest.published_at) : "No revision published",
        ),
        h(
          "h2",
          {},
          `${pen.name} \u2014 grade ${newest ? newest.grade.letter : pen.grade.letter}`,
        ),
        h(
          "p",
          { class: "num" },
          `${newest ? newest.open_defects : pen.open_defects} ${
            (newest ? newest.open_defects : pen.open_defects) === 1
              ? "open defect"
              : "open defects"
          }`,
        ),
    ]);
    latest.appendChild(story);
    latest.appendChild(chartFrame("media-first", "dark"));
    latest.classList.add("shown");
  }

  function renderCounters(): void {
    clear(counters);
    if (!pen) return;
    counters.appendChild(
      h("section", { class: "counter olive", "aria-label": "Condition grade" }, [
        h("h2", {}, "Condition grade"),
        chartFrame("", "dark"),
        h("span", { class: "numeral" }, pen.grade.letter),
      ]),
    );
    counters.appendChild(
      h("section", { class: "counter stone light", "aria-label": "Open defects" }, [
        h("h2", {}, "Open defects"),
        chartFrame("", "dark"),
        h("span", { class: "numeral num" }, String(pen.open_defects)),
      ]),
    );
  }

  function renderBands(): void {
    clear(bands);
    if (!pen) return;
    for (const revision of revisions) {
      const restore = h(
        "button",
        { type: "button", class: "text-button" },
        `Restore revision ${revision.number}`,
      );
      restore.addEventListener("click", () => openRestoreDialog(revision.number));
      const band = h(
        "section",
        { class: "revision-band light", "aria-label": `Revision ${revision.number}` },
        [
          h("div", {}, [
            h("h2", {}, `Revision ${revision.number}`),
            h("div", { class: "num" }, stampLine(revision.published_at)),
            h("div", { class: "num" }, `Grade ${revision.grade.letter}`),
            h(
              "div",
              { class: "num" },
              `${revision.open_defects} ${revision.open_defects === 1 ? "open defect" : "open defects"}`,
            ),
            h("div", { class: "actions" }, [
              h(
                "a",
                {
                  class: "text-button",
                  href: `/api/pens/${pen.id}/reports/${revision.number}/pack`,
                  download: `${pen.id}-revision-${revision.number}.json`,
                },
                [icon("download"), "Download pack"],
              ),
              restore,
            ]),
          ]),
          chartFrame("media-first", "dark"),
        ],
      );
      bands.appendChild(band);
      reveal.observe(band);
    }
  }

  function openRestoreDialog(number: number): void {
    confirmDialog({
      name: "Restore revision",
      heading: `Restore revision ${number}`,
      confirmLabel: "Restore",
      onConfirm: async (handle) => {
        setText(reportStatus, copy.restoring);
        try {
          await post(`/api/pens/${pen?.id}/restore`, { revision: number });
          handle.close();
          setText(reportStatus, copy.restored(number));
          await loadPen(penSelect.value);
        } catch (failure) {
          handle.close();
          setText(
            reportStatus,
            failure instanceof ApiFailure ? failure.message : copy.unreachable,
          );
        }
      },
    });
  }

  // ---------- report links ----------

  const linkRows = new Map<string, LinkRow>();
  const linkList = h("ul", { class: "list" });

  function linkStatusLine(link: ReportLink): string {
    if (link.status === "revoked") return copy.linkStatusRevoked;
    if (link.status === "expired") return copy.linkStatusExpired;
    return copy.linkActive(link.expires_at, link.expires_in_s);
  }

  /// The list's refresh updates each row's remaining time in place and keeps
  /// keyboard focus and the caret where they were.
  function renderLinks(): void {
    const seen = new Set<string>();
    for (const link of links) {
      seen.add(link.id);
      let row = linkRows.get(link.id);
      if (!row) {
        const url = h("input", {
          type: "text",
          readonly: true,
          "aria-label": "Report link URL",
        });
        const statusLine = h("div", { class: "label num" });
        const copyButton = h("button", { type: "button", class: "text-button" }, "Copy link");
        const regenerate = h("button", { type: "button", class: "text-button" }, "Regenerate link");
        const revoke = h("button", { type: "button", class: "text-button" }, "Revoke link");
        copyButton.addEventListener("click", async () => {
          await navigator.clipboard?.writeText(url.value).catch(() => undefined);
          setText(reportStatus, copy.linkCopied);
        });
        regenerate.addEventListener("click", () => void doRegenerate(link.id, url.value));
        revoke.addEventListener("click", () => openRevokeDialog(link.id));
        const root = h("li", { class: "link-row" }, [
          url,
          statusLine,
          h("div", { class: "actions" }, [copyButton, regenerate, revoke]),
        ]);
        row = { root, url, status: statusLine, regenerate };
        linkRows.set(link.id, row);
        linkList.appendChild(root);
      }
      if (document.activeElement !== row.url && row.url.value !== link.url) {
        row.url.value = link.url;
      }
      setText(row.status, linkStatusLine(link));
      setAttr(row.regenerate, "disabled", link.status === "active" ? null : "");
    }
    for (const [id, row] of [...linkRows]) {
      if (!seen.has(id)) {
        row.root.remove();
        linkRows.delete(id);
      }
    }
  }

  async function doRegenerate(linkId: string, shownUrl: string): Promise<void> {
    const token = shownUrl.split("/r/")[1] ?? "";
    setText(reportStatus, copy.linkWorking);
    try {
      await post(`/api/links/${linkId}/regenerate`, { token });
      await loadLinks();
      setText(reportStatus, copy.linkRegenerated);
    } catch (failure) {
      await loadLinks();
      setText(
        reportStatus,
        failure instanceof ApiFailure ? failure.message : copy.unreachable,
      );
    }
  }

  function openRevokeDialog(linkId: string): void {
    confirmDialog({
      name: "Revoke link",
      heading: "Revoke link",
      confirmLabel: "Revoke",
      onConfirm: async (handle) => {
        setText(reportStatus, copy.linkWorking);
        try {
          await post(`/api/links/${linkId}/revoke`);
          handle.close();
          await loadLinks();
          setText(reportStatus, copy.linkRevoked);
        } catch (failure) {
          handle.close();
          setText(
            reportStatus,
            failure instanceof ApiFailure ? failure.message : copy.unreachable,
          );
        }
      },
    });
  }

  function openCreateDialog(): void {
    openDialog({
      name: "Create report link",
      build: (handle) => {
        const group = h("div", { role: "radiogroup", "aria-label": "Expires in" });
        const choices: [string, number][] = [
          ["24 hours", 86400],
          ["7 days", 604800],
          ["30 days", 2592000],
        ];
        let chosen = 86400;
        const radios: HTMLButtonElement[] = [];
        for (const [label, seconds] of choices) {
          const radio = h(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-label": label,
              "aria-checked": seconds === chosen ? "true" : "false",
              class: "text-button",
            },
            label,
          );
          radio.addEventListener("click", () => {
            chosen = seconds;
            for (const other of radios) {
              setAttr(
                other,
                "aria-checked",
                other === radio ? "true" : "false",
              );
            }
          });
          radios.push(radio);
          group.appendChild(radio);
        }
        const create = h("button", { type: "button", class: "text-button" }, "Create link");
        create.addEventListener("click", async () => {
          setText(reportStatus, copy.linkWorking);
          try {
            await post(`/api/pens/${pen?.id}/links`, { expires_in_seconds: chosen });
            handle.close();
            await loadLinks();
            setText(reportStatus, copy.linkCreated);
          } catch (failure) {
            handle.close();
            setText(
              reportStatus,
              failure instanceof ApiFailure ? failure.message : copy.unreachable,
            );
          }
        });
        return h("div", {}, [
          h("h2", {}, "Create report link"),
          group,
          h("div", { class: "actions" }, [create]),
        ]);
      },
    });
  }

  async function loadLinks(): Promise<void> {
    if (!pen) return;
    const payload = await get(`/api/pens/${pen.id}/links`);
    if (destroyed) return;
    links = payload.links as ReportLink[];
    renderLinks();
  }

  async function loadPen(penId: string): Promise<void> {
    const token = ++penSequence;
    const [penPayload, revisionPayload] = await Promise.all([
      get(`/api/pens/${penId}`),
      get(`/api/pens/${penId}/reports`),
    ]);
    if (destroyed || token !== penSequence) return;
    pen = penPayload.pen as Pen;
    revisions = revisionPayload.revisions as Revision[];
    renderLatest();
    renderCounters();
    renderBands();
    linkRows.clear();
    clear(linkList);
    await loadLinks();
  }

  publishButton.addEventListener("click", async () => {
    setText(reportStatus, copy.publishing);
    publishButton.setAttribute("disabled", "");
    try {
      const payload = await post(`/api/pens/${penSelect.value}/reports`);
      setText(reportStatus, copy.published((payload.revision as Revision).number));
      await loadPen(penSelect.value);
    } catch (failure) {
      setText(
        reportStatus,
        failure instanceof ApiFailure ? failure.message : copy.unreachable,
      );
    } finally {
      publishButton.removeAttribute("disabled");
    }
  });

  penSelect.addEventListener("change", () => void loadPen(penSelect.value));

  const createButton = h("button", { type: "button", class: "text-button" }, "Create report link");
  createButton.addEventListener("click", () => openCreateDialog());
  linksRegion.appendChild(h("div", { class: "panel-title" }, "Report links"));
  linksRegion.appendChild(h("div", { class: "actions" }, [createButton]));
  linksRegion.appendChild(linkList);

  const payload = await get("/api/pens");
  pens = payload.pens as Pen[];
  for (const entry of pens) {
    penSelect.appendChild(h("option", { value: entry.id }, entry.name));
  }
  if (pens.length) penSelect.value = pens[0].id;
  await loadPen(penSelect.value);

  const unsubscribe = onLive((event: LiveEvent) => {
    if (event.pen_id !== pen?.id) return;
    if (event.type === "link.created" || event.type === "link.regenerated" || event.type === "link.revoked") {
      void loadLinks();
      if (!fromOtherDevice(event)) return;
      announce(
        event.type === "link.created"
          ? copy.linkCreatedElsewhere
          : event.type === "link.revoked"
            ? copy.linkRevokedElsewhere
            : copy.linkRegeneratedElsewhere,
      );
      return;
    }
    if (event.type === "revision.published" || event.type === "pen.restored") {
      void loadPen(penSelect.value);
    }
  });

  const refresh = window.setInterval(() => void loadLinks(), 30000);

  return {
    destroy(): void {
      destroyed = true;
      unsubscribe();
      reveal.disconnect();
      window.clearInterval(refresh);
    },
  };
}
