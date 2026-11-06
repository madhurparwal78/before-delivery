// The desk editor's review queue and All essays screen, and the treasurer's
// Rates and Statements screens.
import { el, clear, percent, dollarsPlain, money, monthName } from "./dom.js";
import { api, errorOf } from "./api.js";

interface DeskEssay {
  id: string;
  version: number;
  title: string;
  caption: string;
  state: string;
  lift_display: string;
  credits: { handle: string; name: string; position: number; split_bp: number }[];
  frames: { id: string; position: number; caption: string; grid_url: string }[];
  exclusive_days: number;
  standard_days: number;
  exclusive_price_minor: number;
  standard_price_minor: number;
  withdrawal_requested?: boolean;
}

const STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  embargoed: "Embargoed",
  live: "Live",
  withdrawn: "Withdrawn",
  taken_down: "Taken down",
};

export async function renderReviewQueue(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Review queue" }));
  const status = el("div", { id: "desk-status", class: "status", role: "status", "aria-label": "Desk status" });
  const result = await api.get<{ essays: DeskEssay[]; withdrawal_requests: DeskEssay[] }>("/api/desk/queue");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(status, el("div", { class: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const data = result.body as { essays: DeskEssay[]; withdrawal_requests: DeskEssay[] };

  const queue = el("ul", { class: "review-list", role: "list", "aria-label": "Review queue" });
  for (const essay of data.essays) {
    queue.append(reviewCard(essay, status));
  }
  const withdrawals = el("ul", { class: "review-list", role: "list", "aria-label": "Withdrawal requests" });
  for (const essay of data.withdrawal_requests) {
    const carry = el("button", { class: "btn", type: "button", text: "Carry out withdrawal", "aria-label": `Carry out withdrawal of ${essay.title}` }) as HTMLButtonElement;
    carry.addEventListener("click", async () => {
      status.textContent = "Withdrawal carried out.";
      await api.post(`/api/essays/${essay.id}/withdraw`, {});
      void renderReviewQueue(main);
    });
    withdrawals.append(el("li", { class: "card" },
      el("div", { class: "card-title", text: essay.title }),
      el("div", { class: "mono dim", text: essay.lift_display }),
      carry,
    ));
  }
  main.append(status, el("h2", { class: "display", text: "In review" }), queue, el("h2", { class: "display", text: "Withdrawal requests" }), withdrawals);
}

function reviewCard(essay: DeskEssay, status: HTMLElement): HTMLElement {
  const publish = el("button", { class: "btn primary", type: "button", text: "Publish", "aria-label": `Publish ${essay.title}` }) as HTMLButtonElement;
  publish.addEventListener("click", async () => {
    status.textContent = "Publishing…";
    const result = await api.post(`/api/essays/${essay.id}/publish`, {});
    if (result.status === 200) {
      status.textContent = "Published.";
      publish.closest("li")?.remove();
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });

  const card = el("li", { class: "card review-card" },
    el("div", { class: "card-title display", text: essay.title }),
    el("div", { class: "dim", text: essay.caption }),
    el("div", { class: "strip" }, ...essay.frames.map((f) => el("img", { class: "strip-thumb", src: f.grid_url, alt: "" }))),
    el("div", { class: "mono dim", text: essay.credits.map((c) => `${c.name} ${percent(c.split_bp)}%`).join(" · ") }),
    el("div", { class: "mono dim", text: `Lifts ${essay.lift_display} · Exclusive ${essay.exclusive_days}d ${money(essay.exclusive_price_minor)} · Standard ${essay.standard_days}d ${money(essay.standard_price_minor)}` }),
    el("div", { class: "card-actions" }, publish),
  );
  publish.addEventListener("click", () => undefined);
  return card;
}

export async function renderAllEssays(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "All essays" }));
  const status = el("div", { class: "status", role: "status", "aria-label": "Desk status" });
  const result = await api.get<{ essays: DeskEssay[] }>("/api/desk/essays");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(el("div", { class: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const essays = (result.body as { essays: DeskEssay[] }).essays;
  const table = el("table", { class: "table", "aria-label": "All essays" },
    el("thead", {}, el("tr", {}, el("th", { text: "Essay" }), el("th", { text: "State" }), el("th", { text: "" }))),
  );
  const tbody = el("tbody", {});
  for (const essay of essays) {
    const row = el("tr", {},
      el("td", { text: essay.title }),
      el("td", { text: STATE_LABELS[essay.state] ?? essay.state }),
      el("td", {}),
    );
    if (essay.state === "embargoed" || essay.state === "live" || essay.state === "withdrawn") {
      const btn = el("button", { class: "btn danger", type: "button", text: "Legal takedown", "aria-label": `Legal takedown for ${essay.title}` }) as HTMLButtonElement;
      btn.addEventListener("click", () => openTakedown(essay, status, btn));
      (row.lastChild as HTMLElement).append(btn);
    }
    tbody.append(row);
  }
  table.append(tbody);
  main.append(status, table);
}

function openTakedown(essay: DeskEssay, status: HTMLElement, opener: HTMLElement): void {
  const reference = el("input", { class: "field", type: "text", "aria-label": "Legal reference" }) as HTMLInputElement;
  const confirmBox = el("input", { type: "checkbox", id: "takedown-confirm" }) as HTMLInputElement;
  const confirmLabel = el("label", { class: "label", for: "takedown-confirm", text: "I confirm this removes all imagery and revokes every licence" });
  const takeDown = el("button", { class: "btn danger", type: "button", text: "Take down essay", disabled: true }) as HTMLButtonElement;
  confirmBox.addEventListener("change", () => {
    takeDown.disabled = !confirmBox.checked;
  });
  takeDown.addEventListener("click", async () => {
    const result = await api.post(`/api/essays/${essay.id}/takedown`, { reference: reference.value });
    if (result.status === 200) {
      status.textContent = "Essay taken down. Licensees have been notified.";
      close();
      void renderAllEssays(mainFrom(opener));
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });
  const dialog = el("dialog", { class: "modal", "aria-label": "Legal takedown", role: "dialog" },
    el("h2", { class: "display", text: "Legal takedown" }),
    el("label", { class: "label", text: "Legal reference" }),
    reference,
    el("div", { class: "check-row" }, confirmBox, confirmLabel),
    takeDown,
  );
  dialog.setAttribute("aria-modal", "true");
  document.body.append(dialog);
  const close = (): void => {
    dialog.remove();
    document.removeEventListener("keydown", keydown);
    opener.focus();
  };
  const keydown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("keydown", keydown);
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  reference.focus();
}

function mainFrom(node: HTMLElement): HTMLElement {
  return (node.closest("main") as HTMLElement) ?? document.getElementById("main") as HTMLElement;
}

interface Rate {
  effective_from: string;
  rate_bp: number;
  status: string;
}

export async function renderRates(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Rates" }));
  const status = el("div", { id: "rate-status", class: "status", role: "status", "aria-label": "Rate status" });
  const result = await api.get<{ current: { effective_from: string; rate_bp: number } | null; rates: Rate[] }>("/api/commission-rates");
  if (result.status !== 200) {
    const err = errorOf(result);
    main.append(el("div", { class: "status", text: err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again." }));
    return;
  }
  const data = result.body as { current: { effective_from: string; rate_bp: number } | null; rates: Rate[] };
  const table = el("table", { class: "table", "aria-label": "Commission rates" },
    el("thead", {}, el("tr", {}, el("th", { text: "Effective from" }), el("th", { text: "Rate" }), el("th", { text: "Status" }))),
  );
  const tbody = el("tbody", {});
  for (const rate of data.rates) {
    const mark = rate.status === "current" ? "Current" : rate.status === "scheduled" ? "Scheduled" : "Past";
    tbody.append(el("tr", {},
      el("td", { class: "mono", text: coopDateText(rate.effective_from) }),
      el("td", { class: "mono", text: `${percent(rate.rate_bp)}%` }),
      el("td", { text: mark }),
    ));
  }
  table.append(tbody);

  const effectiveFrom = el("input", { class: "field mono", type: "text", placeholder: "YYYY-MM-DD", "aria-label": "Effective from (co-op date)" }) as HTMLInputElement;
  const rateInput = el("input", { class: "field mono", type: "text", placeholder: "25.00", "aria-label": "Rate (percent)" }) as HTMLInputElement;
  const schedule = el("button", { class: "btn primary", type: "submit", text: "Schedule rate", "aria-label": "Schedule rate" }) as HTMLButtonElement;
  const form = el("form", { class: "rate-form" },
    el("label", { class: "label", text: "Effective from (co-op date)" }), effectiveFrom,
    el("label", { class: "label", text: "Rate (percent)" }), rateInput,
    schedule,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rateBp = Math.round(Number(rateInput.value) * 100);
    const result = await api.post("/api/commission-rates", { effective_from: effectiveFrom.value.trim(), rate_bp: rateBp });
    if (result.status === 201) {
      status.textContent = `Rate of ${rateInput.value}% scheduled from ${coopDateText(effectiveFrom.value.trim())}.`;
      void renderRates(main);
    } else {
      const err = errorOf(result);
      const fieldError = err?.fields?.effective_from ?? err?.fields?.rate_bp;
      status.textContent = fieldError ?? err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });
  main.append(status, table, el("h2", { class: "display", text: "Schedule a rate" }), form);
}

function coopDateText(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(Date.parse(`${date}T06:00:00Z`));
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${weekdays[d.getUTCDay()]} ${Number(m[3])} ${names[Number(m[2]) - 1]} ${m[1]}`;
}

interface Statement {
  month: string;
  lines: { licence_id: string; essay_title: string; newsroom: { name: string }; confirmed_display: string; amount_minor: number; rate_bp: number; commission_minor: number; shares: { handle: string; name: string; split_bp: number; amount_minor: number }[] }[];
  totals: { invoiced_minor: number; commission_minor: number; contributors: { handle: string; name: string; amount_minor: number }[] };
  payouts: { handle: string; amount_minor: number; state: string }[];
}

export async function renderStatements(main: HTMLElement): Promise<void> {
  clear(main);
  main.append(el("h1", { class: "display", text: "Statements" }));
  const status = el("div", { id: "statement-status", class: "status", role: "status", "aria-label": "Statement status" });
  const monthInput = el("input", { class: "field mono", type: "text", placeholder: "YYYY-MM", "aria-label": "Statement month" }) as HTMLInputElement;
  const run = el("button", { class: "btn primary", type: "button", text: "Run statement", "aria-label": "Run statement" }) as HTMLButtonElement;
  const linesTable = el("table", { class: "table", "aria-label": "Statement lines" },
    el("thead", {}, el("tr", {}, el("th", { text: "Licence" }), el("th", { text: "Essay" }), el("th", { text: "Newsroom" }), el("th", { text: "Confirmed" }), el("th", { text: "Amount" }), el("th", { text: "Rate" }), el("th", { text: "Commission" }), el("th", { text: "Shares" }))),
  );
  const linesBody = el("tbody", {});
  linesTable.append(linesBody);
  const payoutsTable = el("table", { class: "table", "aria-label": "Payouts" },
    el("thead", {}, el("tr", {}, el("th", { text: "Contributor" }), el("th", { text: "State" }))),
  );
  const payoutsBody = el("tbody", {});
  payoutsTable.append(payoutsBody);
  const recordPayouts = el("button", { class: "btn", type: "button", text: "Record payouts", "aria-label": "Record payouts" }) as HTMLButtonElement;

  const paint = (statement: Statement): void => {
    clear(linesBody);
    for (const line of statement.lines) {
      linesBody.append(el("tr", {},
        el("td", { class: "mono", text: line.licence_id }),
        el("td", { text: line.essay_title }),
        el("td", { text: line.newsroom.name }),
        el("td", { class: "mono", text: line.confirmed_display }),
        el("td", { class: "mono", text: money(line.amount_minor) }),
        el("td", { class: "mono", text: `${percent(line.rate_bp)}%` }),
        el("td", { class: "mono", text: money(line.commission_minor) }),
        el("td", { class: "mono", text: line.shares.map((s) => `${s.name} ${percent(s.split_bp)}% ${money(s.amount_minor)}`).join(" · ") }),
      ));
    }
    clear(payoutsBody);
    for (const payout of statement.payouts) {
      payoutsBody.append(el("tr", {},
        el("td", { text: payout.handle }),
        el("td", { text: payout.state === "recorded" ? "Recorded" : "Queued" }),
      ));
    }
    const totalsNode = document.getElementById("statement-totals");
    if (totalsNode) totalsNode.textContent = `Invoiced ${money(statement.totals.invoiced_minor)} · Commission ${money(statement.totals.commission_minor)}`;
  };

  const runStatement = async (): Promise<void> => {
    const result = await api.post<Statement>("/api/royalty-statements", { month: monthInput.value.trim() });
    if (result.status === 201 || result.status === 200) {
      const statement = result.body as Statement;
      status.textContent = `Statement for ${monthName(statement.month)} ready.`;
      paint(statement);
    } else {
      const err = errorOf(result);
      status.textContent = err?.fields?.month ?? err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  };
  run.addEventListener("click", runStatement);

  recordPayouts.addEventListener("click", async () => {
    const result = await api.post<Statement>(`/api/royalty-statements/${monthInput.value.trim()}/payouts`, {});
    if (result.status === 200 || result.status === 202) {
      const statement = result.body as Statement;
      const queued = statement.payouts.filter((p) => p.state !== "recorded").length;
      status.textContent = queued > 0
        ? `${queued} payouts queued — billing is unreachable; they are recorded automatically when it returns.`
        : "Payouts recorded.";
      paint(statement);
    } else {
      const err = errorOf(result);
      status.textContent = err?.message ?? "Couldn't reach Saltprint Desk. Nothing was changed; try again.";
    }
  });

  main.append(status,
    el("div", { class: "run-row" }, monthInput, run),
    el("h2", { class: "display", text: "Statement lines" }),
    linesTable,
    el("div", { class: "totals mono", id: "statement-totals", text: "" }),
    el("h2", { class: "display", text: "Payouts" }),
    recordPayouts,
    payoutsTable,
  );
}
