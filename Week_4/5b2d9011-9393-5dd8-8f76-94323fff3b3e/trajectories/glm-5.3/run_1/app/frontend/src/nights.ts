// The Nights panel: upcoming nights in the studio zone, sign-ups, and the
// founder's series and price tools.
import { api, type Night, type PricesBody, type PriceScheduleRow } from "./api";
import { el, clear, openDialog } from "./ui";
import { fmtMs, browserZone } from "./format";
import { ZONE_LIST } from "./zones";
import type { App } from "./main";
import { errorText } from "./main";

const STATUS_TEXT: Record<string, string> = {
  scheduled: "Opens soon",
  signups_open: "Sign-ups open",
  closed: "Sign-ups closed",
  live: "Live now",
  done: "Done",
};

export function openNightsPanel(app: App): void {
  openDialog({
    label: "Nights",
    build(root): void {
      root.classList.add("wide");
      root.append(el("h2", { text: "Nights" }));
      const list = el("div", { role: "list", "aria-label": "Upcoming nights" });
      root.append(list);
      void refresh();
      const timer = setInterval(() => void refresh(), 10_000);
      root.addEventListener("DOMNodeRemoved", () => { clearInterval(timer); });

      async function refresh(): Promise<void> {
        const res = await api.get<{ zone: string; nights: Night[] }>("/nights?days=90");
        if (!res.body) {
          clear(list);
          list.append(errorRow("Nights are offline right now.", () => void refresh()));
          return;
        }
        clear(list);
        if (res.body.nights.length === 0) {
          list.append(el("div", { class: "empty", text: "No nights scheduled." }));
        }
        // Group by studio date.
        let lastDate = "";
        for (const n of res.body.nights) {
          if (n.date !== lastDate) {
            lastDate = n.date;
            list.append(el("h3", { role: "heading", text: studioDateHeading(n.date) }));
          }
          list.append(nightRow(app, n, () => void refresh()));
        }
        if (app.me?.role === "founder") {
          appendFounderTools(app, root, () => void refresh());
        }
      }
    },
  });
}

function studioDateHeading(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function nightRow(app: App, n: Night, onChange: () => void): HTMLElement {
  const row = el("div", { class: "night-row", role: "listitem" });
  const startsLocal = new Date(n.starts_at);
  const viewerZone = browserZone();
  const studioTime = `${n.local_start.slice(11)} ${n.zone_abbr} studio`;
  const viewerTime = `Your time ${fmtViewer(startsLocal, viewerZone)}`;
  const day = startsLocal.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  const signLabel = `Sign up for ${n.title} on ${day}`;
  const signBtn = el("button", { class: "btn btn-mint", text: "Sign up", "aria-label": signLabel });
  signBtn.disabled = n.status !== "signups_open";
  signBtn.addEventListener("click", () => openSignup(app, n, onChange));

  const closeTimer = n.status_changes_in_ms !== null
    ? el("span", { role: "timer", "aria-label": "Sign-ups close", class: "seat-note", text: fmtMs(n.status_changes_in_ms) })
    : el("span", { class: "seat-note", text: "—" });

  row.append(
    el("div", { class: "top" },
      el("h4", { text: n.title, role: "heading" }),
      el("span", { class: "meta", text: n.mode === "siege" ? "Siege" : "Convoy" }),
    ),
    el("div", { class: "meta", text: `${studioTime} · ${viewerTime}` }),
    el("div", { class: "meta", text: STATUS_TEXT[n.status] ?? n.status }),
    el("div", { class: "actions" },
      el("span", { class: "seat-note", text: `Seats left ${n.seats_left}` }),
      closeTimer,
      signBtn,
    ),
  );
  return row;
}

function fmtViewer(t: Date, zone: string): string {
  try {
    const d = t.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: zone });
    const time = t.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone });
    return `${d} ${time}`;
  } catch {
    return t.toUTCString();
  }
}

function errorRow(text: string, retry: () => void): HTMLElement {
  const wrap = el("div", {});
  wrap.append(el("div", { class: "empty", text }));
  const btn = el("button", { class: "btn btn-ghost", text: "Retry" });
  btn.addEventListener("click", retry);
  wrap.append(btn);
  return wrap;
}

