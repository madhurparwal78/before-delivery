// A project: header with the live quota meter and the Quota status region, then one tab per route.
import { OPEN_CORRECTION_STATES, type ApiKey, type Correction, type Project, type Quota, type Session, type SynthesisJob } from "../../shared/types";
import { allows, TAB_ACTION, type ProjectTab } from "../../shared/permissions";
import { minutesText, quotaPercent } from "../../shared/billing";
import { api, audioBlob, GENERIC_FAILURE, STORAGE_OUTAGE, upload } from "../api";
import { openDialog } from "../dialog";
import { cardTable, field, h, icon, replace, say, svg, uid } from "../dom";
import { clock, dayMonthYear, quotaBanner, seconds3, stamp, STATE_LABEL } from "../format";
import { navigate, redirectToLanding, type Page } from "../main";

const TABS: { tab: ProjectTab; label: string }[] = [
  { tab: "keys", label: "Keys" },
  { tab: "sessions", label: "Sessions" },
  { tab: "review", label: "Review" },
  { tab: "synthesis", label: "Synthesis" },
  { tab: "settings", label: "Settings" },
];

interface Context {
  page: Page;
  project: Project;
  panel: HTMLElement;
  /** Re-reads the project so the meter and the Quota status follow a change at once. */
  refresh(): Promise<void>;
  showQuota(quota: Quota): void;
}

