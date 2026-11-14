import { applyChange, findQuestion } from "../../shared/changes.js";
import { M } from "../../shared/messages.js";
import type {
  AnswerValue,
  Answers,
  Change,
  Definition,
  Evaluation,
  FormState,
  Option,
  Page,
  PublicUser,
  Question,
  QuestionType,
  Settings,
} from "../../shared/types.js";
import { api, type ApiResult } from "../api.js";
import { alertText, announce, clear, field, h, openDialog, prefersReducedMotion, restartAnimation, setTitle, uid, type Dialog } from "../dom.js";
import { loadingMap, notFoundPage, ownerPage, setFormState } from "../layout.js";
import { connectLive, type LiveMessage } from "../live.js";

interface FormData {
  id: string;
  slug: string;
  title: string;
  role: "owner" | "editor";
  state: FormState;
  edition: number | null;
  rev: number;
  draft: Definition;
  settings: Settings;
}

const TYPE_NAMES: [QuestionType, string][] = [
  ["short_text", "Short text"],
  ["long_text", "Long text"],
  ["number", "Number"],
  ["choice", "Choice"],
  ["checkbox", "Checkbox"],
  ["dropdown", "Dropdown"],
  ["grid", "Grid"],
  ["ranking", "Ranking"],
  ["scale", "Scale"],
  ["date", "Date"],
  ["file", "File upload"],
  ["calculated", "Calculated"],
];
const OPTION_TYPES: QuestionType[] = ["choice", "checkbox", "dropdown", "ranking"];

/** Control names, in lower case, for the same-field notice. */
const FIELD_NAMES: Record<string, string> = {
  label: "question label",
  help: "help text",
  required: "required",
  options: "options",
  rows: "rows",
  columns: "columns",
  min: "minimum",
  max: "maximum",
  pattern: "pattern",
  note: "internal note",
  title: "page title",
  show_rule: "show when",
  jumps: "jump when",
  formula: "formula",
  places: "decimal places",
  prefix: "prefix",
  suffix: "suffix",
  hidden: "hidden from respondents",
  checks: "fails when",
  intro: "intro",
};

const optionsText = (options: Option[] | undefined): string => (options ?? []).map((o) => o.label).join("\n");
const parseOptions = (text: string): Option[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ value: line, label: line }));

export async function builderPage(formId: string): Promise<void> {
  const { main, stateBadge } = ownerPage(formId, "edit");
  main.append(loadingMap());
  const [loaded, session] = await Promise.all([api<FormData>("GET", `/api/forms/${formId}`), api<{ user: PublicUser }>("GET", "/api/session")]);
  if (!loaded.ok || !session.ok) {
    notFoundPage();
    return;
  }
  new Builder(main, stateBadge, loaded.data, session.data.user).start();
}

class Builder {
  private draft: Definition;
  private rev: number;
  private state: FormState;
  private edition: number | null;
  private settings: Settings;
  private selectedPage: string;
  private selectedQuestion: string | null = null;
  private rendering = false;
  private live = true;
  private queue: Change[] = [];
  private readonly ownSeqs = new Set<number>();
  private trial: Answers = {};
  private trialSeq = 0;
  private trialApplied = -1;
  private lastEval: Evaluation | null = null;
  private showJumpForm = false;
  private showCheckForm = false;

  private readonly title = h("h1", { class: "builder-title" });
  private readonly presence = h("p", { id: "presence", class: "muted" });
  private readonly liveStatus = h("p", { id: "live-status", class: "muted" });
  private readonly notice = h("p", { id: "notice" });
  private readonly saveChanges = h("button", { type: "button", hidden: true }, "Save changes");
  private readonly openLive = h("a", { class: "open-live" }, "Open live form");
  private readonly pagesPane = h("section", { class: "pane pane-pages", "aria-label": "Pages pane" });
  private readonly canvas = h("section", { class: "pane pane-canvas", "aria-label": "Canvas" });
  private readonly logicControls = h("div", { class: "logic-controls" });
  private readonly formulaError = h("p", { id: "formula-error", class: "error-text" });
  private readonly trialRegion = h("section", { "aria-label": "Trial answers", class: "trial-answers" });
  private readonly pageMap = h("ul", { "aria-label": "Page map", class: "page-map" });
  private readonly marker = h("div", { id: "lit-marker", "aria-hidden": "true" });
  private readonly trialValues = h("ul", { id: "trial-values", class: "trial-values figures" });
  private readonly addQuestionButton = h("button", { type: "button", "data-fid": "add-question" }, "Add question");

  constructor(
    private readonly main: HTMLElement,
    private readonly stateBadge: HTMLElement,
    private readonly form: FormData,
    private readonly me: PublicUser,
  ) {
    this.draft = form.draft;
    this.rev = form.rev;
    this.state = form.state;
    this.edition = form.edition;
    this.settings = form.settings;
    this.selectedPage = form.draft.pages[0].key;
  }

