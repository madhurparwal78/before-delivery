import { get, patch, post, del, uploadFile, ApiFailure, currentUser } from "../api.js";
import { h, deskStatus, deskError, deskErrorFrom, fieldError, openDialog, withPending, money } from "../ui.js";
import { setBand } from "../band.js";
import { navigate } from "../main.js";

interface AssetView {
  id: string;
  url: string;
  name: string;
  type: string;
  width: number;
  height: number;
  bytes: number;
}

interface EntryView {
  id: string;
  entryNumber: number;
  programId: string;
  categoryId: string;
  categoryName: string;
  title: string;
  summary: string;
  siteUrl: string;
  credits: string;
  state: string;
  statusLabel: string;
  disqualifyReason: string | null;
  award: string | null;
  score: string | null;
  assets: AssetView[];
  fee: { tier: "early_bird" | "standard"; amountCents: number } | null;
  submittedAt: string | null;
  deadlineLabel: string | null;
  canWithdraw: boolean;
  refundOnWithdraw: boolean;
}

interface ProgramView {
  id: string;
  name: string;
  year: number;
  timeZone: string;
  earlyBirdLabel: string;
  deadlineLabel: string;
  deadlineAt: string;
  earlyBirdEndsAt: string;
  earlyBirdFeeCents: number;
  standardFeeCents: number;
  currentTier: "early_bird" | "standard";
  currentFeeCents: number;
  entriesOpen: boolean;
  categories: { id: string; name: string }[];
}

function openProgram(programs: ProgramView[]): ProgramView | null {
  const open = programs.filter((p) => p.entriesOpen);
  if (open.length === 0) {
    return null;
  }
  open.sort((a, b) => new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime());
  return open[0];
}

function statusGlyph(state: string, statusLabel: string): HTMLElement {
  if (state === "disqualified") {
    const holder = h("span", { class: "status-marker marker-disqualified" });
    holder.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    holder.append(statusLabel);
    return holder;
  }
  return h("span", { text: statusLabel });
}

export async function renderStudioEntries(main: HTMLElement): Promise<void> {
  const programs = (await get<{ programs: ProgramView[] }>("/api/programs")).programs;
  const program = openProgram(programs) ?? programs[0] ?? null;
  setBand({
    contextName: program?.name ?? "Cutline Jury Desk",
    countdownIso: program?.entriesOpen ? program.deadlineAt : null,
  });
  main.textContent = "";
  main.append(h("h1", { class: "page-title", text: "Your entries" }));
  const entries = (await get<{ entries: EntryView[] }>("/api/entries")).entries;

  const actions = h("div", { class: "actions-row" });
  if (program?.entriesOpen) {
    actions.append(
      h("button", { class: "primary", type: "button", text: "New entry", onclick: () => void navigate("/studio/entries/new") }),
      h("span", { class: "mono", text: `Entries close ${program.deadlineLabel}` }),
    );
  } else {
    actions.append(h("p", { text: "Entries are closed." }));
  }

  const table = h("table", { class: "ranked", "aria-label": "Your entries", "data-standings": "" }) as HTMLTableElement;
  table.append(h("thead", {}, h("tr", {},
    h("th", { scope: "col", text: "Entry number" }),
    h("th", { scope: "col", text: "Title" }),
    h("th", { scope: "col", text: "Category" }),
    h("th", { scope: "col", text: "Status" }),
    h("th", { scope: "col", text: "Fee" }),
  )));
  const tbody = h("tbody");
  for (const entry of entries) {
    tbody.append(h("tr", {},
      h("td", { class: "cell-rank", text: String(entry.entryNumber) }),
      h("td", { class: "cell-title" }, h("a", { href: `/studio/entries/${entry.id}`, text: entry.title }), h("span", { class: "cell-sub", style: "display:block", text: entry.categoryName })),
      h("td", { text: entry.categoryName }),
      h("td", {}, statusGlyph(entry.state, entry.statusLabel)),
      h("td", { class: "cell-score", text: entry.fee ? `$${money(entry.fee.amountCents)}` : "—" }),
    ));
  }
  table.append(tbody);
  main.append(actions, table);
}