export function renderProject(page: Page): void {
  const [projectId, requested] = page.params;
  const role = page.me.user.role;
  const allowed = TABS.filter((t) => allows(role, TAB_ACTION[t.tab]));
  const current = allowed.find((t) => t.tab === requested);
  if (!current) {
    if (!requested && allowed[0]) navigate(`/console/projects/${projectId}/${allowed[0].tab}`, { replace: true });
    else redirectToLanding(role);
    return;
  }
  const name = h("h1", {}, h("span", { class: "skeleton-text" }, "Project"));
  const fill = h("span", { class: "meter-fill" });
  const meter = h("div", { role: "progressbar", "aria-label": "Quota used", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": 0, class: "meter" }, fill);
  const meterText = h("span", { class: "num meter-text" }, "—");
  const resets = h("span", { class: "muted" });
  const quotaStatus = h("div", { role: "status", "aria-label": "Quota status", class: "quota-status" });
  const tabIds = Object.fromEntries(allowed.map((t) => [t.tab, uid("tab")]));
  const panelId = uid("panel");
  const tablist = h(
    "div",
    { role: "tablist", "aria-label": "Project", class: "tabs" },
    ...allowed.map((t) =>
      h(
        "a",
        {
          role: "tab",
          id: tabIds[t.tab],
          href: `/console/projects/${projectId}/${t.tab}`,
          "aria-selected": String(t.tab === current.tab),
          "aria-controls": panelId,
          tabindex: t.tab === current.tab ? 0 : -1,
        },
        t.label,
      ),
    ),
  );
  tablist.addEventListener("keydown", (event) => {
    const tabs = [...tablist.querySelectorAll<HTMLAnchorElement>("[role=tab]")];
    const at = tabs.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0 || (event.key !== "ArrowRight" && event.key !== "ArrowLeft")) return;
    event.preventDefault();
    tabs[(at + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].focus();
  });
  const panel = h("section", { role: "tabpanel", id: panelId, "aria-labelledby": tabIds[current.tab], class: "tab-panel" });
  page.root.append(
    h(
      "header",
      { class: "project-head" },
      h("nav", { "aria-label": "Breadcrumb", class: "crumbs" }, h("a", { href: "/console/projects" }, "Projects")),
      h("div", { class: "project-title" }, name, h("div", { class: "quota" }, h("div", { class: "quota-line" }, h("span", { class: "label" }, "Quota used"), meterText, resets), meter)),
      quotaStatus,
    ),
    tablist,
    panel,
  );

  const showQuota = (quota: Quota) => {
    const percent = quotaPercent(quota.used_seconds, quota.limit_minutes);
    meter.setAttribute("aria-valuenow", String(percent));
    meter.setAttribute("aria-valuetext", `${minutesText(quota.used_seconds)} of ${quota.limit_minutes} minutes`);
    fill.style.inlineSize = `${percent}%`;
    meter.classList.toggle("exhausted", quota.exhausted);
    say(meterText, `${minutesText(quota.used_seconds)} / ${quota.limit_minutes} min`);
    say(resets, `Resets ${dayMonthYear(quota.resets_at)} UTC`);
    const banner = quota.exhausted ? quotaBanner(quota) : "";
    if (quotaStatus.textContent !== banner) replace(quotaStatus, banner ? h("p", { class: "banner caution" }, banner) : null);
  };

  const load = async (): Promise<Project | null> => {
    const found = await api<{ project: Project }>("GET", `/api/projects/${projectId}`);
    if (!page.current()) return null;
    if (!found.ok) {
      if (found.status === 404) replace(panel, h("p", { class: "empty" }, "This project doesn't exist or isn't assigned to you."));
      return null;
    }
    say(name, found.data.project.name);
    showQuota(found.data.project.quota);
    return found.data.project;
  };

  void (async () => {
    const project = await load();
    if (!project) return;
    // The meter follows accruing audio within the published delay.
    const poll = setInterval(() => void load(), 1000);
    page.onLeave(() => clearInterval(poll));
    const context: Context = { page, project, panel, showQuota, refresh: async () => void (await load()) };
    ({ keys: keysTab, sessions: sessionsTab, review: reviewTab, synthesis: synthesisTab, settings: settingsTab })[current.tab](context);
  })();
}

// ---------------- Keys ----------------
function keysTab({ page, project, panel }: Context): void {
  const status = h("p", { role: "status", "aria-label": "Keys status", class: "status-line" });
  const issue = h("button", { type: "button", class: "primary" }, icon("key"), "Issue key");
  const body = h("tbody");
  const table = h(
    "table",
    { class: "data", "aria-label": "API keys", tabindex: -1 },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Name"), h("th", { scope: "col" }, "Prefix"), h("th", { scope: "col" }, "Created"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col" }, h("span", { class: "visually-hidden" }, "Actions")))),
    body,
  );
  panel.append(h("div", { class: "toolbar" }, h("p", { class: "muted" }, "Keys authenticate /v1 requests. A secret is shown once and stored only as a hash."), issue), status, h("div", { class: "table-wrap", tabindex: 0 }, table));
  if (page.handover.keysStatus) say(status, page.handover.keysStatus);

  const revokeTarget = h("strong");
  const confirm = h("button", { type: "button", class: "danger" }, "Revoke key");
  const cancelRevoke = h("button", { type: "button", class: "secondary" }, "Cancel");
  const revokeDialog = h(
    "dialog",
    { "aria-label": "Revoke key", class: "modal" },
    h("h2", {}, "Revoke key"),
    h("p", {}, "Revoking ", revokeTarget, " ends every live session streaming on it and refuses every later request made with it."),
    h("div", { class: "button-row end" }, cancelRevoke, confirm),
  );
  let revoking: ApiKey | null = null;
  let closeRevoke: (() => void) | null = null;
  cancelRevoke.addEventListener("click", () => closeRevoke?.());
  confirm.addEventListener("click", async () => {
    if (!revoking) return;
    confirm.disabled = true;
    const result = await api<{ key: ApiKey; closed_sessions: string[] }>("DELETE", `/api/projects/${project.id}/keys/${revoking.id}`);
    confirm.disabled = false;
    closeRevoke?.();
    say(status, result.ok ? `Key revoked. Live sessions closed: ${result.data.closed_sessions.length}.` : result.error.error === "already_revoked" ? "This key was already revoked." : GENERIC_FAILURE);
    await list();
    table.focus();
  });

  const list = async () => {
    const found = await api<{ keys: ApiKey[] }>("GET", `/api/projects/${project.id}/keys`);
    if (!found.ok || !page.current()) return;
    if (found.data.keys.length === 0) {
      replace(body, h("tr", {}, h("td", { colspan: 5, class: "empty" }, "No keys yet. Issue one to start streaming.")));
      return;
    }
    replace(
      body,
      ...found.data.keys.map((key) => {
        const revoke = key.revoked_at ? null : h("button", { type: "button", class: "secondary small", "aria-label": `Revoke ${key.name}` }, "Revoke");
        revoke?.addEventListener("click", () => {
          revoking = key;
          revokeTarget.textContent = key.name;
          closeRevoke = openDialog(revokeDialog, revoke, { initialFocus: cancelRevoke, returnFocus: () => (revoke.isConnected ? revoke : table) });
        });
        return h(
          "tr",
          {},
          h("th", { scope: "row" }, key.name),
          h("td", { class: "num" }, `${key.prefix}…`),
          h("td", { class: "num" }, stamp(key.created_at)),
          h("td", {}, key.revoked_at ? h("span", { class: "badge" }, `Revoked ${stamp(key.revoked_at)}`) : h("span", { class: "badge outline" }, "Active")),
          h("td", { class: "right" }, revoke),
        );
      }),
    );
  };
  void list();

  const keyName = h("input", { type: "text", autocomplete: "off", maxlength: 80 });
  const nameField = field("Key name", keyName);
  const create = h("button", { type: "submit", class: "primary" }, "Create key");
  const secret = h("input", { type: "text", readonly: true, class: "num secret" });
  const copy = h("button", { type: "button", class: "secondary" }, icon("copy"), "Copy key");
  const copied = h("p", { class: "hint", "aria-live": "polite" });
  const done = h("button", { type: "button", class: "secondary" }, "Done");
  const form = h("form", { novalidate: true, class: "stack" }, nameField.root, h("div", { class: "button-row end" }, create));
  const reveal = h("div", { class: "stack", hidden: true }, field("New key", secret, "Copy it now. It won't be shown again.").root, h("div", { class: "button-row" }, copy, done), copied);
  const issueDialog = h("dialog", { "aria-label": "Issue key", class: "modal" }, h("h2", {}, "Issue key"), form, reveal);
  panel.append(revokeDialog, issueDialog);
  let closeIssue: (() => void) | null = null;
  issue.addEventListener("click", () => {
    keyName.value = "";
    secret.value = "";
    nameField.error(null);
    form.hidden = false;
    reveal.hidden = true;
    copied.textContent = "";
    closeIssue = openDialog(issueDialog, issue, { initialFocus: keyName, onClose: () => (secret.value = "") });
  });
  done.addEventListener("click", () => closeIssue?.());
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(secret.value).then(
      () => (copied.textContent = "Copied to the clipboard."),
      () => (copied.textContent = "Select the key and copy it."),
    );
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    nameField.error(null);
    create.disabled = true;
    const result = await api<{ key: ApiKey; secret: string }>("POST", `/api/projects/${project.id}/keys`, { name: keyName.value });
    create.disabled = false;
    if (!result.ok) {
      if (result.error.fields?.name) nameField.error(result.error.fields.name);
      else say(status, GENERIC_FAILURE);
      return;
    }
    secret.value = result.data.secret;
    form.hidden = true;
    reveal.hidden = false;
    secret.focus();
    secret.select();
    say(status, "Key created. Copy it now; it won't be shown again.");
    await list();
  });
  page.onLeave(() => {
    closeIssue?.();
    closeRevoke?.();
  });
}

