// The job screens: the board with its frames and tools, the script, the Slate
// strip, lines, cues, cuts, compare, notes, delivery and the fee letter.

import { el, link, type ScreenContext, heading, workingButton, field, fileField } from "../lib/ui";
import { ApiError, type Json } from "../lib/state";
import { api } from "../lib/ui";

export async function buildBoard(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const h = el("h1", {});
  const boardEl = el("div", { role: "listbox", "aria-label": "Board", class: "board-grid" });
  const uploads = el("ul", { "aria-label": "Uploads", class: "uploads" });
  const tools = el("div", { role: "group", "aria-label": "Frame tools", class: "frame-tools" });
  const framesField = fileField({ name: "Frame files", multiple: "" });
  let job: Json = {};

  async function load(): Promise<void> {
    job = await api.get(`/api/jobs/${jobId}`);
    h.textContent = String(job.title);
    const board = await api.get(`/api/jobs/${jobId}/board`);
    boardEl.replaceChildren();
    for (const frame of (board.frames as Json[]) ?? []) {
      const option = el("div", {
        role: "option",
        "aria-label": `Frame ${String(frame.number)}`,
        "data-part": "board-frame",
        "data-frame": String(frame.number),
        "data-position": String(frame.position),
        class: "board-frame",
        tabindex: "0",
      }, el("p", {}, `Frame ${String(frame.number)}`));
      boardEl.append(option);
    }
  }
  await load();

  framesField.addEventListener("change", async () => {
    const files = Array.from(framesField.files ?? []);
    for (const file of files) {
      const row = el("li", { class: "upload-row" }, el("span", { class: "upload-state" }, "Working…"));
      uploads.append(row);
      const body = new FormData();
      body.append("file", file);
      try {
        const answer = await fetch(`/api/jobs/${jobId}/frames`, { method: "POST", body });
        if (answer.ok) {
          row.textContent = `${file.name}: Stored.`;
          ctx.announcer.announce(`${file.name}: Stored.`);
        } else {
          const error = (await answer.json()) as { error?: { message?: string } };
          row.textContent = `${file.name}: ${error.error?.message ?? ""}`;
          ctx.announcer.announce(`${file.name}: ${error.error?.message ?? ""}`);
        }
      } catch {
        row.textContent = `${file.name}: The file store is unavailable right now. Nothing was saved.`;
      }
    }
    await load();
  });

  const uploadButton = el("button", { type: "button", class: "primary" }, "Upload frames");
  uploadButton.addEventListener("click", () => framesField.click());

  const navigation = el("nav", { "aria-label": "This job", class: "job-nav" },
    link(`/desk/jobs/${jobId}`, "Board"),
    link(`/desk/jobs/${jobId}/script`, "Script"),
    link(`/desk/jobs/${jobId}/reel`, "Reel"),
    link(`/desk/jobs/${jobId}/lines`, "Lines"),
    link(`/desk/jobs/${jobId}/cues`, "Cues"),
    link(`/desk/jobs/${jobId}/cuts`, "Cuts"),
    link(`/desk/jobs/${jobId}/notes`, "Notes"),
    link(`/desk/jobs/${jobId}/delivery`, "Delivery"),
    link(`/desk/jobs/${jobId}/letter`, "Fee letter"),
  );

  const body = el("main", { class: "board" }, h, navigation, uploads, framesField, uploadButton, boardEl, tools);
  return { heading: h, body, refresh: load };
}