export async function renderEntry(main: HTMLElement, entryId: string | null): Promise<void> {
  main.textContent = "";
  const programs = (await get<{ programs: ProgramView[] }>("/api/programs")).programs;
  if (entryId) {
    const result = await get<{ entry: EntryView }>(`/api/entries/${entryId}`);
    const program = programs.find((p) => p.id === result.entry.programId) ?? null;
    await renderExistingEntry(main, result.entry, program, programs);
    return;
  }
  const program = openProgram(programs);
  if (!program) {
    setBand({ contextName: programs[0]?.name ?? "Cutline Jury Desk", countdownIso: null });
    main.append(
      h("h1", { class: "page-title", text: "New entry" }),
      h("p", { text: "Entries are closed." }),
    );
    return;
  }
  setBand({ contextName: program.name, countdownIso: program.deadlineAt });
  await draftEntry(main, null, program);
}

async function draftEntry(
  main: HTMLElement,
  existing: EntryView | null,
  program: ProgramView,
): Promise<void> {
  const categorySelect = h("select", { name: "categoryId", "aria-label": "Category", id: "entry-category" }) as HTMLSelectElement;
  if (!existing) {
    for (const category of program.categories) {
      categorySelect.append(h("option", { value: category.id, text: category.name }));
    }
  }
  const title = h("input", { type: "text", name: "title", id: "entry-title" }) as HTMLInputElement;
  const summary = h("textarea", { name: "summary", id: "entry-summary" }) as HTMLTextAreaElement;
  const siteUrl = h("input", { type: "url", name: "siteUrl", id: "entry-site" }) as HTMLInputElement;
  const credits = h("input", { type: "text", name: "credits", id: "entry-credits" }) as HTMLInputElement;
  if (existing) {
    title.value = existing.title;
    summary.value = existing.summary;
    siteUrl.value = existing.siteUrl;
    credits.value = existing.credits;
    title.disabled = summary.disabled = siteUrl.disabled = credits.disabled = existing.state !== "draft";
  }
  const saveDraft = h("button", { class: "primary", type: "submit", text: "Save draft" }) as HTMLButtonElement;
  const form = h("form", { class: "panel", "aria-label": existing ? existing.title : "New entry" },
    existing ? h("h1", { class: "page-title", text: existing.title }) : h("h1", { class: "page-title", text: "New entry" }),
    !existing ? h("label", { class: "field", for: "entry-category" }, h("span", { text: "Category" }), categorySelect) : null,
    h("label", { class: "field", for: "entry-title" }, h("span", { text: "Title" }), title),
    h("label", { class: "field", for: "entry-summary" }, h("span", { text: "Case study" }), summary),
    h("label", { class: "field", for: "entry-site" }, h("span", { text: "Site address" }), siteUrl),
    h("label", { class: "field", for: "entry-credits" }, h("span", { text: "Credits" }), credits),
    saveDraft,
  ) as HTMLFormElement;

  const details = h("div", {}, form);
  const side = h("div");
  main.append(h("div", { class: "two-col" }, details, side));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await withPending(saveDraft, "Saving draft…", async () => {
        const body = {
          categoryId: existing?.categoryId ?? categorySelect.value,
          title: title.value,
          summary: summary.value,
          siteUrl: siteUrl.value,
          credits: credits.value,
        };
        if (existing) {
          await patch(`/api/entries/${existing.id}`, body);
          deskStatusAuto("Draft saved.");
        } else {
          const created = await post<{ entry: EntryView }>("/api/entries", body);
          deskStatusAuto("Draft saved.");
          await navigate(`/studio/entries/${created.entry.id}`, true);
        }
      });
    } catch (error) {
      const note = fieldError(error, "title") ?? fieldError(error, "summary") ?? fieldError(error, "siteUrl") ?? fieldError(error, "credits") ?? fieldError(error, "categoryId");
      if (note) {
        deskError(note);
        title.focus();
      } else {
        deskError(deskErrorFrom(error));
      }
    }
  });

  if (existing) {
    await renderEntrySide(side, existing, program);
  } else {
    await renderDraftSide(side, program, null);
  }
}

function feeRegion(program: ProgramView): { fee: number; tier: "early_bird" | "standard"; earlyBirdOpen: boolean } {
  const earlyBirdOpen = new Date(program.earlyBirdEndsAt).getTime() > Date.now();
  return {
    fee: earlyBirdOpen ? program.earlyBirdFeeCents : program.standardFeeCents,
    tier: earlyBirdOpen ? "early_bird" : "standard",
    earlyBirdOpen,
  };
}

