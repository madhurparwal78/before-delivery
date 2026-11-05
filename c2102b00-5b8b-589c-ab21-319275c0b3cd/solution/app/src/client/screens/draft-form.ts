// New and draft cycle: name, three club-time fields and the case list, with a linked problem
// summary when a save or open is refused. Every step works by keyboard alone.
import { api, errorFields, NoResponse } from "../api.js";
import { fieldValue, localText } from "../clubclock.js";
import { h, money, setBusy, setFieldError, uid } from "../dom.js";
import { announce, main } from "../shell.js";

export interface DraftCycle {
  id: string;
  name: string;
  status: string;
  revision: number;
  cutoff_at: string | null;
  pickup_start_at: string | null;
  pickup_end_at: string | null;
  lines: { product_id: string }[];
}

interface Product {
  id: string;
  case_name: string;
  pack: number;
  unit: string;
  price_cents: number;
}

const FIELDS = [
  { key: "name", label: "Cycle name" },
  { key: "cutoff_local", label: "Cutoff (club time)" },
  { key: "pickup_start_local", label: "Pickup starts (club time)" },
  { key: "pickup_end_local", label: "Pickup ends (club time)" },
  { key: "product_ids", label: "Cases" },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

/** Renders the form; `onOpened` takes over the address once the cycle opens. */
export async function draftForm(draft: DraftCycle | null, onOpened: (id: string) => void): Promise<void> {
  const products: Product[] = (await api("GET", "/api/catalog")).body.products;
  let current = draft;
  document.title = `${current ? current.name : "New cycle"} · Tally Split`;

  const errors = new Map<FieldKey, HTMLElement>(FIELDS.map((f) => [f.key, h("p", { class: "field-error", id: uid("err"), hidden: true })]));
  const textField = (key: FieldKey, label: string, value: string, hint: string | null) => {
    const input = h("input", { class: "input", type: "text", id: uid("field"), "aria-label": label, autocomplete: "off", spellcheck: "false" });
    input.value = value;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void save();
      }
    });
    const wrap = h("div", { class: "field" },
      h("label", { class: "label", for: input.id }, label.toUpperCase()),
      input,
      hint ? h("p", { class: "hint", "aria-hidden": "true" }, hint) : null,
      errors.get(key)!);
    return { input, wrap };
  };
  const name = textField("name", "Cycle name", current?.name ?? "", "1 to 60 characters on one line");
  const hint = "YYYY-MM-DD HH:MM, club time";
  const cutoff = textField("cutoff_local", "Cutoff (club time)", fieldValue(current?.cutoff_at ?? null), hint);
  const start = textField("pickup_start_local", "Pickup starts (club time)", fieldValue(current?.pickup_start_at ?? null), hint);
  const end = textField("pickup_end_local", "Pickup ends (club time)", fieldValue(current?.pickup_end_at ?? null), hint);
  const ticked = new Set(current?.lines.map((l) => l.product_id) ?? []);
  const boxes = products.map((p) => {
    const box = h("input", { type: "checkbox", id: uid("case"), value: p.id, "aria-label": p.case_name, checked: ticked.has(p.id) });
    return h("label", { class: "check-row", for: box.id }, box,
      h("span", { class: "check-name", "aria-hidden": "true" }, p.case_name),
      h("span", { class: "check-meta", "aria-hidden": "true" }, `${p.pack} ${p.unit} · ${money(p.price_cents)}`));
  });
  const caseBoxes = () => boxes.map((b) => b.querySelector("input")!);
  const casesSet = h("fieldset", { class: "field cases-field", id: uid("cases") },
    h("legend", { class: "label" }, "CASES FROM THE CASE LIST"), h("div", { class: "check-grid" }, ...boxes), errors.get("product_ids")!);
  const inputs: Record<FieldKey, HTMLElement> = {
    name: name.input, cutoff_local: cutoff.input, pickup_start_local: start.input, pickup_end_local: end.input, product_ids: casesSet,
  };
  const saveButton = h("button", { type: "button", class: current ? "button quiet" : "button primary" }, "Save draft");
  const openButton = h("button", { type: "button", class: "button primary" }, "Open cycle");
  const actions = h("div", { class: "form-actions" }, saveButton, current ? openButton : null);
  const summarySlot = h("div", { class: "summary-slot" });
  const heading = h("h1", {}, current ? current.name : "New cycle");

  function values() {
    return {
      name: name.input.value,
      cutoff_local: localText(cutoff.input.value),
      pickup_start_local: localText(start.input.value),
      pickup_end_local: localText(end.input.value),
      product_ids: caseBoxes().filter((b) => b.checked).map((b) => b.value),
    };
  }

  function showProblems(fields: Record<string, string>, verb: "opening" | "saving"): void {
    const failing = FIELDS.filter((f) => fields[f.key]);
    for (const f of FIELDS) setFieldError(inputs[f.key], errors.get(f.key)!, fields[f.key] ?? null);
    const links = failing.map((f) =>
      h("li", {},
        h("a", {
          href: `#${inputs[f.key].id}`,
          onclick: (event: MouseEvent) => {
            event.preventDefault();
            const target = f.key === "product_ids" ? caseBoxes()[0]! : (inputs[f.key] as HTMLInputElement);
            target.focus();
            target.scrollIntoView({ block: "center", inline: "nearest" });
          },
        }, `${f.label}: ${fields[f.key]}`)));
    const list = h("ul", { class: "problem-list", "aria-label": "Problems with this cycle" }, ...links);
    summarySlot.replaceChildren(h("div", { class: "problems", role: "group", "aria-label": "Problem summary" },
      h("p", { class: "label" }, "FIX BEFORE YOU GO ON"), list));
    const n = failing.length;
    announce("Coordinator updates", `${n} ${n === 1 ? "problem stops" : "problems stop"} this cycle from ${verb}.`);
    (list.querySelector("a") as HTMLAnchorElement | null)?.focus();
  }

  function clearProblems(): void {
    summarySlot.replaceChildren();
    for (const f of FIELDS) setFieldError(inputs[f.key], errors.get(f.key)!, null);
  }

  let busy = false;
  async function send(button: HTMLButtonElement, idle: string, call: () => Promise<{ status: number; body: any }>, verb: "opening" | "saving") {
    if (busy) return null;
    busy = true;
    setBusy(button, true, "Saving...", idle);
    try {
      const r = await call();
      if (r.status === 422) showProblems(errorFields(r as never), verb);
      else if (r.status === 412) announce("Coordinator updates", `Someone else changed ${current?.name ?? "this cycle"}. The latest times are shown; check them and save again.`);
      else if (r.status >= 400) announce("Coordinator updates", (r.body?.error?.message as string) ?? "That didn't work.");
      return r;
    } catch (error) {
      if (!(error instanceof NoResponse)) throw error;
      announce("Coordinator updates", "Couldn't reach the server. Check your connection and try again.");
      return null;
    } finally {
      busy = false;
      setBusy(button, false, "Saving...", idle);
    }
  }

  async function save(): Promise<void> {
    const body = values();
    const r = current
      ? await send(saveButton, "Save draft", () => api("PATCH", `/api/cycles/${current!.id}`, { body, ifMatch: `"r${current!.revision}"` }), "saving")
      : await send(saveButton, "Save draft", () => api("POST", "/api/cycles", { body: Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)) }), "saving");
    if (!r || (r.status !== 200 && r.status !== 201)) {
      if (r?.status === 412 && current) await reload();
      return;
    }
    const wasNew = !current;
    current = r.body as DraftCycle;
    clearProblems();
    heading.textContent = current.name;
    document.title = `${current.name} · Tally Split`;
    if (wasNew) {
      history.replaceState(null, "", `/coordinator/cycles/${encodeURIComponent(current.id)}`);
      actions.append(openButton);
    }
    announce("Coordinator updates", `Saved draft ${current.name}.`);
  }

  async function reload(): Promise<void> {
    const r = await api<DraftCycle>("GET", `/api/cycles/${current!.id}`);
    if (r.status !== 200) return;
    current = r.body;
    name.input.value = current.name;
    cutoff.input.value = fieldValue(current.cutoff_at);
    start.input.value = fieldValue(current.pickup_start_at);
    end.input.value = fieldValue(current.pickup_end_at);
    const now = new Set(current.lines.map((l) => l.product_id));
    caseBoxes().forEach((b) => (b.checked = now.has(b.value)));
  }

  async function open(): Promise<void> {
    if (!current) return;
    const r = await send(openButton, "Open cycle", () =>
      api("POST", `/api/cycles/${current!.id}/transitions`, { body: { to: "open", ...values() }, ifMatch: `"r${current!.revision}"` }), "opening");
    if (r?.status === 412) await reload();
    if (r?.status !== 200) return;
    clearProblems();
    announce("Coordinator updates", `${r.body.name} is now open.`);
    onOpened(current.id);
  }

  saveButton.addEventListener("click", () => void save());
  openButton.addEventListener("click", () => void open());

  main.replaceChildren(
    h("section", { class: "panel draft" },
      h("p", { class: "kicker" }, current ? "Draft cycle" : "Draft"),
      heading,
      summarySlot,
      h("div", { class: "draft-form" },
        h("div", { class: "draft-fields" }, name.wrap, cutoff.wrap, start.wrap, end.wrap),
        casesSet,
        actions)),
  );
}
