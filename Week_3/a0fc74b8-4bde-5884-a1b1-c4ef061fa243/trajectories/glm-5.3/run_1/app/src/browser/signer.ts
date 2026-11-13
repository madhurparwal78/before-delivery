import { api } from "./api.js";
import { el, clear, announce, fieldFractionStyle, prefersReducedMotion, scrollToFieldTop, cpLength, truncateToCodePoints, initialsOf } from "./ui.js";
import { loadPdfBytes, renderPageInto } from "./pdfrender.js";

interface SignField {
  id: string;
  kind: "signature" | "initials" | "date" | "text";
  label: string;
  required: boolean;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  value: string | null;
}

interface SignState {
  token: string;
  state: string;
  title: string;
  recipient: { id: string; name: string; order: number; status: string };
  signerCount: number;
  current: { name: string; order: number } | null;
  senderName: string;
  declinedBy: string | null;
  voidReason: string | null;
  pageCount: number;
  timeZone: string;
  fields: SignField[];
  otherFields: { page: number; x: number; y: number; w: number; h: number }[];
}

export async function renderSignerLink(app: HTMLElement, token: string): Promise<void> {
  let data: SignState;
  try {
    data = await api.get<SignState>(`/api/sign/${token}`);
  } catch {
    clear(app);
    app.append(notice("This link is not valid", "Check that you copied the whole link."));
    return;
  }
  clear(app);
  if (data.state !== "your_turn") {
    app.append(await closedNotice(data, token));
    return;
  }
  await renderSigningView(app, data, token);
}

async function closedNotice(data: SignState, token: string): Promise<HTMLElement> {
  const headingFor: Record<string, string> = {
    signed_waiting: `You signed ${data.title}`,
    sealing: `You signed ${data.title}`,
    completed: `${data.title} is complete`,
    declined: data.declinedBy !== null && data.declinedBy === data.recipient.name ? "You declined this document" : "This document was declined",
    voided: "This document was voided",
    expired: "This link has expired",
  };
  const bodyFor = (state: string): string => {
    switch (state) {
      case "signed_waiting": return `Waiting for ${data.current?.name ?? ""} (signer ${data.current?.order ?? ""} of ${data.signerCount}).`;
      case "sealing": return "Your signature is recorded. The completed PDF will be emailed once it is sealed.";
      case "completed": return "Everyone has signed.";
      case "declined": return `${data.declinedBy ?? "A signer"} declined to sign. No further signatures are needed.`;
      case "voided": return `${data.senderName} voided it: ${data.voidReason ?? ""}`;
      case "expired": return `Ask ${data.senderName} to send a new link.`;
      default: return "";
    }
  };
  const wrap = notice(headingFor[data.state] ?? data.title, bodyFor(data.state));
  if (data.state === "completed") {
    wrap.append(el("a", { href: `/sign/${token}/completed.pdf`, text: "Download completed PDF" }));
  }
  return wrap;
}

function notice(heading: string, body: string): HTMLElement {
  return el("div", { class: "notice" },
    el("h1", { text: heading }),
    el("p", { text: body }),
  );
}