  start(): void {
    const owner = this.form.role === "owner";
    const publish = h("button", { type: "button", class: "primary" }, "Publish");
    publish.addEventListener("click", () => void this.publish());
    const settings = h("button", { type: "button" }, "Form settings");
    settings.addEventListener("click", () => this.settingsDialog(settings));
    const invite = h("button", { type: "button" }, "Invite editor");
    invite.addEventListener("click", () => this.inviteDialog(invite));
    this.saveChanges.addEventListener("click", () => void this.flushQueue());
    this.openLive.setAttribute("href", `/f/${this.form.slug}`);
    this.addQuestionButton.addEventListener("click", () => this.addQuestionDialog());
    const paneSelect = h(
      "select",
      { id: "pane-switch" },
      h("option", { value: "pages" }, "Pages"),
      h("option", { value: "canvas", selected: true }, "Canvas"),
      h("option", { value: "logic" }, "Logic"),
    );
    paneSelect.value = "canvas";
    paneSelect.addEventListener("change", () => (this.main.dataset.pane = paneSelect.value));
    this.main.dataset.pane = "canvas";
    this.main.classList.add("builder");
    const mapWrap = h("div", { class: "map-wrap" }, this.pageMap, this.marker);
    clear(
      this.main,
      h(
        "div",
        { class: "topbar" },
        this.title,
        this.stateBadge,
        this.presence,
        this.liveStatus,
        h(
          "div",
          { class: "topbar-actions" },
          owner ? publish : null,
          this.openLive,
          owner ? settings : null,
          owner ? invite : null,
          this.saveChanges,
        ),
        this.notice,
      ),
      h("div", { class: "pane-switch" }, field("Pane", paneSelect)),
      h(
        "div",
        { class: "panes" },
        this.pagesPane,
        this.canvas,
        h(
          "section",
          { class: "pane pane-logic", "aria-label": "Logic" },
          this.logicControls,
          this.formulaError,
          h("div", { class: "lit-path" }, h("h2", {}, "Lit path"), this.trialRegion, mapWrap, this.trialValues),
        ),
      ),
    );
    this.main.removeAttribute("aria-busy");
    this.updateTop();
    this.renderAll();
    void this.runTrial(true);
    connectLive({ form: this.form.id, view: "builder" }, (message) => this.onLive(message));
  }

  /* ---------- Top bar ---------- */

  private updateTop(): void {
    this.title.textContent = this.draft.title;
    setTitle(`Edit - ${this.draft.title}`);
    setFormState(this.stateBadge, this.state);
    this.openLive.hidden = this.edition === null;
    this.liveStatus.textContent = this.live ? "" : M.livePaused;
    this.saveChanges.hidden = this.live;
  }

  private setNotice(text: string): void {
    this.notice.textContent = text;
    announce(text);
  }

  private async refreshInfo(): Promise<void> {
    const info = await api<{ state: FormState; edition: number | null }>("GET", `/api/forms/${this.form.id}/info`);
    if (info.ok) {
      this.state = info.data.state;
      this.edition = info.data.edition;
      this.updateTop();
    }
  }

  private async publish(): Promise<void> {
    if (!this.live) await this.flushQueue();
    const result = await api<{ edition: number }>("POST", `/api/forms/${this.form.id}/publish`, {});
    if (!result.ok) {
      alertText(result.error?.message ?? "");
      return;
    }
    this.edition = result.data.edition;
    announce(M.editionLive(result.data.edition));
    await this.refreshInfo();
  }

  /* ---------- Changes ---------- */

  private apply(change: Change): void {
    applyChange(this.draft, change);
    this.fixSelection();
  }

  private fixSelection(): void {
    if (this.selectedQuestion && !findQuestion(this.draft, this.selectedQuestion)) this.selectedQuestion = null;
    if (!this.draft.pages.some((p) => p.key === this.selectedPage)) this.selectedPage = this.draft.pages[0].key;
  }

  /** Sends one change; while live editing is paused it waits for Save changes. */
  private async send(change: Change): Promise<ApiResult<unknown>> {
    if (!this.live) {
      this.apply(change);
      this.queue.push(change);
      this.renderAll();
      return { ok: true, status: 200, data: {}, error: null };
    }
    const result = await api<{ rev: number; applied: { seq: number | null; change?: Change; dropped?: boolean }[] }>(
      "POST",
      `/api/forms/${this.form.id}/changes`,
      { changes: [change] },
    );
    if (!result.ok) return result;
    this.applyReply(result.data.applied);
    return result;
  }

  private applyReply(applied: { seq: number | null; change?: Change; dropped?: boolean }[]): void {
    for (const entry of applied) {
      if (entry.dropped || entry.seq === null) {
        this.setNotice(M.questionGone);
        continue;
      }
      this.ownSeqs.add(entry.seq);
      if (entry.seq > this.rev && entry.change) {
        this.apply(entry.change);
        this.rev = entry.seq;
      }
    }
    this.updateTop();
    this.renderAll();
    void this.runTrial();
  }

  private async flushQueue(): Promise<void> {
    if (this.queue.length === 0) {
      announce(M.changesSaved);
      return;
    }
    const changes = this.queue;
    const result = await api<{ rev: number; applied: { seq: number | null; change?: Change; dropped?: boolean }[] }>(
      "POST",
      `/api/forms/${this.form.id}/changes`,
      { changes },
    );
    if (!result.ok) {
      alertText(result.error?.message ?? "");
      return;
    }
    this.queue = [];
    await this.resync();
    announce(M.changesSaved);
  }

  private async resync(): Promise<void> {
    const result = await api<FormData>("GET", `/api/forms/${this.form.id}`);
    if (!result.ok) return;
    this.draft = result.data.draft;
    this.rev = result.data.rev;
    this.state = result.data.state;
    this.fixSelection();
    this.updateTop();
    this.renderAll();
    void this.runTrial();
  }

