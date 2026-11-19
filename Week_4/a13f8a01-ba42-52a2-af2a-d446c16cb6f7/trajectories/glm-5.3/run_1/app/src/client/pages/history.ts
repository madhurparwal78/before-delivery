// Core sample: the pen's versions as stone bands, the vertical slider, and the
// compare region. The preview follows only a resting marker.
import { el, button, link, status, navigate } from "../lib/dom.js";
import { Api, formatDateTime, type Pen, type VersionEntry } from "../lib/api.js";
import { buildHeader, meSync } from "../lib/header.js";
import { PreviewStage } from "../lib/preview.js";
import { unverifiedCopy } from "../lib/verify.js";

interface DiffResponse {
  a: number;
  b: number;
  added: number;
  removed: number;
  panes: Record<"html" | "css" | "js", { added: number; removed: number; rows: Array<{ change: "same" | "added" | "removed"; text: string }> }>;
}

export async function historyPage(root: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
  const penId = params.get("pen") ?? "";
  root.innerHTML = "";
  buildHeader(root);

  const [pen, versions] = await Promise.all([
    Api.get<Pen>(`/api/pens/${penId}`).catch(() => null),
    Api.get<{ versions: VersionEntry[] }>(`/api/pens/${penId}/versions`).catch(() => null),
  ]);
  if (!pen || !versions || versions.versions.length === 0) {
    await (await import("./notfound.js")).notFoundPage(root, params, `/pen/${penId}/history`);
    return;
  }
  const user = meSync();
  const config = await (await import("../lib/api.js")).getConfig();

  const wrap = el("div", { class: "split history-root" });
  const stage = el("div", { class: "stage with-inset" });
  const strata = el("div", { class: "strata", role: "region", "aria-label": "Core sample" });
  stage.appendChild(strata);
  const mini = el("div", { class: "history-preview-mini" });
  const stageInnerMini = el("div", { class: "stage-inner" });
  mini.appendChild(stageInnerMini);
  stage.appendChild(mini);
  const preview = new PreviewStage(stageInnerMini);

  const col = el("div", { class: "column" });
  const body = el("div", { class: "column-body" });

  const historyStatus = status("History status");
  const compare = el("div", { role: "region", "aria-label": "Compare", class: "diff-region" });

  // A: pinned version, B: the marker's version.
  const N = versions.versions.length;
  const valueText = (entries: VersionEntry[], n: number, total: number): string => {
    const entry = entries.find((v) => v.number === n) ?? entries[entries.length - 1]!;
    const created = entry.created_at;
    return `Version ${n} of ${total}, saved ${formatDateTime(created)}, +${entry.added} −${entry.removed}`;
  };
  const clamp = (n: number) => Math.max(1, Math.min(N, n));
  const query = new URLSearchParams(location.search);
  let a = clamp(Number(query.get("a")?.replace("v", "")) || N);
  let b = clamp(Number(query.get("b")?.replace("v", "")) || N);

  // --- bands ---
  const bands: HTMLElement[] = [];
  const totalHeight = versions.versions.reduce((sum, v) => sum + bandHeight(v.changed_chars), 0);
  const scale = Math.min(1, 380 / Math.max(totalHeight, 1));
  versions.versions.forEach((v, i) => {
    const band = el("div", {
      class: `band ${i % 2 === 0 ? "tone-a" : "tone-b"}`,
      "data-version": String(v.number),
    });
    band.style.height = `${Math.max(4, bandHeight(v.changed_chars) * scale)}px`;
    band.appendChild(el("span", { class: "band-number", text: String(v.number) }));
    strata.appendChild(band);
    bands.push(band);
    band.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      moveMarker(v.number);
    });
  });

  // --- slider ---
  const sliderLabel = el("div", { class: "visually-hidden", text: "Core sample", id: "core-sample-label" });
  const slider = el("input", {
    class: "slider-vertical",
    type: "range",
    min: "1",
    max: String(N),
    value: String(b),
    role: "slider",
  });
  slider.setAttribute("aria-label", "Core sample");
  slider.setAttribute("aria-valuetext", valueText(versions.versions, b, N));
  const stageRow = el("div", { style: "display: flex; gap: 8px" });
  stageRow.appendChild(stage);
  stageRow.appendChild(slider);
  wrap.appendChild(stageRow);
  stageRow.appendChild(sliderLabel);

  let restTimer: number | null = null;
  const moveMarker = (n: number) => {
    b = clamp(n);
    slider.value = String(b);
    slider.setAttribute("aria-valuetext", valueText(versions.versions, b, N));
    bands.forEach((band, i) => {
      const selected = versions.versions[i]!.number === b;
      band.setAttribute("data-selected", selected ? "true" : "false");
    });
    if (restTimer !== null) window.clearTimeout(restTimer);
    restTimer = window.setTimeout(() => {
      void preview.renderPen(penId, b, []);
      void updateCompare();
    }, 320);
    syncAddress();
  };

  slider.addEventListener("input", () => {
    moveMarker(Number(slider.value));
  });
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveMarker(b + 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveMarker(b - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveMarker(1);
    } else if (e.key === "End") {
      e.preventDefault();
      moveMarker(N);
    } else if (e.key === "Enter") {
      e.preventDefault();
      a = b;
      syncAddress();
      void updateCompare();
    }
  });

  const syncAddress = () => {
    const target = `?a=v${a}&b=v${b}`;
    history.replaceState(null, "", target);
  };

  // --- compare ---
  const updateCompare = async () => {
    const diff = await Api.get<DiffResponse>(`/api/pens/${penId}/diff?a=${a}&b=${b}`);
    compare.innerHTML = "";
    compare.appendChild(el("h3", { text: `Comparing version ${a} with version ${b}` }));
    const counts = el("p", { class: "diff-count", text: `+${diff.added} −${diff.removed}` });
    compare.appendChild(counts);
    for (const pane of ["html", "css", "js"] as const) {
      const region = el("div", { role: "region", "aria-label": `${pane.toUpperCase()} changes`, class: "pane-diff" });
      region.appendChild(el("p", { class: "diff-count", text: `+${diff.panes[pane].added} −${diff.panes[pane].removed}` }));
      const pre = el("pre");
      for (const row of diff.panes[pane].rows) {
        const div = el("div", { class: `row-${row.change}`, "data-change": row.change });
        div.textContent = row.text;
        pre.appendChild(div);
      }
      region.appendChild(pre);
      compare.appendChild(region);
    }
    // The compare counts tick from old to new values over the crossfade.
    tickCounts(compare, diff);
  };

  let oldCounts: { added: number; removed: number } | null = null;
  const tickCounts = (node: HTMLElement, diff: DiffResponse) => {
    const targets = Array.from(node.querySelectorAll(".diff-count"));
    const total = targets[0];
    if (total) {
      animateCount(total, oldCounts ?? diff, diff);
    }
    oldCounts = { added: diff.added, removed: diff.removed };
  };

  const animateCount = (node: Element, from: { added: number; removed: number }, to: { added: number; removed: number }) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      node.textContent = `+${to.added} −${to.removed}`;
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - start) / 600, 1);
      const added = Math.round(from.added + (to.added - from.added) * t);
      const removed = Math.round(from.removed + (to.removed - from.removed) * t);
      node.textContent = `+${added} −${removed}`;
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // --- restore ---
  const restoreBtn = button(`Restore version ${b}`, { class: "primary" });
  restoreBtn.addEventListener("click", async () => {
    try {
      const res = await Api.post<{ number: number }>(`/api/pens/${penId}/restore`, {
        version: b,
        base_version: pen.head,
      }, randomKey());
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const go = () => {
        navigate(`/pen/${penId}`);
        window.setTimeout(() => {
          const s = document.querySelector('[aria-label="Save status"]');
          if (s) s.textContent = `Restored version ${b} as version ${res.number}`;
        }, 300);
      };
      if (reduced) {
        go();
      } else {
        // the new top band grows in from zero height, then the editor opens
        const newBand = el("div", { class: "band tone-a", "data-version": String(res.number) });
        newBand.style.height = "0px";
        newBand.style.transition = `height ${320}ms ease-out`;
        strata.appendChild(newBand);
        requestAnimationFrame(() => {
          newBand.style.height = `${Math.max(4, bandHeight(0) * scale)}px`;
        });
        setTimeout(go, 320);
      }
    } catch (err) {
      const e = err as { error: string; head?: number };
      if (e.error === "unverified") {
        historyStatus.textContent = unverifiedCopy(user);
      } else if (e.error === "storage_unavailable") {
        historyStatus.textContent = `Storage is unreachable, so version ${b} was not restored.`;
      } else if (e.error === "version_conflict") {
        historyStatus.textContent = `Version ${e.head} of this pen was saved somewhere else.`;
      }
    }
  });

  const backLink = link(`/pen/${penId}`, "Back to editor");
  body.appendChild(compare);
  body.appendChild(restoreBtn);
  body.appendChild(backLink);
  body.appendChild(historyStatus);
  col.appendChild(body);
  wrap.appendChild(col);
  root.appendChild(wrap);

  const updateRestore = () => {
    const isHead = b === pen.head;
    restoreBtn.textContent = `Restore version ${b}`;
    restoreBtn.setAttribute("hidden", isHead ? "true" : "false");
  };


  moveMarker(b);
  updateRestore();
  const markerObserver = () => updateRestore();
  slider.addEventListener("change", markerObserver);
  slider.addEventListener("input", markerObserver);

  void pen;
  void config;
}

function bandHeight(changedChars: number): number {
  return 6 + 4 * Math.log2(1 + changedChars);
}

function randomKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
