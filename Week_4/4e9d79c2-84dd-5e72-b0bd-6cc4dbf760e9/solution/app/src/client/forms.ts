// Every form and action button on every screen: collect, refuse, send, announce, close.
import { $, $$, announce, call, clearBusy, isBusy, safely, setBusy, type Reply, type ReplyBody } from "./core.js";

type FormBody = Record<string, ReplyBody>;
import { printedMoney } from "../shared/rules.js";
import { closeDialog, isOpen, topDialog } from "./dialogs.js";
import { refreshNow, sessionEnded } from "./refresh.js";
import { typedToDate, ukTime } from "../shared/time.js";

type Flow = (form: HTMLFormElement, button: HTMLElement) => Promise<void>;
const flows = new Map<string, Flow>();
export const registerFlow = (name: string, flow: Flow): void => { flows.set(name, flow); };
type Builder = (form: HTMLFormElement) => { body: unknown; errors: Record<string, string> };
const builders = new Map<string, Builder>();
export const registerBuilder = (name: string, builder: Builder): void => { builders.set(name, builder); };

const DATE_COPY = "Enter a date as DD/MM/YYYY.";

const setPath = (target: FormBody, path: string, value: unknown): void => {
  const parts = path.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts[parts.length - 1]] = value;
};
const joinTimes = (node: ReplyBody): void => {
  if (node === null || typeof node !== "object" || Array.isArray(node)) return;
  for (const value of Object.values(node)) joinTimes(value);
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === "object" && "hour" in value) {
      value.time = value.hour && value.minutes ? `${value.hour}:${value.minutes}` : "";
      delete value.hour;
      delete value.minutes;
    }
  }
};
/** The JSON of a plain form: dotted names nest, typed dates become ISO dates, hour and minutes become a time. */
export const collect = (form: HTMLFormElement): { body: FormBody; errors: Record<string, string> } => {
  const body: FormBody = {};
  const errors: Record<string, string> = {};
  for (const element of [...form.elements] as HTMLInputElement[]) {
    if (!element.name || element.type === "file" || element.type === "submit" || element.closest("[hidden]")) continue;
    if ((element.type === "radio" || element.type === "checkbox") && !element.checked) continue;
    const kind = element.dataset.type;
    let value: unknown = element.value;
    if (kind === "date") {
      const iso = typedToDate(element.value);
      if (!iso) errors[element.dataset.field ?? element.name] = DATE_COPY;
      value = iso ?? "";
    } else if (kind === "int") {
      value = element.value === "" ? null : Number(element.value);
    } else if (kind === "sizes") {
      value = element.value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
    }
    setPath(body, element.name, value);
  }
  joinTimes(body);
  return { body, errors };
};

const fieldFor = (form: HTMLElement, key: string): HTMLElement | null => $<HTMLElement>(`[data-field~="${CSS.escape(key)}"]`, form) ?? $<HTMLElement>(`[name="${CSS.escape(key)}"]`, form);
const focusTargetOf = (field: HTMLElement): HTMLElement => (field.getAttribute("role") === "radiogroup" ? $<HTMLElement>("input:checked", field) ?? $<HTMLElement>("input", field) ?? field : field);

let errorCount = 0;
export const clearProblems = (form: HTMLElement): void => {
  const box = $<HTMLElement>("[data-problems]", form);
  if (box) {
    box.hidden = true;
    $("ul", box)?.replaceChildren();
  }
  for (const field of $$<HTMLElement>("[aria-invalid]", form)) {
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  }
  for (const line of $$(".field-error", form)) line.remove();
};
/** Shows every refused field in the Problems summary and on the field, and announces it. */
export const showProblems = (form: HTMLElement, fields: Record<string, string>, general?: string, focus = true): void => {
  clearProblems(form);
  const box = $<HTMLElement>("[data-problems]", form);
  const list = box ? $("ul", box) : null;
  const seen = new Set<string>();
  const add = (message: string, field: HTMLElement | null): void => {
    if (seen.has(message) && !field) return;
    seen.add(message);
    const item = document.createElement("li");
    if (field) {
      const target = focusTargetOf(field);
      if (!target.id) target.id = `problem-field-${(errorCount += 1)}`;
      const link = document.createElement("a");
      link.href = `#${target.id}`;
      link.textContent = message;
      item.append(link);
    } else item.textContent = message;
    list?.append(item);
  };
  const messages: string[] = [];
  for (const [key, message] of Object.entries(fields)) {
    const field = fieldFor(form, key);
    if (field) {
      field.setAttribute("aria-invalid", "true");
      const note = document.createElement("span");
      note.className = "field-error";
      note.id = `error-${(errorCount += 1)}`;
      note.textContent = message;
      note.setAttribute("data-client-owned", "");
      field.setAttribute("aria-describedby", note.id);
      (field.closest(".field,.radio-block") ?? field.parentElement)?.append(note);
    }
    add(message, field);
    messages.push(message);
  }
  if (general && !messages.includes(general)) { add(general, null); messages.push(general); }
  if (box) box.hidden = false;
  announce([...new Set(messages)].join(" "), false);
  if (focus) box?.focus({ preventScroll: false });
};

export const refusal = (form: HTMLElement, reply: Reply): void => {
  if (reply.status === 401 && reply.json?.error?.code === "sessionEnded") return sessionEnded();
  const error = reply.json?.error ?? {};
  const copy = form.dataset.errors ? (JSON.parse(form.dataset.errors) as Record<string, string>)[error.code] : undefined;
  const message: string = copy ?? error.message ?? "That did not save. Try again.";
  const fields: Record<string, string> = error.fields ?? {};
  const translated = copy ? Object.fromEntries(Object.keys(fields).map((k) => [k, copy])) : fields;
  showProblems(form, translated, message);
};