export async function buildScript(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Script for ${String(job.title)}`], ctx.announcer);
  const scriptField = fileField({ name: "Script file" });
  const preview = el("div", { role: "region", "aria-label": "Script preview", class: "table-frame", tabindex: "0" });
  const previewTable = el("table", {});
  preview.append(previewTable);

  scriptField.addEventListener("change", async () => {
    const file = scriptField.files?.[0];
    if (file === undefined) return;
    const body = new FormData();
    body.append("file", file);
    const answer = await fetch(`/api/jobs/${jobId}/script/preview`, { method: "POST", body });
    if (!answer.ok) {
      const error = (await answer.json()) as { error?: { message?: string } };
      ctx.announcer.announce(error.error?.message ?? "");
      return;
    }
    const parsed = (await answer.json()) as { rows?: { row: number; shot: string; result: string; reason: string | null }[] };
    previewTable.replaceChildren(el("thead", {}, el("tr", {}, el("th", {}, "Row"), el("th", {}, "Shot"), el("th", {}, "Result"))));
    const tbody = el("tbody", {});
    for (const row of parsed.rows ?? []) {
      tbody.append(el("tr", {}, el("td", {}, String(row.row)), el("td", {}, row.shot), el("td", {}, row.reason ?? row.result)));
    }
    previewTable.append(tbody);
    const refused = (parsed.rows ?? []).filter((r) => r.result === "refused").length;
    const matched = (parsed.rows ?? []).filter((r) => r.result === "matched").length;
    const fresh = (parsed.rows ?? []).length - refused - matched;
    ctx.announcer.announce(`Preview ready: ${fresh} new, ${matched} matched, ${refused} refused.`);
  });

  const save = workingButton("Save", async () => {
    const file = scriptField.files?.[0];
    if (file === undefined) {
      ctx.announcer.announce("Choose a script file first.");
      return;
    }
    const body = new FormData();
    body.append("file", file);
    const answer = await fetch(`/api/jobs/${jobId}/script`, { method: "POST", body });
    if (!answer.ok) {
      const error = (await answer.json()) as { error?: { message?: string } };
      ctx.announcer.announce(error.error?.message ?? "");
      return;
    }
    const parsed = (await answer.json()) as { created?: number; updated?: number };
    ctx.announcer.announce(`Script saved: ${parsed.created ?? 0} new, ${parsed.updated ?? 0} changed.`);
  }, "Working…");

  const body = el("main", { class: "script" }, h, scriptField, preview, save);
  return { heading: h, body, refresh: null };
}

export async function buildReelScreen(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Reel for ${String(job.title)}`], ctx.announcer);
  const strip = el("div", { role: "group", "aria-label": "Slate strip", "data-part": "slate-strip", class: "slate-strip" });
  const numerals = el("p", { "data-part": "timecode", class: "timecode" }, "00:00:00:00");
  const seconds = el("p", { "data-part": "seconds", class: "seconds" }, "0.00 s");
  const target = el("p", { "data-part": "target", class: "target" }, "");
  let board: Json = {};

  async function load(): Promise<void> {
    board = await api.get(`/api/jobs/${jobId}/board`);
    strip.replaceChildren();
    let position = 0;
    for (const frame of (board.frames as Json[]) ?? []) {
      const clip = el("button", {
        type: "button",
        "data-part": "clip",
        "data-frame": String(frame.number),
        "data-duration": String(frame.durationFrames),
        "aria-label": `Frame ${String(frame.number)}`,
        class: "clip",
      });
      clip.style.width = `${Number(frame.durationFrames) * 2}px`;
      strip.append(clip);
      position += Number(frame.durationFrames);
    }
    target.textContent = String(board.targetText ?? "");
    seconds.textContent = String(board.secondsText ?? "");
  }
  await load();

  const body = el("main", { class: "reel-screen" }, h, strip, numerals, seconds, target);
  return { heading: h, body, refresh: load };
}

export async function buildLines(ctx: ScreenContext, jobId: string, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Lines for ${String(job.title)}`], ctx.announcer);
  const listEl = el("ul", { class: "lines-list" });
  const text = field("input", { type: "text" });
  const save = workingButton("Save", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/lines`, { frame: 1, market: query.get("market") ?? "en", text: text.value, x: 10, y: 10, width: 60, height: 10, clips: 1 });
      ctx.announcer.announce("Line saved.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  async function load(): Promise<void> {
    const answer = await api.get(`/api/jobs/${jobId}/lines`);
    listEl.replaceChildren();
    for (const line of (answer.lines as Json[]) ?? []) {
      listEl.append(el("li", { "data-part": "line", "data-x": String(line.x), "data-y": String(line.y) }, String(line.text)));
    }
  }
  await load();

  const body = el("main", { class: "lines" }, h, listEl, el("label", {}, "Line text"), text, save);
  return { heading: h, body, refresh: load };
}