async function renderDraftSide(side: HTMLElement, program: ProgramView, _entry: EntryView | null): Promise<void> {
  side.textContent = "";
  const feePanel = await feePanelFor(program);
  side.append(feePanel);
  // The fee panel refetches the program when the countdown passes the early-bird end.
  const earlyBirdEnds = new Date(program.earlyBirdEndsAt).getTime();
  const untilEnd = earlyBirdEnds - Date.now();
  if (untilEnd > 0 && untilEnd < 24 * 60 * 60 * 1000) {
    window.setTimeout(async () => {
      const fresh = (await get<{ programs: ProgramView[] }>("/api/programs")).programs.find((p) => p.id === program.id);
      if (fresh && side.isConnected && side.contains(feePanel)) {
        const updated = await feePanelFor(fresh);
        feePanel.replaceWith(updated);
        const pay = document.querySelector<HTMLButtonElement>("button[class*='primary']");
        const region = updated.querySelector<HTMLElement>(".fee-amount");
        const match = /\$(\d+\.\d+)/.exec(region?.textContent ?? "");
        if (pay && match && pay.textContent?.startsWith("Pay ")) {
          pay.textContent = `Pay ${match[1]} and submit`;
        }
      }
    }, untilEnd + 100);
  }
}

async function feePanelFor(program: ProgramView): Promise<HTMLElement> {
  const feeRegionNow = feeRegion(program);
  return h("div", { class: "fee-panel", role: "region", "aria-label": "Fee" },
    h("p", { class: "fee-line" }, h("strong", { text: "Entry fee " }), h("span", { class: "fee-amount", text: `$${money(feeRegionNow.fee)} (${feeRegionNow.tier === "early_bird" ? "Early-bird" : "Standard"})` })),
    h("p", { class: "fee-line", text: feeRegionNow.earlyBirdOpen ? `Early-bird ends ${program.earlyBirdLabel}` : `Early-bird ended ${program.earlyBirdLabel}` }),
    h("p", { class: "fee-line", text: `Entries close ${program.deadlineLabel}` }),
  );
}

async function renderExistingEntry(main: HTMLElement, entry: EntryView, program: ProgramView | null, programs: ProgramView[]): Promise<void> {
  const zoneProgram = program ?? programs.find((p) => p.id === entry.programId) ?? null;
  if (zoneProgram) {
    setBand({
      contextName: zoneProgram.name,
      countdownIso: zoneProgram.entriesOpen ? zoneProgram.deadlineAt : null,
    });
  }
  main.textContent = "";
  await draftEntry(main, entry, (zoneProgram ?? program) as ProgramView);
  const side = main.querySelector<HTMLElement>(".two-col > div:last-child");
  if (side) {
    await renderEntrySide(side, entry, zoneProgram as ProgramView | null);
  }
}

