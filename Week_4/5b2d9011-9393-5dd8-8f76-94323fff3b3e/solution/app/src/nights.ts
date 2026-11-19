import { api, ApiError } from "./api";
import { clear, h, uid } from "./dom";
import { openDialog, type DialogHandle } from "./dialogs";
import { Fuse } from "./fuse";
import { clockAbbr, dayMonth, dateHeading, stamp, viewerZone, zoneAbbr } from "./format";
import { closeButton, failureCopy, field, heading, textInput } from "./panels";
import { app, isFounder, notify } from "./state";
import type { Night, PriceChange, PriceItem } from "./types";

const STATUS_COPY: Record<Night["status"], string> = {
  scheduled: "Opens soon", signups_open: "Sign-ups open", closed: "Sign-ups closed", live: "Live now", done: "Done",
};
const REFRESH_MS = 10_000;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function openNights(opener: HTMLElement | null, onClose: () => void): DialogHandle {
  const fuses: Fuse[] = [];
  const list = h("ul", { class: "night-list", "aria-label": "Upcoming nights" });
  const status = h("p", { class: "line" }, "Loading…");
  const prices = h("section", { class: "prices", role: "region", "aria-label": "Ammo station prices" });
  const newNight = h("button", { type: "button", class: "btn btn-primary", onclick: () => openSeries(newNight, () => void refresh()) }, "New weekly night");
  let handle: DialogHandle;
  let timer = 0;

  const resetFuses = (): void => {
    fuses.splice(0).forEach((f) => f.destroy());
  };
  const onZero = (): void => void refresh();

  const renderNights = (nights: Night[], serverNow: string): void => {
    resetFuses();
    clear(list);
    status.textContent = nights.length === 0 ? "No nights scheduled." : "";
    status.hidden = nights.length > 0;
    let lastDate = "";
    const zone = viewerZone();
    for (const night of nights) {
      if (night.date !== lastDate) {
        lastDate = night.date;
        list.append(h("li", { class: "night-date" }, h("h3", {}, dateHeading(night.date))));
      }
      const open = night.status === "scheduled" || night.status === "signups_open";
      let clockEl: HTMLElement;
      if (open) {
        const fuse = new Fuse({ name: "Sign-ups close", outcome: "closed", maxExtrapolateMs: Infinity, onResolve: onZero });
        fuse.set(Date.parse(night.signups_close_at) - Date.parse(serverNow));
        fuses.push(fuse);
        clockEl = fuse.el;
      } else {
        clockEl = h("span", { class: "fuse is-outcome", role: "timer", "aria-label": "Sign-ups close", "data-server-ms": "0" }, "closed");
      }
      const label = `Sign up for ${night.title} on ${dayMonth(night.starts_at, app.studioZone)}`;
      const button = h("button", { type: "button", class: "btn btn-primary", "aria-label": label, disabled: night.status !== "signups_open" }, "Sign up");
      button.addEventListener("click", () => openSignup(button, night, () => void refresh()));
      list.append(h("li", { class: "night-row" },
        h("h4", {}, night.title),
        h("p", { class: "night-times" }, `${clockAbbr(night.starts_at, app.studioZone)} studio · Your time ${stamp(night.starts_at, zone)}`),
        h("p", { class: "night-meta" }, h("span", { class: `badge badge-${night.status}` }, STATUS_COPY[night.status]), h("span", {}, night.mode === "siege" ? "Siege" : "Convoy"),
          h("span", {}, `Seats left ${night.seats_left}`), h("span", { class: "night-close" }, h("span", { class: "cap", "aria-hidden": "true" }, "Sign-ups close"), clockEl)),
        button));
    }
  };

  const renderPrices = (items: PriceItem[], schedule: PriceChange[], now: string): void => {
    const names = new Map(items.map((i) => [i.item, i.name]));
    clear(prices);
    const rows = schedule.map((change) => {
      const name = names.get(change.item) ?? change.item;
      const effective = change.effective_local.replace("T", " ");
      const when = h("td", {}, effective);
      const state = h("td", {}, h("span", { class: `badge badge-${change.status}` }, change.status === "in_effect" ? "In effect" : change.status === "pending" ? "Pending" : "Superseded"));
      const actions = h("td", {});
      if (change.status === "pending") {
        const fuse = new Fuse({ name: `Price change ${name}`, outcome: "new price", maxExtrapolateMs: Infinity, onResolve: onZero });
        fuse.set(Date.parse(change.effective_at) - Date.parse(now));
        fuses.push(fuse);
        state.append(" ", fuse.el);
        const remove = h("button", { type: "button", class: "btn btn-ghost", "aria-label": `Remove ${name} change at ${effective}` }, "Remove");
        remove.addEventListener("click", () => void removeChange(change, remove));
        actions.append(remove);
      }
      return h("tr", {}, h("td", {}, name), h("td", {}, `${change.price} cr`), when, state, actions);
    });
    prices.append(
      h("div", { class: "row-between" }, h("h3", {}, "Ammo station prices"),
        h("button", { type: "button", class: "btn btn-primary", onclick: (event: Event) => openPriceChange(event.currentTarget as HTMLElement, items, () => void refresh()) }, "Schedule price change")),
      h("table", { class: "table", "aria-label": "Price schedule" },
        h("thead", {}, h("tr", {}, h("th", {}, "Item"), h("th", {}, "Price"), h("th", {}, "Effective (studio)"), h("th", {}, "Status"), h("th", {}, h("span", { class: "sr-only" }, "Actions")))),
        h("tbody", {}, ...rows)));
  };

  const removeChange = async (change: PriceChange, button: HTMLElement): Promise<void> => {
    button.setAttribute("disabled", "");
    notify("Removing…");
    try {
      await api<void>("DELETE", `/api/prices/${change.id}`);
      notify("Price change removed.");
    } catch (error) {
      notify(error instanceof ApiError && error.code === "price_change_in_effect" ? "That price is already in effect and can't be removed." : failureCopy(error));
    }
    void refresh();
  };

  const refresh = async (): Promise<void> => {
    try {
      const today = await api<{ now: string; studio_local: string }>("GET", "/api/clock");
      const data = await api<{ nights: Night[] }>("GET", `/api/nights?from=${today.studio_local.slice(0, 10)}&days=90`);
      renderNights(data.nights, today.now);
      if (isFounder()) {
        const priceData = await api<{ items: PriceItem[]; schedule: PriceChange[] }>("GET", "/api/prices");
        renderPrices(priceData.items, priceData.schedule, today.now);
      }
    } catch {
      resetFuses();
      clear(list);
      status.hidden = false;
      status.replaceChildren("Nights are unavailable right now. ", h("button", { type: "button", class: "btn btn-ghost", onclick: () => void refresh() }, "Try again"));
    }
  };

  handle = openDialog({
    name: "Nights", scrim: true, opener, className: "panel-wide",
    onClose: () => { window.clearInterval(timer); resetFuses(); onClose(); },
    content: [h("div", { class: "panel-head" }, heading("Nights"), isFounder() ? newNight : null), status, list, isFounder() ? prices : null,
      h("div", { class: "row-end" }, closeButton(() => handle.close()))],
  });
  void refresh();
  timer = window.setInterval(() => void refresh(), REFRESH_MS);
  return handle;
}