  private onLive(message: LiveMessage): void {
    switch (message.type) {
      case "joined":
        this.live = message.live !== false;
        this.updateTop();
        if (typeof message.rev === "number" && message.rev > this.rev) void this.resync();
        return;
      case "live":
        this.live = message.up === true;
        this.updateTop();
        if (this.live) void this.resync();
        return;
      case "presence": {
        const others = (message.editors as PublicUser[]).filter((e) => e.id !== this.me.id).map((e) => e.name);
        this.presence.textContent = M.alsoEditing(others);
        return;
      }
      case "form_state":
        this.state = message.state as FormState;
        this.updateTop();
        return;
      case "refused": {
        const error = message.error as { message: string };
        alertText(error.message);
        return;
      }
      case "applied": {
        const seq = message.seq as number;
        const change = message.change as Change;
        if (seq <= this.rev) {
          if (!this.ownSeqs.has(seq)) void this.resync();
          return;
        }
        this.apply(change);
        this.rev = seq;
        const by = message.by as PublicUser;
        if (message.conflict_with === this.me.id && change.op === "set")
          this.setNotice(M.conflict(by.name, FIELD_NAMES[change.field] ?? change.field.replace(/_/g, " "), change.key));
        this.updateTop();
        this.renderAll();
        void this.runTrial();
        return;
      }
    }
  }

  /* ---------- Rendering ---------- */

  private renderAll(): void {
    const active = document.activeElement as HTMLElement | null;
    const fid = active?.dataset.fid;
    const typed =
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? {
            value: active.value,
            original: active.dataset.original,
            base: active.dataset.baseRev,
            start: active.selectionStart,
            end: active.selectionEnd,
          }
        : null;
    this.rendering = true;
    this.renderPages();
    this.renderCanvas();
    this.renderLogic();
    this.renderTrialControls();
    if (fid) {
      const next = this.main.querySelector<HTMLElement>(`[data-fid="${CSS.escape(fid)}"]`);
      if (next && next !== active) {
        if (typed && (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement)) {
          const wasTyping = typed.original !== undefined && typed.value !== typed.original;
          if (wasTyping) next.value = typed.value;
          next.dataset.original = wasTyping ? (typed.original ?? "") : next.value;
          if (typed.base) next.dataset.baseRev = typed.base;
          next.focus({ preventScroll: true });
          if (typed.start !== null && next.type !== "checkbox") next.setSelectionRange(typed.start, typed.end);
        } else next.focus({ preventScroll: true });
      }
    }
    this.rendering = false;
  }

