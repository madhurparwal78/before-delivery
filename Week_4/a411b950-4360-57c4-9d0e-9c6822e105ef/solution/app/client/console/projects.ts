import { byId, request } from "../lib/api.js";
import { openDialog } from "../lib/dialog.js";
import { CREDIT_LABELS, CREDIT_TYPES, type CreditType, LAYERS, type Layer } from "../../shared/credits.js";
import { formatBusinessDate, instantFromWallTime, wallTimeAt } from "../../shared/dates.js";
import { LINKABLE, PROJECT_MOVES, type PROJECT_WRITABLE, type ProjectStatus as Status } from "../../shared/lifecycle.js";
import {
  backToList, button, copyText, el, emptyState, type Field, field, input, say, select, showErrors, skeletonRows,
  STORAGE_DOWN, textarea, zone,
} from "./ui.js";

interface Stem {
  id: string;
  layer: Layer;
  format: "wav" | "ogg";
  bytes: number;
  duration_ms: number;
}

interface Project {
  id: string;
  slug: string;
  title: string;
  credit_type: CreditType;
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: "public" | "nda";
  position: number;
  thresholds: Record<Layer, number>;
  status: Status;
  stems: Stem[];
}

interface Link {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_at: string;
  status: "active" | "expired" | "revoked";
}

const STATUS_LABELS: Record<Status, string> = { draft: "Draft", in_review: "In review", published: "Live", withdrawn: "Withdrawn" };
const LAYER_NAMES: Record<Layer, string> = { bed: "Bed", pulse: "Pulse", lead: "Lead", stinger: "Stinger" };
const LINK_LABELS: Record<Link["status"], string> = { active: "Active", expired: "Expired", revoked: "Revoked" };

const view = byId("projects-view");
const list = byId("project-list");
const detail = byId("project-detail");
let projects: Project[] = [];
let selected: string | null = null;

function rowFor(project: Project): HTMLLIElement {
  const open = el("button", { attrs: { type: "button" } },
    el("span", { className: "row-top" }, el("span", { className: "row-title", text: project.title }),
      el("span", { className: "badge", text: STATUS_LABELS[project.status] })),
    el("span", { className: "row-meta mono", text: `${String(project.position).padStart(3, "0")} · ${project.slug}` }));
  if (project.id === selected) open.setAttribute("aria-current", "true");
  open.addEventListener("click", () => void openProject(project.id));
  return el("li", { attrs: { "data-id": project.id } }, open);
}

export async function loadProjects(): Promise<void> {
  if (projects.length === 0) list.replaceChildren(...skeletonRows());
  const answer = await request<{ projects: Project[] }>("/api/console/projects");
  if (answer.status !== 200) return;
  projects = answer.body.projects;
  list.replaceChildren(...(projects.length ? projects.map(rowFor) : [emptyState("No projects yet. Create the first one.")]));
}

function replaceProject(project: Project): void {
  const index = projects.findIndex((p) => p.id === project.id);
  if (index >= 0) projects[index] = project;
  else projects.push(project);
  projects.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  list.replaceChildren(...projects.map(rowFor));
}

async function openProject(id: string): Promise<void> {
  const answer = await request<{ project: Project }>(`/api/console/projects/${id}`);
  if (answer.status !== 200) return;
  selected = id;
  replaceProject(answer.body.project);
  renderDetail(answer.body.project);
  view.classList.add("show-detail");
}

function storageOr(status: number, otherwise: () => void): void {
  if (status === 503) say(STORAGE_DOWN);
  else otherwise();
}

// ---- Detail ----

function renderDetail(project: Project | null): void {
  const heading = el("h2", { text: project ? project.title : "New project", attrs: { tabindex: "-1" } });
  const head = el("div", { className: "detail-head" },
    backToList(view, () => list.querySelector<HTMLElement>(`[data-id="${selected}"] button`)),
    el("p", { className: "label", text: project ? STATUS_LABELS[project.status] : "Draft" }), heading);
  const parts: HTMLElement[] = [head, projectForm(project)];
  if (project) {
    parts.push(stemsPanel(project), movesPanel(project));
    if (LINKABLE.includes(project.status)) parts.push(linksPanel(project));
  }
  detail.replaceChildren(...parts);
}

