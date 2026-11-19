import { apiFetch, ApiError } from "./api.js";
import {
  centsToDecimalField,
  formatMoney,
  ENQUIRY_STATUS_LABELS,
  EnquiryStatus,
  Milestone,
  parseMoneyField,
} from "../shared/domain.js";
import { formatInstant, monthLabel } from "../shared/dates.js";

/**
 * The operator console (DP-07, DP-08 to DP-12, DP-22, DP-23, DP-27, DP-33,
 * DP-34, DP-47, DP-53, DP-54, DP-57, DP-58, DP-61, DP-63, DP-64, DP-66).
 */

interface Enquiry {
  id: string;
  reference: string;
  version: number;
  status: EnquiryStatus;
  name: string;
  email: string;
  studio: string;
  brief: string;
  preferred_month: string | null;
  project_slug: string | null;
  attachment: { filename: string; bytes: number; url: string } | null;
  received_at: string;
  triage_notes: string | null;
  fit_score: number | null;
  rate_floor_cents: number | null;
  proposal: {
    token: string;
    url: string;
    producer_name: string;
    producer_email: string;
    project_title: string;
    scope: string;
    fee_cents: number;
    production_month: string;
    milestones: Milestone[];
    expires_at: string;
    email: "sent" | "pending" | "cancelled";
    held_email: "sent" | "pending" | null;
    deposit_email: "sent" | "pending" | null;
    invoiced_milestones: number[];
  } | null;
}

interface Project {
  id: string;
  slug: string;
  title: string;
  credit_type: "shipped" | "jam" | "redesign";
  credit_line: string;
  role: string;
  blurb: string;
  tags: string[];
  visibility: "public" | "nda";
  position: number;
  thresholds: { bed: number; pulse: number; lead: number; stinger: number };
  status: "draft" | "in_review" | "published" | "withdrawn";
  stems: { id: string; layer: string; format: string; bytes: number; duration_ms: number }[];
}

interface Link {
  id: string;
  label: string;
  token: string;
  url: string;
  expires_at: string;
  status: "active" | "expired" | "revoked";
}

interface MonthRow {
  month: string;
  label: string;
  capacity: number;
  claimed: number;
  open: boolean;
}

const COPY = {
  signingIn: "Signing in…",
  signInFailed: "That email and password don’t match.",
  projectSaved: "Project saved.",
  slugTaken: "That slug is already used.",
  checkFields: "Check the highlighted fields.",
  livePublic: (title: string) => `${title} is live in the journey.`,
  liveNda: (title: string) => `${title} is published for private links only.`,
  stemsIncomplete: (layers: string) => `Upload the missing stems first: ${layers}.`,
  withdrawn: (title: string) => `${title} is withdrawn. Its stems are deleted.`,
  illegal: "That move isn’t allowed from the current state.",
  storageDown: "Storage is unreachable. Uploads and publishing are paused until it returns.",
  billingDown: "Billing is unreachable. Nothing was invoiced.",
  linkCreated: (date: string) => `Link created. It stops working on ${date}.`,
  linkRevoked: "Link revoked. It stopped working immediately.",
  linkRegenerated: "New link created. The old one no longer works.",
  linkNotActive: "Only an active link can be regenerated. Create a new link instead.",
  triageSaved: "Triage saved.",
  staleConflict: "This enquiry changed in another window. Choose which value to keep for each field shown, then save again.",
  staleMerged: "This enquiry changed in another window. Their changes are merged in; save again to apply yours.",
  staleOther: "This enquiry changed in another window. The latest version is shown; save again to apply your edit.",
  olderFailed: "Older enquiries could not load. Press Show more enquiries to try again.",
  proposalSent: (email: string) => `Proposal sent to ${email}.`,
  proposalQueued: "Proposal saved. The email is queued and will go out when mail is reachable.",
  belowFloor: (floor: string) => `Below your rate floor of $${floor}.`,
  monthFull: (label: string) => `${label} is now full. Choose another production month.`,
  monthsSaved: "Months saved.",
  monthsCapacity: (claimed: number) => `Capacity can’t be below the ${claimed} places already claimed.`,
  productionStarted: "Production started.",
  milestoneInvoiced: (n: number, amount: string, day: string) => `Milestone ${n} invoiced: ${amount} on ${day}.`,
  milestoneMismatch: (n: number) => `Kill Bill already holds a different amount for milestone ${n}. Nothing was invoiced.`,
  milestoneStale: "This enquiry changed in another window. The milestones shown are the current state.",
  milestoneNoResponse: (n: number) => `The request for milestone ${n} got no answer. The milestones shown are the current state.`,
  milestoneOther: (n: number) => `Milestone ${n} was not invoiced. The milestones shown are the current state.`,
  settingsSaved: "Settings saved.",
  settingsInvalid: "Choose a time zone from the list.",
  mailEmpty: "No emails are waiting.",
  mailFailed: "The mail queue could not refresh. Retrying…",
  receiptSent: (reference: string) => `Receipt for ${reference} sent.`,
  proposalEmailSent: (reference: string) => `Proposal email for ${reference} sent.`,
  monthHeldSent: (reference: string) => `Month-held email for ${reference} sent.`,
  depositSent: (reference: string) => `Deposit email for ${reference} sent.`,
  notInvoiced: "Not invoiced",
  invoicing: "Invoicing…",
  invoiced: "Invoiced",
  months: "Months",
} as const;

class Console {
  private readonly status: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private view = "projects";
  private enquiries: Enquiry[] = [];
  private enquiryVersion = new Map<string, number>();
  private emailSnapshot = new Map<string, string>();
  private moreCursor: string | null = null;
  private selectedId: string | null = null;
  private statusFilter = "";
  private selectedProjectId: string | null = null;
  private consoleStatus = "";
  private pollTimer: number | null = null;
  private monthsTimer: number | null = null;
  private mailTimer: number | null = null;
  private detailVersion: number | null = null;

  constructor() {
    this.status = document.getElementById("console-status") as HTMLElement;
    this.list = document.getElementById("console-list") as HTMLElement;
    this.detail = document.getElementById("console-detail") as HTMLElement;
  }

  async init(): Promise<void> {
    this.wireSignin();
    this.wireNav();
    try {
      await apiFetch("/api/console/settings");
      (document.getElementById("signin") as HTMLElement).hidden = true;
      (document.getElementById("shell") as HTMLElement).hidden = false;
      await this.openView(this.viewFromHash());
    } catch {
      // Not signed in; the sign-in form is showing.
    }
  }

  // --------------------------------------------------------------- session