export async function buildCues(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Cues for ${String(job.title)}`], ctx.announcer);
  const listEl = el("ul", { class: "cue-list" });

  async function load(): Promise<void> {
    const answer = await api.get(`/api/jobs/${jobId}/cues`);
    listEl.replaceChildren();
    for (const cue of (answer.cues as Json[]) ?? []) {
      listEl.append(el("li", { class: "cue" }, `${String(cue.title)} — ${String(cue.licenceText)}`));
    }
  }
  await load();

  const add = workingButton("Add cue", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/cues`, { trackId: "hr-1001", market: "NL", from: "2027-03-01", until: "2027-03-31" });
      ctx.announcer.announce("Cue added.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const body = el("main", { class: "cues" }, h, listEl, add);
  return { heading: h, body, refresh: load };
}

export async function buildCuts(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Cuts for ${String(job.title)}`], ctx.announcer);
  const listEl = el("ul", { class: "cut-list" });
  const history = el("section", { role: "region", "aria-label": "Job history", class: "history" });
  const pages = el("section", { role: "region", "aria-label": "Private pages", class: "pages" });
  const films = el("section", { role: "region", "aria-label": "Preview films", class: "films" });

  async function load(): Promise<void> {
    const answer = await api.get(`/api/jobs/${jobId}/cuts`);
    listEl.replaceChildren();
    for (const cut of (answer.cuts as Json[]) ?? []) {
      listEl.append(el("li", { class: "cut" }, `Cut ${String(cut.number)} — ${String(cut.name)}`));
    }
    const events = await api.get(`/api/jobs/${jobId}/history`);
    history.replaceChildren();
    for (const event of (events.events as Json[]) ?? []) {
      history.append(el("p", {}, `${String(event.text)}`));
    }
    const renders = await api.get(`/api/jobs/${jobId}/renders`);
    films.replaceChildren();
    for (const render of (renders.renders as Json[]) ?? []) {
      films.append(el("p", {}, `Cut ${String(render.cut)} — ${renderStateText(String(render.state))}`));
    }
  }
  await load();

  const make = workingButton("Make cut", async () => {
    const name = window.prompt("Name") ?? "";
    if (name.trim().length === 0) {
      ctx.announcer.announce("Type a name.");
      return;
    }
    try {
      await api.post(`/api/jobs/${jobId}/cuts`, { name: name.trim() });
      ctx.announcer.announce("Cut made.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const body = el("main", { class: "cuts" }, h, listEl, make, films, pages, history);
  return { heading: h, body, refresh: load };
}

function renderStateText(state: string): string {
  switch (state) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "ready": return "Ready";
    case "outdated": return "Outdated";
    case "failed": return "Failed";
    case "done": return "Done";
    default: return state;
  }
}

export async function buildCompare(ctx: ScreenContext, jobId: string, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Compare cuts for ${String(job.title)}`], ctx.announcer);
  const differences = el("ul", { role: "list", "aria-label": "Differences", class: "differences" });
  const slider = field("input", { type: "range", "aria-label": "Wipe", min: "0", max: "100", value: query.get("wipe") ?? "50" }) as HTMLInputElement;
  slider.setAttribute("aria-valuetext", `${slider.value}%`);
  slider.addEventListener("change", () => {
    void ctx.router.go(`/desk/jobs/${jobId}/compare?a=1&b=2&wipe=${slider.value}`);
  });
  const a = Number(query.get("a") ?? "1");
  const b = Number(query.get("b") ?? "2");

  async function load(): Promise<void> {
    const answer = await api.get(`/api/jobs/${jobId}/compare?a=${a}&b=${b}`);
    differences.replaceChildren();
    for (const difference of (answer.differences as string[]) ?? []) {
      differences.append(el("li", {}, difference));
    }
  }
  await load();

  const body = el("main", { class: "compare" }, h, slider, differences);
  return { heading: h, body, refresh: load };
}