export async function renderSigningView(app: HTMLElement, data: SignState, token: string): Promise<void> {
  let pdfBytes: ArrayBuffer | null = null;
  try {
    pdfBytes = await loadPdfBytes(`/api/sign/${token}/original.pdf`);
  } catch {
    app.append(notice("Pages can't be shown right now", "File storage is unavailable. Your document and its fields are safe."));
    return;
  }

  const heading = el("h1", { text: data.title });
  const countText = el("span", { class: "count", id: "count-left" });
  const prevBtn = el("button", { class: "btn", type: "button", text: "Previous" });
  const nextBtn = el("button", { class: "btn", type: "button", text: "Next" });
  const finishBtn = el("button", { class: "btn primary", type: "button", text: "Finish and sign" });
  const declineBtn = el("button", { class: "btn danger", type: "button", text: "Decline" });

  const header = el("div", { class: "signer-header" },
    heading, countText, prevBtn, nextBtn, finishBtn, declineBtn);
  const progress = el("div", { class: "status-region", role: "status", id: "signing-progress" });
  const docStatus = el("div", { class: "status-region", role: "status", id: "document-status" });
  const pages = el("div", { class: "signer-pages", id: "signer-pages" });
  const dim = el("div", { class: "dim", id: "dim-layer" });
  const aperture = el("div", { id: "aperture", "aria-hidden": "true" });

  clear(app);
  app.append(header, progress, docStatus, pages);

  const fieldNodes = new Map<string, HTMLElement>();

  for (let n = 1; n <= data.pageCount; n++) {
    const group = el("div", {
      class: "pdf-page", role: "group", "aria-label": `Page ${n} of ${data.pageCount}`, id: `page-${n}`,
    });
    pages.append(group);
    await renderPageInto(pdfBytes, n, group);
    for (const other of data.otherFields.filter((f) => f.page === n)) {
      group.append(el("div", { class: "signer-field other", style: fieldFractionStyle(other), "aria-hidden": "true" }));
    }
    for (const field of data.fields.filter((f) => f.page === n)) {
      const node = makeFieldNode(field);
      fieldNodes.set(field.id, node);
      group.append(node);
    }
  }
  pages.append(dim, aperture);

  // Order the walk: reading order per page: top edge then left edge.
  const requiredNonDate = data.fields
    .filter((f) => f.required && f.kind !== "date")
    .sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));
  let currentIndex = 0;

  function isTextComplete(field: SignField): boolean {
    return field.value !== null && field.value.trim() !== "";
  }
  function isFieldComplete(field: SignField): boolean {
    if (field.kind === "date") return true;
    if (field.value === null || field.value === "") return false;
    if (field.kind === "text") return isTextComplete(field);
    return true;
  }
  function incompleteCount(): number {
    return requiredNonDate.filter((f) => !isFieldComplete(f)).length;
  }
  function updateCount(): void {
    countText.textContent = `${incompleteCount()} left`;
  }
  updateCount();

  function announceField(field: SignField, index: number | null): void {
    if (index === null) {
      announce("signing-progress", `Optional field: ${field.label}, page ${field.page}`);
    } else {
      announce("signing-progress", `Field ${index} of ${requiredNonDate.length}: ${field.label}, page ${field.page}`);
    }
  }

  function apertureBox(field: SignField): void {
    const group = document.getElementById(`page-${field.page}`);
    if (group === null) return;
    const groupRect = group.getBoundingClientRect();
    const pagesRect = pages.getBoundingClientRect();
    aperture.style.left = `${groupRect.left - pagesRect.left + field.x * groupRect.width}px`;
    aperture.style.top = `${groupRect.top - pagesRect.top + field.y * groupRect.height}px`;
    aperture.style.width = `${field.w * groupRect.width}px`;
    aperture.style.height = `${field.h * groupRect.height}px`;
  }

  let animFrame = 0;

  function moveTo(field: SignField, index: number | null, opts: { reverse?: boolean } = {}): void {
    const node = fieldNodes.get(field.id);
    if (node === undefined) return;
    // The aperture box is measured before and after the move so the frame can animate between them.
    const fromBox = aperture.getBoundingClientRect();
    apertureBox(field);
    const toBox = aperture.getBoundingClientRect();

    if (prefersReducedMotion()) {
      scrollToFieldTop(node);
      focusField(field, node, index);
      return;
    }

    const duration = 380;
    const startTime = performance.now();
    cancelAnimationFrame(animFrame);

    const startLeft = fromBox.left;
    const startTop = fromBox.top;
    const startW = fromBox.width;
    const startH = fromBox.height;
    const endLeft = toBox.left;
    const endTop = toBox.top;
    const endW = toBox.width;
    const endH = toBox.height;
    const startScroll = window.scrollY;
    const targetScroll = computeTargetScroll(node);

    const step = (now: number): void => {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = t * (2 - t);
      aperture.style.left = `${startLeft + (endLeft - startLeft) * eased}px`;
      aperture.style.top = `${startTop + (endTop - startTop) * eased}px`;
      aperture.style.width = `${startW + (endW - startW) * eased}px`;
      aperture.style.height = `${startH + (endH - startH) * eased}px`;
      window.scrollTo({ top: startScroll + (targetScroll - startScroll) * eased });
      if (t < 1) animFrame = requestAnimationFrame(step);
      else focusField(field, node, index);
    };
    animFrame = requestAnimationFrame(step);
  }

  function computeTargetScroll(node: HTMLElement): number {
    const rect = node.getBoundingClientRect();
    const absoluteTop = rect.top + window.scrollY;
    const desired = absoluteTop - window.innerHeight * 0.35;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return Math.max(0, Math.min(desired, max));
  }

  function focusField(field: SignField, node: HTMLElement, index: number | null): void {
    node.focus({ preventScroll: true });
    announceField(field, index);
    scrollToFieldTop(node);
  }

  function next(): void {
    const incomplete = requiredNonDate.filter((f) => !isFieldComplete(f));
    if (incomplete.length === 0) {
      finishBtn.focus();
      countText.textContent = "0 left";
      return;
    }
    const current = requiredNonDate[currentIndex];
    if (current !== undefined && !isFieldComplete(current)) {
      const pos = incomplete.indexOf(current);
      const target = incomplete[(pos + 1) % incomplete.length];
      currentIndex = requiredNonDate.indexOf(target);
      moveTo(target, currentIndex + 1);
    } else {
      const target = incomplete[0];
      currentIndex = requiredNonDate.indexOf(target);
      moveTo(target, currentIndex + 1);
    }
  }

  function previous(): void {
    const incomplete = requiredNonDate.filter((f) => !isFieldComplete(f));
    if (incomplete.length === 0) {
      finishBtn.focus();
      return;
    }
    const current = requiredNonDate[currentIndex];
    if (current !== undefined && !isFieldComplete(current)) {
      const pos = incomplete.indexOf(current);
      const target = incomplete[(pos - 1 + incomplete.length) % incomplete.length];
      currentIndex = requiredNonDate.indexOf(target);
      moveTo(target, currentIndex + 1, { reverse: true });
    } else {
      const target = incomplete[incomplete.length - 1];
      currentIndex = requiredNonDate.indexOf(target);
      moveTo(target, currentIndex + 1, { reverse: true });
    }
  }

  nextBtn.addEventListener("click", next);
  prevBtn.addEventListener("click", previous);

  // Enter/Tab in a completed field acts as Next.
  for (const [id, node] of fieldNodes.entries()) {
    const field = data.fields.find((f) => f.id === id)!;
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && isFieldComplete(field)) {
        event.preventDefault();
        next();
      }
    });
    node.addEventListener("keydown", (event) => {
      if (event.key === "Tab" && !event.shiftKey && isFieldComplete(field)) {
        const incomplete = requiredNonDate.filter((f) => !isFieldComplete(f));
        const otherIncomplete = incomplete.filter((f) => f.id !== field.id);
        if (otherIncomplete.length > 0) {
          event.preventDefault();
          next();
        }
      }
    });
    node.addEventListener("focus", () => {
      const idx = requiredNonDate.indexOf(field);
      if (idx >= 0) {
        currentIndex = idx;
        apertureBox(field);
        announceField(field, idx + 1);
      } else {
        apertureBox(field);
        announceField(field, null);
      }
    });
  }

  finishBtn.addEventListener("click", async () => {
    const incomplete = requiredNonDate.filter((f) => !isFieldComplete(f));
    if (incomplete.length > 0) {
      announce("signing-progress", `Complete ${incomplete.length} required fields first.`);
      currentIndex = requiredNonDate.indexOf(incomplete[0]);
      moveTo(incomplete[0], currentIndex + 1);
      return;
    }
    finishBtn.disabled = true;
    announce("signing-progress", "Signing...");
    try {
      const res = await api.post<{ state: string }>(`/api/sign/${token}/finish`);
      if (res.state === "completed" || res.state === "sealing" || res.state === "signed_waiting") {
        clear(app);
        const fresh = await api.get<SignState>(`/api/sign/${token}`);
        app.append(await closedNotice(fresh, token));
      }
    } catch {
      finishBtn.disabled = false;
      announce("signing-progress", "Something went wrong. Try again.");
    }
  });

  declineBtn.addEventListener("click", () => openDeclineDialog(declineBtn, token));

  // First open: focus the first incomplete required field.
  const firstIncomplete = requiredNonDate.find((f) => !isFieldComplete(f)) ?? requiredNonDate[0];
  if (firstIncomplete !== undefined) {
    currentIndex = requiredNonDate.indexOf(firstIncomplete);
    moveTo(firstIncomplete, currentIndex + 1);
  }

  /* ---------- field nodes ---------- */

  function makeFieldNode(field: SignField): HTMLElement {
    if (field.kind === "text") {
      const input = el("input", {
        type: "text", class: "signer-field", id: `field-${field.id}`, "aria-label": field.label,
        style: fieldFractionStyle(field),
      }) as HTMLInputElement;
      input.value = field.value ?? "";
      const counterId = `counter-${field.id}`;
      const counter = el("span", { class: "counter visually-hidden", id: counterId, "aria-live": "off" });
      const updateCounter = (): void => {
        counter.textContent = `${cpLength(input.value)} of 200 characters`;
      };
      input.addEventListener("input", () => {
        if (cpLength(input.value) > 200) input.value = truncateToCodePoints(input.value, 200);
        field.value = input.value;
        updateCounter();
        updateCount();
      });
      input.addEventListener("blur", async () => {
        await api.put(`/api/sign/${token}/fields/${field.id}`, { value: input.value });
        field.value = input.value;
        updateCount();
      });
      updateCounter();

      // attach counter visually below the field
      input.addEventListener("focus", () => {
        const group = input.parentElement;
        if (group !== null && group.querySelector(`#vis-${counterId}`) === null) {
          const vis = el("span", { class: "counter", id: `vis-${counterId}`, text: counter.textContent ?? "" });
          vis.style.position = "absolute";
          vis.style.left = `${field.x * 100}%`;
          vis.style.top = `${(field.y + field.h) * 100 + 1}%`;
          group.append(vis);
        }
        const visNode = document.getElementById(`vis-${counterId}`);
        input.addEventListener("input", () => { if (visNode !== null) visNode.textContent = counter.textContent ?? ""; });
      });
      return input;
    }
    if (field.kind === "date") {
      const input = el("input", {
        type: "text", class: "signer-field", id: `field-${field.id}`, "aria-label": field.label,
        "aria-readonly": "true", readonly: true, style: fieldFractionStyle(field),
      }) as HTMLInputElement;
      input.value = "Filled when you sign";
      return input;
    }
    // signature / initials
    const btn = el("button", {
      type: "button", class: "signer-field", id: `field-${field.id}`, "aria-label": field.label,
      style: fieldFractionStyle(field),
    });
    btn.dataset.signerName = data.recipient.name;
    if (field.value !== null && field.value !== "") {
      btn.classList.add("filled");
      btn.textContent = field.value.startsWith("typed:") ? field.value.slice("typed:".length) : "Signed";
    } else {
      btn.textContent = field.label;
    }
    btn.addEventListener("click", () => {
      openAdoptDialog(btn, field, token);
    });
    btn.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        openAdoptDialog(btn, field, token);
      }
    });
    return btn;
  }
}