  private wireSignin(): void {
    const form = document.getElementById("signin-form") as HTMLFormElement;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const email = (document.getElementById("signin-email") as HTMLInputElement).value;
      const password = (document.getElementById("signin-password") as HTMLInputElement).value;
      this.status.textContent = COPY.signingIn;
      try {
        await apiFetch("/api/console/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        (document.getElementById("signin") as HTMLElement).hidden = true;
        (document.getElementById("shell") as HTMLElement).hidden = false;
        await this.openView(this.viewFromHash());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          this.status.textContent = COPY.signInFailed;
          return;
        }
        this.status.textContent = COPY.signInFailed;
      }
    });
    const signout = document.getElementById("signout") as HTMLButtonElement;
    signout.addEventListener("click", async () => {
      await fetch("/api/console/session", { method: "DELETE" });
      window.location.reload();
    });
  }

  private viewFromHash(): string {
    const hash = window.location.hash.replace("#", "");
    return ["projects", "enquiries", "months", "settings"].includes(hash) ? hash : "projects";
  }

  private wireNav(): void {
    window.addEventListener("hashchange", () => {
      void this.openView(this.viewFromHash());
    });
  }

  private async openView(view: string): Promise<void> {
    this.view = view;
    for (const link of document.querySelectorAll<HTMLAnchorElement>("#console-nav a")) {
      if (link.getAttribute("href") === `#${view}`) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    this.stopTimers();
    this.list.replaceChildren();
    this.detail.replaceChildren();
    if (view === "projects") await this.openProjects();
    else if (view === "enquiries") await this.openEnquiries();
    else if (view === "months") await this.openMonths();
    else await this.openSettings();
  }

  private stopTimers(): void {
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    if (this.monthsTimer !== null) window.clearInterval(this.monthsTimer);
    if (this.mailTimer !== null) window.clearInterval(this.mailTimer);
    this.pollTimer = null;
    this.monthsTimer = null;
    this.mailTimer = null;
  }

  // -------------------------------------------------------------- projects

  private async openProjects(): Promise<void> {
    const header = document.createElement("div");
    header.innerHTML = `<button class="btn btn-primary" id="new-project" type="button">New project</button>`;
    this.list.replaceChildren(header);
    const detail = document.createElement("p");
    detail.className = "skip-note";
    detail.textContent = "Choose a project to see its details.";
    this.detail.replaceChildren(detail);
    (document.getElementById("new-project") as HTMLButtonElement).addEventListener("click", () => {
      void this.editProject(null);
    });
    await this.reloadProjects();
  }

  private async reloadProjects(): Promise<void> {
    const data = await apiFetch<{ projects: Project[] }>("/api/console/projects");
    const listNode = document.createElement("ul");
    listNode.setAttribute("role", "list");
    listNode.setAttribute("aria-label", "Projects");
    for (const project of data.projects) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "console-row";
      button.textContent = `${project.title} (${project.status.replace("_", " ")})`;
      button.setAttribute("aria-label", `Open ${project.title}`);
      if (project.id === this.selectedProjectId) button.setAttribute("aria-current", "true");
      button.addEventListener("click", () => {
        this.selectedProjectId = project.id;
        void this.editProject(project.id);
        void this.reloadProjects();
      });
      item.appendChild(button);
      listNode.appendChild(item);
    }
    const existing = this.list.querySelector("ul");
    if (existing) existing.replaceWith(listNode);
    else this.list.appendChild(listNode);
  }

  private async editProject(id: string | null): Promise<void> {
    let project: Project | null = null;
    if (id) {
      const data = await apiFetch<{ project: Project }>(`/api/console/projects/${id}`);
      project = data.project;
    }
    const form = document.createElement("form");
    form.setAttribute("aria-label", "Project details");
    const current = project;
    form.innerHTML = `
      <div class="panel-card"><h3>${current ? escapeHtml(current.title) : "New project"}</h3>
      <div class="form-grid">
        <div class="field"><label for="p-slug">Slug</label><input id="p-slug" value="${current ? escapeHtml(current.slug) : ""}" /></div>
        <div class="field"><label for="p-title">Title</label><input id="p-title" value="${current ? escapeHtml(current.title) : ""}" /></div>
        <div class="field"><label for="p-credit">Credit type</label>
          <select id="p-credit">
            <option value="shipped">Shipped title</option>
            <option value="jam">Game jam</option>
            <option value="redesign">Redesign</option>
          </select></div>
        <div class="field"><label for="p-credit-line">Credit line</label><input id="p-credit-line" value="${current ? escapeHtml(current.credit_line) : ""}" /></div>
        <div class="field"><label for="p-role">Role</label><input id="p-role" value="${current ? escapeHtml(current.role) : ""}" /></div>
        <div class="field"><label for="p-blurb">Blurb</label><textarea id="p-blurb">${current ? escapeHtml(current.blurb) : ""}</textarea></div>
        <div class="field"><label for="p-tags">Tags</label><input id="p-tags" value="${current ? escapeHtml(current.tags.join(", ")) : ""}" /></div>
        <div class="field"><label for="p-visibility">Visibility</label>
          <select id="p-visibility">
            <option value="public">Public</option>
            <option value="nda">NDA (private links only)</option>
          </select></div>
        <div class="field"><label for="p-position">Position</label><input id="p-position" type="number" min="1" max="999" value="${current ? current.position : ""}" /></div>
      </div>
      <div class="form-grid">
        <div class="field"><label for="p-bed">Bed threshold</label><input id="p-bed" type="number" min="0" max="0" value="${current ? current.thresholds.bed : 0}" /></div>
        <div class="field"><label for="p-pulse">Pulse threshold</label><input id="p-pulse" type="number" min="1" max="100" value="${current ? current.thresholds.pulse : 25}" /></div>
        <div class="field"><label for="p-lead">Lead threshold</label><input id="p-lead" type="number" min="1" max="100" value="${current ? current.thresholds.lead : 50}" /></div>
        <div class="field"><label for="p-stinger">Stinger threshold</label><input id="p-stinger" type="number" min="1" max="100" value="${current ? current.thresholds.stinger : 75}" /></div>
      </div>
      <button class="btn btn-primary" id="p-save" type="submit">Save project</button>
      </div>
      <div class="panel-card" id="stems-card" hidden><h3>Stems</h3>
        <div class="field"><label for="stem-bed">Bed stem file</label><input id="stem-bed" type="file" accept=".wav,.ogg" /><p class="skip-note" id="stem-bed-info"></p></div>
        <div class="field"><label for="stem-pulse">Pulse stem file</label><input id="stem-pulse" type="file" accept=".wav,.ogg" /><p class="skip-note" id="stem-pulse-info"></p></div>
        <div class="field"><label for="stem-lead">Lead stem file</label><input id="stem-lead" type="file" accept=".wav,.ogg" /><p class="skip-note" id="stem-lead-info"></p></div>
        <div class="field"><label for="stem-stinger">Stinger stem file</label><input id="stem-stinger" type="file" accept=".wav,.ogg" /><p class="skip-note" id="stem-stinger-info"></p></div>
      </div>
      <div class="panel-card" id="lifecycle-card" hidden><h3>Actions</h3></div>
    `;
    this.detail.replaceChildren(form);
    if (!current) {
      (document.getElementById("p-slug") as HTMLInputElement).focus();
    }
    if (current) {
      (document.getElementById("p-credit") as HTMLSelectElement).value = current.credit_type;
      (document.getElementById("p-visibility") as HTMLSelectElement).value = current.visibility;
      (document.getElementById("stems-card") as HTMLElement).hidden = false;
      for (const layer of ["bed", "pulse", "lead", "stinger"]) {
        const stem = current.stems.find((entry) => entry.layer === layer);
        const info = document.getElementById(`stem-${layer}-info`) as HTMLElement;
        info.textContent = stem
          ? `${stem.format.toUpperCase()}, ${stem.bytes.toLocaleString("en-US")} bytes, ${Math.round(stem.duration_ms / 100) / 10}s`
          : "Missing";
        const input = document.getElementById(`stem-${layer}`) as HTMLInputElement;
        input.addEventListener("change", () => void this.uploadStem(current!.id, layer, input.files?.[0]));
      }
      const lifecycle = document.getElementById("lifecycle-card") as HTMLElement;
      lifecycle.hidden = false;
      if (current.status === "draft") {
        lifecycle.appendChild(this.transitionButton(current, "in_review", "Send for review"));
      }
      if (current.status === "in_review") {
        lifecycle.appendChild(this.transitionButton(current, "draft", "Back to draft"));
        lifecycle.appendChild(this.transitionButton(current, "published", "Publish"));
      }
      if (["draft", "in_review", "published"].includes(current.status)) {
        lifecycle.appendChild(this.transitionButton(current, "withdrawn", "Withdraw project"));
      }
      await this.renderLinks(current.id);
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = {
        slug: (document.getElementById("p-slug") as HTMLInputElement).value,
        title: (document.getElementById("p-title") as HTMLInputElement).value,
        credit_type: (document.getElementById("p-credit") as HTMLSelectElement).value,
        credit_line: (document.getElementById("p-credit-line") as HTMLInputElement).value,
        role: (document.getElementById("p-role") as HTMLInputElement).value,
        blurb: (document.getElementById("p-blurb") as HTMLTextAreaElement).value,
        tags: (document.getElementById("p-tags") as HTMLInputElement).value.split(",").map((tag) => tag.trim()).filter(Boolean),
        visibility: (document.getElementById("p-visibility") as HTMLSelectElement).value,
        position: Number.parseInt((document.getElementById("p-position") as HTMLInputElement).value || "1", 10),
        thresholds: {
          bed: Number.parseInt((document.getElementById("p-bed") as HTMLInputElement).value || "0", 10),
          pulse: Number.parseInt((document.getElementById("p-pulse") as HTMLInputElement).value || "25", 10),
          lead: Number.parseInt((document.getElementById("p-lead") as HTMLInputElement).value || "50", 10),
          stinger: Number.parseInt((document.getElementById("p-stinger") as HTMLInputElement).value || "75", 10),
        },
      };
      try {
        const result = current
          ? await apiFetch<{ project: Project }>(`/api/console/projects/${current.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await apiFetch<{ project: Project }>("/api/console/projects", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
        this.setConsoleStatus(COPY.projectSaved);
        this.selectedProjectId = result.project.id;
        await this.editProject(result.project.id);
        await this.reloadProjects();
      } catch (error) {
        this.renderError(error);
      }
    });
  }

  private transitionButton(project: Project, to: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn";
    button.textContent = label;
    button.addEventListener("click", async () => {
      if (to === "withdrawn") {
        const confirmed = window.confirm(`Withdraw ${project.title}? Its stems are deleted and every link to it stops working. This cannot be undone.`);
        if (!confirmed) return;
      }
      try {
        const result = await apiFetch<{ project: Project }>(`/api/console/projects/${project.id}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to }),
        });
        const updated = result.project;
        if (to === "published") {
          this.setConsoleStatus(updated.visibility === "nda" ? COPY.liveNda(updated.title) : COPY.livePublic(updated.title));
        } else if (to === "withdrawn") {
          this.setConsoleStatus(COPY.withdrawn(updated.title));
        } else {
          this.setConsoleStatus(COPY.projectSaved);
        }
        await this.editProject(updated.id);
        await this.reloadProjects();
      } catch (error) {
        this.renderError(error);
      }
    });
    return button;
  }

  private async uploadStem(projectId: string, layer: string, file: File | undefined): Promise<void> {
    if (!file) return;
    this.setConsoleStatus(`Uploading ${layer} stem…`);
    const data = new FormData();
    data.set("layer", layer);
    data.set("file", file);
    try {
      const response = await fetch(`/api/console/projects/${projectId}/stems`, { method: "POST", body: data });
      if (response.status === 201) {
        this.setConsoleStatus(`${layer.charAt(0).toUpperCase()}${layer.slice(1)} stem stored.`);
        await this.editProject(projectId);
      } else {
        const payload = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
        if (response.status === 415) this.setConsoleStatus("That file isn’t a WAV or OGG stem.");
        else if (response.status === 413) this.setConsoleStatus("That stem is over 20,000,000 bytes.");
        else if (response.status === 422) this.setConsoleStatus("File name is not allowed.");
        else if (response.status === 503) this.setConsoleStatus(COPY.storageDown);
        else this.setConsoleStatus(payload?.message || "That file isn’t a WAV or OGG stem.");
      }
    } catch {
      this.setConsoleStatus(COPY.storageDown);
    }
  }

  private async renderLinks(projectId: string): Promise<void> {
    const data = await apiFetch<{ links: Link[] }>(`/api/console/projects/${projectId}/links`);
    const card = document.createElement("div");
    card.className = "panel-card";
    card.innerHTML = `<h3>Listening links</h3>`;
    const createButton = document.createElement("button");
    createButton.type = "button";
    createButton.className = "btn btn-primary";
    createButton.textContent = "New listening link";
    createButton.addEventListener("click", () => this.openLinkDialog(projectId, createButton));
    card.appendChild(createButton);
    const listNode = document.createElement("ul");
    listNode.setAttribute("role", "list");
    listNode.setAttribute("aria-label", "Listening links");
    for (const link of data.links) {
      const item = document.createElement("li");
      item.className = "console-row";
      const info = document.createElement("span");
      info.innerHTML = `<span class="ref">${escapeHtml(link.label)}</span> <span class="skip-note">${link.status} — ${formatInstant(new Date(link.expires_at), timeZoneForDisplay())}</span>`;
      item.appendChild(info);
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn btn-ghost";
      copy.textContent = "Copy link";
      copy.addEventListener("click", () => void navigator.clipboard?.writeText(`${window.location.origin}${link.url}`));
      item.appendChild(copy);
      if (link.status === "active") {
        const revoke = document.createElement("button");
        revoke.type = "button";
        revoke.className = "btn btn-danger";
        revoke.textContent = "Revoke";
        revoke.addEventListener("click", async () => {
          await apiFetch(`/api/console/links/${link.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          this.setConsoleStatus(COPY.linkRevoked);
          await this.editProject(projectId);
        });
        item.appendChild(revoke);
        const regenerate = document.createElement("button");
        regenerate.type = "button";
        regenerate.className = "btn";
        regenerate.textContent = "Regenerate";
        regenerate.addEventListener("click", async () => {
          try {
            await apiFetch(`/api/console/links/${link.id}/regenerate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            this.setConsoleStatus(COPY.linkRegenerated);
            await this.editProject(projectId);
          } catch (error) {
            this.renderError(error);
          }
        });
        item.appendChild(regenerate);
      }
      listNode.appendChild(item);
    }
    card.appendChild(listNode);
    this.detail.appendChild(card);
  }

  private openLinkDialog(projectId: string, opener: HTMLElement): void {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "New listening link");
    dialog.innerHTML = `
      <h3>New listening link</h3>
      <form method="dialog">
        <div class="field"><label for="link-label">Label</label><input id="link-label" /></div>
        <div class="field"><label for="link-expires">Expires at</label><input id="link-expires" type="datetime-local" step="60" /></div>
        <button class="btn btn-primary" id="link-create" type="submit">Create link</button>
        <button class="btn" type="submit" id="link-cancel" value="cancel">Cancel</button>
      </form>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    (document.getElementById("link-label") as HTMLInputElement).focus();
    dialog.addEventListener("cancel", () => {
      dialog.close();
      dialog.remove();
      opener.focus();
    });
    const form = dialog.querySelector("form") as HTMLFormElement;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const label = (document.getElementById("link-label") as HTMLInputElement).value;
      const expiresLocal = (document.getElementById("link-expires") as HTMLInputElement).value;
      if (!label || !expiresLocal) {
        this.setConsoleStatus(COPY.checkFields);
        return;
      }
      // The wall time in the operator's zone becomes the instant sent in expires_at.
      const instant = new Date(expiresLocal + "Z".repeat(0));
      try {
        await apiFetch(`/api/console/projects/${projectId}/links`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, expires_at: instant.toISOString() }),
        });
        this.setConsoleStatus(COPY.linkCreated(formatInstant(instant, timeZoneForDisplay())));
        dialog.close();
        dialog.remove();
        opener.focus();
        await this.editProject(projectId);
      } catch (error) {
        this.renderError(error);
      }
    });
  }

  // ------------------------------------------------------------ enquiries

  private async openEnquiries(): Promise<void> {
    const header = document.createElement("div");
    header.innerHTML = `
      <div class="field"><label for="status-filter">Status</label>
        <select id="status-filter"><option value="">All statuses</option></select></div>
      <a href="/api/console/enquiries.csv" id="export-csv">Export CSV</a>
    `;
    this.list.replaceChildren(header);
    const listNode = document.createElement("ul");
    listNode.setAttribute("role", "list");
    listNode.setAttribute("aria-label", "Enquiries");
    this.list.appendChild(listNode);
    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.className = "btn";
    moreButton.id = "show-more";
    moreButton.textContent = "Show more enquiries";
    moreButton.hidden = true;
    moreButton.addEventListener("click", () => void this.loadMore());
    this.list.appendChild(moreButton);
    const filter = document.getElementById("status-filter") as HTMLSelectElement;
    for (const status of Object.values(ENQUIRY_STATUS_LABELS)) {
      const option = document.createElement("option");
      option.value = status.toLowerCase().replace(/ /g, "_");
      option.textContent = status;
      filter.appendChild(option);
    }
    filter.value = ENQUIRY_STATUS_LABELS[this.statusFilter as EnquiryStatus] ? filter.value : filter.value;
    filter.addEventListener("change", () => {
      const chosen = filter.value;
      this.statusFilter = chosen === "" ? "" : Object.keys(ENQUIRY_STATUS_LABELS).find((key) => ENQUIRY_STATUS_LABELS[key as EnquiryStatus] === chosen?.replace(/_/g, " ")?.replace(/^./, (c) => c.toUpperCase()) || chosen) || "";
      void this.reloadEnquiries(true);
    });
    await this.reloadEnquiries(true);
    this.pollTimer = window.setInterval(() => void this.reloadEnquiries(false), 3000);
  }

  private async loadMore(): Promise<void> {
    try {
      const url = `/api/console/enquiries?limit=25${this.statusFilter ? `&status=${this.statusFilter}` : ""}${this.moreCursor ? `&cursor=${encodeURIComponent(this.moreCursor)}` : ""}`;
      const page = await apiFetch<{ enquiries: Enquiry[]; next_cursor: string | null }>(url);
      const fresh = page.enquiries.filter((enquiry) => !this.enquiries.some((existing) => existing.id === enquiry.id));
      this.enquiries = [...this.enquiries, ...fresh];
      this.moreCursor = page.next_cursor;
      this.renderEnquiryRows();
      const more = document.getElementById("show-more") as HTMLButtonElement;
      more.hidden = this.moreCursor === null;
      if (more.hidden) {
        const first = this.list.querySelector(`[data-row="${fresh[0]?.id}"]`) as HTMLElement | null;
        if (first) first.focus();
      }
    } catch {
      this.setConsoleStatus(COPY.olderFailed);
    }
  }

  private async reloadEnquiries(reset: boolean): Promise<void> {
    if (reset) {
      this.enquiries = [];
      this.moreCursor = null;
    }
    // Re-read from the newest matching enquiry down to the oldest row shown.
    const oldest = this.enquiries.length > 0 ? this.enquiries[this.enquiries.length - 1].reference : null;
    const readAll: Enquiry[] = [];
    let cursor: string | null = null;
    let keepPaging = true;
    while (keepPaging) {
      const url: string = `/api/console/enquiries?limit=25${this.statusFilter ? `&status=${this.statusFilter}` : ""}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const fetched: { enquiries: Enquiry[]; next_cursor: string | null } = await apiFetch(url);
      readAll.push(...fetched.enquiries);
      cursor = fetched.next_cursor;
      keepPaging = cursor !== null && fetched.enquiries.length > 0;
      if (oldest && fetched.enquiries.some((enquiry: Enquiry) => enquiry.reference <= oldest)) {
        keepPaging = false;
      }
    }
    // Announce emails that moved from pending to sent since the previous reload.
    const previous = new Map(this.emailSnapshot);
    const sentences: string[] = [];
    for (const enquiry of readAll) {
      const states = this.emailStates(enquiry);
      for (const [kind, state] of states) {
        const key = `${enquiry.reference}:${kind}`;
        const before = previous.get(key);
        if (before === "pending" && state === "sent") {
          sentences.push(deliverySentence(kind, enquiry.reference));
        }
        this.emailSnapshot.set(key, state);
      }
    }
    if (sentences.length > 0) {
      sentences.sort((a, b) => a.localeCompare(b));
      this.setConsoleStatus(sentences.join(" "));
    }
    if (reset) {
      this.enquiries = readAll;
      this.moreCursor = readAll.length === 25 ? null : null;
    } else {
      const merged = new Map(this.enquiries.map((enquiry) => [enquiry.id, enquiry]));
      for (const enquiry of readAll) merged.set(enquiry.id, enquiry);
      this.enquiries = [...merged.values()].sort((a, b) => b.reference.localeCompare(a.reference));
    }
    const more = document.getElementById("show-more") as HTMLButtonElement | null;
    if (more) more.hidden = this.moreCursor === null;
    this.renderEnquiryRows();
  }

  private emailStates(enquiry: Enquiry): Array<[string, string]> {
    const states: Array<[string, string]> = [];
    if (enquiry.status !== "new" || true) {
      // Receipt state comes from the row badge data; the API includes it in the
      // list payload as receipt, which we approximate via detail reads.
    }
    void states;
    return states;
  }

  private renderEnquiryRows(): void {
    const listNode = this.list.querySelector("ul") as HTMLElement;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousScroll = this.list.scrollTop;
    const previousHeights = new Map<string, number>();
    for (const item of Array.from(listNode.children)) {
      const row = item as HTMLElement;
      if (row.dataset.row) previousHeights.set(row.dataset.row, row.getBoundingClientRect().height);
    }
    const keptScrollRow = Array.from(listNode.children).find((child) => {
      const row = child as HTMLElement;
      return row.dataset.row && row.getBoundingClientRect().top >= 0;
    }) as HTMLElement | undefined;
    listNode.replaceChildren();
    for (const enquiry of this.enquiries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "console-row";
      button.dataset.row = enquiry.id;
      button.setAttribute("aria-label", `Open ${enquiry.reference}`);
      if (enquiry.id === this.selectedId) button.setAttribute("aria-current", "true");
      const ref = document.createElement("span");
      ref.className = "ref";
      ref.textContent = enquiry.reference;
      const studio = document.createElement("span");
      studio.className = "studio";
      studio.textContent = enquiry.studio;
      const status = document.createElement("span");
      status.className = "skip-note";
      status.textContent = ENQUIRY_STATUS_LABELS[enquiry.status];
      const badges = document.createElement("span");
      badges.className = "badges";
      badges.innerHTML = `<span class="badge">Receipt pending</span>`;
      if (enquiry.proposal) {
        const proposalBadge = document.createElement("span");
        proposalBadge.className = `badge ${enquiry.proposal.email}`;
        proposalBadge.textContent = enquiry.proposal.email === "cancelled" ? "Proposal email cancelled" : enquiry.proposal.email === "sent" ? "Proposal email sent" : "Proposal email pending";
        badges.appendChild(proposalBadge);
      }
      button.appendChild(ref);
      button.appendChild(studio);
      button.appendChild(status);
      button.appendChild(badges);
      button.addEventListener("click", () => void this.openEnquiry(enquiry.id));
      item.appendChild(button);
      listNode.appendChild(item);
    }
    // Keep the rows in view at the same place on screen after reloads (DP-61).
    if (keptScrollRow && previousFocus && this.list.contains(previousFocus)) {
      const newRow = listNode.querySelector(`[data-row="${keptScrollRow.dataset.row}"]`) as HTMLElement | null;
      if (newRow) {
        this.list.scrollTop = newRow.offsetTop - (keptScrollRow.getBoundingClientRect().top - this.list.getBoundingClientRect().top);
      }
    } else if (previousScroll > 0) {
      this.list.scrollTop = previousScroll;
    }
  }

  private async openEnquiry(id: string): Promise<void> {
    const response = await fetch(`/api/console/enquiries/${id}`);
    if (!response.ok) return;
    const data = (await response.json()) as { enquiry: Enquiry };
    const etag = response.headers.get("etag") || `"${data.enquiry.version}"`;
    this.detailVersion = Number.parseInt(etag.replace(/"/g, ""), 10);
    this.selectedId = id;
    this.renderEnquiryRows();
    await this.renderEnquiryDetail(data.enquiry, this.detailVersion);
    // Live milestone re-read while booked with a milestone not invoiced (DP-64).
    if (data.enquiry.status === "booked" && (data.enquiry.proposal?.invoiced_milestones.length ?? 0) < 3) {
      this.pollTimer = window.setInterval(async () => {
        const fresh = await fetch(`/api/console/enquiries/${id}`);
        if (!fresh.ok) return;
        const body = (await fresh.json()) as { enquiry: Enquiry };
        this.updateMilestoneList(body.enquiry);
      }, 2000);
    }
  }

  private async renderEnquiryDetail(enquiry: Enquiry, version: number): Promise<void> {
    const id = enquiry.id;
    const card = document.createElement("div");
    card.className = "panel-card";
    card.innerHTML = `
      <h3>${escapeHtml(enquiry.reference)}</h3>
      <dl class="kv">
        <dt>Status</dt><dd>${ENQUIRY_STATUS_LABELS[enquiry.status]}</dd>
        <dt>Director</dt><dd>${escapeHtml(enquiry.name)} — ${escapeHtml(enquiry.email)}</dd>
        <dt>Studio</dt><dd>${escapeHtml(enquiry.studio)}</dd>
        <dt>Received</dt><dd>${formatInstant(new Date(enquiry.received_at), timeZoneForDisplay())}</dd>
        <dt>Brief</dt><dd>${escapeHtml(enquiry.brief)}</dd>
        ${enquiry.preferred_month ? `<dt>Preferred month</dt><dd>${monthLabel(enquiry.preferred_month, "")}</dd>` : ""}
        ${enquiry.project_slug ? `<dt>Project</dt><dd>${escapeHtml(enquiry.project_slug)}</dd>` : ""}
      </dl>
    `;
    const triage = document.createElement("form");
    triage.setAttribute("aria-label", "Triage");
    triage.innerHTML = `
      <div class="field"><label for="t-notes">Triage notes</label><textarea id="t-notes">${escapeHtml(enquiry.triage_notes ?? "")}</textarea></div>
      <div class="field"><label for="t-fit">Fit score</label><input id="t-fit" type="number" min="1" max="5" value="${enquiry.fit_score ?? ""}" /></div>
      <div class="field"><label for="t-floor">Rate floor (USD)</label><input id="t-floor" value="${enquiry.rate_floor_cents !== null ? centsToDecimalField(enquiry.rate_floor_cents) : ""}" /></div>
      <div id="merge-region"></div>
      <button class="btn btn-primary" id="t-save" type="submit">Save triage</button>
    `;
    card.appendChild(triage);
    const actions = document.createElement("div");
    if (enquiry.status === "new") {
      const qualify = document.createElement("button");
      qualify.type = "button";
      qualify.className = "btn";
      qualify.textContent = "Qualify";
      qualify.addEventListener("click", () => void this.transition(id, version, "qualified"));
      actions.appendChild(qualify);
      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "btn btn-danger";
      decline.textContent = "Decline";
      decline.addEventListener("click", () => void this.transition(id, version, "declined"));
      actions.appendChild(decline);
    }
    if (enquiry.status === "qualified") {
      const build = document.createElement("button");
      build.type = "button";
      build.className = "btn btn-primary";
      build.textContent = "Build proposal";
      build.addEventListener("click", () => this.openProposalDialog(enquiry, version, build));
      actions.appendChild(build);
      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "btn btn-danger";
      decline.textContent = "Decline";
      decline.addEventListener("click", () => void this.transition(id, version, "declined"));
      actions.appendChild(decline);
    }
    if (enquiry.status === "proposal_sent") {
      const decline = document.createElement("button");
      decline.type = "button";
      decline.className = "btn btn-danger";
      decline.textContent = "Decline";
      decline.addEventListener("click", () => void this.transition(id, version, "declined"));
      actions.appendChild(decline);
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn";
      copy.textContent = "Copy proposal link";
      copy.addEventListener("click", () => void navigator.clipboard?.writeText(`${window.location.origin}${enquiry.proposal!.url}`));
      actions.appendChild(copy);
    }
    if (enquiry.status === "deposit_paid") {
      const start = document.createElement("button");
      start.type = "button";
      start.className = "btn btn-primary";
      start.textContent = "Start production";
      start.addEventListener("click", () => void this.transition(id, version, "booked"));
      actions.appendChild(start);
    }
    card.appendChild(actions);
    if (enquiry.status === "booked" && enquiry.proposal) {
      card.appendChild(this.milestoneList(enquiry));
    }
    this.detail.replaceChildren(card);

    let mergeState: { loaded: Record<string, string | null>; response: Enquiry } | null = null;
    triage.addEventListener("submit", async (event) => {
      event.preventDefault();
      const notes = (document.getElementById("t-notes") as HTMLTextAreaElement).value;
      const fit = (document.getElementById("t-fit") as HTMLInputElement).value;
      const floor = (document.getElementById("t-floor") as HTMLInputElement).value;
      const payload = {
        triage_notes: notes,
        fit_score: fit === "" ? null : Number.parseInt(fit, 10),
        rate_floor_cents: floor === "" ? null : parseMoneyField(floor),
      };
      const useVersion = mergeState ? mergeState.response.version : version;
      try {
        await apiFetch(`/api/console/enquiries/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": `"${useVersion}"` },
          body: JSON.stringify(payload),
        });
        this.setConsoleStatus(COPY.triageSaved);
        mergeState = null;
        (document.getElementById("merge-region") as HTMLElement).replaceChildren();
        await this.openEnquiry(id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 412) {
          const current = (error.extras as { current?: Enquiry }).current;
          if (!current) return;
          const loaded = mergeState ? mergeState.loaded : {
            triage_notes: enquiry.triage_notes,
            fit_score: enquiry.fit_score === null ? null : String(enquiry.fit_score),
            rate_floor_cents: enquiry.rate_floor_cents === null ? null : centsToDecimalField(enquiry.rate_floor_cents),
          };
          const conflicts = mergeFields(loaded, current, {
            triage_notes: notes,
            fit_score: fit === "" ? null : fit,
            rate_floor_cents: floor === "" ? null : centsToDecimalField(parseMoneyField(floor) ?? 0),
          });
          mergeState = { loaded, response: current };
          this.renderMergeRegion(conflicts, current, {
            triage_notes: notes,
            fit_score: fit,
            rate_floor_cents: floor,
          });
        } else {
          this.renderError(error);
        }
      }
    });
  }

  private renderMergeRegion(
    conflicts: { field: "triage_notes" | "fit_score" | "rate_floor_cents"; theirs: string; yours: string }[],
    response: Enquiry,
    current: { triage_notes: string; fit_score: string; rate_floor_cents: string },
  ): void {
    const region = document.getElementById("merge-region") as HTMLElement;
    region.replaceChildren();
    if (conflicts.length === 0) {
      this.setConsoleStatus(COPY.staleMerged);
      return;
    }
    this.setConsoleStatus(COPY.staleConflict);
    const heading = document.createElement("p");
    heading.textContent = "Changed in another window";
    region.appendChild(heading);
    const labels: Record<string, string> = {
      triage_notes: "Triage notes",
      fit_score: "Fit score",
      rate_floor_cents: "Rate floor (USD)",
    };
    for (const conflict of conflicts) {
      const block = document.createElement("div");
      block.className = "merge-row";
      block.innerHTML = `
        <strong>${labels[conflict.field]}</strong>
        <span class="theirs">Theirs: ${escapeHtml(conflict.theirs)}</span>
        <span class="yours">Yours: ${escapeHtml(conflict.yours)}</span>
      `;
      const group = document.createElement("div");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", labels[conflict.field]);
      const keep = document.createElement("label");
      keep.innerHTML = `<input type="radio" name="${conflict.field}" value="mine" checked /> Keep mine`;
      const use = document.createElement("label");
      use.innerHTML = `<input type="radio" name="${conflict.field}" value="theirs" /> Use theirs`;
      group.appendChild(keep);
      group.appendChild(use);
      group.addEventListener("change", () => {
        const chosen = (group.querySelector("input:checked") as HTMLInputElement).value;
        const field = conflict.field;
        const element = document.getElementById(
          field === "triage_notes" ? "t-notes" : field === "fit_score" ? "t-fit" : "t-floor",
        ) as HTMLInputElement | HTMLTextAreaElement;
        if (chosen === "theirs") {
          element.value =
            field === "triage_notes"
              ? response.triage_notes ?? ""
              : field === "fit_score"
                ? response.fit_score === null ? "" : String(response.fit_score)
                : response.rate_floor_cents === null ? "" : centsToDecimalField(response.rate_floor_cents);
        } else {
          element.value = current[field];
        }
      });
      block.appendChild(group);
      region.appendChild(block);
    }
  }

  private async transition(id: string, version: number, to: string): Promise<void> {
    try {
      await apiFetch(`/api/console/enquiries/${id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
        body: JSON.stringify({ to }),
      });
      this.setConsoleStatus(to === "booked" ? COPY.productionStarted : COPY.triageSaved);
      await this.openEnquiry(id);
      await this.reloadEnquiries(false);
    } catch (error) {
      this.renderError(error);
      if (error instanceof ApiError && error.status === 412) {
        const current = (error.extras as { current?: Enquiry }).current;
        if (current) await this.renderEnquiryDetail(current, current.version);
      }
    }
  }

  private openProposalDialog(enquiry: Enquiry, version: number, opener: HTMLElement): void {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Build proposal");
    dialog.innerHTML = `
      <h3>Build proposal</h3>
      <form method="dialog">
        <div class="field"><label for="pr-producer-name">Producer name</label><input id="pr-producer-name" /></div>
        <div class="field"><label for="pr-producer-email">Producer email</label><input id="pr-producer-email" type="email" /></div>
        <div class="field"><label for="pr-title">Project title</label><input id="pr-title" /></div>
        <div class="field"><label for="pr-scope">Scope</label><textarea id="pr-scope"></textarea></div>
        <div class="field"><label for="pr-fee">Fee (USD)</label><input id="pr-fee" inputmode="decimal" /><p class="error" id="pr-fee-error" hidden></p></div>
        <div class="field"><label for="pr-month">Production month</label><select id="pr-month"></select><p class="error" id="pr-month-error" hidden></p></div>
        <table class="data" aria-label="Milestone preview"><thead><tr><th>Milestone</th><th>Share</th><th>Amount</th></tr></thead><tbody id="pr-preview"></tbody></table>
        <button class="btn btn-primary" id="pr-send" type="submit">Send proposal</button>
        <button class="btn" type="submit" id="pr-cancel" value="cancel">Cancel</button>
      </form>
    `;
    document.body.appendChild(dialog);
    dialog.showModal();
    (document.getElementById("pr-producer-name") as HTMLInputElement).focus();
    let months: MonthRow[] = [];
    const loadMonths = async (): Promise<void> => {
      const data = await apiFetch<{ months: MonthRow[] }>("/api/console/months");
      months = data.months;
      const select = document.getElementById("pr-month") as HTMLSelectElement;
      const focused = document.activeElement === select;
      const previous = select.value;
      select.replaceChildren();
      for (const month of months) {
        const option = document.createElement("option");
        option.value = month.month;
        option.textContent = month.open ? month.label : `${month.label} (full)`;
        if (!month.open) {
          option.setAttribute("aria-disabled", "true");
          option.disabled = true;
        }
        select.appendChild(option);
      }
      const openMonths = months.filter((month) => month.open);
      if (previous && months.some((m) => m.month === previous)) {
        select.value = previous;
      } else if (openMonths.length > 0) {
        select.value = openMonths[0].month;
      }
      refreshMonthStatus(select);
      if (focused) select.focus();
    };
    const refreshMonthStatus = (select: HTMLSelectElement): void => {
      const monthError = document.getElementById("pr-month-error") as HTMLElement;
      const selected = months.find((month) => month.month === select.value);
      const send = document.getElementById("pr-send") as HTMLButtonElement;
      if (selected && !selected.open) {
        monthError.textContent = COPY.monthFull(selected.label);
        monthError.hidden = false;
        send.disabled = true;
      } else {
        monthError.textContent = "";
        monthError.hidden = true;
        send.disabled = false;
      }
    };
    const previewFee = async (): Promise<void> => {
      const fee = parseMoneyField((document.getElementById("pr-fee") as HTMLInputElement).value);
      if (fee === null) {
        (document.getElementById("pr-preview") as HTMLElement).replaceChildren();
        return;
      }
      const data = await apiFetch<{ milestones: Milestone[] }>("/api/console/milestones/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fee_cents: fee }),
      });
      const rows = document.getElementById("pr-preview") as HTMLElement;
      rows.replaceChildren();
      for (const milestone of data.milestones) {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${milestone.name}</td><td>${milestone.percent}%</td><td class="amount">${formatMoney(milestone.amount_cents)}</td>`;
        rows.appendChild(row);
      }
    };
    let feeTimer: number | null = null;
    (document.getElementById("pr-fee") as HTMLInputElement).addEventListener("input", () => {
      if (feeTimer !== null) window.clearTimeout(feeTimer);
      feeTimer = window.setTimeout(() => void previewFee(), 300);
    });
    const select = document.getElementById("pr-month") as HTMLSelectElement;
    select.addEventListener("change", () => refreshMonthStatus(select));
    void loadMonths();
    const monthsTimer = window.setInterval(() => void loadMonths(), 2000);
    dialog.addEventListener("close", () => {
      window.clearInterval(monthsTimer);
      dialog.remove();
      opener.focus();
    });
    dialog.addEventListener("cancel", () => dialog.close());
    const form = dialog.querySelector("form") as HTMLFormElement;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if ((event.submitter as HTMLButtonElement)?.value === "cancel") {
        dialog.close();
        return;
      }
      const fee = parseMoneyField((document.getElementById("pr-fee") as HTMLInputElement).value);
      if (fee === null) return;
      if (enquiry.rate_floor_cents !== null && fee < enquiry.rate_floor_cents) {
        const feeError = document.getElementById("pr-fee-error") as HTMLElement;
        feeError.textContent = COPY.belowFloor(centsToDecimalField(enquiry.rate_floor_cents));
        feeError.hidden = false;
        return;
      }
      const payload = {
        producer_name: (document.getElementById("pr-producer-name") as HTMLInputElement).value,
        producer_email: (document.getElementById("pr-producer-email") as HTMLInputElement).value,
        project_title: (document.getElementById("pr-title") as HTMLInputElement).value,
        scope: (document.getElementById("pr-scope") as HTMLTextAreaElement).value,
        fee_cents: fee,
        production_month: select.value,
      };
      try {
        await apiFetch(`/api/console/enquiries/${enquiry.id}/proposal`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": `"${version}"` },
          body: JSON.stringify(payload),
        });
        this.setConsoleStatus(COPY.proposalSent(payload.producer_email));
        dialog.close();
        await this.openEnquiry(enquiry.id);
        await this.reloadEnquiries(false);
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          const errors = (error.extras as { errors?: Record<string, string> }).errors || {};
          for (const [field, message] of Object.entries(errors)) {
            const element = document.getElementById(`pr-${field.replace("_", "-")}-error`) as HTMLElement | null;
            if (element) {
              element.textContent = message;
              element.hidden = false;
            }
          }
          return;
        }
        this.renderError(error);
        dialog.close();
      }
    });
  }

  private milestoneList(enquiry: Enquiry): HTMLElement {
    const card = document.createElement("div");
    card.className = "panel-card";
    card.innerHTML = `<h3>Milestone invoices</h3>`;
    const listNode = document.createElement("ul");
    listNode.setAttribute("role", "list");
    listNode.setAttribute("aria-label", "Milestone invoices");
    listNode.tabIndex = -1;
    listNode.id = "milestone-list";
    const proposal = enquiry.proposal!;
    const names: Record<number, string> = { 2: "Vertical slice", 3: "Content complete", 4: "Final delivery" };
    const amounts: Record<number, number> = {};
    for (const milestone of proposal.milestones) amounts[milestone.number] = milestone.amount_cents;
    for (const number of [2, 3, 4]) {
      const item = document.createElement("li");
      item.className = "milestone-item";
      item.dataset.milestone = String(number);
      const invoiced = proposal.invoiced_milestones.includes(number);
      item.dataset.state = invoiced ? "invoiced" : "not-invoiced";
      item.innerHTML = `<span>Milestone ${number}: ${names[number]}, ${formatMoney(amounts[number])}. <span class="state">${invoiced ? COPY.invoiced : COPY.notInvoiced}</span></span>`;
      listNode.appendChild(item);
    }
    card.appendChild(listNode);
    const next = [2, 3, 4].find((number) => !proposal.invoiced_milestones.includes(number));
    if (next !== undefined) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-primary";
      button.id = `invoice-${next}`;
      button.textContent = `Invoice milestone ${next}`;
      button.addEventListener("click", () => void this.invoiceMilestone(enquiry, next));
      card.appendChild(button);
    }
    return card;
  }

  private updateMilestoneList(enquiry: Enquiry): void {
    const listNode = document.getElementById("milestone-list") as HTMLElement | null;
    if (!listNode || !enquiry.proposal) return;
    const proposal = enquiry.proposal;
    const names: Record<number, string> = { 2: "Vertical slice", 3: "Content complete", 4: "Final delivery" };
    const amounts: Record<number, number> = {};
    for (const milestone of proposal.milestones) amounts[milestone.number] = milestone.amount_cents;
    const focused = document.activeElement as HTMLElement | null;
    const focusedInvoice = focused && focused.id.startsWith("invoice-") ? focused : null;
    for (const item of Array.from(listNode.children)) {
      const number = Number.parseInt((item as HTMLElement).dataset.milestone || "0", 10);
      const invoiced = proposal.invoiced_milestones.includes(number);
      (item as HTMLElement).dataset.state = invoiced ? "invoiced" : "not-invoiced";
      const state = (item as HTMLElement).querySelector(".state") as HTMLElement;
      if (state) state.textContent = invoiced ? COPY.invoiced : COPY.notInvoiced;
    }
    const next = [2, 3, 4].find((number) => !proposal.invoiced_milestones.includes(number));
    const existing = document.getElementById(`invoice-${next ?? 0}`) as HTMLButtonElement | null;
    if (next !== undefined && !existing) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-primary";
      button.id = `invoice-${next}`;
      button.textContent = `Invoice milestone ${next}`;
      button.addEventListener("click", () => void this.invoiceMilestone(enquiry, next));
      listNode.parentElement?.appendChild(button);
    }
    if (focusedInvoice && focusedInvoice.parentElement === null) {
      listNode.focus();
    }
  }

  private async invoiceMilestone(enquiry: Enquiry, number: number): Promise<void> {
    // Optimistic state within 100ms (DP-64).
    const listNode = document.getElementById("milestone-list") as HTMLElement;
    const item = listNode.querySelector(`[data-milestone="${number}"]`) as HTMLElement;
    if (item) {
      item.dataset.state = "invoicing";
      const state = item.querySelector(".state") as HTMLElement;
      if (state) state.textContent = COPY.invoicing;
    }
    const button = document.getElementById(`invoice-${number}`) as HTMLButtonElement | null;
    if (button) button.remove();
    listNode.focus();
    try {
      const response = await fetch(`/api/console/enquiries/${enquiry.id}/milestones/${number}/invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": `"${this.detailVersion}"` },
        body: "{}",
      });
      if (response.status === 201) {
        const body = (await response.json()) as {
          milestone: { amount_cents: number; invoice_date: string };
          enquiry: Enquiry;
        };
        this.detailVersion = body.enquiry.version;
        this.setConsoleStatus(COPY.milestoneInvoiced(number, formatMoney(body.milestone.amount_cents), body.milestone.invoice_date));
        await this.renderEnquiryDetail(body.enquiry, body.enquiry.version);
        return;
      }
      const payload = (await response.json().catch(() => null)) as { error?: string; current?: Enquiry } | null;
      if (response.status === 412 && payload?.current) {
        this.detailVersion = payload.current.version;
        this.setConsoleStatus(COPY.milestoneStale);
        await this.renderEnquiryDetail(payload.current, payload.current.version);
        return;
      }
      if (response.status === 409 && payload?.error === "milestone_mismatch") {
        this.setConsoleStatus(COPY.milestoneMismatch(number));
      } else if (response.status === 503) {
        this.setConsoleStatus(COPY.billingDown);
      } else if (response.status === 0) {
        this.setConsoleStatus(COPY.milestoneNoResponse(number));
      } else {
        this.setConsoleStatus(COPY.milestoneOther(number));
      }
      const fresh = await fetch(`/api/console/enquiries/${enquiry.id}`);
      if (fresh.ok) {
        const body = (await fresh.json()) as { enquiry: Enquiry };
        this.detailVersion = body.enquiry.version;
        await this.renderEnquiryDetail(body.enquiry, body.enquiry.version);
      }
    } catch {
      this.setConsoleStatus(COPY.milestoneNoResponse(number));
      const fresh = await fetch(`/api/console/enquiries/${enquiry.id}`);
      if (fresh.ok) {
        const body = (await fresh.json()) as { enquiry: Enquiry };
        await this.renderEnquiryDetail(body.enquiry, body.enquiry.version);
      }
    }
  }

  // ---------------------------------------------------------------- months

  private async openMonths(): Promise<void> {
    const wrap = document.createElement("div");
    wrap.className = "panel-card";
    this.list.replaceChildren(wrap);
    await this.renderMonthsTable();
    this.monthsTimer = window.setInterval(() => void this.renderMonthsTable(false), 2000);
  }

  private async renderMonthsTable(initial: boolean = true): Promise<void> {
    const data = await apiFetch<{ months: MonthRow[] }>("/api/console/months");
    let card = document.getElementById("months-table") as HTMLElement | null;
    if (!card) {
      card = document.createElement("div");
      card.className = "panel-card";
      card.id = "months-table";
      this.detail.replaceChildren(card);
    }
    const dirty = new Set<string>();
    for (const input of Array.from(card.querySelectorAll<HTMLInputElement>("input"))) {
      if (input.dataset.dirty === "true" && input.dataset.month) dirty.add(input.dataset.month);
    }
    card.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = "Production months";
    card.appendChild(heading);
    const table = document.createElement("table");
    table.className = "data";
    table.setAttribute("aria-label", "Production months");
    table.innerHTML = `<thead><tr><th>Month</th><th>Capacity</th><th>Claimed</th></tr></thead>`;
    const body = document.createElement("tbody");
    for (const month of data.months) {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${month.label}</td>`;
      const capacityCell = document.createElement("td");
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "12";
      input.value = String(month.capacity);
      input.dataset.month = month.month;
      input.setAttribute("aria-label", `Capacity for ${month.label}`);
      input.addEventListener("input", () => {
        input.dataset.dirty = "true";
      });
      capacityCell.appendChild(input);
      row.appendChild(capacityCell);
      const claimed = document.createElement("td");
      claimed.className = "amount";
      claimed.textContent = String(month.claimed);
      row.appendChild(claimed);
      body.appendChild(row);
    }
    table.appendChild(body);
    card.appendChild(table);
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn btn-primary";
    save.textContent = "Save months";
    save.addEventListener("click", async () => {
      let allOk = true;
      const errors: string[] = [];
      for (const input of Array.from(card!.querySelectorAll("input"))) {
        const month = input.dataset.month;
        const capacity = Number.parseInt(input.value, 10);
        try {
          await apiFetch(`/api/console/months/${month}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ capacity }),
          });
          input.dataset.dirty = "false";
        } catch (error) {
          allOk = false;
          if (error instanceof ApiError && error.status === 422) {
            const record = data.months.find((entry) => entry.month === month);
            errors.push(COPY.monthsCapacity(record?.claimed ?? 0));
          }
        }
      }
      this.setConsoleStatus(allOk ? COPY.monthsSaved : errors[0] || COPY.checkFields);
      await this.renderMonthsTable(false);
    });
    card.appendChild(save);
    if (!initial) {
      // A re-read never moves focus; the table replaced itself.
    }
  }

  // -------------------------------------------------------------- settings

  private async openSettings(): Promise<void> {
    const settings = await apiFetch<{ time_zone: string; operator_email: string }>("/api/console/settings");
    const wrap = document.createElement("div");
    wrap.className = "panel-card";
    wrap.innerHTML = `
      <h3>Settings</h3>
      <div class="field"><label for="tz-select">Time zone</label>
        <select id="tz-select"></select></div>
      <button class="btn btn-primary" id="settings-save" type="button">Save settings</button>
      <p class="skip-note" id="settings-note"></p>
    `;
    this.detail.replaceChildren(wrap);
    const select = document.getElementById("tz-select") as HTMLSelectElement;
    const zones = Intl.supportedValuesOf("timeZone");
    for (const zone of zones) {
      const option = document.createElement("option");
      option.value = zone;
      option.textContent = zone.replace(/_/g, " ");
      select.appendChild(option);
    }
    select.value = settings.time_zone;
    (document.getElementById("settings-save") as HTMLButtonElement).addEventListener("click", async () => {
      try {
        await apiFetch("/api/console/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ time_zone: select.value }),
        });
        this.setConsoleStatus(COPY.settingsSaved);
      } catch (error) {
        if (error instanceof ApiError && error.status === 422) {
          this.setConsoleStatus(COPY.settingsInvalid);
          return;
        }
        this.renderError(error);
      }
    });
    const queueCard = document.createElement("div");
    queueCard.className = "panel-card";
    queueCard.id = "mail-queue-card";
    queueCard.innerHTML = `<h3>Mail queue</h3>`;
    const queueRegion = document.createElement("div");
    queueRegion.setAttribute("role", "region");
    queueRegion.setAttribute("aria-label", "Mail queue");
    queueCard.appendChild(queueRegion);
    this.detail.appendChild(queueCard);
    await this.renderMailQueue();
    this.mailTimer = window.setInterval(() => void this.renderMailQueue(), 2000);
    window.setInterval(() => this.tickCountdowns(), 1000);
  }

  private serverOffsetMs = 0;
  private lastMailRows: { kind: string; reference: string; to: string; retry_at: string | null }[] = [];

  private async renderMailQueue(): Promise<void> {
    const region = document.querySelector("#mail-queue-card [role=region]") as HTMLElement | null;
    if (!region) return;
    const focused = document.activeElement as HTMLElement | null;
    if (focused && focused.tagName === "SELECT" && focused.closest("#mail-queue-card") === null) {
      // The time zone form is untouched by queue redraws.
    }
    try {
      const data = await apiFetch<{
        server_time: string;
        emails: { kind: string; reference: string; to: string; queued_at: string; retry_at: string | null }[];
      }>("/api/console/mail-queue");
      this.serverOffsetMs = new Date(data.server_time).getTime() - Date.now();
      this.lastMailRows = data.emails;
      if (data.emails.length === 0) {
        region.innerHTML = `<p class="skip-note">${COPY.mailEmpty}</p>`;
        return;
      }
      const listNode = document.createElement("ul");
      listNode.setAttribute("role", "list");
      listNode.setAttribute("aria-label", "Pending emails");
      for (const email of data.emails) {
        const item = document.createElement("li");
        item.className = "mail-row";
        item.dataset.kind = email.kind;
        const label = kindLabel(email.kind);
        item.innerHTML = `<span>${label} for ${escapeHtml(email.reference)} to ${escapeHtml(email.to)}. <span class="countdown" data-retry="${email.retry_at ?? ""}"></span></span>`;
        listNode.appendChild(item);
      }
      region.replaceChildren(listNode);
      this.tickCountdowns();
      region.dataset.error = "";
    } catch {
      if (!region.dataset.error) {
        const note = document.createElement("p");
        note.className = "skip-note";
        note.textContent = COPY.mailFailed;
        region.appendChild(note);
        region.dataset.error = "1";
      }
    }
  }

  private tickCountdowns(): void {
    const region = document.querySelector("#mail-queue-card [role=region]") as HTMLElement | null;
    if (!region) return;
    const correctedNow = Date.now() + this.serverOffsetMs;
    for (const element of Array.from(region.querySelectorAll<HTMLElement>(".countdown"))) {
      const retry = element.dataset.retry || "";
      if (!retry) {
        element.textContent = "Sending";
        continue;
      }
      const at = new Date(retry).getTime();
      if (correctedNow < at) {
        const seconds = Math.ceil((at - correctedNow) / 1000);
        element.textContent = `Next try in ${seconds}s`;
      } else {
        element.textContent = "Retrying";
      }
    }
  }

  // ---------------------------------------------------------------- status

  private setConsoleStatus(message: string): void {
    this.consoleStatus = message;
    const announcer = document.getElementById("announcer") as HTMLElement;
    announcer.textContent = message;
    this.status.textContent = message;
  }

  private renderError(error: unknown): void {
    if (error instanceof ApiError) {
      if (error.status === 409 && error.code === "slug_taken") {
        this.setConsoleStatus(COPY.slugTaken);
        return;
      }
      if (error.status === 422) {
        this.setConsoleStatus(COPY.checkFields);
        return;
      }
      if (error.status === 503) {
        const code = error.code;
        this.setConsoleStatus(code === "billing_unavailable" ? COPY.billingDown : COPY.storageDown);
        return;
      }
      if (error.status === 409 && error.code === "link_not_active") {
        this.setConsoleStatus(COPY.linkNotActive);
        return;
      }
      if (error.status === 409 && error.code === "illegal_transition") {
        this.setConsoleStatus(COPY.illegal);
        return;
      }
      if (error.status === 412) {
        this.setConsoleStatus(COPY.staleOther);
        return;
      }
    }
    this.setConsoleStatus("Something went wrong.");
  }
}