function projectForm(project: Project | null): HTMLFormElement {
  const withdrawn = project?.status === "withdrawn";
  const fields: Record<string, Field> = {
    slug: field("Slug", input("text", project?.slug ?? "")),
    title: field("Title", input("text", project?.title ?? "")),
    credit_type: field("Credit type", select(CREDIT_TYPES.map((type) => [CREDIT_LABELS[type], CREDIT_LABELS[type]]),
      CREDIT_LABELS[project?.credit_type ?? "shipped"])),
    credit_line: field("Credit line", input("text", project?.credit_line ?? ""), "span"),
    role: field("Role", input("text", project?.role ?? "")),
    visibility: field("Visibility", select([["public", "Public"], ["nda", "NDA (private links only)"]], project?.visibility ?? "public")),
    blurb: field("Blurb", textarea(project?.blurb ?? "", 3), "span"),
    tags: field("Tags", input("text", project?.tags.join(", ") ?? ""), "span"),
    position: field("Position", input("number", project ? String(project.position) : "")),
  };
  const thresholds: Record<Layer, Field> = {
    bed: field("Bed threshold", input("number", String(project?.thresholds.bed ?? 0))),
    pulse: field("Pulse threshold", input("number", String(project?.thresholds.pulse ?? 25))),
    lead: field("Lead threshold", input("number", String(project?.thresholds.lead ?? 50))),
    stinger: field("Stinger threshold", input("number", String(project?.thresholds.stinger ?? 75))),
  };
  thresholds.bed.wrapper.append(el("p", { className: "hint", text: "The bed always comes in at 0." }));
  for (const entry of Object.values(thresholds)) {
    entry.input.setAttribute("min", "0");
    entry.input.setAttribute("max", "100");
  }
  fields.tags?.wrapper.append(el("p", { className: "hint", text: "Separate tags with commas." }));
  const save = el("button", { className: "button primary", text: "Save project", attrs: { type: "submit" } });
  if (withdrawn) save.disabled = true;
  const form = el("form", { className: "panel", attrs: { "aria-label": "Project details", novalidate: "" } },
    el("h3", { text: "Project details" }),
    el("div", { className: "form-grid" }, ...Object.values(fields).map((f) => f.wrapper)),
    el("div", { className: "thresholds" }, ...Object.values(thresholds).map((f) => f.wrapper)),
    el("div", { className: "actions" }, save));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = (key: string): string => fields[key]?.input.value ?? "";
    const label = value("credit_type");
    const body: Partial<Record<(typeof PROJECT_WRITABLE)[number], unknown>> = {
      slug: value("slug").trim(),
      title: value("title"),
      credit_type: CREDIT_TYPES.find((type) => CREDIT_LABELS[type] === label) ?? label,
      credit_line: value("credit_line"),
      role: value("role"),
      blurb: value("blurb"),
      tags: value("tags").split(",").map((tag) => tag.trim()).filter(Boolean),
      visibility: value("visibility"),
      thresholds: Object.fromEntries(LAYERS.map((layer) => [layer, Number(thresholds[layer].input.value)])),
    };
    if (value("position").trim()) body.position = Number(value("position"));
    const answer = project
      ? await request<{ project: Project; errors?: Record<string, string>; error?: string }>(`/api/console/projects/${project.id}`, { method: "PATCH", json: body })
      : await request<{ project: Project; errors?: Record<string, string>; error?: string }>("/api/console/projects", { method: "POST", json: body });
    const all = { ...fields, ...Object.fromEntries(LAYERS.map((layer) => [`thresholds_${layer}`, thresholds[layer]])) };
    if (answer.status === 200 || answer.status === 201) {
      showErrors(all, {});
      selected = answer.body.project.id;
      replaceProject(answer.body.project);
      renderDetail(answer.body.project);
      say("Project saved.");
      return;
    }
    if (answer.status === 409 && answer.body.error === "slug_taken") {
      showErrors(all, { slug: "That slug is already used." });
      say("That slug is already used.");
      return;
    }
    if (answer.status === 422) {
      const errors = { ...(answer.body.errors ?? {}) };
      if (errors.thresholds) errors.thresholds_pulse = errors.thresholds;
      showErrors(all, errors)?.focus();
      say("Check the highlighted fields.");
      return;
    }
    say(answer.status === 409 ? "That move isn’t allowed from the current state." : "The project could not be saved.");
  });
  return form;
}

function describe(stem: Stem | undefined): string {
  if (!stem) return "Missing";
  const seconds = `${Math.floor(stem.duration_ms / 1000)}.${String(Math.floor((stem.duration_ms % 1000) / 100))} s`;
  return `${stem.format.toUpperCase()} · ${stem.bytes.toLocaleString("en-US")} bytes · ${seconds}`;
}

