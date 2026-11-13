/**
 * Alerts: the rules list with the recent cases row, the rule page with groups
 * (cards on phone with swipe to acknowledge), new rule and maintenance windows.
 */
import { addLiveHandler, announce, api, ApiFail, displayIso, showNotice } from "./api";
import { emptyBand, namedAlert } from "./shell";
import { openModal } from "./modals";
import { h } from "./core";
import type { CaseSummary } from "./cases";

interface GroupInfo {
  group: string;
  state: string;
  flapping: boolean;
  snoozed: boolean;
  snoozed_until: string | null;
  in_maintenance: boolean;
  acknowledged_by: string | null;
}

interface RuleInfo {
  id: string;
  name: string;
  stream: string;
  groups: GroupInfo[];
  last_check: { at: string; failed: boolean } | null;
  history: { at: string; from: string; to: string; group?: string }[];
}

function goTo(path: string): void {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** A group card with swipe-to-acknowledge on phone. */
function groupCard(rule: RuleInfo, g: GroupInfo): HTMLElement {
  const card = h("article", { class: "card" });
  card.style.touchAction = "pan-y";
  const label = [g.group, g.state];
  if (g.flapping) label.push("flapping");
  if (g.snoozed) label.push("snoozed");
  if (g.in_maintenance) label.push("in maintenance");
  card.setAttribute("aria-label", `Group ${label.join(", ")}`);
  const name = h("div", { class: "mono" }, g.group);
  name.style.fontWeight = "600";
  const stateEl = h("div", { class: "mono" }, g.state);
  stateEl.style.color =
    g.state === "active" ? "var(--critical)" :
    g.state === "pending" ? "var(--warning)" :
    g.state === "recovered" ? "var(--healthy)" :
    "var(--ink-2)";
  const actions = h("div", { style: { display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap" } });
  const ack = h("button", { class: "btn", "aria-label": "Acknowledge" }, "Acknowledge");
  const snooze = h("button", { class: "btn", "aria-label": "Snooze group" }, "Snooze");
  const addToCase = h("button", { class: "btn", "aria-label": "Add to case" }, "Add to case");
  actions.append(ack, snooze, addToCase);

  ack.addEventListener("click", async () => {
    await acknowledge(rule.id, g.group);
  });
  snooze.addEventListener("click", () => {
    openModal(
      (close) => {
        const box = h("div", {});
        box.append(h("h3", {}, "Snooze"));
        let choice = "1h";
        for (const [value, label] of [["1h", "For 1 hour"], ["1d", "For 1 day"], ["recovered", "Until recovered"]] as const) {
          const row = h("label", { style: { display: "block", padding: "6px 0" } });
          const rb = document.createElement("input");
          rb.type = "radio";
          rb.name = "snooze";
          rb.value = value;
          rb.setAttribute("aria-label", label);
          if (value === "1h") rb.checked = true;
          rb.addEventListener("change", () => {
            choice = value;
          });
          row.append(rb, document.createTextNode(" " + label));
          box.append(row);
        }
        const apply = h("button", { class: "btn-main" }, "Snooze");
        const cancel = h("button", { class: "btn" }, "Cancel");
        cancel.addEventListener("click", close);
        apply.addEventListener("click", async () => {
          try {
            await api(`/api/rules/${rule.id}/groups/${encodeURIComponent(g.group)}/snooze`, {
              method: "POST",
              body: JSON.stringify({ for: choice }),
              headers: { "Content-Type": "application/json" },
            });
            if (choice === "recovered") {
              showNotice(`Group ${g.group} snoozed until it recovers.`);
            } else {
              showNotice(`Group ${g.group} snoozed until ${displayIso("")}.`);
            }
            close();
          } catch (err) {
            if (err instanceof ApiFail) showNotice(err.body.message);
          }
        });
        const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
        row.append(apply, cancel);
        box.append(row);
        return box;
      },
      snooze,
      "Snooze",
    );
  });
  addToCase.addEventListener("click", () => {
    openAddToCase(
      {
        rule: rule.id,
        group: g.group,
      },
      addToCase,
    );
  });

  card.append(name, stateEl, actions);

  // Swipe to acknowledge on phone
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let swiping = false;
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    swiping = true;
    dx = 0;
    dy = 0;
  });
  card.addEventListener("touchmove", (e) => {
    if (!swiping) return;
    dx = e.touches[0].clientX - startX;
    dy = e.touches[0].clientY - startY;
    if (dx < 0) {
      card.style.transform = `translateX(${Math.max(dx, -160)}px)`;
      e.preventDefault();
    }
  });
  card.addEventListener("touchend", () => {
    if (!swiping) return;
    swiping = false;
    const moved = dx < -80 && Math.abs(dy) < 40;
    card.style.transform = "";
    if (moved) {
      void acknowledge(rule.id, g.group);
    } else {
      // spring back
      card.style.transition = "transform 200ms ease-out";
      setTimeout(() => {
        card.style.transition = "";
      }, 200);
    }
  });

  return card;
}

async function acknowledge(ruleId: string, group: string): Promise<void> {
  try {
    await api(`/api/rules/${ruleId}/groups/${encodeURIComponent(group)}/ack`, { method: "POST" });
    announce(`Acknowledged Group ${group}`);
  } catch (err) {
    if (err instanceof ApiFail) showNotice(err.body.message);
  }
}

function openAddToCase(body: Record<string, unknown>, opener: HTMLElement): void {
  openModal(
    (close) => {
      const box = h("div", {});
      box.append(h("h3", {}, "Add to case"));
      const combo = h("select", { class: "input", "aria-label": "Case" }) as HTMLSelectElement;
      const optionEls: { el: HTMLOptionElement; value: string }[] = [];
      void (async () => {
        try {
          const res = await api<{ cases: CaseSummary[] }>("/api/cases");
          for (const c of res.cases.filter((c) => c.status !== "closed")) {
            const o = document.createElement("option");
            o.value = String(c.number);
            o.textContent = `Case ${c.number}: ${c.title}`;
            combo.append(o);
            optionEls.push({ el: o, value: String(c.number) });
          }
          const newOption = document.createElement("option");
          newOption.value = "new";
          newOption.textContent = "New case";
          combo.append(newOption);
        } catch {
          const newOption = document.createElement("option");
          newOption.value = "new";
          newOption.textContent = "New case";
          combo.append(newOption);
        }
      })();
      const add = h("button", { class: "btn-main" }, "Add");
      const cancel = h("button", { class: "btn" }, "Cancel");
      cancel.addEventListener("click", close);
      add.addEventListener("click", async () => {
        add.setAttribute("aria-busy", "true");
        try {
          if (combo.value === "new") {
            const created = await api<{ number: number }>("/api/cases", {
              method: "POST",
              body: JSON.stringify({ title: `Case for ${String(body.group ?? "item")}` }),
              headers: { "Content-Type": "application/json" },
            });
            await api(`/api/cases/${created.number}/items`, {
              method: "POST",
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`Added to case ${created.number}.`);
            announce(`Case ${created.number} is now open`);
          } else {
            await api(`/api/cases/${combo.value}/items`, {
              method: "POST",
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            });
            showNotice(`Added to case ${combo.value}.`);
          }
          close();
        } catch (err) {
          if (err instanceof ApiFail) showNotice(err.body.message);
        } finally {
          add.removeAttribute("aria-busy");
        }
      });
      const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
      row.append(add, cancel);
      box.append(combo, row);
      return box;
    },
    opener,
    "Add to case",
  );
}

export function buildAlerts(view: HTMLElement): void {
  const recentCases = h("div", { role: "region", "aria-label": "Recent cases", class: "recent-cases" });
  recentCases.style.display = "flex";
  recentCases.style.gap = "10px";
  recentCases.style.flexWrap = "wrap";
  const holder = h("div", {});
  const bar = h("div", { style: { display: "flex", gap: "10px", margin: "10px 0" } });
  const newRule = document.createElement("a");
  newRule.href = "/alerts/new";
  newRule.textContent = "New rule";
  newRule.addEventListener("click", (e) => {
    e.preventDefault();
    goTo("/alerts/new");
  });
  const maintenanceLink = document.createElement("a");
  maintenanceLink.href = "/alerts/maintenance";
  maintenanceLink.textContent = "Maintenance windows";
  maintenanceLink.addEventListener("click", (e) => {
    e.preventDefault();
    goTo("/alerts/maintenance");
  });
  bar.append(newRule, maintenanceLink);

  async function loadCases(): Promise<void> {
    try {
      const res = await api<{ cases: CaseSummary[] }>("/api/cases");
      recentCases.replaceChildren();
      for (const c of res.cases.slice(0, 3)) {
        const card = h("div", { class: "card mono", "aria-label": `Case ${c.number}: ${c.title}, ${c.status}` });
        card.style.flex = "1";
        card.style.minWidth = "180px";
        card.textContent = `Case ${c.number}: ${c.title}, ${c.status}`;
        card.addEventListener("click", () => goTo(`/cases/${c.number}`));
        card.style.cursor = "pointer";
        recentCases.append(card);
      }
    } catch {
      recentCases.replaceChildren();
    }
  }

  async function loadRules(): Promise<void> {
    try {
      const res = await api<{ rules: RuleInfo[] }>("/api/rules");
      const table = h("table", {});
      table.setAttribute("aria-label", "Rules");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Name", "Stream", "Groups"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const r of res.rules) {
        const tr = h("tr", {});
        const a = document.createElement("a");
        a.href = `/alerts/${r.id}`;
        a.textContent = r.name;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          goTo(`/alerts/${r.id}`);
        });
        const td = h("td", {});
        td.append(a);
        tr.append(td, h("td", { class: "mono" }, String(r.stream)), h("td", { class: "mono" }, String(r.groups.length)));
        tbody.append(tr);
      }
      table.append(thead, tbody);
      holder.replaceChildren(table);
      if (res.rules.length === 0) {
        const link = document.createElement("a");
        link.href = "/alerts/new";
        link.textContent = "New rule";
        link.addEventListener("click", (e) => {
          e.preventDefault();
          goTo("/alerts/new");
        });
        holder.append(emptyBand("No alert rules yet.", link));
      }
    } catch {
      holder.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  }

  addLiveHandler("alert", () => void loadRules());
  addLiveHandler("case", () => void loadCases());

  view.append(recentCases, bar, holder);
  void loadCases();
  void loadRules();
}

export function buildRulePage(view: HTMLElement, ruleId: string): void {
  const statusEl = h("div", { role: "status", "aria-label": "Last check" });
  const groupsHolder = h("div", {});
  const historyHolder = h("div", {});
  const wrap = h("div", {});
  wrap.append(statusEl, groupsHolder, historyHolder);
  view.append(wrap);

  async function load(): Promise<void> {
    try {
      const rule = await api<RuleInfo>(`/api/rules/${ruleId}`);
      statusEl.textContent = rule.last_check
        ? rule.last_check.failed
          ? `Check failed at ${displayIso(rule.last_check.at)}: state kept.`
          : `Last check at ${displayIso(rule.last_check.at)}: ok`
        : "";
      groupsHolder.replaceChildren();
      const phone = window.innerWidth < 768;
      if (phone) {
        for (const g of rule.groups) groupsHolder.append(groupCard(rule, g));
      } else {
        const table = h("table", {});
        table.setAttribute("aria-label", "Groups");
        const thead = h("thead", {});
        const headRow = h("tr", {});
        for (const c of ["Group", "State", "Actions"]) headRow.append(h("th", {}, c));
        thead.append(headRow);
        const tbody = h("tbody", {});
        for (const g of rule.groups) {
          const tr = h("tr", {});
          const parts = [g.group, g.state];
          if (g.flapping) parts.push("flapping");
          if (g.snoozed) parts.push("snoozed");
          if (g.in_maintenance) parts.push("in maintenance");
          tr.setAttribute("aria-label", `Group ${parts.join(", ")}`);
          const ack = h("button", { class: "btn", "aria-label": "Acknowledge" }, "Acknowledge");
          const snooze = h("button", { class: "btn", "aria-label": "Snooze group" }, "Snooze");
          const addToCase = h("button", { class: "btn", "aria-label": "Add to case" }, "Add to case");
          ack.addEventListener("click", () => void acknowledge(rule.id, g.group));
          snooze.addEventListener("click", () => {
            const fake: RuleInfo = rule;
            const card = snooze;
            openSnoozeDialog(rule.id, g.group, card);
          });
          addToCase.addEventListener("click", () => openAddToCase({ rule: rule.id, group: g.group }, addToCase));
          const actions = h("td", {});
          actions.append(ack, snooze, addToCase);
          tr.append(h("td", { class: "mono" }, g.group), h("td", { class: "mono" }, g.state), actions);
          tbody.append(tr);
        }
        table.append(thead, tbody);
        groupsHolder.append(table);
      }
      const historyTable = h("table", {});
      historyTable.setAttribute("aria-label", "State history");
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Check", "Group", "From", "To"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      const hist = await api<{ history: { at: string; from: string; to: string; group?: string }[] }>(`/api/rules/${ruleId}`);
      for (const item of hist.history.slice().reverse()) {
        tbody.append(
          h("tr", {}, h("td", { class: "mono" }, displayIso(item.at)), h("td", { class: "mono" }, String(item.group ?? "")), h("td", { class: "mono" }, item.from), h("td", { class: "mono" }, item.to)),
        );
      }
      historyTable.append(thead, tbody);
      historyHolder.replaceChildren(h("h3", {}, "State history"), historyTable);
    } catch {
      wrap.replaceChildren(namedAlert("Load failed", "Spoorline can't reach the server. Retry when your connection is back."));
    }
  }

  addLiveHandler("alert", () => void load());
  addLiveHandler("clock", () => void load());
  void load();
}

function openSnoozeDialog(ruleId: string, group: string, opener: HTMLElement): void {
  openModal(
    (close) => {
      const box = h("div", {});
      box.append(h("h3", {}, "Snooze"));
      let choice = "1h";
      for (const [value, label] of [["1h", "For 1 hour"], ["1d", "For 1 day"], ["recovered", "Until recovered"]] as const) {
        const row = h("label", { style: { display: "block", padding: "6px 0" } });
        const rb = document.createElement("input");
        rb.type = "radio";
        rb.name = "snooze";
        rb.value = value;
        rb.setAttribute("aria-label", label);
        if (value === "1h") rb.checked = true;
        rb.addEventListener("change", () => {
          choice = value;
        });
        row.append(rb, document.createTextNode(" " + label));
        box.append(row);
      }
      const apply = h("button", { class: "btn-main" }, "Snooze");
      const cancel = h("button", { class: "btn" }, "Cancel");
      cancel.addEventListener("click", close);
      apply.addEventListener("click", async () => {
        apply.setAttribute("aria-busy", "true");
        try {
          const res = await api<{ group: string }>(`/api/rules/${ruleId}/groups/${encodeURIComponent(group)}/snooze`, {
            method: "POST",
            body: JSON.stringify({ for: choice }),
            headers: { "Content-Type": "application/json" },
          });
          if (choice === "recovered") showNotice(`Group ${group} snoozed until it recovers.`);
          else showNotice(`Group ${group} snoozed until ${displayIso(res.group)}.`);
          close();
        } catch (err) {
          if (err instanceof ApiFail) showNotice(err.body.message);
        } finally {
          apply.removeAttribute("aria-busy");
        }
      });
      const row = h("div", { style: { display: "flex", gap: "8px", marginTop: "10px" } });
      row.append(apply, cancel);
      box.append(row);
      return box;
    },
    opener,
    "Snooze",
  );
}

export function buildNewRule(view: HTMLElement): void {
  const wrap = h("div", { class: "card" });
  wrap.style.maxWidth = "640px";
  wrap.append(h("h2", {}, "New rule"));
  const error = h("div", { class: "error-box", role: "alert", "aria-label": "Error" });
  error.style.display = "none";
  const fields: [key: string, label: string, kind: "text" | "number" | "select", options?: string[]][] = [
    ["name", "Rule name", "text"],
    ["filter_field", "Filter field", "text"],
    ["filter_value", "Filter value", "text"],
    ["measure_field", "Measure field", "text"],
    ["group_by", "Group by", "text"],
    ["window_ms", "Window (ms)", "number"],
    ["threshold", "Threshold", "number"],
    ["interval_ms", "Interval (ms)", "number"],
  ];
  const inputs: Record<string, HTMLInputElement> = {};
  const selects: Record<string, HTMLSelectElement> = {};
  const streamSelect = h("select", { class: "input", "aria-label": "Stream" }) as HTMLSelectElement;
  const filterOpSelect = h("select", { class: "input", "aria-label": "Filter operator" }) as HTMLSelectElement;
  for (const op of ["eq", "ne", "exists", "gt", "gte", "lt", "lte"]) {
    filterOpSelect.append(Object.assign(document.createElement("option"), { value: op, textContent: op }));
  }
  const measureSelect = h("select", { class: "input", "aria-label": "Measure" }) as HTMLSelectElement;
  for (const m of ["count", "avg", "max", "min", "sum"]) {
    measureSelect.append(Object.assign(document.createElement("option"), { value: m, textContent: m }));
  }
  const comparisonSelect = h("select", { class: "input", "aria-label": "Comparison" }) as HTMLSelectElement;
  for (const c of [">", ">=", "<", "<="]) {
    comparisonSelect.append(Object.assign(document.createElement("option"), { value: c, textContent: c }));
  }
  const frequencySelect = h("select", { class: "input", "aria-label": "Action frequency" }) as HTMLSelectElement;
  for (const f of ["On status change", "Every check", "At most every <n> ms"]) {
    frequencySelect.append(Object.assign(document.createElement("option"), { value: f, textContent: f }));
  }
  for (const [key, label, kind] of fields) {
    const lab = h("label", { style: { display: "block", marginTop: "8px" } }, label);
    const input = document.createElement("input");
    input.className = "input mono";
    input.setAttribute("aria-label", label);
    if (kind === "number") input.type = "number";
    inputs[key] = input;
    wrap.append(lab, input);
  }
  // insert selects at the right places
  const wrapChildren = Array.from(wrap.children);
  wrap.replaceChildren();
  const order: [string, HTMLElement][] = [
    ["Stream", streamSelect],
    ["Rule name", inputs.name],
    ["Filter field", inputs.filter_field],
    ["Filter operator", filterOpSelect],
    ["Filter value", inputs.filter_value],
    ["Measure", measureSelect],
    ["Measure field", inputs.measure_field],
    ["Group by", inputs.group_by],
    ["Window (ms)", inputs.window_ms],
    ["Comparison", comparisonSelect],
    ["Threshold", inputs.threshold],
    ["Action frequency", frequencySelect],
    ["Interval (ms)", inputs.interval_ms],
  ];
  for (const [label, control] of order) {
    const lab = h("label", { style: { display: "block", marginTop: "8px" } }, label);
    wrap.append(lab, control);
  }
  const save = h("button", { class: "btn-main" }, "Save rule");
  save.style.marginTop = "12px";
  wrap.append(error, save);
  view.append(wrap);

  void (async () => {
    try {
      const res = await api<{ streams: { name: string }[] }>("/api/streams");
      for (const s of res.streams) {
        streamSelect.append(Object.assign(document.createElement("option"), { value: s.name, textContent: s.name }));
      }
    } catch {
      // leave empty
    }
  })();

  effectVisible(inputs.interval_ms, frequencySelect, "At most every <n> ms");

  save.addEventListener("click", async () => {
    save.setAttribute("aria-busy", "true");
    error.style.display = "none";
    const freqValue = frequencySelect.value;
    const frequency =
      freqValue === "On status change"
        ? { kind: "change" }
        : freqValue === "Every check"
          ? { kind: "check" }
          : { kind: "throttle", every_ms: Number(inputs.interval_ms.value || 0) };
    const filter =
      inputs.filter_field.value.trim() !== ""
        ? { field: inputs.filter_field.value, op: filterOpSelect.value, value: inputs.filter_value.value }
        : null;
    try {
      const res = await api<{ id: string }>("/api/rules", {
        method: "POST",
        body: JSON.stringify({
          name: inputs.name.value,
          stream: streamSelect.value,
          filter,
          measure: measureSelect.value,
          measure_field: measureSelect.value === "count" ? null : inputs.measure_field.value,
          group_by: inputs.group_by.value || null,
          window_ms: Number(inputs.window_ms.value || 0),
          comparison: comparisonSelect.value,
          threshold: Number(inputs.threshold.value || 0),
          frequency,
        }),
        headers: { "Content-Type": "application/json" },
      });
      showNotice(`Rule ${inputs.name.value} saved.`);
      goTo(`/alerts/${res.id}`);
    } catch (err) {
      if (err instanceof ApiFail) {
        error.style.display = "block";
        error.textContent = err.body.message;
      }
    } finally {
      save.removeAttribute("aria-busy");
    }
  });
}

/** Show an input only when a select holds a given value. */
function effectVisible(input: HTMLElement, select: HTMLSelectElement, value: string): void {
  const sync = (): void => {
    const show = select.value === value;
    const label = input.previousElementSibling as HTMLElement | null;
    if (label) label.style.display = show ? "block" : "none";
    input.style.display = show ? "block" : "none";
  };
  select.addEventListener("change", sync);
  sync();
}

export function buildMaintenance(view: HTMLElement): void {
  const wrap = h("div", { class: "card" });
  wrap.style.maxWidth = "640px";
  wrap.append(h("h2", {}, "Maintenance windows"));
  const name = document.createElement("input");
  name.className = "input";
  name.setAttribute("aria-label", "Name");
  const zone = h("select", { class: "input", "aria-label": "Window time zone" }) as HTMLSelectElement;
  for (const z of ["UTC", "America/New_York", "Europe/London", "Asia/Tokyo"]) {
    zone.append(Object.assign(document.createElement("option"), { value: z, textContent: z }));
  }
  const daysGroup = h("fieldset", {});
  daysGroup.setAttribute("role", "group");
  daysGroup.setAttribute("aria-label", "Weekly days");
  const dayChecks: Record<string, HTMLInputElement> = {};
  for (const day of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) {
    const key = day.slice(0, 3).toLowerCase();
    const label = h("label", { style: { display: "inline-block", marginRight: "8px" } });
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.setAttribute("aria-label", day);
    dayChecks[key] = cb;
    label.append(cb, document.createTextNode(" " + day));
    daysGroup.append(label);
  }
  const start = document.createElement("input");
  start.className = "input mono";
  start.setAttribute("aria-label", "Start (HH:MM)");
  start.placeholder = "02:00";
  const duration = document.createElement("input");
  duration.className = "input mono";
  duration.setAttribute("aria-label", "Duration (ms)");
  duration.type = "number";
  duration.value = "3600000";
  const ruleSelect = h("select", { class: "input", "aria-label": "Rule" }) as HTMLSelectElement;
  const save = h("button", { class: "btn-main" }, "Save window");
  save.style.marginTop = "12px";
  const error = h("div", { class: "error-box", role: "alert", "aria-label": "Error" });
  error.style.display = "none";
  const table = h("table", {});
  table.setAttribute("aria-label", "Maintenance windows");

  for (const [label, control] of [
    ["Name", name],
    ["Window time zone", zone],
  ] as const) {
    wrap.append(h("label", { style: { display: "block", marginTop: "8px" } }, label), control);
  }
  wrap.append(daysGroup);
  for (const [label, control] of [
    ["Start (HH:MM)", start],
    ["Duration (ms)", duration],
    ["Rule", ruleSelect],
  ] as const) {
    wrap.append(h("label", { style: { display: "block", marginTop: "8px" } }, label), control);
  }
  wrap.append(error, save, table);
  view.append(wrap);

  void (async () => {
    try {
      const res = await api<{ rules: { id: string; name: string }[] }>("/api/rules");
      for (const r of res.rules) {
        ruleSelect.append(Object.assign(document.createElement("option"), { value: r.id, textContent: r.name }));
      }
    } catch {
      // leave empty
    }
  })();

  save.addEventListener("click", async () => {
    save.setAttribute("aria-busy", "true");
    error.style.display = "none";
    const days = Object.entries(dayChecks)
      .filter(([, cb]) => cb.checked)
      .map(([key]) => key);
    try {
      const res = await api<{ name: string; next_start: string }>("/api/maintenance", {
        method: "POST",
        body: JSON.stringify({
          name: name.value,
          time_zone: zone.value,
          days,
          start: start.value,
          duration_ms: Number(duration.value || 0),
          rule: ruleSelect.value,
        }),
        headers: { "Content-Type": "application/json" },
      });
      showNotice(`Maintenance window ${res.name} saved.`);
      void loadTable();
    } catch (err) {
      if (err instanceof ApiFail) {
        error.style.display = "block";
        error.textContent = err.body.message;
      }
    } finally {
      save.removeAttribute("aria-busy");
    }
  });

  async function loadTable(): Promise<void> {
    try {
      const res = await api<{ maintenance: { name: string; rule: string; next_start: string; rule_name?: string }[] }>(
        "/api/maintenance",
      );
      table.replaceChildren();
      const thead = h("thead", {});
      const headRow = h("tr", {});
      for (const c of ["Name", "Rule", "Next start"]) headRow.append(h("th", {}, c));
      thead.append(headRow);
      const tbody = h("tbody", {});
      for (const m of res.maintenance) {
        tbody.append(
          h("tr", {}, h("td", {}, m.name), h("td", {}, String(m.rule_name ?? m.rule)), h("td", { class: "mono" }, displayIso(m.next_start))),
        );
      }
      table.append(thead, tbody);
    } catch {
      table.replaceChildren();
    }
  }
  void loadTable();
  addLiveHandler("clock", () => void loadTable());
}