function zoneOptions(): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const own = viewerZone();
  return zones.includes(own) ? zones : [own, ...zones];
}

function openSignup(opener: HTMLElement, night: Night, onDone: () => void): void {
  const name = textInput({ name: "name", maxlength: "60" });
  const email = textInput({ name: "email", type: "email", inputmode: "email" });
  const zone = h("select", { name: "viewer_zone" }, ...zoneOptions().map((z) => h("option", { value: z }, z)));
  zone.value = viewerZone();
  const nameField = field("Name", name, uid("name"));
  const emailField = field("Email", email, uid("email"));
  const zoneField = field("Your time zone", zone, uid("zone"));
  const submit = h("button", { type: "button", class: "btn btn-primary" }, "Sign me up");
  let handle: DialogHandle;
  const send = async (): Promise<void> => {
    [nameField, emailField, zoneField].forEach((f) => f.clear());
    submit.setAttribute("disabled", "");
    notify("Signing you up…");
    const day = dayMonth(night.starts_at, app.studioZone);
    try {
      const result = await api<{ email_status: string }>("POST", `/api/nights/${night.id}/signups`, { name: name.value, email: email.value, viewer_zone: zone.value });
      if (result.email_status === "already_signed_up") notify("You're already signed up for this night.");
      else notify(`You're signed up for ${night.title} on ${day}. Confirmation email: ${result.email_status === "sent" ? "sent." : "queued — it sends when mail is back."}`);
      handle.close();
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation") {
        if (error.fields.name) nameField.error(error.fields.name);
        if (error.fields.email) emailField.error(error.fields.email);
        if (error.fields.viewer_zone) zoneField.error(error.fields.viewer_zone);
        notify("");
      } else if (error instanceof ApiError && error.code === "signups_closed") {
        notify(`Sign-ups for this night closed at ${clockAbbr(night.signups_close_at, app.studioZone)} studio time.`);
      } else if (error instanceof ApiError && error.code === "signups_not_open") {
        notify(`Sign-ups open ${stamp(night.signups_open_at, app.studioZone)} studio time.`);
      } else if (error instanceof ApiError && error.code === "night_full") {
        notify("This night is full.");
      } else notify(failureCopy(error));
    } finally {
      submit.removeAttribute("disabled");
    }
  };
  submit.addEventListener("click", () => void send());
  handle = openDialog({ name: "Sign up", scrim: true, opener,
    content: [heading("Sign up"), h("p", { class: "line" }, `${night.title} · ${dayMonth(night.starts_at, app.studioZone)} ${clockAbbr(night.starts_at, app.studioZone)}`),
      h("form", { onsubmit: (event: Event) => { event.preventDefault(); void send(); } }, nameField.wrap, emailField.wrap, zoneField.wrap,
        h("div", { class: "row-end" }, closeButton(() => handle.close()), submit))] });
}