function stemsPanel(project: Project): HTMLElement {
  const rows = LAYERS.map((layer) => {
    const stem = project.stems.find((s) => s.layer === layer);
    const file = input("file");
    file.accept = ".wav,.ogg,audio/wav,audio/ogg";
    file.disabled = project.status === "withdrawn";
    const entry = field(`${LAYER_NAMES[layer]} stem file`, file);
    const info = el("p", { className: stem ? "stem-info stored" : "stem-info", text: describe(stem) });
    file.addEventListener("change", async () => {
      const chosen = file.files?.[0];
      if (!chosen) return;
      const form = new FormData();
      form.set("layer", layer);
      form.set("file", chosen, chosen.name);
      say(`Uploading ${LAYER_NAMES[layer]} stem…`);
      const answer = await request<{ stem: Stem; errors?: Record<string, string> }>(
        `/api/console/projects/${project.id}/stems`, { method: "POST", form });
      file.value = "";
      if (answer.status === 201) {
        project.stems = [...project.stems.filter((s) => s.layer !== layer), answer.body.stem];
        info.textContent = describe(answer.body.stem);
        info.className = "stem-info stored";
        entry.error.textContent = "";
        say(`${LAYER_NAMES[layer]} stem stored.`);
        return;
      }
      storageOr(answer.status, () => {
        const copy = answer.status === 415 ? "That file isn’t a WAV or OGG stem."
          : answer.status === 413 ? "That stem is over 20,000,000 bytes."
          : answer.status === 422 && answer.body.errors?.file ? "File name is not allowed."
          : "The stem could not be stored.";
        entry.error.textContent = copy;
        say(copy);
      });
    });
    return el("div", { className: "stem-row" }, entry.wrapper, info);
  });
  return el("section", { className: "panel", attrs: { "aria-label": "Stems" } },
    el("h3", { text: "Stems" }),
    el("p", { className: "hint", text: "WAV or OGG, mono or stereo, 22,050 to 96,000 Hz, 1 to 180 seconds, up to 20,000,000 bytes. A new file replaces the stored stem." }),
    ...rows);
}

async function move(project: Project, to: Status): Promise<void> {
  const answer = await request<{ project: Project; error?: string; missing?: Layer[] }>(
    `/api/console/projects/${project.id}/transition`, { method: "POST", json: { to } });
  if (answer.status === 200) {
    const moved = answer.body.project;
    replaceProject(moved);
    renderDetail(moved);
    (detail.querySelector("h2") as HTMLElement | null)?.focus();
    say(to === "published"
      ? moved.visibility === "public" ? `${moved.title} is live in the journey.` : `${moved.title} is published for private links only.`
      : to === "withdrawn" ? `${moved.title} is withdrawn. Its stems are deleted.`
      : to === "in_review" ? `${moved.title} is in review.` : `${moved.title} is back in draft.`);
    return;
  }
  storageOr(answer.status, () => {
    if (answer.body.error === "stems_incomplete") {
      say(`Upload the missing stems first: ${(answer.body.missing ?? []).map((layer) => LAYER_NAMES[layer]).join(", ")}.`);
    } else say("That move isn’t allowed from the current state.");
  });
}

const MOVE_LABELS: Record<Status, { label: string; primary: boolean }> = {
  in_review: { label: "Send for review", primary: true },
  published: { label: "Publish", primary: true },
  draft: { label: "Back to draft", primary: false },
  withdrawn: { label: "Withdraw project", primary: false },
};

/** One button per legal move from the project's state. */
function movesPanel(project: Project): HTMLElement {
  const actions = PROJECT_MOVES[project.status].map((to) => {
    const { label, primary } = MOVE_LABELS[to];
    const control: HTMLButtonElement = button(label, () => {
      if (to === "withdrawn") confirmWithdraw(project, control);
      else void move(project, to);
    }, primary);
    return control;
  });
  return el("section", { className: "panel", attrs: { "aria-label": "Lifecycle" } },
    el("h3", { text: "Lifecycle" }),
    actions.length ? el("div", { className: "actions" }, ...actions) : el("p", { className: "hint", text: "Withdrawn projects cannot be changed." }));
}

function confirmWithdraw(project: Project, opener: HTMLButtonElement): void {
  const dialog = byId("withdraw-dialog");
  byId("withdraw-title").textContent = `Withdraw ${project.title}?`;
  const confirm = byId<HTMLButtonElement>("withdraw-confirm");
  const cancel = dialog.querySelector<HTMLButtonElement>("[data-cancel]");
  const close = (): void => handle.close();
  const go = (): void => {
    handle.close();
    void move(project, "withdrawn");
  };
  const handle = openDialog(dialog, {
    background: [byId("console-main")], returnTo: opener, initial: cancel, rise: true,
    onClose: () => {
      confirm.removeEventListener("click", go);
      cancel?.removeEventListener("click", close);
    },
  });
  confirm.addEventListener("click", go);
  cancel?.addEventListener("click", close);
}

