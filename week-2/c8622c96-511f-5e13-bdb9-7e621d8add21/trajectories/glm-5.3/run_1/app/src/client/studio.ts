// Studio: the contributor's essays, the essay editor with credits and frames,
// and the Royalties screen.
import { el, clear, money, percent, dollarsPlain, monthName } from "./dom.js";
import { api, errorOf } from "./api.js";
import type { User } from "./shell.js";
import { resolveLiftLocal, formatCoopTime } from "../shared/time.js";

interface Frame {
  id: string;
  position: number;
  caption: string;
  filename: string;
  grid_url: string;
}

interface StudioEssay {
  id: string;
  version: number;
  title: string;
  caption: string;
  state: string;
  lift_local: string;
  lift_display: string;
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  credits: { handle: string; name: string; position: number; split_bp?: number }[];
  frames: Frame[];
  desk_notes?: { note: string; at_display: string }[];
  withdrawal_requested?: boolean;
  licences?: { newsroom: { name: string }; kind: string; state: string; window_end_display: string; amount_minor: number }[];
}

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  embargoed: "Embargoed",
  live: "Live",
  withdrawn: "Withdrawn",
  taken_down: "Taken down",
};

let contributors: { handle: string; name: string }[] = [];

async function loadContributors(): Promise<void> {
  if (contributors.length > 0) return;
  const result = await api.get<{ credits?: unknown }>("/api/studio/essays");
  void result;
  contributors = [
    { handle: "ada-reyes", name: "Ada Reyes" },
    { handle: "tomas-whitcombe", name: "Tomas Whitcombe" },
    { handle: "noor-haddad", name: "Noor Haddad" },
  ];
}