function select(name: string, options: [string, string][], value: string): HTMLSelectElement {
  const el = h("select", { name }, ...options.map(([v, label]) => h("option", { value: v }, label)));
  el.value = value;
  return el;
}

function openSeries(opener: HTMLElement, onDone: () => void): void {
  const title = textInput({ name: "title", maxlength: "80" });
  const mode = select("mode", [["siege", "Siege"], ["convoy", "Convoy"]], "siege");
  const weekday = select("weekday", WEEKDAYS.map((d) => [d.toLowerCase(), d]), "friday");
  const time = textInput({ name: "local_time", value: "20:00", inputmode: "numeric" });
  const first = textInput({ name: "first_date", placeholder: "YYYY-MM-DD" });
  const weeks = h("input", { type: "number", name: "weeks", value: "8", min: "1", max: "26" });
  const capacity = h("input", { type: "number", name: "capacity", value: "24", min: "1", max: "64" });
  const fields = {
    title: field("Title", title, uid("series-title")), mode: field("Mode", mode, uid("series-mode")),
    weekday: field("Weekday", weekday, uid("series-weekday")), local_time: field("Start time", time, uid("series-time")),
    first_date: field("First date", first, uid("series-first")), weeks: field("Weeks", weeks, uid("series-weeks")),
    capacity: field("Capacity", capacity, uid("series-capacity")),
  };
  const submit = h("button", { type: "button", class: "btn btn-primary" }, "Schedule nights");
  let handle: DialogHandle;
  const send = async (): Promise<void> => {
    Object.values(fields).forEach((f) => f.clear());
    const weekdayName = weekday.selectedOptions[0].text;
    const problems: Record<string, string> = {};
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)) problems.local_time = "Use HH:MM, 24-hour.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first.value)) problems.first_date = `Must be a ${weekdayName} after today, studio time.`;
    if (Object.keys(problems).length > 0) {
      for (const [key, message] of Object.entries(problems)) fields[key as keyof typeof fields].error(message);
      return;
    }
    submit.setAttribute("disabled", "");
    notify("Scheduling…");
    try {
      const made = await api<{ nights: Night[] }>("POST", "/api/nights/series", {
        title: title.value, mode: mode.value, weekday: weekday.value, local_time: time.value, first_date: first.value,
        weeks: Number(weeks.value), capacity: Number(capacity.value),
      });
      notify(`Scheduled ${made.nights.length} nights of ${title.value}.`);
      handle.close();
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation") {
        for (const [key, message] of Object.entries(error.fields)) fields[key as keyof typeof fields]?.error(message);
        notify("");
      } else notify(failureCopy(error));
    } finally {
      submit.removeAttribute("disabled");
    }
  };
  submit.addEventListener("click", () => void send());
  handle = openDialog({ name: "New weekly night", scrim: true, opener,
    content: [heading("New weekly night"), h("form", { onsubmit: (event: Event) => { event.preventDefault(); void send(); } },
      ...Object.values(fields).map((f) => f.wrap), h("div", { class: "row-end" }, closeButton(() => handle.close()), submit))] });
}