// ---------------- Sessions ----------------
function thumbnail(mean: readonly number[], sessionId: string): SVGElement {
  const bars = mean.length ? mean : new Array<number>(64).fill(0);
  return svg(
    "svg",
    { role: "img", "aria-label": "Spectrum thumbnail", "data-morph": sessionId, viewBox: "0 0 64 24", preserveAspectRatio: "none", class: "thumb" },
    ...bars.map((v, i) => svg("rect", { x: i + 0.15, y: 24 - Math.max(0.6, v * 24), width: 0.7, height: Math.max(0.6, v * 24) })),
  );
}

async function activeKeys(projectId: string): Promise<ApiKey[]> {
  const found = await api<{ keys: ApiKey[] }>("GET", `/api/projects/${projectId}/keys`);
  return found.ok ? found.data.keys.filter((k) => !k.revoked_at) : [];
}

function keySelect(): HTMLSelectElement {
  return h("select", {}, h("option", { value: "" }, "Choose a key"));
}

function fillKeys(select: HTMLSelectElement, keys: ApiKey[]): void {
  replace(select, h("option", { value: "" }, "Choose a key"), ...keys.map((k) => h("option", { value: k.id }, k.name)));
}

function sessionsTab({ page, project, panel, showQuota, refresh }: Context): void {
  const canOperate = allows(page.me.user.role, "sessions.operate");
  const startButton = canOperate ? h("button", { type: "button", class: "primary" }, icon("play"), "Start session") : null;
  const body = h("tbody", {}, h("tr", { class: "skeleton" }, h("td", { colspan: 7 }, h("span", { class: "bar" }))));
  const table = h(
    "table",
    { class: "data sessions cards", "aria-label": "Sessions" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, "Spectrum"),
        h("th", { scope: "col" }, "Label"),
        h("th", { scope: "col" }, "Kind"),
        h("th", { scope: "col" }, "State"),
        h("th", { scope: "col", class: "right" }, "Audio"),
        h("th", { scope: "col", class: "right" }, "Billable min"),
        h("th", { scope: "col" }, "Started"),
      ),
    ),
    body,
  );
  panel.append(h("div", { class: "toolbar" }, h("p", { class: "muted" }, "Live streams, replays and test tones, newest first."), startButton), h("div", { class: "table-wrap", tabindex: 0 }, table));
  const rows = new Map<string, { tr: HTMLTableRowElement; cells: HTMLTableCellElement[] }>();

  const list = async () => {
    const found = await api<{ sessions: Session[] }>("GET", `/api/projects/${project.id}/sessions`);
    if (!found.ok || !page.current()) return;
    if (found.data.sessions.length === 0) {
      replace(body, h("tr", {}, h("td", { colspan: 7, class: "empty" }, "No sessions yet. Start a test tone or stream to the live endpoint.")));
      rows.clear();
      return;
    }
    if (rows.size === 0) body.replaceChildren();
    found.data.sessions.forEach((s, i) => {
      let row = rows.get(s.id);
      if (!row) {
        const link = h("a", { href: `/console/sessions/${s.id}` }, s.label);
        const thumbCell = h("td", { class: "thumb-cell" });
        link.addEventListener("click", (event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          const picture = thumbCell.querySelector("[data-morph]")!;
          navigate(`/console/sessions/${s.id}`, { handover: { morph: { id: s.id, rect: picture.getBoundingClientRect(), thumbnail: picture, label: s.label } } });
        });
        const cells = [thumbCell, h("th", { scope: "row", class: "label-cell" }, link), h("td"), h("td"), h("td", { class: "num right" }), h("td", { class: "num right" }), h("td", { class: "num" })];
        row = { tr: h("tr", {}, ...cells), cells };
        rows.set(s.id, row);
      }
      const [thumbCell, , kind, state, audio, billable, started] = row.cells;
      if (thumbCell.dataset.mean !== s.mean.join(",")) {
        thumbCell.dataset.mean = s.mean.join(",");
        replace(thumbCell, thumbnail(s.mean, s.id));
      }
      say(kind, s.kind === "live" ? "Live" : s.source === "tone" ? "Replay · tone" : "Replay · upload");
      if (state.textContent !== STATE_LABEL[s.state]) replace(state, h("span", { class: `chip state-${s.state}` }, STATE_LABEL[s.state]));
      say(audio, clock(s.audio_ms));
      say(billable, s.billable_seconds === null ? "—" : minutesText(s.billable_seconds));
      say(started, stamp(s.started_at));
      if (body.children[i] !== row.tr) body.insertBefore(row.tr, body.children[i] ?? null);
    });
    cardTable(table);
  };
  void list();
  const poll = setInterval(() => void list(), 2000);
  page.onLeave(() => clearInterval(poll));
  if (!startButton) return;

  // ---- Start session ----
  const keyPicker = keySelect();
  const keyField = field("API key", keyPicker);
  const tone = h("input", { type: "radio", name: "source", value: "tone", id: uid("tone"), checked: true });
  const uploadRadio = h("input", { type: "radio", name: "source", value: "upload", id: uid("upload") });
  const sourceGroup = h(
    "fieldset",
    { role: "radiogroup", "aria-label": "Source", class: "choices" },
    h("legend", {}, "Source"),
    h("label", { for: tone.id, class: "choice" }, tone, h("span", {}, "Test tone (1 kHz)")),
    h("label", { for: uploadRadio.id, class: "choice" }, uploadRadio, h("span", {}, "Upload recording")),
  );
  const audioInput = h("input", { type: "file", accept: ".wav,audio/wav,audio/x-wav" });
  const sidecarInput = h("input", { type: "file", accept: ".vtt,text/vtt" });
  const audioField = field("Audio file", audioInput, "16 kHz, 16-bit PCM WAV, mono or stereo, up to 50,000,000 bytes.");
  const sidecarField = field("Sidecar (WebVTT)", sidecarInput, "Optional. One word@confidence token per word.");
  const uploads = h("div", { class: "stack", hidden: true }, audioField.root, sidecarField.root);
  const label = h("input", { type: "text", autocomplete: "off", maxlength: 120 });
  const labelField = field("Label", label);
  const progress = h("div", { class: "upload-progress", hidden: true }, h("span"));
  const uploadStatus = h("div", { role: "status", "aria-label": "Upload status", class: "status-line" });
  const start = h("button", { type: "submit", class: "primary" }, "Start");
  const cancel = h("button", { type: "button", class: "secondary" }, "Cancel");
  const form = h("form", { novalidate: true, class: "stack" }, keyField.root, sourceGroup, uploads, labelField.root, progress, uploadStatus, h("div", { class: "button-row end" }, cancel, start));
  const dialog = h("dialog", { "aria-label": "Start session", class: "modal" }, h("h2", {}, "Start session"), form);
  panel.append(dialog);
  let handle: (() => void) | null = null;
  let idempotencyKey = "";
  const sync = () => (uploads.hidden = !uploadRadio.checked);
  tone.addEventListener("change", sync);
  uploadRadio.addEventListener("change", sync);
  cancel.addEventListener("click", () => handle?.());
  page.onLeave(() => handle?.());
  startButton.addEventListener("click", async () => {
    // One Idempotency-Key per opened dialog: pressing Start twice creates one session.
    idempotencyKey = crypto.randomUUID();
    for (const f of [keyField, audioField, sidecarField, labelField]) f.error(null);
    uploadStatus.replaceChildren();
    progress.hidden = true;
    handle = openDialog(dialog, startButton, { initialFocus: keyPicker });
    fillKeys(keyPicker, await activeKeys(project.id));
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    for (const f of [keyField, audioField, sidecarField, labelField]) f.error(null);
    const data = new FormData();
    data.append("key_id", keyPicker.value);
    data.append("source", uploadRadio.checked ? "upload" : "tone");
    if (label.value.trim()) data.append("label", label.value);
    if (uploadRadio.checked && audioInput.files?.[0]) data.append("audio", audioInput.files[0]);
    if (uploadRadio.checked && sidecarInput.files?.[0]) data.append("sidecar", sidecarInput.files[0]);
    replace(uploadStatus, h("p", {}, "Uploading audio"));
    progress.hidden = false;
    const bar = progress.firstElementChild as HTMLElement;
    bar.style.inlineSize = "0%";
    const result = await upload<{ session: Session }>(`/api/projects/${project.id}/sessions`, data, { "Idempotency-Key": idempotencyKey }, (fraction) => {
      bar.style.inlineSize = `${Math.round(fraction * 100)}%`;
    });
    if (!page.current()) return;
    progress.hidden = true;
    if (result.ok) {
      handle?.();
      navigate(`/console/sessions/${result.data.session.id}`);
      return;
    }
    const { error, status } = result;
    if (status === 413) {
      uploadStatus.replaceChildren();
      audioField.error("Audio files can be up to 50,000,000 bytes.");
    } else if (error.error === "validation_failed") {
      uploadStatus.replaceChildren();
      keyField.error(error.fields?.key_id ?? null);
      audioField.error(error.fields?.audio ?? null);
      sidecarField.error(error.fields?.sidecar ?? null);
      labelField.error(error.fields?.label ?? null);
    } else if (error.error === "quota_exhausted") {
      const fresh = await api<{ project: Project }>("GET", `/api/projects/${project.id}`);
      if (fresh.ok) {
        showQuota(fresh.data.project.quota);
        replace(uploadStatus, h("p", { class: "banner caution" }, quotaBanner(fresh.data.project.quota)));
      }
    } else if (error.error === "storage_unavailable") replace(uploadStatus, h("p", { class: "banner caution" }, STORAGE_OUTAGE));
    else if (error.error === "key_revoked") keyField.error("Choose an active API key.");
    else replace(uploadStatus, h("p", {}, GENERIC_FAILURE));
    void refresh();
  });
}