function openSignup(app: App, n: Night, onChange: () => void): void {
  openDialog({
    label: "Sign up",
    build(root): void {
      root.append(el("h2", { text: "Sign up" }));
      const nameF = field("Name", "name-input");
      const emailF = field("Email", "email-input");
      const zoneSel = el("select", { "aria-label": "Your time zone" });
      zoneSel.style.cssText = "width:100%;font:inherit;color:var(--ink);background:rgba(4,16,14,0.7);border:1px solid var(--hairline);border-radius:6px;padding:10px 12px;min-height:44px";
      const zones = ZONE_LIST.includes(browserZone()) ? ZONE_LIST : [browserZone(), ...ZONE_LIST];
      const defaultZone = browserZone();
      for (const z of zones) {
        const opt = el("option", { value: z, text: z });
        if (z === defaultZone) opt.setAttribute("selected", "");
        zoneSel.append(opt);
      }
      const zoneF = el("div", { class: "field" }, el("label", { class: "label", text: "Your time zone" }), zoneSel);

      const submit = el("button", { class: "btn btn-mint", text: "Sign me up" });
      root.append(nameF.wrap, emailF.wrap, zoneF, el("div", { class: "btn-row" }, submit));

      async function go(): Promise<void> {
        const body = {
          name: (nameF.input as HTMLInputElement).value.trim(),
          email: (emailF.input as HTMLInputElement).value.trim(),
          viewer_zone: (zoneSel as HTMLSelectElement).value,
        };
        app.setNotices("Signing you up…");
        const res = await api.post<{ signup: unknown; email_status: string }>(`/nights/${n.id}/signups`, body);
        app.setNotices("");
        if (res.status === 201 && res.body) {
          const day = new Date(n.starts_at).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
          app.toast(res.body.email_status === "queued"
            ? `You're signed up for ${n.title} on ${day}. Confirmation email: queued — it sends when mail is back.`
            : `You're signed up for ${n.title} on ${day}. Confirmation email: sent.`);
          root.closest(".scrim")?.remove();
          onChange();
          return;
        }
        if (res.status === 200 && res.body) {
          app.toast("You're already signed up for this night.");
          root.closest(".scrim")?.remove();
          return;
        }
        if (res.error) {
          if (res.error.fields) {
            if (res.error.fields.name) showErr(nameF, res.error.fields.name);
            if (res.error.fields.email) showErr(emailF, res.error.fields.email);
            if (res.error.fields.viewer_zone) app.toast(res.error.fields.viewer_zone);
          } else {
            app.toast(errorText(res.error, {
              signups_closed: `Sign-ups for this night closed at ${new Date(n.signups_close_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ${n.zone_abbr} studio time.`,
              signups_not_open: `Sign-ups open ${new Date(n.signups_open_at).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" })} ${new Date(n.signups_open_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })} ${n.zone_abbr} studio time.`,
              night_full: "This night is full.",
            }));
          }
        }
      }
      submit.addEventListener("click", () => void go());
    },
  });
}

interface FieldWrap { wrap: HTMLElement; input: HTMLElement }
function field(label: string, id: string): FieldWrap {
  const wrap = el("div", { class: "field" });
  const input = el("input", { type: "text", id, autocomplete: "off" });
  const err = el("div", { class: "field-error", id: id + "-err", style: "display:none" });
  input.setAttribute("aria-describedby", id + "-err");
  wrap.append(el("label", { class: "label", text: label, for: id }), input, err);
  return { wrap, input };
}
function showErr(f: FieldWrap, text: string): void {
  const err = f.wrap.querySelector(".field-error") as HTMLElement | null;
  if (err) { err.textContent = text; err.style.display = "block"; }
  (f.input as HTMLInputElement).setAttribute("aria-invalid", "true");
}

