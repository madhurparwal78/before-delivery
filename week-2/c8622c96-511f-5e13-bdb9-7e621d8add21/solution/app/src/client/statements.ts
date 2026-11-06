// Statements (treasurer): run a closed month's royalty statement and record payouts.
import { coopMonth } from "../shared/coop-time.js";
import { dollars, percent } from "../shared/money.js";
import { attempt, call, failureText } from "./api.js";
import { h, icon, replace, say } from "./dom.js";
import { badge, dataTable, emptyNote, mono, pageHead, statusLine } from "./ui.js";

interface Statement {
  month: string;
  lines: { licence_id: string; essay_title: string; newsroom: { name: string }; confirmed_display: string; amount_minor: number;
    rate_bp: number; commission_minor: number; shares: { name: string; split_bp: number; amount_minor: number }[] }[];
  totals: { invoiced_minor: number; commission_minor: number; contributors: { handle: string; name: string; amount_minor: number }[] };
  payouts: { handle: string; amount_minor: number; state: "queued" | "recorded" }[];
}

export function mountStatements(root: HTMLElement): () => void {
  const status = statusLine("Statement status");
  const month = h("input", { id: "statement-month", type: "text", inputmode: "numeric", placeholder: "YYYY-MM", autocomplete: "off" });
  const monthError = h("p", { class: "field-error", id: "statement-month-error", hidden: true });
  const run = h("button", { type: "submit", class: "button button-primary" }, "Run statement");
  const form = h("form", { class: "inline-form", "aria-label": "Run a royalty statement", novalidate: true },
    h("div", { class: "field" }, h("label", { for: "statement-month" }, "Statement month"), month, monthError),
    h("div", { class: "field field-action" }, run));
  const body = h("div", {});
  replace(root, pageHead("Statements", "One royalty statement per closed co-op month. Every line splits its invoice exactly."),
    form, status, body);
  let current: Statement | null = null;
  let poll = 0;

  function render(statement: Statement): void {
    current = statement;
    const names = new Map(statement.totals.contributors.map((c) => [c.handle, c.name]));
    const record = h("button", { type: "button", class: "button button-primary" }, icon("check"), "Record payouts");
    record.addEventListener("click", () => void recordPayouts(record));
    replace(body,
      h("h2", { class: "section-title" }, `Statement · ${coopMonth(statement.month)}`),
      statement.lines.length ? dataTable("Statement lines",
        ["Licence", "Essay", "Newsroom", "Confirmed", "Amount", "Rate", "Commission", "Shares"],
        statement.lines.map((line) => [mono(line.licence_id), line.essay_title, line.newsroom.name, mono(line.confirmed_display),
          mono(dollars(line.amount_minor)), mono(`${percent(line.rate_bp)}%`), mono(dollars(line.commission_minor)),
          h("ul", { class: "share-list" }, ...line.shares.map((s) => h("li", {}, `${s.name} `,
            mono(`${percent(s.split_bp)}% · ${dollars(s.amount_minor)}`))))]), [4, 5, 6])
        : emptyNote("No invoiced licences were confirmed in this month."),
      h("dl", { class: "statement-totals" },
        h("dt", {}, "Invoiced"), h("dd", {}, mono(dollars(statement.totals.invoiced_minor))),
        h("dt", {}, "Commission"), h("dd", {}, mono(dollars(statement.totals.commission_minor))),
        ...statement.totals.contributors.flatMap((c) => [h("dt", {}, c.name), h("dd", {}, mono(dollars(c.amount_minor)))])),
      h("div", { class: "section-row" }, h("h2", { class: "section-title" }, "Payouts"), record),
      statement.payouts.length ? dataTable("Payouts", ["Contributor", "Amount", "State"], statement.payouts.map((p) =>
        [names.get(p.handle) ?? p.handle, mono(dollars(p.amount_minor)),
          badge(p.state === "recorded" ? "Recorded" : "Queued", p.state === "recorded" ? "granted" : "pending")]), [1])
        : h("p", { class: "item-meta" }, "No payouts recorded for this month yet."));
    window.clearTimeout(poll);
    if (statement.payouts.some((p) => p.state === "queued")) poll = window.setTimeout(() => void reload(), 5000);
  }

  async function reload(): Promise<void> {
    if (!current) return;
    const answer = await attempt(() => call<Statement>("GET", `/api/royalty-statements/${current?.month ?? ""}`));
    if (answer?.ok && answer.data) render(answer.data);
  }

  async function recordPayouts(button: HTMLButtonElement): Promise<void> {
    if (!current) return;
    button.disabled = true;
    const answer = await attempt(() => call<Statement>("POST", `/api/royalty-statements/${current?.month ?? ""}/payouts`, {}));
    button.disabled = false;
    if (!answer?.ok || !answer.data) {
      say(status, failureText(answer));
      return;
    }
    const queued = answer.data.payouts.filter((p) => p.state === "queued").length;
    say(status, queued ? `${queued} payouts queued — billing is unreachable; they are recorded automatically when it returns.`
      : "Payouts recorded.");
    render(answer.data);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      monthError.hidden = true;
      month.removeAttribute("aria-describedby");
      run.disabled = true;
      const answer = await attempt(() => call<Statement>("POST", "/api/royalty-statements", { month: month.value.trim() }));
      run.disabled = false;
      if (answer?.ok && answer.data) {
        say(status, `Statement for ${coopMonth(answer.data.month)} ready.`);
        render(answer.data);
        return;
      }
      const message = answer?.error?.fields?.month;
      if (message) {
        monthError.hidden = false;
        monthError.textContent = message;
        month.setAttribute("aria-describedby", monthError.id);
        month.focus();
      } else say(status, failureText(answer));
    })();
  });

  return () => window.clearTimeout(poll);
}
