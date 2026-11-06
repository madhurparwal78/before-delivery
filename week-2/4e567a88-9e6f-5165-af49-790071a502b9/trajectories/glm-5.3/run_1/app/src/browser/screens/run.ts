// The Run screen: catalogue rail, ribbon, schema-generated form, queue lanes, lineage.
import type { AppCtx } from "../main.js";
import type { Job, Meter, Model, Asset, SchemaField } from "../types.js";
import { api, h, clear, notice, alertNotice, uploadImage, openDialog } from "../lib.js";
import { Ribbon, formatDateLong } from "../ribbon.js";
import { openJobDialog } from "../jobdialog.js";
import { estimatedUnits, modelBySlug, unitString } from "../../shared/models.js";
import { microForUnits } from "../../shared/money.js";

interface RunState {
  models: Model[];
  selected: string | null;
  meter: Meter | null;
  timer: number | null;
  render(): void;
}

let activeState: RunState | null = null;

export function renderRun(ctx: AppCtx): void {
  const { main } = ctx;
  clear(main);
  if (activeState?.timer) window.clearInterval(activeState.timer);

  const ribbon = new Ribbon((text) => announce(text));
  const state: RunState = { models: [], selected: null, meter: null, timer: null, render: () => undefined };
  activeState = state;

  const cataloguePanel = h("nav", { class: "catalogue catalogue-panel", role: "region", "aria-label": "Catalogue" });
  const meterHost = h("div", {}, ribbon.build());
  const formHost = h("div", {});
  const queueHost = h("div", {});
  const runGrid = h("div", { class: "run-grid" }, formHost, queueHost);
  const lineageStrip = h("div", { class: "lineage-strip", role: "region", "aria-label": "Lineage" });
  const mainCol = h("div", { class: "main-col" }, meterHost, runGrid,
    h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Lineage" })), lineageStrip));
  const wideLayout = h("div", { class: "screen-grid" }, cataloguePanel, mainCol);

  const catalogueBtn = h("button", {
    class: "btn btn-ghost only-narrow", text: "Catalogue", style: "margin-bottom:14px",
    onclick: () => openCatalogueDialog(),
  });
  main.append(h("div", { class: "screen-title" }, h("h1", { text: "Run" })), catalogueBtn, wideLayout);

  function announce(text: string): void {
    const region = document.querySelector('.credit-meter [role="status"][aria-live="polite"]');
    if (region) (region as HTMLElement).textContent = text;
  }

  function renderCatalogueList(host: HTMLElement, onPick?: () => void): void {
    clear(host);
    const groups: { modality: Model["modality"]; label: string }[] = [
      { modality: "image", label: "Image" },
      { modality: "video", label: "Video" },
      { modality: "audio", label: "Audio" },
    ];
    for (const g of groups) {
      const models = state.models.filter((m) => m.modality === g.modality);
      if (models.length === 0) continue;
      host.append(h("h3", { text: g.label }));
      for (const m of models) {
        const blocked = m.access?.playground === "blocked";
        const unitNoun = m.unit === "image" ? "image" : m.unit_label.replace(/s$/, "");
        host.appendChild(h("button", {
          class: blocked ? "blocked" : "",
          "aria-pressed": String(state.selected === m.slug && !blocked),
          disabled: blocked ? true : undefined,
          onclick: () => {
            if (blocked) return;
            state.selected = m.slug;
            renderCatalogueList(cataloguePanel);
            state.render();
            onPick?.();
            focusFirstFormField();
          },
        },
          h("span", { text: m.name }),
          blocked ? h("span", { class: "blocked-mark", text: "Blocked for playground" }) : null,
          h("span", { class: "meta", text: `${m.unit_label} · ${(m.current_rate.micro_per_unit / 1_000_000).toFixed(6)} credits per ${unitNoun}` }),
        ));
      }
    }
  }

  function openCatalogueDialog(): void {
    let handle: { close(): void } | null = null;
    const body = h("nav", { "aria-label": "Catalogue" });
    renderCatalogueList(body, () => handle?.close());
    handle = openDialog({
      label: "Catalogue",
      build(root) {
        root.append(
          h("header", {}, h("h2", { text: "Catalogue" }),
            h("button", { class: "btn btn-ghost", text: "Close", onclick: () => handle?.close() })),
          h("div", { class: "dialog-body" }, body),
        );
      },
    });
  }

  // ---- the run form, generated from the selected model's schema ----
  let fieldEls: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};

  function currentInput(model: Model): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of model.input_schema) {
      const el = fieldEls[f.name];
      if (!el) continue;
      if (f.type === "integer" || f.type === "enum") {
        const v = (el as unknown as HTMLSelectElement).value;
        if (v !== "") out[f.name] = Number(v);
      } else {
        const v = (el as unknown as HTMLInputElement).value;
        out[f.name] = f.required || v !== "" ? v : null;
      }
    }
    return out;
  }

  function focusFirstFormField(): void {
    const first = formHost.querySelector("input, select, textarea") as HTMLElement | null;
    if (first) first.focus();
  }

  function renderForm(): void {
    clear(formHost);
    fieldEls = {};
    const model = state.models.find((m) => m.slug === state.selected);
    if (!model) {
      formHost.append(h("div", { class: "panel" },
        h("div", { class: "empty-note", text: "Choose a model from the catalogue to run it." })));
      return;
    }
    const estimateEl = h("span", { class: "num" });
    const updateEstimate = () => {
      const def = modelBySlug(model.slug);
      if (!def) return;
      const u = estimatedUnits(def, currentInput(model));
      const micro = microForUnits(u.num, u.den, model.current_rate.micro_per_unit);
      estimateEl.textContent = `Estimated ${(micro / 1_000_000).toFixed(2)} credits for ${unitString(u)} ${model.unit_label}`;
    };
    const form = h("form", {
      "aria-label": `Run ${model.name}`,
      onsubmit: (e: Event) => void submitRun(e, model),
    },
      model.input_schema.map((f) => fieldFor(f)),
      h("div", { class: "form-actions" },
        h("button", { class: "btn", type: "submit", text: "Run" }),
        estimateEl,
      ),
    );
    form.addEventListener("input", updateEstimate);
    formHost.append(h("section", { class: "panel" },
      h("header", {}, h("h2", { text: `Run ${model.name}` })),
      h("div", { class: "panel-body" }, form),
    ));
    updateEstimate();
  }

  function fieldFor(f: SchemaField): HTMLElement {
    const wrap = h("div", { class: "field" });
    const label = h("label", {}, f.title, f.required ? h("span", { class: "required-mark", text: " Required" }) : null);
    const errEl = h("span", { class: "err" });
    if (f.type === "media") {
      const input = h("input", { type: "text" }) as HTMLInputElement;
      input.dataset.field = f.name;
      const uploadBtn = h("button", {
        class: "btn btn-ghost", type: "button", text: `Upload image for ${f.title}`,
        onclick: () => {
          const fileInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" }) as HTMLInputElement;
          fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (!file) return;
            uploadBtn.textContent = "Uploading…";
            const res = await uploadImage(file);
            uploadBtn.textContent = `Upload image for ${f.title}`;
            if (res.status === 201) {
              const asset = res.body.asset as Asset;
              input.value = `asset:${asset.id}`;
              notice(`Uploaded ${file.name}.`);
              input.dispatchEvent(new Event("input", { bubbles: true }));
            } else if (res.status === 413) alertNotice("That file is larger than the upload limit.");
            else if (res.status === 415) alertNotice("Use a PNG, JPEG or WebP image.");
            else if (res.status === 503) alertNotice("Storage is unreachable. Try the upload again when it returns.");
            else alertNotice(res.body.error?.message ?? "The upload failed.");
          });
          fileInput.click();
        },
      });
      const clearBtn = h("button", { class: "btn btn-ghost", type: "button", text: `Clear ${f.title}`, onclick: () => { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); } });
      wrap.append(label, h("div", { class: "media-field-row" }, input, uploadBtn, clearBtn),
        h("span", { class: "help", text: f.description }), errEl);
      fieldEls[f.name] = input;
      return wrap;
    }
    let el: HTMLElement;
    if (f.type === "enum") {
      const select = h("select") as HTMLSelectElement;
      for (const opt of f.enum ?? []) select.append(h("option", { value: String(opt), text: String(opt) }));
      select.value = String(f.default ?? (f.enum ?? [])[0] ?? "");
      el = select;
    } else if (f.type === "integer") {
      el = h("input", { type: "number", min: f.minimum, max: f.maximum, step: "1" });
      (el as HTMLInputElement).value = String(f.default ?? f.minimum ?? 0);
    } else if (f.type === "string" && (f.max_length ?? 0) > 200) {
      el = h("textarea");
    } else {
      el = h("input", { type: "text" });
      (el as HTMLInputElement).value = String(f.default ?? "");
    }
    (el as HTMLElement).dataset.field = f.name;
    wrap.append(label, el, h("span", { class: "help", text: f.description }), errEl);
    fieldEls[f.name] = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    return wrap;
  }

  async function submitRun(e: Event, model: Model): Promise<void> {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const btn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const errors: Record<string, string> = {};
    const values = currentInput(model);
    for (const f of model.input_schema) {
      const v = values[f.name];
      if (f.required && (v === undefined || v === null || v === "")) errors[f.name] = "Required.";
      else if (f.type === "string" && typeof v === "string" && f.max_length && [...v].length > f.max_length) errors[f.name] = `Use at most ${f.max_length} characters.`;
      else if (f.type === "integer" && (v === null || v === undefined)) errors[f.name] = "Enter a whole number.";
    }
    formHost.querySelectorAll(".field").forEach((el) => el.classList.remove("has-error"));
    const invalid = Object.keys(errors);
    if (invalid.length > 0) {
      for (const name of invalid) {
        const field = formHost.querySelector(`[data-field="${name}"]`)?.closest(".field");
        field?.classList.add("has-error");
        const err = field?.querySelector(".err");
        if (err) err.textContent = errors[name];
      }
      alertNotice("Fix the highlighted fields.");
      (formHost.querySelector(`[data-field="${invalid[0]}"]`) as HTMLElement | null)?.focus();
      return;
    }
    formHost.querySelectorAll(".field .err").forEach((el) => (el.textContent = ""));
    btn.textContent = "Submitting…";
    btn.disabled = true;
    const key = crypto.randomUUID();
    const send = () => api<{ job: Job }>("POST", "/api/jobs", { model: model.slug, input: values }, { headers: { "Idempotency-Key": key } });
    let res = await send();
    if (res.status === 0) res = await send();
    btn.textContent = "Run";
    btn.disabled = false;
    const replayed = res.headers["idempotent-replayed"] === "true";
    if (res.status === 201) {
      notice(replayed
        ? `Job ${res.body.job.id} was already submitted; nothing new was reserved.`
        : `Job ${res.body.job.id} queued — ${(res.body.job.reserved_micro / 1_000_000).toFixed(2)} credits reserved.`);
      void refresh();
    } else if (res.status === 402) {
      const body = res.body as unknown as { required_micro: number; available_micro: number };
      alertNotice(`Not enough credits: this run needs ${(body.required_micro / 1_000_000).toFixed(2)} and ${(body.available_micro / 1_000_000).toFixed(2)} are available.`);
    } else if (res.status === 429) {
      const body = res.body as unknown as { period_ends_at?: string };
      alertNotice(`${teamName(ctx)} reached its hard cap for ${state.meter?.period.label ?? "this period"}. New jobs are throttled until ${body.period_ends_at ? formatDateLong(new Date(body.period_ends_at)) : "the period end"}.`);
    } else if (res.status === 403) {
      alertNotice(`${model.name} is blocked for playground runs in ${teamName(ctx)}.`);
    } else if (res.status === 503) {
      alertNotice("Storage is unreachable, so the image could not be saved. Nothing was reserved.");
    } else if (res.status === 422) {
      const body = res.body as unknown as { error: { fields?: Record<string, string> } };
      for (const [path, msg] of Object.entries(body.error.fields ?? {})) {
        const name = path.replace("input.", "");
        const field = formHost.querySelector(`[data-field="${name}"]`)?.closest(".field");
        field?.classList.add("has-error");
        const err = field?.querySelector(".err");
        if (err) err.textContent = msg;
      }
      alertNotice("Fix the highlighted fields.");
    } else {
      alertNotice((res.body as unknown as { error: { message: string } }).error?.message ?? "The run failed.");
    }
  }

  // ---- queue lanes ----
  let queuePanel: HTMLElement | null = null;
  function renderQueueSkeleton(): void {
    clear(queueHost);
    queuePanel = h("section", { class: "panel", role: "region", "aria-label": "Queue" },
      h("header", {}, h("h2", { text: "Queue" })));
    for (const m of state.models) {
      queuePanel.append(h("div", { class: "lane" },
        h("div", { class: "lane-head" }, h("span", { text: m.name })),
        h("ul", { "aria-label": `${m.name} lane` }),
      ));
    }
    queueHost.append(queuePanel);
  }

  async function fillQueue(): Promise<void> {
    const res = await api<{ lanes: { model: string; queued: Job[]; running: Job[] }[] }>("GET", "/api/queue");
    if (res.status !== 200 || !queuePanel) return;
    for (const lane of res.body.lanes) {
      const list = queuePanel.querySelector(`ul[aria-label="${lane.model} lane"]`) as HTMLElement | null;
      if (!list) continue;
      clear(list);
      for (const job of [...lane.running, ...lane.queued]) {
        const li = h("li", {},
          h("button", {
            class: "lane-open", text: laneItemText(job), "aria-label": `Open job ${job.id}`,
            onclick: () => openJobDialog(job.id),
          }),
          h("button", {
            class: "lane-cancel", text: "Cancel", "aria-label": `Cancel job ${job.id}`,
            onclick: async (e: Event) => {
              const btn = e.target as HTMLButtonElement;
              btn.textContent = "Cancelling…";
              btn.disabled = true;
              const r = await api<{ job: Job }>("POST", `/api/jobs/${job.id}/cancel`);
              if (r.status === 200) {
                notice(`Job ${job.id} cancelled; ${(r.body.job.released_micro / 1_000_000).toFixed(2)} credits released.`);
                void refresh();
              } else {
                alertNotice(r.body.error?.message ?? "Nothing to cancel.");
                btn.textContent = "Cancel";
                btn.disabled = false;
              }
            },
          }),
        );
        if (job.waiting_reason) li.appendChild(h("span", { class: "waiting", text: "Waiting for storage" }));
        list.appendChild(li);
      }
    }
  }

  function laneItemText(job: Job): string {
    if (job.status === "queued") return `${job.id} · queued #${job.queue_position}`;
    const started = job.started_at ? new Date(job.started_at).getTime() : Date.now();
    return `${job.id} · ${job.status} · ${Math.max(0, Math.floor((Date.now() - started) / 1000))}s`;
  }

  // ---- lineage strip ----
  async function renderLineage(): Promise<void> {
    const res = await api<{ assets: Asset[] }>("GET", "/api/assets?kind=output");
    if (res.status !== 200) return;
    clear(lineageStrip);
    const assets = res.body.assets.slice(0, 20);
    if (assets.length === 0) {
      lineageStrip.append(h("div", { class: "empty-note", text: "No outputs yet." }));
      return;
    }
    const row = h("div", { class: "lineage-row" });
    const derivedFrom = new Set<string>();
    for (const a of assets) for (const from of a.derived_from ?? []) derivedFrom.add(from);
    const order: Asset[] = [];
    for (const a of assets) {
      if (!derivedFrom.has(a.id) || !assets.some((b) => (b.derived_from ?? []).includes(a.id))) order.push(a);
    }
    for (const a of assets) if (!order.includes(a)) order.push(a);
    for (const a of order) {
      row.appendChild(lineageNode(a));
    }
    lineageStrip.appendChild(row);
  }

  function lineageNode(asset: Asset): HTMLElement {
    const btn = h("button", { class: "lineage-node", "aria-label": `Asset ${asset.id}`,
      onclick: () => void centerLineage(asset.id) });
    btn.appendChild(mediaMark(asset.media_type, asset.url));
    btn.appendChild(h("span", { class: "node-id", text: asset.id }));
    return btn;
  }

  async function centerLineage(assetId: string): Promise<void> {
    const res = await api<{ nodes: Record<string, unknown>[]; edges: { from: string; to: string }[] }>("GET", `/api/assets/${assetId}/lineage`);
    if (res.status !== 200) return;
    clear(lineageStrip);
    const row = h("div", { class: "lineage-row" });
    const toMap = new Map<string, string[]>();
    for (const e of res.body.edges) toMap.set(e.from, [...(toMap.get(e.from) ?? []), e.to]);
    const emitted = new Set<string>();
    const place = (id: string): void => {
      if (emitted.has(id)) return;
      emitted.add(id);
      const node = res.body.nodes.find((n) => n.id === id);
      if (!node) return;
      for (const target of toMap.get(id) ?? []) place(target);
      row.appendChild(nodeEl(node));
    };
    for (const n of res.body.nodes) place(n.id as string);
    lineageStrip.appendChild(row);
  }

  function nodeEl(node: Record<string, unknown>): HTMLElement {
    const id = node.id as string;
    if (node.state === "tombstone") {
      return h("button", { class: "lineage-node tombstone", "aria-label": `Removed asset ${id}`, disabled: true },
        h("span", { class: "tombstone-label", text: `Removed ${node.removed_at ? formatDateLong(new Date(node.removed_at as string)) : ""} (${node.reason as string})` }),
        h("span", { class: "node-id", text: id }),
      );
    }
    const btn = h("button", { class: "lineage-node", "aria-label": `Asset ${id}` });
    btn.appendChild(mediaMark(node.media_type as string, node.thumbnail_url as string | undefined));
    btn.appendChild(h("span", { class: "node-id", text: id }));
    return btn;
  }

  function mediaMark(mediaType: string, url?: string): HTMLElement {
    if (mediaType.startsWith("image/")) return h("img", { src: url ?? "", alt: "" });
    if (mediaType.startsWith("video/")) return h("span", { class: "media-glyph", text: "▶" });
    return h("span", { class: "media-glyph", text: "♪" });
  }

  async function refresh(): Promise<void> {
    const team = ctx.selectedTeam();
    if (!team) return;
    const meterRes = await api<Meter>("GET", `/api/teams/${team}/meter`);
    if (meterRes.status === 200) {
      state.meter = meterRes.body;
      ribbon.update(meterRes.body, (jobId) => openJobDialog(jobId));
    }
    await fillQueue();
    await renderLineage();
  }

  state.render = () => {
    renderCatalogueList(cataloguePanel);
    renderForm();
    renderQueueSkeleton();
    void fillQueue();
  };

  void api<{ models: Model[] }>("GET", "/api/models").then((res) => {
    if (res.status !== 200) return;
    state.models = res.body.models;
    state.selected ??= state.models.find((m) => m.access?.playground !== "blocked")?.slug ?? null;
    applyUseAsInput();
    state.render();
    void refresh();
  });

  /** An asset chosen with "Use as input" fills the first media field. */
  function applyUseAsInput(): void {
    const assetId = window.sessionStorage.getItem("dispatch-use-as-input");
    if (!assetId) return;
    window.sessionStorage.removeItem("dispatch-use-as-input");
    const current = state.models.find((m) => m.slug === state.selected);
    const hasMedia = current?.input_schema.some((f) => f.type === "media") ?? false;
    if (!hasMedia) {
      const reel = state.models.find((m) => m.slug === "reel-10" && m.access?.playground !== "blocked");
      if (reel) state.selected = reel.slug;
    }
    state.render();
    const model = state.models.find((m) => m.slug === state.selected);
    const mediaField = model?.input_schema.find((f) => f.type === "media");
    if (mediaField) {
      const el = formHost.querySelector(`[data-field="${mediaField.name}"]`) as HTMLInputElement | null;
      if (el) {
        el.value = `asset:${assetId}`;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  state.timer = window.setInterval(() => void refresh(), 2000);
}

function teamName(ctx: AppCtx): string {
  const team = ctx.teams.find((t) => t.id === ctx.member.team_id);
  return team?.name ?? "your team";
}
