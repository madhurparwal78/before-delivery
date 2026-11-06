// The staff side: sign-in, the restatement list, the restatement editor with
// its review checklist, dialogs, exhibit uploads and the interrupted-action
// sign-in flow. Dialog outcomes stay with their dialog session.

import {
  COPY,
  ROW_KEYS,
  ROW_LABELS,
  apiJson,
  etWallSeconds,
  ApiFailure,
  type AuditEntry,
  type Restatement,
  type StaffUser,
} from "./app.js";

const POLL_MS = 4_000;

// ---------------------------------------------------------------------------
// Sign-in.

export async function handleSignIn(form: HTMLFormElement, onSignedIn: (user: StaffUser) => void): Promise<void> {
  const status = form.querySelector<HTMLElement>("[data-signin-status]");
  const submit = async () => {
    const email = (form.querySelector<HTMLInputElement>("[data-field='email']")?.value ?? "").trim();
    const password = form.querySelector<HTMLInputElement>("[data-field='password']")?.value ?? "";
    try {
      const result = await apiJson<{ user: StaffUser }>("POST", "/api/session", { email, password });
      onSignedIn(result.user);
    } catch (err) {
      if (status) status.textContent = COPY.signInFailed;
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
}

// ---------------------------------------------------------------------------
// Restatement list.

export function mountRestatementList(root: HTMLElement, onOpen: (id: string) => void): void {
  const user = currentUser();
  renderToolbar();
  void refreshList();

  function renderToolbar(): void {
    const toolbar = root.querySelector<HTMLElement>("[data-toolbar]");
    if (!toolbar || !user) return;
    toolbar.textContent = "";
    if (user.roles.includes("treasury_analyst")) {
      const weekly = document.createElement("button");
      weekly.textContent = "New weekly draft";
      weekly.addEventListener("click", () => void createDraft(root, {}));
      toolbar.appendChild(weekly);
      const correction = document.createElement("button");
      correction.textContent = "Start correction";
      correction.addEventListener("click", () => {
        const latest = latestPublishedId();
        if (latest) void createDraft(root, { supersedes: latest });
      });
      toolbar.appendChild(correction);
    }
    const signOut = document.createElement("button");
    signOut.textContent = "Sign out";
    signOut.addEventListener("click", () => void signOutAndReload());
    toolbar.appendChild(signOut);
  }

  async function createDraft(host: HTMLElement, body: Record<string, unknown>): Promise<void> {
    try {
      const result = await apiJson<{ restatement: Restatement }>("POST", "/api/restatements", body);
      onOpen(result.restatement.id);
    } catch {
      showStaffUpdate(host, COPY.unexpected);
    }
  }

  async function signOutAndReload(): Promise<void> {
    try {
      await apiJson<unknown>("DELETE", "/api/session");
    } catch {
      // Signing out is best-effort; the board is public anyway.
    }
    window.location.href = "/staff";
  }

  function latestPublishedId(): string | null {
    const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("[data-restatement-row]"));
    for (const row of rows) {
      if (row.dataset.state === "published") return row.dataset.restatementId ?? null;
    }
    return null;
  }

  async function refreshList(): Promise<void> {
    try {
      const result = await apiJson<{ restatements: Restatement[] }>("GET", "/api/restatements");
      renderRows(result.restatements);
    } catch {
      // The list keeps its last loaded state.
    }
  }

  function renderRows(restatements: Restatement[]): void {
    const tbody = root.querySelector<HTMLTableSectionElement>("[data-list-body]");
    if (!tbody) return;
    const seen = new Set<string>();
    for (const record of restatements) {
      seen.add(record.id);
      let tr = tbody.querySelector<HTMLTableRowElement>(`tr[data-restatement-id="${record.id}"]`);
      if (!tr) {
        tr = document.createElement("tr");
        tr.dataset.restatementId = record.id;
        for (const key of ["week", "state", "preparer", "correction", "time"]) {
          const cell = document.createElement("td");
          cell.dataset.field = key;
          tr.appendChild(cell);
        }
        const openCell = document.createElement("td");
        const link = document.createElement("a");
        link.textContent = "Open";
        link.href = `/staff/restatements/${record.id}`;
        openCell.appendChild(link);
        tr.appendChild(openCell);
        tbody.appendChild(tr);
      }
      tr.dataset.state = record.state;
      setField(tr, "week", record.week_ending);
      setField(tr, "state", record.state);
      setField(tr, "preparer", record.prepared_by.name);
      setField(tr, "correction", record.supersedes !== null ? "Correction" : "");
      setField(
        tr,
        "time",
        record.state === "queued" && record.release_at
          ? `Queued to ${etWallSeconds(record.release_at)} ET`
          : record.published_at
            ? `${etWallSeconds(record.published_at)} ET`
            : "",
      );
    }
    for (const tr of Array.from(tbody.rows)) {
      if (!seen.has(tr.dataset.restatementId ?? "")) tr.remove();
    }
  }

  window.setInterval(() => void refreshList(), POLL_MS);
}

// ---------------------------------------------------------------------------
// The restatement editor.

interface InterruptedAction {
  kind: "save" | "send" | "clear";
  body: unknown;
  extra?: Record<string, unknown>;
}

interface DialogSession {
  id: number;
  cancelled: boolean;
}

export function mountEditor(root: HTMLElement, restatementId: string): void {
  const user = currentUser();
  wireSignOut(root);
  let record: Restatement | null = null;
  let knownVersion = 0;
  let interrupted: InterruptedAction | null = null;
  let signInSession: DialogSession | null = null;
  let releaseSession: DialogSession | null = null;
  let withdrawSession: DialogSession | null = null;
  let sessionCounter = 0;

  void loadRecord();

  async function loadRecord(): Promise<void> {
    try {
      const result = await apiJson<{ restatement: Restatement }>("GET", `/api/restatements/${restatementId}`);
      record = result.restatement;
      knownVersion = Math.max(knownVersion, record.version);
      renderAll();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401) {
        window.location.href = "/staff";
      }
    }
  }

  function renderAll(): void {
    if (!record || !user) return;
    renderHeader(record);
    renderRows(record);
    renderEvents(record);
    renderExhibitArea(record);
    renderActions(record);
    renderAudit();
  }

  function renderHeader(record: Restatement): void {
    const heading = root.querySelector<HTMLElement>("[data-heading]");
    if (heading) heading.textContent = `Week ending ${record.week_ending}`;
    const weekInput = root.querySelector<HTMLInputElement>("[data-field='week-ending']");
    if (weekInput) weekInput.value = record.week_ending;
    const reasonWrap = root.querySelector<HTMLElement>("[data-correction-reason-wrap]");
    if (reasonWrap) reasonWrap.hidden = record.supersedes === null;
    const reason = root.querySelector<HTMLInputElement>("[data-field='correction-reason']");
    if (reason && record.correction_reason && document.activeElement !== reason) reason.value = record.correction_reason;
  }

  function renderRows(record: Restatement): void {
    for (const key of ROW_KEYS) {
      const input = root.querySelector<HTMLInputElement>(`[data-row="${key}"]`);
      if (input && document.activeElement !== input) input.value = record.rows[key] ?? "";
    }
    const accession = root.querySelector<HTMLInputElement>("[data-field='accession']");
    if (accession && document.activeElement !== accession) accession.value = record.accession ?? "";
    const page = root.querySelector<HTMLInputElement>("[data-field='exhibit-page']");
    if (page && document.activeElement !== page) page.value = record.exhibit_page === null ? "" : String(record.exhibit_page);
  }

  function renderEvents(record: Restatement): void {
    const host = root.querySelector<HTMLElement>("[data-events]");
    if (!host) return;
    while (host.children.length > record.share_events.length) {
      host.lastChild?.remove();
    }
    record.share_events.forEach((event, index) => {
      let row = host.children[index] as HTMLElement | undefined;
      if (!row) {
        row = document.createElement("div");
        row.className = "event-row";
        const kind = document.createElement("select");
        kind.setAttribute("aria-label", "Event type");
        for (const [value, label] of [
          ["atm_settlement", "ATM settlement"],
          ["warrant_exercise", "Warrant exercise"],
          ["buyback", "Buyback"],
        ] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          kind.appendChild(option);
        }
        kind.dataset.eventKind = "1";
        row.appendChild(kind);
        const shares = document.createElement("input");
        shares.setAttribute("aria-label", "Shares");
        shares.dataset.eventShares = "1";
        shares.className = "num";
        row.appendChild(shares);
        const effective = document.createElement("input");
        effective.setAttribute("aria-label", "Effective date");
        effective.dataset.eventDate = "1";
        effective.placeholder = "YYYY-MM-DD";
        row.appendChild(effective);
        const remove = document.createElement("button");
        remove.textContent = "Remove event";
        remove.dataset.removeEvent = "1";
        row.appendChild(remove);
        host.appendChild(row);
      }
      const kind = row.querySelector<HTMLSelectElement>("[data-event-kind]");
      const shares = row.querySelector<HTMLInputElement>("[data-event-shares]");
      const date = row.querySelector<HTMLInputElement>("[data-event-date]");
      if (kind && document.activeElement !== kind) kind.value = event.kind;
      if (shares && document.activeElement !== shares) shares.value = event.shares;
      if (date && document.activeElement !== date) date.value = event.effective_date;
    });
  }

  function renderExhibitArea(record: Restatement | null): void {
    const state = root.querySelector<HTMLElement>("[data-exhibit-state]");
    const pendingUpload = uploadInFlight;
    const text = pendingUpload
      ? "Exhibit pending verification"
      : record === null || record.exhibit === null
        ? "No exhibit attached"
        : record.exhibit.status === "verified"
          ? "Exhibit verified"
          : "Exhibit rejected — SHA-256 mismatch";
    if (state && state.textContent !== text) state.textContent = text;
    const send = root.querySelector<HTMLButtonElement>("[data-action='send']");
    if (send) send.disabled = pendingUpload || record?.exhibit?.status !== "verified";
  }

  function renderActions(record: Restatement): void {
    const actions = root.querySelector<HTMLElement>("[data-actions]");
    if (!actions || !user) return;
    actions.textContent = "";
    const isPreparer = record.prepared_by.id === user.id;
    const canPrepare = user.roles.includes("treasury_analyst") && isPreparer;

    if (canPrepare && (record.state === "draft" || record.state === "returned")) {
      const save = document.createElement("button");
      save.textContent = "Save draft";
      save.dataset.action = "save";
      save.addEventListener("click", () => void saveDraft());
      actions.appendChild(save);
      const send = document.createElement("button");
      send.textContent = "Send to disclosure counsel";
      send.dataset.action = "send";
      send.addEventListener("click", () => void sendToCounsel());
      actions.appendChild(send);
    }

    if (user.roles.includes("disclosure_counsel") && record.state === "in_review") {
      const checklist = document.createElement("div");
      checklist.className = "check-list";
      for (const key of ROW_KEYS) {
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.dataset.check = key;
        label.appendChild(box);
        label.append(`Matches exhibit: ${ROW_LABELS[key]}`);
        checklist.appendChild(label);
      }
      actions.appendChild(checklist);
      const note = document.createElement("textarea");
      note.setAttribute("aria-label", "Return note");
      note.dataset.field = "return-note";
      note.placeholder = "Return note";
      actions.appendChild(note);
      const returnBtn = document.createElement("button");
      returnBtn.textContent = "Return to analyst";
      returnBtn.addEventListener("click", () => void returnToAnalyst(note.value));
      actions.appendChild(returnBtn);
      const clear = document.createElement("button");
      clear.textContent = "Clear for release";
      clear.addEventListener("click", () => void clearForRelease());
      actions.appendChild(clear);
    }

    if (user.roles.includes("disclosure_officer")) {
      if (record.state === "cleared") {
        const release = document.createElement("button");
        release.textContent = "Release restatement";
        release.dataset.action = "release";
        release.addEventListener("click", () => openReleaseDialog(release));
        actions.appendChild(release);
      }
      if (record.state === "queued") {
        const withdraw = document.createElement("button");
        withdraw.textContent = "Withdraw release";
        withdraw.dataset.action = "withdraw";
        withdraw.addEventListener("click", () => openWithdrawDialog(withdraw));
        actions.appendChild(withdraw);
      }
    }
  }

  async function renderAudit(): Promise<void> {
    const tbody = root.querySelector<HTMLElement>("[data-audit-body]");
    if (!tbody) return;
    try {
      const result = await apiJson<{ entries: AuditEntry[] }>("GET", `/api/restatements/${restatementId}/audit`);
      tbody.textContent = "";
      for (const entry of result.entries) {
        const tr = document.createElement("tr");
        appendCell(tr, String(entry.version), true);
        appendCell(tr, entry.action);
        appendCell(tr, entry.actor ? entry.actor.name : "Tracewell");
        appendCell(tr, etWallSeconds(entry.at), true);
        appendCell(tr, entry.note ?? "");
        tbody.appendChild(tr);
      }
    } catch {
      // The audit trail keeps its last loaded rows.
    }
  }

  function collectDraftBody(): Record<string, unknown> {
    const rows: Record<string, string> = {};
    for (const key of ROW_KEYS) {
      rows[key] = root.querySelector<HTMLInputElement>(`[data-row="${key}"]`)?.value ?? "";
    }
    const events: { kind: string; shares: string; effective_date: string }[] = [];
    for (const row of Array.from(root.querySelectorAll<HTMLElement>("[data-events] .event-row"))) {
      const kind = row.querySelector<HTMLSelectElement>("[data-event-kind]")?.value ?? "atm_settlement";
      const shares = row.querySelector<HTMLInputElement>("[data-event-shares]")?.value ?? "";
      const effective = row.querySelector<HTMLInputElement>("[data-event-date]")?.value ?? "";
      const effective_date = effective;
      events.push({ kind, shares, effective_date });
    }
    return {
      version: knownVersion,
      rows,
      share_events: events,
      accession: root.querySelector<HTMLInputElement>("[data-field='accession']")?.value ?? "",
      exhibit_page: numberOrEmpty(root.querySelector<HTMLInputElement>("[data-field='exhibit-page']")?.value),
      correction_reason: root.querySelector<HTMLInputElement>("[data-field='correction-reason']")?.value ?? null,
    };
  }

  async function saveDraft(): Promise<void> {
    const body = collectDraftBody();
    await runStaffAction("save", { method: "PATCH", path: `/api/restatements/${restatementId}`, body }, () => {
      showStaffUpdate(root, COPY.draftSaved);
    });
  }

  async function sendToCounsel(): Promise<void> {
    await runStaffAction("send", { method: "POST", path: `/api/restatements/${restatementId}/submit`, body: {} }, () => {
      showStaffUpdate(root, COPY.sent);
    });
  }

  async function returnToAnalyst(note: string): Promise<void> {
    try {
      const result = await apiJson<{ restatement: Restatement }>(
        "POST",
        `/api/restatements/${restatementId}/return`,
        { note },
      );
      absorbVersion(result.restatement);
      record = result.restatement;
      renderAll();
      showStaffUpdate(root, COPY.returned);
    } catch (err) {
      handleActionError(err, () => undefined, COPY.unexpected);
    }
  }

  async function clearForRelease(): Promise<void> {
    const checked = Array.from(root.querySelectorAll<HTMLInputElement>("[data-check]"))
      .filter((box) => box.checked)
      .map((box) => box.dataset.check ?? "");
    const body = { checked, version: knownVersion };
    await runStaffAction("clear", { method: "POST", path: `/api/restatements/${restatementId}/clear`, body }, () => {
      showStaffUpdate(root, COPY.cleared);
    });
  }

  async function runStaffAction(
    kind: InterruptedAction["kind"],
    request: { method: string; path: string; body: unknown },
    onSuccess: () => void,
  ): Promise<void> {
    try {
      const result = await apiJson<{ restatement: Restatement }>(request.method, request.path, request.body);
      absorbVersion(result.restatement);
      record = result.restatement;
      renderAll();
      onSuccess();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 401 && err.code === "unauthenticated") {
        interrupted = { kind, body: request.body };
        openSignInDialog();
        return;
      }
      handleActionError(err, onSuccess, COPY.unexpected);
    }
  }

  function handleActionError(err: unknown, onSuccess: () => void, fallback: string): void {
    if (!(err instanceof ApiFailure)) {
      showStaffUpdate(root, fallback);
      return;
    }
    if (err.status === 409 && err.code === "version_conflict") {
      showStaffUpdate(root, COPY.versionConflict);
      return;
    }
    if (err.status === 422 && err.fields) {
      showFieldErrors(err.fields);
      return;
    }
    if (err.status === 409 && err.code === "exhibit_not_verified") {
      showStaffUpdate(root, COPY.sendNeedsExhibit);
      return;
    }
    showStaffUpdate(root, fallback);
    void onSuccess();
  }

  function absorbVersion(restatement: Restatement): void {
    knownVersion = Math.max(knownVersion, restatement.version);
  }

  function showFieldErrors(fields: Record<string, string>): void {
    const alertBox = root.querySelector<HTMLElement>("[data-field-alert]");
    if (!alertBox) return;
    alertBox.hidden = false;
    alertBox.textContent = "";
    const heading = document.createElement("p");
    heading.textContent = "There is a problem with this draft";
    alertBox.appendChild(heading);
    const list = document.createElement("ul");
    for (const [field, message] of Object.entries(fields)) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = `${field}: ${message}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        focusField(field);
      });
      item.appendChild(link);
      list.appendChild(item);
    }
    alertBox.appendChild(list);
  }

  function focusField(field: string): void {
    if (field.startsWith("rows.")) {
      root.querySelector<HTMLInputElement>(`[data-row="${field.slice(5)}"]`)?.focus();
      return;
    }
    if (field.startsWith("share_events.")) {
      const parts = field.split(".");
      const index = Number(parts[1]);
      const attr = parts[2];
      const row = root.querySelectorAll<HTMLElement>("[data-events] .event-row")[index];
      if (row) {
        row.querySelector<HTMLElement>(`[data-event-${attr === "kind" ? "kind" : attr === "shares" ? "shares" : "date"}]`)?.focus();
      }
      return;
    }
    if (field === "correction_reason") {
      root.querySelector<HTMLInputElement>("[data-field='correction-reason']")?.focus();
      return;
    }
    if (field === "exhibit_page") {
      root.querySelector<HTMLInputElement>("[data-field='exhibit-page']")?.focus();
      return;
    }
    root.querySelector<HTMLInputElement>(`[data-field='${field}']`)?.focus();
  }

  // ------------------------------------------------------------------
  // Exhibit upload.

  let uploadInFlight = false;

  async function uploadExhibit(file: File): Promise<void> {
    uploadInFlight = true;
    renderExhibitArea(record);
    announceUpload(COPY.uploading);
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    try {
      const response = await fetch(`/api/restatements/${restatementId}/exhibit`, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf", "X-Exhibit-SHA256": sha },
        body: file,
      });
      if (response.status === 401) {
        restoreAfterRefusal();
        openSignInDialog();
        return;
      }
      if (response.ok) {
        const result = (await response.json()) as { restatement: Restatement };
        absorbVersion(result.restatement);
        record = result.restatement;
        uploadInFlight = false;
        renderAll();
        announceUpload(COPY.uploaded(sha));
        return;
      }
      const failure = (await response.json()) as { error?: { fields?: Record<string, string> } };
      const fields = failure.error?.fields ?? {};
      if (response.status === 422 && fields.file) {
        restoreAfterRefusal();
        announceUpload(fields.file.includes("complete PDF") ? COPY.notPdf : COPY.notSafe);
        return;
      }
      if (response.status === 422 && fields.accession) {
        restoreAfterRefusal();
        announceUpload(COPY.noAccession);
        return;
      }
      if (response.status === 413) {
        restoreAfterRefusal();
        announceUpload(COPY.tooLarge);
        return;
      }
      if (response.status === 422 && fields.sha256) {
        // The mismatch stored its two exhibit steps.
        const fresh = await apiJson<{ restatement: Restatement }>("GET", `/api/restatements/${restatementId}`);
        absorbVersion(fresh.restatement);
        record = fresh.restatement;
        uploadInFlight = false;
        renderAll();
        announceUpload(COPY.hashMismatch);
        return;
      }
      if (response.status === 503) {
        restoreAfterRefusal();
        announceUpload(COPY.vaultDownUpload);
        return;
      }
      restoreAfterRefusal();
      announceUpload(COPY.unexpected);
    } catch {
      restoreAfterRefusal();
      announceUpload(COPY.vaultDownUpload);
    }
  }

  function restoreAfterRefusal(): void {
    uploadInFlight = false;
    const control = root.querySelector<HTMLInputElement>("[data-file-input]");
    if (control) control.value = "";
    renderExhibitArea(record);
  }

  function announceUpload(message: string): void {
    const region = root.querySelector<HTMLElement>("[data-upload-status]");
    if (region) region.textContent = message;
  }

  const fileInput = root.querySelector<HTMLInputElement>("[data-file-input]");
  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) void uploadExhibit(file);
    });
  }

  // ------------------------------------------------------------------
  // Dialogs. Each opening starts a new session; a late response never
  // writes into a dialog opened since.

  function closeModal(backdrop: HTMLElement): void {
    backdrop.classList.remove("fade-in");
    backdrop.classList.add("fade-out");
    window.setTimeout(() => backdrop.remove(), 170);
  }

  function trapDialogKeys(backdrop: HTMLElement, onClose: () => void): void {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "Tab") {
        const focusables = Array.from(
          backdrop.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]"),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0] as HTMLElement;
        const last = focusables[focusables.length - 1] as HTMLElement;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    backdrop.addEventListener("keydown", handler);
  }

  // ---- Release dialog ----

  function openReleaseDialog(opener: HTMLElement): void {
    releaseSession = { id: ++sessionCounter, cancelled: false };
    const session = releaseSession;
    const record0 = record;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop fade-in";
    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Release restatement");
    const heading = document.createElement("h2");
    heading.textContent = "Release restatement";
    card.appendChild(heading);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = "";
    const metaLine = (label: string) => {
      const div = document.createElement("div");
      div.textContent = `${label}: ${record0?.week_ending ?? ""}`;
      return div;
    };
    meta.appendChild(metaLine("Week ending"));
    const prep = document.createElement("div");
    prep.textContent = `Preparer: ${record0?.prepared_by.name ?? ""}`;
    meta.appendChild(prep);
    const clearer = document.createElement("div");
    clearer.textContent = `Cleared by: ${record0?.cleared_by?.name ?? ""}`;
    meta.appendChild(clearer);
    const acc = document.createElement("div");
    acc.textContent = `Accession: ${record0?.accession ?? ""}`;
    meta.appendChild(acc);
    card.appendChild(meta);

    const label = document.createElement("label");
    label.style.display = "grid";
    label.style.gap = "8px";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = "release-confirm";
    label.appendChild(box);
    label.append("I confirm this restatement is cleared for release");
    card.appendChild(label);

    const timing = document.createElement("div");
    timing.setAttribute("role", "status");
    timing.setAttribute("aria-live", "polite");
    timing.setAttribute("aria-label", "Release timing");
    timing.className = "status-line";
    card.appendChild(timing);

    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-label", "Release status");
    status.className = "status-line";
    card.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const releaseBtn = document.createElement("button");
    releaseBtn.textContent = "Release";
    releaseBtn.disabled = true;
    box.addEventListener("change", () => {
      releaseBtn.disabled = !box.checked;
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    actions.appendChild(releaseBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);

    document.body.appendChild(backdrop);
    backdrop.appendChild(card);
    box.focus();

    const idempotencyKey = `release-${crypto.randomUUID()}`;
    const updateTiming = async () => {
      if (session.cancelled) return;
      try {
        const board = await apiJson<{ clocks: { equity: { status: string; closes_at: string | null } } }>("GET", "/api/board");
        if (session.cancelled || releaseSession?.id !== session.id) return;
        const equity = board.clocks.equity;
        const text =
          equity.status === "open" && equity.closes_at
            ? COPY.timingQueues(equity.closes_at.slice(11, 16), equity.closes_at.slice(0, 10))
            : COPY.timingPublishes;
        if (timing.textContent !== text) timing.textContent = text;
      } catch {
        // The line stays as last loaded.
      }
    };
    void updateTiming();
    const timingTimer = window.setInterval(() => void updateTiming(), POLL_MS);

    trapDialogKeys(backdrop, () => {
      cancelRelease();
    });

    async function performRelease(): Promise<void> {
      releaseBtn.disabled = true;
      try {
        const result = await apiJson<{ outcome: string; restatement: Restatement }>(
          "POST",
          `/api/restatements/${restatementId}/release`,
          { confirm: true },
          { "Idempotency-Key": idempotencyKey },
        );
        if (session.cancelled || releaseSession?.id !== session.id) {
          showLateOutcome(result.outcome);
          return;
        }
        absorbVersion(result.restatement);
        record = result.restatement;
        status.textContent = outcomeCopy(result.outcome);
        await loadRecord();
      } catch (err) {
        if (session.cancelled || releaseSession?.id !== session.id) {
          showLateFailure(err);
          return;
        }
        if (err instanceof ApiFailure) {
          if (err.status === 401 && err.code === "unauthenticated") {
            // Any other staff action answered 401 sends nothing more.
            status.textContent = "";
            session.cancelled = true;
            releaseSession = null;
            window.clearInterval(timingTimer);
            closeModal(backdrop);
            opener.focus();
            showStaffUpdate(root, COPY.sessionEndedStaff);
            return;
          }
          if (err.status === 403) {
            status.textContent = COPY.releaseTwoPerson;
            releaseBtn.disabled = true;
            return;
          }
          if (err.status === 409 && err.code === "invalid_transition") {
            status.textContent = COPY.releaseStateChanged;
            releaseBtn.disabled = true;
            return;
          }
        }
        status.textContent = COPY.unexpected;
        releaseBtn.disabled = true;
      }
    }

    function showLateOutcome(outcome: string): void {
      showStaffUpdate(root, outcomeCopy(outcome));
      void loadRecord();
    }

    function showLateFailure(err: unknown): void {
      if (err instanceof ApiFailure && err.status === 403) {
        showStaffUpdate(root, COPY.releaseTwoPerson);
      } else if (err instanceof ApiFailure && err.status === 409) {
        showStaffUpdate(root, COPY.releaseStateChanged);
      } else {
        showStaffUpdate(root, COPY.unexpected);
      }
      void loadRecord();
    }

    function outcomeCopy(outcome: string): string {
      const current = record;
      if (outcome === "queued" && current?.release_at) {
        return COPY.releaseQueued(current.release_at.slice(11, 16), current.release_at.slice(0, 10));
      }
      if (current?.published_at) {
        const iso = current.published_at;
        return COPY.releasedNow(iso.slice(11, 19), iso.slice(0, 10));
      }
      return COPY.unexpected;
    }

    releaseBtn.addEventListener("click", () => void performRelease());
    cancelBtn.addEventListener("click", cancelRelease);

    function cancelRelease(): void {
      session.cancelled = true;
      releaseSession = null;
      window.clearInterval(timingTimer);
      closeModal(backdrop);
      opener.focus();
    }
  }

  // ---- Withdraw dialog ----

  function openWithdrawDialog(opener: HTMLElement): void {
    withdrawSession = { id: ++sessionCounter, cancelled: false };
    const session = withdrawSession;
    const record0 = record;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop fade-in";
    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Withdraw release");
    const heading = document.createElement("h2");
    heading.textContent = "Withdraw release";
    card.appendChild(heading);
    const meta = document.createElement("div");
    meta.className = "meta";
    const week = document.createElement("div");
    week.textContent = `Week ending: ${record0?.week_ending ?? ""}`;
    meta.appendChild(week);
    const queued = document.createElement("div");
    queued.textContent = record0?.release_at ? `Queued release time: ${etWallSeconds(record0.release_at)} ET` : "";
    meta.appendChild(queued);
    card.appendChild(meta);

    const note = document.createElement("textarea");
    note.setAttribute("aria-label", "Withdraw note");
    note.placeholder = "Withdraw note";
    card.appendChild(note);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const withdrawBtn = document.createElement("button");
    withdrawBtn.textContent = "Withdraw";
    withdrawBtn.disabled = true;
    note.addEventListener("input", () => {
      withdrawBtn.disabled = note.value.length < 10 || note.value.length > 500;
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    actions.appendChild(withdrawBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    note.focus();

    trapDialogKeys(backdrop, () => close());

    function close(): void {
      session.cancelled = true;
      withdrawSession = null;
      closeModal(backdrop);
      opener.focus();
    }

    withdrawBtn.addEventListener("click", async () => {
      const body = { version: knownVersion, note: note.value };
      try {
        const result = await apiJson<{ restatement: Restatement }>(
          "POST",
          `/api/restatements/${restatementId}/withdraw`,
          body,
        );
        if (session.cancelled || withdrawSession?.id !== session.id) {
          showStaffUpdate(root, COPY.withdrawn);
          absorbVersion(result.restatement);
          void loadRecord();
          return;
        }
        absorbVersion(result.restatement);
        record = result.restatement;
        close();
        showStaffUpdate(root, COPY.withdrawn);
        await loadRecord();
        root.querySelector<HTMLElement>("[data-heading]")?.focus();
      } catch (err) {
        if (session.cancelled || withdrawSession?.id !== session.id) {
          showStaffUpdate(root, err instanceof ApiFailure && err.status === 409 ? COPY.withdrawRefused : COPY.unexpected);
          void loadRecord();
          return;
        }
        if (err instanceof ApiFailure && err.status === 401 && err.code === "unauthenticated") {
          close();
          showStaffUpdate(root, COPY.sessionEndedStaff);
          return;
        }
        if (err instanceof ApiFailure && err.status === 409) {
          showStaffUpdate(root, COPY.withdrawRefused);
          close();
          await loadRecord();
          root.querySelector<HTMLElement>("[data-heading]")?.focus();
          return;
        }
        // A network failure keeps the dialog open with the note kept.
        showStaffUpdate(root, COPY.unexpected);
        withdrawBtn.disabled = false;
      }
    });
    cancelBtn.addEventListener("click", close);
  }

  // ---- Sign-in dialog (interrupted action) ----

  function openSignInDialog(): void {
    if (signInSession && !signInSession.cancelled) return;
    signInSession = { id: ++sessionCounter, cancelled: false };
    const session = signInSession;
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop fade-in";
    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Sign in to continue");
    const heading = document.createElement("h2");
    heading.textContent = "Sign in to continue";
    card.appendChild(heading);
    const text = document.createElement("p");
    text.textContent = COPY.sessionEndedDialog;
    card.appendChild(text);

    const email = document.createElement("input");
    email.type = "email";
    email.setAttribute("aria-label", "Email");
    email.placeholder = "Email";
    card.appendChild(email);
    const password = document.createElement("input");
    password.type = "password";
    password.setAttribute("aria-label", "Password");
    password.placeholder = "Password";
    card.appendChild(password);
    const status = document.createElement("div");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-label", "Sign-in status");
    status.className = "status-line";
    card.appendChild(status);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const signInBtn = document.createElement("button");
    signInBtn.textContent = "Sign in";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    actions.appendChild(signInBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
    backdrop.appendChild(card);
    document.body.appendChild(backdrop);
    email.focus();

    trapDialogKeys(backdrop, () => close());

    function close(): void {
      session.cancelled = true;
      signInSession = null;
      closeModal(backdrop);
      showStaffUpdate(root, COPY.sessionEndedStaff);
    }

    async function submit(): Promise<void> {
      try {
        const result = await apiJson<{ user: StaffUser }>("POST", "/api/session", {
          email: email.value.trim(),
          password: password.value,
        });
        if (session.cancelled || signInSession?.id !== session.id) {
          return;
        }
        const sameUser = result.user.id === user?.id;
        signInSession = null;
        session.cancelled = true;
        closeModal(backdrop);
        if (sameUser && interrupted) {
          const action = interrupted;
          interrupted = null;
          await resumeInterrupted(action);
        } else if (!sameUser) {
          showStaffUpdate(root, COPY.differentUser(result.user.name));
          interrupted = null;
          window.setTimeout(() => window.location.reload(), 120);
        } else {
          await loadRecord();
        }
      } catch {
        if (session.cancelled || signInSession?.id !== session.id) return;
        status.textContent = COPY.signInFailed;
      }
    }

    async function resumeInterrupted(action: InterruptedAction): Promise<void> {
      if (action.kind === "save") {
        await runStaffAction("save", { method: "PATCH", path: `/api/restatements/${restatementId}`, body: action.body }, () => {
          showStaffUpdate(root, COPY.draftSaved);
        });
      } else if (action.kind === "send") {
        await runStaffAction("send", { method: "POST", path: `/api/restatements/${restatementId}/submit`, body: {} }, () => {
          showStaffUpdate(root, COPY.sent);
        });
      } else if (action.kind === "clear") {
        await runStaffAction("clear", { method: "POST", path: `/api/restatements/${restatementId}/clear`, body: action.body }, () => {
          showStaffUpdate(root, COPY.cleared);
        });
      }
    }

    signInBtn.addEventListener("click", () => void submit());
    cancelBtn.addEventListener("click", close);
  }
}

// ---------------------------------------------------------------------------
// The operator console.

export function mountOperator(root: HTMLElement): void {
  wireSignOut(root);
  const tapeLine = root.querySelector<HTMLElement>("[data-tape-line]");
  const clockLine = root.querySelector<HTMLElement>("[data-clock-line]");
  const status = root.querySelector<HTMLElement>("[data-operator-status]");
  const user = currentUser();

  async function poll(): Promise<void> {
    try {
      const [tape, clock] = await Promise.all([
        apiJson<{ state: string; position: number }>("GET", "/api/operator/tape"),
        apiJson<{ now: string; rehearsal: boolean }>("GET", "/api/clock"),
      ]);
      if (tapeLine) tapeLine.textContent = tape.state === "playing" ? COPY.tapePlaying(tape.position) : COPY.tapePaused(tape.position);
      if (clockLine) clockLine.textContent = COPY.marketClock(clock.now.slice(0, 10), clock.now.slice(11, 19));
    } catch {
      // Both lines keep their last loaded state.
    }
  }

  void poll();
  window.setInterval(() => void poll(), POLL_MS);

  const pauseBtn = root.querySelector<HTMLButtonElement>("[data-action='pause']");
  pauseBtn?.addEventListener("click", async () => {
    try {
      await apiJson("PUT", "/api/operator/tape", { state: "paused" });
      if (status) status.textContent = COPY.tapePausedStatus;
      void poll();
    } catch {
      if (status) status.textContent = COPY.unexpected;
    }
  });

  const resumeBtn = root.querySelector<HTMLButtonElement>("[data-action='resume']");
  resumeBtn?.addEventListener("click", async () => {
    try {
      await apiJson("PUT", "/api/operator/tape", { state: "playing" });
      if (status) status.textContent = COPY.tapePlayingStatus;
      void poll();
    } catch {
      if (status) status.textContent = COPY.unexpected;
    }
  });

  const setBtn = root.querySelector<HTMLButtonElement>("[data-action='set-clock']");
  setBtn?.addEventListener("click", async () => {
    const input = root.querySelector<HTMLInputElement>("[data-field='rehearsal-clock']");
    const text = (input?.value ?? "").trim();
    // A New York wall time; the page sends it with the offset in force then.
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text);
    if (!input || !match) {
      if (status) status.textContent = COPY.invalidClock;
      return;
    }
    const iso = nyInstantForWallTime(match);
    if (iso === null) {
      if (status) status.textContent = COPY.invalidClock;
      return;
    }
    try {
      const result = await apiJson<{ now: string }>("PUT", "/api/operator/clock", { at: iso });
      if (status) status.textContent = COPY.clockSet(result.now.slice(0, 10), result.now.slice(11, 19));
      void poll();
    } catch {
      if (status) status.textContent = COPY.unexpected;
    }
  });

  const realBtn = root.querySelector<HTMLButtonElement>("[data-action='real-time']");
  realBtn?.addEventListener("click", async () => {
    try {
      await apiJson("PUT", "/api/operator/clock", { at: null });
      if (status) status.textContent = COPY.clockReal;
      void poll();
    } catch {
      if (status) status.textContent = COPY.unexpected;
    }
  });

  if (!user || !user.roles.includes("operator")) {
    window.location.href = "/staff";
  }
}

// ---------------------------------------------------------------------------
// Shared helpers.

function wireSignOut(root: HTMLElement): void {
  const button = root.querySelector<HTMLButtonElement>("[data-action='sign-out']");
  button?.addEventListener("click", async () => {
    try {
      await apiJson<unknown>("DELETE", "/api/session");
    } catch {
      // Signing out is best-effort.
    }
    window.location.href = "/staff";
  });
}

/**
 * The New York offset in force at an instant, read from the platform's
 * time-zone data (never the device's local clock value).
 */
function nyOffsetMinutes(instant: number): number | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "longOffset",
  }).formatToParts(new Date(instant));
  for (const part of parts) {
    if (part.type === "timeZoneName") {
      const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(part.value ?? "");
      if (!match) return null;
      const sign = match[1] === "-" ? -1 : 1;
      return sign * (Number(match[2]) * 60 + Number(match[3]));
    }
  }
  return null;
}

/**
 * A New York wall time becomes an instant with the offset in force at that
 * wall time; a wall time that occurs twice means the earlier instant, and a
 * wall time that does not exist is refused.
 */
function nyInstantForWallTime(match: RegExpMatchArray): string | null {
  const wall = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
  const withDst = Date.parse(`${wall}-04:00`);
  if (nyOffsetMinutes(withDst) === -240) return `${wall}-04:00`;
  const withEst = Date.parse(`${wall}-05:00`);
  if (nyOffsetMinutes(withEst) === -300) return `${wall}-05:00`;
  return null;
}

function currentUser(): StaffUser | null {
  const raw = document.documentElement.dataset.staffUser;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StaffUser;
  } catch {
    return null;
  }
}

function showStaffUpdate(root: HTMLElement, message: string): void {
  const region = root.querySelector<HTMLElement>("[data-staff-updates]");
  if (region) region.textContent = message;
}

function setField(host: ParentNode, field: string, text: string): void {
  const el = host.querySelector<HTMLElement>(`[data-field="${field}"]`);
  if (el && el.textContent !== text) el.textContent = text;
}

function appendCell(tr: HTMLTableRowElement, text: string, numeric = false): void {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (numeric) cell.className = "num";
  tr.appendChild(cell);
}

function numberOrEmpty(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}
