// Information pages (brief: Information pages): shipping table, protection prices, questions, partners, privacy.
import { api } from "../api.ts";
import { boot, type TaxRate } from "../boot.ts";
import { h } from "../dom.ts";
import { busy, form, input, select, showRefusal, type Field } from "../forms.ts";
import { percent, price } from "../format.ts";
import type { PageContext } from "../router.ts";
import { pageHead, scrollBox } from "../ui.ts";
import { questionRows } from "./home.ts";

export function shipping({ main }: PageContext): void {
  document.title = "Shipping | Tern Foils";
  const head = (cols: string[]) => h("thead", null, h("tr", null, cols.map((c) => h("th", { scope: "col" }, c))));
  const components = (taxes: TaxRate[]) => taxes.map((t) => `${t.name} ${percent(t.rate_pcm)}`).join(", ");
  const warehouses = [...new Set(boot.countries.map((c) => c.warehouse))]
    .map((w) => `Orders to ${boot.countries.filter((c) => c.warehouse === w).map((c) => c.name).join(", ")} ship from ${w}`).join(". ");
  main.append(pageHead("Shipping", "In-stock orders placed on a business day before 14:00 at their warehouse ship that day; later orders ship on the next business day."), h("div", { class: "wrap" },
    h("p", null, `${warehouses}. Business days are Monday to Friday in the warehouse's time zone, apart from its public holidays.`),
    h("p", null, "Spare batteries ship at 30% charge or less."),
    h("p", null, "Spare lithium batteries are regulated dangerous goods: UN3481 when packed with a board, UN3480 when shipped alone. Each carries a handling fee. Tax applies to merchandise only."),
    scrollBox("Shipping by country", h("table", { class: "data-table" },
      head(["Country", "Board shipping", "Accessory shipping", "Free accessory shipping from", "Dangerous goods fee per spare packed with a board", "Dangerous goods fee per spare shipped alone", "Tax", "Arrives in"]),
      h("tbody", null, boot.countries.map((c) => h("tr", null,
        h("th", { scope: "row" }, c.name),
        h("td", null, c.package_shipping_cents === 0 ? "Free" : price(c.package_shipping_cents)),
        h("td", null, price(c.accessory_shipping_cents)),
        h("td", null, c.free_accessory_shipping_from_cents === null ? "Not offered" : price(c.free_accessory_shipping_from_cents)),
        h("td", null, price(c.packed_battery_fee_cents)),
        h("td", null, price(c.standalone_battery_fee_cents)),
        h("td", null, c.taxes ? c.taxes.map((t) => percent(t.rate_pcm)).join(" + ") : "By province"),
        h("td", null, `${c.transit_business_days} business days`)))))),
    h("h2", null, "Tax in Canada"),
    h("p", null, "Canadian tax follows the first letter of the postal code."),
    scrollBox("Canadian tax by province", h("table", { class: "data-table" },
      head(["Postal code starts with", "Province or territory", "Tax"]),
      h("tbody", null, boot.provinces.map((p) => h("tr", null,
        h("td", null, [...p.letters].join(", ")),
        h("th", { scope: "row" }, p.name),
        h("td", null, components(p.taxes)))))))));
}

export function protection({ main }: PageContext): void {
  document.title = "Protection plans | Tern Foils";
  main.append(pageHead("Protection plans", "Every board is covered for a year. Extend it to 2 or 3 years within 30 days of your order."),
    h("div", { class: "wrap tiles tiles-two" },
      h("div", { class: "tile" }, h("h2", null, "2 years"), h("p", { class: "from" }, price(boot.protection["2"])), h("p", null, "Plus your country's tax. Add it from your order page.")),
      h("div", { class: "tile" }, h("h2", null, "3 years"), h("p", { class: "from" }, price(boot.protection["3"])), h("p", null, "Plus your country's tax. Add it from your order page."))));
}

export function faq({ main }: PageContext): void {
  document.title = "Rider questions | Tern Foils";
  main.append(pageHead("Rider questions"), h("div", { class: "wrap narrow" }, questionRows()));
}

export function partners({ main }: PageContext): void {
  document.title = "Partners | Tern Foils";
  const fields: Record<string, Field> = {
    business_name: input("Business name", { name: "business_name", autocomplete: "organization" }),
    email: input("Email", { type: "email", name: "email", autocomplete: "email" }),
    country: input("Country code", { name: "country", maxlength: 2, autocomplete: "country" }, "Two capital letters, like DE"),
    kind: select("Partnership", [{ value: "dealer", label: "Dealer" }, { value: "wholesale", label: "Wholesale" }, { value: "affiliate", label: "Affiliate" }], { name: "kind" }),
    website: input("Website (optional)", { type: "url", name: "website", autocomplete: "url" }),
  };
  const submit = h("button", { type: "submit", class: "pill pill-large" }, "Apply");
  const done = h("p", { class: "form-done" });
  const f = form({ class: "stack-form card" }, ...Object.values(fields).map((x) => x.wrap), submit, done);
  f.el.addEventListener("submit", async (event) => {
    event.preventDefault();
    done.textContent = "";
    const value = (k: string) => fields[k]!.control.value;
    const r = await busy(submit, "Sending...", () => api("POST", "/api/partner-applications", {
      business_name: value("business_name"), email: value("email"), country: value("country"), kind: value("kind"), website: value("website"),
    }));
    if (!r.ok) {
      showRefusal(r.error, fields, f.alert);
      return;
    }
    showRefusal({ error: "", message: "" }, fields, f.alert);
    done.textContent = "Application received.";
  });
  main.append(pageHead("Sell or rent Tern boards", "Dealers, wholesalers and affiliates: tell us about your business."), h("div", { class: "wrap narrow" }, f.el));
}

export function privacy({ main }: PageContext): void {
  document.title = "Privacy policy | Tern Foils";
  const p = (text: string) => h("p", null, text);
  main.append(pageHead("Privacy policy"), h("div", { class: "wrap narrow prose" },
    p("Tern Foils keeps only what it needs to run your account, your orders, your demo bookings and your requests to us."),
    p("We store your email address, your orders and delivery address, your trade-ins, your demo bookings, your callback and support requests, and, if you sign up, your newsletter consent. Passwords are stored only as salted hashes."),
    p("Billing records go to our billing system under an account named after your email address. No card details are taken or stored."),
    p("We send email only for the things you ask for: order confirmations, trade-in quotes, demo bookings, callbacks, support cases and password resets, plus the newsletter if you agreed to it."),
    p("To ask what we hold about you, or to have it removed, write to the workshop from the contact page.")));
}
