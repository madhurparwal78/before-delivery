// Demo locator /locations and events /events (brief: Demo locator and events): search by city or coordinates,
// slots labelled in the location's own time zone, seats and bookings refreshed after every attempt.
import { api } from "../api.ts";
import { boot } from "../boot.ts";
import { h, replace } from "../dom.ts";
import { busy, form, input, select, showRefusal } from "../forms.ts";
import { shortDay } from "../format.ts";
import type { PageContext } from "../router.ts";
import { announce, session, type User } from "../state.ts";
import { pageHead } from "../ui.ts";

interface Location {
  id: number;
  name: string;
  city: string;
  country: string;
  opening_hours: string;
  lat: number;
  lon: number;
  distance_km: number | null;
}

interface Slot {
  id: number;
  capacity: number;
  seats_left: number;
  label: string;
}

const RADII = [25, 50, 100, 250, 500];
const countryName = (code: string) => boot.countries.find((c) => c.code === code)?.name ?? code;

async function slotsView(location: Location, user: User | null, box: HTMLElement): Promise<void> {
  const alert = h("div", { role: "alert", class: "form-alert" });
  const render = async (focusAfter?: string) => {
    const r = await api<{ slots: Slot[] }>("GET", `/api/locations/${location.id}/slots`);
    const slots = r.ok ? r.data.slots : [];
    replace(box, h("h4", null, `Demo days at ${location.name}`), slots.length ? h("ul", { class: "slot-list" }, slots.map((slot) => {
      const seats = slot.seats_left > 0 ? `${slot.seats_left} of ${slot.capacity} seats left` : "Fully booked";
      let action: HTMLElement | null = null;
      if (slot.seats_left > 0 && user?.role === "customer") {
        const book = h("button", { type: "button", class: "pill pill-small", "aria-label": `Book a seat, ${slot.label}` }, "Book a seat");
        book.addEventListener("click", async () => {
          alert.textContent = "";
          const done = await busy(book, "Booking...", () => api<{ id: number }>("POST", "/api/demo-bookings", { slot_id: slot.id }));
          if (!done.ok) {
            await render();
            alert.textContent = done.error.message;
            return;
          }
          const after = await api<{ slots: Slot[] }>("GET", `/api/locations/${location.id}/slots`);
          const now = after.ok ? after.data.slots.find((x) => x.id === slot.id) : undefined;
          await render();
          announce(`Seat booked. ${now?.seats_left ?? 0} of ${slot.capacity} seats left.`);
        });
        action = book;
      } else if (slot.seats_left > 0 && !user) {
        action = h("a", { href: "/login?next=/locations", class: "onward" }, "Sign in to book");
      }
      return h("li", { class: "slot-row" }, h("span", { class: "slot-label" }, slot.label), h("span", { class: slot.seats_left > 0 ? "caption" : "caption full" }, seats), action);
    })) : h("p", null, "No upcoming demo days here yet."), alert);
    if (focusAfter) box.querySelector<HTMLElement>(focusAfter)?.focus();
  };
  await render("h4");
}

export async function locations({ main }: PageContext): Promise<void> {
  document.title = "Demo stations | Tern Foils";
  main.append(pageHead("Demo stations near you", "Find a station, see its demo days in local time and book a seat."));
  const user = await session();
  const all = await api<{ locations: Location[] }>("GET", "/api/locations");
  const known = all.ok ? all.data.locations : [];
  const fields = {
    city: select("City", [{ value: "", label: "Choose a city" }, ...known.map((l) => ({ value: String(l.id), label: l.city }))], { name: "city" }),
    lat: input("Latitude", { name: "lat", inputmode: "decimal", autocomplete: "off" }),
    lon: input("Longitude", { name: "lon", inputmode: "decimal", autocomplete: "off" }),
    radius_km: select("Radius", RADII.map((r) => ({ value: String(r), label: `${r} km` })), { name: "radius" }),
    country: select("Country", [{ value: "", label: "All countries" }, ...boot.countries.map((c) => ({ value: c.code, label: c.name }))], { name: "country" }),
  };
  fields.radius_km.control.value = "100";
  fields.city.control.addEventListener("change", () => {
    const place = known.find((l) => String(l.id) === fields.city.control.value);
    if (!place) return;
    fields.lat.control.value = String(place.lat);
    fields.lon.control.value = String(place.lon);
  });
  const search = h("button", { type: "submit", class: "pill" }, "Search");
  const f = form({ class: "locator-form card" }, fields.city.wrap, h("div", { class: "pair" }, fields.lat.wrap, fields.lon.wrap), h("div", { class: "pair" }, fields.radius_km.wrap, fields.country.wrap), search);
  const results = h("div", { class: "locator-results", "aria-live": "polite" });
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = new URLSearchParams();
    if (fields.lat.control.value || fields.lon.control.value) {
      q.set("lat", fields.lat.control.value);
      q.set("lon", fields.lon.control.value);
    }
    q.set("radius_km", fields.radius_km.control.value);
    if (fields.country.control.value) q.set("country", fields.country.control.value);
    const r = await busy(search, "Searching...", () => api<{ locations: Location[] }>("GET", `/api/locations?${q}`));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    showRefusal({ error: "", message: "" }, fields, f.alert);
    if (!r.data.locations.length) {
      replace(results, h("p", { class: "empty-line" }, `No demo stations within ${fields.radius_km.control.value} km.`));
      return;
    }
    replace(results, h("ul", { class: "location-cards" }, r.data.locations.map((l) => {
      const slots = h("div", { class: "slots" });
      const open = h("button", { type: "button", class: "pill pill-outline", "aria-label": `See demo days at ${l.name}` }, "See demo days");
      open.addEventListener("click", () => void slotsView(l, user, slots));
      return h("li", { class: "card location-card" },
        h("h3", null, l.name),
        h("p", null, `${l.city}, ${countryName(l.country)}`),
        h("p", { class: "caption" }, l.opening_hours),
        l.distance_km === null ? null : h("p", { class: "distance" }, `${l.distance_km.toFixed(1)} km`),
        open, slots);
    })));
  });
  main.append(h("div", { class: "wrap locator" }, f.el, results));
}

export async function events({ main }: PageContext): Promise<void> {
  document.title = "Demo events | Tern Foils";
  main.append(pageHead("Demo events", "Tour days where every board and part is on the water to try."));
  const r = await api<{ events: { id: number; title: string; location_name: string; city: string; starts_on: string; ends_on: string }[] }>("GET", "/api/events");
  const list = r.ok ? r.data.events : [];
  main.append(h("div", { class: "wrap" }, list.length
    ? h("ul", { class: "event-list" }, list.map((e) => h("li", { class: "card" }, h("h2", null, e.title), h("p", null, `${e.location_name}, ${e.city}`), h("p", { class: "caption" }, `${shortDay(e.starts_on)} to ${shortDay(e.ends_on)}`))))
    : h("p", null, "No upcoming events right now.")));
}