// ---------------- Review ----------------
function reviewTab({ page, project, panel }: Context): void {
  const awaitingBody = h("tbody");
  const mineBody = h("tbody");
  const columns = (last: string) =>
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Session"), h("th", { scope: "col" }, "Correction"), h("th", { scope: "col" }, "Author"), h("th", { scope: "col" }, "Updated"), h("th", { scope: "col" }, last)));
  panel.append(
    h("h2", { class: "section-title" }, "Awaiting approval"),
    h("div", { class: "table-wrap", tabindex: 0 }, h("table", { class: "data", "aria-label": "Awaiting approval" }, columns("Open"), awaitingBody)),
    h("h2", { class: "section-title" }, "Your open corrections"),
    h("div", { class: "table-wrap", tabindex: 0 }, h("table", { class: "data", "aria-label": "Your open corrections" }, columns("State"), mineBody)),
  );
  void (async () => {
    const [corrections, sessions] = await Promise.all([
      api<{ corrections: Correction[] }>("GET", `/api/projects/${project.id}/corrections`),
      api<{ sessions: Session[] }>("GET", `/api/projects/${project.id}/sessions`),
    ]);
    if (!page.current() || !corrections.ok) return;
    const labels = new Map(sessions.ok ? sessions.data.sessions.map((s) => [s.id, s.label]) : []);
    const row = (c: Correction, last: Node) =>
      h("tr", {}, h("th", { scope: "row" }, labels.get(c.session_id) ?? "Session"), h("td", { class: "correction-text" }, c.text), h("td", {}, c.author.name), h("td", { class: "num" }, stamp(c.submitted_at ?? c.created_at)), h("td", {}, last));
    const href = (c: Correction) => `/console/sessions/${c.session_id}?segment=${c.segment_id}`;
    const awaiting = corrections.data.corrections.filter((c) => c.state === "submitted");
    const mine = corrections.data.corrections.filter((c) => c.author.id === page.me.user.id && OPEN_CORRECTION_STATES.includes(c.state));
    replace(awaitingBody, ...(awaiting.length ? awaiting.map((c) => row(c, h("a", { href: href(c) }, "Open correction"))) : [h("tr", {}, h("td", { colspan: 5, class: "empty" }, "Nothing is waiting for approval."))]));
    replace(
      mineBody,
      ...(mine.length
        ? mine.map((c) => row(c, h("a", { href: href(c), "aria-label": `Continue ${c.state} correction` }, { draft: "Draft", submitted: "Submitted", returned: "Returned", approved: "Approved" }[c.state])))
        : [h("tr", {}, h("td", { colspan: 5, class: "empty" }, "You have no open corrections."))]),
    );
  })();
}