async function renderEntrySide(side: HTMLElement, entry: EntryView, program: ProgramView | null): Promise<void> {
  side.textContent = "";

  const statusLine = h("p", {}, h("strong", { text: `Status: ${entry.statusLabel}` }));
  const reasonLine = entry.state === "disqualified" ? h("p", { text: `Reason: ${entry.disqualifyReason ?? ""}` }) : null;
  side.append(statusLine);
  if (reasonLine) {
    side.append(reasonLine);
  }

  if (entry.state === "published" || entry.award) {
    side.append(h("div", { class: "notice" }, h("p", { text: entry.award === "winner" ? "Winner" : entry.award === "finalist" ? "Finalist" : entry.award ? "Honourable mention" : "" }), entry.score ? h("p", { class: "mono", text: entry.score }) : null));
  }

  // Fee or receipt panel.
  if (entry.state === "draft") {
    if (program) {
      await renderDraftSide(side, program, entry);
    }
    const uploadZone = buildUploadZone(entry);
    side.append(uploadZone);
    const images = h("ul", { class: "image-list", "aria-label": "Case-study images" });
    renderImages(images, entry, true, uploadZone);
    side.append(images);
    const payButton = h("button", { class: "primary", type: "button", text: "Pay and submit" }) as HTMLButtonElement;
    const key = idempotencyKeyFor(entry.id);
    payButton.textContent = `Pay $${money(feeAtPay(program, entry))} and submit`;
    payButton.addEventListener("click", async () => {
      try {
        await withPending(payButton, "Recording your payment…", async () => {
          const result = await post<{ entry: EntryView }>(`/api/entries/${entry.id}/submit`, {}, key);
          deskStatusAuto(`Entry ${result.entry.entryNumber} submitted. Receipt sent to ${currentUser()?.email ?? "your studio inbox"}.`);
          await navigate(`/studio/entries/${entry.id}`, true);
          const receipt = document.querySelector<HTMLElement>(".receipt-panel h2, .receipt-panel");
          if (receipt) {
            receipt.scrollIntoView({ block: "center" });
            receipt.setAttribute("tabindex", "-1");
            receipt.focus();
          }
        });
      } catch (error) {
        deskError(deskErrorFrom(error));
      }
    });
    const deleteDraft = h("button", { class: "danger", type: "button", text: "Delete draft" }) as HTMLButtonElement;
    deleteDraft.addEventListener("click", () => {
      openDialog({
        title: "Delete this draft?",
        body: "This removes the entry and its images.",
        actions: [
          { label: "Keep draft", value: "keep", kind: "plain" },
          { label: "Delete draft", value: "delete", kind: "danger" },
        ],
        safeValue: "keep",
        onChoose: async (value) => {
          if (value !== "delete") {
            return;
          }
          try {
            await withPending(deleteDraft, "Deleting draft…", async () => {
              await del(`/api/entries/${entry.id}`);
              deskStatusAuto("Draft deleted.");
              await navigate("/studio");
            });
          } catch (error) {
            deskError(deskErrorFrom(error));
          }
        },
      });
    });
    side.append(h("div", { class: "actions-row" }, payButton, deleteDraft));
    return;
  }

  // Receipt panel for paid entries.
  const feeText = entry.fee ? `$${money(entry.fee.amountCents)} (${entry.fee.tier === "early_bird" ? "Early-bird" : "Standard"})` : "";
  const receiptPanel = h("div", { class: "receipt-panel", role: "region", "aria-label": "Receipt" },
    h("h2", { class: "section-title", text: "Receipt" }),
    feeText ? h("p", { class: "receipt-amount", text: feeText }) : null,
    entry.submittedAt ? h("p", { class: "receipt-line", text: `Paid ${new Date(entry.submittedAt).toLocaleString("en-GB", { timeZone: "UTC" })}` }) : null,
  );
  side.append(receiptPanel);
  if (entry.fee) {
    try {
      const receipt = await get<{ receipt: { invoiceId: string; refund: { amountCents: number; refundedAt: string } | null } }>(`/api/entries/${entry.id}/receipt`);
      const invoiceLine = h("p", { class: "receipt-line", text: `Invoice ${receipt.receipt.invoiceId}` });
      receiptPanel.append(invoiceLine);
      if (receipt.receipt.refund) {
        receiptPanel.append(h("p", { class: "receipt-line", text: `Refund of $${money(receipt.receipt.refund.amountCents)} recorded` }));
      }
    } catch {
      // the entry was never paid
    }
  }

  const images = h("ul", { class: "image-list", "aria-label": "Case-study images" });
  renderImages(images, entry, false, null);
  side.append(images);

  if (entry.canWithdraw) {
    const withdraw = h("button", { class: "danger", type: "button", text: "Withdraw entry" }) as HTMLButtonElement;
    withdraw.addEventListener("click", () => {
      const fee = entry.fee?.amountCents ?? 0;
      openDialog({
        title: "Withdraw entry?",
        body: entry.refundOnWithdraw
          ? `You'll be refunded $${money(fee)}.`
          : "The deadline has passed, so there is no refund.",
        actions: [
          { label: "Keep entry", value: "keep", kind: "plain" },
          { label: "Withdraw", value: "withdraw", kind: "danger" },
        ],
        safeValue: "keep",
        onChoose: async (value) => {
          if (value !== "withdraw") {
            return;
          }
          try {
            await withPending(withdraw, "Withdrawing…", async () => {
              const result = await post<{ entry: EntryView; refund: unknown }>(`/api/entries/${entry.id}/withdraw`);
              deskStatusAuto(result.refund ? `Entry ${result.entry.entryNumber} withdrawn. Refund of $${money((result.refund as { amountCents: number }).amountCents)} recorded.` : `Entry ${result.entry.entryNumber} withdrawn. No refund after the deadline.`);
              await navigate(`/studio/entries/${entry.id}`, true);
            });
          } catch (error) {
            deskError(deskErrorFrom(error));
          }
        },
      });
    });
    side.append(withdraw);
  }
}