// ---- Listening links ----

function linksPanel(project: Project): HTMLElement {
  const items = el("ul", { className: "link-list", attrs: { "aria-label": "Listening links" } });
  const opener = button("New listening link", () => newLink(project, opener, refresh), true);
  const refresh = async (): Promise<void> => {
    const answer = await request<{ links: Link[] }>(`/api/console/projects/${project.id}/links`);
    if (answer.status !== 200) return;
    items.replaceChildren(...(answer.body.links.length
      ? answer.body.links.map((link) => linkItem(link, refresh))
      : [emptyState("No listening links yet.")]));
  };
  void refresh();
  return el("section", { className: "panel", attrs: { "aria-label": "Private listening" } },
    el("h3", { text: "Private listening links" }),
    el("p", { className: "hint", text: "Links are read-only, stop working at their expiry, and can be revoked at any time." }),
    el("div", { className: "actions" }, opener), items);
}

function linkItem(link: Link, refresh: () => Promise<void>): HTMLLIElement {
  const actions = el("div", { className: "actions" });
  actions.append(button("Copy link", async () => {
    say(await copyText(`${location.origin}${link.url}`) ? "Link copied." : `Copy this link: ${location.origin}${link.url}`);
  }));
  if (link.status !== "revoked") {
    actions.append(button("Revoke", async () => {
      const answer = await request(`/api/console/links/${link.id}/revoke`, { method: "POST", json: {} });
      if (answer.status === 200) say("Link revoked. It stopped working immediately.");
      await refresh();
    }));
  }
  if (link.status === "active") {
    actions.append(button("Regenerate", async () => {
      const answer = await request<{ error?: string }>(`/api/console/links/${link.id}/regenerate`, { method: "POST", json: {} });
      if (answer.status === 201) say("New link created. The old one no longer works.");
      else if (answer.body.error === "link_not_active") say("Only an active link can be regenerated. Create a new link instead.");
      await refresh();
    }));
  }
  return el("li", {},
    el("div", { className: "row-top" }, el("span", { className: "row-title", text: link.label }),
      el("span", { className: link.status === "active" ? "badge sent" : "badge", text: LINK_LABELS[link.status] })),
    el("span", { className: "row-meta", text: `Expires ${formatBusinessDate(link.expires_at, zone.value)}` }),
    actions);
}

function newLink(project: Project, opener: HTMLButtonElement, refresh: () => Promise<void>): void {
  const dialog = byId("link-dialog");
  const form = byId<HTMLFormElement>("link-form");
  const label = byId<HTMLInputElement>("link-label");
  const expires = byId<HTMLInputElement>("link-expires");
  const errors = { label: byId("link-label-error"), expires_at: byId("link-expires-error") };
  label.value = "";
  expires.value = wallTimeAt(new Date(Date.now() + 7 * 86_400_000), zone.value);
  byId("link-expires-hint").textContent = `In ${zone.value} time. At most 365 days ahead.`;
  errors.label.textContent = "";
  errors.expires_at.textContent = "";
  const cancel = form.querySelector<HTMLButtonElement>("[data-cancel]");
  const close = (): void => handle.close();
  const handle = openDialog(dialog, {
    background: [byId("console-main")], returnTo: opener, initial: label, rise: true,
    onClose: () => {
      form.removeEventListener("submit", submit);
      cancel?.removeEventListener("click", close);
    },
  });
  const submit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const instant = instantFromWallTime(expires.value, zone.value);
    const answer = await request<{ link: Link; errors?: Record<string, string>; error?: string }>(
      `/api/console/projects/${project.id}/links`,
      { method: "POST", json: { label: label.value, expires_at: instant ? instant.toISOString() : expires.value } },
    );
    if (answer.status === 201) {
      close();
      say(`Link created. It stops working on ${formatBusinessDate(answer.body.link.expires_at, zone.value)}.`);
      await refresh();
      return;
    }
    errors.label.textContent = answer.body.errors?.label ?? "";
    errors.expires_at.textContent = answer.body.errors?.expires_at ?? "";
    say(answer.status === 422 ? "Check the highlighted fields." : "That move isn’t allowed from the current state.");
  };
  form.addEventListener("submit", submit);
  cancel?.addEventListener("click", close);
}

export function setupProjects(): void {
  byId("new-project").addEventListener("click", () => {
    selected = null;
    for (const current of list.querySelectorAll("[aria-current]")) current.removeAttribute("aria-current");
    renderDetail(null);
    view.classList.add("show-detail");
    detail.querySelector<HTMLInputElement>("input")?.focus();
  });
}
