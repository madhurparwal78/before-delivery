import { api, centsToMoney } from "../api.js";
import { clear, el } from "../util.js";
import { announce } from "../live.js";
const kindLabels = {
    carried_forward: "Carried forward",
    top_up: "Top-up",
    pledge_charge: "Pledge charge",
    short_credit: "Short credit",
    take_up_charge: "Take up",
};
/** The credit history screen: newest movements first, paged and stable. */
export async function renderCreditHistory(page, me) {
    const code = me.household_code;
    const figures = el("div", { class: "credit-figures", role: "region", "aria-label": "Credit" });
    const tableWrap = el("div");
    const loadMoreWrap = el("div", { class: "actions" });
    page.append(el("h1", { text: "Credit history" }), el("p", { class: "label", text: `HOUSEHOLD ${me.name}` }), figures, tableWrap, loadMoreWrap);
    const rows = [];
    let cursor = null;
    const figure = (label, value) => el("div", { class: "figure" }, el("span", { class: "label", text: label }), el("span", { class: "value", text: value }));
    const drawFigures = (p) => {
        clear(figures);
        figures.append(figure("BALANCE", centsToMoney(p.balance_cents)), figure("HELD", centsToMoney(p.held_cents)), figure("SPENDABLE", centsToMoney(p.spendable_cents)));
    };
    const drawTable = () => {
        clear(tableWrap);
        const table = el("table", {
            class: "data credit-history",
            "aria-label": "Credit history",
            tabindex: "0",
        });
        const thead = el("thead", {}, el("tr", {}, el("th", { text: "DATE" }), el("th", { text: "KIND" }), el("th", { text: "MEMO" }), el("th", { text: "AMOUNT" })));
        const tbody = el("tbody");
        for (const m of rows) {
            const householdLeg = m.legs.find((l) => l.account.startsWith("household:"));
            const amount = householdLeg ? householdLeg.amount_cents : 0;
            const date = new Date(m.created_at);
            const dateText = `${date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}, ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
            tbody.append(el("tr", {}, el("td", { "data-col": "DATE", text: dateText }), el("td", { "data-col": "KIND", text: kindLabels[m.kind] ?? m.kind }), el("td", { "data-col": "MEMO", text: m.memo }), el("td", { "data-col": "AMOUNT", text: centsToMoney(amount) })));
        }
        table.append(thead, tbody);
        tableWrap.append(table);
        return table;
    };
    const drawLoadMore = () => {
        clear(loadMoreWrap);
        if (cursor === null)
            return;
        const btn = el("button", { text: "Show older movements" });
        btn.addEventListener("click", async () => {
            btn.setAttribute("disabled", "");
            btn.textContent = "Loading...";
            try {
                const { data } = await api(`/api/households/${encodeURIComponent(code)}/ledger?limit=20&before=${encodeURIComponent(cursor)}`);
                cursor = data.next_before;
                for (const m of data.movements)
                    rows.push(m);
                drawFigures(data);
                drawTable();
                announce("credit", `Showing ${rows.length} of ${data.total_movements} movements.`);
                if (cursor === null) {
                    clear(loadMoreWrap);
                    tableWrap.querySelector("table").focus();
                }
                else {
                    drawLoadMore();
                    btn.removeAttribute("disabled");
                    btn.textContent = "Show older movements";
                    btn.focus();
                }
            }
            catch {
                btn.removeAttribute("disabled");
                btn.textContent = "Show older movements";
                announce("credit", "Couldn't load older movements. Try again.");
            }
        });
        loadMoreWrap.append(btn);
    };
    const { data } = await api(`/api/households/${encodeURIComponent(code)}/ledger?limit=20`);
    cursor = data.next_before;
    for (const m of data.movements)
        rows.push(m);
    drawFigures(data);
    drawTable();
    drawLoadMore();
}