function appendFounderTools(app: App, root: HTMLElement, onChange: () => void): void {
  if (root.querySelector('[aria-label="Ammo station prices"]')) return;
  const region = el("div", { role: "region", "aria-label": "Ammo station prices", style: "margin-top:16px" });
  region.append(el("h3", { text: "Ammo station prices" }));
  const table = el("table", { role: "table", "aria-label": "Price schedule" });
  table.append(el("thead", {}, el("tr", {},
    el("th", { text: "Item" }), el("th", { text: "Price" }), el("th", { text: "Effective (studio)" }), el("th", { text: "Status" }))));
  const tbody = el("tbody");
  table.append(tbody);
  region.append(table);

  const newBtn = el("button", { class: "btn btn-mint", text: "New weekly night", style: "margin-top:12px" });
  newBtn.addEventListener("click", () => openSeriesDialog(app, onChange));
  const priceBtn = el("button", { class: "btn btn-ghost", text: "Schedule price change", style: "margin-top:12px" });
  priceBtn.addEventListener("click", () => openPriceDialog(app, onChange));
  region.append(newBtn, priceBtn);
  root.append(region);

  void refreshSchedule();
  async function refreshSchedule(): Promise<void> {
    const res = await api.get<PricesBody>("/prices");
    if (!res.body) return;
    clear(tbody);
    for (const row of res.body.schedule) {
      const tr = el("tr", {},
        el("td", { text: row.item === "ammo_pack" ? "Ammo pack" : row.item === "grenade" ? "Grenade" : "Med kit" }),
        el("td", { class: "num-cell", text: `${row.price} cr` }),
        el("td", { text: row.effective_local.replace("T", " ") }),
        el("td", { text: row.status === "in_effect" ? "In effect" : row.status === "pending" ? "Pending" : "Superseded" }),
      );
      if (row.status === "pending") {
        const rm = el("button", { class: "btn btn-ghost", text: "Remove", "aria-label": `Remove ${itemName(row.item)} change at ${row.effective_local.replace("T", " ")}` });
        rm.addEventListener("click", async () => {
          const res2 = await api.del(`/prices/${row.id}`);
          if (res2.error) {
            app.toast(res2.error.code === "price_change_in_effect" ? "That price is already in effect and can't be removed." : res2.error.message);
          } else {
            app.toast("Price change removed.");
            onChange();
            void refreshSchedule();
          }
        });
        tr.append(el("td", {}, rm));
      }
      tbody.append(tr);
    }
  }
}

function itemName(item: string): string {
  return item === "ammo_pack" ? "Ammo pack" : item === "grenade" ? "Grenade" : "Med kit";
}

function openSeriesDialog(app: App, onChange: () => void): void {
  openDialog({
    label: "New weekly night",
    build(root): void {
      root.append(el("h2", { text: "New weekly night" }));
      const title = field("Title", "ns-title");
      const mode = selectField("Mode", "ns-mode", ["Siege", "Convoy"], ["siege", "convoy"]);
      const weekday = selectField("Weekday", "ns-weekday",
        ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);
      const start = field("Start time", "ns-start");
      (start.input as HTMLInputElement).placeholder = "20:00";
      const first = field("First date", "ns-first");
      (first.input as HTMLInputElement).placeholder = "2026-12-04";
      const weeks = spinField("Weeks", "ns-weeks", 8, 1, 26);
      const capacity = spinField("Capacity", "ns-capacity", 24, 1, 64);
      const save = el("button", { class: "btn btn-mint", text: "Schedule nights" });
      root.append(title.wrap, mode, weekday, start.wrap, first.wrap, weeks.wrap, capacity.wrap, el("div", { class: "btn-row" }, save));

      save.addEventListener("click", async () => {
        clearFieldErrors(root);
        const body = {
          title: (title.input as HTMLInputElement).value.trim(),
          mode: (mode.querySelector("select") as HTMLSelectElement).value,
          weekday: (weekday.querySelector("select") as HTMLSelectElement).value,
          local_time: (start.input as HTMLInputElement).value.trim(),
          first_date: (first.input as HTMLInputElement).value.trim(),
          weeks: Number((weeks.input as HTMLInputElement).value),
          capacity: Number((capacity.input as HTMLInputElement).value),
        };
        app.setNotices("Scheduling…");
        const res = await api.post<{ nights: Night[] }>("/nights/series", body);
        app.setNotices("");
        if (res.status === 201 && res.body) {
          app.toast(`Scheduled ${res.body.nights.length} nights of ${body.title}.`);
          root.closest(".scrim")?.remove();
          onChange();
          return;
        }
        if (res.error?.fields) {
          for (const [k, v] of Object.entries(res.error.fields)) {
            const f = root.querySelector(`#ns-${k === "local_time" ? "start" : k === "first_date" ? "first" : k}`) as HTMLElement | null;
            if (f) {
              const err = f.parentElement?.querySelector(".field-error") as HTMLElement | null;
              if (err) { err.textContent = v; err.style.display = "block"; }
              f.setAttribute("aria-invalid", "true");
            }
          }
        } else if (res.error) {
          app.toast(errorText(res.error));
        }
      });
    },
  });
}

