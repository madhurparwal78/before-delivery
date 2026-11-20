/* Bank carer screens: open cover and holiday accrual. */

function coverScreen(container) {
  container.append(h("h1", { text: "Open cover" }));
  const status = statusLine("Cover status");
  const list = h("ul", { class: "stack", "aria-label": "Open cover shifts" });
  container.append(status, list);

  const pendingClaims = new Map();

  async function load() {
    let data;
    try { data = await api.get("/api/cover-shifts"); } catch (err) { return; }
    clear(list);
    if (!data.items.length) {
      list.append(h("li", {}, h("p", { class: "muted", text: "No open cover shifts right now." })));
      return;
    }
    for (const cover of data.items) {
      const label = `${formatDateLabel(cover.date)} ${shiftWord(cover.shift)}`;
      const button = h("button", { class: "btn", text: `Claim ${label} at ${cover.home.name}` });
      button.addEventListener("click", () => claim(cover, button));
      list.append(h("li", { class: "panel link-row" },
        h("div", {},
          h("p", {}, h("strong", { text: `${cover.home.name}, ${cover.unit.name}` })),
          h("p", { class: "num", text: `${label} · ${hmOf(cover.starts_at)}–${hmOf(cover.ends_at)}` }),
          h("p", { text: `Skill ${cover.skill === "senior" ? "Senior" : "Carer"}` })),
        h("div", {}, button)));
    }
  }

  async function claim(cover, button) {
    if (pendingClaims.has(cover.id)) return;
    const key = crypto.randomUUID();
    const state = { key, done: false };
    pendingClaims.set(cover.id, state);
    button.disabled = true;
    setStatus(status, "Claiming…");
    let attempt = 0;
    let shown = false;
    while (true) {
      try {
        const result = await api.call("POST", `/api/cover-shifts/${cover.id}/claim`, {},
          { "Idempotency-Key": key });
        if (!shown) {
          const label = `${formatDateLabel(cover.date)} ${shiftWord(cover.shift)}`;
          setStatus(status, `Shift claimed: ${label} at ${cover.home.name}.`);
          shown = true;
          await load();
        }
        break;
      } catch (err) {
        if (err.offline && attempt < 3) { attempt += 1; await new Promise((r) => setTimeout(r, 600)); continue; }
        setStatus(status, err.message);
        if (err.body && (err.body.error === "already_taken" || err.body.error === "cover_closed")) {
          await load();
        }
        break;
      }
    }
    pendingClaims.delete(cover.id);
  }

  load();
  every(60, load);
}

function accrualScreen(container) {
  container.append(h("h1", { text: "Holiday accrual" }));
  const status = statusLine("Accrual status");
  container.append(status);
  const host = h("div", {});
  container.append(host);

  async function load() {
    let data;
    try { data = await api.get("/api/me/accrual"); } catch (err) { return; }
    clear(host);
    host.append(h("section", { class: "panel", "aria-label": "Holiday accrual" },
      h("p", { class: "num", text: `Pending this period: ${data.open_period.pending_accrual_hours} hours from ${data.open_period.worked_hours} worked` }),
      h("p", { class: "num", text: `Total accrued: ${data.ledger_total_hours} hours` })));
    const table = h("table", { class: "data", "aria-label": "Accrual ledger" },
      h("thead", {}, h("tr", {},
        h("th", { text: "Period" }), h("th", { text: "Kind" }),
        h("th", { text: "Worked hours" }), h("th", { text: "Accrued hours" }))));
    const body = h("tbody", {});
    if (!data.entries.length) {
      host.append(h("p", { class: "muted", text: "No closed pay periods yet." }));
    } else {
      for (const entry of data.entries) {
        body.append(h("tr", { class: "hairline-row" },
          h("td", { text: entry.period, "data-label": "Period" }),
          h("td", { text: entry.kind, "data-label": "Kind" }),
          h("td", { class: "num", text: entry.worked_hours, "data-label": "Worked hours" }),
          h("td", { class: "num", text: entry.accrued_hours, "data-label": "Accrued hours" })));
      }
      table.append(body);
      host.append(table);
    }
  }
  load();
  every(60, load);
}