/** A form's last step has succeeded: announce, tidy up, close its dialog and read the screen again. */
export const succeeded = (form: HTMLElement, message: string | undefined): void => {
  clearProblems(form);
  const dialog = form.closest<HTMLElement>(".dialog");
  if (message) announce(message);
  for (const field of $$<HTMLElement>("[data-dirty]", form)) delete field.dataset.dirty;
  if (dialog && isOpen(dialog) && form.hasAttribute("data-close-on-ok")) {
    closeDialog(dialog);
    if (form instanceof HTMLFormElement) form.reset();
  }
  if (form.hasAttribute("data-clear-on-ok") && form instanceof HTMLFormElement) form.reset();
  void refreshNow().then(() => {
    const active = document.activeElement;
    if (!topDialog() && (!active || active === document.body)) $<HTMLElement>("h1")?.focus();
  });
};

const sendForm = async (form: HTMLFormElement, button: HTMLElement): Promise<void> => {
  const [method, path] = (form.dataset.api ?? "").split(" ");
  const format = form.dataset.format ?? "json";
  clearProblems(form);
  const built = form.dataset.builder ? (builders.get(form.dataset.builder) as Builder)(form) : collect(form);
  if (Object.keys(built.errors).length) return showProblems(form, built.errors);
  const file = $<HTMLInputElement>('input[type="file"]', form)?.files?.[0];
  if ((format === "csv" || format === "multipart") && !file) return showProblems(form, { file: "Choose a file." });
  setBusy(button);
  const reply = await safely(async () => {
    if (format === "none") return call(method, path);
    if (format === "csv") return call(method, path, undefined, { body: await (file as File).arrayBuffer(), headers: { "Content-Type": "text/csv" } });
    if (format === "multipart") {
      const data = new FormData();
      for (const [key, value] of Object.entries(built.body as Record<string, string>)) data.append(key, value);
      data.append("file", file as File);
      return call(method, path, undefined, { body: data });
    }
    return call(method, path, built.body);
  });
  clearBusy(button);
  if (!reply.ok) return refusal(form, reply);
  const after = form.dataset.after;
  if (after === "signed-in") {
    const wanted = form.dataset.return;
    location.assign(wanted && /^\/(?![/\\])/.test(wanted) ? wanted : "/enquiries");
    return;
  }
  const told = form.hasAttribute("data-ok-driver") && reply.json?.toldAt ? `Driver told at ${ukTime(Date.parse(reply.json.toldAt) / 1000)}` : undefined;
  succeeded(form, told ?? form.dataset.ok);
};

export const initForms = (): void => {
  document.addEventListener("submit", (event) => {
    const form = event.target as HTMLFormElement;
    if (form.matches("[data-filters],[data-search],[data-journey='public']")) return;
    event.preventDefault();
    const button = (event as SubmitEvent).submitter ?? $<HTMLElement>('[type="submit"]', form) ?? document.querySelector<HTMLElement>(`[form="${form.id}"]`);
    if (!button || isBusy(button)) return;
    const flow = form.dataset.flow ? flows.get(form.dataset.flow) : undefined;
    void (flow ? flow(form, button) : sendForm(form, button));
  });
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLAnchorElement>("[data-problems] a");
    if (link) {
      event.preventDefault();
      document.getElementById(link.getAttribute("href")?.slice(1) ?? "")?.focus();
      return;
    }
    const act = target.closest<HTMLElement>("[data-act]");
    if (act) {
      event.preventDefault();
      if (!isBusy(act)) void runAction(act);
    }
    if (target.closest("[data-sign-out]")) void call("POST", "/api/auth/sign-out", {}).finally(() => location.assign("/sign-in"));
    if (target.closest("[data-print]")) window.print();
    if (target.closest("[data-reload]")) location.reload();
  });
  document.addEventListener("input", (event) => {
    const field = event.target as HTMLElement;
    if (!field.matches("[data-nodirty],[data-filters] input[type=radio],[data-state-bar] input")) field.dataset.dirty = "1";
  }, true);
  document.addEventListener("change", (event) => {
    const field = event.target as HTMLElement;
    if (field.tagName === "SELECT" && !field.hasAttribute("data-nodirty")) field.dataset.dirty = "1";
  }, true);
};

const runAction = async (act: HTMLElement): Promise<void> => {
  const [method, path] = (act.dataset.act ?? "").split(" ");
  setBusy(act);
  const reply = await safely(() => call(method, path, act.dataset.body ? JSON.parse(act.dataset.body) : {}));
  clearBusy(act);
  if (!reply.ok) {
    if (reply.status === 401 && reply.json?.error?.code === "sessionEnded") return sessionEnded();
    announce(reply.json?.error?.message ?? "That did not save. Try again.");
    return void refreshNow();
  }
  let message = act.dataset.ok;
  if (act.hasAttribute("data-ok-charges")) message = `Charges accepted: ${printedMoney(reply.json.added)}.`;
  if (reply.json?.toldAt && message === "Driver told.") message = `Driver told at ${ukTime(Date.parse(reply.json.toldAt) / 1000)}`;
  if (message) announce(message);
  void refreshNow().then(() => {
    const active = document.activeElement;
    if (!active || active === document.body) $<HTMLElement>("h1")?.focus();
  });
};