function openPriceChange(opener: HTMLElement, items: PriceItem[], onDone: () => void): void {
  const names = new Map(items.map((i) => [i.item, i.name]));
  const item = select("item", items.map((i): [string, string] => [i.item, i.name]), items[0].item);
  const price = h("input", { type: "number", name: "price", min: "1", max: "5000" });
  const effective = textInput({ name: "effective_local", placeholder: "YYYY-MM-DD HH:MM" });
  const fields = {
    item: field("Item", item, uid("price-item")), price: field("New price", price, uid("price-value")),
    effective_local: field("Effective (studio time)", effective, uid("price-effective")),
  };
  const submit = h("button", { type: "button", class: "btn btn-primary" }, "Save price change");
  let handle: DialogHandle;
  const send = async (): Promise<void> => {
    Object.values(fields).forEach((f) => f.clear());
    const problems: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(effective.value)) problems.effective_local = "Pick a time after now, in studio time.";
    if (!/^\d+$/.test(price.value) || Number(price.value) < 1 || Number(price.value) > 5000) problems.price = "Use a whole number from 1 to 5000.";
    if (Object.keys(problems).length > 0) {
      for (const [key, message] of Object.entries(problems)) fields[key as keyof typeof fields].error(message);
      return;
    }
    submit.setAttribute("disabled", "");
    notify("Saving price change…");
    const local = effective.value.replace(" ", "T");
    try {
      const made = await api<PriceChange>("POST", "/api/prices", { item: item.value, price: Number(price.value), effective_local: local });
      notify(`Price change saved: ${names.get(made.item)} becomes ${made.price} cr at ${made.effective_local.replace("T", " ")} ${zoneAbbr(made.effective_at, app.studioZone)}.`);
      handle.close();
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === "price_change_exists") notify(`A change for ${names.get(item.value)} at that time already exists.`);
      else if (error instanceof ApiError && error.code === "validation") {
        for (const [key, message] of Object.entries(error.fields)) fields[key as keyof typeof fields]?.error(message);
        notify("");
      } else notify(failureCopy(error));
    } finally {
      submit.removeAttribute("disabled");
    }
  };
  submit.addEventListener("click", () => void send());
  handle = openDialog({ name: "Schedule price change", scrim: true, opener,
    content: [heading("Schedule price change"), h("form", { onsubmit: (event: Event) => { event.preventDefault(); void send(); } },
      ...Object.values(fields).map((f) => f.wrap), h("div", { class: "row-end" }, closeButton(() => handle.close()), submit))] });
}
