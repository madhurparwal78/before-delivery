import { api, type DocumentDto, type FieldDto, type RecipientDto, type SessionInfo, recipientRowWord } from "./api.js";
import { el, clear, announce, positionCopy, fieldFractionStyle, prefersReducedMotion, cpLength, truncateToCodePoints } from "./ui.js";
import { loadPdfBytes, renderPageInto } from "./pdfrender.js";
import { frame } from "./router.js";
import { LiveChannel } from "./live.js";

const MIN_SIZE = 0.02;

interface EditorState {
  doc: DocumentDto;
  pdfBytes: ArrayBuffer | null;
  pdfError: boolean;
  selectedFieldId: string | null;
  currentTargetPage: number;
  armedKind: "signature" | "initials" | "date" | "text" | null;
}

export async function renderDocumentEditor(app: HTMLElement, documentId: string, info: SessionInfo): Promise<void> {
  let doc: DocumentDto;
  try {
    doc = await api.get<DocumentDto>(`/api/documents/${documentId}`);
  } catch {
    await import("./router.js").then((m) => m.renderNotFound(app));
    return;
  }

  const state: EditorState = {
    doc,
    pdfBytes: null,
    pdfError: false,
    selectedFieldId: null,
    currentTargetPage: 1,
    armedKind: null,
  };

  const heading = el("h1", { text: doc.title, id: "doc-heading" });
  const statusLine = el("span", { class: "row-word", id: "doc-status-word" });
  const nextStepLine = el("span", { class: "row-word", id: "doc-next-step" });
  const headRow = el("div", { style: "display:flex; gap:1rem; align-items:baseline; flex-wrap:wrap" }, heading, statusLine, nextStepLine);

  const updates = el("div", { class: "status-region", role: "status", id: "doc-updates" });
  const serviceNotice = el("div", { class: "status-region", role: "status", id: "service-notice" });
  const fieldPosition = el("div", { class: "status-region", role: "status", id: "field-position" });
  const orderUpdates = el("div", { class: "status-region", role: "status", id: "order-updates" });
  const outcomeBanner = el("div", { class: "banner", id: "outcome-banner", hidden: true });
  const hashBanner = el("div", { class: "banner", id: "hash-banner", hidden: true });
  const pagesError = el("div", { id: "pages-error", hidden: true });

  const navPages = el("nav", { "aria-label": "Pages", class: "filmstrip", id: "filmstrip" });
  const pageComboWrap = el("div", { class: "page-combo" });
  const pagesColumn = el("div", { class: "pages-column" });
  const fieldsToolbar = el("div", { class: "fields-toolbar", role: "toolbar", "aria-label": "Fields", id: "fields-toolbar" });
  const routingColumn = el("aside", { class: "routing-column", id: "routing-column" });
  const panel = el("aside", { class: "panel", role: "complementary", "aria-label": "Field properties", id: "field-panel", hidden: true });
  const sheetButton = el("button", { class: "btn", type: "button", text: "Signing order", id: "open-sheet" });
  const sheet = el("div", { class: "sheet", role: "dialog", "aria-label": "Signing order", id: "order-sheet", hidden: true });

  const grid = el("div", { class: "doc-layout" }, navPages, pagesColumn, routingColumn);
  const content = el("div", {},
    headRow, updates, serviceNotice, fieldPosition, orderUpdates, outcomeBanner, hashBanner,
    sheetButton, pagesError, pageComboWrap, grid, panel, sheet);
  const shell = frame("/documents", content);
  clear(app);
  app.append(shell);

  sheetButton.addEventListener("click", () => {
    sheet.hidden = false;
    const first = sheet.querySelector<HTMLElement>("button, input");
    first?.focus();
  });

  const live = new LiveChannel(`doc=${documentId}`);
  live.on(async (msg) => {
    if (msg.type === "document") {
      const fresh = await api.get<DocumentDto>(`/api/documents/${documentId}`);
      const oldStatus = state.doc.status;
      state.doc = fresh;
      renderStatic();
      if (fresh.status !== oldStatus) announce("doc-updates", `${fresh.title}: ${statusWordOf(fresh)}`);
    } else if (msg.type === "health") {
      renderServiceNotice(msg.mailOk === true, msg.storageOk === true);
    }
  });
  live.connect();

  function statusWordOf(d: DocumentDto): string {
    switch (d.status) {
      case "draft": return "Draft";
      case "in_progress": return "In progress";
      case "sealing": return "Sealing";
      case "completed": return "Completed";
      case "declined": return "Declined";
      case "voided": return "Voided";
    }
  }

  function canEdit(): boolean {
    return state.doc.status === "draft" && (info.role === "owner" || (info.role === "member" && state.doc.ownerId === info.user.id));
  }

  async function loadPdf(): Promise<void> {
    try {
      state.pdfBytes = await loadPdfBytes(`/api/documents/${documentId}/original.pdf`);
      state.pdfError = false;
      await renderPages();
    } catch {
      state.pdfError = true;
      renderPagesError();
    }
  }

  function renderPagesError(): void {
    pagesError.hidden = false;
    clear(pagesError);
    const list = el("ul", { "aria-label": "Fields", role: "list" });
    for (const f of state.doc.fields) {
      const r = state.doc.recipients.find((x) => x.id === f.recipientId);
      list.append(el("li", { text: `${f.label} for ${r?.name ?? "unknown"}, page ${f.page}` }));
    }
    pagesError.append(el("h2", { text: "Pages can't be shown right now" }), list);
    pagesColumn.hidden = true;
    navPages.hidden = true;
  }

  async function renderPages(): Promise<void> {
    if (state.pdfBytes === null) return;
    clear(pagesColumn);
    if (canEdit()) {
      fieldsToolbar.hidden = false;
    } else {
      fieldsToolbar.remove();
    }
    pagesColumn.append(fieldsToolbar);
    for (let n = 1; n <= state.doc.pageCount; n++) {
      const group = el("div", {
        class: "pdf-page", role: "group", "aria-label": `Page ${n} of ${state.doc.pageCount}`,
        id: `page-${n}`, tabindex: "0",
      });
      pagesColumn.append(group);
      await renderPageInto(state.pdfBytes, n, group);
      renderPageFields(group, n);
    }
    renderFilmstrip();
    renderPageCombo();
  }

  function renderFilmstrip(): void {
    clear(navPages);
    for (let n = 1; n <= state.doc.pageCount; n++) {
      const btn = el("button", { type: "button", text: `Page ${n}`, id: `film-${n}` });
      if (n === state.currentTargetPage) btn.setAttribute("aria-current", "page");
      btn.addEventListener("click", () => {
        state.currentTargetPage = n;
        gotoPage(n);
      });
      navPages.append(btn);
    }
    navPages.addEventListener("keydown", (event) => {
      const target = event.target as HTMLButtonElement;
      const buttons = Array.from(navPages.querySelectorAll("button"));
      const index = buttons.indexOf(target);
      if (event.key === "ArrowDown" && index >= 0 && index < buttons.length - 1) {
        event.preventDefault();
        buttons[index + 1].focus();
      } else if (event.key === "ArrowUp" && index > 0) {
        event.preventDefault();
        buttons[index - 1].focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        const num = Number(target.id.replace("film-", ""));
        state.currentTargetPage = num;
        gotoPage(num);
      }
    });
  }

  function renderPageCombo(): void {
    clear(pageComboWrap);
    const combo = el("select", { "aria-label": "Page", id: "page-combo" });
    for (let n = 1; n <= state.doc.pageCount; n++) {
      const opt = el("option", { value: String(n), text: `Page ${n} of ${state.doc.pageCount}` });
      if (n === state.currentTargetPage) opt.selected = true;
      combo.append(opt);
    }
    combo.addEventListener("change", () => {
      const num = Number(combo.value);
      state.currentTargetPage = num;
      gotoPage(num);
    });
    pageComboWrap.append(combo);
  }

  function gotoPage(n: number): void {
    const group = document.getElementById(`page-${n}`);
    if (group !== null) {
      group.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
      (group as HTMLElement).focus();
    }
    renderFilmstrip();
    renderPageCombo();
  }

  function renderPageFields(group: HTMLElement, page: number): void {
    for (const field of state.doc.fields.filter((f) => f.page === page)) {
      const recipient = state.doc.recipients.find((r) => r.id === field.recipientId);
      const box = el("div", {
        class: "field-box", role: "button", tabindex: "0", id: `field-${field.id}`,
        "aria-label": `${field.label} for ${recipient?.name ?? "unknown"}`,
        style: fieldFractionStyle(field),
      });
      box.append(el("span", { text: `${field.label} for ${recipient?.name ?? "unknown"}` }));
      if (state.selectedFieldId === field.id) {
        box.setAttribute("aria-pressed", "true");
        if (canEdit()) {
          const handle = el("div", { class: "handle", role: "button", "aria-label": `Resize ${field.label}`, tabindex: "-1" });
          box.append(handle);
        }
      }
      if (canEdit()) {
        box.addEventListener("click", (event) => {
          if ((event.target as HTMLElement).classList.contains("handle")) return;
          selectField(field.id);
        });
        box.addEventListener("keydown", (event) => {
          handleFieldKeys(event, field);
        });
        attachPointerHandlers(box, field);
      }
      group.append(box);
    }
  }

  function selectField(fieldId: string): void {
    state.selectedFieldId = fieldId;
    rerenderFields();
    openProperties(fieldId);
  }

  function rerenderFields(): void {
    for (let n = 1; n <= state.doc.pageCount; n++) {
      const group = document.getElementById(`page-${n}`);
      if (group === null) continue;
      group.querySelectorAll(".field-box").forEach((node) => node.remove());
      renderPageFields(group, n);
    }
  }

  function openProperties(fieldId: string): void {
    const field = state.doc.fields.find((f) => f.id === fieldId);
    if (field === null || field === undefined) return;
    panel.hidden = false;
    clear(panel);
    const recipientOpts = state.doc.recipients.map((r) => {
      const opt = el("option", { value: r.id, text: r.name });
      if (r.id === field.recipientId) opt.selected = true;
      return opt;
    });
    const assignTo = el("select", { "aria-label": "Assign to" }, ...recipientOpts);
    assignTo.addEventListener("change", async () => {
      await api.patch(`/api/documents/${documentId}/fields/${fieldId}`, { recipientId: assignTo.value });
      await refreshDoc();
      panel.querySelector<HTMLElement>("#panel-label")?.focus();
    });
    const required = el("input", { type: "checkbox", id: "panel-required" });
    required.checked = field.required;
    required.addEventListener("change", async () => {
      await api.patch(`/api/documents/${documentId}/fields/${fieldId}`, { required: required.checked });
      await refreshDoc();
    });
    const label = el("input", { type: "text", id: "panel-label", "aria-label": "Label", value: field.label });
    label.addEventListener("input", async () => {
      if (cpLength(label.value) > 40) {
        label.value = truncateToCodePoints(label.value, 40);
      }
      await api.patch(`/api/documents/${documentId}/fields/${fieldId}`, { label: label.value });
      await refreshDoc();
    });
    const closeBtn = el("button", { class: "btn ghost", type: "button", text: "Close" });
    closeBtn.addEventListener("click", () => closeProperties());
    panel.append(
      el("h2", { text: "Field properties" }),
      el("label", { for: "panel-assign", text: "Assign to" }),
      assignTo,
      el("label", { for: "panel-required", text: "Required" }),
      required,
      el("label", { for: "panel-label", text: "Label" }),
      label,
      closeBtn,
    );
    assignTo.id = "panel-assign";
    label.focus();
  }

  function closeProperties(): void {
    panel.hidden = true;
    state.selectedFieldId = null;
    rerenderFields();
    document.getElementById(`page-${state.currentTargetPage}`)?.focus();
  }

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProperties();
    }
  });

  async function refreshDoc(): Promise<void> {
    state.doc = await api.get<DocumentDto>(`/api/documents/${documentId}`);
    rerenderFields();
    renderStatic();
    const field = state.doc.fields.find((f) => f.id === state.selectedFieldId);
    if (field !== undefined) announce("field-position", positionCopy(field));
  }

  async function handleFieldKeys(event: KeyboardEvent, field: FieldDto): Promise<void> {
    const step = event.shiftKey ? 0.05 : 0.005;
    const field2 = state.doc.fields.find((f) => f.id === field.id);
    if (field2 === undefined) return;
    let updated: Partial<FieldDto> | null = null;
    switch (event.key) {
      case "ArrowLeft": updated = { x: clamp(field2.x - step) }; break;
      case "ArrowRight": updated = { x: clamp(field2.x + step) }; break;
      case "ArrowUp": updated = { y: clamp(field2.y - step) }; break;
      case "ArrowDown": updated = { y: clamp(field2.y + step) }; break;
      case "Alt+ArrowRight": updated = { w: clamp(field2.w + step) }; break;
      case "Alt+ArrowDown": updated = { h: clamp(field2.h + step) }; break;
      case "Alt+ArrowLeft": updated = { w: clamp(field2.w - step) }; break;
      case "Alt+ArrowUp": updated = { h: clamp(field2.h - step) }; break;
      case "PageDown":
      case "PageUp": {
        event.preventDefault();
        const target = event.key === "PageDown" ? field2.page + 1 : field2.page - 1;
        if (target < 1 || target > state.doc.pageCount) return;
        await api.patch(`/api/documents/${documentId}/fields/${field2.id}`, { page: target });
        state.currentTargetPage = target;
        await refreshDoc();
        gotoPage(target);
        document.getElementById(`field-${field2.id}`)?.focus();
        return;
      }
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        await api.del(`/api/documents/${documentId}/fields/${field2.id}`);
        state.selectedFieldId = null;
        panel.hidden = true;
        await refreshDoc();
        const next = state.doc.fields.find((f) => f.page === field2.page);
        if (next !== undefined) document.getElementById(`field-${next.id}`)?.focus();
        else document.getElementById(`page-${field2.page}`)?.focus();
        return;
      }
      case "Escape": {
        event.preventDefault();
        closeProperties();
        return;
      }
      case "Enter":
      case " ":
        event.preventDefault();
        selectField(field2.id);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (updated !== null) {
      const payload = { ...updated };
      await api.patch(`/api/documents/${documentId}/fields/${field2.id}`, payload);
      await refreshDoc();
    }
  }

  function attachPointerHandlers(box: HTMLElement, field: FieldDto): void {
    let dragging = false;
    let resizing = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    let originW = 0;
    let originH = 0;

    box.addEventListener("pointerdown", (event) => {
      if (event.target instanceof Element && event.target.classList.contains("handle")) {
        resizing = true;
      } else {
        dragging = true;
      }
      selectField(field.id);
      startX = event.clientX;
      startY = event.clientY;
      originX = field.x;
      originY = field.y;
      originW = field.w;
      originH = field.h;
      box.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    box.addEventListener("pointermove", (event) => {
      if (!dragging && !resizing) return;
      const group = box.parentElement as HTMLElement | null;
      if (group === null) return;
      const rect = group.getBoundingClientRect();
      const dx = (event.clientX - startX) / rect.width;
      const dy = (event.clientY - startY) / rect.height;
      if (dragging) {
        box.style.left = `${clamp(originX + dx) * 100}%`;
        box.style.top = `${clamp(originY + dy) * 100}%`;
      } else {
        const w = Math.max(MIN_SIZE, Math.min(1, originW + dx));
        const h = Math.max(MIN_SIZE, Math.min(1, originH + dy));
        box.style.width = `${w * 100}%`;
        box.style.height = `${h * 100}%`;
      }
    });

    box.addEventListener("pointerup", async (event) => {
      if (!dragging && !resizing) return;
      dragging = false;
      resizing = false;
      const group = box.parentElement as HTMLElement | null;
      if (group === null) return;
      const rect = group.getBoundingClientRect();
      const dx = (event.clientX - startX) / rect.width;
      const dy = (event.clientY - startY) / rect.height;
      let payload: Record<string, number> = {};
      if (event.target instanceof Element && event.target.classList.contains("handle")) {
        payload = {
          w: Math.max(MIN_SIZE, Math.min(1, originW + dx)),
          h: Math.max(MIN_SIZE, Math.min(1, originH + dy)),
        };
      } else {
        payload = { x: clamp(originX + dx), y: clamp(originY + dy) };
      }
      await api.patch(`/api/documents/${documentId}/fields/${field.id}`, payload);
      await refreshDoc();
    });
  }

  function clamp(value: number): number {
    return Math.round(Math.min(1, Math.max(0, value)) * 10000) / 10000;
  }

  /* ---------- fields toolbar ---------- */

  const kindDefs: [("signature" | "initials" | "date" | "text"), string, number, number][] = [
    ["signature", "Signature", 0.3, 0.06],
    ["initials", "Initials", 0.1, 0.05],
    ["date", "Date", 0.2, 0.04],
    ["text", "Text", 0.3, 0.04],
  ];
  for (const [kind, label, w, h] of kindDefs) {
    const btn = el("button", { type: "button", text: label, id: `add-${kind}`, "data-kind": kind });
    btn.addEventListener("click", () => {
      if (window.matchMedia("(pointer: coarse)").matches) {
        // touch: arm the button, then a tap on the page places the field
        if (state.armedKind === kind) {
          state.armedKind = null;
          btn.removeAttribute("aria-pressed");
        } else {
          state.armedKind = kind;
          for (const b of fieldsToolbar.querySelectorAll("button")) b.removeAttribute("aria-pressed");
          btn.setAttribute("aria-pressed", "true");
        }
        return;
      }
      void placeField(kind, w, h, null);
    });
    btn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void placeField(kind, w, h, null);
      }
    });
    fieldsToolbar.append(btn);
  }

  async function placeField(kind: "signature" | "initials" | "date" | "text", w: number, h: number, at: { x: number; y: number; page: number } | null): Promise<void> {
    const recipients = state.doc.recipients;
    if (recipients.length === 0) return;
    const page = at?.page ?? state.currentTargetPage;
    let x = at?.x ?? 0.35;
    let y = at?.y ?? 0.35;
    x = Math.min(Math.max(x - 0, 0), 1 - w);
    y = Math.min(Math.max(y - 0, 0), 1 - h);
    const created = await api.post<FieldDto>(`/api/documents/${documentId}/fields`, {
      recipientId: recipients[0].id, kind, page, x, y, w, h, required: true,
    });
    await refreshDoc();
    state.selectedFieldId = created.id;
    rerenderFields();
    openProperties(created.id);
    const node = document.getElementById(`field-${created.id}`);
    if (node !== null) (node as HTMLElement).focus();
    const field = state.doc.fields.find((f) => f.id === created.id);
    if (field !== undefined) announce("field-position", positionCopy(field));
  }

  // Pointer drag from toolbar onto a page, plus tap-to-place on touch.
  for (const btn of Array.from(fieldsToolbar.querySelectorAll("button"))) {
    const kind = btn.getAttribute("data-kind") as "signature" | "initials" | "date" | "text";
    const def = kindDefs.find((k) => k[0] === kind)!;
    btn.addEventListener("pointerdown", (event) => {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      btn.setPointerCapture(event.pointerId);
    });
    btn.addEventListener("pointerup", (event) => {
      if (window.matchMedia("(pointer: coarse)").matches) return;
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const group = target?.closest(".pdf-page") as HTMLElement | null;
      if (group === null) {
        void placeField(kind, def[2], def[3], null);
        return;
      }
      const rect = group.getBoundingClientRect();
      const page = Number(group.id.replace("page-", ""));
      const x = (event.clientX - rect.left) / rect.width - def[2] / 2;
      const y = (event.clientY - rect.top) / rect.height - def[3] / 2;
      void placeField(kind, def[2], def[3], { x, y, page });
    });
  }

  pagesColumn.addEventListener("pointerup", (event) => {
    if (state.armedKind === null) return;
    const group = (event.target as Element).closest(".pdf-page") as HTMLElement | null;
    if (group === null) return;
    const def = kindDefs.find((k) => k[0] === state.armedKind)!;
    const rect = group.getBoundingClientRect();
    const page = Number(group.id.replace("page-", ""));
    const x = (event.clientX - rect.left) / rect.width - def[2] / 2;
    const y = (event.clientY - rect.top) / rect.height - def[3] / 2;
    state.armedKind = null;
    for (const b of fieldsToolbar.querySelectorAll("button")) b.removeAttribute("aria-pressed");
    void placeField(def[0], def[2], def[3], { x, y, page });
  });

  /* ---------- routing column ---------- */

  function renderStatic(): void {
    statusLine.textContent = statusWordOf(state.doc);
    const recipients = state.doc.recipients;
    const current = state.doc.currentOrder === null ? null : recipients.find((r) => r.order === state.doc.currentOrder) ?? null;
    let nextStep = "None";
    if (state.doc.status === "draft") nextStep = "Add signers and fields";
    else if (state.doc.status === "in_progress" && current !== null) {
      if (current.status === "expired") nextStep = `Link expired for ${current.name}`;
      else if (current.status === "invited" && current.delivery === "held") nextStep = `Invitation not delivered yet to ${current.name}`;
      else nextStep = `Waiting for ${current.name} (${current.order} of ${recipients.length})`;
    } else if (state.doc.status === "sealing") nextStep = "Sealing the completed PDF";
    nextStepLine.textContent = nextStep;

    // Outcome banner
    if (state.doc.status === "declined") {
      outcomeBanner.hidden = false;
      outcomeBanner.className = "banner seal";
      const decliner = state.doc.recipients.find((r) => r.status === "declined");
      outcomeBanner.textContent = `${decliner?.name ?? "A signer"} declined: ${decliner?.declineReason ?? ""}`;
    } else if (state.doc.status === "voided") {
      outcomeBanner.hidden = false;
      outcomeBanner.className = "banner seal";
      outcomeBanner.textContent = `Voided: ${state.doc.title}`;
    } else {
      outcomeBanner.hidden = true;
    }

    // Completed hash banner
    if (state.doc.status === "completed" && state.doc.completedSha256 !== null) {
      hashBanner.hidden = false;
      clear(hashBanner);
      const download = el("a", { href: `/api/documents/${documentId}/completed.pdf`, text: "Download completed PDF" });
      hashBanner.append(
        el("div", {}, el("strong", { text: "Completed PDF SHA-256" })),
        el("div", { class: "hash-line", text: state.doc.completedSha256 }),
        download,
      );
    } else {
      hashBanner.hidden = true;
    }

    renderRouting();
    if (canEdit()) renderFieldsToolbarState();
  }

  function renderFieldsToolbarState(): void {
    const hasSigners = state.doc.recipients.length > 0;
    for (const btn of fieldsToolbar.querySelectorAll("button")) {
      (btn as HTMLButtonElement).disabled = !hasSigners;
    }
  }

  function renderRouting(): void {

    clear(routingColumn);
    clear(sheet);
    renderRoutingInto(routingColumn);
    renderRoutingInto(sheet);
    if (!window.matchMedia("(max-width: 768px)").matches) sheetButton.remove();
  }

  function renderRoutingInto(container: HTMLElement): void {
    const orderList = el("ul", { class: "signing-order", "aria-label": "Signing order", role: "list" });
    for (const r of state.doc.recipients) {
      const rowWord = recipientRowWord(r);
      const li = el("li", { role: "listitem", class: r.status === "signed" ? "signed" : "" });
      li.append(el("span", { class: "num", "aria-hidden": "true", text: String(r.order) }));
      const main = el("span", { class: "row-main" });
      main.append(el("span", { text: `${r.order}. ${r.name}` }));
      main.append(el("span", { class: "row-word", text: ` ${rowWord}` }));
      if (state.doc.status === "declined" || state.doc.status === "voided") {
        if (r.status === "signed") main.append(el("span", { class: "not-binding", text: " Not binding" }));
      }
      li.append(main);
      if (canEdit()) {
        const actions = el("span", { class: "row-actions" });
        const up = el("button", { type: "button", text: `Move ${r.name} up`, "aria-label": `Move ${r.name} up` });
        const down = el("button", { type: "button", text: `Move ${r.name} down`, "aria-label": `Move ${r.name} down` });
        const remove = el("button", { type: "button", text: `Remove ${r.name}`, "aria-label": `Remove ${r.name}` });
        up.disabled = r.order === 1;
        down.disabled = r.order === state.doc.recipients.length;
        up.addEventListener("click", async () => {
          await api.post(`/api/documents/${documentId}/recipients/${r.id}/move`, { direction: "up" });
          await refreshDoc();
          announce("order-updates", `${r.name} is now signer ${Math.max(1, r.order - 1)} of ${state.doc.recipients.length}`);
          const moved = container.querySelectorAll(".row-actions")[Math.max(0, r.order - 2)];
          (moved?.querySelector(`button[aria-label="Move ${r.name} up"]`) as HTMLElement | undefined)?.focus();
        });
        down.addEventListener("click", async () => {
          await api.post(`/api/documents/${documentId}/recipients/${r.id}/move`, { direction: "down" });
          await refreshDoc();
          announce("order-updates", `${r.name} is now signer ${Math.min(state.doc.recipients.length, r.order + 1)} of ${state.doc.recipients.length}`);
          const moved = container.querySelectorAll(".row-actions")[Math.min(state.doc.recipients.length - 1, r.order)];
          (moved?.querySelector(`button[aria-label="Move ${r.name} down"]`) as HTMLElement | undefined)?.focus();
        });
        remove.addEventListener("click", async () => {
          await api.del(`/api/documents/${documentId}/recipients/${r.id}`);
          await refreshDoc();
        });
        actions.append(up, down, remove);
        li.append(actions);
      }
      if (state.doc.status === "in_progress" && state.doc.currentOrder === r.order && effExpired(r)) {
        const newLink = el("button", { type: "button", text: "Send a new link" });
        newLink.addEventListener("click", async () => {
          newLink.disabled = true;
          announce("order-updates", "Issuing a new link...");
          await api.post(`/api/documents/${documentId}/recipients/${r.id}/new-link`);
          announce("order-updates", `New link issued for ${r.name}.`);
          await refreshDoc();
        });
        li.append(newLink);
      }
      orderList.append(li);
    }
    container.append(orderList);

    if (canEdit()) {
      const nameInput = el("input", { type: "text", "aria-label": "Name", id: "signer-name" });
      const emailInput = el("input", { type: "email", "aria-label": "Email", id: "signer-email" });
      const addBtn = el("button", { class: "btn", type: "button", text: "Add signer" });
      const errorBox = el("div", { class: "alert", role: "alert", hidden: true });
      const addForm = el("div", { class: "add-signer" },
        el("label", { for: "signer-name", text: "Name" }), nameInput,
        el("label", { for: "signer-email", text: "Email" }), emailInput,
        errorBox, addBtn,
      );
      const addSigner = async (): Promise<void> => {
        try {
          await api.post(`/api/documents/${documentId}/recipients`, {
            name: nameInput.value, email: emailInput.value,
          });
          nameInput.value = "";
          emailInput.value = "";
          errorBox.hidden = true;
          await refreshDoc();
        } catch (e) {
          const fields = (e as { body?: { fields?: Record<string, string> } }).body?.fields ?? {};
          errorBox.hidden = false;
          errorBox.textContent = fields.name ?? fields.email ?? fields.recipients ?? "Something went wrong. Try again.";
        }
        nameInput.focus();
      };
      addBtn.addEventListener("click", () => void addSigner());
      emailInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); void addSigner(); }
      });
      container.append(addForm);

      const tzCombo = el("select", { "aria-label": "Time zone", id: "tz-combo" });
      for (const tz of commonZones) {
        const opt = el("option", { value: tz, text: tz });
        if (tz === state.doc.timeZone) opt.selected = true;
        tzCombo.append(opt);
      }
      tzCombo.addEventListener("change", async () => {
        await api.patch(`/api/documents/${documentId}`, { timeZone: tzCombo.value });
        await refreshDoc();
      });
      container.append(el("label", { for: "tz-combo", text: "Time zone" }), tzCombo);
    }

    // Send, reminder, void controls
    if (canEdit() && state.doc.status === "draft") {
      const sendBtn = el("button", { class: "btn primary", type: "button", text: "Send for signing" });
      sendBtn.addEventListener("click", () => openSendDialog(sendBtn));
      container.append(sendBtn);
      if (info.role === "owner") {
        const tplBtn = el("button", { class: "btn", type: "button", text: "Save as template" });
        tplBtn.addEventListener("click", async () => {
          await api.post(`/api/documents/${documentId}/template`);
          announce("order-updates", "Template saved.");
        });
        container.append(tplBtn);
      }
    }
    if (state.doc.status === "in_progress") {
      const canVoid = info.role === "owner" || state.doc.ownerId === info.user.id;
      const current = state.doc.recipients.find((r) => r.order === state.doc.currentOrder);
      if (current !== undefined && (current.status === "invited" || current.status === "viewed")) {
        const remindBtn = el("button", { class: "btn", type: "button", text: "Send reminder" });
        remindBtn.addEventListener("click", async () => {
          remindBtn.disabled = true;
          announce("order-updates", "Sending reminder...");
          try {
            const res = await api.post<{ reminderAvailableAt: string }>(`/api/documents/${documentId}/remind`);
            announce("order-updates", `Reminder sent to ${current.name}.`);
            startCooldown(remindBtn, res.reminderAvailableAt, current.name);
          } catch (e) {
            const body = (e as { body?: { error?: string; availableAt?: string } }).body;
            if (body?.error === "reminder_cooldown" && body.availableAt !== undefined) {
              startCooldown(remindBtn, body.availableAt, current.name);
            } else if (body?.error === "mail_unavailable") {
              announce("order-updates", "Email is unavailable. Try the reminder again later.");
            } else {
              announce("order-updates", "Something went wrong. Try again.");
            }
            remindBtn.disabled = false;
          }
        });
        if (state.doc.reminderAvailableAt !== null) startCooldown(remindBtn, state.doc.reminderAvailableAt, current.name);
        container.append(remindBtn);
      }
      if (canVoid) {
        const voidBtn = el("button", { class: "btn danger", type: "button", text: "Void document" });
        voidBtn.addEventListener("click", () => openVoidDialog(voidBtn));
        container.append(voidBtn);
      }
    }

    const auditLink = el("a", { href: `/documents/${documentId}/audit`, text: "Audit trail" });
    container.append(auditLink);
  }

  function effExpired(r: RecipientDto): boolean {
    return r.status === "expired" || (r.linkExpiresAt !== null && new Date(r.linkExpiresAt).getTime() <= Date.now());
  }

  function startCooldown(btn: HTMLButtonElement, availableAtIso: string, name: string): void {
    const availableAt = new Date(availableAtIso).getTime();
    const update = (): void => {
      const remaining = availableAt - Date.now();
      if (remaining <= 0) {
        btn.disabled = false;
        btn.textContent = "Send reminder";
        return;
      }
      btn.disabled = true;
      const d = new Date(availableAt);
      const date = new Intl.DateTimeFormat("en-GB", { timeZone: state.doc.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      const time = new Intl.DateTimeFormat("en-GB", { timeZone: state.doc.timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
      const text = `Next reminder after ${date} ${time} ${state.doc.timeZone}`;
      btn.textContent = text;
      announce("order-updates", `${text}. Reminder sent to ${name}.`);
      window.setTimeout(update, 1000);
    };
    update();
  }

  function openSendDialog(openedBy: HTMLElement): void {
    const errorBox = el("div", { class: "alert", role: "alert", hidden: true });
    const list = el("ul", {});
    for (const r of state.doc.recipients) {
      list.append(el("li", { text: `${r.order}. ${r.name} (${r.email})` }));
    }
    const sendBtn = el("button", { class: "btn primary", type: "button", text: "Send" });
    const cancelBtn = el("button", { class: "btn", type: "button", text: "Cancel" });
    const dialog = el("div", { class: "dialog-backdrop" },
      el("div", { class: "dialog", role: "dialog", "aria-label": "Send for signing" },
        el("h2", { text: "Send for signing" }),
        list, errorBox,
        el("div", { class: "actions" }, cancelBtn, sendBtn),
      ),
    );
    document.body.append(dialog);
    sendBtn.focus();

    const close = (): void => { dialog.remove(); openedBy.focus(); };
    cancelBtn.addEventListener("click", close);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") trapTab(event, dialog);
    });
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) close();
    });

    sendBtn.addEventListener("click", async () => {
      sendBtn.disabled = true;
      announce("order-updates", "Sending...");
      try {
        await api.post(`/api/documents/${documentId}/send`);
        dialog.remove();
        announce("order-updates", `Sent for signing. ${state.doc.recipients[0]?.name ?? ""} has the first turn.`);
        heading.focus();
      } catch (e) {
        const body = (e as { body?: { error?: string; recipients?: string[] } }).body;
        if (body?.error === "missing_signature_fields") {
          errorBox.hidden = false;
          errorBox.textContent = `Every signer needs a signature field. Missing: ${(body.recipients ?? []).join(", ")}`;
        } else if (body?.error === "no_recipients") {
          errorBox.hidden = false;
          errorBox.textContent = "Every signer needs a signature field. Missing: ";
        } else {
          errorBox.hidden = false;
          errorBox.textContent = "Something went wrong. Try again.";
        }
        sendBtn.disabled = false;
      }
    });
  }

  function openVoidDialog(openedBy: HTMLElement): void {
    const reason = el("input", { type: "text", "aria-label": "Reason", id: "void-reason" });
    const errorBox = el("div", { class: "alert", role: "alert", hidden: true });
    const counter = el("div", { class: "counter", text: "0 of 500 characters" });
    reason.addEventListener("input", () => {
      if (cpLength(reason.value) > 500) reason.value = truncateToCodePoints(reason.value, 500);
      counter.textContent = `${cpLength(reason.value)} of 500 characters`;
    });
    const voidBtn = el("button", { class: "btn danger", type: "button", text: "Void" });
    const cancelBtn = el("button", { class: "btn", type: "button", text: "Cancel" });
    const dialog = el("div", { class: "dialog-backdrop" },
      el("div", { class: "dialog", role: "dialog", "aria-label": "Void document" },
        el("h2", { text: "Void document" }),
        el("label", { for: "void-reason", text: "Reason" }),
        reason, counter, errorBox,
        el("div", { class: "actions" }, cancelBtn, voidBtn),
      ),
    );
    document.body.append(dialog);
    reason.focus();
    const close = (): void => { dialog.remove(); openedBy.focus(); };
    cancelBtn.addEventListener("click", close);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") trapTab(event, dialog);
    });
    voidBtn.addEventListener("click", async () => {
      if (cpLength(reason.value.trim()) < 1) {
        errorBox.hidden = false;
        errorBox.textContent = "Enter a reason for voiding.";
        reason.focus();
        return;
      }
      voidBtn.disabled = true;
      announce("order-updates", "Voiding...");
      try {
        await api.post(`/api/documents/${documentId}/void`, { reason: reason.value });
        dialog.remove();
        await refreshDoc();
        openedBy.focus();
      } catch {
        errorBox.hidden = false;
        errorBox.textContent = "Something went wrong. Try again.";
        voidBtn.disabled = false;
      }
    });
  }

  function renderServiceNotice(mailOk: boolean, storageOk: boolean): void {
    if (!storageOk) {
      announce("service-notice", "File storage is unavailable. New uploads are paused and completed PDFs are sealed when it recovers.");
    } else if (!mailOk) {
      announce("service-notice", "Email is unavailable. Invitations are held and sent when email recovers.");
    } else {
      announce("service-notice", "");
    }
  }

  renderStatic();
  await loadPdf();
}

function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  const focusables = Array.from(container.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href]"))
    .filter((node) => !node.hasAttribute("disabled") && node.offsetParent !== null);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const commonZones = [
  "UTC", "Europe/London", "Europe/Paris", "Europe/Berlin", "America/New_York", "America/Chicago",
  "America/Denver", "America/Los_Angeles", "Asia/Tokyo", "Asia/Singapore", "Australia/Sydney",
  "Pacific/Auckland", "Africa/Cairo", "America/Sao_Paulo", "Asia/Kolkata",
];