// ---------------- Synthesis ----------------
function synthesisTab({ page, project, panel }: Context): void {
  const keyPicker = keySelect();
  const keyField = field("API key", keyPicker);
  const text = h("textarea", { rows: 4, maxlength: 1100 });
  const textField = field("Text to speak", text, "300 ms of procedural formant tones per word.");
  const lumen = h("input", { type: "radio", name: "voice", value: "lumen", id: uid("lumen"), checked: true });
  const basalt = h("input", { type: "radio", name: "voice", value: "basalt", id: uid("basalt") });
  const voices = h(
    "fieldset",
    { role: "radiogroup", "aria-label": "Voice", class: "choices" },
    h("legend", {}, "Voice"),
    h("label", { for: lumen.id, class: "choice" }, lumen, h("span", {}, "Lumen")),
    h("label", { for: basalt.id, class: "choice" }, basalt, h("span", {}, "Basalt")),
  );
  const render = h("button", { type: "submit", class: "primary" }, "Render");
  const status = h("p", { role: "status", "aria-label": "Synthesis status", class: "status-line" });
  const player = h("audio", { controls: true, "aria-label": "Rendered audio", preload: "none", class: "player" });
  const form = h("form", { novalidate: true, class: "stack narrow" }, keyField.root, textField.root, voices, h("div", { class: "button-row" }, render), status);
  panel.append(h("div", { class: "split" }, form, h("div", { class: "rendered" }, h("h2", { class: "section-title" }, "Last rendered audio"), player)));
  void activeKeys(project.id).then((keys) => page.current() && fillKeys(keyPicker, keys));
  // A failed load asks the same route why: a storage outage shows its banner.
  player.addEventListener("error", () => void (player.src && audioBlob(player.src)));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    keyField.error(null);
    textField.error(null);
    say(status, "Rendering");
    render.disabled = true;
    const result = await api<{ job: SynthesisJob }>("POST", `/api/projects/${project.id}/synthesis`, { key_id: keyPicker.value, text: text.value, voice: basalt.checked ? "basalt" : "lumen" }, { storage: true });
    render.disabled = false;
    if (result.ok) {
      say(status, `Rendered ${seconds3(result.data.job.duration_ms)} seconds of audio.`);
      player.src = result.data.job.console_audio_url;
      return;
    }
    if (result.error.fields) {
      say(status, "");
      keyField.error(result.error.fields.key_id ?? null);
      textField.error(result.error.fields.text ?? null);
    } else if (result.error.error === "key_revoked") {
      say(status, "");
      keyField.error("Choose an active API key.");
    } else say(status, result.error.error === "storage_unavailable" ? STORAGE_OUTAGE : GENERIC_FAILURE);
  });
}