/* ---------- adopt dialog ---------- */

function openAdoptDialog(openedBy: HTMLElement, field: SignField, token: string): void {
  const isSignature = field.kind === "signature";
  const dialogTitle = isSignature ? "Adopt your signature" : "Adopt your initials";
  const recipientName = openedBy.dataset.signerName ?? "";
  const progress = document.getElementById("signing-progress");

  const typePanel = el("div", { role: "tabpanel", id: "adopt-type-panel" },
    el("label", { for: "adopt-typed", text: isSignature ? "Full name" : "Initials" }),
  );
  const typed = el("input", { type: "text", id: "adopt-typed", "aria-label": isSignature ? "Full name" : "Initials" }) as HTMLInputElement;
  typePanel.append(typed);

  const pad = el("canvas", { class: "sig-pad", id: "adopt-pad", role: "img", "aria-label": "Signature pad" });
  const strokes: { x: number; y: number }[][] = [];
  const ctx = pad.getContext("2d");

  const drawPanel = el("div", { role: "tabpanel", id: "adopt-draw-panel", hidden: "true" },
    pad,
    el("button", { class: "btn ghost", type: "button", text: "Clear", id: "adopt-clear" }),
  );

  let activeTab = "type";
  const typeTab = el("button", { role: "tab", type: "button", id: "tab-type", "aria-selected": "true", text: "Type" });
  const drawTab = el("button", { role: "tab", type: "button", id: "tab-draw", "aria-selected": "false", text: "Draw" });
  const tablist = el("div", { role: "tablist", "aria-label": "Adopt method" }, typeTab, drawTab);

  const adoptBtn = el("button", { class: "btn primary", type: "button", text: "Adopt and sign", disabled: true });
  const cancelBtn = el("button", { class: "btn", type: "button", text: "Cancel" });

  const dialog = el("div", { class: "dialog-backdrop" },
    el("div", { class: "dialog", role: "dialog", "aria-label": dialogTitle },
      el("h2", { text: dialogTitle }),
      tablist, typePanel, drawPanel,
      el("div", { class: "actions" }, cancelBtn, adoptBtn),
    ),
  );
  document.body.append(dialog);

  function refreshAdopt(): void {
    const has = activeTab === "type" ? typed.value.trim() !== "" : strokes.length > 0;
    adoptBtn.disabled = !has;
  }

  function selectTab(which: "type" | "draw"): void {
    activeTab = which;
    typeTab.setAttribute("aria-selected", which === "type" ? "true" : "false");
    drawTab.setAttribute("aria-selected", which === "draw" ? "true" : "false");
    typePanel.hidden = which !== "type";
    drawPanel.hidden = which !== "draw";
    if (which === "type") typed.focus();
    else pad.focus?.();
    refreshAdopt();
  }
  typeTab.addEventListener("click", () => selectTab("type"));
  drawTab.addEventListener("click", () => selectTab("draw"));

  tablist.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(event.key === "ArrowLeft" ? "type" : "draw");
    }
  });

  typed.addEventListener("input", refreshAdopt);

  // pointer drawing with touch-action none so the page never scrolls
  let drawing = false;
  let currentStroke: { x: number; y: number }[] = [];
  pad.addEventListener("pointerdown", (event) => {
    drawing = true;
    currentStroke = [];
    const rect = pad.getBoundingClientRect();
    currentStroke.push({ x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
    pad.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  pad.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const rect = pad.getBoundingClientRect();
    const point = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
    currentStroke.push(point);
    if (ctx !== null) {
      ctx.strokeStyle = "#1a2233";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      const last = currentStroke[currentStroke.length - 2];
      if (last !== undefined) {
        ctx.beginPath();
        ctx.moveTo(last.x * rect.width, last.y * rect.height);
        ctx.lineTo(point.x * rect.width, point.y * rect.height);
        ctx.stroke();
      }
    }
  });
  const endStroke = (): void => {
    if (!drawing) return;
    drawing = false;
    if (currentStroke.length > 0) strokes.push(currentStroke);
    refreshAdopt();
  };
  pad.addEventListener("pointerup", endStroke);
  pad.addEventListener("pointercancel", endStroke);
  pad.addEventListener("pointerleave", endStroke);

  drawPanel.querySelector("#adopt-clear")?.addEventListener("click", () => {
    strokes.length = 0;
    if (ctx !== null) ctx.clearRect(0, 0, pad.width, pad.height);
    refreshAdopt();
  });

  const close = (): void => {
    dialog.remove();
    openedBy.focus();
  };
  cancelBtn.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, input, canvas"))
        .filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  dialog.addEventListener("pointerdown", (event) => {
    if (event.target === dialog) close();
  });

  adoptBtn.addEventListener("click", async () => {
    adoptBtn.disabled = true;
    const payload = activeTab === "type"
      ? { typed: typed.value }
      : { strokes };
    try {
      await api.put(`/api/sign/${token}/fields/${field.id}`, payload);
      const isTyped = activeTab === "type";
      field.value = isTyped ? `typed:${typed.value}` : "drawn";
      openedBy.classList.add("filled");
      openedBy.textContent = isTyped ? typed.value : "Signed";
      close();
    } catch {
      adoptBtn.disabled = false;
      if (progress !== null) announce("signing-progress", "Something went wrong. Try again.");
    }
  });

  // prefill
  typed.value = isSignature ? recipientName : initialsOf(recipientName);
  refreshAdopt();
  selectTab("type");
}

/* ---------- decline dialog ---------- */

function openDeclineDialog(openedBy: HTMLElement, token: string): void {
  const reason = el("input", { type: "text", id: "decline-reason", "aria-label": "Reason" }) as HTMLInputElement;
  const counter = el("div", { class: "counter", text: "0 of 500 characters" });
  const errorBox = el("div", { class: "alert", role: "alert", hidden: true });
  const declineBtn = el("button", { class: "btn danger", type: "button", text: "Decline" });
  const cancelBtn = el("button", { class: "btn", type: "button", text: "Cancel" });
  const progress = document.getElementById("signing-progress");

  reason.addEventListener("input", () => {
    if (cpLength(reason.value) > 500) reason.value = truncateToCodePoints(reason.value, 500);
    counter.textContent = `${cpLength(reason.value)} of 500 characters`;
  });

  const dialog = el("div", { class: "dialog-backdrop" },
    el("div", { class: "dialog", role: "dialog", "aria-label": "Decline to sign" },
      el("h2", { text: "Decline to sign" }),
      el("label", { for: "decline-reason", text: "Reason" }),
      reason, counter, errorBox,
      el("div", { class: "actions" }, cancelBtn, declineBtn),
    ),
  );
  document.body.append(dialog);
  reason.focus();

  const close = (): void => { dialog.remove(); openedBy.focus(); };
  cancelBtn.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("button, input"))
        .filter((node) => !node.hasAttribute("disabled"));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  declineBtn.addEventListener("click", async () => {
    if (cpLength(reason.value.trim()) < 1) {
      errorBox.hidden = false;
      errorBox.textContent = "Enter a reason for declining.";
      reason.focus();
      return;
    }
    declineBtn.disabled = true;
    if (progress !== null) announce("signing-progress", "Declining...");
    try {
      await api.post(`/api/sign/${token}/decline`, { reason: reason.value });
      dialog.remove();
      window.location.reload();
    } catch {
      declineBtn.disabled = false;
      errorBox.hidden = false;
      errorBox.textContent = "Something went wrong. Try again.";
    }
  });
}
