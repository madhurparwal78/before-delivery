import { el } from "../ui.ts";
import { get } from "../api.ts";
import { amount } from "../format.ts";
import { state, navigate, signinLink } from "../app.ts";

interface SettlementLine {
  settlement_line_id: string; shipment_id: string; kind: string; posted_on: string;
  gross_paise: number; commission_percent: number; commission_paise: number;
  commission_gst_paise: number; tcs_paise: number; tds_paise: number;
  emi_subvention_paise: number; net_paise: number; status: string;
}

interface Totals {
  gross_paise: number; commission_paise: number; commission_gst_paise: number;
  tcs_paise: number; tds_paise: number; emi_subvention_paise: number; net_paise: number;
}

/** The statement reel rolls each line from zero as it crosses the middle of the screen. */
export async function renderSellerStatement(): Promise<HTMLElement> {
  const main = el("main", {});
  if (!state.account || state.account.role !== "seller") {
    void navigate(signinLink());
    main.append(el("div", { class: "panel-deep" }, el("p", { text: "sign in to your seller console." })));
    return main;
  }
  main.append(el("h1", { text: "settlement statement" }));
  const res = await get<{ lines: SettlementLine[]; totals: Totals }>("/api/seller/settlements");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const wrap = el("div", { class: "table-wrap", id: "statement-scroll" });
  const table = el("table", { "aria-label": "Settlement statement" });
  const thead = el("thead", {});
  const headRow = el("tr", {});
  for (const h of ["Date", "Kind", "Gross", "Commission", "GST on commission", "TCS", "TDS", "EMI subvention", "Net", "Status"]) {
    headRow.append(el("th", { text: h }));
  }
  thead.append(headRow);
  const tbody = el("tbody", {});

  const reelRows: Array<{ cell: HTMLElement; value: number }> = [];

  for (const line of res.lines) {
    const row = el("tr", {});
    row.append(
      el("td", { text: line.posted_on }),
      el("td", { text: line.kind }),
    );
    const moneyCell = (value: number, label: string) => {
      const cell = el("td", {});
      const span = el("span", { class: "statement-amount", "data-value": String(value), "aria-label": `${label} ${amount(value)}` });
      span.textContent = reducedMotion ? amount(value) : amount(0);
      if (!reducedMotion) reelRows.push({ cell: span, value });
      cell.append(span);
      return cell;
    };
    row.append(
      moneyCell(line.gross_paise, "gross"),
      moneyCell(line.commission_paise, "commission"),
      moneyCell(line.commission_gst_paise, "gst on commission"),
      moneyCell(line.tcs_paise, "tcs"),
      moneyCell(line.tds_paise, "tds"),
      moneyCell(line.emi_subvention_paise, "emi subvention"),
      moneyCell(line.net_paise, "net"),
      el("td", { text: line.status }),
    );
    tbody.append(row);
  }
  table.append(thead, tbody);
  wrap.append(table);

  const netGroup = el("div", { class: "panel-deep", role: "group", "aria-label": "Net payout", style: "margin-top:20px" });
  const netHeading = el("h2", { text: "net payout" });
  const netValue = el("p", { class: "payable-total", style: "font-family:var(--font-head);font-weight:900;font-size:2.6rem", text: amount(res.totals.net_paise) });
  netGroup.append(netHeading, netValue);
  netGroup.append(el("p", { text: `gross ${amount(res.totals.gross_paise)} − commission ${amount(res.totals.commission_paise)} − GST on commission ${amount(res.totals.commission_gst_paise)} − TCS ${amount(res.totals.tcs_paise)} − TDS ${amount(res.totals.tds_paise)}${res.totals.emi_subvention_paise ? ` − EMI subvention ${amount(res.totals.emi_subvention_paise)}` : ""}` }));

  main.append(wrap, netGroup);

  // roll each figure from zero as its line crosses the middle of the screen; back down on scroll back
  if (!reducedMotion && reelRows.length > 0) {
    let animated = new Set<HTMLElement>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const span = entry.target as HTMLElement;
        const value = Number(span.dataset.value ?? "0");
        if (entry.isIntersecting && !animated.has(span)) {
          animated.add(span);
          rollTo(span, value);
        } else if (!entry.isIntersecting && animated.has(span)) {
          animated.delete(span);
          span.textContent = amount(0);
        }
      }
    }, { root: null, rootMargin: "-40% 0px -40% 0px" });
    for (const r of reelRows) observer.observe(r.cell);
  }

  return main;
}

function rollTo(span: HTMLElement, value: number): void {
  const steps = 18;
  let i = 0;
  const tick = () => {
    i += 1;
    const progress = i / steps;
    const eased = 1 - Math.pow(1 - progress, 2);
    span.textContent = amount(Math.round(value * eased));
    if (i < steps) requestAnimationFrame(tick);
    else span.textContent = amount(value);
  };
  requestAnimationFrame(tick);
}
