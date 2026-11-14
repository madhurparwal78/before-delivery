import { formatSize } from "../../shared/formats.js";
import { M } from "../../shared/messages.js";
import type { AnswerValue, Answers, ErrorItem, EvalPage, EvalQuestion, Evaluation, FileAnswer, FileKind } from "../../shared/types.js";
import { alertText, announce, clear, field, h, openDialog, restartAnimation, setTitle, uid, type Dialog } from "../dom.js";
import { api, randomKey, type ApiResult } from "../api.js";
import { messagePage, notFoundPage, page as pageFrame } from "../layout.js";
import { connectLive } from "../live.js";
import { gridWidget, openDatePicker, rankingWidget, scaleWidget, type GridWidget, type RankingWidget, type ScaleWidget } from "./widgets.js";

interface ResponseView {
  id: string;
  edition: number;
  page: string;
  answers: Answers;
  evaluation: Evaluation;
  title: string;
  today: string;
  notice?: string | null;
}

interface ClosedView {
  heading: string;
  text: string;
}

const MIME: Record<FileKind, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };

export async function fillForm(slug: string): Promise<void> {
  const main = pageFrame();
  main.setAttribute("aria-busy", "true");
  const info = await api<{ title: string; closed: ClosedView | null }>("GET", `/api/f/${encodeURIComponent(slug)}`);
  if (!info.ok) {
    notFoundPage();
    return;
  }
  if (info.data.closed) {
    showClosedPage(main, info.data.title, info.data.closed);
    return;
  }
  const created = await api<ResponseView>("POST", `/api/f/${encodeURIComponent(slug)}/responses`, {});
  if (!created.ok) {
    if (created.error?.code === "FORM_CLOSED") showClosedPage(main, info.data.title, { heading: M.closedHeading, text: created.error.message });
    else notFoundPage();
    return;
  }
  new Respondent(main, created.data).start();
}

export async function resumeForm(token: string): Promise<void> {
  const main = pageFrame();
  main.setAttribute("aria-busy", "true");
  const result = await api<ResponseView>("POST", `/api/resume/${encodeURIComponent(token)}`, {});
  if (result.ok) {
    new Respondent(main, result.data).start();
    return;
  }
  switch (result.error?.code) {
    case "LINK_EXPIRED":
      messagePage(M.linkExpired);
      return;
    case "ALREADY_SENT":
      messagePage(M.alreadySent);
      return;
    case "FORM_CLOSED":
      showClosedPage(main, "", { heading: M.closedHeading, text: result.error.message });
      return;
    default:
      notFoundPage();
  }
}

function showClosedPage(main: HTMLElement, title: string, closed: ClosedView): void {
  main.removeAttribute("aria-busy");
  const pageEl = h("div", { id: "page" });
  main.replaceChildren(pageEl);
  renderClosed(pageEl, title, closed, false);
}

function renderClosed(pageEl: HTMLElement, title: string, closed: ClosedView, wasOpen: boolean): void {
  const heading = h("h1", { tabindex: "-1" }, M.closedHeading);
  clear(
    pageEl,
    h("div", { id: "closed-panel" }, heading, h("p", {}, closed.text), wasOpen ? h("p", { class: "error-text" }, M.notSent) : null),
  );
  setTitle(title ? `${M.closedHeading} - ${title}` : M.closedHeading);
  heading.focus();
  if (wasOpen) alertText(M.notSent);
}

type Control =
  | { kind: "input"; el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement }
  | { kind: "options"; group: HTMLElement; inputs: HTMLInputElement[] }
  | { kind: "grid"; widget: GridWidget }
  | { kind: "ranking"; widget: RankingWidget }
  | { kind: "scale"; widget: ScaleWidget }
  | { kind: "file"; group: HTMLElement; choose: HTMLButtonElement }
  | { kind: "calc" };

interface Block {
  el: HTMLElement;
  label: HTMLElement;
  help: HTMLElement | null;
  control: Control;
  question: EvalQuestion;
}

