import { M } from "../../shared/messages.js";
import type { Definition, FormState, Summary, SummaryQuestion, SummaryRow } from "../../shared/types.js";
import { api } from "../api.js";
import { alertText, announce, clear, field, focusFirst, h, openDialog, setTitle, svg } from "../dom.js";
import { localTimeText, loadingMap, notFoundPage, ownerPage, setFormState, STATE_TEXT } from "../layout.js";
import { connectLive } from "../live.js";

interface FormInfo {
  id: string;
  slug: string;
  title: string;
  role: "owner" | "editor";
  state: FormState;
  edition: number | null;
}

/* ---------- Forms ---------- */

export async function formsList(): Promise<void> {
  const { main } = ownerPage(null);
  main.append(loadingMap());
  const result = await api<{ forms: { id: string; title: string; state: FormState; responses: number }[] }>("GET", "/api/forms");
  main.removeAttribute("aria-busy");
  if (!result.ok) {
    notFoundPage();
    return;
  }
  const newButton = h("button", { type: "button" }, "New form");
  newButton.addEventListener("click", () => newFormDialog(newButton));
  const list = result.data.forms.length
    ? h(
        "ul",
        { class: "form-list" },
        result.data.forms.map((f) =>
          h(
            "li",
            {},
            h("a", { href: `/forms/${f.id}/edit` }, f.title),
            h("span", { class: "muted" }, STATE_TEXT[f.state]),
            h("span", { class: "muted figures" }, M.responseCount(f.responses)),
          ),
        ),
      )
    : h("p", { class: "empty-state" }, M.noForms);
  clear(main, h("h1", {}, "Forms"), newButton, list);
  setTitle("Forms - Nightform");
}

function newFormDialog(opener: HTMLElement): void {
  const input = h("input", { type: "text", autocomplete: "off" });
  const error = h("p", { class: "field-error", id: "error-title" });
  const form = h("form", { class: "stack", novalidate: true }, field("Form title", input, error), h("button", { type: "submit", class: "primary" }, "Create form"));
  const dialog = openDialog({ title: "New form", opener }, form);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await api<{ id: string }>("POST", "/api/forms", { title: input.value });
    if (result.ok) {
      location.assign(`/forms/${result.data.id}/edit`);
      return;
    }
    error.textContent = result.error?.items?.[0]?.message ?? result.error?.message ?? "";
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", error.id);
    alertText(result.error?.message ?? "");
    input.focus();
  });
  focusFirst(dialog);
}

async function formInfo(id: string): Promise<FormInfo | null> {
  const result = await api<FormInfo>("GET", `/api/forms/${id}/info`);
  return result.ok ? result.data : null;
}

/* ---------- Summary ---------- */

function chart(name: string, rows: SummaryRow[]): SVGElement {
  const max = Math.max(0, ...rows.map((r) => Number(r.count)));
  const rowHeight = 28;
  return svg(
    "svg",
    { role: "img", "aria-label": name, viewBox: `0 0 240 ${Math.max(rowHeight, rows.length * rowHeight)}`, class: "chart", preserveAspectRatio: "none" },
    rows.map((r, i) =>
      svg("rect", {
        x: 0,
        y: i * rowHeight + 6,
        width: max === 0 ? 0 : (Number(r.count) / max) * 240,
        height: rowHeight - 12,
        "data-option": r.value,
        "data-count": r.count,
        class: "bar",
      }),
    ),
  );
}