export async function buildNotes(ctx: ScreenContext, jobId: string, query: URLSearchParams): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/desk/jobs/${jobId}`);
  const h = heading([`Notes for ${String(job.title)}`], ctx.announcer);
  const rowsEl = el("tbody", {});
  const table = el("div", { class: "table-frame", role: "region", "aria-label": "Notes table", tabindex: "0" },
    el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Frame"), el("th", {}, "Text"), el("th", {}, "Producer"), el("th", {}, "State"))), rowsEl),
  );

  async function load(): Promise<void> {
    const params = new URLSearchParams();
    const state = query.get("state");
    if (state !== null) params.set("state", state);
    const answer = await api.get(`/api/jobs/${jobId}/notes?${params.toString()}`);
    rowsEl.replaceChildren();
    for (const note of (answer.notes as Json[]) ?? []) {
      rowsEl.append(el("tr", {},
        el("td", {}, String(note.frame)),
        el("td", {}, String(note.text)),
        el("td", {}, String(note.producerName)),
        el("td", {}, noteStateText(String(note.state))),
      ));
    }
  }
  await load();

  const body = el("main", { class: "notes" }, h, table);
  return { heading: h, body, refresh: load };
}

function noteStateText(state: string): string {
  switch (state) {
    case "open": return "Open";
    case "done": return "Done";
    case "wontDo": return "Won't do";
    default: return state;
  }
}

export async function buildDelivery(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Delivery for ${String(job.title)}`], ctx.announcer);
  const listEl = el("ul", { class: "package-list" });

  async function load(): Promise<void> {
    const answer = await api.get(`/api/jobs/${jobId}/packages`);
    listEl.replaceChildren();
    for (const pkg of (answer.packages as Json[]) ?? []) {
      const item = el("li", {}, `Cut ${String(pkg.cut)} — ${String(pkg.state)}`);
      for (const file of (pkg.files as Json[]) ?? []) {
        item.append(el("p", {}, el("a", { href: String(file.url) }, `Download ${fileKindText(String(file.kind))}`)));
      }
      listEl.append(item);
    }
  }
  await load();

  const make = workingButton("Make package", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/packages`, { cut: 1 });
      ctx.announcer.announce("Package ready.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const body = el("main", { class: "delivery" }, h, listEl, make);
  return { heading: h, body, refresh: load };
}

function fileKindText(kind: string): string {
  switch (kind) {
    case "boards": return "boards PDF";
    case "editDecisionList": return "edit decision list";
    case "shotList": return "shot list";
    default: return kind;
  }
}

export async function buildLetter(ctx: ScreenContext, jobId: string): Promise<{ heading: HTMLElement; body: HTMLElement; refresh: (() => Promise<void>) | null }> {
  const job = await api.get(`/api/jobs/${jobId}`);
  const h = heading([`Fee letter for ${String(job.title)}`], ctx.announcer);
  const currency = field("select", {});
  for (const code of ["EUR", "CAD", "USD"]) {
    currency.append(el("option", { value: code }, code));
  }
  const fee = field("input", { type: "text" });
  const scope = field("input", { type: "text" });
  const stateText = el("p", { class: "letter-state" });

  async function load(): Promise<void> {
    try {
      const letter = await api.get(`/api/jobs/${jobId}/letter`);
      stateText.textContent = String(letter.state);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        stateText.textContent = "";
      }
    }
  }
  await load();

  const save = workingButton("Save letter", async () => {
    try {
      await api.post(`/api/jobs/${jobId}/letter`, { currency: currency.value, fee: fee.value, scope: scope.value });
      ctx.announcer.announce("Letter saved.");
      await load();
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const send = workingButton("Send letter", async () => {
    try {
      const letter = await api.get(`/api/jobs/${jobId}/letter`);
      await api.post(`/api/letters/${String(letter.id)}/send`, { producerId: "" });
      ctx.announcer.announce("Fee page ready.");
    } catch (e) {
      if (e instanceof ApiError) ctx.announcer.announce(e.message);
    }
  }, "Working…");

  const body = el("main", { class: "letter" }, h,
    el("label", {}, "Currency"), currency,
    el("label", {}, "Fee"), fee,
    el("label", {}, "Scope"), scope,
    stateText, save, send,
  );
  return { heading: h, body, refresh: load };
}