class Respondent {
  private answers: Answers;
  private evaluation: Evaluation;
  private current: string;
  private seq = 0;
  private applied = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly idempotencyKey = randomKey();
  private submitting = false;
  private moved = false;
  private ended = false;
  private notice: string | null;
  private pathNotice: string | null = null;
  private errors: ErrorItem[] = [];
  private readonly blocks = new Map<string, Block>();
  private readonly pageEl = h("div", { id: "page" });
  private questionsEl = h("div", { class: "questions" });
  private titleEl = h("h1", { id: "page-title", tabindex: "-1" });
  private countEl = h("p", { id: "page-count", class: "figures muted" });
  private navEl = h("div", { class: "page-nav" });
  private saveButton = h("button", { type: "button", class: "quiet" }, "Save and finish later");

  constructor(
    private readonly main: HTMLElement,
    private readonly view: ResponseView,
  ) {
    this.answers = { ...view.answers };
    this.evaluation = view.evaluation;
    this.current = view.page;
    this.notice = view.notice ?? null;
  }

  start(): void {
    this.main.removeAttribute("aria-busy");
    this.main.replaceChildren(this.pageEl);
    this.saveButton.addEventListener("click", () => this.saveDialog());
    this.renderPage("title");
    connectLive({ response: this.view.id }, (message) => {
      if (message.type === "moved") this.lose();
      if (message.type === "form_state" && message.state === "closed" && !this.ended)
        this.close((message.closed as ClosedView | null) ?? { heading: M.closedHeading, text: M.closedByHand });
    });
  }

  /* ---------- Rendering ---------- */

  private evalPage(): EvalPage {
    return this.evaluation.pages.find((p) => p.key === this.current) ?? this.evaluation.pages[0];
  }

  private litPages(): EvalPage[] {
    return this.evaluation.pages.filter((p) => p.state === "lit");
  }

  private renderPage(focus: "title" | "none"): void {
    const evalPage = this.evalPage();
    this.blocks.clear();
    this.titleEl = h("h1", { id: "page-title", tabindex: "-1" }, evalPage.title);
    this.countEl = h("p", { id: "page-count", class: "figures muted" });
    this.questionsEl = h("div", { class: "questions" });
    this.navEl = h("div", { class: "page-nav" });
    for (const q of evalPage.questions) if (q.state === "lit") this.questionsEl.append(this.buildBlock(q).el);
    clear(
      this.pageEl,
      h("p", { class: "form-title" }, this.view.title),
      this.notice ? h("p", { id: "notice", class: "notice" }, this.notice) : null,
      this.errors.length ? this.errorSummary() : null,
      this.titleEl,
      this.countEl,
      this.pathNotice ? h("p", { id: "path-notice", class: "notice" }, this.pathNotice) : null,
      this.questionsEl,
      this.navEl,
    );
    this.updateChrome();
    this.markErrors();
    restartAnimation(this.pageEl, "page-fade");
    if (focus === "title") this.titleEl.focus();
  }

  /** Page count, buttons and document title for the current answers. */
  private updateChrome(): void {
    const lit = this.litPages();
    const index = lit.findIndex((p) => p.key === this.current);
    this.titleEl.textContent = this.evalPage().title;
    this.countEl.textContent = M.pageCount(index + 1, lit.length);
    const last = index === lit.length - 1;
    const wanted = [index > 0 ? "Back" : null, last ? "Submit" : "Next"].filter(Boolean).join("|");
    if (this.navEl.dataset.buttons !== wanted) {
      this.navEl.dataset.buttons = wanted;
      const buttons: HTMLElement[] = [];
      if (index > 0) buttons.push(h("button", { type: "button", onclick: () => this.go("back") }, "Back"));
      buttons.push(
        last
          ? h("button", { type: "button", class: "primary", onclick: () => this.submit() }, "Submit")
          : h("button", { type: "button", class: "primary", onclick: () => this.go("next") }, "Next"),
      );
      clear(this.navEl, buttons, this.saveButton);
    }
    setTitle(`${this.errors.length ? M.errorTitlePrefix : ""}${this.evalPage().title} - ${this.view.title}`);
  }