function feeAtPay(program: ProgramView | null, entry: EntryView): number {
  if (program) {
    return feeRegion(program).fee;
  }
  return entry.fee?.amountCents ?? 0;
}

const idempotencyKeys = new Map<string, string>();

/** One idempotency key per entry page visit, reused after a timeout or outage. */
function idempotencyKeyFor(entryId: string): string {
  if (!idempotencyKeys.has(entryId)) {
    idempotencyKeys.set(entryId, `${entryId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }
  return idempotencyKeys.get(entryId) as string;
}

function buildUploadZone(entry: EntryView): HTMLElement {
  const input = h("input", { type: "file", accept: "image/png, image/jpeg", "aria-label": "Add case-study images" }) as HTMLInputElement;
  input.style.position = "absolute";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.opacity = "0";
  const zone = h("div", { class: "drop-zone", tabindex: "0", role: "button", "aria-label": "Add case-study images", text: "Drop PNG or JPEG images here" });
  zone.append(input);
  const openPicker = () => input.click();
  zone.addEventListener("click", (event) => {
    if (event.target !== input) {
      openPicker();
    }
  });
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openPicker();
    }
  });
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
    void handleFiles(entry.id, event.dataTransfer?.files ?? new FileList());
  });
  input.addEventListener("change", () => {
    void handleFiles(entry.id, input.files ?? new FileList());
  });
  return zone;
}

async function handleFiles(entryId: string, files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    const pending = document.createElement("p");
    pending.className = "pending-line";
    const bar = document.createElement("progress");
    bar.className = "upload-progress";
    bar.max = 100;
    bar.value = 0;
    pending.textContent = `Uploading ${file.name}…`;
    const statusArea = document.querySelector(".actions-row");
    (statusArea ?? document.getElementById("main"))?.prepend(pending, bar);
    try {
      const result = await uploadFile<{ asset: { name: string; width: number; height: number } }>(`/api/entries/${entryId}/assets`, file, (loaded, total) => {
        bar.value = total > 0 ? (loaded / total) * 100 : 0;
      });
      deskStatusAuto(`${file.name} added, ${result.asset.width} × ${result.asset.height} pixels.`);
    } catch (error) {
      deskError(error instanceof ApiFailure && error.errors?.file ? error.errors.file : deskErrorFrom(error));
    } finally {
      pending.remove();
      bar.remove();
    }
    await refreshEntry(entryId);
  }
}

export async function refreshEntry(entryId: string): Promise<void> {
  const result = await get<{ entry: EntryView }>(`/api/entries/${entryId}`);
  const images = document.querySelector<HTMLElement>('ul[aria-label="Case-study images"]');
  const zone = document.querySelector<HTMLElement>(".drop-zone");
  if (images && result.entry.state === "draft") {
    renderImages(images, result.entry, true, zone);
  }
}

function renderImages(list: HTMLElement, entry: EntryView, withRemove: boolean, _zone: HTMLElement | null): void {
  list.textContent = "";
  entry.assets.forEach((asset, index) => {
    const k = index + 1;
    const li = h("li", {},
      h("img", { src: asset.url, alt: `${entry.title} — image ${k}` }),
      h("span", { class: "image-meta", text: `${asset.width} × ${asset.height} px` }),
    );
    if (withRemove) {
      const remove = h("button", { type: "button", class: "linkish", text: `Remove image ${k}` }) as HTMLButtonElement;
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        deskStatus(`Removing image…`);
        try {
          await del(`/api/entries/${entry.id}/assets/${asset.id}`);
          deskStatusAuto("Image removed.");
          await refreshEntry(entry.id);
        } catch (error) {
          deskError(deskErrorFrom(error));
          remove.disabled = false;
        }
      });
      li.append(remove);
    }
    list.append(li);
  });
}

function deskStatusAuto(text: string): void {
  deskStatus(text);
  window.setTimeout(() => deskStatus(""), 8000);
}