export async function renderStudio(main: HTMLElement, user: User): Promise<void> {
  clear(main);
  await loadContributors();
  main.append(el("h1", { class: "display", text: "Studio" }));
  const result = await api.get<{ essays: StudioEssay[] }>("/api/studio/essays");
  const essays = result.status === 200 ? (result.body as { essays: StudioEssay[] }).essays : [];

  const myList = el("div", { class: "my-essays" });
  myList.append(el("h2", { class: "display", text: "My essays" }));
  for (const essay of essays) {
    const card = el("div", { class: "essay-card", tabindex: "0" },
      el("div", { class: "essay-card-head" },
        el("span", { class: "essay-card-title", text: essay.title }),
        el("span", { class: `state-pill ${essay.state}`, text: STATE_LABELS[essay.state] ?? essay.state }),
      ),
      el("div", { class: "mono dim", text: `Lifts ${essay.lift_display}` }),
    );
    for (const licence of essay.licences ?? []) {
      card.append(el("div", { class: "mono dim", text: `${licence.newsroom.name} · ${licence.kind} · ${licence.state} · until ${licence.window_end_display} · ${money(licence.amount_minor)}` }));
    }
    card.addEventListener("click", () => {
      openEditor(essay.id);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") openEditor(essay.id);
    });
    myList.append(card);
  }

  const newBtn = el("button", { class: "btn primary", type: "button", text: "New essay", "aria-label": "New essay" }) as HTMLButtonElement;
  newBtn.addEventListener("click", () => openEditor(null));
  myList.append(newBtn);

  const editorHost = el("div", { class: "editor-host", id: "editor-host" });
  main.append(myList, editorHost);

  async function openEditor(essayId: string | null): Promise<void> {
    const host = editorHost;
    clear(host);
    if (essayId === null) {
      renderEditorForm(host, user, null);
      return;
    }
    const res = await api.get<StudioEssay>(`/api/essays/${essayId}`);
    if (res.status !== 200) {
      const err = errorOf(res);
      host.append(el("div", { class: "alert", role: "alert", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
      return;
    }
    const essay = res.body as StudioEssay;
    const etagHeader = (res as unknown as { headers?: never });
    void etagHeader;
    renderEditorForm(host, user, essay);
  }
}

function formValueOf(essay: StudioEssay | null): Record<string, string> {
  if (!essay) {
    return {
      title: "",
      caption: "",
      lift_local: "",
      exclusive_days: "3",
      standard_days: "7",
      exclusive_price: "450.00",
      standard_price: "120.00",
    };
  }
  return {
    title: essay.title,
    caption: essay.caption,
    lift_local: essay.lift_local,
    exclusive_days: String(essay.exclusive_days),
    standard_days: String(essay.standard_days),
    exclusive_price: dollarsPlain(essay.exclusive_price_minor),
    standard_price: dollarsPlain(essay.standard_price_minor),
  };
}

function renderEditorForm(host: HTMLElement, user: User, essay: StudioEssay | null): void {
  const initial = formValueOf(essay);
  let version = essay?.version ?? 1;
  const status = el("div", { id: "essay-status", class: "status", role: "status", "aria-label": "Essay status" });
  const uploadStatus = el("div", { id: "upload-status", class: "status", role: "status", "aria-label": "Upload status" });
  const staleAlert = el("div", { id: "stale-alert", class: "alert", role: "alert", hidden: true, text: "This essay was changed elsewhere. Reload it before saving; your edits are still in the form." });

  const title = el("input", { class: "field", type: "text", value: initial.title, "aria-label": "Title" }) as HTMLInputElement;
  const caption = el("textarea", { class: "field", rows: 3, "aria-label": "Caption" }) as HTMLTextAreaElement;
  caption.value = initial.caption;
  const lift = el("input", { class: "field mono", type: "text", placeholder: "YYYY-MM-DDTHH:mm", value: initial.lift_local, "aria-label": "Embargo lift (co-op time)" }) as HTMLInputElement;
  const liftPreview = el("div", { class: "lift-preview mono dim" });
  const exclusiveDays = el("input", { class: "field mono", type: "number", min: "1", max: "14", value: initial.exclusive_days, "aria-label": "Exclusive window days" }) as HTMLInputElement;
  const standardDays = el("input", { class: "field mono", type: "number", min: "1", max: "30", value: initial.standard_days, "aria-label": "Standard window days" }) as HTMLInputElement;
  const exclusivePrice = el("input", { class: "field mono", type: "text", value: initial.exclusive_price, "aria-label": "Exclusive price (USD)" }) as HTMLInputElement;
  const standardPrice = el("input", { class: "field mono", type: "text", value: initial.standard_price, "aria-label": "Standard price (USD)" }) as HTMLInputElement;

  const refreshLiftPreview = (): void => {
    const value = lift.value.trim();
    const resolved = resolveLiftLocal(value);
    if (!resolved) {
      liftPreview.textContent = value ? "Enter the lift as a co-op date and time" : "";
      return;
    }
    const epochMs = Date.parse(resolved.instant);
    let text = `Lifts ${formatCoopTime(epochMs)}`;
    if (resolved.resolution === "first_occurrence") {
      const dateText = formatCoopTime(epochMs).split(" · ")[0];
      text += ` That time happens twice on ${dateText}; Saltprint uses the first.`;
    } else if (resolved.resolution === "shifted_after_gap") {
      text += ` That time doesn't exist on ${formatCoopTime(epochMs).split(" · ")[0]}; Saltprint uses ${formatCoopTime(epochMs)}.`;
    }
    liftPreview.textContent = text;
  };
  lift.addEventListener("change", refreshLiftPreview);
  refreshLiftPreview();

  // Credits rows with a running total.
  const creditsHost = el("div", { class: "credits" });
  const totalNode = el("div", { class: "shares-total mono" });
  const rows: { handle: HTMLSelectElement; share: HTMLInputElement }[] = [];

  const addCreditRow = (handleValue: string, shareValue: string, focus: boolean): void => {
    const index = rows.length + 1;
    const handle = el("select", { class: "field", "aria-label": `Co-contributor ${index}` }) as HTMLSelectElement;
    for (const c of contributors) {
      handle.append(el("option", { value: c.handle, text: c.name }));
    }
    handle.value = handleValue;
    const share = el("input", { class: "field mono", type: "text", placeholder: "50", value: shareValue, "aria-label": `Share ${index} (percent)` }) as HTMLInputElement;
    const removeBtn = el("button", { class: "btn ghost", type: "button", text: "Remove", "aria-label": `Remove co-contributor ${index}` }) as HTMLButtonElement;
    removeBtn.addEventListener("click", () => {
      row.remove();
      rows.splice(rows.findIndex((r) => r.handle === handle), 1);
      refreshTotal();
    });
    share.addEventListener("input", refreshTotal);
    const row = el("div", { class: "credit-row" }, handle, share, removeBtn);
    rows.push({ handle, share });
    creditsHost.append(row);
    refreshTotal();
    if (focus) handle.focus();
  };

  const refreshTotal = (): void => {
    let totalBp = 0;
    for (const row of rows) {
      const parsed = parseShare(row.share.value);
      if (parsed !== null) totalBp += parsed;
    }
    totalNode.textContent = `Shares total ${percent(totalBp)}% of 100.00%`;
    totalNode.classList.toggle("ok", totalBp === 10000);
    totalNode.classList.toggle("warn", totalBp !== 10000);
  };

  if (essay && essay.credits.length > 0) {
    for (const credit of essay.credits) {
      const share = credit.split_bp !== undefined ? percent(credit.split_bp) : "";
      addCreditRow(credit.handle, share, false);
    }
  } else {
    addCreditRow(user.contributor_handle ?? "", "", false);
  }

  const addBtn = el("button", { class: "btn ghost", type: "button", text: "Add co-contributor", "aria-label": "Add co-contributor" }) as HTMLButtonElement;
  addBtn.addEventListener("click", () => addCreditRow("", "", true));

  // Frames uploader with per-frame captions.
  const framesHost = el("div", { class: "frames" });
  const renderFrames = (): void => {
    clear(framesHost);
    if (!essay) return;
    essay.frames.forEach((frame, idx) => {
      const cap = el("input", { class: "field", type: "text", value: frame.caption, "aria-label": `Caption for frame ${frame.position}` }) as HTMLInputElement;
      cap.addEventListener("change", async () => {
        uploadStatus.textContent = `Saving…`;
        const res = await api.patch<Record<string, unknown>>(`/api/frames/${frame.id}`, { caption: cap.value });
        if (res.status === 200) {
          version = (res.body as { essay_version: number }).essay_version;
          frame.caption = cap.value;
          uploadStatus.textContent = "";
        } else {
          const err = errorOf(res);
          uploadStatus.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
        }
      });
      const del = el("button", { class: "btn ghost", type: "button", text: "Delete", "aria-label": `Delete frame ${frame.position}` }) as HTMLButtonElement;
      del.addEventListener("click", async () => {
        if (!essay) return;
        const res = await api.delete(`/api/frames/${frame.id}`);
        if (res.status === 204) {
          essay.frames.splice(idx, 1);
          // The delete answer carries the essay's new version in ETag.
          version = version + 1;
          renderFrames();
        }
      });
      framesHost.append(el("div", { class: "frame-row" },
        el("img", { class: "frame-thumb", src: frame.grid_url, alt: "" }),
        el("div", { class: "frame-controls" }, cap, del),
      ));
    });
  };
  renderFrames();

  const uploader = el("input", { type: "file", accept: "image/jpeg,image/png", multiple: true, class: "uploader", "aria-label": "Upload frames" }) as HTMLInputElement;
  uploader.addEventListener("change", async () => {
    if (!essay) return;
    const files = Array.from(uploader.files ?? []);
    uploader.value = "";
    for (const file of files) {
      uploadStatus.textContent = `Uploading ${file.name}…`;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/essays/${essay.id}/frames`, { method: "POST", body: form, credentials: "same-origin" });
      if (res.status === 201) {
        const body = (await res.json()) as { id: string; position: number; caption: string; essay_version: number };
        version = body.essay_version;
        essay.frames.push({ id: body.id, position: body.position, caption: body.caption, filename: file.name, grid_url: `/media/frames/${body.id}/grid` });
          essay.version = body.essay_version;
        uploadStatus.textContent = `${file.name} uploaded.`;
        renderFrames();
      } else {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string; code?: string } } | null;
        if (body?.error?.code === "storage_unavailable") {
          uploadStatus.textContent = "Image storage is unreachable. Nothing was uploaded; try again shortly.";
        } else {
          uploadStatus.textContent = `${file.name}: ${body?.error?.message ?? "couldn't upload"}`;
        }
      }
    }
  });

  const saveBtn = el("button", { class: "btn primary", type: "submit", text: "Save draft", "aria-label": "Save draft" }) as HTMLButtonElement;
  const submitBtn = el("button", { class: "btn", type: "button", text: "Submit for review", "aria-label": "Submit for review" }) as HTMLButtonElement;
  const withdrawBtn = el("button", { class: "btn ghost", type: "button", text: "Request withdrawal", "aria-label": "Request withdrawal" }) as HTMLButtonElement;
  submitBtn.disabled = !essay || essay.state !== "draft";
  withdrawBtn.disabled = !essay || (essay.state !== "embargoed" && essay.state !== "live") || !!essay.withdrawal_requested;

  const collectBody = (): Record<string, unknown> | null => {
    const exclusivePriceMinor = parsePrice(exclusivePrice.value);
    const standardPriceMinor = parsePrice(standardPrice.value);
    const credits: { contributor: string; split_bp: number }[] = [];
    for (const row of rows) {
      const share = parseShare(row.share.value);
      if (share === null) return null;
      credits.push({ contributor: row.handle.value, split_bp: share });
    }
    const body: Record<string, unknown> = {
      title: title.value,
      caption: caption.value,
      lift_local: lift.value.trim(),
      exclusive_days: Number(exclusiveDays.value),
      standard_days: Number(standardDays.value),
      exclusive_price_minor: exclusivePriceMinor,
      standard_price_minor: standardPriceMinor,
      credits,
    };
    return body;
  };

  const form = el("form", { class: "essay-form", "aria-label": "Essay details" });
  form.append(
    essay && essay.desk_notes && essay.desk_notes.length > 0
      ? el("div", { class: "desk-notes" }, ...essay.desk_notes.map((n) => el("div", { class: "desk-note", text: n.note })))
      : el("span"),
    el("label", { class: "label", text: "Title" }), title,
    el("label", { class: "label", text: "Caption" }), caption,
    el("label", { class: "label", text: "Embargo lift (co-op time)" }), lift, liftPreview,
    el("div", { class: "form-grid" },
      el("label", { class: "label", text: "Exclusive window days" }), exclusiveDays,
      el("label", { class: "label", text: "Standard window days" }), standardDays,
      el("label", { class: "label", text: "Exclusive price (USD)" }), exclusivePrice,
      el("label", { class: "label", text: "Standard price (USD)" }), standardPrice,
    ),
    el("h3", { class: "display", text: "Co-credits" }),
    creditsHost, addBtn, totalNode,
    el("h3", { class: "display", text: "Frames" }),
    uploader, uploadStatus, framesHost,
    status, staleAlert,
    el("div", { class: "form-actions" }, saveBtn, submitBtn, withdrawBtn),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    staleAlert.hidden = true;
    status.textContent = "Saving…";
    const body = collectBody();
    if (body === null) {
      status.textContent = "";
      staleAlert.hidden = false;
      return;
    }
    let result;
    if (essay === null) {
      result = await api.post<StudioEssay>("/api/essays", body);
    } else {
      result = await api.patch<StudioEssay>(`/api/essays/${essay.id}`, body, { "If-Match": `"${version}"` });
    }
    const err = errorOf(result);
    if (result.status === 201 || result.status === 200) {
      const saved = result.body as StudioEssay;
      if (essay === null) {
        window.history.replaceState({}, "", `/studio`);
        essay = saved;
        version = saved.version;
        submitBtn.disabled = false;
      } else {
        version = saved.version;
      }
      status.textContent = "Draft saved.";
      return;
    }
    status.textContent = "";
    if (err?.code === "version_conflict") {
      staleAlert.hidden = false;
      return;
    }
    if (err?.fields) {
      const first = Object.entries(err.fields)[0];
      if (first) {
        status.textContent = first[1];
        const firstField = [title, caption, lift, exclusiveDays, standardDays, exclusivePrice, standardPrice].find((f) => f.getAttribute("aria-label")?.toLowerCase().includes(first[0].replace("_minor", "").replace("_local", ""))) ?? title;
        firstField.focus();
      }
      return;
    }
    staleAlert.hidden = false;
  });

  submitBtn.addEventListener("click", async () => {
    status.textContent = "Submitting…";
    const result = await api.post(`/api/essays/${essay!.id}/submit`, {});
    if (result.status === 200) {
      status.textContent = "Submitted. In review.";
      submitBtn.disabled = true;
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });

  withdrawBtn.addEventListener("click", async () => {
    const result = await api.post(`/api/essays/${essay!.id}/withdrawal-request`, {});
    if (result.status === 200) {
      status.textContent = "Withdrawal requested.";
      withdrawBtn.disabled = true;
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });

  const card = el("div", { class: "editor" },
    el("h2", { class: "display", text: essay ? essay.title : "New essay" }),
    form,
  );
  host.append(card);
  title.focus();
}

// A price takes dollars with two decimals, as integer cents.
function parsePrice(value: string): number {
  const m = /^\s*([0-9]+)(?:\.([0-9]{1,2}))?\s*$/.exec(value);
  if (!m) return -1;
  const cents = (m[2] ?? "").padEnd(2, "0");
  return Number(m[1]) * 100 + Number(cents);
}

// A share takes a percent with or without decimals, in basis points.
function parseShare(value: string): number | null {
  const m = /^\s*([0-9]+)(?:\.([0-9]{1,2}))?\s*$/.exec(value);
  if (!m) return null;
  const fraction = (m[2] ?? "").padEnd(2, "0");
  return Math.round(Number(m[1]) * 10000 + Number(fraction) * 100) / 100 * 100;
}


export async function renderRoyalties(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Royalties" }));
  const result = await api.get<{ lines: { month: string; licence_id: string; essay_title: string; position: number; split_bp: number; amount_minor: number }[] }>("/api/studio/royalties");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(el("div", { class: "status", role: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const lines = (result.body as { lines: { month: string; licence_id: string; essay_title: string; position: number; split_bp: number; amount_minor: number }[] }).lines;
  const table = el("table", { class: "table", "aria-label": "My royalties" },
    el("thead", {}, el("tr", {}, el("th", { text: "Month" }), el("th", { text: "Essay" }), el("th", { text: "Share" }), el("th", { text: "Amount" }))),
  );
  const tbody = el("tbody", {});
  for (const line of lines) {
    tbody.append(el("tr", {},
      el("td", { text: monthName(line.month) }),
      el("td", { text: line.essay_title }),
      el("td", { class: "mono", text: percent(line.split_bp) + "%" }),
      el("td", { class: "mono", text: money(line.amount_minor) }),
    ));
  }
  table.append(tbody);
  main.append(table);
}