  private labelFor(q: EvalQuestion, labelId: string, inputId: string | null): HTMLElement {
    return inputId ? h("label", { id: labelId, for: inputId, class: "q-label" }, q.label) : h("p", { id: labelId, class: "q-label" }, q.label);
  }

  private buildBlock(q: EvalQuestion): Block {
    const field = q.field;
    const key = q.key;
    const labelId = `label-${key}`;
    const helpId = `help-${key}`;
    const help = q.help ? h("p", { id: helpId, class: "help" }, q.help) : null;
    const inputId = `field-${key}`;
    const value = this.answers[key];
    let control: Control;
    let body: HTMLElement;
    let label: HTMLElement;
    const describedBy = q.help ? helpId : null;
    switch (field?.type) {
      case "short_text":
      case "number":
      case "long_text":
      case "date": {
        const multiline = field.type === "long_text";
        const el = multiline
          ? h("textarea", { id: inputId, rows: 4, "aria-describedby": describedBy })
          : h("input", {
              id: inputId,
              type: "text",
              inputmode: field.type === "number" ? "decimal" : null,
              placeholder: field.type === "date" ? "YYYY-MM-DD" : null,
              autocomplete: "off",
              "aria-describedby": describedBy,
            });
        el.value = typeof value === "string" ? value : "";
        el.addEventListener("blur", () => this.commitText(key, el));
        if (!multiline)
          el.addEventListener("keydown", (event) => {
            if ((event as KeyboardEvent).key !== "Enter") return;
            event.preventDefault();
            this.commitText(key, el);
            if (this.isLastPage()) this.submit();
            else this.go("next");
          });
        label = this.labelFor(q, labelId, inputId);
        const parts: HTMLElement[] = [el];
        if (field.type === "date") {
          const button = h("button", { type: "button", class: "date-button", "aria-label": `Choose date for ${q.label}` }, "Choose date");
          button.addEventListener("click", () => {
            const typed = /^\d{4}-\d{2}-\d{2}$/.test(el.value.trim()) ? el.value.trim() : null;
            openDatePicker(button, typed, { min: field.min ?? null, max: field.max ?? null, today: this.view.today }, (day) => {
              el.value = day;
              this.commitText(key, el);
            });
          });
          parts.push(button);
        }
        body = h("div", { class: "control-row" }, parts);
        control = { kind: "input", el };
        break;
      }
      case "dropdown": {
        const el = h(
          "select",
          { id: inputId, "aria-describedby": describedBy },
          h("option", { value: "" }, "Choose an option"),
          (field.options ?? []).map((o) => h("option", { value: o.value }, o.label)),
        );
        el.value = typeof value === "string" ? value : "";
        el.addEventListener("change", () => this.commit({ [key]: el.value === "" ? null : el.value }));
        label = this.labelFor(q, labelId, inputId);
        body = el;
        control = { kind: "input", el };
        break;
      }
      case "choice":
      case "checkbox": {
        const multiple = field.type === "checkbox";
        const inputs = (field.options ?? []).map((o, i) => {
          const input = h("input", { type: multiple ? "checkbox" : "radio", name: key, value: o.value, id: `${inputId}-${i}` });
          input.checked = multiple ? Array.isArray(value) && value.includes(o.value) : value === o.value;
          return input;
        });
        const read = (): AnswerValue | null => {
          if (!multiple) return inputs.find((i) => i.checked)?.value ?? null;
          const ticked = inputs.filter((i) => i.checked).map((i) => i.value);
          return ticked.length ? ticked : null;
        };
        for (const input of inputs) input.addEventListener("change", () => this.commit({ [key]: read() }));
        const options = inputs.map((input, i) => h("div", { class: "choice-option" }, input, h("label", { for: input.id }, (field.options ?? [])[i].label)));
        if (multiple) {
          label = h("legend", { id: labelId, class: "q-label" }, q.label);
          body = h("fieldset", { class: "options", "aria-describedby": describedBy }, label, options);
        } else {
          label = this.labelFor(q, labelId, null);
          body = h("div", { role: "radiogroup", "aria-labelledby": labelId, "aria-describedby": describedBy, class: "options" }, options);
        }
        control = { kind: "options", group: body, inputs };
        break;
      }
      case "grid": {
        label = this.labelFor(q, labelId, null);
        const widget = gridWidget(
          key,
          labelId,
          field.rows ?? [],
          field.columns ?? [],
          value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, string>) : {},
          (next) => this.commit({ [key]: next }),
        );
        body = h("div", { class: "grid-holder" }, widget.el, widget.cards);
        control = { kind: "grid", widget };
        break;
      }
      case "ranking": {
        label = this.labelFor(q, labelId, null);
        const widget = rankingWidget(labelId, field.options ?? [], Array.isArray(value) ? value : null, (order) => this.commit({ [key]: order }));
        body = widget.el;
        control = { kind: "ranking", widget };
        break;
      }
      case "scale": {
        label = this.labelFor(q, labelId, null);
        const widget = scaleWidget(labelId, Number(field.min), Number(field.max), field.min_label ?? null, field.max_label ?? null, typeof value === "string" ? value : null, (v) =>
          this.commit({ [key]: v }),
        );
        body = widget.el;
        control = { kind: "scale", widget };
        break;
      }
      case "file": {
        label = h("legend", { id: labelId, class: "q-label" }, q.label);
        const built = this.fileControl(key, field.accept ?? ["pdf", "png", "jpeg"], value as FileAnswer | undefined);
        body = h("fieldset", { class: "file-field", "aria-describedby": describedBy }, label, built.parts);
        control = { kind: "file", group: body, choose: built.choose };
        break;
      }
      default: {
        label = h("p", { id: labelId, class: "q-label" }, q.label);
        const output = h("output", { id: `calc-${key}`, "aria-live": "off", "aria-labelledby": labelId, class: "figures calc" });
        output.textContent = this.evaluation.values[key]?.text ?? M.notCalculated;
        body = output;
        control = { kind: "calc" };
      }
    }
    const inFieldset = field?.type === "checkbox" || field?.type === "file";
    const el = h("div", { class: "question", "data-key": key }, inFieldset ? null : label, help && !inFieldset ? help : null, body);
    if (help && inFieldset) body.insertBefore(help, label.nextSibling);
    const block: Block = { el, label, help, control, question: q };
    this.blocks.set(key, block);
    return block;
  }

  private fileControl(key: string, accept: FileKind[], value: FileAnswer | undefined): { parts: HTMLElement[]; choose: HTMLButtonElement } {
    const status = h("p", { id: `upload-${key}`, class: "upload-status" });
    const picker = h("input", { type: "file", accept: accept.map((k) => MIME[k]).join(","), class: "file-input", tabindex: "-1", "aria-hidden": "true" });
    const choose = h("button", { type: "button" }, "Choose file");
    const removeHolder = h("span", {});
    const showAttached = (file: FileAnswer | null): void => {
      status.textContent = file ? M.attached(file.name, formatSize(file.size)) : "";
      clear(removeHolder);
      if (!file) return;
      const remove = h("button", { type: "button", class: "quiet" }, `Remove ${file.name}`);
      remove.addEventListener("click", () => {
        void this.enqueue(async () => {
          const result = await api("DELETE", `/api/responses/${this.view.id}/files/${encodeURIComponent(key)}`);
          if (!result.ok) return this.handleStateError(result);
          delete this.answers[key];
          showAttached(null);
          choose.focus();
        });
      });
      removeHolder.append(remove);
    };
    showAttached(value ?? null);
    choose.addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      picker.value = "";
      if (!file) return;
      status.textContent = M.uploading(file.name);
      status.setAttribute("aria-busy", "true");
      void this.enqueue(async () => {
        const result = await api<FileAnswer>("PUT", `/api/responses/${this.view.id}/files/${encodeURIComponent(key)}`, file, {
          "Content-Type": file.type || "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        });
        status.removeAttribute("aria-busy");
        if (result.ok) {
          const answer = { name: result.data.name, size: result.data.size, type: result.data.type };
          this.answers[key] = answer;
          showAttached(answer);
          return;
        }
        if (result.status === 409 || result.status === 404) {
          this.handleStateError(result);
          return;
        }
        const message = result.error?.message ?? M.uploadFailed(file.name);
        delete this.answers[key];
        clear(removeHolder);
        status.textContent = message;
        alertText(message);
      });
    });
    return { parts: [choose, picker, status, removeHolder], choose };
  }

  /* ---------- Commits ---------- */

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work, work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private commitText(key: string, el: HTMLInputElement | HTMLTextAreaElement): void {
    const stored = this.answers[key];
    const current = typeof stored === "string" ? stored : "";
    if (el.value === current) return;
    this.commit({ [key]: el.value === "" ? null : el.value });
  }

  private commit(changes: Record<string, AnswerValue | null>): void {
    if (this.moved || this.ended) return;
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) delete this.answers[key];
      else this.answers[key] = value;
    }
    this.seq += 1;
    const seq = this.seq;
    const pageKey = this.current;
    void this.enqueue(async () => {
      const result = await api<{ evaluation: Evaluation }>("POST", `/api/responses/${this.view.id}/answers`, { seq, page: pageKey, answers: changes });
      if (!result.ok) {
        if (result.error?.code === "ANSWER_INVALID") alertText(result.error.message);
        else this.handleStateError(result);
        return;
      }
      if (result.data.evaluation.seq < this.applied) return;
      this.applied = result.data.evaluation.seq;
      this.applyEvaluation(result.data.evaluation);
    });
  }

  private applyEvaluation(evaluation: Evaluation): void {
    this.evaluation = evaluation;
    if (evaluation.hidden_now > 0) this.pathNotice = M.hiddenNotice(evaluation.hidden_now);
    else if (evaluation.restored > 0) this.pathNotice = M.restoredNotice(evaluation.restored);
    const evalPage = this.evalPage();
    let previous: HTMLElement | null = null;
    for (const q of evalPage.questions) {
      const block = this.blocks.get(q.key);
      if (q.state !== "lit") {
        block?.el.remove();
        this.blocks.delete(q.key);
        continue;
      }
      if (!block) {
        const created = this.buildBlock(q);
        if (previous) previous.after(created.el);
        else this.questionsEl.prepend(created.el);
        previous = created.el;
        continue;
      }
      if (block.label.textContent !== q.label) block.label.textContent = q.label;
      if (block.help && block.help.textContent !== (q.help ?? "")) block.help.textContent = q.help ?? "";
      if (block.control.kind === "calc") {
        const output = block.el.querySelector("output") as HTMLOutputElement;
        output.textContent = evaluation.values[q.key]?.text ?? M.notCalculated;
      }
      if (q.field?.type === "date") block.el.querySelector(".date-button")?.setAttribute("aria-label", `Choose date for ${q.label}`);
      block.question = q;
      previous = block.el;
    }
    this.syncPathNotice();
    this.updateChrome();
    announce(evaluation.announce);
  }

  private syncPathNotice(): void {
    let el = this.pageEl.querySelector<HTMLElement>("#path-notice");
    if (!this.pathNotice) return;
    if (!el) {
      el = h("p", { id: "path-notice", class: "notice" });
      this.countEl.after(el);
    }
    el.textContent = this.pathNotice;
  }

  private isLastPage(): boolean {
    const lit = this.litPages();
    return lit[lit.length - 1]?.key === this.current;
  }

  /** Commits whatever the focused box holds before a page action. */
  private flushFocused(): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
    const key = [...this.blocks].find(([, b]) => b.control.kind === "input" && b.control.el === active)?.[0];
    if (key) this.commitText(key, active);
  }

  /* ---------- Page moves ---------- */

  private go(direction: "next" | "back"): void {
    if (this.moved || this.ended) return;
    this.flushFocused();
    const pageKey = this.current;
    void this.enqueue(async () => {
      const result = await api<{ page: string; evaluation: Evaluation }>("POST", `/api/responses/${this.view.id}/${direction}`, { page: pageKey });
      if (!result.ok) {
        if (result.error?.code === "ANSWERS_INVALID") this.showErrors(result.error.items ?? [], result.error.message);
        else this.handleStateError(result);
        return;
      }
      this.changePage(result.data.page, result.data.evaluation);
    });
  }

  private changePage(pageKey: string, evaluation: Evaluation): void {
    this.current = pageKey;
    this.evaluation = evaluation;
    this.applied = Math.max(this.applied, this.seq);
    this.errors = [];
    this.pathNotice = null;
    this.notice = null;
    this.renderPage("title");
    announce(evaluation.announce);
  }

  private submit(): void {
    if (this.moved || this.ended || this.submitting) return;
    this.flushFocused();
    this.submitting = true;
    const button = this.navEl.querySelector<HTMLElement>("button.primary");
    button?.setAttribute("aria-busy", "true");
    const pageKey = this.current;
    void this.enqueue(async () => {
      const result = await api<{ reference: string; copy: string }>(
        "POST",
        `/api/responses/${this.view.id}/submit`,
        { page: pageKey },
        { "Idempotency-Key": this.idempotencyKey },
      );
      this.submitting = false;
      button?.removeAttribute("aria-busy");
      if (result.ok) {
        this.confirm(result.data.reference, result.data.copy === "queued");
        return;
      }
      if (result.error?.code === "ANSWERS_INVALID") {
        const items = result.error.items ?? [];
        const target = items[0]?.page;
        if (target && target !== this.current) {
          this.current = target;
          this.errors = items;
          this.renderPage("none");
        }
        this.showErrors(items, result.error.message);
        return;
      }
      this.handleStateError(result);
    });
  }

  private confirm(reference: string, queued: boolean): void {
    this.ended = true;
    const heading = h("h1", { tabindex: "-1" }, M.thankYou);
    clear(this.pageEl, h("div", { class: "confirmation" }, heading, h("p", { class: "figures" }, M.reference(reference)), queued ? h("p", {}, M.emailQueued) : null));
    setTitle(`${M.thankYou} - ${this.view.title}`);
    heading.focus();
  }

  /* ---------- Errors ---------- */

  private errorSummary(): HTMLElement {
    return h(
      "div",
      { id: "error-summary", role: "region", "aria-label": M.summaryHeading, tabindex: "-1", class: "error-summary" },
      h("h2", {}, M.summaryHeading),
      h(
        "ul",
        {},
        this.errors.map((item) => {
          const link = h("a", { href: `#field-${item.key}` }, item.message);
          link.addEventListener("click", (event) => {
            event.preventDefault();
            this.focusField(item.key);
          });
          return h("li", {}, link);
        }),
      ),
    );
  }

  private showErrors(items: ErrorItem[], message: string): void {
    this.errors = items;
    const old = this.pageEl.querySelector("#error-summary");
    const summary = this.errorSummary();
    if (old) old.replaceWith(summary);
    else this.titleEl.before(summary);
    this.markErrors();
    this.updateChrome();
    summary.focus();
    alertText(message);
  }

  /** Inline messages, aria-invalid and aria-describedby for the current errors. */
  private markErrors(): void {
    for (const el of this.pageEl.querySelectorAll(".field-error")) el.remove();
    for (const el of this.pageEl.querySelectorAll("[aria-invalid]")) {
      el.removeAttribute("aria-invalid");
      const described = (el.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id && !id.startsWith("error-"));
      if (described.length) el.setAttribute("aria-describedby", described.join(" "));
      else el.removeAttribute("aria-describedby");
    }
    for (const item of this.errors) {
      const block = this.blocks.get(item.key);
      if (!block) continue;
      const message = h("p", { id: `error-${item.key}`, class: "field-error" }, item.message);
      block.label.after(message);
      for (const target of this.invalidTargets(block)) {
        target.setAttribute("aria-invalid", "true");
        const described = (target.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
        target.setAttribute("aria-describedby", [...described, `error-${item.key}`].join(" "));
      }
    }
  }

  private invalidTargets(block: Block): HTMLElement[] {
    switch (block.control.kind) {
      case "input":
        return [block.control.el];
      case "options":
        return [block.control.group];
      case "grid":
        return block.control.widget.invalidTargets();
      case "ranking":
        return [block.control.widget.el];
      case "scale":
        return [block.control.widget.el.querySelector<HTMLElement>("[role=radiogroup]") as HTMLElement];
      case "file":
        return [block.control.group];
      case "calc":
        return [];
    }
  }

  private focusField(key: string): void {
    const block = this.blocks.get(key);
    if (!block) return;
    let target: HTMLElement | null = null;
    switch (block.control.kind) {
      case "input":
        target = block.control.el;
        break;
      case "options":
        target = block.control.inputs.find((i) => i.checked) ?? block.control.inputs[0] ?? null;
        break;
      case "grid":
        target = block.control.widget.focusTarget();
        break;
      case "ranking":
        target = block.control.widget.first();
        break;
      case "scale":
        target = block.control.widget.focusTarget();
        break;
      case "file":
        target = block.control.choose;
        break;
      case "calc":
        break;
    }
    target?.focus();
    target?.scrollIntoView({ block: "center" });
  }

  /* ---------- Moved and closed ---------- */

  private handleStateError(result: ApiResult<unknown>): void {
    const code = result.error?.code;
    if (code === "DRAFT_MOVED") this.lose();
    else if (code === "FORM_CLOSED") this.close({ heading: M.closedHeading, text: result.error?.message ?? M.closedByHand });
    else if (code === "ALREADY_SUBMITTED" || code === "LINK_EXPIRED") {
      this.ended = true;
      messagePage(code === "LINK_EXPIRED" ? M.linkExpired : M.alreadySent);
    } else alertText(result.error?.message ?? "");
  }

  private lose(): void {
    if (this.moved || this.ended) return;
    this.moved = true;
    for (const el of this.pageEl.querySelectorAll<HTMLElement>("button, input, select, textarea")) el.setAttribute("disabled", "");
    for (const el of this.pageEl.querySelectorAll<HTMLElement>("[tabindex='0'], [role=radio], [role=gridcell]")) {
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("disabled", "");
    }
    alertText(M.draftMoved);
  }

  private close(closed: ClosedView): void {
    if (this.ended) return;
    this.ended = true;
    document.querySelector(".dialog-backdrop")?.remove();
    (document.getElementById("root") as HTMLElement).inert = false;
    renderClosed(this.pageEl, this.view.title, closed, true);
  }

  /* ---------- Save and finish later ---------- */

  private saveDialog(): void {
    const email = h("input", { type: "email", autocomplete: "email" });
    const error = h("p", { class: "field-error", id: uid("err") });
    const status = h("p", { id: "save-status" });
    let dialog: Dialog | null = null;
    const send = (): void => {
      this.flushFocused();
      const pageKey = this.current;
      void this.enqueue(async () => {
        const result = await api<{ message: string }>("POST", `/api/responses/${this.view.id}/save`, { email: email.value, page: pageKey });
        if (result.ok) {
          error.textContent = "";
          email.removeAttribute("aria-invalid");
          status.textContent = result.data.message;
          announce(result.data.message);
          return;
        }
        if (result.error?.code === "VALIDATION_FAILED") {
          error.textContent = result.error.items?.[0]?.message ?? "";
          email.setAttribute("aria-invalid", "true");
          email.setAttribute("aria-describedby", error.id);
          alertText(result.error.message);
          email.focus();
          return;
        }
        if (result.error?.code === "RATE_LIMITED") {
          status.textContent = result.error.message;
          alertText(result.error.message);
          return;
        }
        dialog?.close();
        this.handleStateError(result);
      });
    };
    const form = h(
      "form",
      { novalidate: true, class: "stack" },
      field("Email address", email, error),
      status,
      h("div", { class: "actions" }, h("button", { type: "submit", class: "primary" }, "Send link"), h("button", { type: "button", onclick: () => dialog?.close() }, "Close")),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      send();
    });
    dialog = openDialog({ title: "Save and finish later", opener: this.saveButton }, form);
    email.focus();
  }
}
