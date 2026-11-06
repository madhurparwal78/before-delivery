// Book a call /callback (brief: Book a call): with ?build=<code> the "Build to discuss" panel shows that build in
// the Board viewer at the address pose; every refused field sits beneath itself, focus goes to the first one,
// and success replaces the form with the reference while the panel stays.
import { api } from "../api.ts";
import { boot } from "../boot.ts";
import { h, replace } from "../dom.ts";
import { busy, form, input, select, showRefusal, textarea, type Field } from "../forms.ts";
import { price } from "../format.ts";
import type { PageContext } from "../router.ts";
import type { Build, Catalog } from "../catalog.ts";
import { pageHead } from "../ui.ts";
import { parseView } from "../viewer/camera.ts";
import { BoardViewer, viewerBuild } from "../viewer/viewer.ts";

const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const UNKNOWN_BUILD = "We could not find that build.";

/** The panel for `code`; resolves to the code when the build exists, so the request names it. */
async function buildPanel(code: string, query: URLSearchParams, panel: HTMLElement, message: HTMLElement): Promise<string | null> {
  const [found, cat] = await Promise.all([api<Build>("GET", `/api/builds/${encodeURIComponent(code)}`), api<Catalog>("GET", "/api/catalog")]);
  if (!found.ok) {
    message.textContent = UNKNOWN_BUILD;
    return null;
  }
  if (!cat.ok) {
    message.textContent = cat.error.message;
    return null;
  }
  const build = found.data;
  const size = cat.data.boards.find((b) => b.sku === build.board_sku)?.size ?? "";
  const region = h("section", { class: "viewer", "aria-label": "Board viewer", "aria-describedby": "viewer-help" });
  const viewer = new BoardViewer(region, parseView(query), () => {
    const path = `/callback?build=${encodeURIComponent(code)}&${viewer.viewParam()}`;
    if (location.pathname + location.search !== path) history.replaceState(history.state, "", path);
  });
  panel.append(region,
    h("p", { id: "viewer-help", class: "sr-only" }, "Drag or use the arrow keys to turn the board, plus and minus to zoom, Home to reset."),
    h("p", { class: "callback-build" }, `${build.board_name} ${size}, ${price(build.total_cents)}`));
  await viewer.start(viewerBuild(build, cat.data), build.battery_bars);
  return code;
}

export async function callback({ main, query }: PageContext): Promise<void> {
  document.title = "Book a call | Tern Foils";
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fields: Record<string, Field> = {
    name: input("Name", { name: "name", autocomplete: "name" }),
    email: input("Email", { type: "email", name: "email", autocomplete: "email" }),
    phone: input("Phone", { type: "tel", name: "phone", autocomplete: "tel", placeholder: "+14155550100" }, "International format, like +14155550100"),
    timezone: select("Timezone", boot.callback.zones.map((z) => ({ value: z, label: z })), { name: "timezone" }),
    date: input("Preferred date", { type: "date", name: "date" }),
    preferred_start: select("Preferred time", TIMES.map((t) => ({ value: t, label: t })), { name: "time" }),
    topic: select("Topic", [{ value: "", label: "Choose a topic" }, ...boot.callback.topics.map((t) => ({ value: t, label: t }))], { name: "topic" }),
    message: textarea("Message", { name: "message", maxlength: 1000 }),
  };
  if (boot.callback.zones.includes(own)) fields.timezone!.control.value = own;
  fields.preferred_start!.control.value = "09:00";
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Request call");
  const f = form({ class: "stack-form card" },
    fields.name!.wrap, fields.email!.wrap, fields.phone!.wrap, fields.timezone!.wrap,
    h("div", { class: "pair" }, fields.date!.wrap, fields.preferred_start!.wrap), fields.topic!.wrap, fields.message!.wrap, submit);
  const box = h("div", { class: "callback-form" }, h("p", null, "We call on weekdays between 9:00 and 17:00 in your own time zone."), f.el);
  const code = query.get("build");
  const panelMessage = h("p", { class: "callback-build-message" });
  const panel = code ? h("section", { class: "card build-panel", "aria-labelledby": "build-panel-title" }, h("h2", { id: "build-panel-title" }, "Build to discuss"), panelMessage) : null;
  let buildCode: string | null = null;

  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = (k: string) => fields[k]!.control.value;
    const r = await busy(submit, "Sending...", () => api<{ reference: string }>("POST", "/api/callbacks", {
      name: value("name"), email: value("email"), phone: value("phone"), timezone: value("timezone"),
      preferred_start: `${value("date")}T${value("preferred_start")}`, topic: value("topic"), message: value("message"),
      ...(buildCode ? { build_code: buildCode } : {}),
    }));
    if (!r.ok) {
      const unknown = r.error.fields?.build_code;
      if (unknown) {
        panelMessage.textContent = unknown;
        buildCode = null;
      }
      const fieldTaken = showRefusal(r.error, fields, f.alert);
      if (unknown && !fieldTaken) f.alert.textContent = "";
      return;
    }
    const first = value("name").trim().split(" ")[0];
    const thanks = h("p", { class: "form-done", tabindex: "-1" }, `Thanks, ${first}. Your reference is ${r.data.reference}.`);
    replace(box, h("div", { class: "card done-card" }, thanks, h("a", { href: "/", class: "onward" }, "Back to home")));
    thanks.focus();
  });
  main.append(pageHead("Book a call with a rider advisor", "Tell us when suits you and what you would like to talk about."),
    h("div", { class: panel ? "wrap callback-grid" : "wrap narrow" }, panel, box));
  if (code && panel) buildCode = await buildPanel(code, query, panel, panelMessage);
}