// ---------------- Settings ----------------
function settingsTab({ project, panel, refresh }: Context): void {
  const quota = h("input", { type: "text", inputmode: "numeric", autocomplete: "off", value: String(project.quota.limit_minutes) });
  const quotaField = field("Monthly quota (minutes)", quota, "Whole minutes, 1 to 1000000. Raising it above usage allows new sessions at once.");
  const save = h("button", { type: "submit", class: "primary" }, "Save quota");
  const status = h("p", { role: "status", "aria-label": "Settings status", class: "status-line" });
  const form = h("form", { novalidate: true, class: "stack narrow" }, quotaField.root, h("div", { class: "button-row" }, save), status);
  panel.append(form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    quotaField.error(null);
    const value = /^\d+$/.test(quota.value.trim()) ? Number(quota.value.trim()) : quota.value;
    save.disabled = true;
    const result = await api<{ quota: Quota }>("PATCH", `/api/projects/${project.id}/quota`, { monthly_quota_minutes: value });
    save.disabled = false;
    if (result.ok) {
      say(status, "Quota saved.");
      await refresh();
    } else if (result.error.fields?.monthly_quota_minutes) {
      say(status, "");
      quotaField.error(result.error.fields.monthly_quota_minutes);
    } else say(status, GENERIC_FAILURE);
  });
}
