import { api, announce, el, qs, qsa, motion, fmtDate, ApiFail } from "../core.js";
import { dialogs } from "../dialogs.js";
import { autoRefresh, mintTile } from "./pieces.js";

type Job = { id: string; pieceId: string; pieceTitle: string; bench: "frame" | "cover"; day: string; dayLabel: string; glue: { laidAt: string; curesAt: string; state: string; label: string } | null };
type Piece = { id: string; title: string; state: string };

const benchLabel = (b: string): string => (b === "frame" ? "Frame bench" : "Cover bench");

export async function installBench(root: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  let week = params.get("week") ?? "";
  let jobs: Job[] = [];

  const load = async (): Promise<void> => {
    const res = await api<{ week: string; jobs: Job[] }>(`/api/bench-jobs${week ? `?week=${week}` : ""}`);
    week = res.week;
    jobs = res.jobs;
    render();
  };

  const render = (): void => {
    const days = weekDays(week);
    root.innerHTML = `<div class="bento bench-grid">
      <div class="tile wide bench-tile">
        <nav class="week-nav"><a href="#" id="earlier-week">Earlier week</a> <a href="#" id="later-week">Later week</a></nav>
        <div id="bench-grid" class="bench-grid-inner" role="grid" aria-label="Bench week">
          <div class="bench-corner" role="presentation"></div>
          ${days.map((d) => `<div class="day-head" role="columnheader">${fmtDate(d)}</div>`).join("")}
          ${["frame", "cover"].map((bench) => `${days.map((d, i) => {
            const job = jobs.find((j) => j.bench === bench && j.day === d);
            const cellRole = i === 0 ? "rowheader" : "gridcell";
            return `${i === 0 ? `<div class="bench-head" role="rowheader">${benchLabel(bench)}</div>` : ""}<div class="bench-cell" role="${cellRole}" data-bench="${bench}" data-day="${d}" tabindex="0">
              ${job ? `<div class="job-card" data-part="job-card" data-job="${job.id}" tabindex="0">${job.pieceTitle}
                <button class="move-btn">Move ${job.pieceTitle} to…</button>
                <button class="glue-btn" ${job.bench !== "frame" ? "hidden" : ""}>Glue laid</button>
              </div>` : ""}
            </div>`;
          }).join("")}`).join("")}
        </div>
        <p id="agenda" class="agenda"></p>
      </div>
      ${mintTile(String(jobs.length), "jobs this week")}
    </div>`;
    const agenda = qs("#agenda", root)!;
    agenda.innerHTML = `<table><thead><tr><th>Day</th><th>Bench</th><th>Job</th><th>Glue</th></tr></thead><tbody>
      ${jobs.map((j) => `<tr><td>${j.dayLabel}</td><td>${benchLabel(j.bench)}</td><td>${j.pieceTitle}</td><td>${j.glue ? j.glue.label : ""}</td></tr>`).join("")}
    </tbody></table>`;
    qs("#earlier-week", root)!.addEventListener("click", (e) => {
      e.preventDefault();
      week = shiftWeek(week, -7);
      history.pushState({}, "", `/bench?week=${week}`);
      void load();
    });
    qs("#later-week", root)!.addEventListener("click", (e) => {
      e.preventDefault();
      week = shiftWeek(week, 7);
      history.pushState({}, "", `/bench?week=${week}`);
      void load();
    });
    qsa(".bench-cell", root).forEach((cell) => {
      cell.addEventListener("keydown", (e) => {
        const cells = qsa(".bench-cell", root);
        const idx = cells.indexOf(cell);
        if (e.key === "ArrowRight" && idx % 5 < 4) { e.preventDefault(); cells[idx + 1]!.focus(); }
        else if (e.key === "ArrowLeft" && idx % 5 > 0) { e.preventDefault(); cells[idx - 1]!.focus(); }
        else if (e.key === "ArrowDown" && idx + 5 < cells.length) { e.preventDefault(); cells[idx + 5]!.focus(); }
        else if (e.key === "ArrowUp" && idx - 5 >= 0) { e.preventDefault(); cells[idx - 5]!.focus(); }
        else if (e.altKey) {
          const card = qs(".job-card", cell) as HTMLElement | null;
          if (!card) return;
          const job = jobs.find((j) => j.id === card.dataset.job)!;
          const dayIdx = days.indexOf(cell.dataset.day!);
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            const delta = e.key === "ArrowLeft" ? -1 : 1;
            if (dayIdx + delta < 0 || dayIdx + delta > 4) {
              announce("No more days this week. Use Move to….");
              return;
            }
            void moveJob(job, job.bench, days[dayIdx + delta]!);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const other = job.bench === "frame" ? "cover" : "frame";
            void moveJob(job, other, job.day);
          }
        }
      });
    });
    qsa(".job-card", root).forEach((card) => {
      let dragging = false;
      const job = jobs.find((j) => j.id === card.dataset.job)!;
      card.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "mouse") return;
        dragging = true;
        card.setPointerCapture(e.pointerId);
      });
      card.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        card.style.transform = `translate(${e.movementX}px, ${e.movementY}px)`;
      });
      card.addEventListener("pointerup", (e) => {
        if (!dragging) return;
        dragging = false;
        card.style.transform = "";
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest(".bench-cell") as HTMLElement | null;
        if (target && (target.dataset.bench !== job.bench || target.dataset.day !== job.day)) {
          void moveJob(job, target.dataset.bench as "frame" | "cover", target.dataset.day!);
        } else if (!motion.reduced) {
          motion.animate(card, { transform: `translate(${e.movementX}px, ${e.movementY}px)` }, { transform: "translate(0,0)" }, 160);
        }
      });
      card.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && dragging) {
          dragging = false;
          card.style.transform = "";
        }
      });
      qs(".move-btn", card)?.addEventListener("click", () => {
        dialogs.openDialog(`Move ${job.pieceTitle} to…`, `
          <label>Day<input name="day" value="${job.day}"></label>
          <label>Bench<select name="bench" aria-label="Bench"><option value="frame" ${job.bench === "frame" ? "selected" : ""}>Frame bench</option><option value="cover" ${job.bench === "cover" ? "selected" : ""}>Cover bench</option></select></label>`,
          async (form) => {
            await api(`/api/bench-jobs/${job.id}`, { method: "PATCH", json: { bench: (form.elements.namedItem("bench") as HTMLSelectElement).value, day: (form.elements.namedItem("day") as HTMLInputElement).value } });
            announce(`${job.pieceTitle} moved to ${benchLabel((form.elements.namedItem("bench") as HTMLSelectElement).value)} on ${fmtDate((form.elements.namedItem("day") as HTMLInputElement).value)}.`);
            dialogs.closeDialog();
            await load();
          });
      });
      qs(".glue-btn", card)?.addEventListener("click", () => {
        dialogs.openDialog("Glue laid", `
          <label>Date<input name="date" value="${job.day}"></label>
          <label>Time<input name="time" placeholder="HH:MM"></label>`,
          async (form) => {
            const res = await api<{ job: Job }>(`/api/bench-jobs/${job.id}/glue`, {
              method: "POST",
              json: { date: (form.elements.namedItem("date") as HTMLInputElement).value, time: (form.elements.namedItem("time") as HTMLInputElement).value },
            });
            announce(res.job.glue?.label ?? "Glue laid.");
            dialogs.closeDialog();
            await load();
          });
      });
    });
  };

  const moveJob = async (job: Job, bench: "frame" | "cover", day: string): Promise<void> => {
    try {
      await api(`/api/bench-jobs/${job.id}`, { method: "PATCH", json: { bench, day } });
      announce(`${job.pieceTitle} moved to ${benchLabel(bench)} on ${fmtDate(day)}.`);
      await load();
      const cells = qsa(".bench-cell", root);
      const target = cells.find((c) => c.dataset.bench === bench && c.dataset.day === day);
      (target?.querySelector(".job-card") as HTMLElement | null)?.focus();
    } catch (e) {
      if (e instanceof ApiFail) {
        announce(e.message);
        const focused = document.activeElement as HTMLElement | null;
        focused?.focus();
      }
    }
  };

  const bar = qs("#bottom-bar");
  if (bar) {
    bar.innerHTML = `<button class="primary" id="add-job">Add job</button>`;
    qs("#add-job", bar)!.addEventListener("click", async () => {
      const pieces = await api<{ pieces: Piece[] }>("/api/pieces");
      dialogs.openDialog("Add job", `
        <label>Piece<select name="pieceId" aria-label="Piece">${pieces.pieces.filter((p) => p.state !== "archived").map((p) => `<option value="${p.id}">${p.title}</option>`).join("")}</select></label>
        <label>Bench<select name="bench" aria-label="Bench"><option value="frame">Frame bench</option><option value="cover">Cover bench</option></select></label>
        <label>Day<input name="day" value="${weekDays(week)[0]}"></label>`,
        async (form) => {
          const bench = (form.elements.namedItem("bench") as HTMLSelectElement).value;
          const day = (form.elements.namedItem("day") as HTMLInputElement).value;
          const pieceId = (form.elements.namedItem("pieceId") as HTMLSelectElement).value;
          const piece = pieces.pieces.find((p) => p.id === pieceId)!;
          await api("/api/bench-jobs", { method: "POST", json: { pieceId, bench, day } });
          announce(`${piece.title} added to ${benchLabel(bench)} on ${fmtDate(day)}.`);
          dialogs.closeDialog();
          await load();
        });
    });
  }

  await load();
  autoRefresh(load);
  void el;
}

const weekDays = (monday: string): string[] => [0, 1, 2, 3, 4].map((i) => shiftWeek(monday, i));
const shiftWeek = (monday: string, days: number): string => {
  const d = new Date(`${monday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