function optionTable(name: string, rows: SummaryRow[]): HTMLElement {
  return h(
    "table",
    { "aria-label": name, class: "figures" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Option"), h("th", { scope: "col" }, "Count"), h("th", { scope: "col" }, "Percent"))),
    h(
      "tbody",
      {},
      rows.map((r) => h("tr", {}, h("th", { scope: "row" }, r.label), h("td", {}, r.count), h("td", {}, `${r.percent}%`))),
    ),
  );
}

function summarySection(q: SummaryQuestion, total: number): HTMLElement {
  const section = h("section", { class: "summary-question", "aria-label": q.label, tabindex: "-1" }, h("h2", {}, q.label));
  section.append(h("p", { class: "muted figures" }, M.answered(Number(q.answered), total)));
  if (q.rows) section.append(h("div", { class: "table-chart" }, optionTable(`${q.label} table`, q.rows), chart(`${q.label} chart`, q.rows)));
  for (const row of q.grid ?? [])
    section.append(
      h(
        "div",
        { class: "table-chart" },
        optionTable(`${q.label}: ${row.label} table`, row.rows),
        chart(`${q.label}: ${row.label} chart`, row.rows),
      ),
    );
  if (q.ranking)
    section.append(
      h(
        "table",
        { "aria-label": `${q.label} table`, class: "figures" },
        h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Option"), h("th", { scope: "col" }, "Mean position"))),
        h("tbody", {}, q.ranking.map((r) => h("tr", {}, h("th", { scope: "row" }, r.label), h("td", {}, r.mean_position ?? "")))),
      ),
    );
  if (q.mean !== undefined && q.mean !== null)
    section.append(
      h("p", { class: "figures" }, M.mean(q.mean)),
      h("p", { class: "figures" }, M.lowest(q.lowest ?? "")),
      h("p", { class: "figures" }, M.highest(q.highest ?? "")),
    );
  section.addEventListener("pointerenter", () => lightSection(section));
  section.addEventListener("focusin", () => lightSection(section));
  return section;
}

function lightSection(section: HTMLElement): void {
  for (const other of document.querySelectorAll(".summary-question")) other.classList.toggle("lit", other === section);
}

export async function summaryPage(formId: string): Promise<void> {
  const { main, stateBadge } = ownerPage(formId, "summary");
  main.append(loadingMap());
  const [info, first] = await Promise.all([formInfo(formId), api<Summary>("GET", `/api/forms/${formId}/summary`)]);
  if (!info || !first.ok) {
    notFoundPage();
    return;
  }
  main.removeAttribute("aria-busy");
  setFormState(stateBadge, info.state);
  const count = h("p", { id: "response-count", class: "figures count" });
  const liveStatus = h("p", { id: "live-status", class: "muted" });
  const sections = h("div", { class: "summary-sections" });
  clear(main, h("h1", {}, `${info.title} summary`), stateBadge, count, liveStatus, sections);
  setTitle(`Summary - ${info.title}`);
  let shownCount = -1;
  const render = (summary: Summary): void => {
    const total = Number(summary.count);
    count.textContent = M.responseCount(total);
    if (shownCount !== -1 && shownCount !== total) announce(M.responseCount(total));
    shownCount = total;
    const litKey = sections.querySelector<HTMLElement>(".summary-question.lit")?.getAttribute("aria-label");
    clear(sections, total === 0 ? h("p", { class: "empty-state" }, M.noResponses) : null, summary.questions.map((q) => summarySection(q, total)));
    const toLight = [...sections.querySelectorAll<HTMLElement>(".summary-question")].find((s) => s.getAttribute("aria-label") === litKey) ?? sections.querySelector<HTMLElement>(".summary-question");
    if (toLight) lightSection(toLight);
  };
  render(first.data);
  connectLive({ form: formId, view: "summary" }, (message) => {
    if (message.type === "summary") render(message.summary as Summary);
    if (message.type === "form_state") setFormState(stateBadge, message.state as FormState);
    if (message.type === "joined" || message.type === "live") liveStatus.textContent = (message.live ?? message.up) === false ? M.summaryPaused : "";
  });
}

/* ---------- Responses ---------- */

interface ResponseLine {
  id: string;
  reference: string;
  submitted_at: string;
  edition: number;
}

export async function responsesPage(formId: string): Promise<void> {
  const { main, stateBadge } = ownerPage(formId, "responses");
  main.append(loadingMap());
  const [info, list] = await Promise.all([formInfo(formId), api<{ responses: ResponseLine[] }>("GET", `/api/forms/${formId}/responses`)]);
  if (!info || !list.ok) {
    notFoundPage();
    return;
  }
  main.removeAttribute("aria-busy");
  setFormState(stateBadge, info.state);
  const exportButton = h("button", { type: "button" }, "Export CSV");
  const exportArea = h("p", { class: "export-area" });
  const tbody = h("tbody", {});
  const empty = h("p", { class: "empty-state" }, M.noResponses);
  const table = h(
    "table",
    { "aria-label": "Responses", class: "responses-table figures" },
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Reference"), h("th", { scope: "col" }, "Submitted"), h("th", { scope: "col" }, "Edition"))),
    tbody,
  );
  const sync = (): void => {
    empty.hidden = tbody.children.length > 0;
  };
  for (const r of list.data.responses) {
    const referenceCell = h("div", { class: "reference-cell" }, h("a", { href: `/forms/${formId}/responses/${r.id}`, "aria-label": `Open response ${r.reference}` }, r.reference));
    const row = h("tr", {}, h("td", {}, referenceCell), h("td", {}, localTimeText(r.submitted_at)), h("td", {}, String(r.edition)));
    if (info.role === "owner") {
      const remove = h("button", { type: "button", class: "quiet", "aria-label": `Delete response ${r.reference}` }, "Delete");
      remove.addEventListener("click", () => {
        const dialog = openDialog(
          { title: "Delete response", opener: remove },
          h("p", {}, `Response ${r.reference} will be removed from every count.`),
          h(
            "div",
            { class: "actions" },
            h("button", {
              type: "button",
              class: "danger",
              onclick: async () => {
                const result = await api("DELETE", `/api/forms/${formId}/responses/${r.id}`);
                if (!result.ok) {
                  alertText(result.error?.message ?? "");
                  return;
                }
                const next = (row.nextElementSibling ?? row.previousElementSibling)?.querySelector<HTMLElement>("button, a");
                row.remove();
                sync();
                dialog.close();
                (next ?? exportButton).focus();
                announce(M.responseDeleted);
              },
            }, "Delete"),
            h("button", { type: "button", onclick: () => dialog.close() }, "Cancel"),
          ),
        );
        focusFirst(dialog);
      });
      referenceCell.append(remove);
    }
    tbody.append(row);
  }
  exportButton.addEventListener("click", async () => {
    const result = await api<{ responses: number; url: string }>("POST", `/api/forms/${formId}/exports`, {});
    if (!result.ok) {
      clear(exportArea, h("span", { class: "error-text" }, result.error?.message ?? M.exportFailed));
      alertText(result.error?.message ?? M.exportFailed);
      return;
    }
    clear(exportArea, h("a", { href: result.data.url, download: `${info.slug}-responses.csv` }, "Download CSV"));
    announce(M.exportReady(result.data.responses));
  });
  sync();
  clear(main, h("h1", {}, `${info.title} responses`), stateBadge, exportButton, exportArea, table, empty);
  setTitle(`Responses - ${info.title}`);
}

export async function responseView(formId: string, responseId: string): Promise<void> {
  const { main, stateBadge } = ownerPage(formId, "responses");
  main.append(loadingMap());
  const [info, result] = await Promise.all([
    formInfo(formId),
    api<{
      reference: string;
      edition: number;
      items: { key: string; label: string; text: string; note?: string }[];
      files: { key: string; name: string; url: string }[];
    }>("GET", `/api/forms/${formId}/responses/${responseId}`),
  ]);
  if (!info || !result.ok) {
    notFoundPage();
    return;
  }
  main.removeAttribute("aria-busy");
  setFormState(stateBadge, info.state);
  const r = result.data;
  clear(
    main,
    h("h1", {}, `Response ${r.reference}`),
    stateBadge,
    h("p", { class: "muted" }, `Edition ${r.edition}`),
    h(
      "div",
      { class: "answers" },
      r.items.map((item) => {
        const file = r.files.find((f) => f.key === item.key);
        return h(
          "div",
          { class: "answer-block", "data-key": item.key },
          h("p", { class: "answer-label" }, item.label),
          file ? h("p", {}, h("a", { href: file.url, download: file.name }, `Download ${file.name}`)) : h("p", { class: "answer-text" }, item.text),
          item.note ? h("p", { class: "muted note" }, `Note: ${item.note}`) : null,
        );
      }),
    ),
  );
  setTitle(`Response ${r.reference} - ${info.title}`);
}

/* ---------- Editions ---------- */

export async function editionsPage(formId: string): Promise<void> {
  const { main, stateBadge } = ownerPage(formId, "editions");
  main.append(loadingMap());
  const [info, result] = await Promise.all([formInfo(formId), api<{ editions: { number: number; published_at: string }[] }>("GET", `/api/forms/${formId}/editions`)]);
  if (!info || !result.ok) {
    notFoundPage();
    return;
  }
  main.removeAttribute("aria-busy");
  setFormState(stateBadge, info.state);
  clear(
    main,
    h("h1", {}, `${info.title} editions`),
    stateBadge,
    result.data.editions.length
      ? h(
          "ul",
          { class: "form-list" },
          result.data.editions.map((e) =>
            h("li", {}, h("a", { href: `/forms/${formId}/editions/${e.number}` }, `Edition ${e.number}`), h("span", { class: "muted" }, `Published ${localTimeText(e.published_at)}`)),
          ),
        )
      : h("p", { class: "empty-state" }, "No editions yet. Publish the form to make edition 1."),
  );
  setTitle(`Editions - ${info.title}`);
}

export async function editionView(formId: string, number: number): Promise<void> {
  const { main, stateBadge } = ownerPage(formId, "editions");
  main.append(loadingMap());
  const [info, result] = await Promise.all([
    formInfo(formId),
    api<{ number: number; published_at: string; definition: Definition }>("GET", `/api/forms/${formId}/editions/${number}`),
  ]);
  if (!info || !result.ok) {
    notFoundPage();
    return;
  }
  main.removeAttribute("aria-busy");
  setFormState(stateBadge, info.state);
  const def = result.data.definition;
  clear(
    main,
    h("h1", {}, `Edition ${number}`),
    stateBadge,
    h("p", { class: "muted" }, `Published ${localTimeText(result.data.published_at)}`),
    def.pages.map((p) =>
      h(
        "section",
        { class: "edition-page", "aria-label": p.title },
        h("h2", {}, p.title),
        h("ul", {}, p.questions.map((q) => h("li", {}, h("span", {}, q.label), h("span", { class: "muted" }, ` ${q.key}, ${q.type.replace("_", " ")}`)))),
      ),
    ),
  );
  setTitle(`Edition ${number} - ${info.title}`);
}