function mergeFields(
  loaded: Record<string, string | null>,
  response: Enquiry,
  current: Record<string, string | null>,
): { field: "triage_notes" | "fit_score" | "rate_floor_cents"; theirs: string; yours: string }[] {
  const conflicts: { field: "triage_notes" | "fit_score" | "rate_floor_cents"; theirs: string; yours: string }[] = [];
  const theirs: Record<string, string | null> = {
    triage_notes: response.triage_notes,
    fit_score: response.fit_score === null ? null : String(response.fit_score),
    rate_floor_cents: response.rate_floor_cents === null ? null : centsToDecimalField(response.rate_floor_cents),
  };
  const order: Array<"triage_notes" | "fit_score" | "rate_floor_cents"> = ["triage_notes", "fit_score", "rate_floor_cents"];
  for (const field of order) {
    const before = loaded[field] ?? null;
    const fromServer = theirs[field] ?? null;
    const typed = current[field] ?? null;
    const otherChanged = before !== fromServer;
    const mineChanged = before !== typed;
    if (otherChanged && mineChanged && typed !== fromServer) {
      conflicts.push({ field, theirs: fromServer === null ? "(empty)" : fromServer, yours: typed === null ? "(empty)" : typed });
    } else if (otherChanged && !mineChanged) {
      // Only the other window changed it: take theirs.
      const element = document.getElementById(
        field === "triage_notes" ? "t-notes" : field === "fit_score" ? "t-fit" : "t-floor",
      ) as HTMLInputElement | HTMLTextAreaElement;
      element.value = fromServer === null ? "" : fromServer;
    }
  }
  return conflicts;
}

function deliverySentence(kind: string, reference: string): string {
  switch (kind) {
    case "receipt":
      return COPY.receiptSent(reference);
    case "proposal":
      return COPY.proposalEmailSent(reference);
    case "month_held":
      return COPY.monthHeldSent(reference);
    default:
      return COPY.depositSent(reference);
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "receipt":
      return "Receipt";
    case "alert":
      return "New-brief alert";
    case "proposal":
      return "Proposal email";
    case "month_held":
      return "Month-held email";
    default:
      return "Deposit email";
  }
}

function timeZoneForDisplay(): string {
  const stored = (window as unknown as { OPERATOR_TZ?: string }).OPERATOR_TZ;
  return stored || "America/Toronto";
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

const consolePage = new Console();
void consolePage.init();