  /** A builder text box that commits on blur, or on Enter when it is a single line. */
  private textBox(fid: string, label: string, value: string, commit: (value: string, baseRev: number) => void, multiline = false): HTMLElement {
    const input = multiline ? h("textarea", { rows: 3, "data-fid": fid }) : h("input", { type: "text", "data-fid": fid, autocomplete: "off" });
    input.value = value;
    input.dataset.original = value;
    input.dataset.baseRev = String(this.rev);
    input.addEventListener("focus", () => {
      if (this.rendering) return;
      input.dataset.original = input.value;
      input.dataset.baseRev = String(this.rev);
    });
    const run = (): void => {
      if (input.value === input.dataset.original) return;
      const base = Number(input.dataset.baseRev ?? this.rev);
      input.dataset.original = input.value;
      input.dataset.baseRev = String(this.rev);
      commit(input.value, base);
    };
    input.addEventListener("blur", () => {
      if (!this.rendering) run();
    });
    if (!multiline)
      input.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
          event.preventDefault();
          run();
        }
      });
    return field(label, input);
  }

  private renderPages(): void {
    const nav = h(
      "nav",
      { "aria-label": "Pages" },
      h(
        "ul",
        { class: "page-list" },
        this.draft.pages.map((p) =>
          h(
            "li",
            {},
            h(
              "button",
              {
                type: "button",
                class: "page-button",
                "aria-pressed": String(p.key === this.selectedPage),
                "data-fid": `page:${p.key}`,
                onclick: () => {
                  this.selectedPage = p.key;
                  this.selectedQuestion = null;
                  this.showJumpForm = false;
                  this.renderAll();
                },
              },
              p.title,
            ),
          ),
        ),
      ),
    );
    const addPage = h("button", { type: "button", "data-fid": "add-page" }, "Add page");
    addPage.addEventListener("click", async () => {
      let n = this.draft.pages.length + 1;
      while (this.draft.pages.some((p) => p.key === `page_${n}`)) n++;
      const pageValue: Page = { key: `page_${n}`, title: `Page ${n}`, questions: [] };
      const result = await this.send({ op: "add_page", page: pageValue, position: this.draft.pages.length + 1, base_rev: this.rev });
      if (!result.ok) alertText(result.error?.message ?? "");
      else {
        this.selectedPage = pageValue.key;
        this.selectedQuestion = null;
        this.renderAll();
      }
    });
    clear(this.pagesPane, nav, addPage);
  }

  private currentPage(): Page {
    return this.draft.pages.find((p) => p.key === this.selectedPage) ?? this.draft.pages[0];
  }

  private set(key: string, fieldName: string, value: unknown, baseRev: number): void {
    void this.send({ op: "set", key, field: fieldName, value, base_rev: baseRev }).then((result) => {
      if (!result.ok) alertText(result.error?.message ?? "");
    });
  }

  private renderCanvas(): void {
    const pageValue = this.currentPage();
    const rows = pageValue.questions.map((q, index) => this.questionRow(q, index, pageValue.questions.length));
    clear(
      this.canvas,
      this.textBox(`page-title:${pageValue.key}`, "Page title", pageValue.title, (value, base) => this.set(pageValue.key, "title", value, base)),
      h("div", { class: "question-rows" }, rows),
      this.addQuestionButton,
    );
  }

  private questionRow(q: Question, index: number, count: number): HTMLElement {
    const selected = q.key === this.selectedQuestion;
    const select = h(
      "button",
      { type: "button", class: "select-question", "aria-label": `Select question ${q.key}`, "aria-pressed": String(selected), "data-fid": `select:${q.key}` },
      h("span", { class: "q-label" }, q.label || q.key),
      h("span", { class: "q-meta muted" }, `${q.key} · ${TYPE_NAMES.find(([t]) => t === q.type)?.[1] ?? q.type}`),
    );
    select.addEventListener("click", () => {
      this.selectedQuestion = q.key;
      this.showCheckForm = false;
      this.renderAll();
    });
    const row = h("div", { class: `question-row${selected ? " selected" : ""}`, "data-key": q.key }, select);
    row.addEventListener("keydown", (event) => {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
      const target = index + 1 + (event.key === "ArrowUp" ? -1 : 1);
      if (target < 1 || target > count) return;
      void this.send({ op: "move_question", key: q.key, position: target, base_rev: this.rev }).then((result) => {
        if (!result.ok) {
          alertText(result.error?.message ?? "");
          return;
        }
        this.main.querySelector<HTMLElement>(`[data-fid="select:${CSS.escape(q.key)}"]`)?.focus();
        const list = this.currentPage().questions;
        announce(M.moved(q.key, list.findIndex((x) => x.key === q.key) + 1, list.length));
      });
    });
    if (selected) row.append(this.questionEditor(q));
    return row;
  }

  private questionEditor(q: Question): HTMLElement {
    const key = q.key;
    const editor = h("div", { class: "question-editor" });
    editor.append(this.textBox(`q:${key}:label`, "Question label", q.label, (v, b) => this.set(key, "label", v, b)));
    editor.append(this.textBox(`q:${key}:help`, "Help text", q.help ?? "", (v, b) => this.set(key, "help", v || null, b)));
    if (q.type !== "calculated") {
      const required = h("input", { type: "checkbox", "data-fid": `q:${key}:required`, checked: q.required === true });
      required.addEventListener("change", () => this.set(key, "required", required.checked, this.rev));
      editor.append(h("div", { class: "field checkbox-field" }, required, h("label", { for: (required.id = uid("required")) }, "Required")));
    }
    if (OPTION_TYPES.includes(q.type))
      editor.append(this.textBox(`q:${key}:options`, "Options", optionsText(q.options), (v, b) => this.set(key, "options", parseOptions(v), b), true));
    if (q.type === "grid") {
      editor.append(this.textBox(`q:${key}:rows`, "Rows", optionsText(q.rows), (v, b) => this.set(key, "rows", parseOptions(v), b), true));
      editor.append(this.textBox(`q:${key}:columns`, "Columns", optionsText(q.columns), (v, b) => this.set(key, "columns", parseOptions(v), b), true));
    }
    if (q.type === "number" || q.type === "scale" || q.type === "date") {
      const toValue = (v: string): unknown => (v.trim() === "" ? null : q.type === "date" ? v.trim() : Number(v.trim()));
      editor.append(this.textBox(`q:${key}:min`, "Minimum", q.min === undefined ? "" : String(q.min), (v, b) => this.set(key, "min", toValue(v), b)));
      editor.append(this.textBox(`q:${key}:max`, "Maximum", q.max === undefined ? "" : String(q.max), (v, b) => this.set(key, "max", toValue(v), b)));
    }
    if (q.type === "short_text" || q.type === "long_text") {
      const pattern = h(
        "select",
        { "data-fid": `q:${key}:pattern` },
        h("option", { value: "" }, "None"),
        h("option", { value: "email" }, "Email"),
        h("option", { value: "phone" }, "Phone"),
        h("option", { value: "digits" }, "Digits"),
        h("option", { value: "letters" }, "Letters"),
      );
      pattern.value = q.pattern ?? "";
      pattern.addEventListener("change", () => this.set(key, "pattern", pattern.value || null, this.rev));
      editor.append(field("Pattern", pattern));
    }
    editor.append(this.textBox(`q:${key}:note`, "Internal note", q.note ?? "", (v, b) => this.set(key, "note", v || null, b), true));
    const remove = h("button", { type: "button", class: "quiet" }, "Remove question");
    remove.addEventListener("click", async () => {
      const result = await this.send({ op: "remove_question", key, base_rev: this.rev });
      if (!result.ok) {
        alertText(result.error?.message ?? "");
        return;
      }
      this.addQuestionButton.focus();
      announce(M.questionRemoved(q.label));
    });
    editor.append(remove);
    return editor;
  }

  /* ---------- Add question ---------- */

  private addQuestionDialog(): void {
    const type = h("select", {}, TYPE_NAMES.map(([value, name]) => h("option", { value }, name)));
    const keyInput = h("input", { type: "text", autocomplete: "off", spellcheck: "false" });
    const keyError = h("p", { class: "field-error", id: uid("key-error") });
    const label = h("input", { type: "text", autocomplete: "off" });
    const required = h("input", { type: "checkbox" });
    const options = h("textarea", { rows: 4 });
    const optionsField = field("Options", options);
    const syncOptions = (): void => {
      optionsField.hidden = !OPTION_TYPES.includes(type.value as QuestionType);
    };
    type.addEventListener("change", syncOptions);
    const add = h("button", { type: "button" }, "Add");
    const cancel = h("button", { type: "button" }, "Cancel");
    let dialog: Dialog | null = null;
    const submit = async (): Promise<void> => {
      const questionType = type.value as QuestionType;
      const question: Question = { key: keyInput.value.trim(), type: questionType, label: label.value };
      if (required.checked) question.required = true;
      if (OPTION_TYPES.includes(questionType)) question.options = parseOptions(options.value);
      const result = await this.send({ op: "add_question", page: this.selectedPage, question, base_rev: this.rev });
      if (result.ok) {
        dialog?.close();
        announce(M.questionAdded(question.label));
        return;
      }
      const item = result.error?.items?.find((i) => i.key === question.key);
      keyError.textContent = item?.message ?? "";
      if (item) {
        keyInput.setAttribute("aria-invalid", "true");
        keyInput.setAttribute("aria-describedby", keyError.id);
      }
      alertText(result.error?.message ?? "");
    };
    add.addEventListener("click", () => void submit());
    cancel.addEventListener("click", () => dialog?.close());
    for (const input of [keyInput, label])
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void submit();
        }
      });
    dialog = openDialog(
      { title: "Add question", opener: this.addQuestionButton },
      field("Question type", type),
      field("Question key", keyInput, keyError),
      field("Question label", label),
      h("div", { class: "field checkbox-field" }, required, h("label", { for: (required.id = uid("required")) }, "Required")),
      optionsField,
      h("div", { class: "actions" }, add, cancel),
    );
    syncOptions();
    type.focus();
  }

  /* ---------- Logic ---------- */

  private showRefusal(message: string, box: HTMLElement): void {
    this.formulaError.textContent = message;
    alertText(message);
    box.setAttribute("aria-invalid", "true");
    box.setAttribute("aria-describedby", "formula-error");
    box.focus();
  }

  private clearRefusal(): void {
    this.formulaError.textContent = "";
    for (const el of this.logicControls.querySelectorAll("[aria-invalid]")) el.removeAttribute("aria-invalid");
  }

  /** Sends a group's changes in order; a refused formula stays in its box. */
  private async saveGroup(changes: Change[], boxFor: (message: string) => HTMLElement): Promise<boolean> {
    for (const change of changes) {
      const result = await this.send(change);
      if (!result.ok) {
        if (result.error?.code === "FORMULA_INVALID") this.showRefusal(result.error.message, boxFor(result.error.message));
        else alertText(result.error?.message ?? "");
        return false;
      }
    }
    this.clearRefusal();
    return true;
  }

  private input(fid: string, value: string): HTMLInputElement {
    const el = h("input", { type: "text", autocomplete: "off", spellcheck: "false", "data-fid": fid });
    el.value = value;
    return el;
  }

  private onEnter(inputs: HTMLElement[], action: () => void): void {
    for (const el of inputs)
      el.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
          event.preventDefault();
          action();
        }
      });
  }

  private ruleGroup(ownerKey: string, rule: { name: string; when: string } | null | undefined): HTMLElement[] {
    const name = this.input(`rule-name:${ownerKey}`, rule?.name ?? "");
    const when = this.input(`rule-when:${ownerKey}`, rule?.when ?? "");
    const save = (): void => {
      const value = name.value.trim() === "" && when.value.trim() === "" ? null : { name: name.value, when: when.value };
      void this.saveGroup([{ op: "set", key: ownerKey, field: "show_rule", value, base_rev: this.rev }], () => when);
    };
    this.onEnter([name, when], save);
    return [field("Rule name", name), field("Show when", when), h("button", { type: "button", onclick: save }, "Save rule")];
  }

  private renderLogic(): void {
    const pageValue = this.currentPage();
    const question = this.selectedQuestion ? findQuestion(this.draft, this.selectedQuestion)?.question : undefined;
    const parts: (HTMLElement | null)[] = [];
    if (question) {
      parts.push(h("h2", {}, `Logic for ${question.key}`), ...this.ruleGroup(question.key, question.show_rule));
      if (question.type === "calculated") parts.push(...this.formulaGroup(question));
      parts.push(...this.checkGroup(question, pageValue));
    } else {
      parts.push(h("h2", {}, `Logic for ${pageValue.title}`), ...this.ruleGroup(pageValue.key, pageValue.show_rule));
      parts.push(...this.jumpGroup(pageValue));
    }
    clear(this.logicControls, parts);
  }

  private formulaGroup(q: Question): HTMLElement[] {
    const formula = this.input(`formula:${q.key}`, q.formula ?? "");
    const places = this.input(`places:${q.key}`, q.places === undefined ? "" : String(q.places));
    const prefix = this.input(`prefix:${q.key}`, q.prefix ?? "");
    const suffix = this.input(`suffix:${q.key}`, q.suffix ?? "");
    const hidden = h("input", { type: "checkbox", "data-fid": `hidden:${q.key}`, checked: q.hidden === true });
    const save = (): void => {
      const placesValue = places.value.trim() === "" ? null : Number(places.value.trim());
      void this.saveGroup(
        [
          { op: "set", key: q.key, field: "formula", value: formula.value, base_rev: this.rev },
          { op: "set", key: q.key, field: "places", value: placesValue, base_rev: this.rev },
          { op: "set", key: q.key, field: "prefix", value: prefix.value || null, base_rev: this.rev },
          { op: "set", key: q.key, field: "suffix", value: suffix.value || null, base_rev: this.rev },
          { op: "set", key: q.key, field: "hidden", value: hidden.checked || null, base_rev: this.rev },
        ],
        () => formula,
      );
    };
    this.onEnter([formula, places, prefix, suffix], save);
    return [
      field("Formula", formula),
      field("Decimal places", places),
      field("Prefix", prefix),
      field("Suffix", suffix),
      h("div", { class: "field checkbox-field" }, hidden, h("label", { for: (hidden.id = uid("hidden")) }, "Hidden from respondents")),
      h("button", { type: "button", onclick: save }, "Save formula"),
    ];
  }

  private jumpGroup(pageValue: Page): HTMLElement[] {
    const index = this.draft.pages.indexOf(pageValue);
    const existing = (pageValue.jumps ?? []).map((j) =>
      h("li", {}, `${j.name}: ${j.when} → ${this.draft.pages.find((p) => p.key === j.to)?.title ?? j.to}`),
    );
    const addJump = h("button", { type: "button", "data-fid": `add-jump:${pageValue.key}` }, "Add jump");
    addJump.addEventListener("click", () => {
      this.showJumpForm = true;
      this.renderAll();
      this.main.querySelector<HTMLElement>(`[data-fid="jump-name:${CSS.escape(pageValue.key)}"]`)?.focus();
    });
    const parts: HTMLElement[] = [h("ul", { class: "jump-list" }, existing), addJump];
    if (!this.showJumpForm) return parts;
    const name = this.input(`jump-name:${pageValue.key}`, "");
    const when = this.input(`jump-when:${pageValue.key}`, "");
    const to = h(
      "select",
      { "data-fid": `jump-to:${pageValue.key}` },
      this.draft.pages.filter((_, i) => i > index).map((p) => h("option", { value: p.key }, p.title)),
    );
    const save = (): void => {
      const jumps = [...(pageValue.jumps ?? []), { name: name.value, when: when.value, to: to.value }];
      void this.saveGroup([{ op: "set", key: pageValue.key, field: "jumps", value: jumps, base_rev: this.rev }], () => when).then((ok) => {
        if (ok) {
          this.showJumpForm = false;
          this.renderAll();
          this.main.querySelector<HTMLElement>(`[data-fid="add-jump:${CSS.escape(pageValue.key)}"]`)?.focus();
        }
      });
    };
    this.onEnter([name, when], save);
    parts.push(field("Jump name", name), field("Jump when", when), field("Jump to", to), h("button", { type: "button", onclick: save }, "Save jump"));
    return parts;
  }

  private checkGroup(q: Question, pageValue: Page): HTMLElement[] {
    const existing = (this.draft.checks ?? []).filter((c) => c.target === q.key).map((c) => h("li", {}, `${c.name}: ${c.fail_when}`));
    const addCheck = h("button", { type: "button", "data-fid": `add-check:${q.key}` }, "Add check");
    addCheck.addEventListener("click", () => {
      this.showCheckForm = true;
      this.renderAll();
      this.main.querySelector<HTMLElement>(`[data-fid="check-name:${CSS.escape(q.key)}"]`)?.focus();
    });
    const parts: HTMLElement[] = [h("ul", { class: "check-list" }, existing), addCheck];
    if (!this.showCheckForm) return parts;
    const name = this.input(`check-name:${q.key}`, "");
    const failWhen = this.input(`check-when:${q.key}`, "");
    const message = this.input(`check-message:${q.key}`, "");
    const save = (): void => {
      const checks = [...(this.draft.checks ?? []), { name: name.value, page: pageValue.key, target: q.key, fail_when: failWhen.value, message: message.value }];
      void this.saveGroup([{ op: "set", key: "form", field: "checks", value: checks, base_rev: this.rev }], (text) =>
        text.startsWith("{{") ? message : failWhen,
      ).then((ok) => {
        if (ok) {
          this.showCheckForm = false;
          this.renderAll();
          this.main.querySelector<HTMLElement>(`[data-fid="add-check:${CSS.escape(q.key)}"]`)?.focus();
        }
      });
    };
    this.onEnter([name, failWhen, message], save);
    parts.push(field("Check name", name), field("Fails when", failWhen), field("Check message", message), h("button", { type: "button", onclick: save }, "Save check"));
    return parts;
  }

  /* ---------- Lit path ---------- */

  private renderTrialControls(): void {
    const controls: HTMLElement[] = [];
    for (const q of this.draft.pages.flatMap((p) => p.questions)) {
      const name = `Trial: ${q.label}`;
      const current = this.trial[q.key];
      const fid = `trial:${q.key}`;
      switch (q.type) {
        case "short_text":
        case "long_text":
        case "number":
        case "date": {
          const input = h("input", { type: "text", "data-fid": fid, autocomplete: "off" });
          input.value = typeof current === "string" ? current : "";
          const commit = (): void => this.setTrial(q.key, input.value.trim() === "" ? null : input.value);
          input.addEventListener("blur", () => {
            if (!this.rendering && input.value !== (typeof this.trial[q.key] === "string" ? this.trial[q.key] : "")) commit();
          });
          input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          });
          controls.push(field(name, input));
          break;
        }
        case "choice":
        case "dropdown":
        case "scale": {
          const options =
            q.type === "scale"
              ? Array.from({ length: Number(q.max) - Number(q.min) + 1 }, (_, i) => String(Number(q.min) + i)).map((v) => ({ value: v, label: v }))
              : (q.options ?? []);
          const select = h("select", { "data-fid": fid }, h("option", { value: "" }, ""), options.map((o) => h("option", { value: o.value }, o.label)));
          select.value = typeof current === "string" ? current : "";
          select.addEventListener("change", () => this.setTrial(q.key, select.value === "" ? null : select.value));
          controls.push(field(name, select));
          break;
        }
        case "checkbox": {
          const ticked = Array.isArray(current) ? current : [];
          const boxes = (q.options ?? []).map((o) => {
            const box = h("input", { type: "checkbox", value: o.value, checked: ticked.includes(o.value), "data-fid": `${fid}:${o.value}` });
            box.id = uid("trial-box");
            box.addEventListener("change", () => {
              const values = boxes.filter((b) => b.querySelector("input")?.checked).map((b) => (b.querySelector("input") as HTMLInputElement).value);
              this.setTrial(q.key, values.length ? values : null);
            });
            return h("div", { class: "checkbox-field" }, box, h("label", { for: box.id }, o.label));
          });
          controls.push(h("fieldset", { class: "trial-group" }, h("legend", {}, name), boxes));
          break;
        }
        case "grid": {
          const grid = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, string>) : {};
          for (const row of q.rows ?? []) {
            const select = h(
              "select",
              { "data-fid": `${fid}:${row.value}` },
              h("option", { value: "" }, ""),
              (q.columns ?? []).map((c) => h("option", { value: c.value }, c.label)),
            );
            select.value = grid[row.value] ?? "";
            select.addEventListener("change", () => {
              const next = { ...((this.trial[q.key] as Record<string, string> | undefined) ?? {}) };
              if (select.value) next[row.value] = select.value;
              else delete next[row.value];
              this.setTrial(q.key, Object.keys(next).length ? next : null);
            });
            controls.push(field(`${name}: ${row.label}`, select));
          }
          break;
        }
        default:
          break;
      }
    }
    clear(this.trialRegion, h("h3", {}, "Trial answers"), controls);
  }

  private setTrial(key: string, value: AnswerValue | null): void {
    if (value === null) delete this.trial[key];
    else this.trial[key] = value;
    void this.runTrial(true);
  }

  /** Evaluates the draft with the trial answers; only trial-answer changes announce the path. */
  private async runTrial(announcePath = false): Promise<void> {
    this.trialSeq += 1;
    const seq = this.trialSeq;
    const answers: Answers = {};
    for (const [key, value] of Object.entries(this.trial)) if (findQuestion(this.draft, key)) answers[key] = value;
    const result = await api<Evaluation>("POST", `/api/forms/${this.form.id}/trial`, { seq, answers });
    if (!result.ok) {
      if (result.error?.code !== "NOT_FOUND") alertText(result.error?.message ?? "");
      return;
    }
    if (result.data.seq < this.trialApplied) return;
    this.trialApplied = result.data.seq;
    this.applyTrial(result.data, announcePath);
  }

  private applyTrial(evaluation: Evaluation, announcePath: boolean): void {
    const previous = this.lastEval;
    const before = new Map<string, string>();
    for (const p of previous?.pages ?? []) {
      before.set(`p:${p.key}`, p.state);
      for (const q of p.questions) before.set(`q:${q.key}`, q.state);
    }
    const motion = !prefersReducedMotion();
    const changed: HTMLElement[] = [];
    const items = evaluation.pages.map((p) => {
      const lines = p.questions.map((q) => {
        const line = h(
          "div",
          { class: "map-question", "data-question": q.key, "data-state": q.state },
          h("span", { class: "map-label" }, q.label),
          q.state === "skipped" && p.state === "lit" && q.skipped_by ? h("span", { class: "skipped-by" }, M.skippedBy(q.skipped_by)) : null,
        );
        if (before.has(`q:${q.key}`) && before.get(`q:${q.key}`) !== q.state) changed.push(line);
        return line;
      });
      const item = h(
        "li",
        { "data-page": p.key, "data-state": p.state, class: "map-page" },
        h("span", { class: "map-title" }, p.title),
        p.state === "skipped" && p.skipped_by ? h("span", { class: "skipped-by" }, M.skippedBy(p.skipped_by)) : null,
        lines,
      );
      if (before.has(`p:${p.key}`) && before.get(`p:${p.key}`) !== p.state) changed.unshift(item);
      return item;
    });
    clear(this.pageMap, items);
    const order = [...this.pageMap.querySelectorAll<HTMLElement>(".map-page, .map-question")].filter((el) => changed.includes(el));
    if (motion)
      order.forEach((el, i) => {
        el.style.animationDelay = `${Math.min(i, 11) * 40}ms`;
        el.classList.add("lit-fade");
      });
    const lastLit = [...evaluation.pages].reverse().find((p) => p.state === "lit");
    const target = lastLit ? this.pageMap.querySelector<HTMLElement>(`[data-page="${CSS.escape(lastLit.key)}"]`) : null;
    const fromY = this.marker.dataset.y ?? "0";
    const toY = String(target ? target.offsetTop : 0);
    this.marker.dataset.page = lastLit?.key ?? "";
    this.marker.dataset.y = toY;
    this.marker.style.setProperty("--from", `${fromY}px`);
    this.marker.style.setProperty("--to", `${toY}px`);
    this.marker.style.transform = `translateY(${toY}px)`;
    this.marker.style.height = `${target ? target.offsetHeight : 0}px`;
    if (motion && previous) restartAnimation(this.marker, "lit-marker");
    this.renderValues(evaluation, previous, motion);
    this.lastEval = evaluation;
    if (announcePath) announce(evaluation.announce);
  }

  private renderValues(evaluation: Evaluation, previous: Evaluation | null, motion: boolean): void {
    const lines = this.draft.pages
      .flatMap((p) => p.questions)
      .filter((q) => q.type === "calculated")
      .map((q) => {
        const value = evaluation.values[q.key];
        const label = evaluation.pages.flatMap((p) => p.questions).find((x) => x.key === q.key)?.label ?? q.label;
        const text = value?.text ?? M.notCalculated;
        const count = h("span", { class: "lit-count", "data-final": text }, text);
        const old = previous?.values[q.key];
        if (motion && old && old.text !== text && old.value !== null && value?.value !== null) countUp(count, Number(old.value), Number(value?.value), text);
        return h("li", { "data-key": q.key }, `${label}: `, count);
      });
    clear(this.trialValues, lines);
  }

  /* ---------- Dialogs ---------- */

  private settingsDialog(opener: HTMLElement): void {
    const closes = h("input", { type: "text", autocomplete: "off", placeholder: "YYYY-MM-DD HH:MM" });
    closes.value = this.settings.closes_at ? this.settings.closes_at.replace("T", " ") : "";
    const limit = h("input", { type: "text", inputmode: "numeric", autocomplete: "off" });
    limit.value = this.settings.response_limit === null ? "" : String(this.settings.response_limit);
    const message = h("textarea", { rows: 2 });
    message.value = this.settings.closed_message ?? "";
    const emailQuestions = this.draft.pages.flatMap((p) => p.questions).filter((q) => q.type === "short_text" && q.pattern === "email");
    const copyTo = h("select", {}, h("option", { value: "" }, "Nobody"), emailQuestions.map((q) => h("option", { value: q.key }, q.label)));
    copyTo.value = this.settings.copy_to ?? "";
    const errors = { closes_at: h("p", { class: "field-error", id: uid("err") }), response_limit: h("p", { class: "field-error", id: uid("err") }), copy_to: h("p", { class: "field-error", id: uid("err") }) };
    const inputs: Record<keyof typeof errors, HTMLElement> = { closes_at: closes, response_limit: limit, copy_to: copyTo };
    const status = h("p", { class: "form-status" });
    let dialog: Dialog | null = null;
    const save = async (): Promise<void> => {
      const result = await api<{ settings: Settings; state: FormState }>("PUT", `/api/forms/${this.form.id}/settings`, {
        closes_at: closes.value.trim() || null,
        response_limit: limit.value.trim() || null,
        closed_message: message.value.trim() ? message.value : null,
        copy_to: copyTo.value || null,
      });
      for (const [key, el] of Object.entries(errors)) {
        const item = result.error?.items?.find((i) => i.key === key);
        el.textContent = item?.message ?? "";
        const input = inputs[key as keyof typeof errors];
        if (item) {
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", el.id);
        } else input.removeAttribute("aria-invalid");
      }
      if (!result.ok) {
        status.textContent = result.error?.message ?? "";
        alertText(result.error?.message ?? "");
        return;
      }
      this.settings = result.data.settings;
      this.state = result.data.state;
      this.updateTop();
      dialog?.close();
      announce(M.settingsSaved);
    };
    const closeNow = async (): Promise<void> => {
      const result = await api<{ state: FormState }>("POST", `/api/forms/${this.form.id}/close`, {});
      if (!result.ok) {
        status.textContent = result.error?.message ?? "";
        alertText(result.error?.message ?? "");
        return;
      }
      this.state = result.data.state;
      this.updateTop();
      status.textContent = M.nowClosed;
      announce(M.nowClosed);
    };
    const reopenForm = async (): Promise<void> => {
      const result = await api<{ state: FormState; edition: number }>("POST", `/api/forms/${this.form.id}/reopen`, {});
      if (!result.ok) {
        status.textContent = result.error?.message ?? "";
        alertText(result.error?.message ?? "");
        return;
      }
      this.state = result.data.state;
      this.edition = result.data.edition;
      const fresh = await api<FormData>("GET", `/api/forms/${this.form.id}`);
      if (fresh.ok) this.settings = fresh.data.settings;
      this.updateTop();
      status.textContent = M.editionLive(result.data.edition);
      announce(M.editionLive(result.data.edition));
    };
    dialog = openDialog(
      { title: "Form settings", opener },
      field("Closing time", closes, errors.closes_at),
      field("Response limit", limit, errors.response_limit),
      field("Closed message", message),
      field("Send a copy to", copyTo, errors.copy_to),
      status,
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", onclick: () => void closeNow() }, "Close now"),
        h("button", { type: "button", onclick: () => void reopenForm() }, "Reopen form"),
        h("button", { type: "button", onclick: () => void save() }, "Save settings"),
      ),
    );
    closes.focus();
  }

  private inviteDialog(opener: HTMLElement): void {
    const email = h("input", { type: "email", autocomplete: "off" });
    const error = h("p", { class: "field-error", id: uid("err") });
    let dialog: Dialog | null = null;
    const sendInvite = async (): Promise<void> => {
      const result = await api<{ message: string }>("POST", `/api/forms/${this.form.id}/invitations`, { email: email.value });
      if (!result.ok) {
        error.textContent = result.error?.items?.[0]?.message ?? "";
        email.setAttribute("aria-invalid", "true");
        email.setAttribute("aria-describedby", error.id);
        alertText(result.error?.message ?? "");
        return;
      }
      dialog?.close();
      announce(result.data.message);
    };
    const form = h("form", { novalidate: true, class: "stack" }, field("Email address", email, error), h("button", { type: "submit" }, "Send invitation"));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendInvite();
    });
    dialog = openDialog({ title: "Invite editor", opener }, form);
    email.focus();
  }
}

/** Counts a shown value from its old number to its new one; the text already holds the final value. */
function countUp(el: HTMLElement, from: number, to: number, finalText: string): void {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return;
  const match = /^(\D*)(-?[\d.]+)(\D*)$/.exec(finalText);
  if (!match) return;
  const places = match[2].includes(".") ? match[2].length - match[2].indexOf(".") - 1 : 0;
  const started = performance.now();
  const step = (time: number): void => {
    const t = Math.min(1, (time - started) / 320);
    const eased = 1 - Math.pow(1 - t, 3);
    if (t >= 1 || !el.isConnected) {
      delete el.dataset.count;
      return;
    }
    el.dataset.count = `${match[1]}${(from + (to - from) * eased).toFixed(places)}${match[3]}`;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