function openPriceDialog(app: App, onChange: () => void): void {
  openDialog({
    label: "Schedule price change",
    build(root): void {
      root.append(el("h2", { text: "Schedule price change" }));
      const item = selectField("Item", "np-item", ["Ammo pack", "Grenade", "Med kit"], ["ammo_pack", "grenade", "med_kit"]);
      const price = spinField("New price", "np-price", 120, 1, 5000);
      const eff = field("Effective (studio time)", "np-eff");
      (eff.input as HTMLInputElement).placeholder = "2026-12-20 19:30";
      const save = el("button", { class: "btn btn-mint", text: "Save price change" });
      root.append(item, price.wrap, eff.wrap, el("div", { class: "btn-row" }, save));

      save.addEventListener("click", async () => {
        const effVal = (eff.input as HTMLInputElement).value.trim();
        const body = {
          item: (item.querySelector("select") as HTMLSelectElement).value,
          price: Number((price.input as HTMLInputElement).value),
          effective_local: effVal.includes("T") ? effVal : effVal.replace(" ", "T"),
        };
        app.setNotices("Saving price change…");
        const res = await api.post<PriceScheduleRow>("/prices", body);
        app.setNotices("");
        if (res.status === 201 && res.body) {
          const effShown = res.body.effective_local.replace("T", " ");
          app.toast(`Price change saved: ${itemName(body.item)} becomes ${body.price} cr at ${effShown} CST.`);
          root.closest(".scrim")?.remove();
          onChange();
          return;
        }
        if (res.error?.fields) {
          for (const [k, v] of Object.entries(res.error.fields)) {
            const f = root.querySelector(`#np-${k === "effective_local" ? "eff" : k}`) as HTMLElement | null;
            if (f) {
              const err = f.parentElement?.querySelector(".field-error") as HTMLElement | null;
              if (err) { err.textContent = v; err.style.display = "block"; }
              f.setAttribute("aria-invalid", "true");
            }
          }
        } else if (res.error) {
          app.toast(errorText(res.error, { price_change_exists: `A change for ${itemName(body.item)} at that time already exists.` }));
        }
      });
    },
  });
}

function selectField(label: string, id: string, labels: string[], values: string[]): HTMLElement {
  const wrap = el("div", { class: "field" });
  const sel = el("select", { id });
  sel.style.cssText = "width:100%;font:inherit;color:var(--ink);background:rgba(4,16,14,0.7);border:1px solid var(--hairline);border-radius:6px;padding:10px 12px;min-height:44px";
  labels.forEach((l, i) => sel.append(el("option", { value: values[i], text: l })));
  wrap.append(el("label", { class: "label", text: label, for: id }), sel);
  return wrap;
}

function spinField(label: string, id: string, value: number, min: number, max: number): FieldWrap {
  const wrap = el("div", { class: "field" });
  const input = el("input", { type: "number", id, value: String(value), min: String(min), max: String(max) });
  input.setAttribute("role", "spinbutton");
  input.setAttribute("aria-label", label);
  input.setAttribute("aria-valuemin", String(min));
  input.setAttribute("aria-valuemax", String(max));
  input.setAttribute("aria-valuenow", String(value));
  input.style.cssText = "width:100%;font:inherit;color:var(--ink);background:rgba(4,16,14,0.7);border:1px solid var(--hairline);border-radius:6px;padding:10px 12px;min-height:44px";
  wrap.append(el("label", { class: "label", text: label, for: id }), input);
  return { wrap, input };
}

function clearFieldErrors(root: HTMLElement): void {
  for (const err of root.querySelectorAll(".field-error")) (err as HTMLElement).style.display = "none";
  for (const input of root.querySelectorAll("input")) input.removeAttribute("aria-invalid");
}
